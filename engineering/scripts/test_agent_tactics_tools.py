"""Contract tests use synthetic frames and an explicitly injected test provider.

These validate source/adapter and acceptance boundaries, not basketball accuracy.
Real provider/video acceptance is recorded separately by the workflow runner.
"""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import json
import shutil
import tempfile
import unittest

from agent_tactics_tools import (TacticsToolset, TOOL_VERSION, read_ref, ref, _repair_midpoint_frames,
                                _terminal_event_response, _append_diagnostic, review_schema)
from player_tracking_adapter import (AdapterError, inspect_video, prepare_player_evidence,
                                     write_json, file_sha256)


def make_video(path, frames=12, rate=30):
    import av
    import numpy as np
    with av.open(str(path), mode='w') as container:
        stream = container.add_stream('libx264', rate=rate)
        stream.width, stream.height, stream.pix_fmt = 320, 180, 'yuv420p'
        for index in range(frames):
            pixels = np.full((180, 320, 3), 40 + index, dtype=np.uint8)
            frame = av.VideoFrame.from_ndarray(pixels, format='rgb24')
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def tracked_fixture(inspection):
    clip = deepcopy(inspection['clip'])
    clip['tracking_fingerprint'] = 'a' * 64; clip['tracking_revision'] = 'test-detection-v1'
    for record in clip['frames']:
        record['tracks'] = [[40, 40, 70, 100, 1, .9, 2], [130, 40, 160, 100, 2, .9, 2],
                            [220, 40, 250, 100, 3, .9, 2]]
        record['track_evidence'] = {str(i): {'source': 'detection', 'identity_verified': False} for i in (1, 2, 3)}
    return clip


class TestContext:
    def __init__(self, directory, asset, request):
        self.run_root = directory / 'run'; self.run_root.mkdir()
        self.asset = asset; self.request = request; self.range = request['range']
        self.run_id = 'run-test'; self.generation = 1; self.policy = {}
        self.analysis_revision = 1; self.analysis_revision_reason = 'initial_analysis'
        self.prior_analysis_ref = None; self.prior_inventory_ref = None
        self.repair_feedback_ref = None
        self.dependencies = {}; self.calls = 0; self.cancelled = False; self.saved_guard = 0

    def stage(self, stage):
        self.operation_id = 'op-' + stage; self.attempt_id = 'attempt-' + stage
        self.attempt_dir = self.run_root / self.attempt_id; self.attempt_dir.mkdir(exist_ok=True)

    def checkpoint(self):
        if self.cancelled:
            raise AdapterError('cancelled', 'Cancelled test operation')

    def model_call(self, estimated_cost_usd=None):
        self.checkpoint(); self.calls += 1

    @contextmanager
    def side_effect_guard(self):
        self.checkpoint(); self.saved_guard += 1
        yield


class InjectedTestProvider:
    def __init__(self, fail_review=False):
        self.calls = []; self.fail_review = fail_review

    def status(self):
        return {'available': True, 'provider': 'explicit-test-double', 'model': 'no-real-inference'}

    def generate(self, *, job, directory, schema, result, images, prompt):
        self.calls.append({'directory': directory, 'images': images, 'prompt': prompt})
        if 'independent-review' in directory.name:
            return {'verdict': 'fail' if self.fail_review else 'pass', 'checks': {key: not self.fail_review for key in
                    ('participantCoverage', 'correctPeople', 'positions', 'observedActionsOnly', 'readability', 'semantics')},
                    'summary': 'Synthetic provider contract only', 'issues': [], 'unmetRequirements': []}
        return {'outcome': 'candidate', 'summary': 'Synthetic adapter contract only', 'issues': [], 'unmetRequirements': [],
                'phases': [{'phaseId': 'phase-test', 'title': 'Synthetic phase', 'startFrame': 0, 'endFrameExclusive': 12,
                            'evidenceFrames': [0], 'participants': [{'playerId': pid, 'role': role, 'evidenceFrames': [0],
                            'annotationType': 'spotlight', 'annotationFrame': 0, 'explanation': 'Synthetic test observation'}
                            for pid, role in [('T1', 'ball_handler'), ('T2', 'spacer'), ('T3', 'primary_defender')]]}]}


