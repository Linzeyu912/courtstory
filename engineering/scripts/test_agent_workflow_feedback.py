"""Bounded repair authority tests; fixtures never call a real provider."""
from contextlib import closing
from copy import deepcopy
import json
from pathlib import Path
import time
from unittest.mock import patch
import unittest

from agent_workflow_contract import WorkflowError, canonical, digest
from agent_workflow_feedback import REVIEW_METHOD, CHECKS, validate_feedback
from agent_workflow_runner import WorkflowRunner
from agent_workflow_store import file_digest
from test_agent_workflow_runner import WorkflowFixture


class FeedbackTests(WorkflowFixture):
    def setUp(self):
        super().setUp()
        self.failures = 1
        self.feedback_seen = []
        self.old_inventories = []
        self.review_mutator = lambda report: None
        self.phase_count = 1
        self.media_end_time = 0.2
        original = self.runner.handlers.copy()

        def write(ctx, name, value):
            path = ctx.attempt_dir / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(canonical(value), encoding='utf-8')
            return {'path': str(path), 'sha256': file_digest(path)}

        def analyze(request, ctx):
            result = original['analyze_play'](request, ctx)
            if ctx.repair_feedback_ref:
                self.assertEqual(file_digest(ctx.repair_feedback_ref['path']), ctx.repair_feedback_ref['sha256'])
                feedback = json.loads(Path(ctx.repair_feedback_ref['path']).read_text(encoding='utf-8'))
                self.feedback_seen.append((ctx.analysis_revision, ctx.analysis_revision_reason, feedback))
                self.assertEqual(feedback['priorInventoryRef'], ctx.prior_inventory_ref)
            phases = [{'id': 'phase_1', 'range': ctx.range, 'participants': [{'playerId': 'T1'}]}]
            if self.phase_count > 1:
                phases.append({'id': 'phase_2', 'range': ctx.range, 'participants': [{'playerId': 'T2'}]})
            analysis = {'sourceRef': ctx.source_ref, 'analysisRevision': ctx.analysis_revision, 'range': ctx.range, 'phases': phases}
            inventory = {'sourceRef': ctx.source_ref, 'analysisRevision': ctx.analysis_revision, 'frozenBeforeGraphics': True,
                         'producerOperationId': ctx.operation_id,
                         'phases': [{'phaseId': p['id'], 'range': p['range'], 'participants': p['participants']} for p in phases]}
            analysis_ref = write(ctx, 'play-analysis.json', analysis)
            inventory_ref = write(ctx, 'participant-inventory.json', inventory)
            self.old_inventories.append((inventory_ref, Path(inventory_ref['path']).read_bytes()))
            result['outputs'].update({'playAnalysisRef': analysis_ref, 'participantInventoryRef': inventory_ref})
            result['artifacts'] += [{'path': analysis_ref['path'], 'kind': 'play_analysis'},
                                    {'path': inventory_ref['path'], 'kind': 'participant_inventory'}]
            return result

        def inspect(request, ctx):
            result = original['inspect_clip'](request, ctx)
            result['outputs']['snapshotRef'] = write(ctx, 'exact-clock.json',
                {'sourceFrameMapping': ctx.asset['sourceFrameMapping'], 'clip': {'mediaEndTime': self.media_end_time}})
            return result

        def build(request, ctx):
            result = original['build_player_annotations'](request, ctx)
            revision = ctx.dependencies['analyze_play']['outputs']['analysisRevision']
            candidate = {'revision': revision, 'testOnly': True}
            result['outputs'].update({'candidateRef': write(ctx, 'candidate.json', candidate),
                                      'candidateDigest': digest(candidate), 'analysisRevision': revision})
            return result

        def preview(request, ctx):
            result = original['preview_projection'](request, ctx)
            built = ctx.dependencies['build_player_annotations']['outputs']
            passed = self.calls['preview_projection'] > self.failures
            previews = []
            for frame in (0, 4):
                path = ctx.attempt_dir / f'preview-{frame}.png'
                path.write_bytes(b'test-only-preview' + bytes([frame, built['analysisRevision']]))
                previews.append({'path': str(path), 'sha256': file_digest(path), 'assetFrame': frame})
            report = {'verdict': 'pass' if passed else 'fail', 'pass': passed, 'independent': True,
                      'checks': {name: passed or name != 'participantCoverage' for name in CHECKS},
                      'summary': 'Fixture review', 'issues': [] if passed else [{'phaseId': 'phase_1', 'playerId': 'T2',
                        'reason': 'Visible direct defender was omitted', 'evidenceFrames': [4]}],
                      'unmetRequirements': [] if passed else ['visible defender coverage'],
                      'sourceRef': ctx.source_ref, 'candidateDigest': built['candidateDigest'], 'analysisRevision': built['analysisRevision'],
                      'producerOperationId': ctx.operation_id, 'reviewMethod': REVIEW_METHOD,
                      'previewDigests': [p['sha256'] for p in previews]}
            self.review_mutator(report)
            review_ref = write(ctx, 'independent-review.json', report)
            manifest_ref = write(ctx, 'preview-manifest.json', {'candidateDigest': built['candidateDigest'],
                    'sourceRef': ctx.source_ref, 'previews': previews, 'reviewRef': review_ref})
            write(ctx, 'independent-review-model/response.json', {k: report[k] for k in ('verdict', 'checks', 'summary', 'issues', 'unmetRequirements')})
            result['outputs'].update({'pass': passed, 'independentReview': report, 'reviewRef': review_ref,
                                      'previewManifestRef': manifest_ref, 'previewRefs': previews})
            result['artifacts'] += [{'path': review_ref['path'], 'kind': 'independent_review'},
                                    {'path': manifest_ref['path'], 'kind': 'preview_manifest'}]
            result['artifacts'] += [{'path': p['path'], 'kind': 'composite_preview', 'mediaType': 'image/png'} for p in previews]
            result['unmetRequirements'] = report['unmetRequirements']
            return result

        self.runner.handlers.update({'inspect_clip': inspect, 'analyze_play': analyze, 'build_player_annotations': build, 'preview_projection': preview})

    def test_single_feedback_pass_retains_failure_and_inventory_without_budget_reset(self):
        run_id = self.submit()
        with self.store.transaction() as db:
            db.execute('UPDATE runs SET created=created-100,deadline=deadline-100 WHERE id=?', (run_id,))
        before = self.store.get('alice', run_id)
        result = self.runner.run('alice', run_id)
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(result['budget']['modelCalls'], 4)
        self.assertEqual(result['budget']['repairPasses'], 1)
        self.assertGreater(result['budget']['wallSeconds'], 100)
        after = self.store.get('alice', run_id)
        self.assertEqual((after['created'], after['deadline']), (before['created'], before['deadline']))
        self.assertEqual(self.calls['inspect_clip'], 1)
        self.assertEqual(self.calls['prepare_players'], 1)
        self.assertEqual(self.calls['commit_candidate'], 1)
        self.assertEqual(self.feedback_seen[0][0:2], (2, 'independent_review_feedback'))
        self.assertEqual(self.feedback_seen[0][2]['issues'][0]['playerId'], 'T2')
        old = next(op for op in after['operations'] if op['stage'] == 'preview_projection' and op['status'] == 'failed')
        self.assertEqual(old['valid'], 0)
        self.assertTrue(old['result']['artifactRefs'])
        self.assertTrue(old['error']['evidenceRefs'])
        current = self.store.stage_results('alice', run_id)
        self.assertNotEqual(current['preview_projection']['id'], old['id'])
        for operation in current.values():
            self.assertNotIn(old['id'], operation['deps'])
        for ref, data in self.old_inventories:
            self.assertEqual(Path(ref['path']).read_bytes(), data)
            self.assertEqual(file_digest(ref['path']), ref['sha256'])

    def test_second_failure_stops_with_readable_failed_diagnostics(self):
        self.failures = 2
        run_id = self.submit()
        result = self.runner.run('alice', run_id)
        self.assertEqual(result['status'], 'needs_attention')
        self.assertEqual(result['budget']['modelCalls'], 4)
        self.assertEqual(result['budget']['repairPasses'], 1)
        self.assertEqual(self.calls['analyze_play'], 2)
        self.assertNotIn('commit_candidate', self.calls)
        self.assertTrue(result['error']['evidenceRefs'])
        with closing(self.store.connect()) as db:
            for ref in result['error']['evidenceRefs']:
                row = db.execute('SELECT path,metadata FROM artifacts WHERE id=?', (ref,)).fetchone()
                self.assertTrue(Path(row['path']).is_file())
                self.assertEqual(file_digest(row['path']), json.loads(row['metadata'])['sha256'])
        with self.assertRaises(WorkflowError):
            self.runner.repair('alice', run_id)
        self.assertNotIn('preview_projection', self.store.stage_results('alice', run_id))
        with self.assertRaises(WorkflowError):
            self.runner.register_stage('alice', run_id, 'commit_candidate')

    def test_unlocalized_and_multiphase_reviews_are_not_regenerated(self):
        for mode in ('unlocalized', 'multiphase', 'wrong_source', 'wrong_people'):
            with self.subTest(mode=mode):
                self.request['idempotencyKey'] = mode
                self.calls.clear(); self.failures = 9
                self.phase_count = 2 if mode == 'multiphase' else 1
                self.review_mutator = {
                    'unlocalized': lambda r: r.update({'issues': []}),
                    'multiphase': lambda r: None,
                    'wrong_source': lambda r: r.update({'sourceRef': {**r['sourceRef'], 'snapshotId': 'wrong'}}),
                    'wrong_people': lambda r: r['checks'].update({'correctPeople': False})}[mode]
                result = self.runner.run('alice', self.submit())
                self.assertEqual(result['status'], 'needs_attention')
                self.assertEqual(result['budget']['modelCalls'], 2)
                self.assertEqual(result['budget']['repairPasses'], 0)
                self.assertEqual(self.calls['analyze_play'], 1)

    def test_feedback_reserves_only_when_two_calls_and_total_wall_remain(self):
        self.policy['maxModelCalls'] = 3
        result = self.runner.run('alice', self.submit())
        self.assertEqual(result['status'], 'needs_attention')
        self.assertEqual(result['budget']['repairPasses'], 0)
        self.assertEqual(result['budget']['modelCalls'], 2)
        self.assertNotIn('commit_candidate', self.calls)

    def test_long_single_phase_is_not_automatically_reanalyzed(self):
        self.media_end_time = 20.25
        result = self.runner.run('alice', self.submit())
        self.assertEqual(result['status'], 'needs_attention')
        self.assertEqual(result['budget']['repairPasses'], 0)
        self.assertEqual(self.calls['analyze_play'], 1)

    def test_eight_second_boundary_uses_exact_60fps_clock_not_output_fps_or_source_labels(self):
        for frames, expected in ((480, 'succeeded'), (481, 'needs_attention')):
            with self.subTest(frames=frames):
                asset_id = 'sixty-fps-' + str(frames)
                mapping = [{'frame': i, 'time': i / 60, 'sourceFrame': 9000 + i * 2,
                            'sourceTime': 150 + i / 30} for i in range(frames)]
                self.store.register_asset('alice', asset_id, {'videoPath': str(self.video), 'sourceFrameMapping': mapping})
                self.request['args']['assetRef'] = asset_id
                self.request['args']['output']['fps'] = 30
                self.request['range']['endFrameExclusive'] = frames
                self.request['idempotencyKey'] = asset_id
                self.media_end_time = frames / 60
                self.calls.clear()
                result = self.runner.run('alice', self.submit())
                self.assertEqual(result['status'], expected, result)
                self.assertEqual(result['budget']['repairPasses'], int(frames == 480))

    def test_cancelled_and_old_generation_failures_cannot_terminate_repair(self):
        run_id = self.submit()
        for name in self.runner.stages:
            if name in ('commit_candidate', 'render_projected_video'):
                break
            self.stage(run_id, name)
        run = self.store.get('alice', run_id)
        self.assertEqual(run['generation'], 2)
        failed = next(op for op in run['operations'] if op['stage'] == 'preview_projection')
        self.assertFalse(self.store.fail('alice', run_id, failed['id'], 'old-token', WorkflowError('output_invalid', 'late')))
        self.runner._finish_error('alice', run_id, WorkflowError('output_invalid', 'late'), generation=1)
        self.assertEqual(self.store.get('alice', run_id)['status'], 'queued')
        self.runner.call('cancel_run', 'alice', self.control(run_id, 'cancel'))
        self.assertFalse(self.runner._try_repair('alice', run_id, failed['id']))
        self.assertEqual(self.store.get('alice', run_id)['status'], 'cancelled')

    def legacy_failed(self):
        run_id = self.submit()
        # Simulate the former runner, which left complete attempt diagnostics but
        # recorded a failed operation without its result. No model calls occur.
        with patch.object(self.runner, '_try_repair', return_value=False):
            self.runner.run('alice', run_id)
        run = self.store.get('alice', run_id)
        failed = next(op for op in run['operations'] if op['stage'] == 'preview_projection')
        with self.store.transaction() as db:
            db.execute('DELETE FROM artifacts WHERE operation_id=?', (failed['id'],))
            db.execute('UPDATE operations SET result=NULL WHERE id=?', (failed['id'],))
            budget = run['budget']; budget['wallSeconds'] = 183.5
            db.execute('UPDATE runs SET budget=?,created=?,deadline=? WHERE id=?',
                       (canonical(budget), time.time()-1200, time.time()-600, run_id))
        return run_id, failed

    def test_legacy_recovery_keeps_failed_status_and_cumulative_budget(self):
        run_id, failed = self.legacy_failed()
        result = self.runner.repair('alice', run_id, recover_diagnostics=True)
        self.assertEqual(result['status'], 'queued')
        self.assertEqual(result['budget']['modelCalls'], 2)
        self.assertEqual(result['budget']['repairPasses'], 1)
        run = self.store.get('alice', run_id)
        self.assertGreaterEqual(run['budget']['wallSeconds'], 183.5)
        self.assertLess(run['deadline']-time.time(), 417)
        old = next(op for op in run['operations'] if op['id'] == failed['id'])
        self.assertEqual((old['status'], old['valid']), ('failed', 0))
        self.assertTrue(old['result']['artifactRefs'])
        self.assertEqual(self.runner.run('alice', run_id)['status'], 'succeeded')
        with closing(self.store.connect()) as db:
            event = json.loads(db.execute("SELECT data FROM events WHERE kind='repair_scheduled' AND run_id=?", (run_id,)).fetchone()[0])
        self.assertTrue(event['explicitRecovery'])
        self.assertGreater(event['terminalIdleSeconds'], 1000)
        self.assertEqual(event['previousWallSeconds'], 183.5)

    def test_legacy_recovery_rejects_changed_report_and_spent_wall_budget(self):
        run_id, failed = self.legacy_failed()
        report = self.store.root / 'runs' / run_id / 'attempts' / failed['attempt'] / 'independent-review.json'
        data = json.loads(report.read_text(encoding='utf-8'))
        data['candidateDigest'] = '0' * 64
        report.write_text(canonical(data), encoding='utf-8')
        with self.assertRaises(WorkflowError):
            self.runner.repair('alice', run_id, recover_diagnostics=True)
        self.assertEqual(self.store.get('alice', run_id)['budget']['repairPasses'], 0)
        self.assertEqual(self.store.get('alice', run_id)['status'], 'needs_attention')
        self.request['idempotencyKey'] = 'spent-wall'
        self.calls.clear()
        run_id, _ = self.legacy_failed()
        with self.store.transaction() as db:
            row = self.store._run(db, 'alice', run_id)
            budget = json.loads(row['budget']); budget['wallSeconds'] = 600
            db.execute('UPDATE runs SET budget=? WHERE id=?', (canonical(budget), run_id))
        with self.assertRaises(WorkflowError) as error:
            self.runner.repair('alice', run_id, recover_diagnostics=True)
        self.assertEqual(error.exception.reason_code, 'budget_exhausted')
        self.assertEqual(self.store.get('alice', run_id)['budget']['repairPasses'], 0)


if __name__ == '__main__':
    unittest.main()
