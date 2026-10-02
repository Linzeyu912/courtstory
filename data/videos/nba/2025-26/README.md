# NBA 2025–26：视频清单与标签

本赛季的素材登记、标签草案、复核说明和历史采集清单统一放在本目录。

成片入库日期：2026-10-01，Asia/Shanghai；同步结果见[本次交接](../../../../handoffs/Linzeyu912/2026-10-01-2307-raw-clips-lfs-upload.md)。**39 个成片已通过 Git LFS 共享至仓库，可 `git lfs pull` 下载；标签仍为草案，画面复核未完成。**

| 内容 | 入口 |
|---|---|
| 30 段资产登记（成片已入库） | [manifest.json](manifest.json) |
| 30 份独立标签草案 | [labels/](labels) |
| 标签、重复关系和待复核事项 | [review.md](review.md) |
| 30 段原采集清单 | [sources/batch-030.json](sources/batch-030.json) |
| 汇总标签草案的原始快照 | [sources/batch-030-labels.json](sources/batch-030-labels.json) |
| 历史 8 段登记（成片已入库） | [manifest-batch-008.json](manifest-batch-008.json)、[labels-batch-008/](labels-batch-008)、[sources/batch-008.json](sources/batch-008.json) |
| 历史单段登记（成片已入库） | [manifest-sample-001.json](manifest-sample-001.json)、[labels-sample-001/](labels-sample-001)、[sources/sample-001.json](sources/sample-001.json) |
| 成片文件（Git LFS） | [clips/](clips)，39 个 MP4，共 913,472,624 字节 |

## 当前状态

- **batch030 三十段**：2025-11-03 DAL at HOU（25 段）与 2025-11-09 HOU at MIL（5 段）。字节数与原采集记录逐一相符；尺寸、帧率、时长以入库时 ffprobe 实测写入清单。标签均为 `provisional_from_collector_notes`，看片确认前不定稿。
- **batch-008 八段与 sample-001 单段**：2026-01-31 DAL at HOU 官方集锦剪辑。按原批次独立登记（不并入 batch030 编号），与三十段的逐段对应关系**仍未确认**，不能相加声称 39 段独立素材。
- 入库只完成字节、哈希与规格测量；普通直播、正常速度、完整球权和画面清晰度的复核状态维持 `unverified`，见 [review.md](review.md) 与[管理规范](../../../../docs/video-data-management.md)。20/21 号共享 2 秒源区间，15/18 号有相关上下文，均保留待看片状态。
