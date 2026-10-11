# 训练视频约定

只保留两个官方训练样例。读取 catalog.json 和对应 manifest.json；保持原字节、编号、来源和未知字段。场景标签为既有 AI 初筛，候选轨迹不是人工真值。视频通过 Git LFS 保存。修改后运行 python scripts/validate_video_data.py --check-index。
