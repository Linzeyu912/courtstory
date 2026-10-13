# 视频数据管理规范

更新日期：2026-10-13，Asia/Singapore（UTC+8）。本页规定主仓库共享输入素材与最终展示成果的管理方式。赛事来源仍以[培训资料](../requirements/BroadcastCode赛事资料整理.md)及后续正式通知为准；产品介绍见[产品 README](../engineering/README.md)。

## 当前活动路径与规则

| 类别 | 现行入口 | 保存与校验范围 |
| --- | --- | --- |
| 共享输入素材 | [data/videos/](../data/videos/README.md) | 由 `catalog.json` / 批次 manifest 登记；视频用 Git LFS，来源、标签与轨迹用普通 Git |
| 选定的最终展示成果 | [deliverables/](../deliverables/README.md) | `.gitattributes` 覆盖 `deliverables/*.mp4`；MP4 用 Git LFS，SRT 和说明用普通 Git，需独立验证 |
| 工作台本地运行数据 | `data/local-videos/`、`data/local-workbench/`、`artifacts/` 等忽略目录 | 导入、裁剪、草稿和渲染输出留在本机；不会因生成成功自动入库或上传 GitHub |

本次整理时，活动输入是 [Single 考试视频](../data/videos/uploads/2026-10-10-exam/clips/single.mp4)，选定输出是 [Single 最终成片](../deliverables/single.mp4)及[字幕](../deliverables/single.srt)。它们分别是输入和产品输出，不能因文件同名就按重复文件删除。当前内容以后以 [catalog.json](../data/videos/catalog.json)、[数据总览](../data/README.md)、成果说明与 Git 跟踪状态共同核对。

