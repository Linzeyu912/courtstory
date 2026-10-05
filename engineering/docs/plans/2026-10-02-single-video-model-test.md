# 单段篮球视频模型测试 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:verification-before-completion. 实验执行和结果审核分开进行。

## Goal

按照用户明确授权，实际处理一段篮球直播视频，交付可播放的球员检测、临时轨迹编号视频，并说明可见错误。完整人工确认界面、球员姓名和 2K 数据联接不在本次试跑范围内。

## Architecture / Tech Stack

本地独立 Python 环境，CUDA PyTorch、Ultralytics，E-BARD 的 BODD YOLOv8n 篮球专用权重，BoT-SORT 跟踪，OpenCV 读取和绘图，FFmpeg 导出 H.264 并保留原音轨。直接使用仓库现有的 005 湖人—森林狼 720p 片段。

## Global Constraints

- 按仓库约定在 main 上工作，保留现有改动，不推送或新建云资源。
- 环境、权重、临时脚本放在忽略的 `tmp/player-identity-test/`，导出放在忽略的 `artifacts/player-test-005-20261002/`。
- 推理必须实际使用 GPU；没有 GPU 时明确报错。
- 从模型名称确定 player 类，不沿用通用 COCO 的 class 0。
- 保留跟踪器尚未确认的原始检测框；候选数量不作为准确率。
- 不读取姓名标注充当识别结果；临时 ID 不等于球员身份。

## Tasks

- [x] 安装隔离环境，记录权重来源及 SHA256，验证 CUDA 张量和模型设备。
- [x] 处理完整片段，保存原始候选、跟踪 ID、预览帧、性能记录和标注视频。
- [x] 独立检查逐帧记录、视频解码、帧数和音轨，并人工查看漏检、误检和轨迹问题；保存实测报告并展示视频。

实测与局限见 [单片段报告](../../../research/vision/player-test-20261002.md)。运行及媒体交付通过，自动身份稳定性未达到产品验收要求。首版 120 ms 音画起点差异已从中间视频重新编码修复，未重复模型推理。

## Review Focus / Acceptance

验收是完成真实推理并交付可播放结果，不能将所有帧凑到十个框当作成功。报告需区分检测候选、已确认轨迹及真实球员身份；片段存在遮挡或球员出画面时不能承诺每帧十人。
