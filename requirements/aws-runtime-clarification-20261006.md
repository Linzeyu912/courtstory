# AWS 运行位置与 EC2 / GPU 要求复核

采集：2026-10-06 14:13，Asia/Shanghai。通过浏览器实读官方双语 Quick Start 与终极指南；页面均显示最近修改为 10 月 5 日。本记录补充此前 [Portal 核验](portal-access-20261005.md)，保留历史采集记录。

## 官方原文确认

| 事项 | 2026-10-06 实读结论 |
| --- | --- |
| Agent 承载 | Quick Start 第一、五节明确要求 Amazon Bedrock AgentCore 承载智能体能力；不能把仅在 EC2 启动进程称为已经满足此要求。 |
| EC2 | 第六节将 EC2 与 Lambda、ECS、Batch 并列为可用计算服务；没有要求必须把 Agent 部署在 EC2。第三节鼓励有效使用托管服务。 |
| 数据 | 第五节说明用预置的每队专属 S3 桶保存数据和成品。上传文件不等于 Agent 已读取或处理这些文件。 |
| 网页与部署 | CloudFront + Web 交互界面，以及 CDK 定义基础设施，均是硬性要求；应用资源部署到赛事账号的 us-east-1。 |
| GPU | 第六节明确为 **EC2 GPU 机型配额为 0**。需要 GPU 可以通过 **SageMaker 申请**，文档列出 g4dn、g5、g6 和部分 g6e，可开机数量为 1、2 或 4，取决于当时资源，不能保证。此为指南允许的路径，本轮没有申请或实测 SageMaker GPU。 |
| 评测接口 | 终极指南“在提交项目前”要求统一 Agent 接口、输入参数和产物路径，指向培训及 Quick Start。本轮读到的章节未给出完整 JSON schema，不能自行把内部接口标成官方契约。 |

因此，以前将“GPU 配额为 0”简写成全部云端 GPU 不可用的理解不完整；也不能把 CPU + Bedrock 的工程建议说成官方唯一允许路线。EC2 可作为视频处理等配套计算，具体用途是工程选择，不是本届强制承载 Agent 的要求。

本队 CDK 补充通知另见 [10 月 6 日通知](cdk-deployment-notice-20261006.md)：不运行 bootstrap，实际工程要配置 `NBAHackathonParticipantBoundary`。该通知来自另一会话的用户转发，本轮没有取得原发布 URL。

## 来源

### 2026-10-06 16:02 补充实读

本轮重新打开 Quick Start 第一、二、三、五、六节及服务示例页：第六节明确列出 ECS / EC2，以及 SQS / SNS / EventBridge / Step Functions；GPU 仍通过 SageMaker。服务示例“计算 → Amazon ECS”明确提供 Fargate 运行说明与 CDK 示例，“Serverless → Amazon SQS”“AI / ML → Amazon SageMaker”均有专页。

第一、五节要求 Web 界面和作品经 CloudFront 提供访问；第三节区分代码仓库重跑的机器评分与 CloudFront 作品的人工评分，并明确偏重原生托管服务。ECS/Fargate 和 SQS 不是与 AgentCore / CloudFront / CDK 同级的强制项。示例中的服务介绍不保证本队任意机型、配额、权限及调用均成功，账号证据见 [服务可用性核验](../environment/aws/compute-services-availability-20261006.md)。

- [官方 Rules & Quick Start](https://csdn.feishu.cn/docx/Y21TdJqrHopofmx2w21cmqHLnLb)：实读第一、三、五、六节；硬性要求、服务职责和 GPU 申请路径。
- [参赛终极指南](https://csdn.feishu.cn/wiki/B3NSwj16GiSCR7kcM5vc9RjMnQb)：实读提交清单、统一接口说明。
- [AWS 服务示例](https://du5imhgxabl0d.cloudfront.net/services)：实读 CDK 页面，注明为练习示例，不能直接视为生产配置。

本轮实际账号检查及素材上传属于工程执行，见 [云端准备记录](../engineering/docs/aws-cloud-preflight-20261006.md)。