def terminal_events(response):
    return [{'type': 'thread.started', 'thread_id': 'explicit-test-thread'},
            {'type': 'item.completed', 'item': {'type': 'error', 'message': 'Synthetic transport fallback'}},
            {'type': 'turn.started'},
            {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': json.dumps(response)}},
            {'type': 'turn.completed', 'usage': {'input_tokens': 12, 'output_tokens': 8}}]


class TerminalFailureTestProvider(InjectedTestProvider):
    """A completed event does not mean the provider process completed normally."""
    timeout = 180

    def __init__(self, fail_review=True, callback=None):
        super().__init__(fail_review)
        self.callback = callback

    def generate(self, **kwargs):
        response = super().generate(**kwargs)
        if 'independent-review' in kwargs['directory'].name:
            path = kwargs['directory'] / 'events.jsonl'
            path.write_text('\n'.join(json.dumps(event) for event in terminal_events(response)) + '\n', encoding='utf-8')
            if self.callback:
                self.callback()
            raise ValueError('Agent 超时：synthetic provider exited without a result receipt')
        return response


class TerminalEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tactics-terminal-')
        self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name)
        self.response = {'verdict': 'fail', 'checks': {key: False for key in
            ('participantCoverage', 'correctPeople', 'positions', 'observedActionsOnly', 'readability', 'semantics')},
            'summary': 'Synthetic failure evidence', 'issues': [], 'unmetRequirements': []}

    def write_events(self, events):
        (self.root / 'events.jsonl').write_text('\n'.join(json.dumps(event) for event in events) + '\n', encoding='utf-8')

    def test_only_complete_unique_schema_valid_terminal_response_is_evidence(self):
        valid = terminal_events(self.response)
        self.write_events(valid)
        result, audit = _terminal_event_response(self.root, review_schema())
        self.assertEqual(result, self.response)
        self.assertEqual(audit['status'], 'complete_schema_valid_message')
        self.assertEqual(audit['usage'], {'input_tokens': 12, 'output_tokens': 8})
        invalid_schema = deepcopy(valid); invalid_schema[-2]['item']['text'] = '{"verdict":"pass"}'
        cases = [valid[:-1], valid + [valid[-1]], valid[:-1] + [valid[-2], valid[-1]],
                 valid + [{'type': 'error'}], valid[1:], invalid_schema,
                 valid[:3] + [{'type': 'item.completed', 'item': {'type': 'command_execution'}}] + valid[3:],
                 valid[:3] + [{'type': 'turn.failed'}] + valid[3:]]
        for index, events in enumerate(cases):
            with self.subTest(case=index):
                self.write_events(events)
                response, audit = _terminal_event_response(self.root, review_schema())
                self.assertIsNone(response)
                self.assertNotEqual(audit['status'], 'complete_schema_valid_message')

    def test_malformed_records_and_duplicate_json_keys_are_rejected(self):
        for raw in ('{"type":"thread.started","type":"turn.completed"}\n', '{', 'null\n'):
            with self.subTest(raw=raw):
                (self.root / 'events.jsonl').write_text(raw, encoding='utf-8')
                response, _ = _terminal_event_response(self.root, review_schema())
                self.assertIsNone(response)
        events = terminal_events(self.response)
        events[-2]['item']['text'] = '{"verdict":"pass","verdict":"fail"}'
        self.write_events(events)
        response, audit = _terminal_event_response(self.root, review_schema())
        self.assertIsNone(response); self.assertEqual(audit['status'], 'terminal_schema_invalid')

    def test_diagnostic_creation_reuses_identical_bytes_and_never_overwrites(self):
        path = _append_diagnostic(self.root / 'audit.json', {'executionAccepted': False})
        before = path.read_bytes(); timestamp = path.stat().st_mtime_ns
        self.assertEqual(_append_diagnostic(path, {'executionAccepted': False}), path)
        self.assertEqual(path.stat().st_mtime_ns, timestamp)
        with self.assertRaisesRegex(AdapterError, 'cannot be overwritten'):
            _append_diagnostic(path, {'executionAccepted': True})
        self.assertEqual(path.read_bytes(), before)


class ExcludedDriftTestProvider(InjectedTestProvider):
    """The model explicitly identifies T3 only before an undetected ID switch."""
    def generate(self, **kwargs):
        response = super().generate(**kwargs)
        if 'phases' in response:
            participant = response['phases'][0]['participants'][2]
            participant.update(evidenceFrames=[0, 2], explanation=
                'T3 is this defender at frames 0 and 2; the same ID at frames 7 and 11 is another player and is excluded.')
        return response


class SplitRepairTestProvider(InjectedTestProvider):
    def generate(self, **kwargs):
        response = super().generate(**kwargs)
        if 'phases' in response:
            first = response['phases'][0]
            second = deepcopy(first)
            first.update(phaseId='phase-repaired-early', endFrameExclusive=6)
            second.update(phaseId='phase-repaired-late', startFrame=6, evidenceFrames=[7])
            for person in second['participants']:
                person.update(evidenceFrames=[7], annotationFrame=7)
            response['phases'].append(second)
        return response


class SourceAdapterFixture:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tactics-tools-')
        self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name).resolve()
        self.video = self.root / 'source.mp4'; make_video(self.video)
        self.inspection = inspect_video(self.video); self.clip = tracked_fixture(self.inspection)


class SourceAdapterTests(SourceAdapterFixture, unittest.TestCase):
    def test_repair_midpoints_are_bounded_and_match_review_intervals(self):
        issues = [{'evidenceFrames': [28, 57, 85]}, {'evidenceFrames': [85, 114, 142]}]
        self.assertEqual(_repair_midpoint_frames(issues, [0, 28, 57, 85, 114, 142],
                         {'startFrame': 0, 'endFrameExclusive': 143}), [42, 71, 99, 128])
        self.assertEqual(_repair_midpoint_frames([{'evidenceFrames': [0, 11]}], list(range(12)),
                         {'startFrame': 0, 'endFrameExclusive': 12}), [])

    def test_mapping_uses_asset_indexes_and_preserves_nonidentity_source_labels(self):
        for n, frame in enumerate(self.clip['frames']):
            frame.update(source_frame=1000 + n * 2, source_time=100 + frame['time'] * 2)
        inspected = inspect_video(self.video, self.clip)
        self.assertEqual(inspected['sourceFrameMapping'][2]['sourceFrame'], 1004)
        self.assertEqual(inspected['decodedFrames'][2]['assetFrame'], 2)
        self.assertAlmostEqual(inspected['decodedFrames'][2]['time'], 2 / 30)
        prepared = prepare_player_evidence(inspected, self.clip, {'startFrame': 1, 'endFrameExclusive': 5})
        self.assertEqual(prepared['playerEvidence']['players'][0]['frames'][1]['sourceFrame'], 1004)
        self.assertEqual(prepared['playerEvidence']['players'][0]['frames'][1]['assetFrame'], 2)

    def test_source_sha_and_pts_mismatch_rejected(self):
        with self.assertRaisesRegex(AdapterError, 'digest'):
            inspect_video(self.video, expected_sha='0' * 64)
        altered = deepcopy(self.clip); altered['frames'][1]['time'] += .02
        with self.assertRaisesRegex(AdapterError, 'PTS'):
            inspect_video(self.video, altered)

    def test_body_boxes_never_become_native_foot_tracks(self):
        value = prepare_player_evidence(self.inspection, self.clip, {'startFrame': 0, 'endFrameExclusive': 12})
        self.assertTrue(all(not e['trajectory'] for e in value['review']['entities']))
        sample = value['playerEvidence']['players'][0]['frames'][0]
        self.assertEqual(sample['position'], [55, 70])
        self.assertEqual(sample['anchorSemantics'], 'body_point')
        self.assertIsNone(sample['identityConfidence'])
        self.assertEqual(sample['observationStatus'], 'observed')
        self.assertNotEqual(value['clip']['tracking_fingerprint'], self.clip['tracking_fingerprint'])

    def test_continuation_is_estimated_not_observed(self):
        self.clip['frames'][0]['track_evidence']['1']['source'] = 'low_confidence_continuation'
        prepared = prepare_player_evidence(self.inspection, self.clip, {'startFrame': 0, 'endFrameExclusive': 12})
        point = prepared['playerEvidence']['players'][0]['frames'][0]
        self.assertEqual(point['observationStatus'], 'estimated'); self.assertEqual(point['visibility'], 'unknown')

    def test_no_observation_cannot_receive_fake_fingerprint(self):
        for f in self.clip['frames']:
            f.pop('track_evidence')
        with self.assertRaisesRegex(AdapterError, 'source-verified'):
            prepare_player_evidence(self.inspection, self.clip, {'startFrame': 0, 'endFrameExclusive': 12})

    def test_modified_artifact_reference_rejected(self):
        path = write_json(self.root / 'evidence.json', {'actual': 1}); frozen = ref(path)
        write_json(path, {'actual': 2})
        with self.assertRaisesRegex(AdapterError, 'changed'):
            read_ref(frozen)


