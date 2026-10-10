"""Two CDK stacks: native EC2/AgentCore code, then CloudFront VPC delivery."""
import json
import os
from pathlib import Path
import aws_cdk as cdk

HERE = Path(__file__).resolve().parent
config = json.loads(Path(os.environ['HKS_DEPLOY_CONFIG']).read_text(encoding='utf-8'))
if 'discoveryRequired' in config and os.environ.get('HKS_ALLOW_UNVERIFIED_CONFIG') != '1':
    from prepare_rebuild import verified_discovery
    if not verified_discovery({'discoveryVerified': not config['discoveryRequired'],
                               'discoveryCapturedAt': config.get('discoveryCapturedAt')}):
        raise ValueError('Rebuild requires fresh AWS discovery; offline rehearsal may set HKS_ALLOW_UNVERIFIED_CONFIG=1')
app = cdk.App()
env = cdk.Environment(account=config['account'], region='us-east-1')
name = config['name']
boundary = f"arn:aws:iam::{config['account']}:policy/NBAHackathonParticipantBoundary"


def resource(stack, identifier, kind, properties):
    return cdk.CfnResource(stack, identifier, type=kind, properties=properties)


def allow(actions, resources, **extra):
    return {'Effect': 'Allow', 'Action': actions, 'Resource': resources, **extra}


def role(stack, identifier, principal, statements, conditions=None, managed=None):
    trust = {'Effect': 'Allow', 'Principal': {'Service': principal}, 'Action': 'sts:AssumeRole'}
    if conditions:
        trust['Condition'] = conditions
    props = {'PermissionsBoundary': boundary,
             'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [trust]},
             'Policies': [{'PolicyName': 'WorkbenchScopedAccess',
                           'PolicyDocument': {'Version': '2012-10-17', 'Statement': statements}}]}
    if managed:
        props['ManagedPolicyArns'] = managed
    return resource(stack, identifier, 'AWS::IAM::Role', props)


def output(stack, identifier, value):
    cdk.CfnOutput(stack, identifier, value=value).override_logical_id(identifier)


core = cdk.Stack(app, 'WorkbenchCore', stack_name=name + '-core', env=env)
cdk.Tags.of(core).add('Purpose', 'hks-cloud-workbench-test')
ami_parameter = cdk.CfnParameter(core, 'UbuntuImage',
    type='AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>',
    default='/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id')
