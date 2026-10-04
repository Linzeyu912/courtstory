# 交接：新导入 Warriors 视频后段固定身份丢失

- 日期 / 时区：2026-10-04 14:55，Asia/Shanghai
- 成员：thy-0629
- 任务：解释用户所见紫衣 10 号清楚可见、后段却只剩临时编号的原因。
- 分支 / 基线：main，df68c50
- 状态：只读诊断完成；未修改跟踪算法、阈值、用户草稿或服务。
- 提交：本诊断记录未提交、未推送。

## 已确认事实

素材为 `01_Warriors_20181005_Q2_11m35_motion_silent`，本机样本 ID 为 `local-4d6e76ed515a775d8971ed58ca7fc241abc022cb201e8762a6716290aa215618`，使用 team-stable。1489 帧、末帧 24.825 秒，元数据 partial_run=false，未提前结束推理。

| 画面 / 时间 | 原始观测与目视核对 |
| --- | --- |
| 零基帧 380 / 6.340 秒 | 紫衣背号 10 为 T2，框约 [640.9,214.2,690.9,329.5] |
| 零基帧 853 / 14.231 秒 | 紫衣背号 10 为 T62，框约 [377.3,320.0,450.0,491.8] |
| 同一帧 853 | 原 T2 已落在白衣背号 21 上，框约 [777.3,479.1,855.5,617.3] |
| 零基末帧 1488 / 24.825 秒 | 仍检测到 T76、T62、T112、T124、T118、T121 六个人物；并非后段完全漏检 |

两条执行通道分别核对原帧与 JSON，得到一致结论。这些是指定画面的可见球衣证据，不代表对整段全部人物完成身份验收。

## 原因

1. 跟踪编号已发生串人和断裂。该片自动身份建议的 links 为空，所有自动 P 绑定最晚在 21.805 秒结束。后段有 T 框而没有固定 P 身份。
2. T2 和 T62 在 optimized / team-stable 的自动建议中均未分配固定 P。浏览器当时显示人工关联 0/10、十个模型建议待确认；不能把槽位齐全当作这位真实球员已被绑定。
3. 当前绑定引用 T 编号和帧区间；现有 ReID 使用运动、检测器外观特征和队色，执行流程没有球衣数字 OCR。人工填写 jersey 或关联球员资料也不会建立新的视觉身份识别器。
4. 颜色冲突还会使自动身份进入待审核状态。例如 T4 在 14.231 秒后触发颜色风险并持续到该轨迹结束；T2 也存在长期风险。不能直接清除风险来让编号重新出现：T2 在 14.231 秒的串人已有图像证据。T4 是否误报尚未独立确认。

代码依据：[`basketball_tracking.py`](../../engineering/scripts/basketball_tracking.py) 的共同帧种子与碎片链接、[`basketball_tracker.py`](../../engineering/scripts/basketball_tracker.py) 的颜色风险状态、[`identity-timeline.mjs`](../../engineering/tools/player-review/identity-timeline.mjs) 的区间绑定、[`automatic-annotations.mjs`](../../engineering/tools/player-review/automatic-annotations.mjs) 的候选与身份显示规则。号码资料见 [`player-identity.mjs`](../../engineering/tools/player-review/player-identity.mjs)。

## 证据与后续

本机诊断文件在被忽略目录 `artifacts/tracking-diagnosis-20261004/`：`clip.json` 为服务返回的当前样本数据；`frame-01.jpg`、`frame-02.jpg`、`frame-03.jpg`、`frame-04.jpg` 分别为零基帧 380、853、1199、1488，通过 FFmpeg 精确按帧提取。原始结果位于该样本 imports 目录的 `6b4a426106dc4e18a35bf80bd0f1660c` 子目录。

后续需要提升跨 T 的身份续接：以清晰号码、队服和外观作为身份参考，对新轨迹提出候选，再允许人工一次确认多个片段。当前时间段修正可以作为人工兜底，但自动持续认回同一球员的能力仍不足。不得用简单放宽阈值、清除风险或复制旧 P 标签掩盖串人。
