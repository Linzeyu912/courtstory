# Agent 战术工作流独立验收：不通过

日期：2026-10-06，Asia/Shanghai。验收请求：“给我验收一下”。依据为[执行计划](plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)、[工作流程](agent-tactics-workflow.md)与[工具合同](specs/agent-tactics-tools-v1.md)。这是对本机首批实现的独立验收，不是新增功能实施记录。

**结论：本轮不予签收 M0/M1，先修复后复验。** 现有 111 项新增回归全部重跑通过，源视频与原草稿保护也通过；独立追加场景仍复现了 1 项 P1、2 项 P2 流程缺陷。最新真实 005 的第 57 帧提示圈仍有错指歧义，且没有合格最终 MP4。测试通过、异常包完整和成片质量分别判定，不能相互替代。

## 验收范围

- 对象：本机 `main` 基线 `be5c43d17c78f04b4df55eda38aa6f82fde8f803` 加当前未提交的 Agent 工作流实现；生产源码在本轮没有修改。
- 方式：新的代码审查上下文、独立测试执行、真实证据与图像检查，再交叉复核新增缺陷。当前 292 个源码／契约／界面文件在测试前后 SHA 相同。
- 新增代码复现使用 12 帧合成视频、正式 Python adapters／Node bridge／原生保存及明确注入的测试 provider；不调用真实模型。两个版本／恢复反例选择 `editableDocument=true`、`video=false`，验证的是文档交付合同，不是新生成真实 MP4。
- 真实运行数据库使用 SQLite `mode=ro`／`query_only` 读取，没有启动、恢复或修复真实 run。新增内容仅为验收文档、日志及独立复现产物。
- 开放 GitHub Issue 列表为空。本轮没有创建 Issue、提交、推送或部署。

## 三项已复现的代码问题

### P1：重分析后沿用旧下游，仍可成功交付

位置：[stage 登记](../scripts/agent_workflow_store.py)第 262–274 行；相关完成判断在 [runner](../scripts/agent_workflow_runner.py)第 399–413 行。

在仍为 `running` 的任务中完成到 `commit_candidate`，再通过分步工具入口以新幂等键调用 `analyze_play`。当前只禁止同阶段的 queued／running 操作，不拒绝已成功阶段的新执行，也不失效旧下游。分析升至 revision 2 后，旧 candidate、coverage、projection、独立复核和 acceptance 仍为 revision 1 且 valid；runner 最终返回 `succeeded`，导出也返回 `succeeded`。

使用正式 adapters 和原生保存的复现明确得到：`exportedAnalysisRevision=2`、`exportedAcceptanceRevision=1`、三份当前质量报告 revision 均为 1。这意味着最新分析没有走完对应质量链，却与旧文档混合交付。

修复后验收条件：同键重试仍幂等；新执行必须被拒绝并要求明确恢复，或开启新 generation、递归失效所有受影响下游。最终状态及导出须核验当前分析、候选、质量报告、采用文档属于同一条有效依赖链；上述混合版本场景不得再返回成功。

### P2：已经保存后的合法重分析恢复无法再次采用

位置：[commit_candidate](../scripts/agent_tactics_tools.py)第 1024–1034 行。

首次合法保存 version 1 并以 `partial` 结束后，调用 `resume_run(retryStages=['analyze_play'])`。正式 runner 正确开启 generation 2，并给保存请求携带 `expectedVersion=1`；新分析及三项质量报告全部为 revision 2／pass。保存 adapter 仍把 expected 固定为 0，且已有文档 digest 不同时直接拒绝，最终得到 `version_conflict`／`needs_attention`。

修复后验收条件：区分同一候选的幂等收据恢复和合法新候选的版本提交。新候选核对上一已保存版本／摘要后，以正确 expectedVersion 保存下一版本，并保留旧产物；真正发生并发修改时仍拒绝冲突。复现中的 partial → 重分析 → 检查 → 保存流程必须完成。

### P2：已知失效的历史成片仍可无提示导出为成功

