# AWS 账号与部署工具准备

### 2026-10-07：既有 EC2 安装 Codex CLI

[Codex CLI 安装与登录记录](codex-cli-ec2-20261007.md)：官方 Linux x64 `0.160.1` 包已在本机下载并校验，经既有私有 S3 / SSM 传入 Ubuntu 服务器，用户级安装通过。22:24 已完成 ChatGPT 设备码授权、真实请求与只读 `pwd` 命令测试；既有工作台两个服务仍正常。项目修改和长任务未验收，本轮文档仅本地保存。

### 2026-10-07：自有 OpenRouter API 云端调用通过

[多模态实测](openrouter-multimodal-connectivity-20261007.md)：本队 `us-east-1` 临时 AgentCore Runtime 经 OpenRouter，九个候选模型的图片序列、五个直接视频和两个音频请求均通过，合计 16 项；加上[首轮文本验证](openrouter-cloud-connectivity-20261007.md)，OpenRouter 总用量 0.06015834 USD。使用自制可核对样例，尚未接入作品或评测真实篮球质量，未改变 Bedrock 白名单。清理状态与去标识化证据见报告。

### 2026-10-06 晚间：19 项服务真实调用与临时部署实测

[完整实测报告](services-live-audit-20261006.md)：18 项完成基本功能验证；MediaLive 成功创建文件输入，尚未开播。AgentCore 已实际部署调用，CloudFront HTTPS 实际返回 200，ECS / Batch 容器、CPU EC2、MediaConvert、数据库和消息链路均成功。明确限制是 Bedrock 模型白名单、Sonnet 4.6 协议未就绪及 EC2 G/VT、P 按需 GPU 配额为 0。测试资源清理状态和证据见报告；这是临时探针，不代表作品已部署。

初次认识服务可先读 [AWS 服务入门：从篮球视频到网页成片](services-primer-20261006.md)，区分 AI、计算、媒体、存储与消息编排的职责；其中项目例子不代表已部署或赛事要求全部使用。

### 2026-10-06 16:02 计算与队列服务核验

[ECS/Fargate、EC2、SQS 与 SageMaker](compute-services-availability-20261006.md)已同时核对赛事原文、示例页和本队只读 API：Fargate 计算提供方 ACTIVE、按需配额 140 vCPU；CPU EC2 标准按需 256 vCPU；SQS 列表可读；G5 Endpoint / Notebook 有额度。服务提供不等于完整创建成功；可见策略和未验证项见报告。本轮没有部署或开机。

### 2026-10-06 SageMaker GPU 实查

[配额与执行角色核验](sagemaker-gpu-availability-20261006.md)已完成：本队 us-east-1 的 G4dn / G5 / G6 / G6e 在 Notebook、Training、Endpoint 等用途有非零配额，与用户截图一致；这些机型的 Processing / Batch Transform 当前为 0。预置工作负载角色信任 SageMaker，参赛角色允许传递该角色。本轮只读，没有开机或申请提升配额；具体矩阵及未验证边界见记录和 JSON 快照。

### 2026-10-06 模型权限实查

参赛角色与 `NBAHackathonParticipantBoundary` 的真实模型白名单均仅含 **Claude Sonnet 4.6** 和 **Qwen3-VL-235B-A22B**。本轮 Qwen Converse 成功；Sonnet 4.6 在白名单内但协议状态未就绪，未做首次开通。GPT / Claude Opus / 其他 Sonnet 版本被显式拒绝，gpt-oss-120b 已实际请求验证拒绝。模型目录和服务状态不能代替有效 IAM 权限；完整结果、去标识化证据与限制见[模型权限核验](bedrock-model-access-20261006.md)。

## 2026-10-05 历史准备记录

以下基线截至 2026-10-05 22:03（Asia/Shanghai），随后同日 22:33 补充接通测试。账号服务的最新实测结论以上方 10 月 6 日报告为准；保留早期检查范围供追溯。

### 22:33 接通测试更新

2026-10-05 22:33（Asia/Shanghai），本轮实际执行以下操作，覆盖下方历史表格中“尚未验证读写 / 真实调用”的状态：

- AWS CLI 2.37.9，`nba` 的 STS 身份仍为本队参赛角色；应用区域 `us-east-1`。
- 在已有本队桶的 `workbench/connectivity-checks/` 下以随机对象键写入一份无个人信息的测试文本，下载后的 SHA-256 与原文件一致；随后删除本次创建的对象（若存在版本 ID 则指定该版本）。上传响应为 AES256 服务端加密。没有上传比赛视频或改桶策略。
- Bedrock `qwen.qwen3-vl-235b-a22b` 的访问检查四项均可用。通过 Converse 发出一次纯文本请求，限制 `maxTokens=64`，真实返回 `CLOUD_OK`、`end_turn`；输入 19 / 输出 4 tokens，服务报告延迟 508 ms。
- 本次只证明当前参赛身份下的 S3 读写与单次 Qwen 文本调用成功，不证明其他模型、图片理解、AgentCore 执行角色或完整应用已验证。尚未创建 AgentCore Runtime；CloudFront 查询仍无分发记录。

