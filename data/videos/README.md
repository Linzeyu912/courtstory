# 视频资料入口

先读[视频数据管理规范](../../docs/video-data-management.md)，再按[批次目录](catalog.json)读取需要的清单。

| 批次 | 素材与标签 | 当前范围 |
|---|---|---|
| 2024–25，100段 | [播放页](nba/2024-25/library100/index.html)、[文字索引](nba/2024-25/library100/INDEX.md)、[资产清单](nba/2024-25/library100/manifest.json) | 100个成片通过LFS保存；14段完整球权，首批3段已包含 |
| 2025–26，30段 | [资产登记](nba/2025-26/batch030/manifest.json)、[标签与复核](../../research/nba-video-samples/batch-030-review.md) | 成片待上传，标签为采集文字草案；原记录1080p未在本机实测 |

## 拉取视频

从仓库根目录执行：

```sh
git lfs install --local
git pull --ff-only origin main
git lfs pull --include="data/videos/nba/2024-25/library100/clips/**" origin
python scripts/validate_video_data.py
```

缺少LFS下载时，MP4路径可能只是约百字节的指针，不能用播放器直接播放。校验脚本会识别这种情况。仅核对清单可加 `--metadata-only`。
