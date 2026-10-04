# NBA 2024–25：100 段训练素材

2026-10-04 人工审核更新：本目录当前保留 **98 段**。已按用户决定删除 038、045；活动清单以本目录 manifest 和[正式场景目录](../../classification/README.md)为准；下文原始收集数量、统计与来源说明保留历史口径。人工记录见[本轮审核](../../reviews/human-2026-10-04/README.md)。

本赛季的成片、标签、统计和采集说明统一放在本目录。**总共 100 段，首批 3 段是其中的 001–003；后续新增 97 段，不另外算一批视频。**

本次目录整理日期：2026-10-01，Asia/Shanghai。目录调整和旧包清理的同步结果见[本次交接](../../../../handoffs/Linzeyu912/2026-10-01-2118-repository-audit-sync.md)；此前100段通过Git LFS共享的记录见[历史交接](../../../../handoffs/Linzeyu912/2026-10-01-0848-video-lfs-management.md)。

| 内容 | 入口 |
|---|---|
| 100 个 MP4，集中在一个文件夹 | [clips/](clips) |
| 播放、搜索、按动作组与完整程度筛选 | [index.html](index.html) |
| 100 段文字索引 | [INDEX.md](INDEX.md) |
| 当前视频路径、哈希和标签登记 | [manifest.json](manifest.json) |
| 逐段标签 / 中文说明 | `labels/001.json`–`100.json` / `notes/001.md`–`100.md` |
| 16 场比赛、17 支球队及动作组统计 | [collection-report.md](collection-report.md) |
| 当前汇总标注 / 同类动作组 | [annotations.json](annotations.json)、[repeat-groups.json](repeat-groups.json) |
| 原始来源快照 | [sources/library100.json](sources/library100.json) |
| 既有采集验证记录 | [verification.json](verification.json) |

合计 838.553 秒（约 14 分钟），3 段 1080p、97 段 720p；14 段完整球权，其余 86 段注明实际片段范围。动作分 G01–G16 组；相似动作与同一内容重复分别记录。007、038、051、071 的起始比赛时钟不可见，仍保留 null。

视频文件名、编号和 SHA-256 保持原值。标签中的 `file` 与播放页已改为当前相对路径；来源、比赛日期、动作、完整性和既有检查结论未改写，未重新编码或做新的画面验收。标签描述可见动作，球队内部战术名称未确认。

按用户后续要求，首批3段的独立说明、重复成片、旧清单和旧压缩包已清理，统一只使用本100段集合；001–003仍完整保留。原片、检查帧及100段采集备份继续在本地忽略目录。原始快照中的旧路径解释见[sources/README.md](sources/README.md)。管理方法见[视频数据管理规范](../../../../docs/video-data-management.md)。
