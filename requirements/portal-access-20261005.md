# Team25 Portal 与 10 月 5 日正式指南核验

采集：2026-10-05，Asia/Shanghai。先读取未登录入口，随后按用户指示进入其已登录的 Chrome，实读 Team25 Portal、终极指南、双语 Quick Start 和 AWS 服务示例。本文件记录赛事要求；工程取舍另见[接续清单](../engineering/docs/contest-readiness-20261005.md)。

21:40 后续核验：Portal 现已显示 `Linzeyu912/broadcastcode-team-hub` 锁定绑定，更新下方最初观察；本轮未代操作绑定。AWS CLI 2.37.9 已安装，本队双 profile 已写入用户级配置并通过本地解析验证，SSO 登录 / STS 仍未执行，见[配置交接](../handoffs/Linzeyu912/2026-10-05-2140-aws-cli-profiles.md)。下文最初“尚未绑定 / shell 未找到工具”等描述保留当时事实。

## 1. 本队页面实际状态

| 项目 | 2026-10-05 观察 | 边界 |
| --- | --- | --- |
| 登录 | Portal 显示 Team25；使用主办方 AWS SSO，无独立 Portal 密码 | 浏览器登录不等于 AWS CLI 已配置 |
| GitHub | 显示“连接 GitHub 仓库”；说明只能设置一次，选择不可更改 | 尚未绑定；本轮没有点击授权或安装。现有候选仓库为私有 `Linzeyu912/broadcastcode-team-hub` |
| AWS 控制台 | 提供“登录 AWS”与“切换到您的帐户”两个入口 | 先进入共享登录账号，再切到本队角色；本轮未进入控制台或验证实际资源 |
| CLI | 页面提供 `nba-sso` 与 `nba` 双 profile 配置 | 从本队 Portal 复制，不照抄其他队账号；完整账号和角色配置不写入仓库 |
| 数据 | NBA 全球站、深度赛场中文站及两文件训练 ZIP 入口 | 已见链接，未下载、解压或核对视频/数据字段 |
| 作品提交 | URL 输入框为空，计数 0/300，显示“提交” | 当前页面没有作品地址；没有提交任何作品 |

