# 交接：Agent 战术 runner、多人标注与独立质量门槛

- 日期／时区：2026-10-06 20:03，Asia/Shanghai；已补充本批最终拒绝结果。
- 成员：thy-0629。
- 任务／Issue：用户要求依据三份 Final v1 文档推进；开始时读取 GitHub Issues，未发现可对应的开放 Issue，未创建或分配 Issue。
- 分支：main。
- 提交：本轮未提交、未推送。开始及本轮核对时 HEAD、origin/main、远端 main 均为 `be5c43d17c78f04b4df55eda38aa6f82fde8f803`。
- 状态：首批代码已实现；最新真实运行 `needs_attention`，M1 合格成片验收尚未完成，依据见[实施报告](../../engineering/docs/agent-tactics-implementation-20261006.md)。

## 本次完成

- 按[计划](../../engineering/docs/plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)第 8 节实施 T00–T05，遵守[工作流程](../../engineering/docs/agent-tactics-workflow.md)和[工具合同](../../engineering/docs/specs/agent-tactics-tools-v1.md)。源规划文件原样保留，当前实际状态另写。
- 新增 `engineering/agent-workflows/tactics-v1/`、`engineering/scripts/agent_workflow_*.py`、`agent_tactics_tools.py`、`player_tracking_adapter.py`、`engineering/tools/agent-tactics/` 及对应测试。schema、持久状态、CLI／HTTP、模型分析、原生图形、独立审查、隔离保存和正式 MP4 使用同一条流程。
- 固定四原片／六区间及 226 个保护文件，复制 62 份既有改动。当前 `player-review` 布局／模块、已有用户草稿及视频字节不变。三个共享 Markdown 入口只插入本轮记录，未替换或删除原文。
- 实际模型审查发现“raw ID 帧段冒充身份可靠范围”，新增范围约束和 bridge 硬门槛；重新分析 revision 持久递增，旧库存和失败保留。
- 最新完整 CLI 又发现后段参与者遗漏，已补一次有界反馈修复：仅单个旧阶段、准确 PTS 时长不超过 8 秒；补最多四个中点帧，总分析原帧不超过十二张；旧参与者不能消失。修复后产出三阶段／32 个暂停提示，但独立审查指出第 57 帧 T15 指向重叠的 T20 附近；未保存或编码。旧失败、修订、原检测与已耗调用保留。

## 结论与依据

- [运行 README](../../engineering/agent-workflows/tactics-v1/README.md)包含可信资产登记、submit、状态、恢复、导出和本机 Bearer HTTP 边界。所有调用必须共用同一 store 才共享权限／并发限额。
- [T00 基线](../../engineering/docs/agent-tactics-baseline-20261006.md)记录真实路径、源 SHA、精确 PTS、音轨和原生回归。源 005 为 143 帧的 `005_SAS_pick_roll.mp4`，不与其他库的 005 混用。
- 运行数据库与原始证据为 `artifacts/agent-workflows-m1-20261006/`；保护清单、备份、审查报告为 `artifacts/agent-workflows-baseline-20261006/`。这两个目录均为本机忽略产物，不在远端自动可用。
- 旧成功 run `run-8aecce4d38b0448cbffbaff7ca14b605` 也受范围 bug 影响，已另存 `historical-result-advisory.json`，原始结果没有改写；不得将它当最终修复版本。
- `run-55fd8d50e43441868febd4d19472a24f` 被身份范围语义检查拦住；`run-d30789e4552f4206a71a050d567a7fe5` 首轮因后段参与者缺失停止，接续一次反馈修复后覆盖通过，人物／位置／可读性仍失败。第二次审查的完整 fail 回答保留在模型事件中，但 CLI 未落结果文件，运行状态按真实 provider 错误保留。模型共四次、检测一次、修复一次，累计活动墙钟 529.1683 秒。没有通过删人、清理失败、调整 pass 或覆写用户草稿来交付。
- 工具 1.3 补齐失败诊断保全，已对上述 run 执行 `import-diagnostics`；只增加未接受诊断及 revision 39，原状态／来源／预算不变，223 个既有 run 文件字节不变。最终 [异常包清单](../../artifacts/agent-workflows-delivery-20261006/005-cli003-needs-attention/delivery.json)在本机，81 项文件 SHA／大小全部核验通过；有 manifest、质量索引、失败历史、分析／候选／预览，`accepted=false`，没有最终文档或视频。这是异常交接，不是合格成片。

## 验证

- 新增回归 111 项通过：workflow 46、tools 35、Node bridge 30；完整运行和源码摘要记录在本机基线目录。原生基线：Node 581 通过／1 环境跳过；Python tactics 21 和 workbench 14 通过。合成测试不充当视觉准确性证据，最新真实 M1 成片验收仍未通过。
- 不同 Agent 交叉审核：runner 作者审 bridge；bridge 作者审 Python 工具；tools 作者审 runner revision 和根文档保全。审查发现的反例由作者修复，再由独立 lane 复核。
- 最终 `independent-final-003-rejection-and-preservation.json` 核实 223 个非文档保护文件摘要／字节不变、3 份共享文档各仅插入两行、62 份备份未变；包含 132 个原生 player-review 模块。独立复核也实际查看第 57 帧预览、确认不能判为成功，并检查了状态文档的 37 处相对链接。
- 真实模型调用留存输入帧、提示／schema／响应摘要、tokens 和耗时，费用不可测为 null。完整 MP4 解码与编码帧视觉抽查分别记录，不能互相替代。

## 阻塞与待确认

- 尚未验收连续十人身份、生产 TAPIR、自动连续宽箭头、可靠贴地 geometry、完整任意局部修复、六段全量与 API 并发 1／2／3 性能。当前自动图形以暂停身体圈为主，角色在结构化说明中，未新增视频文字层。
- 本机 HTTP 只是经鉴权的同 runner 入口。没有部署公网、创建云资源、接新视觉 provider、实现上传或 MCP。
- 现有渲染器为静音；本次 005 原片无音轨。后续有保留音频要求的请求不可静默降级，原视频音轨必须保留。

## 下一步

1. 从实施报告与异常包接续，先解决重叠检测框不能可靠指人的锚点选择问题，再运行新的完整 submit 验收 T05。不能把本 run 的修复次数清零或使用历史成功的宽范围证据。
2. 按 T06–T07 接入已固定版本的 TAPIR 候选和身份排他，用 Pacers 的 T4 冲突样本验证真正修复，不能靠删除参与者提高覆盖率。
3. T08 添加独立几何真值与回投检查；T09 扩大经过证明的局部修复范围；T10–T11 完成其他入口、全样本和并发测量。

## 同步状态

本轮新增代码、文档和交接留在本机 main，未创建分支／PR、未暂存既有工作、未提交或推送。远端相等只说明基线同步，不代表本轮修改已在云端。后续发布需按用户授权选择本轮相关文件，保留同目录中其他任务未提交工作；忽略目录中的视频需要另行决定共享位置。
