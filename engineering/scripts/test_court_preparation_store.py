"""Exercise real shared projection, snapshot replay and server trust boundaries."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from tactical_workbench import ROOT, TacticalWorkbench


@unittest.skipUnless(shutil.which('node'), 'Node.js required')
class CourtPreparationStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        script = "import {makeV2Fixture} from './engineering/tools/player-review/tactics-v2-fixture.mjs';process.stdout.write(JSON.stringify(await makeV2Fixture()));"
        data = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=ROOT, text=True))
        self.clip, self.session, self.document = data['clip'], data['session'], data['document']
        self.tactics = TacticalWorkbench(Path(self.temp.name)); self.store = self.tactics.preparations
        self.variant = self.clip['tracking_revision']; self.preparation = self.session['courtPreparation']

    def save(self, version=0):
        return self.store.save(self.preparation, self.session, self.clip, self.variant, True, version)

    def test_immutable_snapshots_restart_and_optimistic_version(self):
        first = self.save(); self.assertEqual(first['version'], 1)
        self.save(1)
        with self.assertRaisesRegex(ValueError, '另一页面'): self.save(1)
        path = self.store.path(self.clip, self.variant, True)
        self.assertEqual(json.loads(path.with_name(path.stem + '.v1.json').read_text()), first)
        restarted = TacticalWorkbench(Path(self.temp.name))
        self.assertEqual(restarted.preparations.load(self.clip, self.variant, True)['version'], 2)
        self.assertIsNone(restarted.preparations.load(self.clip, self.variant, False)['preparation'])
        restarted.check_source(self.document, self.clip, 'workspace')

    def test_unsaved_or_modified_preparation_is_rejected_by_tactical_jobs(self):
        with self.assertRaisesRegex(ValueError, '先保存'): self.tactics.check_source(self.document, self.clip, 'workspace')
        self.save()
        for section in ('preparedByPlayer', 'rawByPlayer'):
            modified = copy.deepcopy(self.preparation); modified[section]['P1'][20]['x'] += .1
            with self.assertRaises(ValueError): self.store.save(modified, self.session, self.clip, self.variant, True, 1)
        modified = copy.deepcopy(self.document); modified['review']['courtPreparation']['preparedByPlayer']['P1'][20]['x'] += .1
        with self.assertRaisesRegex(ValueError, '先保存'): self.tactics.check_source(modified, self.clip, 'workspace')

    def test_identity_calibration_and_adopted_positions_must_match_the_saved_snapshot(self):
        self.save()
        for key in ('identity', 'calibration', 'trajectory'):
            modified = copy.deepcopy(self.document)
            if key == 'identity': modified['review']['entities'][0]['bindings'][0]['end'] -= 1
            elif key == 'calibration': modified['review']['court']['calibration'] = None
            else: modified['review']['entities'][0]['courtTrajectory'][20]['x'] += .1
            with self.assertRaises(ValueError): self.tactics.check_source(modified, self.clip, 'workspace')

    def test_confirmed_decoded_media_end_is_required(self):
        self.save()
        for duration in (None, 6.2):
            with self.assertRaisesRegex(ValueError, '片尾'): self.tactics.check_source(self.document, {**self.clip, 'mediaEndTime': duration}, 'workspace')


if __name__ == '__main__': unittest.main()
