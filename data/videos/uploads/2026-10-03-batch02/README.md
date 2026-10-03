# 2026-10-03 第二批用户上传视频

本批最初接收十一段 MP4，使用 Git LFS。2026-10-03 按用户要求以找到的同名文件替换 002；编号与片段 ID 保持不变，所有当前成片按原字节保存，没有转码。

批次 ID：`user-uploads-20261003-batch02`。接收时间：2026-10-03T13:43:16+08:00，Asia/Shanghai。资产与规格见 [manifest.json](manifest.json)，初次接收记录见 [sources/uploaded-files.json](sources/uploaded-files.json)，该历史快照保留原貌；002 的当前来源、替换前后哈希与查找结果见 [替换记录](sources/replacement-002-20261003.json)。

| 编号 | 原文件 / 成片 | 实测尺寸 / 帧率 | 时长 / 帧数 |
|---|---|---|---|
| 001 | [01_Warriors_20181005_Q2_11m35_motion_silent.mp4](clips/01_Warriors_20181005_Q2_11m35_motion_silent.mp4) | 1280×720，46531250/776289 fps | 24.841248 秒 / 1489 帧 |
| 002 | [02_Warriors_20240316_Q3_4m17_team_motion_1080class_silent.mp4](clips/02_Warriors_20240316_Q3_4m17_team_motion_1080class_silent.mp4) | 1920×1078，30/1 fps | 15.3 秒 / 459 帧 |
| 003 | [03_Warriors_20181005_Q2_6m13_slip_cut_silent.mp4](clips/03_Warriors_20181005_Q2_6m13_slip_cut_silent.mp4) | 1280×720，1178000000/19652931 fps | 19.652931 秒 / 1178 帧 |
| 004 | [04_Warriors_20181005_Q1_2m39_post_split_silent.mp4](clips/04_Warriors_20181005_Q1_2m39_post_split_silent.mp4) | 1280×720，60000/1001 fps | 17.500817 秒 / 1049 帧 |
| 005 | [05_Warriors_20160605_Finals_G2_Q3_motion_silent.mp4](clips/05_Warriors_20160605_Finals_G2_Q3_motion_silent.mp4) | 756×414，30/1 fps | 23.033333 秒 / 691 帧 |
| 006 | [06_Spurs_20160330_Q3_3m31_weave_slip_silent.mp4](clips/06_Spurs_20160330_Q3_3m31_weave_slip_silent.mp4) | 700×394，30/1 fps | 15.0 秒 / 450 帧 |
| 007 | [07_Warriors_20190610_Finals_G5_Q1_give_go_silent.mp4](clips/07_Warriors_20190610_Finals_G5_Q1_give_go_silent.mp4) | 1280×720，23100000/385411 fps | 12.846667 秒 / 770 帧 |
| 008 | [08_Lakers_20161104_Q2_10m42_post_split_silent.mp4](clips/08_Lakers_20161104_Q2_10m42_post_split_silent.mp4) | 1902×996，60/1 fps | 10.883333 秒 / 653 帧 |
| 009 | [09_Celtics_20161111_Q1_10m48_screen_screener_silent.mp4](clips/09_Celtics_20161111_Q1_10m48_screen_screener_silent.mp4) | 1920×1080，60/1 fps | 10.9 秒 / 654 帧 |
| 010 | [10_Spurs_20181124_Q1_4m28_multi_action_silent.mp4](clips/10_Spurs_20181124_Q1_4m28_multi_action_silent.mp4) | 854×480，60000/1001 fps | 14.96495 秒 / 897 帧 |
| 011 | [nba_primevision_5-25s.mp4](clips/nba_primevision_5-25s.mp4) | 1280×720，30/1 fps | 20.0 秒 / 600 帧 |

十一段合计 85,029,112 字节。001–010 无音频流；011 PrimeVision 保留原有一条音频流，未静音或改动。

005（756×414）、006（700×394）、010（854×480）低于 720p，单列为低分辨率素材；原尺寸保留，不放大或宣称高清。

002 替换文件实测为 1920×1078，文件名中的 `1080class` 仅是命名，不代表已完成画质验收。用户请求的 005、006、010 同名替换文件在本轮搜索范围内未找到，继续保留表中原视频。

## 来源与复核边界

- 除本次替换的 002 外，来源为初次用户直接上传文件。002 的原截图目录在本机不存在，本次从本机 Codex 文件预览缓存恢复同名文件；没有把它记为来自旧 Spurs 上传或原截图目录。原网页、发布者与来源原片裁切区间均未提供，保存 null 及缺失原因。
- 文件名日期、球队、节次、时钟与动作词仅作为命名线索，比赛及赛季没有独立确认，保存 null。
- ffprobe 测量、完整全部流解码及复制前后大小 / SHA-256 核对通过。正常速度、普通直播、清晰度、完整球权和战术标签仍未验收。
- 当前十一段 SHA-256 互不相同；本次替换的 002 与 catalog 中其余 156 条资产哈希均不相同。初次接收时其余十段亦未命中当时已有 146 条清单；不同编码、裁切或同回合内容重复尚未逐回合核对。

## 下载与校验

```sh
git lfs pull --include="data/videos/uploads/2026-10-03-batch02/clips/**" origin
python scripts/validate_video_data.py
```

初次入库结果见 [交接记录](../../../../handoffs/thy-0629/2026-10-03-1343-user-video-upload-batch02.md)，远端状态以交接及 Git 历史为准。

本次 002 替换与其余三项缺失的结果见 [替换交接](../../../../handoffs/thy-0629/2026-10-03-1448-video-replacement-002.md)。
