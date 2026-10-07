# 官方训练 001 / 002：全部球员的 2D 映射测试

2026-10-07，America/New_York。用户指定官方训练两片、全部球员、区分两队，沿用现有观察台，并授权真实 Qwen 调用；出现额度不足或调用失败需反馈。本轮为本地实验，未提交、未推送、未部署云端。

完整时间轴测试已结束；每片两队各五人的结果已接入原观察台。六段最终任务均保存候选，但四段仍 partial；调用失败、每人点数、保留缺口与实际验证见[最终结果](RESULTS.md)。真实候选基于开工版本 `be5c43d`；随后已安全同步 main 到 `0d29df0`。最新代码增加角色依赖，重新运行前应重新 `prepare` 并另存历史 `ground-*.json`。

## 输入与流程

- 来源使用[官方训练素材入口](../../../data/videos/uploads/2026-10-05-official-training/README.md)登记的两段原片；检测输入沿用上次真实测试的 `team-stable` 缓存，并按源 PTS 对齐。原片未转码。
- 001 共 1291 帧、约 21.55 秒；002 共 1371 帧、约 22.89 秒。完整时间轴都在回放中，近景与不可映射部分保留缺口。
- 先真实调用 Qwen 看完整镜头的取样帧，再查看全部临时轨迹的三张代表裁图。临时编号会跨人、跨队，不能直接作为永久身份。
- 依据保存的号码、球衣与外观裁图核对身份，将两队各五人映射到 P1–P5 / P6–P10。身份修订是 AI 视觉核对，未称为人工真值；使用相邻观测处理已明确换人的临时轨迹，模糊/碎片/裁判/观众不凑成球员。
- 复用已有球场传播与地面轨迹 Agent；按约 10 秒分段，模型看原帧、脚部、提出锚点、拟合、读取 2D 与原图回投后继续修正。输出仍是待核对的候选。

001 开头约 5 帧、002 从 1276 帧起的近景切镜不提供球场地面坐标。球员出画、检测缺失或标定不可用时不补画虚构位置。原检测仍有遗漏，身份续接不能消除这些遗漏。

## 已发现的问题

1. 首轮多人上下文过长。原始全片准备快照含大量重复标定诊断；多轮历史又保留重复观测和图片。两片首次 300 帧多人任务连续返回 `stopReason=length`，24 轮后以 `call_budget` 失败，没有可绘制候选。这不是账户额度不足。
2. 单纯连续位置会覆盖已看清的号码，导致球员串号；现在号码裁图核对优先，只在明确跨人的临时轨迹中使用位置续接。所有修订与未确定段保留在本地记录。
3. 部分首尾地面锚点属于与范围外轨迹的连接边界，不能改动。模型需选内部清楚帧，边界约束继续保留。

工程只增加已有观察台的多人数据读取、双队颜色、编号和点击球员查看脚部；布局、视频/球场同步、逐帧、慢放、循环与时间轴沿用原版。反馈图可完整显示十名球员。多人模型上下文用真实取样/锚点帧的时间；完整逐帧时间仍保留后台，任何额外取帧返回实际源时间。连续两次长度截断停止任务，保留已绘制候选，不继续空转。

## 本地结果与观看

本机结果入口 `artifacts/qwen-all-players-20261007/`（Git 忽略）：

- 每片的 `roster.json`、`identities-*.json`：原始模型判断、用量与耗时；错误判断没有删除。
- `roster-reviewed.json`、`identity-corrections.json`、`assignments.json`：AI 号码核对与最终逐帧关联。
- `calibration.json`：完整球场传播诊断；`session.json`：实验准备输入，去掉重复诊断但保留坐标及不确定性。
- `jobs/<jobId>/`：真实 Agent 输入、工具审计、视觉证据、候选及失败记录；`failures/` 保存早期失败结果。
- `ground-<start>-<end>.json`：每段最终任务结果；`summary.json`：每人检测标注、原始映射与实际 Qwen 候选帧数。
- `replay/`：供原观察台读取的完整两片多人回放。没有给球员生成锚点的候选，不作为该球员已修正轨迹显示。
- `checks.json`：源时间、唯一身份、缺测/切镜保留与候选有限值检查；由 `check_results.py` 生成。

服务参数 `--trajectory-replay-root artifacts/qwen-all-players-20261007/replay`；打开 `http://127.0.0.1:8876/trajectory-replay`。白队为橙色、深蓝队为蓝色，虚线原始投影、实线模型候选；点击视频球员或球场轨迹查看对应脚部。结果读取不调用模型。

## 复跑

使用已有 `.venv` 和 Node / Pi SDK；密钥仅从进程环境或本地忽略的 `.env` 读取。`bootstrap`、`classify`、`ground` 会真实调用 Qwen，其他阶段不调用模型。

```powershell
.venv/Scripts/python.exe -X utf8 -u research/agents/qwen-all-players-20261007/run.py 001 bootstrap
.venv/Scripts/python.exe -X utf8 -u research/agents/qwen-all-players-20261007/run.py 001 classify
.venv/Scripts/python.exe -X utf8 -u research/agents/qwen-all-players-20261007/run.py 001 calibrate
.venv/Scripts/python.exe -X utf8 -u research/agents/qwen-all-players-20261007/run.py 001 prepare
.venv/Scripts/python.exe -X utf8 -u research/agents/qwen-all-players-20261007/run.py 001 ground
.venv/Scripts/python.exe -X utf8 research/agents/qwen-all-players-20261007/export_replay.py
```

002 同样运行对应阶段。脚本会读取已有结果缓存；重跑某一阶段前应将对应结果保存到另一实验目录。号码修订表只适用于这里固定的两片、固定检测缓存，不能直接用于新视频。完整运行结果、实际验证及尚未完成项在本轮交接中补充。
