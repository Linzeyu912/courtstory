"""Provision one SageMaker GPU notebook using the existing workload role."""
import base64
import json
import os
from pathlib import Path

import aws_cdk as cdk
from aws_cdk import aws_sagemaker as sagemaker


def main():
    config = json.loads(Path(os.environ['HKS_SAGEMAKER_CONFIG']).read_text(encoding='utf-8-sig'))
    if config['region'] != 'us-east-1':
        raise ValueError('The competition workload must run in us-east-1.')
    app = cdk.App()
    stack = cdk.Stack(app, 'HksVisionNotebook', stack_name=config['stack_name'],
                      env=cdk.Environment(account=config['account'], region=config['region']))
    # No secret or new IAM role is included in this template.
    root = '/home/ec2-user/SageMaker/hks-vision'
    lifecycle = f'''#!/bin/bash
set -euo pipefail
TASK_ROOT={root}
mkdir -p "$TASK_ROOT"
if [ -e "$TASK_ROOT/.initial-verification-started" ]; then exit 0; fi
aws s3 cp s3://{config['bucket']}/{config['prefix']}bootstrap.zip "$TASK_ROOT/bootstrap.zip" --region us-east-1 --only-show-errors
echo '{config['bootstrap_sha256']}  '"$TASK_ROOT/bootstrap.zip" | sha256sum --check
python3 -m zipfile -e "$TASK_ROOT/bootstrap.zip" "$TASK_ROOT"
chown -R ec2-user:ec2-user "$TASK_ROOT"
touch "$TASK_ROOT/.initial-verification-started"
TASK_PYTHON=/home/ec2-user/anaconda3/bin/python
if [ ! -x "$TASK_PYTHON" ]; then TASK_PYTHON=$(command -v python3); fi
sudo -u ec2-user -H bash -c 'nohup '"$TASK_PYTHON"' {root}/bootstrap.py --bucket {config['bucket']} --prefix {config['prefix']} --notebook {config['notebook_name']} > {root}/bootstrap.log 2>&1 < /dev/null &'
'''
    setup = sagemaker.CfnNotebookInstanceLifecycleConfig(stack, 'InitialVerification',
        notebook_instance_lifecycle_config_name=config['notebook_name'] + '-setup',
        on_start=[sagemaker.CfnNotebookInstanceLifecycleConfig.NotebookInstanceLifecycleHookProperty(
            content=base64.b64encode(lifecycle.encode()).decode())])
    notebook = sagemaker.CfnNotebookInstance(stack, 'Notebook',
        notebook_instance_name=config['notebook_name'],
        instance_type=config['instance_type'],
        role_arn=f"arn:aws:iam::{config['account']}:role/NBAHackathonWorkloadRole",
        platform_identifier='notebook-al2023-v1',
        volume_size_in_gb=50,
        direct_internet_access='Enabled',
        root_access='Enabled',
        instance_metadata_service_configuration=sagemaker.CfnNotebookInstance.InstanceMetadataServiceConfigurationProperty(
            minimum_instance_metadata_service_version='2'),
        lifecycle_config_name=config['notebook_name'] + '-setup')
    notebook.add_dependency(setup)
    notebook.apply_removal_policy(cdk.RemovalPolicy.RETAIN)
    cdk.CfnOutput(stack, 'NotebookName', value=config['notebook_name'])
    cdk.CfnOutput(stack, 'InstanceType', value=config['instance_type'])
    cdk.Tags.of(stack).add('Project', 'CourtStory')
    cdk.Tags.of(stack).add('Purpose', 'vision-development')
    app.synth()


if __name__ == '__main__':
    main()