位置：[成功导出入口](../scripts/agent_workflow_cli.py)第 129–137 行；相关公共状态在 [runner](../scripts/agent_workflow_runner.py)第 81–86 行。

旧 run `run-8aecce4d38b0448cbffbaff7ca14b605` 已由 [historical-result-advisory.json](../../artifacts/agent-workflows-m1-20261006/historical-result-advisory.json)明确限定为历史集成结果，不能用于最终验收。对真实数据库只读查询并向新目录导出，仍得到 `succeeded`、`acceptance.accepted=true`、四项质量检查 pass 和 `result.mp4`；公共 warnings 为空，advisory 没有进入交付包。

保留历史原始记录是正确的；问题在于新的机器查询和交付没有呈现已经确认的失效状态。修复后应另行登记可审计的验收撤销／历史失效标记，并在查询、下载及新导出时显式返回。历史回放可以保留，不能继续冒充当前可接受交付。

三项证据见 [代码审查](../../artifacts/agent-workflows-acceptance-20261006/code-review.json)、[复现脚本](../../artifacts/agent-workflows-acceptance-20261006/code_review_repros.py)及[实测结果](../../artifacts/agent-workflows-acceptance-20261006/code-review-repro-results.json)。[另一验收上下文的交叉复核](../../artifacts/agent-workflows-acceptance-20261006/acceptance-cross-review.json)独立重跑两个正式 adapter 反例（30.967 秒）并只读核对历史导出，结论一致。这些是现有回归遗漏的追加验收场景，没有计入 111 项通过数。

## 真实画面与 M1 出口

最新真实 run 为 `run-d30789e4552f4206a71a050d567a7fe5`，revision 39、generation 2、状态 `needs_attention`。实际 provider 边界错误仍为 `provider_unavailable`；事件中完整独立复核回答为 fail，只登记为未接受诊断。模型调用 4 次、检测 1 次、修复 1 次，累计活动墙钟 529.1683 秒，费用不可测为 null。该 run 没有执行 commit／render，没有最终文档或 MP4。

独立重新解码 005 的全部 143 帧，1920×1080、无音轨，准确 PTS 与记录一致。按原参数重新编码的 12 张源图 JPEG 摘要也逐字节一致，证明预览确实对应当前原片。实际查看第 57／71／85 帧原图与合成，并检查其余阶段预览后，确认第 57 帧 T15 的提示圈落在前景防守者 T20 的头肩附近，不能清楚指向其后方的目标人物。T15 在该阶段只于这一帧显示，因此覆盖表的 `covered` 不能作为正确指人的证明。

![005 第57帧合成预览：持球人右侧的提示圈位于两名重叠防守者之间](../../artifacts/agent-workflows-delivery-20261006/005-cli003-needs-attention/history/operation-014/preview-011.png)

上图 SHA-256：`11bac3f4274fd38d0a069b2d3792d7bb8cb287284084a13be5032810fa4a33ea`。包内预览序号不等于源帧号：F57／F71／F85 分别对应 `preview-011`／`preview-010`／`preview-006`，完整映射见[证据核验](../../artifacts/agent-workflows-acceptance-20261006/evidence-review.json)。

当前候选有三个阶段、32 个 spotlight、10 个暂停时点，阶段覆盖表为 10／10、10／10、12／12。32 是阶段内匿名跟踪片段的标注数量，不是 32 名真人；没有自动连续宽箭头，不能据此宣称已经替代原 005 V2 的动作路线表达。M1 需在修好指人问题后，用一次新 submit 得到独立复核通过的真实文档与 MP4，再做完整解码及实际看片。

## 验收矩阵

