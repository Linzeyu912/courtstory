# 19 项 AWS 服务实测

日期：2026-10-06，Asia/Shanghai。20:00 开始，20:25 完成功能测试；以现有 `nba` profile 核对 STS 为本队参赛角色；区域 `us-east-1`，CloudFront 使用其全球服务接口。核验对象是本队当时的账号权限和小规模功能，不是 AWS 平台的通用产品清单。

**18 项完成基本功能实测，MediaLive 完成输入资源创建、尚未验证开播。没有发现这 19 项服务被整项禁止的证据；明确限制主要在 Bedrock 模型名单、Sonnet 协议状态和特定 EC2 GPU 配额。**

## 判定方法

- **功能通过**：实际提交请求，并验证返回内容、任务最终状态或创建后的运行状态。每项只代表下表所列功能，不代表整个服务的所有功能都验证过。
- **部分通过**：成功创建资源，但尚未运行主要业务流程。
- **受限**：发现明确的策略拒绝或零配额；与代码、角色配置或可用区选择错误分别判断。

19 项服务的只读查询全部成功，但结论主要依据后续实际调用。通过 CDK 创建了独立的临时测试栈；先 synth / diff，新角色均附有 `NBAHackathonParticipantBoundary`，未执行 bootstrap，未修改预置工作负载角色。测试使用自制图片、短句音频、2 秒纯色视频和无业务数据的文本标记。

## 服务逐项结果

| 类别 | 服务 | 本轮判定 | 实际做过的验证及边界 |
| --- | --- | --- | --- |
| AI | Bedrock AgentCore | 功能通过 | 创建临时 Runtime，以 IAM 认证调用，收到 `SERVICE_OK` 和原请求回显；随后停止会话。仅验证 Runtime，不代表智能体记忆、工具链或比赛应用已验收。 |
| AI | Bedrock | 指定模型通过 | Qwen3-VL-235B-A22B Converse 返回 `SERVICE_OK`，输入 14 / 输出 3 tokens。只测文本推理；模型限制另见下节。 |
| AI | Rekognition | 功能通过 | 对合成图片执行 DetectText，识别 `BASKETBALL TEST`，整行置信度约 99.85%。没有测试比赛视频追踪或人脸功能。 |
| AI | Transcribe | 功能通过 | 提交 MP3 转写任务，最终 `COMPLETED`；从 S3 读回正确英文句子。 |
| AI | Polly | 功能通过 | Joanna / standard 合成 47 字符短句，返回 17,598 字节 MP3，并用于 Transcribe 实测。 |
| AI | Translate | 功能通过 | 将英文测试句翻译为中文，服务实际返回译文。 |
| 计算 | Lambda | 功能通过 | CDK 创建 Python 3.12 函数，调用返回 `SERVICE_OK`；另通过有范围限制的应用执行角色提交 ECS 和 MediaConvert 测试。 |
| 计算 | ECS / Fargate | 功能通过 | 0.25 vCPU / 512 MiB 容器真正执行并结束，退出码 0；CloudWatch 日志有 `SERVICE_OK`。没有配置常驻 Service。 |
| 计算 | Batch | 功能通过 | 创建 Fargate 计算环境、作业队列和作业定义，提交容器任务，最终 `SUCCEEDED`、退出码 0，日志有 `SERVICE_OK`。使用临时 Batch 服务角色，没有新增 Batch 服务关联角色。 |
| 计算 | EC2 | CPU 功能通过 | t3.micro 在 us-east-1b 实际启动至 `running`，控制台输出启动脚本的 `SERVICE_OK`。首次在 us-east-1e 因机型不支持失败，换可用区后成功；未验证 GPU 或实际渲染应用。 |
| 媒体 | MediaConvert | 功能通过 | 将 2 秒合成 MP4 实际转为 H.264 / MP4，任务 `COMPLETE`；读回 3,245 字节文件，MP4 文件头和本机完整解码检查通过。 |
| 媒体 | MediaLive | 部分通过 | CDK 成功创建 MP4_FILE 输入，状态 `DETACHED`、SINGLE_PIPELINE；未创建和启动直播频道，不能标为已验证开播。 |
| 存储 / 交付 | S3 | 功能通过 | 私有测试前缀上传并读回 MP3，字节与 SHA-256 一致；随后承担转写、转码和 Runtime 代码包输入。 |
| 存储 / 交付 | CloudFront | 功能通过 | 创建私有 S3 源站、OAC、分发和仅允许该分发访问的桶策略；公网 HTTPS GET 返回 200，内容与测试标记逐字节一致。 |
| 存储 / 交付 | DynamoDB | 功能通过 | 临时按需表完成 PutItem → 一致性 GetItem → DeleteItem，值匹配。 |
| 编排 | Step Functions | 功能通过 | 临时 Standard 状态机执行 Pass 状态，最终 `SUCCEEDED`，输出 `SERVICE_OK`。未测试复杂工作流或服务集成。 |
| 编排 | SQS | 功能通过 | 实际发送、接收、核对并删除测试消息。 |
| 编排 | SNS | 功能通过 | 发布消息至临时 Topic，经 SQS 订阅真实送达并删除。未向任何人发送邮件或短信。 |
| 编排 | EventBridge | 功能通过 | 向自定义事件总线发事件，经规则真实投递至临时 SQS；接收内容与标记一致。 |

