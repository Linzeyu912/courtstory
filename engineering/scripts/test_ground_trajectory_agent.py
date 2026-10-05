"""Regressions found by running the dedicated Qwen agent on official video."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from ground_trajectory_agent import GroundTrajectoryAgent


class GroundJobTests(unittest.TestCase):
    def test_first_job_is_persisted_before_worker_starts_and_survives_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            tactics = Mock(node=None)
            tactics.run.return_value = {'digest': 'preparation-digest'}
            clip = {'video_sha256': 'a'*64, 'tracking_fingerprint': 'b'*64,
                    'tracking_revision': 'test', 'frames': [{'frame': 0, 'time': 0}]}
            session = {'version': 1, 'videoHash': clip['video_sha256'], 'maxGapSeconds': 0,
                       'cuts': [], 'entities': [{'id': f'P{i}', 'role': 'player', 'anchors': []}
                                               for i in range(1, 11)],
                       'courtPreparation': {'rawByPlayer': {'P1': [{'x': 1, 'y': 2}]}}}
            request = {'session': session, 'clientRevision': 0, 'entityIds': ['P1'],
                       'range': {'startFrame': 0, 'endFrameExclusive': 1}}
            agent = GroundTrajectoryAgent(Path(folder)/'jobs', tactics)
            try:
                with patch.object(agent, 'status', return_value={'available': True}), \
                     patch.object(agent.pool, 'submit') as submit:
                    job = agent.create(request, clip, Path(folder)/'video.mp4', 'test', True)
                    saved = json.loads((Path(folder)/'jobs'/job['jobId']/'job.json').read_text(encoding='utf-8'))
                    self.assertEqual(saved['status'], 'queued')
                    self.assertEqual(saved['request'], request)
                    submit.assert_called_once()
            finally:
                agent.close()
            restarted = GroundTrajectoryAgent(Path(folder)/'jobs', tactics)
            try:
                restored = restarted.get(job['jobId'], clip, 'test', True)
                self.assertEqual(restored['status'], 'interrupted')
                self.assertEqual(restored['base'], job['base'])
            finally:
                restarted.close()


if __name__ == '__main__':
    unittest.main()
