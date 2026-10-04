# 2026-10-03 第二批用户上传视频

2026-10-04 人工审核更新：本目录当前保留 **10 段**。已按用户决定删除 006；活动清单以本目录 manifest 和[正式场景目录](../../classification/README.md)为准；下文原始收集数量、统计与来源说明保留历史口径。人工记录见[本轮审核](../../reviews/human-2026-10-04/README.md)。

本批最初接收十一段 MP4，使用 Git LFS。2026-10-03 按用户要求分两轮以找到的同名文件替换 002、005、006、010；编号与片段 ID 保持不变，所有当前成片按原字节保存，没有转码。

批次 ID：`user-uploads-20261003-batch02`。接收时间：2026-10-03T13:43:16+08:00，Asia/Shanghai。资产与规格见 [manifest.json](manifest.json)，初次接收记录见 [sources/uploaded-files.json](sources/uploaded-files.json)，该历史快照保留原貌；002 的当前来源、替换前后哈希与查找结果见 [002 替换记录](sources/replacement-002-20261003.json)；本轮三个文件见 [005 / 006 / 010 替换记录](sources/replacement-005-006-010-20261003.json)。

| 编号 | 原文件 / 成片 | 实测尺寸 / 帧率 | 时长 / 帧数 |
|---|---|---|---|
| 001 | [01_Warriors_20181005_Q2_11m35_motion_silent.mp4](clips/01_Warriors_20181005_Q2_11m35_motion_silent.mp4) | 1280×720，46531250/776289 fps | 24.841248 秒 / 1489 帧 |
| 002 | [02_Warriors_20240316_Q3_4m17_team_motion_1080class_silent.mp4](clips/02_Warriors_20240316_Q3_4m17_team_motion_1080class_silent.mp4) | 1920×1078，30/1 fps | 15.3 秒 / 459 帧 |
| 003 | [03_Warriors_20181005_Q2_6m13_slip_cut_silent.mp4](clips/03_Warriors_20181005_Q2_6m13_slip_cut_silent.mp4) | 1280×720，1178000000/19652931 fps | 19.652931 秒 / 1178 帧 |
| 004 | [04_Warriors_20181005_Q1_2m39_post_split_silent.mp4](clips/04_Warriors_20181005_Q1_2m39_post_split_silent.mp4) | 1280×720，60000/1001 fps | 17.500817 秒 / 1049 帧 |
| 005 | [05_Pacers_20250106_Q2_0m44_team_motion_720p_silent.mp4](clips/05_Pacers_20250106_Q2_0m44_team_motion_720p_silent.mp4) | 1280×720，60/1 fps | 17.5 秒 / 1050 帧 |
| 006 | [06_Grizzlies_20251202_Q1_6m33_screens_handoffs_native708_silent.mp4（人工已删除）](../../classification/discarded/user-uploads-20261003-batch02-006.json) | 1280×708，30/1 fps | 17.766667 秒 / 533 帧 |
| 007 | [07_Warriors_20190610_Finals_G5_Q1_give_go_silent.mp4](clips/07_Warriors_20190610_Finals_G5_Q1_give_go_silent.mp4) | 1280×720，23100000/385411 fps | 12.846667 秒 / 770 帧 |
| 008 | [08_Lakers_20161104_Q2_10m42_post_split_silent.mp4](clips/08_Lakers_20161104_Q2_10m42_post_split_silent.mp4) | 1902×996，60/1 fps | 10.883333 秒 / 653 帧 |
| 009 | [09_Celtics_20161111_Q1_10m48_screen_screener_silent.mp4](clips/09_Celtics_20161111_Q1_10m48_screen_screener_silent.mp4) | 1920×1080，60/1 fps | 10.9 秒 / 654 帧 |
| 010 | [10_Celtics_20231201_Q4_1m01_multi_action_720p_silent.mp4](clips/10_Celtics_20231201_Q4_1m01_multi_action_720p_silent.mp4) | 1280×720，60/1 fps | 17.45 秒 / 1047 帧 |
| 011 | [nba_primevision_5-25s.mp4](clips/nba_primevision_5-25s.mp4) | 1280×720，30/1 fps | 20.0 秒 / 600 帧 |

十一段合计 94,791,303 字节。001–010 无音频流；011 PrimeVision 保留原有一条音频流，未静音或改动。

当前 006 实测为 1280×708，低于 720p，保留原尺寸、未放大；005、010 实测均为 1280×720。尺寸不代表已通过画质验收。

002 替换文件实测为 1920×1078，文件名中的 `1080class` 仅是命名，不代表已完成画质验收。用户要求再次查找后，005、006、010 同名文件本轮均在本机预览缓存中找到并替换；四个请求编号现均已替换。

## 来源与复核边界

- 002、005、006、010 分两轮从本机 Codex 文件预览缓存恢复用户指定的完整同名文件；截图目录在本机仍不存在。其余七段来源为初次用户直接上传文件。原网页、发布者与来源原片裁切区间均未提供，保存 null 及缺失原因。
- 文件名日期、球队、节次、时钟与动作词仅作为命名线索，比赛及赛季没有独立确认，保存 null。
- ffprobe 测量、完整全部流解码及复制前后大小 / SHA-256 核对通过。正常速度、普通直播、清晰度、完整球权和战术标签仍未验收。
- 当前十一段 SHA-256 互不相同；本轮三个替换文件与 catalog 中其余 154 条资产哈希均不相同。002 的哈希核对见上一轮记录；不同编码、裁切或同回合内容重复尚未逐回合核对。

## 下载与校验

```sh
git lfs pull --include="data/videos/uploads/2026-10-03-batch02/clips/**" origin
python scripts/validate_video_data.py
```

初次入库结果见 [交接记录](../../../../handoffs/thy-0629/2026-10-03-1343-user-video-upload-batch02.md)，远端状态以交接及 Git 历史为准。

上一轮 002 替换与当时其余三项缺失的结果见 [替换交接](../../../../handoffs/thy-0629/2026-10-03-1448-video-replacement-002.md)。

本轮补齐 005、006、010 的结果见 [本轮交接](../../../../handoffs/thy-0629/2026-10-03-1500-video-replacement-005-006-010.md)，同步状态以交接为准。
