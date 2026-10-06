# BroadcastCode Team Hub

三人参加 BroadcastCode「深度赛场」比赛的共享仓库。正文优先使用中文；目录按用途分开，所有工作直接在 `main` 上维护。

**仓库**：https://github.com/Linzeyu912/broadcastcode-team-hub

**接手已有成果先看[成果与接续总览](docs/work-index.md)**：汇集三位成员的跟踪 / 脚点研究、2D 与 Qwen 实现、005 成片基准、导入视频问题、论文模型和环境准备，标明验证范围与缺口。

**AWS 哪些可以用，先看 [19 项服务实测报告](environment/aws/services-live-audit-20261006.md)**：2026-10-06 的本队账号测试中，18 项基本功能通过，MediaLive 只验证了输入配置；模型名单、GPU 配额、未测功能与清理证据分别列出。CloudFront 提交、仓库重跑与截止时间另见[赛事评审说明](requirements/judging-operation-clarification-20261006.md)。

## 四类内容，从这里进入

| 类别 | 目录 | 放什么 |
| --- | --- | --- |
| 调研与实验结果 | [research/](research/README.md) | 篮球跟踪、人物身份 / 脚点绑定、球场映射、论文模型、Agent 调研；报告、实验脚本、结果与来源 |
| 赛事任务与要求 | [requirements/](requirements/README.md) | 官方规则、评分、交付清单、赛程、训练素材核验与指南来源 |
| 环境准备 | [environment/](environment/README.md) | 本机依赖、模型环境、AWS CLI / CDK、账号登录和资源核验 |
| 作品工程 | [engineering/](engineering/README.md) | 工作台、Agent、视频渲染、产品设计、接口、测试和部署工程 |

**查模型和实验结论去 research，查比赛要求去 requirements，配电脑和账号去 environment，开发和运行作品去 engineering。** 完整边界与旧路径迁移见[目录说明](docs/repository-map.md)。

## 其他固定入口

| 内容 | 入口 |
| --- | --- |
| 视频成片、标签、候选与数据规范 | [data/videos](data/videos/README.md)、[管理规范](docs/video-data-management.md) |
| NBA 2K 球员数据包 | [manifest](2K%20Player%20Data/manifest.json)、[读取约定](2K%20Player%20Data/AGENTS.md) |
| 团队进度、成员与决定 | [状态](docs/status.md)、[成员](docs/team.md)、[决策](docs/decisions.md) |
| main 协作与同步 | [工作流程](docs/workflow.md)、[Agent 约定](AGENTS.md) |
| 各轮工作与验证记录 | [handoffs](handoffs/README.md) |
| 工作台历次更新 | [历史摘要](engineering/docs/workbench-history-20261005.md)、[成果与问题](engineering/docs/progress-and-open-issues-20261004.md) |

视频当前活动库为 165 段，新增两段[官方训练重点素材](data/videos/uploads/2026-10-05-official-training/README.md)，工作台可直接打开；此前 40 段人工抽检保留 28、删除 12，见[结构化目录](data/videos/classification/README.md)。历史记录中的数量保留当时口径。

## 协作与存放约定

- 新成果放入对应主目录，并从该目录 README 提供入口；历史过程记在个人交接中。
- 官方要求、研究结论、环境已就绪与作品已验收分别记录，不能互相代替。
- GitHub 仅共享已提交并推送的文件；本机聊天、未提交改动、模型和缓存不会自动共享。
- 密钥、凭据、用户级 AWS 配置、来源原片与中间文件保持本机；共享成片按 Git LFS 规范进入 `data/videos/`。

## 当前最重要的未决事项

1. 把现有工作台接到云端：两段官方训练片已上传本队 S3 并校验，AgentCore、CloudFront 和 CPU 计算已完成独立基础测试；临时测试资源已清理，完整应用部署仍待完成。包内没有独立指标表，赛事机器评测接口契约也仍待补齐。见[部署顺序](engineering/docs/aws-deployment-architecture-20261006.md)、[上传与代码预检](engineering/docs/aws-cloud-preflight-20261006.md)、[服务实测](environment/aws/services-live-audit-20261006.md)及[评审说明](requirements/judging-operation-clarification-20261006.md)。
2. 依据新边界完成 CPU + Bedrock 的最小云端作品闭环；完整轨迹复原不作为赛题主线，现有 2D 工具可作内部辅助。建议及操作见[接续清单](engineering/docs/contest-readiness-20261005.md)，尚未宣布团队选型或分工。
3. 队友接入按用户要求暂缓；后续需要协作时再发送邀请并认领任务。

详细要求以赛事后续正式指南为准。本仓库保留不同日期的资料，旧笔记中的“待公布”不能覆盖后续已收到的通知。