objects = f"arn:aws:s3:::{config['bucket']}/{config['prefix']}/*"
agent_objects = f"arn:aws:s3:::{config['bucket']}/{config['prefix']}/agent-jobs/*"
agent_role = role(core, 'AgentRole', 'bedrock-agentcore.amazonaws.com', [
    allow('s3:GetObject', [objects]), allow('s3:PutObject', agent_objects),
    allow(['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
          f"arn:aws:logs:us-east-1:{config['account']}:log-group:/aws/bedrock-agentcore/runtimes/*")
], {'StringEquals': {'aws:SourceAccount': config['account']},
    'ArnLike': {'aws:SourceArn': f"arn:aws:bedrock-agentcore:us-east-1:{config['account']}:runtime/*"}})
runtime = resource(core, 'AgentRuntime', 'AWS::BedrockAgentCore::Runtime', {
    'AgentRuntimeName': name.replace('-', '_'),
    'PlatformVersion': 'V1',
    'AgentRuntimeArtifact': {'CodeConfiguration': {
        'Code': {'S3': {'Bucket': config['bucket'], 'Prefix': config.get('agentKey', config['prefix'] + '/release/agent.zip')}},
        'Runtime': 'PYTHON_3_12', 'EntryPoint': ['agent_main.py']}},
    'RoleArn': agent_role.get_att('Arn').to_string(),
    'NetworkConfiguration': {'NetworkMode': 'PUBLIC'}, 'ProtocolConfiguration': 'HTTP',
    'LifecycleConfiguration': {'IdleRuntimeSessionTimeout': 60, 'MaxLifetime': 600},
    'EnvironmentVariables': {'HKS_BUCKET': config['bucket'], 'HKS_PREFIX': config['prefix'],
                            'HKS_PROVIDER_KEY': config.get('providerKey', config['prefix'] + '/secrets/provider.json')}
})
runtime_arn = runtime.get_att('AgentRuntimeArn').to_string()
ec2_role = role(core, 'Ec2Role', 'ec2.amazonaws.com', [
    allow('polly:SynthesizeSpeech', '*'),
    allow('s3:GetObject', [objects, f"arn:aws:s3:::{config['bucket']}/workbench/datasets/broadcastcode-training-20261005/*"]),
    allow('s3:PutObject', [agent_objects, f"arn:aws:s3:::{config['bucket']}/{config['prefix']}/workspace/*"]),
    allow(['s3:GetObject', 's3:PutObject'], f"arn:aws:s3:::{config['bucket']}/{config['prefix']}/gpu/*"),
    allow(['bedrock-agentcore:InvokeAgentRuntime', 'bedrock-agentcore:StopRuntimeSession'], [runtime_arn, runtime_arn + '/*'])
], managed=['arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'])
profile = resource(core, 'Ec2Profile', 'AWS::IAM::InstanceProfile', {'Roles': [ec2_role.ref]})
ingress = {'IpProtocol': 'tcp', 'FromPort': 8080, 'ToPort': 8080}
if config.get('cloudfrontSecurityGroup'):
    ingress['SourceSecurityGroupId'] = config['cloudfrontSecurityGroup']
else:
    ingress['CidrIp'] = config['vpcCidr']  # No public ingress; restrict to CF-managed SG after creation.
sg = resource(core, 'Ec2SecurityGroup', 'AWS::EC2::SecurityGroup', {
    'VpcId': config['vpc'], 'GroupDescription': 'CloudFront private origin for native workbench',
    'SecurityGroupIngress': [ingress], 'SecurityGroupEgress': [{'IpProtocol': '-1', 'CidrIp': '0.0.0.0/0'}]})
bootstrap = (HERE / 'bootstrap.sh').read_text(encoding='utf-8')
values = {'BUCKET': config['bucket'], 'PREFIX': config['prefix'], 'RELEASE': config['release'],
          'CODE_HASH': config['codeHash'], 'RUNTIME_ARN': runtime_arn,
          'NODE_SHA': config['nodeSha'], 'WORKBENCH_KEY': config.get('workbenchKey', config['prefix'] + '/release/workbench.zip'),
          'WORKBENCH_SHA': config.get('workbenchSha256', ''),
          'STATE_KEY': config.get('stateKey', ''), 'STATE_SHA': config.get('stateSha256', ''),
          'ENV_KEY': config.get('envKey', ''), 'GPU_PREFIX': config.get('gpuPrefix', '')}
for key, value in values.items():
    bootstrap = bootstrap.replace('__' + key + '__', value)
instance = resource(core, 'Instance', 'AWS::EC2::Instance', {
    'ImageId': ami_parameter.value_as_string, 'InstanceType': 't3.large',
    'IamInstanceProfile': profile.ref,
    'NetworkInterfaces': [{'DeviceIndex': '0', 'SubnetId': config['subnet'],
                           'AssociatePublicIpAddress': True, 'GroupSet': [sg.ref]}],
    'BlockDeviceMappings': [{'DeviceName': '/dev/sda1', 'Ebs': {'VolumeSize': 40, 'VolumeType': 'gp3', 'Encrypted': True, 'DeleteOnTermination': True}}],
    'MetadataOptions': {'HttpTokens': 'required', 'HttpEndpoint': 'enabled'},
    'UserData': cdk.Fn.base64(bootstrap),
    'Tags': [{'Key': 'Name', 'Value': name}]
})
output(core, 'InstanceId', instance.ref)
output(core, 'PrivateDns', instance.get_att('PrivateDnsName').to_string())
output(core, 'RuntimeArn', runtime_arn)
output(core, 'RuntimeId', runtime.get_att('AgentRuntimeId').to_string())

if config.get('instanceId'):
    delivery = cdk.Stack(app, 'WorkbenchDelivery', stack_name=name + '-delivery', env=env)
    cdk.Tags.of(delivery).add('Purpose', 'hks-cloud-workbench-test')
    origin = resource(delivery, 'VpcOrigin', 'AWS::CloudFront::VpcOrigin', {'VpcOriginEndpointConfig': {
        'Name': name, 'Arn': f"arn:aws:ec2:us-east-1:{config['account']}:instance/{config['instanceId']}",
        'HTTPPort': 8080, 'HTTPSPort': 443, 'OriginProtocolPolicy': 'http-only',
        'OriginSSLProtocols': ['TLSv1.2']}})
    distro = resource(delivery, 'Distribution', 'AWS::CloudFront::Distribution', {'DistributionConfig': {
        'Enabled': True, 'Comment': 'Authenticated HKS workbench native EC2 test',
        'PriceClass': 'PriceClass_100', 'HttpVersion': 'http2',
        'Origins': [{'Id': 'workbench', 'DomainName': config['privateDns'],
                     'VpcOriginConfig': {'VpcOriginId': origin.get_att('Id').to_string(), 'OriginReadTimeout': 120}}],
        'DefaultCacheBehavior': {'TargetOriginId': 'workbench', 'ViewerProtocolPolicy': 'redirect-to-https',
            'AllowedMethods': ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
            'CachedMethods': ['GET', 'HEAD'], 'Compress': True,
            'CachePolicyId': config['cachePolicyId'],
            'OriginRequestPolicyId': config['originRequestPolicyId']},
        'ViewerCertificate': {'CloudFrontDefaultCertificate': True}}})
    output(delivery, 'DistributionId', distro.ref)
    output(delivery, 'Domain', distro.get_att('DomainName').to_string())
app.synth()
