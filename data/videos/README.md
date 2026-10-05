# 视频资料入口

2026-10-05 新增两段[官方训练重点素材](uploads/2026-10-05-official-training/README.md)，当前总目录为 **9 个批次、165 个视频文件**。此前 2026-10-04 人工抽检与去杂后为 8 批 / 163 段。原库175段，40段完成真人逐项审核：28段保留、12段按用户决定删除。实际人工审核在标签和索引中标为 `human_reviewed=true`；原未抽的135段与本次新增的2段保持AI来源。原人工评价与删除依据见[人工审核记录](reviews/human-2026-10-04/README.md)。

初始入库情况：本次用户文件夹中的 [18 段视频](uploads/2026-10-04/README.md)按要求保留**赛季待核实**，以原名、原字节入库。画面为火箭与独行侠 13 段、马刺与尼克斯 5 段；官方比分 / 时钟匹配得到的候选信息单独保存，不提升为正式赛季标签。

## Agent 场景标注入口

后续 Agent 接手从 [结构化场景目录](classification/README.md)、[机器索引](classification/index.json)和 [读取约定](AGENTS.md)开始。每段现有 `labels/*.json` 新增 `material_labels`，逐项标明镜头推拉、全场移动、画面模糊、特写打断、视角切换，以及半场范围、遮挡、出画、回放等。按类型的文件夹统一以片段 ID 命名样本记录，包含源视频引用、来源与近似时间区间。

用途是覆盖真实转播场景，为后续数据增强准备；模糊和切镜不自动剔除。默认集合从 [selections/default](classification/selections/default/index.json)读取，无有效普通比赛过程的片段另列 excluded，画面已确认被长段包含的短段转为 redundant 备选。原成片维持唯一位置和 LFS，不改名、不多类别复制。[旧 HTML / CSV](reviews/2026-10-03/README.md)保留当时157段的历史阅读结果，当前165段的正式标签以结构化目录为准。

## 当前素材分组

| 素材 | 文件数 | 存放位置 / 入口 | 口径 |
|---|---:|---|---|
| 官方训练重点素材 | 2 | [2026-10-05-official-training/](uploads/2026-10-05-official-training/README.md) | 原始 1080p / 约 59.94 fps / 原声；优先回归，工作台默认可见 |
| 2024–25 主库 | 98 | [nba/2024-25/](nba/2024-25/README.md)、[播放页](nba/2024-25/index.html) | 首批 3 段已包含，不另外加 3 |
| 2025–26 主批次 | 28 | [nba/2025-26/manifest.json](nba/2025-26/manifest.json) | batch030 主批次 |
| 2025–26 历史补充 | 7 + 1 | 同一赛季 `clips/`；[8 段清单](nba/2025-26/manifest-batch-008.json)、[单段清单](nba/2025-26/manifest-sample-001.json) | 独立登记，内容去重仍有待核对项 |
| THY 交接的第一批补充上传 | 4 | [uploads/2026-10-03/](uploads/2026-10-03/README.md) | 用户上传、THY 入库，赛季未核实 |
| THY 交接的第二批补充上传 | 10 | [uploads/2026-10-03-batch02/](uploads/2026-10-03-batch02/README.md) | 002、005、006、010 已替换，赛季未核实 |
| 本次用户上传 | 13 | [uploads/2026-10-04/](uploads/2026-10-04/README.md) | 按用户最新要求，赛季与比赛日期待核实 |
| 独立验收样例 | 2 | [tactics/acceptance/](tactics/acceptance/README.md) | 勇士和马刺普通转播片段，编号 004–006 |

合计：**98 + 36 + 14 + 13 + 2 + 2 = 165 个文件**，不等于165个不同球权或战术。下方收集与发布记录中的175等数字为当时口径，删除记录不重编号。THY 的 15 段是补充上传 / 整理，现有记录没有证明由 THY 拍摄；文件名包含多个年份，不能全部算到 2025–26。本次 001、012 与历史片段的候选比赛时段有重叠关联，已写入清单。

成片均通过 **Git LFS** 共享；清单、标签和来源说明使用普通 Git。已核实赛季集中在 `nba/<赛季>/clips/`，未核实的用户上传按 `uploads/<接收日期>/clips/` 存放。每个批次的 `manifest.json`、`labels/`、`sources/` 保存规格、标签、原名与来源；[catalog.json](catalog.json)是全部批次的唯一登记入口。

工作台「视频库 / 导入」会读取 catalog，刷新文件夹即可重新扫描。另有[本机导入目录](../local-videos/README.md) `data/local-videos/` 及 `artifacts/` 处理缓存，它们被 Git 忽略，不会自动上传，也不计入上表。LFS 尚未下载时，有清单不代表本机已有完整视频。