| 范围 | 判定 | 依据与缺口 |
| --- | --- | --- |
| 原视频、草稿、已有模块保护 | 通过 | 除 3 份共享入口文档外的 223 个既有保护文件与 62 份备份一致；共享文档仅增加实现与验收入口，无原文删改。 |
| 准确帧与来源绑定 | 通过 | 143 帧／准确 PTS、12 张原图、source／candidate／inventory 摘要匹配。 |
| T00 样本及真值 | 部分完成 | 四原片构成六区间；参与者参考仍为 pending，未建立人工身份／场线真值。 |
| T01 schema／能力合同 | 已测基础通过 | 当前严格 schema 子集和入口检查通过，不是通用 JSON Schema 引擎。 |
| T02 生命周期与恢复 | 不通过 | P1 新旧依赖混用、P2 保存后恢复失败；既有幂等／取消／租约测试通过不能覆盖这两条路径。 |
| T03 生产工具与保存／导出 | 部分通过 | 正式解码、bridge、保存及渲染已运行；修订保存缺陷及真实合格成片出口未完成。 |
| T04 多人覆盖与质量 | 不通过 | 冻结清单与机器覆盖已接通；真实 T15 指向错误说明语义覆盖未达标。 |
| T05／M1 一次调用合格成片 | 不通过 | 最新真实 run 无已采用文档和 MP4；旧成功样本不能替代本次验收。 |
| M0 阶段出口 | 不予整体签收 | 骨架与历史集成证据存在，版本一致性／恢复缺陷尚在，不能仅按“曾导出过视频”通过。 |
| 异常包完整性 | 通过 | 最新包 81 个索引文件共 47,286,388 字节，SHA／大小／DB producer 绑定全部正确，accepted=false。 |
| 历史失效结果的机器交付状态 | 不通过 | P2：已知不合格旧结果仍正常导出且没有失效提示。 |
| T06–T08 | 未完成／未验收 | 生产 TAPIR、联合身份和可靠 geometry 分支尚未接入。 |
| T09 | 有限分支已实现，未整体验收 | 一次单旧阶段、≤8 秒的有界反馈存在；本次修复仍失败，多阶段局部修复未完成。 |
| T10–T11 | 部分实现／未完成 | 本机 Bearer HTTP 与 CLI 共用 runner；公网入口、新 provider、六段全量与并发 1／2／3 对照未验收。 |

## 本轮测试与验收证据

| 测试组 | 本轮通过 | 失败／错误／跳过 | 墙钟耗时 |
| --- | ---: | --- | ---: |
| workflow | 46 | 0／0／0 | 94.056 秒 |
| Python tools | 35 | 0／0／0 | 131.209 秒 |
| Node bridge | 30 | 0／0／0 | 2.893 秒 |

三组使用现有测试 provider，未发起真实模型调用。日志与源码前后摘要在 [tests.json](../../artifacts/agent-workflows-acceptance-20261006/tests.json)。此前原生 616 通过／1 跳过未在本轮重跑；旧清单覆盖的 139 个原生源文件仍匹配基线。已有渲染器未关闭 pipe 的 ResourceWarning 被保留，没有通过改源码隐藏它。

验收结论由实际源图、保存的失败诊断、只读数据库、正式 adapter 的隔离复现及当前回归共同支持。合成 provider 的 pass 只验证控制流程，不证明篮球语义正确。

## 修复及复验顺序

1. 先修 P1 的依赖失效与终态一致性，补入“分析 2／验收 1 不得成功”的回归。
2. 修复保存后合法恢复的新版本提交，同时保持同候选幂等与真正的版本冲突拒绝。
3. 将历史质量撤销状态接入机器查询和导出，保留原始历史字节。
4. 修正重叠人物的参考帧或身体锚点证据，复核原有全部参与者，不删人、不手工挪圈冒充自动生成。
5. 从原片完成一次新 submit，交付同一分析版本对应的 MP4、可编辑文档、coverage、质量报告和 manifest，完整解码与独立看片均通过后再签收 M1。

## 本机与远端边界

本轮只读检查发现远端 `main` 已是 `043d257bc86c3c442075d653e6ba29e3d84b07d2`，比本机基线领先 7 个提交，内容涉及研究、AWS 文档及上传脚本。本轮为保持验收对象固定，没有 fetch／pull／merge；远端新内容不在本报告验收范围，不能宣称本机与远端同步。当前代码、异常包及本验收记录没有提交、推送或部署。
