# Agent 战术工作流首批实现与验收

日期：2026-10-06（Asia/Shanghai）。本轮按 [Final v1 执行计划](plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)第 8 节推进 T00–T05，操作顺序与接口分别遵守 [工作流程](agent-tactics-workflow.md)及 [工具合同](specs/agent-tactics-tools-v1.md)。代码与运行产物在本机 `main`，未提交、未推送或部署。三份原规划保留当时状态，本记录说明实际实现进度。

当前已建立持久 runner、十个生产阶段的接口、准确视频帧证据、阶段参与者分析、多人暂停身体标记、独立复核、隔离保存和 MP4 导出。真实 CLI 验收先修复了身份范围错误；一次反馈修正补齐后段参与者，但最终复核仍发现重叠防守者的提示圈指向不清。最新运行停在 `needs_attention`，没有保存或编码这一候选。**首批代码和拒绝机制已实现，M1 的合格多人成片验收未通过。** 历史成功样本不能替代修复后的验收。同步状态见[本轮交接](../../handoffs/thy-0629/2026-10-06-2003-agent-tactics-runner-m1.md)。

## 本批实现与后续边界

| 计划任务 | 本机实现 | 实际验收边界 |
| --- | --- | --- |
| T00 | 源文件与草稿保护、六个固定区间、准确 PTS、原片摘要和关键帧 | 四个不同原片构成六段，存在重叠；不是六场独立比赛，也未建立全段人工身份／场线真值。见 [基线](agent-tactics-baseline-20261006.md)。 |
| T01 | 十个工具与四个运行控制调用 schema、统一响应、workflow 和 policy | 运行时严格验证所用 schema 子集；未知字段和不支持能力拒绝，不把它称为通用 JSON Schema 引擎。 |
| T02 | SQLite runner、CLI、调用者隔离、幂等、租约、取消、预算、恢复及共享调度 | 重复保存／编码、迟到 worker、恢复下游和部分结果语义有回归用例。数据库在本机磁盘。 |
| T03 | 真实解码／检测、派生 review、原生 bridge、预览、独立模型调用、保存、渲染和完整解码 | 已实际运行 GPU detector 与 Codex provider；源视频和人工草稿未写入。 |
| T04 | 先生成冻结参与者清单，再生成图形；逐阶段逐人检查实际生产显示 | 姓名可未知。身体标记仅代表确认的参考帧；检测 ID 不能自动扩展为连续身份。 |
| T05 | 默认 submit 自动执行各阶段；005 无现成 tracking 的真实验收已运行 | 未完成合格成片出口：修正后仍有重叠人物的指向歧义。多人暂停位置提示与历史宽箭头表达不同，未据此宣称视觉效果全面优于旧版。 |
| T06–T07 | 接口保留点语义和身份冲突，生产 TAPIR／联合身份未接入 | 当前不能自动修好 Pacers 的冲突 ID，也未验收十人全片连续身份。 |
| T08 | bridge 对合法原生脚点／地面映射提供严格条件检查 | 自动 geometry 生产 adapter 未实现；需要贴地而无可靠几何时返回具体错误，不冒充已标定。 |
| T09 | 独立模型审查、持久失败诊断、一次有预算的反馈修正与补帧已实现 | 仅旧分析单阶段且准确 PTS 时长 ≤8 秒，范围／来源／候选／revision 绑定一致才可修；错人、多个旧阶段、超范围和第二轮修复拒绝。通用局部修复未完成。 |
| T10 | Bearer HTTP 薄入口与 CLI 共用 runner | 本机测试范围；上传、公网 TLS／部署、MCP、新视觉 provider 未实现。 |
| T11 | 状态／幂等／取消／冲突回归及有限真实样本 | 六段完整闭环、并发 1/2/3 性能对照与全量质量验收未做。 |

## 代码入口与运行

- [运行入口与命令](../agent-workflows/tactics-v1/README.md)：资产登记、submit、状态、恢复、取消、导出及 HTTP。
- [合同与 schema](../scripts/agent_workflow_contract.py)、[workflow](../agent-workflows/tactics-v1/workflow.json)、[policy](../agent-workflows/tactics-v1/policy.json)。默认最多六次模型调用、API 并发二、GPU 并发一、预算墙钟 600 秒；费用不可测时为 null。
- [持久状态](../scripts/agent_workflow_store.py)、[runner](../scripts/agent_workflow_runner.py)、[反馈绑定](../scripts/agent_workflow_feedback.py)、[CLI](../scripts/agent_workflow_cli.py)、[HTTP](../scripts/agent_workflow_http.py)。所有入口使用同一 store 才共享资产权限和调度。
- [生产工具](../scripts/agent_tactics_tools.py)、[检测与证据适配](../scripts/player_tracking_adapter.py)、[原生 bridge](../tools/agent-tactics/README.md)。生产坐标取自当前视频证据，模型输出角色、阶段、证据帧和显示意图。

