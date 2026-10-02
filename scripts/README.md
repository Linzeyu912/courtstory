# 仓库维护工具

- `validate_video_data.py`：全仓视频清单、标签、字节 / 哈希与暂存 Git LFS 指针检查；入口及要求见[视频规范](../docs/video-data-management.md)。
- `requirements/build_doc.py`、`requirements/build_integrated.py`：生成历史赛事手册，源文和成品在 `requirements/archive/broadcast-code-12/`。会覆盖相应手册，运行前确认输出，不能据此更新官方规则。

软件服务、视觉处理与对应测试集中在[engineering/scripts/](../engineering/scripts/README.md)。本目录只放仓库级维护工具。
