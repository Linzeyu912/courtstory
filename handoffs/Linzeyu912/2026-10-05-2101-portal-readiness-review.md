# 交接：Team25 Portal 正式要求与赛事交付接续

- 日期 / 时区：2026-10-05 21:01 起，21:12 更新，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户提供 Portal，要求联系此前内容，梳理需要做什么及如何操作；GitHub Issues 全状态查询为空，无现有负责人/讨论可核对。
- 分支：main。
- 提交：未提交 / 未推送；本轮核对 HEAD、origin/main 与实际远端均为 `b90f816af07fa5b1b3e64de19d672a2547942408`。
- 状态：本次门户/正式要求核验与行动建议整理完成；实际绑定、配置、部署和作品提交属于后续执行。

## 本次完成

- 新增 [Team25 Portal 与正式指南核验](../../requirements/portal-access-20261005.md)，记录实际页面、三项技术硬要求、区域、GPU、双 profile、模型 ID、赛题边界和提交规则。
- 新增 [赛事交付接续清单](../../engineering/docs/contest-readiness-20261005.md)，结合现有成果提出最小 CPU + Bedrock / AgentCore / CloudFront / CDK 闭环、操作与验收顺序。
- 更新 requirements 索引及赛事整理，修正旧纪要中的 Agent 服务待定、区域待核、考试抽签及两轮决赛等信息。根 README、状态及 D002 的未知项补充最新来源，不宣布团队采纳新架构或分工。
- 保留此前 Hoop 研究的未提交修改与所有未跟踪文件，未动业务代码、视频、模型、草稿或运行服务。

## 结论与依据

- 最初内置浏览器未登录；用户随后明确表示已在 Chrome 登录，按其指示读取 Chrome 的 Team25 页面。其 GitHub 卡片仍为连接按钮、明确只能绑定一次，作品 URL 输入为空。
- [Portal](https://du5imhgxabl0d.cloudfront.net/portal)、[终极指南](https://csdn.feishu.cn/wiki/B3NSwj16GiSCR7kcM5vc9RjMnQb)、[有效 Quick Start](https://csdn.feishu.cn/docx/Y21TdJqrHopofmx2w21cmqHLnLb) 2026-10-05 实读，后两者显示当日修改。Portal 原 Quick Start 指向合并提示，已跟到有效正文。
- 官方指定 Bedrock AgentCore、CloudFront 交互网页和 CDK，应用区域 us-east-1；GPU 配额 0。SSO 区域 us-west-2 不等于应用区域。
- 正式指南明确不做跑动轨迹复原，官方仅有出手瞬间点位；解说可选。建议保留现有 2D 工具作内部辅助，先交付数据与视频对齐、云端交互作品，不让新轨迹模型研究阻塞部署。
- 旧 V2 已有真实 Agent/静音成片成功记录；新 V3 与 Qwen 对应真实验收仍待补，两者分别记录。
- [服务指南](https://du5imhgxabl0d.cloudfront.net/services) 实读 CDK、AgentCore 示例；教学代码片段不等于完整可部署栈。本轮没有安装 GitHub App 或创建 AWS 资源。

## 验证

- `git fetch origin` 后提交差 0 / 0；`git ls-remote origin refs/heads/main` 再核对一致，无需切分支或重放。GitHub API 核对私有仓库、默认 main。
- 浏览器读取登录页、Team25 Portal、正式指南的账号、赛题、评分、提交和纪律，以及 Quick Start 的硬性要求、服务/模型、排错和开工顺序。
- 当前 PowerShell PATH 未找到 aws/cdk；未据此断言其他开发环境没安装，也未查找/读取私密凭据。
- 训练 ZIP 的 HEAD 返回 HTTP 200，但 Content-Type 为 text/plain、没有 Content-Length；未下载/解压，不把该响应视为两个视频字节已验证。
- 收尾核对 8 份任务文档的 256 条相对链接，无新增断链；`git diff --check` 已通过（移除了本次新增的一处行尾空格）。全量检查 status.md 时发现两条任务前 HEAD 已有断链：`engineering/experiments/tactical_analysis/README.md` 与 `handoffs/chuali-zi/2026-10-03-0440-tactical-analysis-lab.md`，未扩展任务改写旧交接。检查未将 Portal 账号 ID 或登录会话 URL 写入本轮文档。
- 未重跑业务测试、调用模型、操作用户草稿或运行部署。

## 阻塞与待确认

本轮调研没有剩余访问阻塞。后续实施仍需核对本队真实资源/预算、训练 ZIP 与数据 schema、统一 Agent 输入参数和产物路径、评测分支及仓库授权最终范围。外部 API 不替代 AgentCore；是否能用于最终核心链路需按官方进一步确认。

## 下一步

1. 核对现有私有仓库后完成一次性 Portal 绑定；安装/启用 CLI v2 与 CDK，使用本队双 profile 做身份验证。
2. 下载官方练习素材与指标，先做“AgentCore 发起处理 → CPU 叠一行真实文字 → S3 → CloudFront 页面可播”。
3. 接回现有战术图形与渲染，核对官方指标和人物/时间，再增加可选语音及更复杂分析。
4. 比赛前用新素材演练一次；20:00 前 push 和 URL 提交，作品链接保持至 22:20。

## 同步状态

本轮文档与先前研究均未提交、未推送；main 基线已与实际远端核对。没有新建分支、PR、Issue 或云资源，未更改访问权限、发送消息或提交赛事作品。账号 ID、角色 ARN、Cookie、密码及临时会话 URL 不入库。