class NativeToolContractTests(SourceAdapterFixture, unittest.TestCase):
    def context(self, fail_review=False):
        if not shutil.which('node'):
            self.skipTest('Node is required for native bridge contract tests')
        path = write_json(self.root / 'clip.json', self.clip)
        request = {'range': {'startFrame': 0, 'endFrameExclusive': 12}, 'policyRef': 'tactics-default-v1',
                   'args': {'goal': 'Synthetic contract test', 'profile': 'richer_players_v1',
                            'output': {'video': True, 'editableDocument': True, 'fps': 30},
                            'allowPartial': False, 'geometryRequirement': 'none'}}
        ctx = TestContext(self.root, {'videoPath': str(self.video), 'videoSha256': file_sha256(self.video),
                                     'reviewPath': str(path)}, request)
        provider = InjectedTestProvider(fail_review); tools = TacticsToolset(provider=provider)
        return ctx, provider, tools

    def run_stages(self, ctx, tools, stages):
        for stage in stages:
            ctx.stage(stage)
            result = tools.handlers[stage](ctx.request, ctx)
            ctx.dependencies[stage] = result
        return result

    def failed_provider_preview(self, fail_review=True, boundary=None):
        ctx, _, tools = self.context()
        def interrupt_after_events():
            if boundary == 'cancelled':
                ctx.cancelled = True
            elif boundary:
                def expired():
                    raise AdapterError(boundary, 'Synthetic workflow boundary interruption')
                ctx.checkpoint = expired
        provider = TerminalFailureTestProvider(fail_review, interrupt_after_events)
        tools.provider = provider
        self.run_stages(ctx, tools, ['inspect_clip', 'prepare_players', 'analyze_play',
            'build_player_annotations', 'check_participant_coverage', 'check_projection'])
        ctx.stage('preview_projection')
        with self.assertRaises(AdapterError) as caught:
            tools.preview_projection(ctx.request, ctx)
        return ctx, provider, tools, caught.exception

    def test_provider_timeout_preserves_complete_fail_as_unaccepted_diagnostics(self):
        ctx, provider, tools, failure = self.failed_provider_preview()
        self.assertEqual(failure.reason_code, 'provider_unavailable')
        diagnostic = failure.diagnostic_result; output = diagnostic['outputs']
        self.assertTrue(output['diagnosticOnly']); self.assertFalse(output['executionAccepted']); self.assertFalse(output['pass'])
        report = read_ref(output['independentReviewDiagnosticRef'])
        provider_report = read_ref(output['providerDiagnosticRef'])
        self.assertEqual(report['verdict'], 'fail'); self.assertFalse(report['pass'])
        self.assertEqual(report['sourceRef'], ctx.dependencies['prepare_players']['outputs']['sourceRef'])
        self.assertEqual(report['candidateDigest'], ctx.dependencies['build_player_annotations']['outputs']['candidateDigest'])
        self.assertEqual(report['analysisRevision'], 1); self.assertEqual(report['producerOperationId'], ctx.operation_id)
        self.assertEqual(provider_report['executionFailure'], 'timeout')
        self.assertEqual(provider_report['terminalEvent']['status'], 'complete_schema_valid_message')
        self.assertEqual(report['previewDigests'], [item['sha256'] for item in output['previewRefs']])
        self.assertEqual(ctx.calls, 2); self.assertEqual(ctx.saved_guard, 0)
        for name in ('result.json', 'response.json', 'metrics.json'):
            self.assertFalse((ctx.attempt_dir / 'independent-review-model' / name).exists())
        self.assertFalse((ctx.attempt_dir / 'independent-review.json').exists())
        before = {str(path): file_sha256(path) for path in ctx.attempt_dir.rglob('*') if path.is_file()}
        repeated = tools.retain_provider_failure_diagnostics(ctx, error=failure.__cause__,
            elapsed_seconds=provider_report['elapsedSeconds'])
        self.assertEqual(output, repeated['outputs'])
        self.assertEqual(before, {str(path): file_sha256(path) for path in ctx.attempt_dir.rglob('*') if path.is_file()})
        with self.assertRaisesRegex(AdapterError, 'cannot be reused'):
            tools._model(ctx, 'independent-review-model', review_schema(), 'a new prompt', [])
        self.assertEqual(ctx.calls, 2)

    def test_event_pass_does_not_override_provider_failure(self):
        ctx, provider, tools, failure = self.failed_provider_preview(fail_review=False)
        report = read_ref(failure.diagnostic_result['outputs']['independentReviewDiagnosticRef'])
        self.assertEqual(report['verdict'], 'pass')
        self.assertTrue(all(report['checks'].values()))
        self.assertFalse(report['pass']); self.assertFalse(report['executionAccepted'])
        self.assertEqual(failure.reason_code, 'provider_unavailable')
        self.assertEqual(ctx.calls, 2); self.assertEqual(ctx.saved_guard, 0)

    def test_complete_event_cannot_bypass_cancel_boundary(self):
        ctx, provider, tools, failure = self.failed_provider_preview(fail_review=False, boundary='cancelled')
        self.assertEqual(failure.reason_code, 'cancelled')
        self.assertFalse(failure.diagnostic_result['outputs']['executionAccepted'])
        self.assertEqual(read_ref(failure.diagnostic_result['outputs']['providerDiagnosticRef'])['executionFailure'], 'cancelled')
        self.assertEqual(ctx.saved_guard, 0)

    def test_complete_event_cannot_bypass_budget_boundary(self):
        ctx, provider, tools, failure = self.failed_provider_preview(fail_review=False, boundary='budget_exhausted')
        self.assertEqual(failure.reason_code, 'budget_exhausted')
        self.assertFalse(failure.diagnostic_result['outputs']['executionAccepted'])
        self.assertEqual(read_ref(failure.diagnostic_result['outputs']['providerDiagnosticRef'])['executionFailure'], 'budget_exhausted')
        self.assertEqual(ctx.saved_guard, 0)

    def test_historical_diagnostic_rejects_unbound_preview_bytes(self):
        ctx, provider, tools, failure = self.failed_provider_preview()
        old = failure.diagnostic_result['outputs']; original_events = file_sha256(ctx.attempt_dir / 'independent-review-model/events.jsonl')
        # Remove only the newly generated temporary test diagnostics to simulate
        # a legacy attempt that has never registered diagnostics.
        Path(old['providerDiagnosticRef']['path']).unlink(); Path(old['independentReviewDiagnosticRef']['path']).unlink()
        Path(old['previewRefs'][0]['path']).write_bytes(b'Synthetic altered preview')
        result = tools.retain_provider_failure_diagnostics(ctx, error=failure.__cause__)
        self.assertNotIn('independentReviewDiagnosticRef', result['outputs'])
        self.assertEqual(result['outputs']['previewRefs'], [])
        report = read_ref(result['outputs']['providerDiagnosticRef'])
        self.assertEqual(report['previewStatus'], 'binding_or_files_unverified')
        self.assertFalse(report['executionAccepted'])
        self.assertEqual(file_sha256(ctx.attempt_dir / 'independent-review-model/events.jsonl'), original_events)

    def feedback_context(self):
        ctx, provider, tools = self.context()
        self.run_stages(ctx, tools, ['inspect_clip', 'prepare_players', 'analyze_play', 'build_player_annotations'])
        analyzed = ctx.dependencies['analyze_play']['outputs']; built = ctx.dependencies['build_player_annotations']['outputs']
        source = ctx.dependencies['prepare_players']['outputs']['sourceRef']
        issue = {'phaseId': 'phase-test', 'playerId': 'T3',
                 'reason': 'Late defensive participation needs its own evidenced phase, not only an early cue.', 'evidenceFrames': [7]}
        review = {'verdict': 'fail', 'pass': False, 'independent': True,
                  'reviewMethod': 'separate_provider_call_with_source_and_production_composites',
                  'checks': {'participantCoverage': False, 'correctPeople': True, 'positions': True,
                             'observedActionsOnly': True, 'readability': True, 'semantics': True},
                  'producerOperationId': 'op-failed-review', 'candidateDigest': built['candidateDigest'],
                  'sourceRef': source, 'analysisRevision': 1, 'issues': [issue], 'unmetRequirements': ['explain later defender']}
        review_ref = ref(write_json(ctx.run_root / 'failed-independent-review.json', review))
        feedback = {'schemaVersion': '1.0', 'repairPass': 1, 'reason': 'independent_review_feedback',
                    'failedOperationId': 'op-failed-review', 'reviewRef': review_ref,
                    'candidateRef': built['candidateRef'], 'candidateDigest': built['candidateDigest'],
                    'sourceRef': source, 'analysisRevision': 1, 'priorAnalysisRef': analyzed['playAnalysisRef'],
                    'priorInventoryRef': analyzed['participantInventoryRef'], 'failedPhaseIds': ['phase-test'],
                    'range': dict(ctx.range), 'issues': [issue], 'unmetRequirements': ['explain later defender']}
        ctx.repair_feedback_ref = ref(write_json(ctx.run_root / 'repair-feedback.json', feedback))
        ctx.analysis_revision = 2; ctx.generation = 2
        ctx.analysis_revision_reason = 'Address the retained independent review within the single failed phase'
        ctx.prior_analysis_ref = analyzed['playAnalysisRef']; ctx.prior_inventory_ref = analyzed['participantInventoryRef']
        ctx.operation_id = 'op-feedback-repair'; ctx.attempt_id = 'attempt-feedback-repair'
        ctx.attempt_dir = ctx.run_root / ctx.attempt_id; ctx.attempt_dir.mkdir()
        return ctx, provider, tools, feedback

    def test_real_native_generation_and_quality_contract(self):
        ctx, provider, tools = self.context()
        result = self.run_stages(ctx, tools, ['inspect_clip', 'prepare_players', 'analyze_play',
            'build_player_annotations', 'check_participant_coverage', 'check_projection'])
        self.assertTrue(result['outputs']['pass'])
        covered = ctx.dependencies['check_participant_coverage']['outputs']
        self.assertTrue(covered['pass']); self.assertEqual(ctx.calls, 1)
        metrics = read_ref(ctx.dependencies['analyze_play']['outputs']['modelMetricsRef'])
        self.assertEqual(metrics['toolVersion'], 'agent-tactics-tools-1.3')
        base = read_ref(ctx.dependencies['prepare_players']['outputs']['baseDocumentRef'])
        self.assertTrue(all(not e['trajectory'] for e in base['review']['entities']))

    def test_model_excluded_identity_drift_is_not_extended_from_raw_track(self):
        # All twelve raw rows remain observed under T3, including later rows
        # which the model explicitly rejects as the same actual participant.
        for frame in self.clip['frames'][7:]:
            frame['tracks'][2][:4] = [180, 60, 210, 120]
        ctx, provider, tools = self.context()
        tools.provider = ExcludedDriftTestProvider()
        self.run_stages(ctx, tools, ['inspect_clip', 'prepare_players'])
        evidence_ref = ctx.dependencies['prepare_players']['outputs']['playerEvidenceRef']
        original_evidence_sha = evidence_ref['sha256']
        result = self.run_stages(ctx, tools, ['analyze_play'])
        inventory = read_ref(result['outputs']['participantInventoryRef'])
        people = inventory['phases'][0]['participants']
        self.assertEqual(len(people), 3, 'Repair must retain all model-identified participants')
        defender = next(p for p in people if p['playerId'] == 'T3')
        expected = [{'startFrame': 0, 'endFrameExclusive': 1}, {'startFrame': 2, 'endFrameExclusive': 3}]
        self.assertEqual(defender['visibleRanges'], expected)
        self.assertEqual(defender['locatableRanges'], expected)
        self.assertEqual(defender['evidenceFrames'], [0, 2])
        raw = next(p for p in read_ref(evidence_ref)['players'] if p['playerId'] == 'T3')
        self.assertEqual(raw['frames'][7]['observationStatus'], 'observed')
        self.assertEqual(raw['frames'][11]['observationStatus'], 'observed')
        self.assertEqual(file_sha256(evidence_ref['path']), original_evidence_sha)

    def test_noncue_identity_evidence_with_conflict_is_rejected(self):
        self.clip['frames'][2]['track_evidence']['3']['color_conflict'] = True
        ctx, provider, tools = self.context(); tools.provider = ExcludedDriftTestProvider()
        self.run_stages(ctx, tools, ['inspect_clip', 'prepare_players'])
        ctx.stage('analyze_play')
        with self.assertRaises(AdapterError) as caught:
            tools.analyze_play(ctx.request, ctx)
        self.assertEqual(caught.exception.reason_code, 'identity_conflict')
        self.assertEqual(caught.exception.affected_ranges, [{'startFrame': 2, 'endFrameExclusive': 3}])

    def test_noncue_identity_evidence_with_no_observation_is_rejected(self):
        frame = self.clip['frames'][2]
        frame['tracks'] = [row for row in frame['tracks'] if row[4] != 3]
        frame['track_evidence'].pop('3')
        ctx, provider, tools = self.context(); tools.provider = ExcludedDriftTestProvider()
        self.run_stages(ctx, tools, ['inspect_clip', 'prepare_players'])
        ctx.stage('analyze_play')
        with self.assertRaises(AdapterError) as caught:
            tools.analyze_play(ctx.request, ctx)
        self.assertEqual(caught.exception.reason_code, 'tracking_gap')
        self.assertEqual(caught.exception.affected_ranges, [{'startFrame': 2, 'endFrameExclusive': 3}])

    def test_reanalysis_uses_reserved_revision_and_retains_original_artifacts(self):
        ctx, provider, tools = self.context(); tools.provider = ExcludedDriftTestProvider()
        first = self.run_stages(ctx, tools, ['inspect_clip', 'prepare_players', 'analyze_play'])
        first_analysis_ref = first['outputs']['playAnalysisRef']
        first_inventory_ref = first['outputs']['participantInventoryRef']
        ctx.generation = 2; ctx.analysis_revision = 2
        ctx.analysis_revision_reason = 'Restrict identity ranges to explicit source-frame evidence after drift review'
        ctx.prior_analysis_ref = first_analysis_ref; ctx.prior_inventory_ref = first_inventory_ref
        ctx.operation_id = 'op-reanalyze'; ctx.attempt_id = 'attempt-reanalyze'
        ctx.attempt_dir = ctx.run_root / ctx.attempt_id; ctx.attempt_dir.mkdir()
        revised = tools.analyze_play(ctx.request, ctx)
        self.assertEqual(revised['outputs']['analysisRevision'], 2)
        self.assertEqual(read_ref(revised['outputs']['playAnalysisRef'])['analysisRevision'], 2)
        self.assertEqual(read_ref(revised['outputs']['participantInventoryRef'])['analysisRevision'], 2)
        revision = read_ref(revised['outputs']['analysisRevisionRef'])
        self.assertEqual(revision['revisionReason'], ctx.analysis_revision_reason)
        self.assertEqual(revision['priorAnalysisRef'], first_analysis_ref)
        self.assertEqual(revision['priorInventoryRef'], first_inventory_ref)
        self.assertEqual(read_ref(first_analysis_ref)['analysisRevision'], 1)
        self.assertEqual(read_ref(first_inventory_ref)['analysisRevision'], 1)
        self.assertEqual(ctx.calls, 2)
        ctx.analysis_revision = 1
        with self.assertRaisesRegex(AdapterError, 'newer reserved revision'):
            tools.analyze_play(ctx.request, ctx)
        self.assertEqual(ctx.calls, 2, 'A regressed revision must be rejected before another model call')

    def test_bound_review_feedback_enters_prompt_and_single_phase_can_split(self):
        for index, frame in enumerate(self.clip['frames']):
            frame.update(source_frame=1000 + index * 2, source_time=100 + frame['time'] * 2)
        ctx, provider, tools, feedback = self.feedback_context()
        raw_ref = ctx.dependencies['prepare_players']['outputs']['playerEvidenceRef']
        old_ref = ctx.prior_inventory_ref; old_bytes = Path(old_ref['path']).read_bytes()
        repaired_provider = SplitRepairTestProvider(); tools.provider = repaired_provider
        repaired = tools.analyze_play(ctx.request, ctx)
        prompt = repaired_provider.calls[0]['prompt']
        self.assertIn(feedback['issues'][0]['reason'], prompt)
        self.assertIn(feedback['candidateDigest'], prompt)
        self.assertIn('previousInventory', prompt)
        self.assertIn('不得合并阶段', prompt)
        inventory = read_ref(repaired['outputs']['participantInventoryRef'])
        self.assertEqual(len(inventory['phases']), 2)
        self.assertEqual({p['playerId'] for phase in inventory['phases'] for p in phase['participants']}, {'T1', 'T2', 'T3'})
        revision = read_ref(repaired['outputs']['analysisRevisionRef'])
        self.assertEqual(revision['repairFeedbackRef'], ctx.repair_feedback_ref)
        self.assertEqual(revision['repairScope']['range'], feedback['range'])
        self.assertEqual(read_ref(repaired['outputs']['repairFeedbackRef']), feedback)
        extra = read_ref(repaired['outputs']['repairEvidenceFramesRef'])
        self.assertEqual([frame['assetFrame'] for frame in extra['frames']], [5, 8])
        self.assertEqual(extra['allAnalysisFrames'], [0, 2, 4, 5, 7, 8, 9, 11])
        self.assertEqual(extra['sourceRef'], feedback['sourceRef'])
        self.assertTrue(extra['trackingReused'])
        for frame in extra['frames']:
            self.assertEqual(frame['sourceFrame'], 1000 + frame['assetFrame'] * 2)
            self.assertAlmostEqual(frame['time'], frame['assetFrame'] / 30)
            self.assertEqual(file_sha256(frame['path']), frame['sha256'])
        self.assertEqual(sum(item['kind'] == 'repair_source_frame' for item in repaired['artifacts']), 2)
        self.assertEqual(Path(old_ref['path']).read_bytes(), old_bytes)
        self.assertEqual(file_sha256(raw_ref['path']), raw_ref['sha256'])
        self.assertFalse(read_ref(feedback['reviewRef'])['pass'])
        ctx.dependencies['analyze_play'] = repaired
        built = self.run_stages(ctx, tools, ['build_player_annotations', 'check_participant_coverage', 'check_projection', 'preview_projection'])
        self.assertTrue(built['outputs']['pass'])
        reviewed_frames = read_ref(built['outputs']['previewManifestRef'])['previews']
        self.assertTrue({5, 8}.issubset({frame['assetFrame'] for frame in reviewed_frames}))

    def test_feedback_extra_frame_extraction_rejects_changed_source(self):
        ctx, provider, tools, feedback = self.feedback_context()
        self.video.write_bytes(b'changed source must not be used for repair evidence')
        with self.assertRaises(AdapterError) as caught:
            tools.analyze_play(ctx.request, ctx)
        self.assertEqual(caught.exception.reason_code, 'source_mismatch')
        self.assertEqual(ctx.calls, 1)

    def test_feedback_wrong_bindings_rejected_before_model_call(self):
        ctx, provider, tools, feedback = self.feedback_context()
        mutations = [
            ('source', lambda value: value['sourceRef'].update(videoSha256='f' * 64)),
            ('revision', lambda value: value.update(analysisRevision=99)),
            ('candidate', lambda value: value.update(candidateDigest='f' * 64)),
            ('prior', lambda value: value.update(priorAnalysisRef=value['priorInventoryRef'])),
            ('scope', lambda value: value.update(failedPhaseIds=['unrelated-phase'])),
            ('second-pass', lambda value: value.update(repairPass=2)),
        ]
        for label, mutate in mutations:
            with self.subTest(label=label):
                changed = deepcopy(feedback); mutate(changed)
                ctx.repair_feedback_ref = ref(write_json(ctx.run_root / ('bad-feedback-' + label + '.json'), changed))
                with self.assertRaises(AdapterError):
                    tools.analyze_play(ctx.request, ctx)
                self.assertEqual(ctx.calls, 1)
        changed = deepcopy(feedback)
        invalid_review = read_ref(feedback['reviewRef'])
        invalid_review['pass'] = True
        changed['reviewRef'] = ref(write_json(ctx.run_root / 'not-failed-review.json', invalid_review))
        ctx.repair_feedback_ref = ref(write_json(ctx.run_root / 'not-failed-feedback.json', changed))
        with self.assertRaises(AdapterError):
            tools.analyze_play(ctx.request, ctx)
        self.assertEqual(ctx.calls, 1)
        changed = deepcopy(feedback)
        changed_candidate = read_ref(feedback['candidateRef']); changed_candidate['title'] += ' wrong candidate'
        changed['candidateRef'] = ref(write_json(ctx.run_root / 'different-candidate.json', changed_candidate))
        ctx.repair_feedback_ref = ref(write_json(ctx.run_root / 'different-candidate-feedback.json', changed))
        with self.assertRaisesRegex(AdapterError, 'exact failed native candidate'):
            tools.analyze_play(ctx.request, ctx)
        self.assertEqual(ctx.calls, 1)

    def test_feedback_duration_uses_source_pts_and_respects_short_scope(self):
        ctx, provider, tools, feedback = self.feedback_context()
        ctx.policy['maxRepairSeconds'] = 0.1
        with self.assertRaises(AdapterError) as caught:
            tools.analyze_play(ctx.request, ctx)
        self.assertEqual(caught.exception.reason_code, 'capability_unavailable')
        self.assertIn('exact source PTS', str(caught.exception))
        self.assertEqual(ctx.calls, 1)

    def test_feedback_hard_duration_cap_uses_pts_even_with_looser_policy(self):
        make_video(self.video, rate=1)
        self.inspection = inspect_video(self.video); self.clip = tracked_fixture(self.inspection)
        ctx, provider, tools, feedback = self.feedback_context()
        ctx.policy['maxRepairSeconds'] = 60
        with self.assertRaises(AdapterError) as caught:
            tools.analyze_play(ctx.request, ctx)
        self.assertEqual(caught.exception.reason_code, 'capability_unavailable')
        self.assertIn('exact source PTS', str(caught.exception))
        self.assertEqual(ctx.calls, 1, 'Twelve actual seconds cannot be mistaken for 12 / 30 seconds')

    def test_feedback_wrong_person_failure_requires_separate_identity_repair(self):
        ctx, provider, tools, feedback = self.feedback_context()
        review = read_ref(feedback['reviewRef']); review['checks']['correctPeople'] = False
        feedback['reviewRef'] = ref(write_json(ctx.run_root / 'identity-failed-review.json', review))
        ctx.repair_feedback_ref = ref(write_json(ctx.run_root / 'identity-failed-feedback.json', feedback))
        with self.assertRaises(AdapterError) as caught:
            tools.analyze_play(ctx.request, ctx)
        self.assertEqual(caught.exception.reason_code, 'capability_unavailable')
        self.assertEqual(ctx.calls, 1)

    def test_feedback_multiphase_scope_is_rejected_before_model_call(self):
        ctx, provider, tools, feedback = self.feedback_context()
        previous = read_ref(ctx.prior_analysis_ref); inventory = read_ref(ctx.prior_inventory_ref)
        previous['phases'].append(deepcopy(previous['phases'][0]))
        inventory['phases'].append(deepcopy(inventory['phases'][0]))
        ctx.prior_analysis_ref = ref(write_json(ctx.run_root / 'old-multiple-phases.json', previous))
        ctx.prior_inventory_ref = ref(write_json(ctx.run_root / 'old-multiple-inventory.json', inventory))
        feedback.update(priorAnalysisRef=ctx.prior_analysis_ref, priorInventoryRef=ctx.prior_inventory_ref)
        ctx.repair_feedback_ref = ref(write_json(ctx.run_root / 'unsupported-feedback.json', feedback))
        with self.assertRaises(AdapterError) as caught:
            tools.analyze_play(ctx.request, ctx)
        self.assertEqual(caught.exception.reason_code, 'capability_unavailable')
        self.assertEqual(ctx.calls, 1)

    def test_feedback_cannot_drop_prior_participant_to_improve_coverage(self):
        for record in self.clip['frames']:
            record['tracks'].append([275, 40, 300, 100, 4, .9, 2])
            record['track_evidence']['4'] = {'source': 'detection', 'identity_verified': False}
        ctx, provider, tools, feedback = self.feedback_context()
        class DroppedParticipantProvider(SplitRepairTestProvider):
            def generate(self, **kwargs):
                response = super().generate(**kwargs)
                for phase in response['phases']:
                    for person in phase['participants']:
                        if person['playerId'] == 'T3':
                            person['playerId'] = 'T4'
                return response
        tools.provider = DroppedParticipantProvider()
        with self.assertRaisesRegex(AdapterError, 'retain every previously frozen participant'):
            tools.analyze_play(ctx.request, ctx)
        self.assertEqual(ctx.calls, 2)
        self.assertEqual(read_ref(ctx.prior_inventory_ref)['analysisRevision'], 1)

    def test_feedback_insufficient_evidence_retains_audit_without_new_candidate(self):
        ctx, provider, tools, feedback = self.feedback_context()
        class InsufficientRepairProvider(InjectedTestProvider):
            def generate(self, **kwargs):
                response = super().generate(**kwargs)
                response.update(outcome='insufficient_evidence', phases=[],
                                unmetRequirements=['No safely identified finisher location is available.'])
                return response
        tools.provider = InsufficientRepairProvider()
        with self.assertRaises(AdapterError) as caught:
            tools.analyze_play(ctx.request, ctx)
        self.assertEqual(caught.exception.reason_code, 'tracking_gap')
        self.assertEqual(caught.exception.affected_ranges, [ctx.range])
        self.assertIn('finisher', caught.exception.suggested_action)
        self.assertEqual(ctx.calls, 2)
        self.assertFalse((ctx.attempt_dir / 'play-analysis.json').exists())
        revision = __import__('json').loads((ctx.attempt_dir / 'analysis-revision.json').read_text(encoding='utf-8'))
        self.assertEqual(revision['repairFeedbackRef'], ctx.repair_feedback_ref)
        self.assertEqual(revision['analysisRevision'], 2)
        self.assertEqual(file_sha256(ctx.attempt_dir / 'repair-feedback.json'), ctx.repair_feedback_ref['sha256'])
        self.assertFalse(read_ref(feedback['reviewRef'])['pass'])

    def test_legacy_rounded_review_uses_registered_pts_mapping_without_file_edit(self):
        ctx, provider, tools = self.context()
        from agent_workflow_contract import native_digest
        mapping = deepcopy(self.inspection['sourceFrameMapping'])
        ctx.asset['sourceFrameMapping'] = mapping
        ctx.asset['frameMappingDigest'] = native_digest(mapping)
        legacy = deepcopy(self.clip)
        for frame in legacy['frames']:
            frame['time'] = round(frame['time'], 9)
        write_json(ctx.asset['reviewPath'], legacy)
        original_sha = file_sha256(ctx.asset['reviewPath'])
        result = self.run_stages(ctx, tools, ['inspect_clip', 'prepare_players'])
        self.assertEqual(result['sourceRef']['frameMappingDigest'], ctx.asset['frameMappingDigest'])
        self.assertEqual(file_sha256(ctx.asset['reviewPath']), original_sha)
        native = read_ref(result['outputs']['derivedReviewRef'])
        self.assertEqual(native['sourceFrameMapping'], mapping)

    def test_geometry_is_not_fabricated(self):
        ctx, provider, tools = self.context(); ctx.stage('prepare_geometry')
        with self.assertRaisesRegex(AdapterError, 'independent court'):
            tools.prepare_geometry(ctx.request, ctx)

    def test_source_changes_before_commit_cannot_pass(self):
        ctx, provider, tools = self.context()
        self.run_stages(ctx, tools, ['inspect_clip'])
        path = Path(ctx.asset['reviewPath']); changed = deepcopy(self.clip); changed['newUserEdit'] = True
        write_json(path, changed)
        with self.assertRaisesRegex(AdapterError, 'original review'):
            tools._verify_originals(ctx)

    def test_separate_review_failure_cannot_be_committed(self):
        ctx, provider, tools = self.context(fail_review=True)
        result = self.run_stages(ctx, tools, ['inspect_clip', 'prepare_players', 'analyze_play',
            'build_player_annotations', 'check_participant_coverage', 'check_projection', 'preview_projection'])
        self.assertEqual(ctx.calls, 2)
        self.assertNotEqual(provider.calls[0]['directory'], provider.calls[1]['directory'])
        self.assertFalse(result['outputs']['pass'])
        ctx.stage('commit_candidate')
        with self.assertRaisesRegex(AdapterError, 'Acceptance evidence'):
            tools.commit_candidate(ctx.request, ctx)
        self.assertEqual(ctx.saved_guard, 0)

    def test_accepted_native_render_decodes_and_repeated_save_keeps_version(self):
        if not shutil.which('ffmpeg'):
            self.skipTest('FFmpeg is required for native renderer integration')
        ctx, provider, tools = self.context()
        self.run_stages(ctx, tools, ['inspect_clip', 'prepare_players', 'analyze_play',
            'build_player_annotations', 'check_participant_coverage', 'check_projection',
            'preview_projection', 'commit_candidate'])
        first = ctx.dependencies['commit_candidate']['outputs']
        again = tools.commit_candidate(ctx.request, ctx)['outputs']
        self.assertEqual(first['savedVersion'], again['savedVersion'])
        self.assertEqual(first['savedDigest'], again['savedDigest'])
        result = self.run_stages(ctx, tools, ['render_projected_video'])
        decoded = read_ref(result['outputs']['decodeReportRef'])
        from agent_workflow_contract import WORKFLOW_VERSION
        self.assertEqual(read_ref(result['outputs']['manifestRef'])['workflowVersion'], WORKFLOW_VERSION)
        self.assertEqual(read_ref(result['outputs']['manifestRef'])['toolVersion'], TOOL_VERSION)
        self.assertTrue(decoded['pass']); self.assertGreater(decoded['decodedFrames'], 12)
        self.assertEqual(decoded['audioMode'], 'silent')
        self.assertEqual(ctx.calls, 2)
        first_timing = read_ref(result['outputs']['timingRef'])
        # Simulate process restart: the renderer's in-memory jobs are gone.
        ctx.attempt_id = 'attempt-render-restarted'
        ctx.attempt_dir = ctx.run_root / ctx.attempt_id; ctx.attempt_dir.mkdir()
        resumed = tools.render_projected_video(ctx.request, ctx)
        timing = read_ref(resumed['outputs']['timingRef'])
        self.assertTrue(timing['renderCacheHit'])
        self.assertEqual(timing['nativeJobId'], first_timing['nativeJobId'])
        self.assertEqual(result['outputs']['videoRef']['sha256'], resumed['outputs']['videoRef']['sha256'])
        self.assertEqual(read_ref(resumed['outputs']['manifestRef'])['reproductionMode'], 'replay_artifacts')

    def test_save_completed_before_receipt_failure_recovers_same_version(self):
        ctx, provider, tools = self.context()
        self.run_stages(ctx, tools, ['inspect_clip', 'prepare_players', 'analyze_play',
            'build_player_annotations', 'check_participant_coverage', 'check_projection', 'preview_projection'])
        ctx.stage('commit_candidate'); original_write = tools._write
        def fail_receipt(context, name, value):
            if name == 'saved-document.json':
                raise OSError('Injected failure after native save, before artifact receipt')
            return original_write(context, name, value)
        tools._write = fail_receipt
        with self.assertRaisesRegex(OSError, 'after native save'):
            tools.commit_candidate(ctx.request, ctx)
        tools._write = original_write
        result = tools.commit_candidate(ctx.request, ctx)
        self.assertEqual(result['outputs']['savedVersion'], 1)


if __name__ == '__main__':
    unittest.main()
