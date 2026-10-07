"""Trusted startup configuration and hash-verified local delivery export."""
import json
import os
from pathlib import Path
from unittest.mock import patch
import unittest

from agent_workflow_cli import export_delivery
from agent_workflow_contract import WorkflowError
from agent_workflow_runner import production_handlers
from agent_workflow_store import file_digest
from test_agent_workflow_runner import WorkflowFixture


class CLITests(WorkflowFixture):
    def test_detector_configuration_comes_from_trusted_startup_only(self):
        with patch.dict(os.environ, {'AGENT_TACTICS_DETECTOR_PYTHON': 'trusted-python',
                                     'AGENT_TACTICS_DETECTOR_WEIGHTS': 'trusted-weights'}):
            with patch('agent_tactics_tools.build_tool_handlers', return_value={'testOnly': True}) as factory:
                self.assertEqual(production_handlers(), {'testOnly': True})
                factory.assert_called_once_with(detector_python='trusted-python', detector_weights='trusted-weights')
            with patch('agent_tactics_tools.build_tool_handlers', return_value={}) as factory:
                production_handlers(detector_python='explicit-python', detector_weights='explicit-weights')
                factory.assert_called_once_with(detector_python='explicit-python', detector_weights='explicit-weights')

    def test_export_verified_delivery_without_reexecuting_and_no_overwrite(self):
        for stage, kind in (('prepare_players', 'player_evidence'), ('analyze_play', 'analysis_revision'),
                            ('commit_candidate', 'editable_document'), ('render_projected_video', 'video')):
            original = self.runner.handlers[stage]
            def renamed(request, ctx, handler=original, public_kind=kind):
                result = handler(request, ctx)
                result['artifacts'][0]['kind'] = public_kind
                if public_kind == 'editable_document':
                    Path(result['artifacts'][0]['path']).write_text(json.dumps({'version': 1, 'document': {'testOnly': True, 'editable': 'native payload'}}))
                return result
            self.runner.handlers[stage] = renamed
        run_id = self.submit()
        self.assertEqual(self.runner.run('alice', run_id)['status'], 'succeeded')
        counts = dict(self.calls)
        target = self.root / 'delivery'
        delivery = export_delivery(self.runner, 'alice', run_id, target)
        self.assertEqual(counts, self.calls)
        self.assertEqual({item['name'] for item in delivery['files']}, {'result.mp4', 'document.json', 'native-document.json',
            'player-evidence.json', 'analysis-revision.json', 'coverage.json', 'projection.json', 'quality-report.json'})
        for item in delivery['files']:
            self.assertEqual(file_digest(target / item['name']), item['sha256'])
        self.assertEqual(json.loads((target / 'run.json').read_text())['runId'], run_id)
        self.assertEqual(json.loads((target / 'native-document.json').read_text()),
                         json.loads((target / 'document.json').read_text())['document'])
        self.assertEqual(len(json.loads((target / 'quality-report.json').read_text())['checks']), 2)
        with self.assertRaises(WorkflowError) as error:
            export_delivery(self.runner, 'alice', run_id, target)
        self.assertEqual(error.exception.reason_code, 'version_conflict')
        with self.assertRaises(WorkflowError):
            export_delivery(self.runner, 'bob', run_id, self.root / 'unauthorized')

    def add_repair_source_frames(self, *, mismatched=False):
        original = self.runner.handlers['analyze_play']
        def with_frames(request, ctx):
            result = original(request, ctx)
            frames = []
            for index in (1, 3):
                path = ctx.attempt_dir / f'asset-{index:06d}.jpg'
                path.write_bytes(b'synthetic JPEG export fixture ' + bytes([index]))
                frames.append({'path': str(path), 'sha256': file_digest(path), 'assetFrame': index,
                               'sourceFrame': 900 + index * 2, 'pts': index * 1001, 'timeBase': '1/30000',
                               'time': index * 1001 / 30000})
                result['artifacts'].append({'path': str(path), 'kind': 'repair_source_frame', 'mediaType': 'image/jpeg'})
            if mismatched:
                frames[1]['sha256'] = '0' * 64
            manifest = ctx.attempt_dir / 'repair-source-frames.json'
            manifest.write_text(json.dumps({'schemaVersion': '1.0', 'sourceRef': ctx.source_ref,
                'frames': frames, 'allAnalysisFrames': [0, 1, 3, 4], 'trackingReused': True}), encoding='utf-8')
            result['artifacts'].append({'path': str(manifest), 'kind': 'repair_evidence_frames'})
            return result
        self.runner.handlers['analyze_play'] = with_frames

    def test_export_repair_frame_manifest_and_images_with_relative_hash_index(self):
        self.add_repair_source_frames()
        run_id = self.submit()
        self.assertEqual(self.runner.run('alice', run_id)['status'], 'succeeded')
        counts = dict(self.calls)
        result = export_delivery(self.runner, 'alice', run_id, self.root / 'repair-delivery')
        self.assertEqual(self.calls, counts)
        files = {item['name']: item for item in result['files']}
        self.assertEqual(files['repair-source-frames.json']['kind'], 'repair_evidence_frames')
        target = self.root / 'repair-delivery'
        manifest = json.loads((target / 'repair-source-frames.json').read_text(encoding='utf-8'))
        for frame in manifest['frames']:
            item = files[f"repair-source-frames/asset-{frame['assetFrame']:06d}.jpg"]
            self.assertEqual(item['sha256'], frame['sha256'])
            self.assertEqual(file_digest(target / item['name']), item['sha256'])
            self.assertEqual(item['sourceFrame'], frame['sourceFrame'])
            self.assertEqual(item['pts'], frame['pts'])
            self.assertEqual(item['timeBase'], frame['timeBase'])
            self.assertEqual(item['derivedFrom'], 'repair-source-frames.json')
        self.assertEqual(json.loads((target / 'delivery.json').read_text(encoding='utf-8'))['files'], result['files'])

    def test_export_rejects_repair_manifest_image_mismatch(self):
        self.add_repair_source_frames(mismatched=True)
        run_id = self.submit()
        self.runner.run('alice', run_id)
        with self.assertRaises(WorkflowError) as error:
            export_delivery(self.runner, 'alice', run_id, self.root / 'bad-repair-delivery')
        self.assertEqual(error.exception.reason_code, 'output_invalid')

    def test_failed_package_keeps_old_history_and_evidence_without_final_delivery(self):
        self.add_repair_source_frames()
        for stage, kind in (('inspect_clip', 'source_snapshot'), ('prepare_players', 'player_evidence'),
                            ('build_player_annotations', 'candidateRef')):
            original = self.runner.handlers[stage]
            def renamed(request, ctx, handler=original, artifact_kind=kind):
                result = handler(request, ctx)
                result['artifacts'][0]['kind'] = artifact_kind
                return result
            self.runner.handlers[stage] = renamed
        original = self.runner.handlers['preview_projection']
        def failed(request, ctx):
            result = original(request, ctx)
            report = ctx.attempt_dir / 'independent-review.json'
            report.write_text(json.dumps({'verdict': 'fail', 'pass': False, 'testOnly': True}), encoding='utf-8')
            result['outputs'].update({'pass': False, 'independentReview': {'pass': False}})
            result['artifacts'].append({'path': str(report), 'kind': 'independent_review'})
            # Even a registered candidate must never turn into a final export.
            result['artifacts'].append({'path': str(report), 'kind': 'editable_document'})
            return result
        self.runner.handlers['preview_projection'] = failed
        run_id = self.submit()
        self.assertEqual(self.runner.run('alice', run_id)['status'], 'needs_attention')
        self.runner.call('resume_run', 'alice', self.control(run_id, 'resume', 'diagnostic-history', retryStages=['analyze_play']))
        self.runner.run('alice', run_id)
        before, counts = self.store.get('alice', run_id), dict(self.calls)
        target = self.root / 'failed-package'
        result = export_delivery(self.runner, 'alice', run_id, target)
        self.assertEqual(result['status'], 'needs_attention')
        self.assertIs(result['accepted'], False)
        self.assertIsNone(result['finalDocument']); self.assertIsNone(result['finalVideo'])
        self.assertFalse((target / 'document.json').exists()); self.assertFalse((target / 'result.mp4').exists())
        self.assertEqual(self.calls, counts)
        after = self.store.get('alice', run_id)
        for key in ('revision', 'generation', 'budget', 'status'):
            self.assertEqual(after[key], before[key])
        kinds = {item['kind'] for item in result['files']}
        self.assertTrue({'source_snapshot', 'player_evidence', 'candidateRef', 'independent_review',
                         'repair_source_frame', 'repair_evidence_frames'} <= kinds)
        self.assertNotIn('editable_document', kinds)
        for item in result['files']:
            self.assertEqual(file_digest(target / item['name']), item['sha256'])
            self.assertIs(item['accepted'], False)
        history = json.loads((target / 'failure-history.json').read_text(encoding='utf-8'))
        failed_ops = [op for op in history['operations'] if op['stage'] == 'preview_projection']
        self.assertEqual(len(failed_ops), 2)
        self.assertTrue(all(op['status'] == 'failed' and op['exportedArtifactIds'] for op in failed_ops))
        self.assertFalse(failed_ops[0]['valid']); self.assertTrue(failed_ops[1]['valid'])
        manifest = json.loads((target / 'manifest.json').read_text(encoding='utf-8'))
        self.assertIs(manifest['accepted'], False)
        self.assertIsNone(manifest['finalDocument']); self.assertIsNone(manifest['finalVideo'])
        self.assertTrue(any(item['name'] == 'quality-report.json' for item in manifest['files']))
        quality = json.loads((target / 'quality-report.json').read_text(encoding='utf-8'))
        self.assertIs(quality['accepted'], False)
        self.assertNotIn('pass', quality)
        self.assertEqual({item['generation'] for item in quality['checks']}, {1, 2})
        self.assertEqual(len([item for item in quality['checks'] if item['kind'] == 'independent_review']), 2)
        with self.assertRaises(WorkflowError):
            export_delivery(self.runner, 'bob', run_id, self.root / 'foreign-failure')

    def test_failed_export_omits_corrupt_or_foreign_producer_artifacts_and_empty_cancel_exports(self):
        run_id = self.submit()
        self.stage(run_id, 'inspect_clip')
        self.runner.call('cancel_run', 'alice', self.control(run_id, 'cancel'))
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM artifacts WHERE run_id=?', (run_id,)).fetchone()
            meta = json.loads(row['metadata']); meta['kind'] = 'source_snapshot'
            meta['producerOperationId'] = 'another-operation'
            db.execute('UPDATE artifacts SET metadata=? WHERE id=?', (json.dumps(meta), row['id']))
        result = export_delivery(self.runner, 'alice', run_id, self.root / 'untrusted-package')
        self.assertFalse(any(item['kind'] == 'source_snapshot' for item in result['files']))
        self.assertEqual(result['omittedArtifacts'][0]['artifactId'], row['id'])
        with self.store.transaction() as db:
            meta['producerOperationId'] = row['operation_id']
            db.execute('UPDATE artifacts SET metadata=? WHERE id=?', (json.dumps(meta), row['id']))
        Path(row['path']).write_bytes(b'corrupt registered bytes')
        result = export_delivery(self.runner, 'alice', run_id, self.root / 'corrupt-package')
        self.assertFalse(any(item['kind'] == 'source_snapshot' for item in result['files']))
        self.assertTrue(result['omittedArtifacts'])
        self.request['idempotencyKey'] = 'empty-cancel'
        empty_id = self.submit()
        self.runner.call('cancel_run', 'alice', self.control(empty_id, 'cancel'))
        result = export_delivery(self.runner, 'alice', empty_id, self.root / 'empty-package')
        self.assertEqual(result['status'], 'cancelled')
        self.assertEqual({item['name'] for item in result['files']},
                         {'run.json', 'error.json', 'failure-history.json', 'quality-report.json', 'manifest.json'})
        self.assertEqual(json.loads((self.root / 'empty-package' / 'quality-report.json').read_text(encoding='utf-8'))['checks'], [])


if __name__ == '__main__':
    unittest.main()
