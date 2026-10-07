"""Failure-only diagnostic import is not provider acceptance or workflow resume."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import threading
import unittest

from agent_workflow_contract import WorkflowError, canonical, digest
from agent_workflow_store import file_digest
from test_agent_workflow_runner import WorkflowFixture


class DiagnosticTests(WorkflowFixture):
    def setUp(self):
        super().setUp()
        self.attach_diagnostics = True
        self.last_context = None
        original = self.runner.handlers.copy()
        def analyze(request, ctx):
            result = original['analyze_play'](request, ctx)
            path = ctx.attempt_dir / 'play-analysis.json'
            path.write_text(canonical({'sourceRef': ctx.source_ref, 'analysisRevision': ctx.analysis_revision}), encoding='utf-8')
            result['outputs']['playAnalysisRef'] = {'path': str(path), 'sha256': file_digest(path)}
            return result
        def build(request, ctx):
            result = original['build_player_annotations'](request, ctx)
            revision = ctx.dependencies['analyze_play']['outputs']['analysisRevision']
            candidate = {'schemaVersion': 2, 'testOnly': True, 'revision': revision}
            path = ctx.attempt_dir / 'candidate.json'; path.write_text(canonical(candidate), encoding='utf-8')
            result['outputs'].update({'candidateRef': {'path': str(path), 'sha256': file_digest(path)},
                                      'candidateDigest': digest(candidate), 'analysisRevision': revision})
            return result
        self.original_preview = original['preview_projection']
        def unavailable(request, ctx):
            self.original_preview(request, ctx)
            self.last_context = ctx
            error = WorkflowError('provider_unavailable', 'No accepted provider result file')
            if self.attach_diagnostics:
                error.diagnostic_result = self.diagnostics(ctx)
            raise error
        self.runner.handlers.update({'analyze_play': analyze, 'build_player_annotations': build, 'preview_projection': unavailable})

    def diagnostics(self, ctx, error=None):
        built = ctx.dependencies['build_player_annotations']['outputs']
        preview = ctx.attempt_dir / 'preview.png'; preview.write_bytes(b'synthetic bound preview')
        preview_ref = {'path': str(preview), 'sha256': file_digest(preview), 'assetFrame': 0}
        reports = {}
        artifacts = [{'path': str(preview), 'kind': 'composite_preview', 'mediaType': 'image/png'}]
        for key, kind in (('providerDiagnosticRef', 'provider_diagnostic'),
                          ('independentReviewDiagnosticRef', 'independent_review_diagnostic')):
            value = {'diagnosticOnly': True, 'executionAccepted': False, 'pass': False,
                     'verdict': 'pass', 'sourceRef': ctx.source_ref, 'candidateDigest': built['candidateDigest'],
                     'analysisRevision': built['analysisRevision'], 'producerOperationId': ctx.operation_id,
                     'previewDigests': [preview_ref['sha256']]}
            path = ctx.attempt_dir / (kind + '.json'); path.write_text(canonical(value), encoding='utf-8')
            reports[key] = {'path': str(path), 'sha256': file_digest(path)}
            artifacts.append({'path': str(path), 'kind': kind})
        return {'outputs': {'diagnosticOnly': True, 'executionAccepted': False, 'pass': False,
                            'previewRefs': [preview_ref], **reports}, 'artifacts': artifacts}

    def test_live_provider_diagnostic_pass_never_becomes_success_or_repair(self):
        run_id = self.submit()
        result = self.runner.run('alice', run_id)
        self.assertEqual(result['status'], 'needs_attention')
        self.assertEqual(result['error']['reasonCode'], 'provider_unavailable')
        self.assertEqual(result['budget']['modelCalls'], 2)
        self.assertEqual(result['budget']['repairPasses'], 0)
        self.assertTrue(result['error']['evidenceRefs'])
        run = self.store.get('alice', run_id)
        op = next(op for op in run['operations'] if op['stage'] == 'preview_projection')
        self.assertEqual(op['status'], 'failed')
        self.assertIs(op['result']['outputs']['executionAccepted'], False)
        self.assertNotIn('preview_projection', self.store.stage_results('alice', run_id))
        self.assertNotIn('commit_candidate', self.calls)

    def test_historical_import_is_idempotent_and_keeps_status_budget_and_generation(self):
        self.attach_diagnostics = False
        run_id = self.submit(); self.runner.run('alice', run_id)
        before, calls = self.store.get('alice', run_id), dict(self.calls)
        result = self.runner.import_diagnostics('alice', run_id, retainer=self.diagnostics)
        self.assertEqual(result['status'], 'needs_attention')
        after = self.store.get('alice', run_id)
        for key in ('budget', 'generation', 'status', 'created', 'deadline'):
            self.assertEqual(after[key], before[key])
        self.assertEqual(calls, self.calls)
        self.assertEqual(after['revision'], before['revision'] + 1)
        again = self.runner.import_diagnostics('alice', run_id, retainer=lambda *_: self.fail('Retainer must not run twice'))
        self.assertEqual(again['runRevision'], result['runRevision'])
        self.assertEqual(again['artifactRefs'], result['artifactRefs'])

    def test_import_rejects_wrong_candidate_digest_and_foreign_caller(self):
        self.attach_diagnostics = False
        run_id = self.submit(); self.runner.run('alice', run_id)
        before = self.store.get('alice', run_id)
        def wrong(ctx, **kwargs):
            result = self.diagnostics(ctx)
            ref = result['outputs']['providerDiagnosticRef']
            path = Path(ref['path']); value = json.loads(path.read_text(encoding='utf-8'))
            value['candidateDigest'] = '0' * 64; path.write_text(canonical(value), encoding='utf-8')
            ref['sha256'] = file_digest(path)
            return result
        with self.assertRaises(WorkflowError):
            self.runner.import_diagnostics('alice', run_id, retainer=wrong)
        self.assertEqual(self.store.get('alice', run_id)['artifacts'], before['artifacts'])
        with self.assertRaises(WorkflowError):
            self.runner.import_diagnostics('bob', run_id, retainer=self.diagnostics)

    def test_cancel_racing_historical_import_prevents_registration(self):
        self.attach_diagnostics = False
        run_id = self.submit(); self.runner.run('alice', run_id)
        before = self.store.get('alice', run_id)
        def cancelled(ctx, **kwargs):
            result = self.diagnostics(ctx)
            self.runner.call('cancel_run', 'alice', self.control(run_id, 'cancel'))
            return result
        with self.assertRaises(WorkflowError):
            self.runner.import_diagnostics('alice', run_id, retainer=cancelled)
        after = self.store.get('alice', run_id)
        self.assertEqual(after['status'], 'cancelled')
        self.assertEqual(after['artifacts'], before['artifacts'])
        self.assertEqual(after['budget'], before['budget'])

    def test_late_diagnostics_after_cancel_resume_cannot_touch_new_generation(self):
        run_id = self.submit()
        for stage in self.runner.stages:
            if stage == 'preview_projection':
                break
            self.stage(run_id, stage)
        entered, release = threading.Event(), threading.Event()
        def slow(request, ctx):
            self.original_preview(request, ctx)
            result = self.diagnostics(ctx)
            entered.set(); release.wait(timeout=5)
            error = WorkflowError('provider_unavailable', 'Late provider failure')
            error.diagnostic_result = result
            raise error
        self.runner.handlers['preview_projection'] = slow
        operation = self.runner.register_stage('alice', run_id, 'preview_projection')
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.runner.execute_operation, 'alice', run_id, operation)
            self.assertTrue(entered.wait(timeout=5))
            self.runner.call('cancel_run', 'alice', self.control(run_id, 'cancel'))
            self.runner.call('resume_run', 'alice', self.control(run_id, 'resume', 'after-cancel'))
            before = self.store.get('alice', run_id)
            release.set(); future.result(timeout=10)
        after = self.store.get('alice', run_id)
        self.assertEqual(after['status'], 'queued'); self.assertIsNone(after['error'])
        self.assertEqual(after['generation'], before['generation'])
        self.assertEqual(after['artifacts'], before['artifacts'])


if __name__ == '__main__':
    unittest.main()
