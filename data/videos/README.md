# 视频资料入口

按赛季查找：2024–25 和 2025–26 各一个目录，成片、标签、统计和采集说明放在所属赛季内。整理日期为2026-10-01（Asia/Shanghai），同步结果见[本次交接](../../handoffs/Linzeyu912/2026-10-01-2118-repository-audit-sync.md)。

| 赛季 | 入口 | 当前登记情况 |
|---|---|---|
| 2024–25 | [赛季说明](nba/2024-25/README.md)、[播放页](nba/2024-25/index.html)、[100 段统计](nba/2024-25/collection-report.md) | 100 个成片；首批 3 段已包含，后续新增 97 段 |
| 2025–26 | [赛季说明](nba/2025-26/README.md)、[资产清单](nba/2025-26/manifest.json)、[标签复核](nba/2025-26/review.md) | 30 段登记与标签草案，成片待取得；历史 8 段与单段记录不额外计数 |

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
    labels/              # 30 份标签草案
    sources/             # 30 段、8 段、单段的历史清单
    README.md, manifest.json, review.md
```

批次 ID 和片段 ID 保持原值；[catalog.json](catalog.json)登记当前相对路径。首批3段的独立文件与重复包已按用户要求清理，只保留100段集合入口。原片、缓存和100段ZIP继续在本地忽略目录，日常使用从本页进入即可。

在仓库根目录运行 `python scripts/validate_video_data.py` 可检查清单、文件大小及 SHA-256。LFS 下载和后续提交操作见[视频数据管理规范](../../docs/video-data-management.md)。
