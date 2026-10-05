# 交接：解释云端流程并实测 S3 与 Bedrock 接通

- 日期 / 时区：2026-10-05 22:33，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：用户询问 Bedrock、S3、上传 / 部署流程，以及是否能使用 AWS Core、Data Analytics 插件代为操作；本轮 GitHub 开放 Issue 查询为空。
- 分支：main
- 提交：本轮未提交 / 未推送
- 状态：流程说明和基础接通测试完成；工作台云端适配、部署及成片验收未完成。

## 本次完成

- 扩充[工作台上云说明](../../engineering/docs/aws-workbench-deployment-guide.md)，区分 GitHub 代码推送、S3 文件上传、Bedrock 模型请求和 CDK 应用部署，说明两类插件的作用。
- 更新[AWS 环境记录](../../environment/aws/README.md)与[团队状态](../../docs/status.md)。
- 在现有本队 S3 桶创建随机键的无敏感信息测试文本，下载核对 SHA-256 后删除本次对象；没有上传原片、改变桶公开性或覆盖已有对象。
- 使用赛事 `nba` profile、`us-east-1` 调用一次 Bedrock Qwen 文本模型，实际得到 CLOUD_OK。

## 结论与依据

- S3 负责保存文件；AgentCore 运行自己的 Agent 程序；Bedrock 接受模型请求；CloudFront 提供网页与成片访问入口。2026-10-05 查阅 AWS 官方 [S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)、[Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html)、[AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)、[CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html) 文档。
- 插件能力依据当前安装的 AWS Core / Data Analytics 技能目录；实际操作使用本机 CLI 和现有参赛登录。插件不会自动部署应用，也不额外授予云权限。
- 用户询问云端使用与测试方式，不据此宣布改成纯对话、禁止人工操作或确定新的产品方案。

## 验证

- AWS CLI 2.37.9；STS 检查匹配参赛角色，未输出或保存凭据。
- S3 上传、下载 SHA-256 一致、删除自己创建的对象均成功；上传响应 AES256。测试输出位于忽略目录 `tmp/aws-cloud-connectivity-20261005/`。
- `qwen.qwen3-vl-235b-a22b` 的 authorization / entitlement / region / agreement 检查可用；Converse 请求 `maxTokens=64`，返回 CLOUD_OK、end_turn，输入 19 / 输出 4 tokens，服务报告 508 ms。
- AgentCore Runtime 数量 0，CloudFront 查询无分发记录。本次没有实际部署应用，没有验证图片理解或其他模型。
- 四份文档共检查 230 个相对链接，发现 `docs/status.md` 既有历史段落的两个路径失效（旧 `engineering/experiments/tactical_analysis/README.md` 和缺失的 `2026-10-03-0440-tactical-analysis-lab.md` 交接），不属于本轮新增内容；保留给正在整理目录的任务处理。本轮新增内容的链接单独核验通过，未发现账号 ID / 访问密钥标识，补丁空白检查通过。未改生产代码，不运行无关回归。

## 阻塞与待确认

- 现有本机模型 provider、文件路径、任务执行和服务入口尚未适配云环境；真实官方指标及赛事统一输入输出契约仍需补齐。
- 当前参赛身份成功不代表未来应用执行角色已授权；部署时仍需针对实际资源配置并验证权限。

## 下一步

- 将现有 Agent 的模型调用和素材读取抽成可配置接口，保留本机路径，增加 Bedrock / S3 路径并以官方训练片验证。
- 打包视频渲染依赖，准备 CDK 工程，检查变更后部署并验收 AgentCore → 渲染 → S3 → CloudFront 全流程。

## 同步状态

- 本轮 `git fetch origin` 成功，HEAD 与 origin/main 均为 `82a8257dd5bce2ba3dc671813dee43713b368192`；GitHub 开放 Issue 查询为空。
- 工作区仍有另一任务的大量目录整理与研究修改，均保留；本轮没有提交、推送、创建分支或 PR。只有本次临时 S3 操作与模型请求已在 AWS 实际执行，文档修改仍留在本机。
