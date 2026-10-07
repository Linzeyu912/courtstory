# Agent 战术工作流程：2026-10-06 验收基线

日期：2026-10-06（Asia/Shanghai）。本记录对应[执行计划](plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)的 T00。固定样本和保护文件，不把待运行的验收写成已通过。

## 保护基线

- 开始实施时，`HEAD`、本地 `origin/main` 和实际远端 `main` 均为 `be5c43d17c78f04b4df55eda38aa6f82fde8f803`。
- 已有未提交文件保持原状；62 个既有改动文件复制到本机忽略目录。226 个源代码、原有草稿及关联文件登记 SHA-256，包含当前 `player-review` 模块、原生战术后端及 `data/local-workbench` JSON。
- 清单：`artifacts/agent-workflows-baseline-20261006/protected-baseline.json`；恢复副本：同目录 `preserved-files/`。这些路径为本机产物，没有发布至远端。
- 新工作使用独立 runner 目录和独立 `TacticalWorkbench` store。正式工作台的布局、工具和用户草稿不属于本轮新增 adapter 的写入目标。

## 六段样本

帧号均是所登记资产准确解码后的零基索引，区间为半开。四个不同原视频构成六个区间；Pacers 两段有重叠，官方 001 两段来自同一个视频，不能当作六个独立比赛样本。逐帧 PTS、映射摘要、原片 SHA 和三张关键帧见本机 `six-sample-baseline.json`。

| 样本 ID | 准确来源 | 帧区间 | 源视频帧数 | 源音轨 |
| --- | --- | --- | ---: | --- |
| pacers-motion | 导入的 `05_Pacers_20250106_Q2_0m44_team_motion_720p_silent.mp4` | [570, 750) | 1050 | 无 |
| accepted-005 | `data/videos/tactics/acceptance/clips/005_SAS_pick_roll.mp4` | [0, 143) | 143 | 无 |
| official-001-halfcourt | `data/videos/uploads/2026-10-05-official-training/clips/训练_弗拉格2月1日.mp4` | [420, 660) | 1291 | 有 |
| official-002-drive | `data/videos/uploads/2026-10-05-official-training/clips/训练_阿门1月4日 .mp4` | [300, 540) | 1371 | 有 |
| pacers-occlusion | 同一 Pacers 导入原片 | [600, 900) | 1050 | 无 |
| official-001-cut | 同一官方 001 原片 | [0, 240) | 1291 | 有 |

第二个官方文件扩展名前的空格属于原名。这里的 001/002 明确指 `official-training-001/002`，不与其他赛季库中相同编号混用。样本 ID 是测试标签，不作为已经证实的战术判断。

| 来源 | 已核对原片 SHA-256 |
| --- | --- |
| Pacers 导入原片 | `17c36f8d3b3e294f13f7119f23b82ec7f3fbe96d5564db9cbe7d61f49ebbbd7d` |
| 005 | `1f7bd135ad8cde5ab877612e596f93200281b6902aac8084fad19a544d20b85d` |
| 官方 001 | `9c3e4606d04e7f79e29a112952fcf069ebab202af207af500bfbc3338bc079ce` |
| 官方 002 | `7ec745f5f1e75b0c6d6dd27d409875f67c2ac3ab76c73f7123794c96be5aee22` |

## 观察与验收边界

已查看每段起点、中点和最后一帧，共 18 张真实源帧。Pacers 包含多人半场站位及画面下方人物遮挡；005 包含前场多人移动；官方 001 后段包含半场配合，开头区间包含近景转宽景；官方 002 包含篮下活动和外线站位。这些仅是 AI 对离线关键帧的初查，未构成逐人身份、整段路线或每帧定位真值。

`participantReferenceStatus=pending_independent_visual_review`、`humanGroundTruth=false`。后续必须独立核对参与者、错绑与生产画面；不把检测框、临时跟踪编号或球衣文件名当作真人身份结论。没有人工场线留出点真值，当前不能据此宣称达到地面误差中位 6 px / P95 12 px 的目标。

原有单人对照为 `artifacts/direct-video-vs-court-20261006/bridge-run-01/A/direct-video-fixed.mp4`，本机文件存在，2,368,155 字节。历史成片只用于同源行为对照；不得复用其画线作为新一轮轨迹真值。

## 运行环境核实

系统 Python 3.13 已有 PyAV、Pillow、NumPy；已有 GPU Python 另有 PyTorch `2.14.1+cu130` 和 Ultralytics，CUDA 可用，设备为 RTX 5060 Laptop GPU。已实际加载本地 `BODD_yolov8n_0001.pt`：类别 0/1/2/3 分别为篮球、篮筐、球员、裁判，因此检测 adapter 不应按通用模型把类别 0 当人。

Node、FFmpeg、ffprobe 可用。当前 Codex provider 可发现受信配置，真实调用仍须逐次检查结果。费用未测，不登记为零。源视频、原有音频与用户草稿均保留；现有正式战术渲染器输出静音。

## 原生回归

新增实现接入前，完整 `player-review` / `tactical-overlay` Node 检查 581 项通过、1 项环境跳过；Python `test_tactics_*.py` 21 项、`test_tactical_workbench.py` 14 项通过。Node 与 workbench 输出保存在本机基线目录的 `native-node-tests.txt`、`native-workbench-tests.txt`。新增 runner/adapter 检查结果应以本轮实施报告为准，不能用这些基线测试代替新增功能验收。
