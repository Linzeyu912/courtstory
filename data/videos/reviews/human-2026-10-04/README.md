# 2026-10-04 人工素材标签审核结果

用户通过本机人工标签审核页逐项完成固定40段抽检，保留28段、丢弃12段。当前素材库从175缩为163段；后续Agent读取活动素材应从 [catalog](../../catalog.json) 和 [classification](../../classification/index.json) 开始。

- [index.json](index.json)：40段实际人工审核清单、完成时间、修订号、去留及原记录路径。
- `records/<clip_id>.json`：用户原始落盘记录的原样副本，包括逐项评价、修改意见、点击位置、去留原因及审核时的标签快照。快照不是当前标签；不要把旧label_fingerprint直接当当前版本。
- [human-review-updates.json](../../classification/human-review-updates.json)：原人工意见怎样应用到当前标签，及删除记录。
- [discarded/index.json](../../classification/discarded/index.json)：12条已删除的来源、旧路径、SHA-256、清单/标签快照和用户原因；仅元数据归档，不含MP4，不属于活动训练目录。
- [camera-zoom-recheck.json](../../classification/camera-zoom-recheck.json)：保留163段的推拉两轮独立AI复核，保留初判与复核结果。

人工审核来源在28条保留标签及manifest/分类索引中显式记录 `human_reviewed=true`、`labeling_origin=human_reviewed`；未抽的135条保持AI来源。12条已删除的归档标签也记录人工审核。不能把163条全库AI复核写成人工标注。

原始意见包括12条素材、16项incorrect字段：8项推拉，以及清晰度、传球动作、球员出画。没有原因的两条丢弃仅写用户明确决定、不推测模糊或重复。帧数过低等其余原因保留用户原话，未将这些评价改成重新测得的帧率结论。

用户选择保留的 `user-uploads-20261003-batch02-011` 从机器排除改为困难场景保留：用于教学定格、图形加工等干扰增强；普通连续直播球权数据需按 `replay_or_teaching` 筛选。

人工记录是已完成这一轮审核的事实；之后AI根据这些意见调整的推拉字段单独记在 `camera_zoom_recheck` 和 `human_review.post_review_ai_modified_fields`，不能冒充用户再次确认当前时间段。2fps采样给出近似定位，精确裁剪仍需补看逐帧画面。

本机原文件继续留在忽略目录 `artifacts/material-label-human-review/records/`，共享副本不随页面浏览或再次审核被自动重写。审核页可优先读取本机新版本，缺失时读取本目录；汇总导出仍包含已删除素材的12条原意见。