登录入口：[Portal](https://du5imhgxabl0d.cloudfront.net/portal)。本轮没有保存密码、Cookie、令牌或含登录会话参数的跳转地址。

## 2. 已解决的关键未知项

以下来自 Portal 及其链接的、页面显示 10 月 5 日更新的正式指南。

| 项目 | 现已确认 |
| --- | --- |
| 智能体承载 | **Amazon Bedrock AgentCore 必须使用**；只在本机运行 Agent 或仅做大模型循环不满足要求 |
| 对外交付 | **Amazon CloudFront + Web 交互界面**；单独命令行、Notebook、录屏或 API 不满足要求 |
| 基础设施 | **AWS CDK 必须使用**；控制台手工创建、纯 AWS CLI 脚本、Terraform/SAM/裸 CloudFormation 不能替代 |
| 环境 | 赛事分配 AWS 账号，应用区域 **us-east-1**；其他区域受护栏限制 |
| GPU | **GPU 配额为 0**，指南要求采用 CPU + Bedrock 路线，不能预设自建 GPU 实例 |
| 身份链 | `nba-sso` 负责共享账号 SSO 登录，`nba` 通过它切到本队 `NBAHackathonParticipantRole` |
| CLI | AWS CLI v2；SSO 约 12 小时，控制台第二步角色会话约 1 小时；CLI 链式会话可在 SSO 有效期间自动续取 |
| 模型示例 | Quick Start §6 列出 `global.anthropic.claude-sonnet-4-6` 与 `qwen.qwen3-vl-235b-a22b`，并称已实测可用；本轮没有在本队账号发起调用 |
| 存储 | Quick Start 说明每队有预置专属 S3 桶；本队实际桶名/内容未查询 |
| 截止 | **2026-10-10 20:00，北京时间**；此前最后一次 CloudFront URL 提交有效，之后不可修改 |
| 重提 | 可重复提交覆盖前次，两次之间至少 1 分钟 |
| 审核可用期 | 最终作品链接需覆盖 **10 月 10 日 20:00–22:20** 审核时段 |

**区域要区分：** SSO 配置的 `sso_region` 为 `us-west-2`，应用和日常命令区域为 `us-east-1`。它们分别服务登录与资源调用，不矛盾。

**模型 ID 要区分：** Quick Start 的通用排错表另用旧 Claude 的 `us.` 前缀举例；本次明确列出的 Sonnet 4.6 ID 是 `global.anthropic.claude-sonnet-4-6`，AWS 服务指南也使用这一值。不能机械给所有 Claude ID 加 `us.`。仓库现有阿里云 `qwen3.8-max` 路径与赛事 Bedrock Qwen3-VL 示例不是同一模型或调用接口。

## 3. 赛题范围：对此前方向的重要补充

终极指南“赛题形式 / 赛题边界”明确：

- 必须把深度赛场数据可视化叠加到真实比赛视频；期望球员身份、指标与当前画面对应，能支撑对战术选择的解释。
- 解说是可选项，可用 AI 或人工；AI 生成解说需明确声明。
- 赛题排除实时信号接入、数字孪生、跑动轨迹复原、判罚认定及博彩类预测。
- 官方深度数据只有出手瞬间点位，没有逐帧轨迹。
- 可自行采集更多 NBA 深度数据或训练素材，但交付物不能包含未授权录像，来源需披露。

因此，“官方会提供逐帧轨迹”没有依据。如何将现有 2D 工具用于内部标注是工程问题，不能写成赛事要求；也不应把完整轨迹重建当作本届交付主题。

## 4. 来源入口与操作说明

Portal 的仓库连接、AWS 控制台、CLI 和 profile 操作步骤已单独放入[环境准备](../environment/aws/portal-setup-20261005.md)。当前安装和登录状态见[AWS 环境索引](../environment/aws/README.md)。本页保存赛事要求与来源核验。


- [NBA 深度赛场](https://china.nba.cn/inside-the-game)
- [NBA 全球比赛页](https://www.nba.com/games)
- [官方训练 ZIP（Portal 标注 2 个文件）](https://comfile.csdnimg.cn/file/train_video.zip)
- [终极指南](https://csdn.feishu.cn/wiki/B3NSwj16GiSCR7kcM5vc9RjMnQb)
- [有效双语 Quick Start](https://csdn.feishu.cn/docx/Y21TdJqrHopofmx2w21cmqHLnLb)
- [AWS 服务指南](https://du5imhgxabl0d.cloudfront.net/services)：本轮实读 CDK 与 AI / Agent → Amazon Bedrock AgentCore 示例。

Portal 原 Quick Start 链接 `H0N3d4467osmp5x45VLc7RRgnqh` 已变成合并提示，应进入上面的 `Y21Td...` 正文。服务指南中的代码是教学片段，不等于已经获得完整可部署工程。

## 5. 评分、赛程与交付的更新

- 初赛仍为机器 35、人工 55、问答 4、投篮 6；人工明确拆为数据/内容准确性 **30** 与 UX/UI/作品体验 **25**。
- 技术评分强调 AWS 托管服务的有效使用、使用深度、组合协作及完整工程链。Quick Start 明确托管服务相较在 EC2 自建组件权重更高；不等于按服务数量机械加分。
- 10 月 10 日 **07:40–08:00** 签到与练习视频抽签；指南称训练分配不可改。**18:00** 发布考试视频，建议按正式流程留 **19:45–20:00** 提交。
- 交付包含部署的 Agent、私有代码库、说明文档、演示视频及本队 CloudFront 完整作品链接。
- 决赛 10 月 11 日为**一轮路演**，不是旧纪要中的技术与作品两轮；初赛和决赛成绩不累加。本文不扩展行程、证件或报名事项。

## 6. 仍未核实的事项

- 仓库绑定授权最终范围、评测分支和抓取方式；本轮没有安装 GitHub App。
- 官方数据实际字段、单位、缺失规则及与视频事件的对应；实际 ZIP 内容和考试片分配。
- 正式评分 Agent 的统一接口、输入参数、产物路径；已读指南提到需统一，但本轮未取得完整契约。
- 本队实际 S3 桶、CPU/服务配额、余额预算、账号练习有效期；文档列出的可用服务不等于本队真实调用已验证。
- 外部 API 在最终运行链中的具体适用边界：旧培训允许外部 API，新指南强调赛事账号/AgentCore；本轮不据此自行宣布允许替代核心链路或全面禁止。

## 来源与核验范围

上述三个赛事页面于 2026-10-05 在浏览器逐节读取；未提交、绑定、部署或消费模型调用。原[9 月 28 日纪要整理](BroadcastCode赛事资料整理.md)保留历史口径，本记录为后续正式要求补充。账号 ID、角色 ARN 和登录会话信息不纳入共享文档。
