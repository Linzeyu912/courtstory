# 视频数据管理规范

更新日期：2026-10-01，Asia/Shanghai。依据：用户要求统一管理视频数据，并将已有成片通过 Git LFS 上传至本私有仓库。这里规定团队练习素材的管理方式；赛事要求以[培训资料](../BroadcastCode赛事资料整理.md)及后续正式通知为准。

## 1. 目录与唯一编号

2026-10-01目录调整：按用户要求按赛季集中资料，取消批次文件夹和每段独立文件夹。目录和数据校验方法如下，同步结果见[本次交接](../handoffs/Linzeyu912/2026-10-01-2118-repository-audit-sync.md)。

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

## 2. 哪些文件入库

| 内容 | 保存方式 |
|---|---|
| 经过挑选的成片 MP4 等视频 | `data/videos/`，通过根 `.gitattributes` 使用 Git LFS |
| 来源、比赛信息、标签、清单、人工复核说明 | UTF-8、LF，普通 Git |
| 尚未拿到视频的片段 | 只登记清单，`asset.availability=awaiting_upload`；路径、字节、哈希为空 |
| 整场来源原片、候选剪辑、检查帧、缓存、重复ZIP | `artifacts/`、`data/raw/` 或其他本地忽略目录 |

Git LFS 在 Git 中保存含 SHA-256 和文件大小的指针，视频内容由 LFS 保存；首次使用需要安装并初始化 LFS。[GitHub 官方说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)，读取于2026-10-01。

此前LFS共享上传100个独立成片，不再把含同一批视频的ZIP上传一次。保留本机100段ZIP供离线分发。除 `data/videos/` 外的视频继续被忽略，不用 `git add -f` 批量加入来源原片。

## 3. 每段必须记录的内容

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

## 6. 下载、校验与提交

### 下载已有100段

在仓库根目录执行；先妥善保存本人的未提交工作。

```sh
git lfs install --local
git pull --ff-only origin main
git lfs pull --include="data/videos/nba/2024-25/clips/**" origin
python scripts/validate_video_data.py
```

打开 `data/videos/nba/2024-25/index.html` 可播放和筛选，也可按 `INDEX.md` 查找单段。[LFS 按路径下载说明](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-pull.adoc)，读取于2026-10-01。GitHub网页中的源代码ZIP是否包含成片取决于仓库设置；以 LFS 拉取和哈希校验为准。

### 提交新批次

1. 同步 `main`，检查已有目录和编号；在 `catalog.json` 登记批次。
2. 完成来源、比赛、标签、画质和去重记录。缺少文件则登记 `awaiting_upload`，不创建空MP4。
3. 先确认 `.gitattributes` 已覆盖该视频，再选择性暂存成片、清单和本次交接。
4. 执行 `python scripts/validate_video_data.py --check-index`、`git diff --cached --check`、`git lfs status`，确认暂存的是 LFS 指针且哈希/大小匹配。
5. 直接提交和正常推送 `main`。推送成功后核对远端 SHA，并从独立空缓存实际拉取 LFS 对象核对哈希，才能报告远端可下载。

仅查看目录时，可运行 `python scripts/validate_video_data.py --metadata-only`。该模式不证明视频文件已经存在或画质合格。校验脚本不代替 FFmpeg 解码和人工观察。

## 7. 当前登记状态

- 2024–25：100段成片，16场、17队；3段1080p、97段720p，14段完整球权。首批3段已包含其中。
- 2025–26：39 个成片已通过 Git LFS 共享（batch030 三十段 + 历史 8 段 + 历史单段，各自独立登记；历史批次与三十段对应关系未确认，不相加计数）。字节与哈希已入库核对，尺寸、帧率、时长以 ffprobe 实测为准；标签仍为草案，画面复核待看片完成。
- THY 的 NBA 2K 球员数据使用既有[数据包规范](../2K%20Player%20Data/AGENTS.md)，保留评分缺失和快照口径。球员能力包和视频清单分开管理；关联球员时仍须核实比赛、赛季和身份。
