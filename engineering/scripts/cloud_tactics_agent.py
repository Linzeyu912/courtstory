"""AgentCore execution adapter; existing workbench validation remains authoritative."""
import base64
import json
import os
import uuid
from pathlib import Path


class CloudTacticsExecutor:
    def __init__(self):
        import boto3
        from botocore.config import Config
        self.bucket = os.environ['HKS_BUCKET']
        self.prefix = os.environ['HKS_PREFIX'].rstrip('/') + '/agent-jobs/'
        self.arn = os.environ['HKS_AGENT_RUNTIME']
        session = boto3.Session(region_name='us-east-1')
        self.s3 = session.client('s3')
        self.runtime = session.client('bedrock-agentcore', config=Config(
            connect_timeout=10, read_timeout=300, retries={'total_max_attempts': 1}))

    def status(self):
        return {'available': True, 'provider': 'agentcore-bedrock', 'sandbox': 'cloud',
                'model': 'qwen.qwen3-vl-235b-a22b', 'reasoningEffort': 'default',
                'message': '已配置云端 Agent；实际视觉调用与候选校验以任务结果为准。'}

    def __call__(self, *, job, directory, schema, result, images, prompt):
        if job['cancel'].is_set():
            raise ValueError('任务已取消。')
        token = uuid.uuid4().hex
        key = self.prefix + token + '/input.json'
        payload = {'prompt': prompt, 'schema': json.loads(Path(schema).read_text(encoding='utf-8')),
                   'images': [base64.b64encode(Path(p).read_bytes()).decode('ascii') for p in images]}
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        if len(body) > 48 * 1024 * 1024:
            raise ValueError('云端分析输入超过 48 MiB。')
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=body,
                           ContentType='application/json', ServerSideEncryption='AES256', IfNoneMatch='*')
        session_id = str(uuid.uuid4())
        try:
            response = self.runtime.invoke_agent_runtime(agentRuntimeArn=self.arn,
                runtimeSessionId=session_id, qualifier='DEFAULT', contentType='application/json',
                payload=json.dumps({'inputKey': key}).encode())
            with response['response'] as stream:
                outcome = json.loads(stream.read())
            if 'error' in outcome:
                raise ValueError('云端 Agent 未完成：' + str(outcome['error'])[:500])
            expected = self.prefix + token + '/result.json'
            if outcome.get('resultKey') != expected:
                raise ValueError('云端结果来源不匹配。')
            with self.s3.get_object(Bucket=self.bucket, Key=expected)['Body'] as stream:
                candidate = json.loads(stream.read())
            Path(result).write_text(json.dumps(candidate, ensure_ascii=False), encoding='utf-8')
            return candidate
        finally:
            try:
                self.runtime.stop_runtime_session(agentRuntimeArn=self.arn,
                    runtimeSessionId=session_id, qualifier='DEFAULT')
            except Exception:
                pass  # Do not replace the real invocation error with a cleanup error.
