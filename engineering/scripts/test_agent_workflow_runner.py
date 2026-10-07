"""Persistence/authority tests. Synthetic handlers are not video-quality evidence."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from agent_workflow_contract import (ROOT, WorkflowError, validate_request, request_schema, _validate,
                                     canonical, digest, native_digest, ARG_SCHEMAS)
from agent_workflow_runner import WorkflowRunner
from agent_workflow_store import WorkflowStore, file_digest

FIXTURES = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures' / 'agent-workflow'


class WorkflowFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.video = self.root / 'synthetic-source.dat'
        self.video.write_bytes(b'synthetic persistence fixture, not a decoded video')
        self.store = WorkflowStore(self.root / 'state')
        self.mapping = [{'frame': i, 'time': i * 0.04, 'sourceFrame': 900 + i * 2, 'sourceTime': 36 + i * 0.08} for i in range(5)]
        self.store.register_asset('alice', 'asset-a', {'videoPath': str(self.video), 'sourceFrameMapping': self.mapping})
        self.request = json.loads((FIXTURES / 'canonical-submit.json').read_text(encoding='utf-8'))
        self.request['args']['assetRef'] = 'asset-a'
        self.request['range'] = {'startFrame': 0, 'endFrameExclusive': 5}
        self.calls = {}
        self.policy = json.loads((ROOT / 'policy.json').read_text(encoding='utf-8'))
        self.runner = WorkflowRunner(self.store, self.handlers(), self.policy)

    def handlers(self):
        def handle(request, ctx):
            stage = next(name for name in ARG_SCHEMAS if request['idempotencyKey'].endswith('-' + name))
            self.calls[stage] = self.calls.get(stage, 0) + 1
            path = ctx.attempt_dir / (stage + '.json')
            path.write_text(canonical({'testOnly': True, 'stage': stage}), encoding='utf-8')
            ref = {'path': str(path), 'sha256': file_digest(path)}
            result = {'outputs': {}, 'artifacts': [{'path': str(path), 'kind': stage, 'mediaType': 'application/json'}]}
            out = result['outputs']
            source = {'videoSha256': ctx.asset['videoSha256'], 'frameMappingDigest': ctx.asset['frameMappingDigest'],
                      'trackingFingerprint': None, 'trackingRevision': None, 'snapshotId': 'snapshot-initial'}
            if stage == 'inspect_clip':
                out['snapshotRef'] = ref
                result['sourceRef'] = source
            if stage == 'prepare_players':
                source.update({'trackingFingerprint': 'synthetic-tracking', 'trackingRevision': 'test-only-1', 'snapshotId': 'snapshot-derived'})
                result['sourceRef'] = source
                result['docRef'] = {'documentId': 'doc-test', 'version': 0, 'digest': digest({'testOnly': True}), 'storeRef': 'run-local'}
                out.update({'playerEvidenceRef': ref, 'baseDocumentRef': ref})
            if stage == 'analyze_play':
                ctx.model_call()
                out.update({'playAnalysisRef': ref, 'participantInventoryRef': ref, 'annotationIntents': [],
                            'analysisRevision': ctx.analysis_revision})
            if stage == 'build_player_annotations':
                out.update({'candidateRef': ref, 'candidateDigest': digest({'candidate': True}), 'renderPlanRef': ref})
            if stage == 'check_participant_coverage':
                out.update({'coverageRef': ref, 'pass': True})
            if stage == 'check_projection':
                out.update({'projectionQualityRef': ref, 'pass': True})
            if stage == 'preview_projection':
                ctx.model_call()
                out.update({'reviewRef': ref, 'independentReview': {'pass': True}})
            if stage == 'commit_candidate':
                with ctx.side_effect_guard():
                    (ctx.run_root / 'test-save-receipt.json').write_text(canonical({'version': 1}), encoding='utf-8')
                result['docRef'] = {**ctx.doc_ref, 'version': 1, 'digest': digest({'candidate': True})}
                out.update({'savedDocumentRef': result['docRef'], 'savedDigest': result['docRef']['digest']})
            if stage == 'render_projected_video':
                out.update({'videoRef': ref, 'decodeReportRef': ref})
            return result
        return {name: handle for name in ('inspect_clip', 'prepare_players', 'prepare_geometry', 'analyze_play',
            'build_player_annotations', 'check_participant_coverage', 'check_projection', 'preview_projection',
            'commit_candidate', 'render_projected_video')}

    def submit(self):
        return self.runner.call('submit_workflow', 'alice', self.request)['runId']

    def control(self, run_id, action, key='control-1', **args):
        return {'schemaVersion': '1.0', 'requestId': 'req-control', 'idempotencyKey': key, 'runId': run_id,
                'expectedRunRevision': self.store.get('alice', run_id)['revision'], 'args': {'reason': 'test', **args}}

    def stage(self, run_id, name):
        operation_id = self.runner.register_stage('alice', run_id, name)
        self.runner.execute_operation('alice', run_id, operation_id)
        return operation_id


class ContractTests(WorkflowFixture):
    def test_canonical_example_and_unknown_fields(self):
        example = json.loads((FIXTURES / 'canonical-submit.json').read_text(encoding='utf-8'))
        validate_request('submit_workflow', example)
        with self.assertRaises(WorkflowError):
            validate_request('submit_workflow', json.loads((FIXTURES / 'invalid-submit-unknown-field.json').read_text(encoding='utf-8')))
        for mutator in (lambda p: p.update({'assetRef': 'wrong-level'}),
                        lambda p: p['args'].update({'path': 'C:/private'}),
                        lambda p: p['args']['output'].update({'force': True}),
                        lambda p: p.update({'runId': 'not-created'}),
                        lambda p: p['range'].update({'startFrame': True}),
                        lambda p: p['range'].update({'endFrameExclusive': 570})):
            bad = deepcopy(example); mutator(bad)
            with self.assertRaises(WorkflowError):
                validate_request('submit_workflow', bad)
        bad = deepcopy(example); bad['schemaVersion'] = '2.0'
        with self.assertRaisesRegex(WorkflowError, 'Only schemaVersion'):
            validate_request('submit_workflow', bad)
        with self.assertRaises(RuntimeError):
            _validate({}, {'if': {}})

    def test_machine_schemas_are_in_sync(self):
        for name in ARG_SCHEMAS:
            self.assertEqual(json.loads((ROOT / 'schemas' / (name + '.schema.json')).read_text()), request_schema(name))

    def test_nonidentity_mapping_and_native_float_digest(self):
        asset = self.store.asset('alice', 'asset-a')
        self.assertEqual(asset['sourceFrameMapping'][2]['sourceFrame'], 904)
        self.assertEqual(asset['frameMappingDigest'], native_digest(self.mapping))
        mapping = [{'frame': 0, 'time': 0.0, 'sourceFrame': 10, 'sourceTime': 0.0000001}]
        self.assertNotEqual(native_digest(mapping), digest(mapping))
        self.assertEqual(native_digest(mapping), native_digest([{**mapping[0], 'time': 0}]))

    def test_asset_hash_mismatch_and_caller_authority(self):
        with self.assertRaises(WorkflowError) as error:
            self.store.register_asset('alice', 'invalid', {'videoPath': str(self.video), 'sourceFrameMapping': self.mapping, 'videoSha256': '0' * 64})
        self.assertEqual(error.exception.reason_code, 'source_mismatch')
        run_id = self.submit()
        with self.assertRaises(WorkflowError):
            self.store.get('bob', run_id)
        with self.assertRaises(WorkflowError):
            self.store.asset('bob', 'asset-a')


class LifecycleTests(WorkflowFixture):
    def test_complete_and_duplicate_submit_never_saves_or_renders_again(self):
        run_id = self.submit()
        result = self.runner.run('alice', run_id)
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(result['budget']['modelCalls'], 2)
        self.assertIsNone(result['budget']['costUsd'])
        self.assertEqual(self.calls['commit_candidate'], 1)
        self.assertEqual(self.calls['render_projected_video'], 1)
        self.request['requestId'] = 'new-correlation'
        self.assertEqual(self.submit(), run_id)
        self.runner.run('alice', run_id)
        self.assertEqual(self.calls['commit_candidate'], 1)
        self.assertEqual(self.calls['render_projected_video'], 1)
        restarted = WorkflowRunner(WorkflowStore(self.store.root), self.handlers())
        self.assertEqual(restarted.response('alice', run_id, 'read')['status'], 'succeeded')
        self.assertNotIn(str(self.root), canonical(result))
        before = result['budget']['wallSeconds']
        time.sleep(0.01)
        self.assertEqual(self.runner.response('alice', run_id, 'read')['budget']['wallSeconds'], before)

    def test_same_key_different_request_and_caller_scope(self):
        run_id = self.submit()
        self.request['args']['goal'] = 'Another goal'
        with self.assertRaises(WorkflowError) as error:
            self.submit()
        self.assertEqual(error.exception.reason_code, 'idempotency_conflict')
        self.store.register_asset('bob', 'asset-a', {'videoPath': str(self.video), 'sourceFrameMapping': self.mapping})
        other = self.runner.call('submit_workflow', 'bob', self.request)
        self.assertNotEqual(other['runId'], run_id)

    def test_optimistic_registration_and_independent_completion(self):
        run_id = self.submit()
        for name in ('inspect_clip', 'prepare_players', 'analyze_play', 'prepare_geometry', 'build_player_annotations'):
            self.stage(run_id, name)
        first = self.runner.stage_request('alice', run_id, 'check_participant_coverage')
        second = self.runner.stage_request('alice', run_id, 'check_projection')
        one = self.runner.call('check_participant_coverage', 'alice', first)['operationId']
        with self.assertRaises(WorkflowError) as error:
            self.runner.call('check_projection', 'alice', second)
        self.assertEqual(error.exception.reason_code, 'version_conflict')
        second['expectedRunRevision'] = self.store.get('alice', run_id)['revision']
        two = self.runner.call('check_projection', 'alice', second)['operationId']
        barrier = threading.Barrier(2)
        handlers = self.runner.handlers.copy()
        for name in ('check_participant_coverage', 'check_projection'):
            original = handlers[name]
            def concurrent(request, ctx, handler=original):
                barrier.wait(timeout=3)
                return handler(request, ctx)
            self.runner.handlers[name] = concurrent
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.runner.execute_operation, 'alice', run_id, op) for op in (one, two)]
            for future in futures:
                future.result(timeout=10)
        states = self.store.stage_results('alice', run_id)
        self.assertEqual(states['check_participant_coverage']['status'], 'succeeded')
        self.assertEqual(states['check_projection']['status'], 'succeeded')

    def test_cancel_late_output_cannot_register_or_save_and_resume_changes_generation(self):
        run_id = self.submit()
        entered, release = threading.Event(), threading.Event()
        saved = []
        original = self.runner.handlers['inspect_clip']
        def slow(request, ctx):
            result = original(request, ctx)
            entered.set(); release.wait(timeout=5)
            with ctx.side_effect_guard():
                saved.append(True)
            return result
        self.runner.handlers['inspect_clip'] = slow
        op_id = self.runner.register_stage('alice', run_id, 'inspect_clip')
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.runner.execute_operation, 'alice', run_id, op_id)
            self.assertTrue(entered.wait(timeout=5))
            cancel = self.control(run_id, 'cancel')
            cancelled = self.runner.call('cancel_run', 'alice', cancel)
            release.set(); future.result(timeout=10)
        self.assertEqual(cancelled['status'], 'cancelled')
        self.assertFalse(saved)
        self.assertEqual(self.store.get('alice', run_id)['artifacts'], [])
        self.assertEqual(self.runner.call('cancel_run', 'alice', cancel)['status'], 'cancelled')
        generation = self.store.get('alice', run_id)['generation']
        self.runner.handlers['inspect_clip'] = original
        self.runner.call('resume_run', 'alice', self.control(run_id, 'resume', 'resume-1'))
        self.assertGreater(self.store.get('alice', run_id)['generation'], generation)
        self.assertEqual(self.runner.run('alice', run_id)['status'], 'succeeded')

    def test_expired_worker_restart_reuses_completed_stages(self):
        run_id = self.submit()
        self.stage(run_id, 'inspect_clip')
        operation = self.runner.register_stage('alice', run_id, 'prepare_players')
        lease = self.store.claim('alice', run_id, operation, 'gpu', lease_seconds=0.01)
        time.sleep(0.02)
        restarted_store = WorkflowStore(self.store.root)
        self.assertTrue(restarted_store.recover('alice', run_id))
        self.runner = WorkflowRunner(restarted_store, self.handlers())
        self.runner.call('resume_run', 'alice', self.control(run_id, 'resume', 'resume-crash'))
        result = self.runner.run('alice', run_id)
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(self.calls['inspect_clip'], 1)
        with self.assertRaises(WorkflowError):
            self.store.checkpoint('alice', run_id, operation, lease['leaseToken'])

    def test_resume_detects_changed_original_baseline(self):
        baseline = self.root / 'draft.json'; baseline.write_text('{}')
        self.store.register_asset('alice', 'baseline-asset', {'videoPath': str(self.video), 'sourceFrameMapping': self.mapping, 'baseDocumentPath': str(baseline)})
        self.request['args']['assetRef'] = 'baseline-asset'
        run_id = self.submit()
        self.runner.call('cancel_run', 'alice', self.control(run_id, 'cancel'))
        baseline.write_text('{"version":2}')
        with self.assertRaises(WorkflowError) as error:
            self.runner.call('resume_run', 'alice', self.control(run_id, 'resume', 'resume-changed'))
        self.assertEqual(error.exception.reason_code, 'version_conflict')

    def test_budget_and_quality_failure_prevent_commit(self):
        self.policy['maxModelCalls'] = 1
        run_id = self.submit()
        result = self.runner.run('alice', run_id)
        self.assertEqual(result['status'], 'needs_attention', result)
        self.assertEqual(result['error']['reasonCode'], 'budget_exhausted')
        self.assertNotIn('commit_candidate', self.calls)

    def test_monetary_budget_unknown_is_not_zero(self):
        self.policy['maxCostUsd'] = 1.0
        run_id = self.submit()
        result = self.runner.run('alice', run_id)
        self.assertEqual(result['error']['reasonCode'], 'budget_unmeasurable')
        self.assertEqual(result['budget']['modelCalls'], 0)
        self.assertIsNone(result['budget']['costUsd'])

    def test_wall_budget_includes_queue(self):
        self.policy['maxWallSeconds'] = 0.001
        run_id = self.submit()
        time.sleep(0.01)
        result = self.runner.run('alice', run_id)
        self.assertEqual(result['error']['reasonCode'], 'budget_exhausted')
        self.assertFalse(self.calls)

    def test_false_quality_cannot_be_adopted(self):
        def failed(request, ctx):
            return {'outputs': {'pass': False, 'missing': ['visible-defender']}}
        self.runner.handlers['check_participant_coverage'] = failed
        run_id = self.submit()
        result = self.runner.run('alice', run_id)
        self.assertEqual(result['error']['reasonCode'], 'coverage_incomplete')
        self.assertNotIn('commit_candidate', self.calls)

    def test_unapproved_partial_stops_before_commit(self):
        original = self.runner.handlers['analyze_play']
        def limited(request, ctx):
            result = original(request, ctx)
            result['unmetRequirements'] = ['requested continuous ground route is unavailable']
            return result
        self.runner.handlers['analyze_play'] = limited
        self.request['args']['allowPartial'] = False
        result = self.runner.run('alice', self.submit())
        self.assertEqual(result['status'], 'needs_attention')
        self.assertNotIn('commit_candidate', self.calls)
        self.assertNotIn('render_projected_video', self.calls)

    def test_advanced_step_calls_cannot_bypass_partial_policy(self):
        original = self.runner.handlers['analyze_play']
        def limited(request, ctx):
            result = original(request, ctx)
            result['unmetRequirements'] = ['an explicitly required result is unavailable']
            return result
        self.runner.handlers['analyze_play'] = limited
        self.request['args']['allowPartial'] = False
        run_id = self.submit()
        for stage in ('inspect_clip', 'prepare_players', 'analyze_play'):
            self.stage(run_id, stage)
        self.assertEqual(self.store.get('alice', run_id)['status'], 'needs_attention')
        with self.assertRaises(WorkflowError):
            self.runner.register_stage('alice', run_id, 'prepare_geometry')
        self.assertNotIn('commit_candidate', self.calls)

    def test_resume_render_preserves_upstream_unmet_requirements(self):
        original = self.runner.handlers['analyze_play']
        def limited(request, ctx):
            result = original(request, ctx)
            result['unmetRequirements'] = ['requested continuous ground route is unavailable']
            return result
        self.runner.handlers['analyze_play'] = limited
        run_id = self.submit()
        result = self.runner.run('alice', run_id)
        self.assertEqual(result['status'], 'partial')
        self.runner.call('resume_run', 'alice', self.control(run_id, 'resume', 'retry-render', retryStages=['render_projected_video']))
        result = self.runner.run('alice', run_id)
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['unmetRequirements'], ['requested continuous ground route is unavailable'])
        self.assertEqual(self.calls['analyze_play'], 1)
        self.assertEqual(self.calls['commit_candidate'], 1)

    def test_reanalysis_revision_and_prior_inventory_survive_invalidation(self):
        run_id = self.submit()
        for stage in ('inspect_clip', 'prepare_players', 'analyze_play'):
            self.stage(run_id, stage)
        previous = self.store.stage_results('alice', run_id)['analyze_play']
        inventory = previous['result']['outputs']['participantInventoryRef']
        before = Path(inventory['path']).read_bytes()
        self.runner.call('cancel_run', 'alice', self.control(run_id, 'cancel'))
        # Simulate a previously published database created before the reservation
        # table existed. Its historical result revision must still be honored.
        with self.store.transaction() as db:
            db.execute('DELETE FROM analysis_revisions WHERE run_id=?', (run_id,))
        resume = self.control(run_id, 'resume', 'reanalysis-1', retryStages=['analyze_play'])
        resume['args']['reason'] = 'Correct evidence bounds without deleting the prior participant inventory'
        self.runner.call('resume_run', 'alice', resume)
        seen = {}
        original = self.runner.handlers['analyze_play']
        def revised(request, ctx):
            seen.update({'revision': ctx.analysis_revision, 'reason': ctx.analysis_revision_reason,
                         'prior': ctx.prior_inventory_ref})
            return original(request, ctx)
        self.runner.handlers['analyze_play'] = revised
        self.stage(run_id, 'analyze_play')
        current = self.store.stage_results('alice', run_id)['analyze_play']
        self.assertEqual(current['result']['outputs']['analysisRevision'], 2)
        self.assertEqual(seen['revision'], 2)
        self.assertEqual(seen['reason'], resume['args']['reason'])
        self.assertEqual(seen['prior'], inventory)
        self.assertEqual(Path(inventory['path']).read_bytes(), before)
        historical = next(op for op in self.store.get('alice', run_id)['operations'] if op['id'] == previous['id'])
        self.assertEqual(historical['status'], 'succeeded')
        self.assertEqual(historical['valid'], 0)
        self.assertEqual(self.store.get('alice', run_id)['budget']['modelCalls'], 2)

    def test_resume_budget_preserves_calls_and_audits_previous_wall_time(self):
        run_id = self.submit()
        for stage in ('inspect_clip', 'prepare_players', 'analyze_play'):
            self.stage(run_id, stage)
        self.runner.call('cancel_run', 'alice', self.control(run_id, 'cancel'))
        with self.store.transaction() as db:
            row = self.store._run(db, 'alice', run_id)
            budget = json.loads(row['budget']); budget['wallSeconds'] = 233.5
            db.execute('UPDATE runs SET budget=? WHERE id=?', (canonical(budget), run_id))
        self.runner.call('resume_run', 'alice', self.control(run_id, 'resume', 'fresh-wall', retryStages=['analyze_play']))
        run = self.store.get('alice', run_id)
        self.assertEqual(run['budget']['modelCalls'], 1)
        self.assertLess(run['budget']['wallSeconds'], 5)
        with closing(self.store.connect()) as db:
            event = db.execute("SELECT data FROM events WHERE run_id=? AND kind='resumed' ORDER BY id DESC LIMIT 1", (run_id,)).fetchone()
        self.assertEqual(json.loads(event['data'])['previousWallSeconds'], 233.5)

    def test_crashed_analysis_reservation_is_not_reused(self):
        run_id = self.submit()
        self.stage(run_id, 'inspect_clip'); self.stage(run_id, 'prepare_players')
        operation = self.runner.register_stage('alice', run_id, 'analyze_play')
        claim = self.store.claim('alice', run_id, operation, 'api', lease_seconds=0.001)
        self.assertEqual(claim['analysisRevision'], 1)
        time.sleep(0.01)
        self.store.recover('alice', run_id)
        self.runner.call('resume_run', 'alice', self.control(run_id, 'resume', 'after-analysis-crash', retryStages=['analyze_play']))
        self.stage(run_id, 'analyze_play')
        self.assertEqual(self.store.stage_results('alice', run_id)['analyze_play']['result']['outputs']['analysisRevision'], 2)

    def test_advanced_tool_failure_is_visible_in_run_response(self):
        def missing(request, ctx):
            raise WorkflowError('capability_unavailable', 'test decoder unavailable')
        self.runner.handlers['inspect_clip'] = missing
        run_id = self.submit()
        self.stage(run_id, 'inspect_clip')
        result = self.runner.response('alice', run_id, 'read-failure')
        self.assertEqual(result['status'], 'needs_attention')
        self.assertEqual(result['error']['reasonCode'], 'capability_unavailable')

    def test_source_changes_reject_already_running_operation(self):
        run_id = self.submit()
        self.stage(run_id, 'inspect_clip')
        operation = self.runner.register_stage('alice', run_id, 'prepare_players')
        lease = self.store.claim('alice', run_id, operation)
        with self.store.transaction() as db:
            row = self.store._run(db, 'alice', run_id)
            source = json.loads(row['source']); source['snapshotId'] = 'new-snapshot'
            db.execute('UPDATE runs SET source=? WHERE id=?', (canonical(source), run_id))
        with self.assertRaises(WorkflowError) as error:
            self.store.checkpoint('alice', run_id, operation, lease['leaseToken'])
        self.assertEqual(error.exception.reason_code, 'source_mismatch')

    def test_gpu_lease_shared_between_runners(self):
        first = self.submit(); self.stage(first, 'inspect_clip')
        a = self.runner.register_stage('alice', first, 'prepare_players')
        self.request['idempotencyKey'] = 'second-run'
        second = self.submit(); self.stage(second, 'inspect_clip')
        b = self.runner.register_stage('alice', second, 'prepare_players')
        self.assertTrue(self.store.claim('alice', first, a, 'gpu'))
        self.assertIsNone(WorkflowStore(self.store.root).claim('alice', second, b, 'gpu'))
        self.runner.call('cancel_run', 'alice', self.control(first, 'cancel'))
        self.assertTrue(self.store.claim('alice', second, b, 'gpu'))


if __name__ == '__main__':
    unittest.main()
