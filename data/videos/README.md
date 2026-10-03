# 视频资料入口

2026-10-03 新增 [用户上传的四段 MP4](uploads/2026-10-03/README.md)：原文件名与字节保留，均为 1080p、无音频流，完整解码通过；来源网页、比赛与赛季尚未独立核实，单独登记为 `user-uploads-20261003`，不计入下方已确认赛季的批次。

按赛季查找：2024–25 和 2025–26 各一个目录，成片、标签、统计和采集说明放在所属赛季内。整理日期为2026-10-01（Asia/Shanghai），同步结果见[本次交接](../../handoffs/Linzeyu912/2026-10-01-2118-repository-audit-sync.md)。

| 赛季 | 入口 | 当前登记情况 |
|---|---|---|
| 2024–25 | [赛季说明](nba/2024-25/README.md)、[播放页](nba/2024-25/index.html)、[100 段统计](nba/2024-25/collection-report.md) | 100 个成片；首批 3 段已包含，后续新增 97 段 |
| 2025–26 | [赛季说明](nba/2025-26/README.md)、[资产清单](nba/2025-26/manifest.json)、[标签复核](nba/2025-26/review.md) | 39 个 LFS 成片（batch030 三十段 + 历史 8 段 + 历史单段，各自独立登记）；历史批次与三十段对应关系未确认，不额外计数 |

按数据提取验收：2026-10-02 [独立样例](tactics/acceptance/README.md)已用三个普通转播成片替换教学素材，编号004–006，包含勇士电梯门与两段马刺前场配合；正常速度、无解说音轨，普通直播与完整原始球权分别记录。放在 `data/videos/tactics/acceptance/`，不混入两个赛季；界面先筛直播画面，再标定球员并补轨迹，不预设战术结论。比赛日期 / 赛季未核实时保存 null，本轮未提交推送。

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