新增共享视频必须先明确当前任务选定哪些文件、允许提交还是推送；本地提交、GitHub / LFS 上传及 AWS 部署按[协作流程](workflow.md#4-在-main-按授权提交与发布)分开处理。已有当前任务授权不重复确认，旧任务授权不自动延伸。禁止用批量强制添加把本地原片、导入或裁剪结果顺带发布。

共享说明和数据文本使用 UTF-8，新增或编辑内容优先 LF；保留既有格式合同，不顺带批量格式化历史资料。下方有日期的批次数量、旧目录和验收结论是历史记录，不代表当前文件仍在工作树中；历史入口需要结合对应提交查看。第 6 节是当前下载、验证与发布流程。

## 1. 目录与唯一编号

2026-10-01 历史目录调整：当时按用户要求按赛季集中资料，取消批次文件夹和每段独立文件夹。下面的赛季结构保留当时口径，现行活动路径见上文；同步结果见[本次交接](../handoffs/Linzeyu912/2026-10-01-2118-repository-audit-sync.md)。

```text
data/videos/
  catalog.json                         # 登记批次，ID保持不变
  nba/<season>/                        # 2024-25 / 2025-26，每赛季一个入口
    README.md, manifest.json           # 当前说明与资产清单
    clips/<filename>.mp4               # 成片集中保存，Git LFS
    labels/<local-id>.json             # 标签，普通 Git
    notes/<local-id>.md                # 单段说明（已有时）
    sources/                           # 原始采集快照，保留原貌
    collection-report.md, index.html   # 统计与播放入口（已有时）
```

- 批次 ID 如 `nba-2024-25-library100`，片段全局 ID 如 `nba-2024-25-library100-001`。编号分配后不重排；重裁同一素材时保留 ID、更新哈希，并写明裁切变化。
- 目录用英文和 NBA 球队简称。新文件建议 `<id>_<US-date>_<matchup>_Q<period>_<action>.mp4`；时长、像素以清单为准。现有100段保留原文件名，避免破坏既有引用。
- 清单中的 `asset.path`、`annotation_path` 相对于所在赛季目录；总目录里的 `root`、`manifest` 相对于仓库根目录。使用 `/`，禁止盘符路径、`..` 越界和指向仓库外的链接。
- 首批3段已纳入100段；按用户要求删除首批独立说明、旧重复成片及旧压缩包，统一只保留100段集合入口。2025–26的旧8段、旧单段清单在本赛季 `sources/` 中保留，尚未确认与30段的逐段对应关系，不能相加声称139段独立素材。

2026-10-02 用户要求另外按经典战术寻找验收素材，新增 `data/videos/tactics/acceptance/`，不归入两个赛季。该批次 `purpose=tactic_acceptance`、`season=null`；未核实比赛日期时必须写 `game.unknown_reason`。资产 / 标签路径相对于该批次根目录。用户随后明确拒绝讲解剪辑：验收素材同样要求普通直播、正常速度、连续进攻配合，不能放宽为教学字幕、人工停帧、慢放或非直播镜头；按本次无解说要求移除成片音轨，来源原片不改。完整前场配合和完整原始球权分别记录，未包含取得原始球权过程时不得标 `full_possession=true`。详见[样例范围与来源](https://github.com/Linzeyu912/courtstory/blob/56e6466057c0560701d3163d2dbd1384e59249d2/data/videos/tactics/acceptance/README.md)。

## 2. 哪些文件入库

2026-10-04 本次用户要求先标赛季待核实：18 段放入 `uploads/2026-10-04/`，正式 `season` 与比赛日期继续为 null。可见对阵可以按画面登记；官方比分 / 时钟匹配保存在 `candidate_game` 及独立[候选线索](https://github.com/Linzeyu912/courtstory/blob/56e6466057c0560701d3163d2dbd1384e59249d2/data/videos/uploads/2026-10-04/sources/game-candidates.md)，不能冒充已确认赛季，也不能将比赛核对 URL 当作原视频来源 URL。是否转入赛季目录在后续确认时处理，保持批次 ID 与原始文件字节。

2026-10-03 补充用户直接上传的成片：在 `data/videos/uploads/<接收日期>/` 独立登记，`purpose=user_upload`、`season=null`，每条 `source.kind=user_upload`。必须保存 `uploaded_filename`、接收日期与非空 `source.unknown_reason`；没有原来源网页 / 发布者时用 null，未提供原片裁切区间时起止秒数同时为 null，禁止只缺一端。比赛日期未核实时用 null 并写 `game.unknown_reason`；文件名只能作为线索。现有网络采集批次继续要求有效来源 URL、裁切区间和比赛核对口径，不借上传例外放宽。批次 / 清单 / 标签 / 解码 / 去重 / LFS 与远端实际下载校验仍执行本规范。

| 内容 | 保存方式 |
|---|---|
| 经过挑选并授权共享的输入视频 | `data/videos/`，通过根 `.gitattributes` 使用 Git LFS |
| 选定的最终展示 MP4 | `deliverables/*.mp4`，使用 Git LFS；由成果说明登记并独立校验 |
| 最终成果字幕 SRT | `deliverables/`，UTF-8 文本，普通 Git |
| 来源、比赛信息、标签、清单、人工复核说明 | UTF-8、LF，普通 Git |
| 尚未拿到视频的片段 | 只登记清单，`asset.availability=awaiting_upload`；路径、字节、哈希为空 |
| 整场来源原片、候选剪辑、检查帧、缓存、重复ZIP | `artifacts/`、`data/raw/` 或其他本地忽略目录 |

Git LFS 在 Git 中保存含 SHA-256 和文件大小的指针，视频内容由 LFS 保存；首次使用需要安装并初始化 LFS。[GitHub 官方说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)，读取于2026-10-01。

2026-10-01 历史记录：当时 LFS 共享上传 100 个独立成片，不重复上传含同一批视频的 ZIP，并保留本机 ZIP 用于离线分发。该数量不表示当前活动库仍有 100 段。现行视频入库范围为 `.gitattributes` 已覆盖的 `data/videos/` 输入路径和 `deliverables/*.mp4` 最终成果路径；其他本地视频继续按忽略规则管理。

## 3. 每段必须记录的内容

本节字段用于 `data/videos/` 中登记到 catalog 的输入素材，不强制把 `deliverables/` 输出伪装成输入批次。最终成果按第 6 节保存来源、规格、哈希与版本说明并单独验证。

`manifest.json` 使用 `schema_version="1.0.0"`，包含 `dataset_id`、`season`、`timezone`、`created_at`、`entries`。每条记录必须有下列字段；未知值用 null，缺失原因写在相应说明中。

| 字段 | 口径 |
|---|---|
| `clip_id` / `local_id` | 全局唯一 ID / 批次内固定编号 |
| `asset` | 批次相对路径、字节数、SHA-256、`storage`、`availability`；共享成片为 `git-lfs` / `included` |
| `annotation_path` | 独立标签相对路径；原采集说明另存，不覆盖原始清单 |
| `source` | 原页面 URL、发布者、采集日期、源片裁切起止秒数 |
| `game` | 赛季、美国比赛日期、对阵、比赛核对 URL、节次、起止比赛时钟、进攻与防守球队；北京时间已核对时另记 |
| `tactic` | 中文动作标题、标签、描述、标签状态、依据和置信说明 |
| `video` | 实际测量的时长、宽高、帧率；缺少文件时全为空；原采集者记录放在 `reported_video` |
| `review` | 正常速度、普通直播、完整球权、解码与视觉检查的结论、日期和依据；没有检查时为 null / `unverified` |
| `dedup` | 内容去重状态、同类动作组、关联片段 ID、源区间重叠与相关上下文 |

测量状态 `video.measurement_status` 只能是 `measured` 或 `unverified`。已有100段测量、解码及动作观察来自此前采集复核，本次重新校验文件字节与哈希；此次上传不会冒充一次新的战术视觉复核。

标签状态只用 `reviewed_visible_actions`（已看片的行为描述）或 `provisional_from_collector_notes`（根据采集文字起草）。即使看片，也不能把挡拆、空切等行为描述写成已确认的球队内部战术名称。修改标签时保留依据，并在交接记录说明改动；未核实的人员、时钟或战术不补猜测值。

## 4. 画面验收与素材选择

2026-10-04 补充负责人场景初筛要求：镜头推拉、全场移动、模糊、特写打断、视角切换是要覆盖的真实输入。当前正式标注使用现有标签的 `material_labels`，读取入口为 [classification](../data/videos/classification/README.md)与[视频 Agent 约定](../data/videos/AGENTS.md)。每个维度显式存 true / false / null、时间段与观察依据；来源有原片起点时换算来源时间，未知上传来源维持 null。按类型文件夹以稳定 `clip_id` 命名 JSON 样本记录，引用唯一原视频。模糊场景的增强价值与画质等级分别判断，默认集合只去掉无效素材和经画面确认包含的重复段，不按同类动作机械删除。

2026-10-03 的 [阅读目录](https://github.com/Linzeyu912/courtstory/blob/56e6466057c0560701d3163d2dbd1384e59249d2/data/videos/reviews/2026-10-03/README.md)与 `material_review` 保留历史口径，覆盖当时157段。当前机器消费以 `material_labels` 为准。初筛记录模型、方法、源视频 SHA-256、采样数量与理由；本轮40段真人审核已完成，保留的28段 `human_reviewed=true`，12段按用户决定物理移除，原评价及标签快照见 [人工审核归档](https://github.com/Linzeyu912/courtstory/blob/56e6466057c0560701d3163d2dbd1384e59249d2/data/videos/reviews/human-2026-10-04/README.md)。其余135段为AI标注；2fps 时间定位为约数，不冒充真人逐帧真值。保留素材不改编号与原字节；删除段从活动manifest、分类及关联中清理，原始来源快照保留。标注检查执行 `python engineering/scripts/build_material_labels.py --check`；推拉复核独立记录AI来源，不能把全库163段称为人工真值。

- 练习素材按具体批次要求选择赛季：100段为2024–25，新增30段为2025–26，不能混写赛季或上传日期。
- 使用普通直播画面和正常速度，保留原画幅、比分牌、音轨及水印。只裁切和必要编码；标签独立保存，不添加战术箭头、字幕或配音。
- 优先1080p，720p可作为明确标注的可用素材；低于720p单列说明。高清尺寸本身不能证明画面清晰，不靠放大尺寸宣称画质提升。
- 画质检查须查看连续运动及首、中、尾帧：球、球员、必要号码和比分时钟能否辨认，是否严重模糊、压缩损伤、遮挡或转场。记录实际尺寸、帧率、时长，并完整解码。
- 完整球权优先，保留取得球权至本次进攻结束。局部战术或终结片段可单列；近景、前一回合反应和回放不能计为完整活球过程。时长不设统一硬阈值，按完整过程裁切，并保存实际时长。
- `full_possession=true` 需要画面依据；未看到视频时用 null。比赛时钟被遮住就保存 null 并说明，不能根据视频长度推算成确定读数。
- 不设置笼统的“全部合格”字段；技术可播放、画面清晰、普通直播、完整球权和标签确认分别记录，筛选者按用途选择。

## 5. 去重与相似战术

1. SHA-256 去除逐字节相同的视频；转码后哈希不同仍可能是同一内容。
2. 按比赛、节次、比赛时钟、源片裁切区间和画面判断是否为同一球权。跨来源、跨批次也要检查；不能只在一个批次内去重。
3. 源区间有交集时记录共同秒数；相关反应画面、不同角度或回放另记上下文关联。重叠片段不能未经说明按完全独立内容计数。
4. 同类动作保留组号和双向关联。动作相似与整回合重复分别记录；不能把100段称为100种不同战术。
5. 未取得视频时，内容去重状态为 `unverified`，可以先标明清单可计算的重叠。30段中的20/21号共享2秒源区间，15/18号有关联上下文，均保留待看片标记。

## 6. 下载、校验、提交与发布

### 下载当前选定的输入与成果

在仓库根目录执行。进入开发同步时先妥善保存未提交工作，按[协作流程](workflow.md)同步 `main`；只读任务不自动切换分支或改变工作区。

```sh
git lfs pull --include="data/videos/uploads/2026-10-10-exam/clips/single.mp4,deliverables/single.mp4" origin
python scripts/validate_video_data.py --check-index
```

上述路径是本次整理时的 Single 输入与最终成果；下载其他选定媒体时按实际路径调整。[LFS 按路径下载说明](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-pull.adoc)沿用 2026-10-01 来源。GitHub 源代码 ZIP 是否包含成片取决于仓库设置，以实际 LFS 下载和哈希核对为准。

`validate_video_data.py` 从 `data/videos/catalog.json` 枚举输入素材，`--check-index` 核对其中已登记媒体的暂存指针。**该脚本不枚举 `deliverables/`，通过它不能证明最终成片的 LFS、内容或解码有效。** `--metadata-only` 也只检查清单，不能证明视频存在、可播放或画质合格。

### 共享输入素材的验证

1. 按当前任务确认选定文件、批次和固定 ID；新增批次写入 `catalog.json`，保持既有编号与引用。
2. 完成来源、比赛、标签、尺寸、帧率、时长、解码和去重记录。缺少文件登记 `awaiting_upload`，不创建空 MP4。
3. 检查 `.gitattributes` 的实际匹配；已授权提交时只暂存本次输入、清单、标签与必要交接。
4. 执行 `python scripts/validate_video_data.py --check-index`、`git diff --cached --check` 与 `git lfs status`，核对清单、文件和暂存指针的哈希及大小；完整解码与画面检查另行执行。

### 最终展示成果的独立验证

以当前 `deliverables/single.mp4` 为例，其他成果换成当前任务明确选定的路径。成果目录只保存选定的最终版本，工作台的原始输出和多次候选留在忽略目录。

1. **文件与说明**：成果说明写清输入来源、版本、实际规格、配音/字幕及验证日期；README 使用相对链接指向最终 MP4 / SRT，并逐个检查目标存在、不会跳到输入同名文件。SRT 用普通 Git 保存。
2. **属性匹配**：执行 `git check-attr filter diff merge text -- deliverables/single.mp4`，应分别得到 `lfs`、`lfs`、`lfs` 和 `unset`。现有规则为 `deliverables/*.mp4`，不能据此声称任意嵌套目录或其他扩展名都已覆盖。
3. **选定暂存内容**：仅在允许本地提交时暂存本次成果及字幕/说明；用 `git diff --cached --name-only -- deliverables/` 与完整暂存差异核对选择，不使用批量强制添加收集运行目录。
4. **指针与实际字节**：暂存后用下列命令把索引中的 LFS 指针与工作树中的实际文件生成的指针对比。必须读取真实视频文件，不能只看到 `.mp4` 文件名就认定对象已下载。

```sh
git show :deliverables/single.mp4 | git lfs pointer --file=deliverables/single.mp4 --stdin
git lfs status
```

5. **媒体内容**：计算实际文件 SHA-256 和大小，与上一步指针的 `oid sha256`、`size` 一致；使用 ffprobe 或等价工具测量音视频流、时长、帧率和尺寸，用 FFmpeg 完整解码，并检查实际画面与字幕时序。例如：

```sh
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,avg_frame_rate -of json deliverables/single.mp4
ffmpeg -v error -i deliverables/single.mp4 -f null -
```

6. **提交后的对象**：本地提交后运行 `git lfs fsck HEAD`，核对该提交的指针与本地对象。发现缺失或损坏先处理并说明，不能把检查失败写成验证通过。LFS 一致性不代替解码、人工观看或网页播放验证。

### 发布与远端核对

按当前任务授权完成本地提交后，若已授权推送，再检查 `git lfs push --dry-run origin main` 列出的待上传对象是否都属于本次选定的输入或成果，运行署名检查并正常 `git push origin main`。若出现未计划的旧媒体，先核对来源和范围；不通过 `--all` 顺带补传整段历史媒体。

Git push 的 LFS hook 可能先上传对象，再更新远端 main。应分别核对 Git 远端提交和媒体对象状态；随后从独立空缓存实际拉取本次选定的 LFS 对象，重新计算大小和 SHA-256，才能报告它们可从远端下载。需要报告网页可播放时还要实际打开验证，不能用本地解码或哈希代替。仓库与媒体推送均不代表已经更新 AWS 工作台。

### 历史下载示例

2026-10-01 曾使用 `data/videos/nba/2024-25/clips/**` 拉取当时的 100 段，并通过赛季 `index.html` / `INDEX.md` 查看。此处保留操作背景；这些旧路径和数量不是当前下载入口，需要历史素材时先定位当时提交与其 LFS 可用性。

## 7. 历史登记状态

以下数量均为相应日期的历史记录，不能作为当前活动库、已共享对象或人工验收数量。当前入口见本页开头与[数据总览](../data/README.md)。

2026-10-05 当时为9批 / 165段：此前175段经人工删除12段形成163段，后新增[官方训练2段](https://github.com/Linzeyu912/courtstory/blob/56e6466057c0560701d3163d2dbd1384e59249d2/data/videos/uploads/2026-10-05-official-training/README.md)。官方训练通过用户提供ZIP接收，沿用 `purpose=user_upload` 的来源未知字段规则，以 `category=official_training` / `priority=primary_regression` 单独标明用途；原MP4使用LFS，ZIP与抽帧缓存不重复共享。下文数量保留对应日期口径。

2026-10-04 总计 8 批 / **175 个文件**：2024–25 100 个，2025–26 39 个（30 + 历史 9），THY 交接的两批未核实赛季上传 15 个，本次未核实赛季上传 18 个，独立验收样例 3 个。入口与存放方式见[总览](../data/videos/README.md)。本次新增文件完整解码与复制哈希通过；文件数不代表新增独立球权数。

- 2024–25：100段成片，16场、17队；3段1080p、97段720p，14段完整球权。首批3段已包含其中。
- 2025–26：39 个成片已通过 Git LFS 共享（batch030 三十段 + 历史 8 段 + 历史单段，各自独立登记；历史批次与三十段对应关系未确认，不相加计数）。字节与哈希已入库核对，尺寸、帧率、时长以 ffprobe 实测为准；标签仍为草案，画面复核待看片完成。
- THY 的 NBA 2K 球员数据使用既有[数据包规范](../2K%20Player%20Data/AGENTS.md)，保留评分缺失和快照口径。球员能力包和视频清单分开管理；关联球员时仍须核实比赛、赛季和身份。
