# 仓库目录与数据入口

更新：2026-10-02，Asia/Shanghai。依据本轮用户要求：整理全部积累改动、分类提交共享，并把赛事要求与工程软件分开存储。本轮只重整文件和引用，不重新解释或采集赛事规则。

## 目录边界

```text
requirements/                 # 赛事要求、培训整理、历史来源与阅读手册
engineering/                  # 软件、产品设计、技术研究与测量
  tools/tactical-overlay/    # 独立战术引擎、SVG 与报告构建
  tools/player-review/        # 复核工作台前端、bundle 和 JavaScript 测试
  scripts/                    # Python 服务、视觉处理和实验脚本
  docs/                       # 产品 / 工程设计
  research/                   # 技术评估、原始测量及参考点
data/                         # 视频成片、标签、来源和辅助参考数据
2K Player Data/               # 既有 Agent 球员数据包，保留读取契约
docs/                         # 团队状态、协作、决策和仓库规范
handoffs/<github-login>/      # 每次工作的历史交接
scripts/                      # 仓库维护：视频索引校验、历史手册生成
```

| 要查的内容 | 入口 | 使用口径 |
|---|---|---|
| 最新赛事要求、评分与提交清单 | [赛事整理](../requirements/BroadcastCode赛事资料整理.md)、[资料索引](../requirements/README.md) | 以注明日期的官方来源为准；转写疑点与团队建议分开 |
| 软件运行和测试 | [工程入口](../engineering/README.md)、[工作台](../engineering/tools/player-review/README.md) | 本机数据提取原型；完整 Agent / AWS 尚未完成 |
| 产品设计与技术实验 | [设计稿](../engineering/docs/agent-concept-review.md)、[实验索引](../engineering/research/README.md) | 建议、单片段测量和未验收能力明确标注 |
| 团队同步和负责人 | [状态](status.md)、[协作](workflow.md)、[决策](decisions.md) | 全部直接在 main，任务范围以 Issue / 用户授权为准 |
| 视频成片及标签 | [视频入口](../data/videos/README.md)、[管理规范](video-data-management.md) | 100 段 2024–25、39 段 2025–26登记记录及 3 段验收样例；历史批次与新批次关系未确认，不声称 142 个独立球权 |
| 球员评分数据包 | [清单](../2K%20Player%20Data/manifest.json)、[Agent 约定](../2K%20Player%20Data/AGENTS.md) | 1.1版，635 条赛季记录；本轮不移动、改评分或改索引 |
| 评分来源复核辅助表 | [辅助表说明](../data/reference/nba2k/README.md) | 原有草稿单独归档，不替代正式数据包 |
| 验收素材 | [样例说明](../data/videos/tactics/acceptance/README.md) | 004–006 普通转播；仅候选数据，无真实十人身份真值 |
| 历史交接 | [交接目录](../handoffs/README.md) | 当时的完成和未推送状态保留；查本次同步使用最新交接 |

## 迁移路径

| 旧位置 | 当前位置 |
|---|---|
| 根 `BroadcastCode赛事资料整理.md` | `requirements/BroadcastCode赛事资料整理.md` |
| `research/broadcast-code-12/` | `requirements/archive/broadcast-code-12/` |
| `research/nba-china-xfg-chart.md` | `requirements/references/nba-china-xfg-chart.md` |
| `tools/player-review/` | `engineering/tools/player-review/` |
| 视觉处理与复核的 `scripts/*.py` | `engineering/scripts/` |
| `research/vision*` 与 Jev 技术研究 | `engineering/research/` |
| `docs/agent-concept-review.md` | `engineering/docs/agent-concept-review.md` |
| `research/nba2k-rating-tables/` | `data/reference/nba2k/drafts/` |
| 历史手册生成器 | `scripts/requirements/` |

当前 Markdown 链接和可执行命令使用新路径。历史交接中的路径文字、官方快照、实验 JSON、Word 手册和视频字节保持原貌；历史链接可跳到当前位置。以后新增软件不再写根 `tools/` 或旧 `research/`，新增赛事材料不混进工程实验。

## 本机文件与共享状态

`artifacts/`、`tmp/`、`data/raw/`、依赖环境和浏览器草稿继续排除，不能作为其他成员获取已共享成果的入口。已选成片仅在 `data/videos/` 用 Git LFS 保存，提交前运行 `python scripts/validate_video_data.py --check-index`。云部署、组外分享和赛事提交不在本轮授权范围。

本次分类提交、验证和远端核对结果见[整理同步交接](../handoffs/Linzeyu912/2026-10-02-1109-organize-publish.md)。

## 2026-10-03 工作台整合补充

2026-10-04 素材更新：共享 catalog 现为 175 个文件。本次 18 段按用户要求保留赛季待核实，放入 `data/videos/uploads/2026-10-04/`；THY 两批 15 段也继续在 `uploads/`。当前完整分组见[视频入口](../data/videos/README.md)，下段 157 条为 10 月 3 日当时状态。

共享战术候选在 [data/tactics](../data/tactics/README.md)，本机审核数据在 [data/local-workbench](../data/local-workbench/README.md)，本机导入原片在 [data/local-videos](../data/local-videos/README.md)。视频库读取共享 catalog，包含今天新增的两批 15 段上传视频；现共登记 157 段。功能代码留在工程目录；已有推理缓存保持忽略。见[整合说明](../engineering/docs/workbench-integration.md)。
