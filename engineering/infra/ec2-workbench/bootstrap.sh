#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip ffmpeg fonts-noto-cjk curl unzip
mkdir -p /opt/hks/releases/__RELEASE__ /etc/hks
id hks >/dev/null 2>&1 || useradd --system --home /opt/hks --shell /usr/sbin/nologin hks
cd /tmp
curl --fail --silent --show-error -O https://nodejs.org/dist/v22.19.0/node-v22.19.0-linux-x64.tar.xz
echo '__NODE_SHA__  node-v22.19.0-linux-x64.tar.xz' | sha256sum --check
tar -xJf node-v22.19.0-linux-x64.tar.xz -C /usr/local --strip-components=1
python3 -m venv /opt/hks/venv
/opt/hks/venv/bin/pip install --disable-pip-version-check boto3==1.43.108
/opt/hks/venv/bin/python - <<'PY'
import boto3, hashlib
from pathlib import Path
boto3.client('s3',region_name='us-east-1').download_file('__BUCKET__','__WORKBENCH_KEY__','/tmp/workbench.zip')
expected = '__WORKBENCH_SHA__'
if expected:
    with Path('/tmp/workbench.zip').open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == expected, 'Workbench ZIP digest mismatch'
PY
unzip -q /tmp/workbench.zip -d /opt/hks/releases/__RELEASE__
ln -sfn /opt/hks/releases/__RELEASE__ /opt/hks/current
cd /opt/hks/current
/opt/hks/venv/bin/pip install --disable-pip-version-check -r engineering/requirements-review.txt boto3==1.43.108 opencv-python-headless scipy
npm install --prefix /opt/hks/node-deps --omit=dev --no-audit --no-fund sharp@0.34.5
npm ci --prefix engineering/tools/player-review/agents --omit=dev --no-audit --no-fund
/opt/hks/venv/bin/python - <<'PY'
import json, boto3
from pathlib import Path
s3 = boto3.client('s3',region_name='us-east-1')
for item in json.loads(Path('cloud-release.json').read_text())['videos']:
    target = Path(item['path'])
    target.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file('__BUCKET__',item['key'],str(target))
    import hashlib
    with target.open('rb') as stream:
        actual = hashlib.file_digest(stream,'sha256').hexdigest()
    assert actual == item['sha256'], 'Video digest mismatch'
Path('/etc/hks/gateway.json').write_text(json.dumps({
    'origin': '', 'codeHash': '__CODE_HASH__', 'bucket': '__BUCKET__',
    'prefix': '__PREFIX__', 'runtimeArn': '__RUNTIME_ARN__', 'release': '__RELEASE__'}))
if '__ENV_KEY__':
    s3.download_file('__BUCKET__', '__ENV_KEY__', '/etc/hks/product.env')
else:
    Path('/etc/hks/product.env').touch()
PY
if [ -n '__STATE_KEY__' ]; then
  /opt/hks/venv/bin/python - <<'PY'
import boto3, hashlib
from pathlib import Path
expected = '__STATE_SHA__'
assert len(expected) == 64, 'State ZIP SHA-256 required'
boto3.client('s3',region_name='us-east-1').download_file('__BUCKET__','__STATE_KEY__','/tmp/hks-state.zip')
with Path('/tmp/hks-state.zip').open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == expected, 'State ZIP digest mismatch'
PY
  /opt/hks/venv/bin/python engineering/infra/ec2-workbench/restore_bootstrap.py --archive /tmp/hks-state.zip --target /opt/hks/current
fi
cat > /etc/hks/runtime.env <<'ENV'
AWS_DEFAULT_REGION=us-east-1
HKS_BUCKET=__BUCKET__
HKS_PREFIX=__PREFIX__
HKS_AGENT_RUNTIME=__RUNTIME_ARN__
TACTICS_SHARP_MODULE=/opt/hks/node-deps/node_modules/sharp
NODE_PATH=/opt/hks/node-deps/node_modules
HKS_GPU_PREFIX=__GPU_PREFIX__
QWEN_TTS_VOICE=anmingyuan_v3.1
QWEN_TTS_MODEL=qwen-audio-3.1-tts-flash
ENV
chown -R hks:hks /opt/hks
chown root:hks /etc/hks/gateway.json /etc/hks/runtime.env /etc/hks/product.env
chmod 640 /etc/hks/gateway.json /etc/hks/runtime.env /etc/hks/product.env
cat > /etc/systemd/system/hks-workbench.service <<'UNIT'
[Unit]
Description=HKS native workbench
After=network-online.target
[Service]
User=hks
Group=hks
WorkingDirectory=/opt/hks/current
EnvironmentFile=/etc/hks/runtime.env
ExecStart=/opt/hks/venv/bin/python engineering/scripts/serve_player_review.py --library cloud-library.json --port 8876 --state-file artifacts/cloud-state.json --trim-root artifacts/cloud-trims --import-cache artifacts/cloud-imports --inference-python /opt/hks/venv/bin/python --tactics-agent-max-images 4 --env-file /etc/hks/product.env --identity-agent-provider openrouter
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/hks-gateway.service <<'UNIT'
[Unit]
Description=HKS authenticated CloudFront gateway
After=hks-workbench.service network-online.target
[Service]
User=hks
Group=hks
WorkingDirectory=/opt/hks/current
EnvironmentFile=/etc/hks/runtime.env
ExecStart=/opt/hks/venv/bin/python engineering/infra/ec2-workbench/gateway.py
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
trap 'systemctl stop hks-gateway hks-workbench || true' ERR
systemctl enable --now hks-workbench hks-gateway
for attempt in $(seq 1 90); do
  if curl --fail --silent --connect-timeout 2 --max-time 5 http://127.0.0.1:8876/api/library -o /tmp/hks-ready-library.json; then
    /opt/hks/venv/bin/python -c "import json; assert json.load(open('/tmp/hks-ready-library.json'))['samples'], 'No samples after bootstrap'"
    echo HKS_BOOTSTRAP_COMPLETE
    trap - ERR
    exit 0
  fi
  sleep 2
done
systemctl stop hks-gateway hks-workbench || true
echo HKS_BOOTSTRAP_FAILED >&2
exit 1