本机真实运行目录为 `artifacts/agent-workflows-m1-20261006/`，数据库为其中的 `state.sqlite3`。目录被 Git 忽略，不在其他成员机器或远端自动可用。登记资产 `005-no-tracking` 只引用原视频和准确帧映射，没有输入已有 tracking、手写坐标或姓名。

使用现成的可信 GPU Python 与篮球权重，在仓库根执行：

```powershell
python engineering/scripts/agent_workflow_cli.py --store artifacts/agent-workflows-m1-20261006 --caller local --detector-python tmp/player-identity-test/.venv/Scripts/python.exe --detector-weights tmp/player-identity-test/models/BODD_yolov8n_0001.pt submit --request artifacts/agent-workflows-m1-20261006/submit-cli-003.json
python engineering/scripts/agent_workflow_cli.py --store artifacts/agent-workflows-m1-20261006 --caller local status <run-id>
python engineering/scripts/agent_workflow_cli.py --store artifacts/agent-workflows-m1-20261006 --caller local export <run-id> --output <new-delivery-directory>
```

上面的本机环境路径不是跨机器安装承诺。新机器先按 [本机环境](../../environment/local/README.md)准备已核实的 Python、PyAV、Node、Sharp、FFmpeg、GPU detector 和 provider，另行登记本机视频。HTTP 不接受客户端提供任意权重、程序或文件路径。

交付包包括 MP4、保存版本 envelope `document.json`、原生可编辑 `native-document.json`、球员证据、冻结参与者清单、分析、图形映射、coverage、投影检查、独立审查、预览、完整解码报告、manifest 和复制摘要。原生可编辑表示当前文档 schema 合法；本轮没有新增工作台按钮或自动切换用户当前文档。

## 真实样本、拒绝记录与修复

### 005 来源

原片 `data/videos/tactics/acceptance/clips/005_SAS_pick_roll.mp4`，SHA-256 为 `1f7bd135ad8cde5ab877612e596f93200281b6902aac8084fad19a544d20b85d`，1920×1080，143 帧，无音轨，输入区间 `[0,143)`。最新修订没有通过独立复核，因此没有最终 MP4 的帧数或成片交付。

第一次运行 `run-8aecce4d38b0448cbffbaff7ca14b605` 产生两阶段、20 个 spotlight、368 帧／12.266667 秒的 MP4；包含真实检测、分析和独立审查。它在准备阶段由本轮集成工作手动推进过，因此不是无干预端到端计时。随后发现其参与者可靠范围计算也受下述 bug 影响：保留历史结果，但不将它作为修复后的最终交付或连续身份通过证据。

完整 CLI 运行 `run-55fd8d50e43441868febd4d19472a24f` 用两次模型调用和一次检测，在独立语义审查处以 `needs_attention` 停止。分析说明已明确 T15 在 114／142 帧发生身份混用，但适配器把同 ID 原始检测都算进 visibleRanges／locatableRanges。审查指出该矛盾，后续保存和编码未执行。

修复按确认的 evidenceFrames 与实际可见、无冲突的位置取交集，生成离散可靠范围；不把最小／最大证据帧之间自动补成连续观测，也不删除实际参与者。bridge 的候选及覆盖检查同时使用冻结范围，防止分步调用借 raw tracker ID 绕过该门槛。恢复重分析使用新的 analysisRevision 与修订理由，旧清单和失败记录保留。

修订 CLI003 为 `run-d30789e4552f4206a71a050d567a7fe5`：真实检测一次、模型两次，首轮活动时间 183.6715 秒。身份范围语义、人物、位置、已观测动作及可读性五项通过；参与者覆盖不通过。生成器把整段合为一个阶段，只用 T2／T9 的 0／28 帧说明，没有收录后段 57／85 帧清楚可见的 T15／T20，也未完整交代篮下终结参与情况。独立审查再次在保存前拦截。

该失败不能用另一空白提交掩盖。反馈修正基于这一份明确报告，只修改其失败阶段及下游；原检测、旧分析、旧 inventory 和已有两次模型消耗保留。最小修复范围限定为旧分析单阶段、报告明确点名该阶段；允许在原范围内合理重新分期。多阶段未失败内容的严格保留尚未实现，不能称为通用局部修复。