## 既有批次与赛季入口

2026-10-03 新增 [素材分类与审核目录](reviews/2026-10-03/README.md)、[筛选播放页](reviews/2026-10-03/index.html)及 [CSV 目录表](reviews/2026-10-03/catalog.csv)。GPT-6.1 Sol 子 agent 按 2fps 密集抽帧检查全库，补充可见动作、清晰度、镜头 / 画面难点、异常时间段和使用意见；清晰素材与难点补充分开。逐段结果写入标签及清单的 `material_review`，保留原有来源与历史记录。剔除只影响本轮使用目录，源视频和工作台引用保留；AI 审核不代表真人逐帧真值。

2026-10-03 第二批的 002、005、006、010 已按用户要求完成替换并推送 main，远端独立下载核验全部通过。见 [当前批次说明](uploads/2026-10-03-batch02/README.md)、[002 替换记录](uploads/2026-10-03-batch02/sources/replacement-002-20261003.json)、[005 / 006 / 010 替换记录](uploads/2026-10-03-batch02/sources/replacement-005-006-010-20261003.json)及[补齐同步交接](../../handoffs/thy-0629/2026-10-03-1500-video-replacement-005-006-010.md)。

2026-10-03 新增 [第二批用户上传的十一段 MP4](uploads/2026-10-03-batch02/README.md)：原名及字节保留，按独立批次 `user-uploads-20261003-batch02` 登记，来源 / 比赛 / 赛季待核实，不混入已确认赛季批次。

2026-10-03 新增 [用户上传的四段 MP4](uploads/2026-10-03/README.md)：原文件名与字节保留，均为 1080p、无音频流，完整解码通过；来源网页、比赛与赛季尚未独立核实，单独登记为 `user-uploads-20261003`，不计入下方已确认赛季的批次。

按赛季查找：2024–25 和 2025–26 各一个目录，成片、标签、统计和采集说明放在所属赛季内。整理日期为2026-10-01（Asia/Shanghai），同步结果见[本次交接](../../handoffs/Linzeyu912/2026-10-01-2118-repository-audit-sync.md)。

| 赛季 | 入口 | 当前登记情况 |
|---|---|---|
| 2024–25 | [赛季说明](nba/2024-25/README.md)、[播放页](nba/2024-25/index.html)、[100 段统计](nba/2024-25/collection-report.md) | 100 个成片；首批 3 段已包含，后续新增 97 段 |
| 2025–26 | [赛季说明](nba/2025-26/README.md)、[资产清单](nba/2025-26/manifest.json)、[标签复核](nba/2025-26/review.md) | 39 个 LFS 成片（batch030 三十段 + 历史 8 段 + 历史单段，各自独立登记）；历史批次与三十段对应关系未确认，不额外计数 |

按数据提取验收：2026-10-02 [独立样例](tactics/acceptance/README.md)已用三个普通转播成片替换教学素材，编号004–006，包含勇士电梯门与两段马刺前场配合；正常速度、无解说音轨，普通直播与完整原始球权分别记录。放在 `data/videos/tactics/acceptance/`，不混入两个赛季；界面先筛直播画面，再标定球员并补轨迹，不预设战术结论。比赛日期 / 赛季未核实时保存 null，共享状态以 Git 历史及最新交接为准。

```text
data/videos/nba/
  2024-25/
    clips/               # 100 个 MP4 平铺，不再每段建文件夹
    labels/              # 001.json–100.json
    notes/               # 001.md–100.md
    sources/             # 原始采集快照
    README.md, INDEX.md, index.html, manifest.json
    collection-report.md, annotations.json
    repeat-groups.json, verification.json
  2025-26/
    clips/               # 39 个 MP4 平铺（Git LFS）
    labels/              # 30 份标签草案
    labels-batch-008/    # 历史 8 段标签
    labels-sample-001/   # 历史单段标签
    sources/             # 30 段、8 段、单段的历史清单
    README.md, manifest.json, manifest-batch-008.json, manifest-sample-001.json, review.md
```

批次 ID 和片段 ID 保持原值；[catalog.json](catalog.json)登记当前相对路径。首批3段的独立文件与重复包已按用户要求清理，只保留100段集合入口。原片、缓存和100段ZIP继续在本地忽略目录，日常使用从本页进入即可。2025–26 的 39 个成片于 2026-10-01 入库 LFS（见[交接](../../handoffs/Linzeyu912/2026-10-01-2307-raw-clips-lfs-upload.md)）。

在仓库根目录运行 `python scripts/validate_video_data.py` 可检查清单、文件大小及 SHA-256。LFS 下载和后续提交操作见[视频数据管理规范](../../docs/video-data-management.md)。
