# 本机视觉基线测量结果

采集日期：2026-10-01（Asia/Shanghai）。解释、环境及复现方法见[部署评估](../vision-local-aws-deployment.md)。

这些是一个 8.1081 秒篮球片段的重复运行结果，所有运行均处理 243 帧，仅检测人物。计时包含视频解码、已预热模型的检测、跟踪和一张诊断图保存；不包含完整产品流程，未测准确率。JSON 的时间与路径字段保留采集时原值。

| 配置 | 原始 JSON |
|---|---|
| YOLOv8n / ByteTrack / 640 | [第 1 次](yolov8n-bytetrack.json)、[第 2 次](yolov8n-bytetrack-r2.json)、[第 3 次](yolov8n-bytetrack-r3.json) |
| YOLOv8s / ByteTrack / 640 | [第 1 次](yolov8s-bytetrack.json)、[第 2 次](yolov8s-bytetrack-r2.json)、[第 3 次](yolov8s-bytetrack-r3.json) |
| YOLOv8s / BoT-SORT / 640，无 ReID | [第 1 次](yolov8s-botsort-r1.json)、[第 2 次](yolov8s-botsort-r2.json)、[第 3 次](yolov8s-botsort-r3.json) |
| YOLOv8s / ByteTrack / 1280 | [第 1 次](yolov8s-bytetrack-1280.json) |

[summary.json](summary.json) 按模型、跟踪器与缩放尺寸分组，保存运行次数、耗时中位数及范围。`real_time_factor` 为本阶段处理耗时除以视频时长，小于 1 表示该阶段快于视频播放。

脚本在早期运行后补充了 `preprocessed_image_shape_hwc` 字段，部分早期 JSON 没有该字段；未回填或修改原始结果。后续运行核验了 640 参数实际对应 384×640，1280 参数对应 736×1280。`torch_peak_*` 只统计 PyTorch 分配器，不是完整服务占用。

诊断图片、权重、虚拟环境和缓存位于被忽略的本地目录；不作为跨机器阅读本报告的前提。输入视频与权重的哈希保存在各次 JSON 中。

2026-10-01本地视频目录整理：原始测量JSON里的输入路径保留测量时原貌；当前001号成片见[视频文件](../../../data/videos/nba/2024-25/clips/IND-OKC_Q4_pick-pop_8.1s_1080p.mp4)。此前运行结果不因目录移动而改变。