本轮因此提前实现 T09 的最小分支。首次独立审查不通过时，结构化报告／预览仍登记，操作保持 failed，不成为成功依赖。runner 在同一任务内预留一个 repairPass，将明确问题、旧分析、冻结清单、候选摘要传给新 revision；缺少剩余两次模型调用、超墙钟、报告错绑或已消耗修复轮次均停止。旧参与者 ID 在新阶段并集内必须保留，不能借重新分期删人。补最多四张问题间隔中点图，总分析原帧不超过十二张；这些新增原帧也交给下一次独立复核。读取来自准确原片和已保留检测，不重新检测或插值造坐标。

历史 CLI003 使用以下可信本机命令接续。它先从数据库记录的旧失败 attempt 恢复并核对诊断，保留旧失败状态，再开启 generation 2／analysisRevision 2；初始已耗 183.6715 秒，恢复时只分配约 416.3285 秒。约 1,523.82 秒的终态调试停留单独登记，不混作模型处理时间，也不把这次历史续跑称为原始一次 submit 无干预成功。新的自动反馈路径则保持原 created／deadline，连续 600 秒预算不重置。

```powershell
python engineering/scripts/agent_workflow_cli.py --store artifacts/agent-workflows-m1-20261006 --caller local repair run-d30789e4552f4206a71a050d567a7fe5 --recover-diagnostics
```

此次新增准确原帧为 42／71／99／128。重新分析产生 `[0,42)`、`[42,99)`、`[99,143)` 三个阶段及 32 个暂停 spotlight；这里计的是阶段内的匿名跟踪片段／提示，并非 32 名真人。补充的 T75、T60、T57 等与早期编号的真实身份连续未获证明，不能把高检测覆盖写成全程身份正确。

修正后的确定性覆盖与投影检查通过，但独立模型最终回答为 `fail`：参与者覆盖、已观测动作和语义三项通过，人物、位置及可读性三项不通过。具体为 `phase_1b` 的 T15 在第 57 帧取检测框中心 `(760, 596.875)`，落入前景另一名防守者 T20 的头肩附近，不能清楚指向说明中的后方防守者。报告引用第 57／71／85 帧。人工查看第 57 帧正式合成预览也能看到这一歧义；数值合法和文档覆盖不能代替指人正确。

此次复核伴随 WebSocket 重连与 HTTPS 回退，事件日志已有完整 `agent_message` 和 `turn.completed`，但 CLI 未产生所需结果文件，provider 边界以 `provider_unavailable` 终结。保留这个实际运行错误以及从可信事件提取的独立失败诊断；不能将超时／缺少结果收据的回答冒充已正常接受的工具结果，更不能把其中的 `fail` 改成通过。当前共消耗模型四次、检测一次、修复一次；累计活动墙钟 529.1683 秒，费用为 null。保存／编码均未执行，旧失败与全部证据保留。

收尾新增工具版本 `agent-tactics-tools-1.3` 的失败诊断保全。只有当前失败 attempt 内唯一、完整且通过原 schema 的终态 JSON 才能作为诊断提取；取消、超时及预算边界仍拒绝执行接受。即使事件文本写的是 pass，也只能登记 `diagnosticOnly=true`、`executionAccepted=false`，不能作为成功依赖。旧文件存在时只允许相同字节复用，内容不同拒绝，原始事件／结果／预览不覆盖。本次只执行 `import-diagnostics`，没有第二次 repair 或新模型调用；运行 revision 从 38 增至 39，其余状态、来源、generation、截止时间与预算保持。导入前固定的 223 个既有 run 文件全部字节不变，核验见本机 `diagnostic-import-integrity-003.json`。

最终异常包位于本机 `artifacts/agent-workflows-delivery-20261006/005-cli003-needs-attention/`：

- [文件清单与交付状态](../../artifacts/agent-workflows-delivery-20261006/005-cli003-needs-attention/delivery.json)及 [manifest](../../artifacts/agent-workflows-delivery-20261006/005-cli003-needs-attention/manifest.json) 均标记 `accepted=false`，最终文档和视频为 null。
- [质量报告索引](../../artifacts/agent-workflows-delivery-20261006/005-cli003-needs-attention/quality-report.json)逐 generation 保留原检查结果；不把历史 pass 汇总成最新通过。[执行与失败历史](../../artifacts/agent-workflows-delivery-20261006/005-cli003-needs-attention/failure-history.json)保留被失效的首轮与修复轮次。
- [最新独立失败诊断](../../artifacts/agent-workflows-delivery-20261006/005-cli003-needs-attention/history/operation-014/independent-review-diagnostic.json)明确记录 T15／第 57 帧问题。候选、逐阶段分析、冻结清单、来源／补帧和预览按 operation 保存，仅用于复查。

清单内 81 个文件共 47,286,388 字节，全部复制 SHA／大小核验通过；包内无 MP4 或最终 `document.json`。五个未纳入交付的内部产物在 omittedArtifacts 中列明，不静默当作已交付。复制核验记录为本机 `artifacts/agent-workflows-m1-20261006/diagnostic-delivery-integrity-003.json`。该目录被 Git 忽略，没有上传或自动共享到远端。

