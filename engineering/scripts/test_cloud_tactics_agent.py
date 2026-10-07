import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock

from cloud_tactics_agent import CloudTacticsExecutor


class CloudAdapterTests(unittest.TestCase):
    def executor(self):
        value = CloudTacticsExecutor.__new__(CloudTacticsExecutor)
        value.bucket, value.prefix, value.arn = 'test-bucket', 'test/agent-jobs/', 'test-runtime'
        value.s3, value.runtime = Mock(), Mock()
        return value

    def inputs(self, root):
        (root / 'schema.json').write_text('{}')
        (root / 'image.jpg').write_bytes(b'fixture')
        return dict(job={'cancel': threading.Event()}, directory=root, schema=root / 'schema.json',
                    result=root / 'result.json', images=[root / 'image.jpg'], prompt='fixture')

    def test_cancellation_prevents_upload_and_invoke(self):
        value = self.executor()
        with tempfile.TemporaryDirectory() as folder:
            args = self.inputs(Path(folder))
            args['job']['cancel'].set()
            with self.assertRaises(ValueError):
                value(**args)
        value.s3.put_object.assert_not_called()
        value.runtime.invoke_agent_runtime.assert_not_called()

    def test_mismatched_result_key_is_rejected_and_session_stopped(self):
        value = self.executor()
        value.runtime.invoke_agent_runtime.return_value = {'response': io.BytesIO(b'{"resultKey":"other/private.json"}')}
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, '来源不匹配'):
                value(**self.inputs(Path(folder)))
        value.s3.get_object.assert_not_called()
        value.runtime.stop_runtime_session.assert_called_once()

    def test_candidate_is_read_from_matching_task_and_saved(self):
        value = self.executor()
        def invoke(**request):
            key = json.loads(request['payload'])['inputKey'].replace('/input.json', '/result.json')
            return {'response': io.BytesIO(json.dumps({'resultKey': key}).encode())}
        value.runtime.invoke_agent_runtime.side_effect = invoke
        value.s3.get_object.return_value = {'Body': io.BytesIO(b'{"schemaVersion":1}')}
        with tempfile.TemporaryDirectory() as folder:
            args = self.inputs(Path(folder))
            self.assertEqual(value(**args), {'schemaVersion': 1})
            self.assertEqual(json.loads(args['result'].read_text()), {'schemaVersion': 1})
        value.runtime.stop_runtime_session.assert_called_once()


if __name__ == '__main__':
    unittest.main()
