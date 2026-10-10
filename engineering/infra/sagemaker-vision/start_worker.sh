#!/bin/bash
set -euo pipefail
# Values are rendered by the deployment operator; credentials come from the instance role.
ROOT=/home/ec2-user/SageMaker/courtstory-live
VISION=/home/ec2-user/SageMaker/hks-vision
PYTHON="$VISION/runtime/bin/python"
mkdir -p "$ROOT/releases/__RELEASE__"
aws s3 cp 's3://__BUCKET__/__WORKBENCH_KEY__' "$ROOT/workbench.zip" --region us-east-1 --only-show-errors
"$PYTHON" -m zipfile -e "$ROOT/workbench.zip" "$ROOT/releases/__RELEASE__"
ln -sfn "$ROOT/releases/__RELEASE__" "$ROOT/current"
cd "$ROOT/current"
mkdir -p tmp/models tmp/court-models-v2 engineering/infra/sagemaker-vision
cp "$VISION/workspace/tmp/models/"*.pt tmp/models/
cp "$VISION/workspace/tmp/court-models-v2/best.pt" tmp/court-models-v2/
aws s3 cp 's3://__BUCKET__/__GPU_PREFIX__/worker.py' engineering/infra/sagemaker-vision/worker.py --region us-east-1 --only-show-errors
"$PYTHON" -m pip install --disable-pip-version-check boto3==1.43.108 python-dotenv==1.2.2 imageio-ffmpeg==0.6.0
FFMPEG_PATH=$("$PYTHON" -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')
ln -sfn "$FFMPEG_PATH" /usr/local/bin/ffmpeg
chown -R ec2-user:ec2-user "$ROOT"
cat > /etc/systemd/system/courtstory-gpu.service <<'UNIT'
[Unit]
Description=CourtStory SageMaker GPU worker
After=network-online.target
[Service]
User=ec2-user
WorkingDirectory=/home/ec2-user/SageMaker/courtstory-live/current
Environment=HKS_BUCKET=__BUCKET__
Environment=HKS_GPU_PREFIX=__GPU_PREFIX__
Environment=AWS_DEFAULT_REGION=us-east-1
ExecStart=/home/ec2-user/SageMaker/hks-vision/runtime/bin/python engineering/infra/sagemaker-vision/worker.py
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now courtstory-gpu
