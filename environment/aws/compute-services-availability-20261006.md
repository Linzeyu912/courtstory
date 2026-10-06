# ECS / Fargate、EC2、SQS 与 SageMaker 可用性核验

采集：2026-10-06 16:02，Asia/Shanghai。范围：用户询问云端计算与本地电脑的区别，要求实读赛事提供的服务，确认 ECS/Fargate、SQS 和 SageMaker。只读核验，没有创建、启动、修改或删除云资源。

后续进展：同日 20:25 的[服务实测](services-live-audit-20261006.md)已实际运行 ECS/Fargate、CPU EC2 和 SQS 消息链路。本文件保留 16:02 的只读证据，不能用其中“尚未运行”覆盖晚间测试；SageMaker GPU 仍仅完成条件检查。

## 官方提供了什么

本轮在浏览器中重新打开 [Rules & Quick Start](https://csdn.feishu.cn/docx/Y21TdJqrHopofmx2w21cmqHLnLb)，页面显示最近修改为 10 月 5 日，实读第一、二、三、五、六节：

- 第一节要求 AgentCore 承载智能体，CloudFront 对外发布并提供 Web 交互，CDK 定义基础设施；资源使用赛事账号的 us-east-1。
- 第二、三节说明提交 CloudFront URL；人工评分通过该链接看作品，机器评分依据代码仓库重跑工程链路。
- 第三节明确偏重 AWS 原生托管服务与有效使用深度；这不构成对某种架构的具体分数保证，也没有禁止 CPU EC2。
- 第六节计算服务列出 Lambda、ECS、Batch、EC2；编排列出 Step Functions、SQS、SNS、EventBridge。
- 第六节确认 EC2 GPU 配额为 0，GPU 路线通过 SageMaker，支持若干 g4dn / g5 / g6 / g6e 规格，实际资源不保证。

同时实读 [赛事 AWS 服务示例](https://du5imhgxabl0d.cloudfront.net/services)：

| 导航位置 | 已读页面 | 直接确认的内容 |
| --- | --- | --- |
| 计算 | Amazon EC2 | 云端虚拟服务器，自行控制操作系统与运行环境 |
| 计算 | Amazon ECS | 明确支持 EC2 与 Fargate；提供 Fargate CLI、CDK 示例 |
| Serverless | Amazon SQS | 托管任务队列、可见性超时、失败隔离及幂等注意事项 |
| AI / ML | Amazon SageMaker | 模型开发、训练与推理端点，含 CDK 示例 |
| 网络 | Amazon CloudFront | 源站可为 S3、ALB、API Gateway 或 HTTP 服务 |

示例页注明练习用途，不能整段复制就称本队生产配置。尤其 CDK 通用示例里的 bootstrap 不适用于本队，继续执行 [官方补充通知](../../requirements/cdk-deployment-notice-20261006.md)的“不要 bootstrap”。SageMaker 页面中的 Serverless 示例也不能直接视为当前 CUDA 模型的 GPU 部署方案。

## 本队账号实际查询

本机 AWS CLI 2.37.9，profile 为 nba，区域为 us-east-1；STS 确认角色为 NBAHackathonParticipantRole。以下是本轮直接 API 返回结果的整理，不是从服务目录推测：

| 项目 | API 结果 | 能确认的边界 |
| --- | --- | --- |
| ECS | ListClusters 成功，clusterArns 为空数组 | ECS 列表可读；未部署集群 |
| Fargate | DescribeCapacityProviders 返回 FARGATE、FARGATE_SPOT，均为 ACTIVE，failures 为空 | 计算提供方可查询且处于 ACTIVE；没有实际运行任务 |
| Fargate 配额 | 按需 vCPU 140；Spot vCPU 140 | 区域配额上限，不代表免费额度或当时空闲容量 |
| CPU EC2 配额 | Standard 按需 256 vCPU（L-1216C47A） | CPU 路线有配额基础；未指定和启动具体机型 |
| EC2 GPU 配额 | G / VT 按需 0（L-DB2E81BA） | 该 GPU 配额组不能直接开机；其他 GPU 限制依据赛事原文 |
| SQS | ListQueues 命令成功；显式查询返回 QueueUrls=null、NextToken=null | 本次未返回队列 URL，也无续页；没有试创建、发送或消费消息 |
| SageMaker 列表 | NotebookInstances=[]、Endpoints=[] | 列表可读，当前无可接续的 Notebook 或推理端点 |
| ml.g5.xlarge | Endpoint 2（L-1928E07B）；Notebook 1（L-E8917BB7）；Processing 0（L-BE792A7A） | 用途独立计额；Notebook 额度不能用于 Processing |

SQS 最初的默认输出及取消自动分页后的空响应均没有输出正文；再使用 `--query '{QueueUrls:QueueUrls,NextToken:NextToken}'` 得到上述结构。没有把空标准输出单独当作服务故障。完整 SageMaker 矩阵仍见 [此前核验](sagemaker-gpu-availability-20261006.md)，本轮只重查表中 G5 三项。

## 权限检查

本轮读取参赛角色、全部内联策略名称及其正文、挂载策略及默认版本，还有应用边界策略的当前版本：

- 参赛角色挂载 PowerUserAccess，内联策略为 ParticipantGuardrails；角色本身未返回 PermissionsBoundary 属性。
- ECS、SQS、SageMaker 操作属于已读 PowerUserAccess 的允许范围；在 us-east-1 下，本次读取的 ParticipantGuardrails 和 NBAHackathonParticipantBoundary 未发现对这三类服务整体的显式拒绝。
- 参赛身份直接创建 / 修改 IAM 受到显式限制；PassRole 只显式允许预置工作负载角色，不能假设通过向导创建任意新角色可以成功。
- 应用边界自身不授予业务权限。正式资源仍经赛事允许的 CDK 部署链创建，并附带指定边界；不更改或绕过护栏。

没有枚举组织 SCP，也没有试运行完整创建流程、核验所有部署角色、服务关联角色、网络与运行时依赖。因此结论是 **服务已明确提供，并有账号读取 / 配额 / 可见策略证据；尚未完成创建和运行验收**。不将“可列出”写成“任何部署一定成功”。

## 工程含义

EC2、ECS/Fargate 是 CPU 应用承载方案的选择；ECS 也可使用 EC2，二者不是严格对立。S3、SageMaker、CloudFront 不因选 EC2 就必须放弃。针对当前项目，托管容器路线的理由是减少主机维护并符合赛事偏好；单机 EC2 路线有更直接的迁移体验，但仍需云端接口、权限、持久化与依赖适配。

首版不必拆成大量微服务。可先把 CPU 后端和视频处理打包为一个应用，再按任务量拆 Worker；SQS 是需要可靠排队 / 重试时的选项，不是赛事硬性要求。用户始终在 CloudFront 下的工作台网页交互，后端负责调用 S3、AgentCore、SageMaker 等服务。

## 来源与范围

- 上方两处赛事原文，本轮通过已连接的 Chrome 直接阅读；没有修改或提交赛事内容。
- AWS CLI：STS GetCallerIdentity；ECS ListClusters / DescribeCapacityProviders；SQS ListQueues；SageMaker ListNotebookInstances / ListEndpoints；Service Quotas ListServiceQuotas / GetServiceQuota；IAM GetRole / ListRolePolicies / GetRolePolicy / ListAttachedRolePolicies / GetPolicy / GetPolicyVersion。
- [ECS 计算方式](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/capacity-launch-type-comparison.html)、[Fargate 运行容器](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)、[Fargate 参数限制](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)。当前官方文档把 gpu 列为 Fargate 不支持的参数。
- [SQS 概述](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)、[CloudFront 源站类型](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html)。

公开技术资料查阅日期同采集日期。本文件只保存去标识化结论，不含账号 ID、凭据、完整资源 ARN 或队列 URL；没有新增云端资源或模型调用。