原始测试输出仅在被忽略的 `tmp/aws-cloud-connectivity-20261005/`。部署工程尚未实现；下一步是工作台接口适配与打包。见[流程说明](../../engineering/docs/aws-workbench-deployment-guide.md)和[本轮交接](../../handoffs/Linzeyu912/2026-10-05-2233-s3-bedrock-connectivity.md)。

## 已完成与待完成

| 项目 | 现有核验结果 | 依据 |
| --- | --- | --- |
| AWS CLI v2 | 2.37.9 已安装，用户 PATH 已登记 | [安装记录](../../handoffs/Linzeyu912/2026-10-05-2135-aws-cli-v2-install.md) |
| 双 profile | `nba-sso` 用于 SSO；`nba` 用于本队角色 | [配置记录](../../handoffs/Linzeyu912/2026-10-05-2140-aws-cli-profiles.md) |
| 登录与身份 | 用户完成登录；STS 已核对为 Team25 参赛角色 | [21:48 盘点](../../handoffs/Linzeyu912/2026-10-05-2148-aws-readiness-inventory.md) |
| GitHub 绑定 | Portal 已显示现有私有仓库锁定绑定 | [21:40 观察](../../handoffs/Linzeyu912/2026-10-05-2140-aws-cli-profiles.md) |
| CDK CLI | 2.1144.0 已安装并核对命令与 npm 版本 | [22:03 安装交接](../../handoffs/Linzeyu912/2026-10-05-2203-cdk-workbench-cloud-guide.md) |
| 预置资源 | 本队 S3 桶、CDK 资产桶及 CDKToolkit 等栈已存在 | [只读盘点](../../handoffs/Linzeyu912/2026-10-05-2148-aws-readiness-inventory.md) |
| 应用部署 | 盘点时 AgentCore Runtime / CloudFront 分发为空；还没有作品部署记录 | 同上；安装 CDK 不等于部署应用 |

22:03 盘点后的基础 S3 / Bedrock 文本测试已补齐，见上方更新。仍需完成图像与工具调用验证、应用 CDK 工程、AgentCore 适配及网页到成片的完整验收；资源列表为空不代表创建权限已验证。

原 Portal 的完整操作步骤另见[采集记录](portal-setup-20261005.md)，按该记录的日期理解历史观察。

## 在自己的电脑接续

从本队 Portal 取得配置，在用户级 `~/.aws/config` 保留其他 profile 后配置 `nba-sso` / `nba`。不要使用其他成员机器上的账号配置副本，也不要把账号 ID、角色 ARN 或临时凭据写入仓库。

```powershell
aws --version
cdk --version
aws configure list-profiles
aws sso login --profile nba-sso
aws sts get-caller-identity --profile nba --region us-east-1
```

登录后的身份应对应本队的 `NBAHackathonParticipantRole`。SSO 区域为 `us-west-2`，应用区域为 `us-east-1`；两者作用不同。旧终端可能仍保留安装前 PATH，需重新打开或刷新环境。

本机已完成的安装无需重复执行。按 2026-10-06 用户转发的[官方 CDK 补充通知](../../requirements/cdk-deployment-notice-20261006.md)，主办方已完成 `us-east-1` 的 bootstrap，本队**不要执行 `cdk bootstrap`**。后续实际 CDK 工程需在 `cdk.json` 的 `context` 中加入 `"@aws-cdk/core:permissionsBoundary": { "name": "NBAHackathonParticipantBoundary" }`，保留其他已有配置；该边界不自动授予业务权限。本次只更新说明，未重验登录、查询策略或部署资源。

## 环境准备之后

- 赛事为什么要求 AgentCore / CloudFront / CDK：查[正式要求](../../requirements/portal-access-20261005.md)。
- 工作台怎么接云端、视频在哪里生成：查[作品上云设计](../../engineering/docs/aws-workbench-deployment-guide.md)。
- 应用实现顺序与验收目标：查[交付接续清单](../../engineering/docs/contest-readiness-20261005.md)。
- 官方练习素材实际情况：查[训练包核验](../../requirements/training-package-check-20261005.md)。

环境说明放在本目录；未来真正执行部署的 CDK 应用代码应随作品放在 `engineering/infra/`，目前该工程尚未实现。
