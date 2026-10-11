# CourtStory 训练视频

本仓库只保留两段官方训练视频：

- [训练_弗拉格2月1日.mp4](uploads/2026-10-05-official-training/clips/训练_弗拉格2月1日.mp4)
- [训练_阿门1月4日 .mp4](uploads/2026-10-05-official-training/clips/训练_阿门1月4日%20.mp4)

合计 171,215,644 字节，通过 Git LFS 保存。来源、文件摘要、标签和候选轨迹见 [训练批次](uploads/2026-10-05-official-training/manifest.json)，工作台默认打开这两段。其他视频库保留在原 Team Hub，不迁入本仓库。

运行 `git lfs pull` 下载；运行 `python scripts/validate_video_data.py --check-index` 校验。场景分类索引见 [classification/index.json](classification/index.json)，候选身份和位置仍需人工复核。
