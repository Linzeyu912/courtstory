"""One persistent runner shared by CLI, HTTP and callable tool adapters."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
import json
import os
from pathlib import Path
import threading
import time

from agent_workflow_contract import (ROOT, WorkflowError, canonical, digest, validate_request,
                                     RESPONSE_SCHEMA, _validate, WORKFLOW_VERSION)
from agent_workflow_store import WorkflowStore, ACTIVE, new_id
from agent_workflow_feedback import validate_feedback, recover_preview_result, validate_failed_diagnostics


def _opaque(value):
    if isinstance(value, str) and '/' not in value and '\\' not in value:
        return value
    return 'ref-' + digest(value)[:40]


@dataclass
class ToolContext:
    store: WorkflowStore
    caller_id: str
    run_id: str
    operation_id: str
    attempt_id: str
    generation: int
    lease_token: str
    run_root: Path
    attempt_dir: Path
    asset: dict
    source_ref: dict | None
    doc_ref: dict | None
    policy: dict
    dependencies: dict
    request: dict
    range: dict
    analysis_revision: int | None = None
    analysis_revision_reason: str | None = None
    prior_analysis_ref: dict | None = None
    prior_inventory_ref: dict | None = None
    repair_feedback_ref: dict | None = None

    def checkpoint(self):
        self.store.checkpoint(self.caller_id, self.run_id, self.operation_id, self.lease_token)

    def side_effect_guard(self):
        return self.store.side_effect_guard(self.caller_id, self.run_id, self.operation_id, self.lease_token)

    def model_call(self, estimated_cost_usd=None, **kwargs):
        if 'estimateCost' in kwargs:
            estimated_cost_usd = kwargs['estimateCost']
        self.store.consume(self.caller_id, self.run_id, self.operation_id, self.lease_token,
                           'model', estimated_cost_usd)

    def tracking_call(self):
        self.store.consume(self.caller_id, self.run_id, self.operation_id, self.lease_token, 'tracking')


class WorkflowRunner:
    def __init__(self, store, handlers=None, policy=None):
        self.store = store if isinstance(store, WorkflowStore) else WorkflowStore(store)
        self.workflow = json.loads((ROOT / 'workflow.json').read_text(encoding='utf-8'))
        self.policy = policy or json.loads((ROOT / 'policy.json').read_text(encoding='utf-8'))
        self.stages = {stage['name']: stage for stage in self.workflow['stages']}
        self.handlers = handlers or {}

    def response(self, caller, run_id, request_id, operation_id=None):
        run = self.store.get(caller, run_id)
        active = [op for op in run['operations'] if op['valid'] and op['status'] in ACTIVE]
        public_error = None
        if run['error']:
            # Provider/encoder diagnostics remain in the local operation audit.
            # A reason code is sufficient to select recovery without disclosing
            # local paths, model text or accidentally echoed credentials.
            public_error = {**run['error'], 'message': 'Workflow stopped: ' + run['error']['reasonCode'],
                            'suggestedAction': 'Inspect the authorized run audit and resume only the affected stages.'}
        result = {'schemaVersion': '1.0', 'requestId': request_id, 'runId': run_id,
                  'runRevision': run['revision'], 'operationId': operation_id,
                  'status': run['status'], 'artifactRefs': run['artifacts'], 'warnings': [],
                  'error': public_error, 'generation': run['generation'],
                  'currentStage': active[0]['stage'] if active else None,
                  'budget': run['budget'], 'unmetRequirements': run['unmet'],
                  'nextActions': ['resume_run'] if run['status'] in {'partial', 'needs_attention', 'failed', 'cancelled'} else []}
        _validate(result, RESPONSE_SCHEMA)
        return result

    def call(self, name, caller, request):
        validate_request(name, request)
        if name == 'submit_workflow':
            run_id = self.store.submit(caller, request, self.policy)
            return self.response(caller, run_id, request['requestId'])
        run_id = request['runId']
        if name == 'get_run':
            self.store.recover(caller, run_id)
        elif name == 'cancel_run':
            self.store.cancel(caller, request)
        elif name == 'resume_run':
            self.store.recover(caller, run_id)
            self.store.resume(caller, request, {name: stage['dependsOn'] for name, stage in self.stages.items()})
        else:
            run = self.store.get(caller, run_id)
            prior = self.store.existing_operation(caller, run_id, name, request)
            if prior:
                return self.response(caller, run_id, request['requestId'], prior)
            if request['range']['startFrame'] < run['request']['range']['startFrame'] or request['range']['endFrameExclusive'] > run['request']['range']['endFrameExclusive']:
                raise WorkflowError('invalid_input', 'Tool range must belong to the current run')
            if request['policyRef'] != run['request']['policyRef']:
                raise WorkflowError('invalid_input', 'Tool policy must match the accepted run policy')
            expected = self.stage_request(caller, run_id, name)
            # External references are handles into this run's accepted dependency
            # results; they do not grant authority to read arbitrary files or runs.
            for key, value in request['args'].items():
                if key.endswith('Ref') or key.endswith('Refs') or key.endswith('Digest') or key == 'expectedVersion':
                    if key in expected['args'] and value != expected['args'][key]:
                        raise WorkflowError('source_mismatch', 'Tool reference does not match this run: ' + key)
            operation_id = self.store.register_operation(caller, run_id, name, request, self.stages[name]['dependsOn'])
            return self.response(caller, run_id, request['requestId'], operation_id)
        return self.response(caller, run_id, request['requestId'])

    def _all_outputs(self, results):
        outputs = {}
        for operation in results.values():
            outputs.update((operation['result'] or {}).get('outputs', {}))
        return outputs

    def stage_request(self, caller, run_id, name):
        run = self.store.get(caller, run_id)
        results = self.store.stage_results(caller, run_id)
        out = self._all_outputs(results)
        submit = run['request']
        args, source, doc = submit['args'], run['source'], run['doc']
        ref = lambda key: _opaque(out.get(key, 'missing-' + key))
        snapshot = source['snapshotId'] if source else ref('snapshotRef')
        bounds = submit['range']
        common = {'snapshotRef': snapshot, 'range': bounds}
        if name == 'inspect_clip':
            tool_args = {'assetRef': args['assetRef']}
        elif name == 'prepare_players':
            tool_args = common
        elif name == 'analyze_play':
            tool_args = {**common, 'playerEvidenceRef': ref('playerEvidenceRef'), 'goal': args['goal']}
        elif name == 'prepare_geometry':
            tool_args = {**common, 'playerEvidenceRef': ref('playerEvidenceRef'), 'requestedSpace': 'court_meters',
                         'courtTemplateRef': out.get('courtTemplateRef', 'nba-fullcourt-v1')}
        elif name == 'build_player_annotations':
            tool_args = {'playAnalysisRef': ref('playAnalysisRef'), 'playerEvidenceRef': ref('playerEvidenceRef'),
                         'profile': args['profile'], 'baseDocumentRef': doc}
            if out.get('calibrationRef'):
                tool_args['calibrationRef'] = ref('calibrationRef')
        elif name in {'check_participant_coverage', 'check_projection'}:
            tool_args = {'candidateRef': ref('candidateRef'), 'playerEvidenceRef': ref('playerEvidenceRef'), 'renderPlanRef': ref('renderPlanRef')}
            if name == 'check_participant_coverage':
                tool_args['participantInventoryRef'] = ref('participantInventoryRef')
            elif out.get('calibrationRef'):
                tool_args['calibrationRef'] = ref('calibrationRef')
        elif name == 'preview_projection':
            frames = out.get('previewFrames') or [bounds['startFrame'], bounds['endFrameExclusive'] - 1]
            tool_args = {'candidateRef': ref('candidateRef'), 'renderPlanRef': ref('renderPlanRef'),
                         'frameSelection': list(dict.fromkeys(frames))[:40],
                         'qualityRefs': [ref('coverageRef'), ref('projectionQualityRef')]}
        elif name == 'commit_candidate':
            tool_args = {'candidateRef': ref('candidateRef'), 'candidateDigest': out.get('candidateDigest', '0' * 64),
                         'baseDocumentRef': doc, 'expectedVersion': doc['version'] if doc else 0,
                         'qualityRefs': [ref('coverageRef'), ref('projectionQualityRef')],
                         'reviewRef': ref('reviewRef'), 'acceptancePolicyRef': submit['policyRef']}
        elif name == 'render_projected_video':
            tool_args = {'savedDocumentRef': doc, 'savedDigest': out.get('savedDigest', doc['digest'] if doc else '0' * 64),
                         'fps': args['output']['fps'], 'renderPlanRef': ref('renderPlanRef')}
        else:
            raise WorkflowError('capability_unavailable', 'Tool is not registered')
        request = {'schemaVersion': '1.0', 'requestId': new_id('request'),
                   'idempotencyKey': f'g{run["generation"]}-{name}', 'runId': run_id,
                   'expectedRunRevision': run['revision'], 'range': bounds, 'policyRef': submit['policyRef'], 'args': tool_args}
        if name != 'inspect_clip':
            request.update({'sourceRef': source, 'docRef': doc})
        return request

    def register_stage(self, caller, run_id, name):
        request = self.stage_request(caller, run_id, name)
        validate_request(name, request)
        return self.store.register_operation(caller, run_id, name, request, self.stages[name]['dependsOn'])

    def _skip_reason(self, run, stage):
        if stage == 'render_projected_video' and not run['request']['args']['output']['video']:
            return 'The accepted request does not require video output'
        if stage == 'prepare_geometry':
            if run['request']['args']['geometryRequirement'] == 'required':
                return None
            out = self._all_outputs(self.store.stage_results(run['caller'], run['id']))
            intents = out.get('annotationIntents', [])
            if not any(intent.get('displayIntent') == 'court_projection' for intent in intents) and not out.get('requiresGeometry'):
                return 'No accepted display intent requires court projection'
        return None

    def execute_operation(self, caller, run_id, operation_id):
        run = self.store.get(caller, run_id)
        operation = next(op for op in run['operations'] if op['id'] == operation_id)
        if operation['status'] in {'succeeded', 'skipped'}:
            return
        if operation['status'] == 'running':
            return  # A live worker already owns this operation.
        stage = operation['stage']
        reason = self._skip_reason(run, stage)
        if reason:
            self.store.skip(caller, run_id, operation_id, reason)
            return
        claim = self.store.claim(caller, run_id, operation_id, self.stages[stage]['resource'])
        if not claim:
            return
        run_root = self.store.root / 'runs' / run_id
        attempt_dir = run_root / 'attempts' / claim['attemptId']
        attempt_dir.mkdir(parents=True, exist_ok=False)
        dependencies = {name: op['result'] for name, op in self.store.stage_results(caller, run_id).items()}
        context = ToolContext(self.store, caller, run_id, operation_id, claim['attemptId'], claim['generation'],
                              claim['leaseToken'], run_root, attempt_dir,
                              self.store.verify_asset(caller, run['request']['args']['assetRef']),
                              run['source'], run['doc'], run['policy'], dependencies, run['request'], run['request']['range'])
        context.analysis_revision = claim.get('analysisRevision')
        context.analysis_revision_reason = claim.get('analysisRevisionReason')
        context.prior_analysis_ref = claim.get('priorAnalysisRef')
        context.prior_inventory_ref = claim.get('priorInventoryRef')
        context.repair_feedback_ref = claim.get('repairFeedbackRef')
        stop = threading.Event()

        def renew():
            while not stop.wait(10):
                try:
                    self.store.heartbeat(caller, run_id, operation_id, claim['leaseToken'])
                except WorkflowError:
                    return

        heartbeat = threading.Thread(target=renew, daemon=True, name='workflow-lease')
        heartbeat.start()
        try:
            handler = self.handlers.get(stage)
            if handler is None:
                raise WorkflowError('capability_unavailable', 'No production handler is installed for ' + stage)
            context.checkpoint()
            result = handler(operation['request'], context)
            if not isinstance(result, dict) or not isinstance(result.get('outputs', {}), dict):
                raise WorkflowError('output_invalid', 'Tool must return structured outputs')
            result.setdefault('outputs', {})
            for key in ('sourceRef', 'docRef'):
                if key not in result and key in result['outputs']:
                    result[key] = result['outputs'][key]
            # False checks cannot be turned into acceptance by successful JSON or encoding.
            output = result['outputs']
            quality_error = None
            if stage in {'check_participant_coverage', 'check_projection'} and output.get('pass') is not True:
                code = 'coverage_incomplete' if stage == 'check_participant_coverage' else 'projection_invalid'
                quality_error = WorkflowError(code, 'Independent machine quality gate did not pass')
            if stage == 'preview_projection':
                review = output.get('independentReview')
                if not output.get('reviewRef') or not isinstance(review, dict) or review.get('pass') is not True:
                    quality_error = WorkflowError('projection_invalid', 'Independent visual review did not pass',
                                                   affected_ranges=[run['request']['range']])
            if quality_error:
                self.store.finish(caller, run_id, operation_id, claim['leaseToken'], result, attempt_dir, failure=quality_error)
                if stage == 'preview_projection' and self._try_repair(caller, run_id, operation_id):
                    return 'repair_scheduled'
                self._finish_error(caller, run_id, quality_error, generation=claim['generation'])
                return
            self.store.finish(caller, run_id, operation_id, claim['leaseToken'], result, attempt_dir)
            accepted = self.store.get(caller, run_id)
            if accepted['unmet'] and not accepted['request']['args']['allowPartial']:
                self.store.terminal(caller, run_id, 'needs_attention',
                    WorkflowError('capability_unavailable', 'The accepted request forbids partial delivery and requirements remain unmet'),
                    expected_generation=claim['generation'])
        except Exception as exc:
            if isinstance(exc, WorkflowError):
                error = exc
            elif getattr(exc, 'reason_code', None):
                error = WorkflowError(exc.reason_code, str(exc), getattr(exc, 'retryable', False),
                                      getattr(exc, 'affected_ranges', None), getattr(exc, 'evidence_refs', None),
                                      getattr(exc, 'suggested_action', None))
            else:
                # Avoid leaking a provider response, secret or local path to HTTP.
                error = WorkflowError('output_invalid', 'Tool execution failed; consult the local operation audit', True)
                (attempt_dir / 'error-type.json').write_text(canonical({'exceptionType': type(exc).__name__}), encoding='utf-8')
            diagnostic_recorded = False
            if stage == 'preview_projection' and isinstance(getattr(exc, 'diagnostic_result', None), dict):
                try:
                    current = self.store.get(caller, run_id)
                    current_op = next(op for op in current['operations'] if op['id'] == operation_id)
                    validate_failed_diagnostics(current, current_op, exc.diagnostic_result,
                                                self.store.stage_results(caller, run_id), run_root)
                    self.store.finish(caller, run_id, operation_id, claim['leaseToken'], exc.diagnostic_result,
                                      attempt_dir, failure=error)
                    diagnostic_recorded = True
                except (WorkflowError, OSError, ValueError):
                    with self.store.transaction() as db:
                        self.store.event(db, run_id, 'failed_diagnostics_rejected', {'operationId': operation_id,
                                                                                  'generation': claim['generation']})
            if diagnostic_recorded or self.store.fail(caller, run_id, operation_id, claim['leaseToken'], error):
                self._finish_error(caller, run_id, error, generation=claim['generation'])
        finally:
            stop.set()
            heartbeat.join(timeout=1)

    def _try_repair(self, caller, run_id, operation_id, *, explicit=False):
        run = self.store.get(caller, run_id)
        operation = next(op for op in run['operations'] if op['id'] == operation_id)
        try:
            feedback = validate_feedback(run, operation, operation['result'] or {},
                                         self.store.stage_results(caller, run_id), self.store.root / 'runs' / run_id)
            self.store.schedule_repair(caller, run_id, operation_id, feedback, run['revision'], explicit=explicit)
            return True
        except WorkflowError as error:
            with self.store.transaction() as db:
                self.store.event(db, run_id, 'repair_rejected', {'failedOperationId': operation_id,
                    'generation': operation['generation'], 'reasonCode': error.reason_code, 'message': str(error)})
            if explicit:
                raise
            return False

    def repair(self, caller, run_id, *, recover_diagnostics=False):
        """Trusted local explicit recovery; retains the spent total wall budget."""
        run = self.store.get(caller, run_id)
        failed = [op for op in run['operations'] if op['stage'] == 'preview_projection' and op['valid'] and op['status'] == 'failed']
        if run['status'] != 'needs_attention' or len(failed) != 1:
            raise WorkflowError('version_conflict', 'Feedback recovery requires exactly one current failed visual review')
        operation = failed[0]
        if not operation['result']:
            if not recover_diagnostics:
                raise WorkflowError('invalid_input', 'Legacy failed preview requires the explicit diagnostic recovery option')
            run_root = self.store.root / 'runs' / run_id
            result = recover_preview_result(run_root, operation)
            validate_feedback(run, operation, result, self.store.stage_results(caller, run_id), run_root)
            error = WorkflowError('projection_invalid', 'Independent visual review did not pass', affected_ranges=[run['request']['range']])
            self.store.finish(caller, run_id, operation['id'], None, result, run_root / 'attempts' / operation['attempt'],
                              failure=error, recovery_revision=run['revision'])
        self._try_repair(caller, run_id, operation['id'], explicit=True)
        return self.response(caller, run_id, new_id('request'))

    def import_diagnostics(self, caller, run_id, *, retainer=None):
        """Local audit-only import from the DB-selected failed preview attempt."""
        run = self.store.get(caller, run_id)
        operations = [op for op in run['operations'] if op['stage'] == 'preview_projection'
                      and op['valid'] and op['generation'] == run['generation'] and op['status'] == 'failed']
        if run['status'] != 'needs_attention' or len(operations) != 1:
            raise WorkflowError('version_conflict', 'Diagnostic import requires the current failed preview of an attention-required run')
        operation = operations[0]
        if operation['result']:
            if operation['result'].get('outputs', {}).get('diagnosticOnly') is True:
                return self.response(caller, run_id, new_id('request'))
            raise WorkflowError('version_conflict', 'This failed attempt already has registered results')
        owner = getattr(self.handlers.get('preview_projection'), '__self__', None)
        retainer = retainer or getattr(owner, 'retain_provider_failure_diagnostics', None)
        if not callable(retainer):
            raise WorkflowError('capability_unavailable', 'The trusted provider diagnostic adapter is unavailable')
        run_root = self.store.root / 'runs' / run_id
        attempt_dir = (run_root / 'attempts' / operation['attempt']).resolve()
        if not attempt_dir.is_relative_to(run_root.resolve()) or not attempt_dir.is_dir():
            raise WorkflowError('source_mismatch', 'The failed attempt directory is unavailable')
        dependencies = self.store.stage_results(caller, run_id)
        context = ToolContext(self.store, caller, run_id, operation['id'], operation['attempt'], run['generation'],
            'diagnostic-import-no-lease', run_root, attempt_dir,
            self.store.verify_asset(caller, run['request']['args']['assetRef']), run['source'], run['doc'], run['policy'],
            {key: value['result'] for key, value in dependencies.items()}, run['request'], run['request']['range'])
        info = operation['error'] or run['error']
        error = WorkflowError(info['reasonCode'], info['message'], info['retryable'], info['affectedRanges'],
                              info['evidenceRefs'], info['suggestedAction'])
        result = retainer(context, error=error)
        validate_failed_diagnostics(run, operation, result, dependencies, run_root)
        self.store.finish(caller, run_id, operation['id'], None, result, attempt_dir,
                          failure=error, recovery_revision=run['revision'])
        return self.response(caller, run_id, new_id('request'))

    def _finish_error(self, caller, run_id, error, *, generation=None):
        run = self.store.get(caller, run_id)
        results = self.store.stage_results(caller, run_id)
        delivered = 'commit_candidate' in results
        hard_failure = run['request']['args']['geometryRequirement'] == 'required' and error.reason_code in {'geometry_unreliable', 'capability_unavailable'}
        if delivered and run['request']['args']['allowPartial'] and not hard_failure:
            status = 'partial'
        elif error.reason_code in {'capability_unavailable', 'provider_unavailable', 'source_mismatch', 'version_conflict',
                                    'geometry_unreliable', 'coverage_incomplete', 'projection_invalid', 'budget_exhausted',
                                    'budget_unmeasurable', 'tracking_gap', 'identity_conflict'}:
            status = 'needs_attention'
        else:
            status = 'failed'
        self.store.terminal(caller, run_id, status, error, expected_generation=generation)

    def run(self, caller, run_id):
        """Run ready stages; persistent operations, not an in-memory job, own execution."""
        self.store.recover(caller, run_id)
        try:
            while True:
                self.store.recover(caller, run_id)
                run = self.store.get(caller, run_id)
                if run['status'] not in ACTIVE:
                    return self.response(caller, run_id, new_id('request'))
                if time.time() >= run['deadline']:
                    raise WorkflowError('budget_exhausted', 'Workflow wall time budget has elapsed')
                latest = {}
                for op in run['operations']:
                    if op['valid']:
                        latest[op['stage']] = op
                failed = next((op for op in latest.values() if op['status'] == 'failed'), None)
                if failed:
                    if failed['stage'] == 'preview_projection' and failed['result'] and self._try_repair(caller, run_id, failed['id']):
                        continue
                    info = failed['error']
                    raise WorkflowError(info['reasonCode'], info['message'], info['retryable'], info['affectedRanges'], info['evidenceRefs'], info['suggestedAction'])
                complete = {name for name, op in latest.items() if op['status'] in {'succeeded', 'skipped'}}
                if run['unmet'] and not run['request']['args']['allowPartial']:
                    raise WorkflowError('capability_unavailable', 'The request forbids partial delivery and requirements remain unmet')
                if complete == set(self.stages):
                    self.store.terminal(caller, run_id, 'partial' if run['unmet'] else 'succeeded')
                    continue
                ready = [name for name, stage in self.stages.items() if name not in complete and set(stage['dependsOn']) <= complete]
                operation_ids = []
                for name in ready:
                    op = latest.get(name)
                    if op and op['status'] in ACTIVE:
                        operation_ids.append(op['id'])
                    else:
                        # Registration is serialized with a fresh expected revision;
                        # independent completion never compares the global revision.
                        try:
                            operation_ids.append(self.register_stage(caller, run_id, name))
                        except WorkflowError as exc:
                            if exc.reason_code == 'version_conflict':
                                continue
                            raise
                if operation_ids:
                    with ThreadPoolExecutor(max_workers=2, thread_name_prefix='workflow-stage') as pool:
                        futures = [pool.submit(self.execute_operation, caller, run_id, item) for item in operation_ids]
                        for future in futures:
                            future.result()
                # Resource leases can belong to another runner. A bounded wait avoids
                # spin while keeping cancellation and wall-clock deadlines responsive.
                time.sleep(0.05)
        except WorkflowError as error:
            self._finish_error(caller, run_id, error, generation=run['generation'] if 'run' in locals() else None)
        return self.response(caller, run_id, new_id('request'))


def production_handlers(*, detector_weights=None, detector_python=None):
    try:
        from agent_tactics_tools import build_tool_handlers
    except ImportError:
        return {}
    # Local trusted startup configuration; these fields are never accepted in a
    # workflow envelope or an HTTP request.
    return build_tool_handlers(detector_weights=detector_weights or os.environ.get('AGENT_TACTICS_DETECTOR_WEIGHTS'),
                               detector_python=detector_python or os.environ.get('AGENT_TACTICS_DETECTOR_PYTHON'))
