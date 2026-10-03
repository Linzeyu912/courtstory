# BroadcastCode Team Hub

三人参加 BroadcastCode「深度赛场」比赛的共享资料与协作仓库。资料正文使用中文，仓库名及新增目录使用英文。

**GitHub 仓库**：https://github.com/Linzeyu912/broadcastcode-team-hub  
**当前阶段**：赛事准备与本机数据提取原型开发；完整 Agent 流程和 AWS 部署待完成。成员名单不代表已核验比赛入围资格。

## 工作台更新

2026-10-03 16:30 整理发布：视频库与独立 YOLO / 跟踪器组合、THY 战术审核与冻结报告、候选显示和扩大视频布局已分三类提交并推送 `main`，功能提交为 [2eeca0e](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/2eeca0e9f056da606a56d64d651289eb395bebd1)、[ee65937](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/ee65937449017ae5fcb5a25c1ba9386bce9f1943)、[74967ed](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/74967ed576698db9972fee2b9997eb9d6b4b9d1a)。本机视频、处理缓存和人工核验草稿继续保留，正式服务保持运行。前端 314 项通过 / 1 权限跳过，后端 199 项通过；分类范围、数据保留与视频校验限制见[发布交接](handoffs/Linzeyu912/2026-10-03-1630-workbench-updates-publication.md)。此前各轮记录保留当时状态。

2026-10-03 已按用户授权将人物关联冲突纠正、人物 / 球场蓝绿审核状态分成两项功能提交，推送工作分支后与最新 `main` 合并。功能合并提交为 [7ee65bd](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/7ee65bd88694fab6341dac8e0060842958ef58f0)，已核对本地 `main` 与两个远端分支一致；保留队友新增研究归档。241 项前端、216 项后端及构建检查通过。分类提交、冲突处理和数据校验边界见[本次发布交接](handoffs/Linzeyu912/2026-10-03-1005-workbench-main-publication.md)。下文早期分支状态保留对应轮次，后续恢复仓库默认的 main 协作流程。

2026-10-02 的工作分支 `codex/local-workbench-20261002` 保存用户版与 THY 版的选择性整合：保留原 UI、脚点与球场映射，接入多模型及 2K 查询，增加整段 T 归并和待核对提示，红蓝仅表示分队。五个功能提交当日已推送；[更新说明、提交清单与验证结果](engineering/docs/workbench-branch-update-20261002.md)记录完整范围。当时仅更新工作分支，现已随上方合并进入 main。

2026-10-03 追加检测候选来源、逐帧人工确认和精确定位修复，已推送三条分类提交。机器候选 / 未确认球员用虚线，本帧人工确认用实线；未跟踪与被抑制候选分别提示，无 T 人工兜底只改当前帧。见[操作与证据边界](engineering/docs/track-identity-review.md#检测候选与逐帧实线确认)和[交接记录](handoffs/Linzeyu912/2026-10-03-0010-detection-frame-review.md)。

同日 09:03 复核额度中断位置：三个功能提交完整，遗漏的是文档提交。前端 229 项、Python 216 项、构建一致性及当前帧确认 / 邻帧 / 撤销复验通过，本次补齐说明与独立交接。见[续接验收记录](handoffs/Linzeyu912/2026-10-03-0903-detection-review-completion.md)。

## 从这里开始

| 内容 | 入口 |
|---|---|
| 仓库各目录的用途、数据入口与开发内容边界 | [目录说明](docs/repository-map.md) |
| 最新赛事要求、评分、交付清单、对标视频 | [赛事资料整理](requirements/BroadcastCode赛事资料整理.md) |
| 当前进度和待认领事项 | [团队状态](docs/status.md) |
| 三位成员与建议分工 | [团队成员](docs/team.md) |
| 首次克隆、直接在 main 修改和同步 | [协作流程](docs/workflow.md) |
| 已确定的协作方式和待定技术选择 | [决策记录](docs/decisions.md) |
| 给各自 Agent 的仓库说明 | [AGENTS.md](AGENTS.md) |
| 每次工作的结果、阻塞与下一步 | [交接记录](handoffs/README.md) |
| 早期官网资料、报名准备、Word 手册 | [赛事资料索引](requirements/README.md) |
| 软件、运行方式、设计文档与技术实验 | [工程入口](engineering/README.md)、[工作台](engineering/tools/player-review/README.md) |
| NBA 2K25 / 2K26 球员能力、球队及号码（Agent 数据包） | [包清单](2K%20Player%20Data/manifest.json)、[读取指引](2K%20Player%20Data/AGENTS.md) |
| 视频成片、标签、批次清单和LFS下载 | [视频资料入口](data/videos/README.md)、[视频数据管理规范](docs/video-data-management.md) |

赛事要求放在 `requirements/`，软件、产品设计和技术实验放在 `engineering/`，视频与参考数据放在 `data/`。`docs/` 只保存团队协作、进度和仓库规范；历史工作记录在 `handoffs/`。不要把实验结论写成官方赛事要求。详细目录见[目录说明](docs/repository-map.md)。

## 三个人如何同步

1. 每人使用自己的 GitHub 账号，接受私有仓库邀请，然后在自己的电脑上克隆仓库。
2. 开工前更新 `main`，读取团队状态和最近的交接记录，从 GitHub Issues 认领一个明确任务。
3. 所有资料、代码和结论直接在 `main` 上修改；任务讨论和阻塞写进对应 Issue。
4. 收工前提交本次文件与交接记录，直接推送 `main`；其他人拉取 `main` 即可获取成果。远端有新提交时，按协作流程同步后再推送。

GitHub 同步的是已经提交并推送的文件。各台机器的聊天记录、Agent 记忆和未提交修改不会自动同步。重要结论应写进文档或交接记录。

### 给新 Agent 的开场提示

> 这是三人参加 BroadcastCode 比赛的共享仓库。先读取 AGENTS.md、README.md、docs/status.md、docs/decisions.md 和相关的最新 handoffs；检查工作区改动并同步 main。我是 <你的 GitHub 用户名>，本次负责 <Issue 编号或具体任务>。所有修改、提交和推送都在 main 完成，不新建分支或 PR。先了解已有工作，再继续该任务。完成后留下来源、修改文件、验证结果、阻塞和下一步。

## 仓库约定

- **所有内容直接在 `main` 上修改、提交和推送，不新建任务分支，不使用 PR 合并流程。**
- GitHub Issue 记录任务负责人和最新状态；[团队状态](docs/status.md)保留汇总及入口。
- 新发现标明来源、采集日期和确认程度；原文有歧义时保留待确认项。
- 代码、Markdown、轻量来源快照和最终 Word 手册入库。用户授权共享的成片在 `data/videos/` 使用 Git LFS 保存，来源、标签与规格使用普通 Git；原片、缓存和检查中间文件保留本地。见[视频数据管理规范](docs/video-data-management.md)。
- 密钥、密码、登录 Cookie、证件及个人报名材料不提交到仓库。`.gitignore` 已包含常见排除项。

## 当前最重要的未决事项

1. 确认指定 AWS 区域、Agent 服务名称、可用模型 ID 和实际数据格式。
2. 确定最小演示范围，准备模块分工，跑通部署和视频处理流程。
3. 队友接入按用户要求暂缓；后续需要协作时再发送邀请并认领任务。

详细要求以赛事后续正式指南为准。本仓库保留不同日期的资料，旧笔记中的“待公布”不能覆盖后续已收到的通知。
