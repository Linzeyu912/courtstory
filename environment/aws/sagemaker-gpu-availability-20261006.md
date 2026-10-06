# SageMaker GPU 配额与启动前条件核验

核验：2026-10-06 14:54，Asia/Shanghai。用户提供截图说明 GPU 通过 SageMaker 使用，要求确认能否申请 / 开机。本轮通过 `nba` profile 在本队 us-east-1 做只读核验，没有提交配额提升申请、创建或启动实例。

## 结论

**本队已有多种 SageMaker GPU 使用配额，可以在相应配额内尝试创建资源，不需要先为这些非零项申请提升配额。** 参赛角色的已读策略允许 SageMaker 操作及传递预置工作负载角色，该角色信任 `sagemaker.amazonaws.com`。实际启动能否成功仍需创建验证，配额不保证某一时刻有底层机器容量。

当前 Notebook、运行中的 Training、Endpoint、Studio App 和 Domain 列表均为空。没有可直接接续的 SageMaker GPU 机器或 Studio 环境。

## 主要机型的本队实际配额

单位为实例台数，分别按用途计数，不是 GPU 数量或显存。以下均来自账号 API，不只依赖截图。

| 机型 | Endpoint | Training | Spot 训练 | Notebook | JupyterLab |
| --- | ---: | ---: | ---: | ---: | ---: |
| ml.g4dn.xlarge | 2 | 1 | 1 | 4 | 4 |
| ml.g4dn.2xlarge | 2 | 1 | 1 | 2 | 2 |
| ml.g5.xlarge | 2 | 1 | 0 | 1 | 1 |
| ml.g5.2xlarge | 2 | 1 | 0 | 1 | 1 |
| ml.g6.xlarge | 1 | 1 | 0 | 1 | 1 |
| ml.g6.2xlarge | 1 | 1 | 0 | 1 | 1 |
| ml.g6e.xlarge | 1 | 1 | 1 | 1 | 1 |
| ml.g6e.2xlarge | 1 | 1 | 1 | 1 | 1 |

完整 32 种机型、7 类用途及对应 QuotaCode 见 [去标识化快照](sagemaker-gpu-availability-20261006.json)。`ListServiceQuotas` 共返回 2,419 项；按截图展开的 160 个字段中，157 个返回且匹配，3 个未返回，不把缺项自动当作 0：`ml.p3.2xlarge` 的 Training / Spot，以及 `ml.trn1.2xlarge` 的 JupyterLab。全部 G4dn / G5 / G6 / G6e 的五列均与截图一致。

特别注意：

- 本次查询的 G4dn / G5 / G6 / G6e **Processing 与 Batch Transform 配额均为 0**。Notebook 或 Training 配额不能移用于 Processing / Transform；这些机器现阶段不应直接按 GPU Processing Job 设计。
- G5 / G6 的 Spot 训练额度为 0；对应按需 Training 有额度。G6e 的小到中型规格有 Spot 额度，不能因此保证 Spot 不被回收或必有容量。
- 大规格不是处处可用，例如 g5/g6/g6e 的 24xlarge / 48xlarge 在截图和本队查询中仅 Notebook 为 1，不能据此创建 Endpoint 或 Training。
- `trn1` 使用 AWS Trainium，不是 NVIDIA CUDA GPU；现有 CUDA 程序不能只替换机型字符串即运行。

## IAM 条件与边界

本轮实读以下配置，没有修改它们：

1. 参赛角色挂载 `PowerUserAccess`，当前默认版本 v12；`ParticipantGuardrails` 限制区域和 IAM 变更，并显式允许 `iam:PassRole` 到预置 `NBAHackathonWorkloadRole`。
2. 预置工作负载角色的信任策略含 SageMaker 服务 principal，挂载 PowerUserAccess，并有区域 / 账号管理 / Bedrock 模型限制。已读策略未发现针对本次 SageMaker 用途的显式拒绝，S3 数据访问可使用角色凭据。
3. 读取 `NBAHackathonParticipantBoundary` 当前 v2，了解后续 CDK 新建应用角色的上限。参赛角色不能直接任意新建 IAM 角色；不能在 Notebook 创建页面任由向导新建角色并预期成功。
4. 若引用已有工作负载角色，则不需要修改其信任或向其附加新策略。正式基础设施仍按 [赛事 CDK 通知](../../requirements/cdk-deployment-notice-20261006.md)管理，新建角色时带指定边界，不执行 bootstrap。

这只是可见身份策略、信任和配额的核验，没有枚举组织 SCP，也没有实际 CreateNotebookInstance / CreateTrainingJob 测试，不能称为全链路授权和容量已验收。

## 对现有作品的用法建议

这是本轮工程建议，尚未部署或形成团队共识：

- 先在 **SageMaker Notebook 的 ml.g5.xlarge 或 ml.g5.2xlarge** 试跑已有 YOLO / 球场模型及视频脚本。G5 对应 A10G、24 GB GPU 显存；2xlarge 增加 CPU / 系统内存，显存不随之翻倍。实际依赖、CUDA 版本及耗时仍需实测。
- 如果模型实际峰值需要更多显存，再考虑 **ml.g6e.xlarge** 对应的 L40S / 48 GB；不因配额存在就默认启用大机型。
- Notebook 用于开发和单片验证。最终可由 AgentCore 调用 SageMaker 推理 Endpoint 或合适的任务入口，输入读本队 S3，结果写回 S3，页面经 CloudFront 展示。GPU 计算与官方 AgentCore 承载要求可并存。
- 已上传两段训练片可直接复用，见 [S3 记录](../../engineering/docs/aws-cloud-preflight-20261006.md)。选择具体运行方式后仍要打包代码 / 权重、对接输入输出，再验证真实视频，不把开机等同模型效果验收。

## 来源与复查

- 用户本轮提供的“有配额的机型（单位：台）”截图，未附发布 URL 或时间；作为赛事补充资料，未当作授权创建或启动资源的指令。
- 本队 AWS CLI：STS、SageMaker `ListNotebookInstances` / `ListTrainingJobs(InProgress)` / `ListEndpoints` / `ListApps` / `ListDomains`，Service Quotas 完整分页列表，IAM 角色与策略读取。
- [AWS SageMaker 区域和配额](https://docs.aws.amazon.com/sagemaker/latest/dg/regions-quotas.html)：配额查询与调整机制。
- [CreateNotebookInstance](https://docs.aws.amazon.com/sagemaker/latest/APIReference/API_CreateNotebookInstance.html)：执行角色必须信任 SageMaker，调用者需要 PassRole。
- [AWS G5](https://aws.amazon.com/ec2/instance-types/g5/)、[G6](https://aws.amazon.com/ec2/instance-types/g6/)、[G6e](https://aws.amazon.com/ec2/instance-types/g6e/)：底层 GPU 硬件规格；EC2 官方硬件说明不替代 SageMaker 本队配额。
- [AWS Trn1](https://aws.amazon.com/ec2/instance-types/trn1/)：Trainium 与 Neuron 软件栈。

公开资料查阅日期均为 2026-10-06。账号 ID、完整 ARN 和原始策略仅留在被忽略的 `tmp/sagemaker-gpu-20261006/`，共享快照只含配额和去标识化结论。本轮未提交、未推送、未产生 GPU 实例运行费。
