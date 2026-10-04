"""Job boundaries use real document validation; rendering is exercised separately."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

from tactical_workbench import TacticalWorkbench, ROOT
from tactics_render import TacticsRenderer


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.tactics = TacticalWorkbench(self.folder / 'saved')
        script = "import {makePresentationDemo} from './engineering/tools/tactical-overlay/fixtures/presentation-demo.mjs';import {createTacticsDocument} from './engineering/tools/player-review/tactics-document.mjs';console.log(JSON.stringify(await createTacticsDocument((await makePresentationDemo()).review)));"
        self.doc = json.loads(subprocess.check_output([self.tactics.node, '--input-type=module', '-e', script], cwd=ROOT))
        r = self.doc['review']
        self.clip = dict(video_sha256=r['videoSha256'], tracking_fingerprint=r['trackingFingerprint'],
                         tracking_revision=r['trackingRevision'], width=r['width'], height=r['height'],
                         frames=[dict(frame=f['frame'], time=f['time'], source_frame=f['sourceFrame'], source_time=f['sourceTime']) for f in r['sourceFrameMapping']])
        self.request = dict(sample='test', document=self.doc, expectedVersion=0, options={'fps': 30},
                            documentDigest=self.tactics.run('agent-digest', document=self.doc)['digest'])

    def renderer(self, execute=None):
        result = TacticsRenderer(self.folder / 'renders', self.tactics, execute=execute)
        self.addCleanup(result.close)
        return result

    def test_stale_digest_version_and_source_rejected_before_queue(self):
        r = self.renderer()
        for changed in ({'documentDigest': 'bad'}, {'expectedVersion': 1}, {'options': {'fps': 300}}):
            with self.assertRaises(ValueError):
                r.create({**self.request, **changed}, self.clip, self.folder/'source.mp4', 'test', True)
        wrong = deepcopy(self.doc); wrong['review']['width'] += 1
        with self.assertRaises(ValueError):
            r.create({**self.request, 'document': wrong}, self.clip, self.folder/'source.mp4', 'test', True)
        self.assertEqual(r.jobs, {})

    def test_cancelled_snapshot_never_publishes_or_saves(self):
        def execute(job, _directory):
            job['cancel'].wait(5)
            raise ValueError('cancelled')
        r = self.renderer(execute)
        job = r.create(self.request, self.clip, self.folder/'source.mp4', 'test', True)
        self.doc['title'] = 'later unsaved edit'
        self.assertNotEqual(r.jobs[job['id']]['document']['title'], self.doc['title'])
        cancelled = r.cancel(job['id'], self.clip, 'test', True)
        self.assertEqual(cancelled['status'], 'cancelled')
        with self.assertRaises(ValueError):
            r.video(job['id'], self.clip, 'test', True)
        self.assertEqual(self.tactics.load(self.clip, 'test', True, 'workspace')['version'], 0)

    def test_context_and_traversal_do_not_expose_jobs(self):
        r = self.renderer(lambda job, directory: job['cancel'].wait(5))
        job = r.create(self.request, self.clip, self.folder/'source.mp4', 'test', True)
        for ident, qa, kind in ((job['id'], False, 'workspace'), (job['id'], True, 'candidate'), ('../../outside', True, 'workspace')):
            with self.assertRaises(ValueError):
                r.get(ident, self.clip, 'test', qa, kind)
        r.cancel(job['id'], self.clip, 'test', True)


if __name__ == '__main__':
    unittest.main()
