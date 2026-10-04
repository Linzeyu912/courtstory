# 2026-10-03 用户上传视频

2026-10-04 人工审核更新：本目录当前保留 **4 段**。已按用户决定删除 006；活动清单以本目录 manifest 和[正式场景目录](../../classification/README.md)为准；下文原始收集数量、统计与来源说明保留历史口径。人工记录见[本轮审核](../../reviews/human-2026-10-04/README.md)。

用户明确要求将聊天附件的四段 MP4 放入 HKS 视频目录并推送至备赛私有仓库。本批次保留原文件名和原始字节，使用 Git LFS；未做转码、裁切、配音或画面叠加。

批次 ID：`user-uploads-20261003`。接收日期：2026-10-03，Asia/Shanghai。资产与规格见 [manifest.json](manifest.json)，原文件接收记录见 [sources/uploaded-files.json](sources/uploaded-files.json)。

| 编号 | 原文件 / 成片 | 实测规格 | 时长 / 帧数 |
|---|---|---|---|
| 001 | [2025-11-09_MIL_Q3_0518_elbow_entry_guard_screen_dunk_silent.mp4](clips/2025-11-09_MIL_Q3_0518_elbow_entry_guard_screen_dunk_silent.mp4) | 1920×1080，60 fps，H.264 | 8.233333 秒 / 494 帧 |
| 002 | [2026-04-20_ATL_Q1_1030_handoff_fadeaway_silent.mp4](clips/2026-04-20_ATL_Q1_1030_handoff_fadeaway_silent.mp4) | 1920×1080，60000/1001 fps，H.264 | 8.942267 秒 / 536 帧 |
| 003 | [2026-04-20_ATL_Q3_0313_side_pick_roll_hook_silent.mp4](clips/2026-04-20_ATL_Q3_0313_side_pick_roll_hook_silent.mp4) | 1920×1080，60000/1001 fps，H.264 | 10.493817 秒 / 629 帧 |
| 004 | [01_20250523_IND_NYK_Q1_pass_relocate_three.mp4](clips/01_20250523_IND_NYK_Q1_pass_relocate_three.mp4) | 1920×1080，7740000/257257 平均 fps，H.264 | 8.575233 秒 / 258 帧 |

四段均无音频流，合计 58,683,997 字节。第四段帧率记录 ffprobe 测得的原分数（约 30.086645 fps），未统一为固定 30 fps。

## 来源与复核边界

- 来源是用户直接上传的文件；未提供原网页、发布者与原片裁切区间，这些字段保存 null，并记录缺失原因。
- 文件名包含日期、球队、节次、时钟及动作词线索，尚未独立核实；比赛信息与赛季保存 null，不混入已确认赛季的批次。
- 本轮完成 ffprobe 测量、完整文件解码、复制前后 SHA-256 与字节数检查。技术解码成功不代表普通直播、正常速度、清晰度、完整球权或动作标签已验收；这些项仍为 null / `unverified`。
- 与现有 142 条清单及已下载的 142 个成片比较 SHA-256，四段互不相同，也没有命中旧资产；不同编码、裁切或同回合内容重复尚未逐回合核对。

标签见 [labels/](labels/)。标签仅表示“用户上传 / 待复核”，不把文件名中的动作描述写成已确认战术。

## 下载与校验

```sh
git lfs pull --include="data/videos/uploads/2026-10-03/clips/**" origin
python scripts/validate_video_data.py
```

本轮交接见 [视频接收记录](../../../../handoffs/thy-0629/2026-10-03-1252-user-video-upload.md)，共享与远端下载状态以其同步记录及 Git 历史为准。
