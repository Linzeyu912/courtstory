# 仓库目录与数据入口

审阅日期：2026-10-01，Asia/Shanghai。依据为本仓库现有文件、资产清单和交接记录；本次不重新采集外部资料或改写赛事规则。

## 从哪里查找

| 内容 | 位置与入口 | 当前口径 |
|---|---|---|
| 最新赛事要求、评分和交付清单 | [赛事资料整理](../BroadcastCode赛事资料整理.md) | 以2026-09-28培训整理及后续正式通知为准 |
| 团队进度、协作与决定 | [状态](status.md)、[协作流程](workflow.md)、[决策](decisions.md) | 团队信息放在 `docs/` |
| 已收集的视频与标签 | [视频入口](../data/videos/README.md) | `data/videos/nba/` 按赛季保存 |
| 2024–25视频100段 | [赛季说明](../data/videos/nba/2024-25/README.md)、[统计](../data/videos/nba/2024-25/collection-report.md) | 总共100段含001–003；首批独立文件及重复包已清理 |
| 2025–26视频登记30条 | [赛季说明](../data/videos/nba/2025-26/README.md) | 清单与标签草案；成片仍待取得，历史8段及单段不额外计数 |
| NBA 2K球员、能力与球队数据 | [包清单](../2K%20Player%20Data/manifest.json)、[读取指引](../2K%20Player%20Data/AGENTS.md) | 已有1.1版，635条赛季记录、472人；保留既有目录名和索引契约 |
| 产品页面核验、技术研究与来源 | [调研索引](../research/README.md) | `research/` 保存主题研究，不重复保存视频成片 |
| 早期官网、报名资料和Word手册 | `research/broadcast-code-12/` | 主要采集于2026-09-17；原始快照与更正分开，旧版本不替代新规则 |
| 每次工作的依据和同步结果 | [交接目录](../handoffs/README.md) | 按成员和日期记录，历史状态按当时理解 |
| 任务认领模板 | `.github/ISSUE_TEMPLATE/task.yml` | 负责人及任务范围以Issue最新讨论为准 |
| 视频校验 | [validate_video_data.py](../scripts/validate_video_data.py) | 检查清单、标签、文件大小、SHA-256及暂存LFS指针 |

## 本次整理结论

除视频已在本会话归并外，赛事、历史调研、球员数据包和协作文件的边界清楚，不再额外改名或搬动。两份历史Word手册分别为早期阅读版和扩展讨论版，与Markdown源文及采集时间一起保留。

视频现在以赛季为唯一日常入口：同赛季MP4集中放在 `clips/`，标签在 `labels/`，逐段说明在 `notes/`，原始采集快照在 `sources/`。当前路径以 `catalog.json` 和各赛季 `manifest.json` 为准；原始快照中的旧路径保留当时原貌，并在快照目录说明。

交接记录可能提到已经迁移或删除的旧目录，以及当时的“未提交”状态。这些记录用于解释历史；查当前数据时使用本页和对应资产清单。当前文档的可点击链接随资料迁移修复。

## 正在开发的本地内容

截至本次审阅，视觉基线、人物筛选、球衣与身份跟踪、人工选人复核，以及其方案增量仍属于本机开发工作。本次不移动、清理或提交以下内容：

- `tools/` 及尚未入库的视觉、身份跟踪、选人复核脚本。
- `research/vision-local-aws-deployment.md`、`research/vision-deployment-benchmark/`、`research/vision-player-refinement/`。
- `research/nba2k-rating-tables/` 中的本地草稿。
- `docs/agent-concept-review.md`、`research/video-overlay-vision-assessment.md` 中的开发增量，以及相关未提交交接。

`docs/status.md` 和 `research/README.md` 同时含有资料整理与本地开发更新。本次只同步完成资料相关段落；开发段落继续留在工作区。已发布的视觉研究仅修复指向新视频位置的链接，不发布本机后续实验。

`artifacts/`、`tmp/`、`data/raw/` 等目录保存本机来源、过程文件或缓存，继续按 `.gitignore` 排除。它们不作为其他成员获取已完成资料的入口；运行中的本地服务保持原状。

本次审阅与同步记录见[交接](../handoffs/Linzeyu912/2026-10-01-2118-repository-audit-sync.md)。