## 已确认的限制

1. **Bedrock 不是所有模型都开放。** 再次读取参赛策略及权限边界，允许范围仍仅含 `qwen.qwen3-vl-235b-a22b` 与指定的 `global.anthropic.claude-sonnet-4-6` 推理 profile / 对应基础模型。Qwen 本轮实际成功；白名单外模型被显式拒绝。此前同日 gpt-oss-120b 的实际拒绝记录见[模型权限核验](bedrock-model-access-20261006.md)，本轮未重复调用所有被禁模型。
2. **Sonnet 4.6 尚不能计为已接通。** 本轮基础模型可用性查询仍返回 agreement `NOT_AVAILABLE`，授权、entitlement、区域字段可用；没有发起首次订阅或接受第三方协议，也没有实际调用 Sonnet。需由账号管理员确认协议状态，不据此断言必然永久不可用。
3. **EC2 CPU 和 GPU 分开判断。** 标准按需 CPU 类配额 256 vCPU；G/VT 和 P 系列按需配额均为 0，当前不能据此规划普通按需 G/P GPU 实例。该结论不是对所有加速器、其他购买方式或 SageMaker 的统一判断；[SageMaker 检查](sagemaker-gpu-availability-20261006.md)另有非零 GPU 配额。
4. **Fargate 查询到按需配额 140 vCPU。** 这不是已经预留的容量，也不保证任意可用区随时有资源；本轮仅启动 0.25 vCPU 测试任务。
5. **AgentCore 的“已有 Runtime 数量 0”不等于配额 0。** 本轮查得 `Total Agents per Account` 配额 500，并实际部署调用成功。此前 15:46 记录里的“Runtime 为 0”指列表为空。
6. **部署路径和角色配置影响结果。** 本轮新角色通过官方要求的 CDK + 权限边界机制创建。参赛身份能传递预置工作负载角色，不等于任意手工 IAM 操作或 PassRole 都允许；不能把缺少角色权限误写为整项服务未开放。

## 清理与用途

六个临时 CloudFormation 栈均已删除；另行 API 确认 EC2 已 `terminated`、AgentCore Runtime 和 CloudFront 分发不存在、六个临时 IAM 角色不存在、MediaLive 输入为 `DELETED` 且无关联频道。测试日志已清理，本队 S3 测试前缀当前对象数为 0；删除时同时处理对象版本。独立测试桶的标记、Transcribe 作业和七份仅属于本次测试的 CDK 模板资产也已删除，保留其他资产。

MediaConvert、Batch、CloudFormation 等服务可能按平台规则保留历史任务或删除记录；这些记录不表示测试任务仍在运行。测试入口只承载合成标记，已经回收，不是赛事提交网址；临时测试栈不代表工作台或完整作品已经部署。

本轮有真实按量请求、短时计算和分发使用，没有从费用账单确认最终金额，不将其描述为免费测试。MediaLive 未开播。

## 证据与来源

- [去标识化实测快照](services-live-audit-20261006.json)：19 项结果、配额、容器日志标记、EC2 重试原因和清理复查。私有原始 API 响应、策略、CDK 模板和探针脚本保存在被忽略的 `tmp/aws-services-audit-20261006/`，不共享账号 ID、桶名或角色 ARN。
- [赛事 CDK 补充通知](../../requirements/cdk-deployment-notice-20261006.md)：us-east-1、已有 bootstrap 和指定权限边界；不将本轮实验推断为新增官方规则。
- [AgentCore Python 直接代码部署](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-python.html)、[HTTP 协议](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html)：用于构造 Runtime 探针。
- [Bedrock 模型访问](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)：协议状态及首次调用机制。
- [Batch 服务角色](https://docs.aws.amazon.com/batch/latest/userguide/using-service-linked-roles-batch-general.html)：服务角色机制；本队实际结果以上述测试为准。

公开 AWS 文档均在 2026-10-06 查阅。服务能力和账号策略可能调整；本报告是采集时点的证据，不是永久授权保证。