下一步首先解决重叠检测框到身体提示点的证据选择：选择其他已观测且能够明确区分人物的参考帧，或建立有独立验证的锚点证据。不能手工挪圈后冒充自动生成，也不能删除 T15、将同一编号跨帧当作身份保证或重置本 run 的修复次数。这个缺陷修好并通过新的完整 submit 验收后，才可关闭 T05。

### Pacers 拒绝样本

`run-31d2f3a949184765a32e806976e5a820` 使用已登记 Pacers `[570,750)`。初期发现登记 PTS 与旧 review 的九位小数、Python／JS 数值 JSON 表达差异；修复为准确登记映射与原生 canonical 摘要，在内存中规范化派生 review，不改原文件。随后真实参与者分析通过，但 T4 在 642／713 帧的身份冲突阻止图形采用；没有生成“成功”视频。保留该例供 T06–T07 接续，不能移除 T4 来提高覆盖率。

### 与原 005 V2 的对照

重新读取历史成片 `../outputs/future-route-video-20261003-v2/005_future_routes_authored_v2.mp4`：14,319,196 字节，SHA-256 `495eafc5350a79de2b8347b23c8bd5a2be7d0d8449a0e5020df85e106e05fd3f`，与 [原流程记录](005-authored-v2-workflow.md)一致。准确输出帧 50／150／275 的抽帧见本机基线 `005-v2-encoded-freezes.jpg`。

旧版五条宽箭头解释动作方向、先后和剩余路线；本批自动产物侧重多人站位与相关防守者的暂停位置提示。新版本参与者更多，暂未自动生成旧版那样的连续宽箭头。两者输入原片相同，但旧版有人工视觉编排，检测与生成过程不同，因此不做速度提升、精度提升或“全面替代”结论。历史配置未用作本次身份或坐标真值。

## 验证、原工作保护与回滚

新增回归共 111 项通过：runner／反馈／HTTP／CLI／诊断 46 项（冻结后完整运行 95.359 秒），Python tools 35 项（完整运行 130.005 秒），Node bridge 30 项。没有失败，未重复累计复跑用例。完整作者执行证据分别在本机基线目录 `workflow-final-tests.json` 与 `agent-tactics-provider-diagnostic-tests.json`。不同作者分别复核核心流程、失败反例和增量；最近诊断增量的 19 项独立用例通过，最后 CLI 6 项又作差量复跑，记录为 `independent-final-diagnostics-review.json`，这些不另加到 111 中。

已完成的原生基线为 Node 581 通过／1 环境跳过、`test_tactics_*.py` 21 通过、workbench Python 14 通过。新增检查与真实模型结果分别记录，合成 handler 测试不充当视频准确性证据；本轮最新真实成片验收仍未通过。测试保留现有原生渲染器未关闭 pipe 的 ResourceWarning，没有修改原生文件来隐藏该警告。

本轮独立审查发现并修复了 allowPartial=false 绕过、恢复丢失未完成需求、原生人工锁字段漏查、检测预算漏计、编码重启收据复用、Bezier 控制柄伪造绕行和不同提示帧绕过三条路线同屏上限。各反例已有回归检查。

开始任务时复制 62 份既有改动，固定 226 个文件摘要。原片完整解码、全部保护文件和备份核对通过。工程 README、文档索引及团队状态随后仅追加本轮入口。最终独立报告 `artifacts/agent-workflows-baseline-20261006/independent-final-003-rejection-and-preservation.json` 再次以字节行差异核实这三份原文各只插入两行、没有替换／删除，其余 223 个保护文件和 62 份备份字节不变，37 处状态文档相对链接存在；同时查看了第 57 帧失败预览并核对运行状态与预算。原战术模块、布局、编辑、撤销、保存和已有草稿没有改动。

回滚方式是停止使用新增 CLI／HTTP 入口，继续原工作台；无需删除原数据、草稿或新 run 审计目录。若清理新运行产物，先保存需要的视频、文档和失败证据，再由用户决定具体目录。没有修改依赖环境、创建云资源或执行 Git 提交／推送。

## 下一批

先修好第 57 帧暴露的重叠人物锚点选择问题，完成 T05 的新 submit 与成片验收。再按 T06–T07 接入已验证版本的 TAPIR 候选、种子自洽检查、遮挡 unknown 与身份排他，并用当前 Pacers 拒绝样本验证真正修复。随后实现 T08 的可靠几何分支、扩大 T09 已验证的局部修复范围，再补 T10 的其他入口和 T11 全集／并发对照。每一项单独留验收证据，不将本次暂停圈的有限样本结果外推为全套完成。
