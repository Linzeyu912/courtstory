# 紧凑战术事实自动修复与预算 Implementation Plan

## 2026-10-07 后续预算修订（本地代码，待全片实测）

以下新参数已写入工作台 facts 调度和启动参数默认值；它们是调用上限，不是时延或视觉正确率承诺。生产服务是否已采用这些参数需另查启动状态，本次修改未重启服务。本文后续的 300／90／75 秒表格是较早的未实施分段设计，保留作历史比较，不代表当前 facts 默认值，也未启用自动拆分子阶段。

| 当前字段 | 上限／默认值 | 边界 |
|---|---:|---|
| activeWallSeconds | 960 秒 | `min(用户配置,960)`；准备、所有模型调用、校验、预览和保存共用一次期限 |
| initialFactsCallSeconds | 180 秒 | 首次事实生成；按真实剩余预算缩短，不能越全局期限 |
| structuralRetryCallSeconds | 180 秒 | 一次失败阶段／结构修复；已成功阶段不重跑 |
| noResponseSeconds | 180 秒 | facts 默认无实质内容等待期限；审核仍按自己的调用预算等待 |
| auditCallSeconds | 210 秒 | 高清原图独立审核；完整结果及严格审核缺一不可 |
| patchCallSeconds | 90 秒 | 一次针对已审错误的紧凑修复，不重写未指定事实 |
| reAuditReserveSeconds | 225 秒 | 修复前预留 210 秒复审与 15 秒收尾；剩余不足时保留异常 |
| maxModelCalls | 6 次 | 首次、结构重试、审核、patch、复审均计入；不是必须调用六次 |
| legacyRange／identity | 300 秒原合同 | V3／2D 区间总预算仍为 300；身份服务的调用设置未修改 |

真实证据是单次事实生成约 99／117／119 秒、独立审核约 130／174 秒。对同一 002 第一阶段五张高清图的单次延长诊断，首内容 119.114 秒，总耗时 119.127 秒；90 秒会截断该次请求，但它低于 120 秒，不能将此前 120 秒无响应都归因于等待过短。返回 11 人、11 路线、5 持球项，却被 `action_route_contradiction` 拒绝；JSON 完整不表示路线或身份正确。诊断在本地 `artifacts/tactics-reliability-20261007/stage1-timeout-diagnosis/`，原尝试未保存 prompt 文本，诊断按原 input 与当时的提示函数重建，不能声称 prompt 字节已与原始日志比对。

960 秒也不保证所有步骤都够用。例如两阶段首轮各用满 180 秒，加一次结构修复 180、审核 210、patch 90、复审 210 和收尾 15，共 1065 秒；调度必须拒绝不够预算的修复并留下具体异常，不能续一轮或宣布通过。正常路径只有实际调用完成并通过来源、动作、高清视觉审核及参与者覆盖才可结束。

当前提示词明确 action 描述整个已观察阶段：掩护后实际顺下／外弹归 `roll`／`pop` 并保留真实路线，不能因为某一帧站定将有 route 的人物归静止。脚点只取可见落地脚部中心，允许两脚中点；上半身特写无脚不能猜脚点。审核中 `missed_on_court_player` 的 `foot=null`、或原 `no_visible_feet` 声明尚未核实时，只保留画面疑点，不授权新增地面脚点人物。每次事实、高清审核和紧凑修复调用目录保存实际 `prompt.txt`，后续诊断可逐字节对照。

## 原始独立设计（历史，非当前调度说明）

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the unchecked tasks below. This document is a proposal, not an implemented scheduler or successful whole-video acceptance.

**Goal:** 一次提交自动处理完整视频，保留已通过阶段，只对失败区间／缺证人物自动补证；人工接收具体异常而非逐帧完成主流程。

**Architecture:** 模型返回紧凑事实，程序编译完整 V4 并运行原来源与参与者覆盖校验。失败父阶段选择一次定向修复或有界子阶段分析，成功阶段被冻结。调用共享原任务的单调时钟期限，不自动另开一轮预算。

**Tech Stack:** 当前受限 Codex CLI、Python 作业调度、原生 JS V4 编译与校验。

**Spec:** [模型优先流程](../agent-tactics-workflow.md)、[当前调整](2026-10-07-tactics-reliability-routes.md)。较早独立 runner 的 600 秒合同不代表当前工作台已实现；本补充针对当前工作台 300 秒运行预算。

日期：2026-10-07，Asia/Shanghai。状态：独立设计；本轮不修改 Python 调度器、不重启、不提交。配套机器可读场景：[cases](../specs/tactics-facts-auto-repair-cases-v1.json)。

## 已知证据与推断

- 当前 `_run` 首次窗口为 300×80%=240 秒，余下 60 秒留修复；每次从剩余首次窗口按待处理阶段数分配，图像准备和校验也消耗此墙钟期限。
- routes 独立实验：official002 第二阶段五个观察帧 685／857／1028／1199／1370、原 1920×1080 像素，紧凑 facts 实际 64.909 秒返回。输出包含 11 个局部人物及两名人物的真实路线；这是单次时延，不是平均值、P95 或全片成功率。
- 两个阶段如果分别约 65 秒，130 秒加本地开销有机会在首次 240 秒窗口内完成。现有调度不必为了 happy path 自动扩大总预算。
- 两次首次调用都等满约 120 秒时，只剩约 60 秒；不能宣称足够完成一次约 65 秒修复，更不能承诺两次修复。
- 缩短阶段能减少输出与动作歧义，但不证明能消除服务端等待。仅通过分段不能认定无响应根因已解决。

## Global Constraints

- 当前源视频、草稿、固定 P 义务、来源／帧映射／版本绑定不可变；局部人物不伪造 P 身份。
- 有移动证据才生成路线；静止位置不冒充跑位，未知身份不冒充已确认；原覆盖合同不可放宽。
- 图片全部来自明确解码的本轮证据，按真实 time／PTS；排他末端不是已读证据帧。
- 原生路线保留全部 2–6 个合法点为一条线，不用拆出更多箭头制造路线数量。
- 300 秒为 active run 起至终态的硬墙钟预算；当前排队不在 `_run` 期限内，必须分别展示 queueElapsedSeconds，不能声称包含排队。后续如限制排队，另设 maxQueueSeconds=30，过期不启动模型；总请求最坏约330秒而非300秒。

## 预算建议与准入

| 字段 | 建议值 | 约束 |
|---|---:|---|
| activeWallSeconds | 300 | 本地准备、模型等待、编译、验证、落盘共用；不自动续一轮 |
| finalizationReserveSeconds | 15 | 给最后校验、预览与原子落盘；不可作为模型调用时间 |
| initialCallMaxSeconds | 90 | 仅紧凑 facts 模式，旧全量 V4 等待参数不连带修改 |
| repairCallMaxSeconds | 75 | 不是速度保证；超时归类依据有无实质模型输出 |
| minRepairAllocationSeconds | 70 | 若不能分配此时长，直接记录预算异常而非发起注定短等待 |
| maxModelCalls | 6 | 首次、修复、子阶段、模型复核均计入；对002通常两次首次+最多四次修复 |
| maxRepairPassesPerParent | 1 | 选择一次定向 patch／重试，或最多两个子阶段；不能 patch 失败后再无限 split |
| maxChildrenPerParent | 2 | 仅当两子段均合法且预算足够；不能只处理一半并宣布父段成功 |
| apiConcurrency | 1 | 保持当前全局调用序列；并发需另有真实限流／质量证据 |

准入计算：`remaining=deadline-monotonic()`；单次 `callTimeout=min(policyCallMax, remaining-15)`，必须达到70秒才发修复。两子阶段需 `remaining>=2*70+15=155` 且有两个调用额度，随后均受同一全局deadline约束。预算在准备后、启动前、每次返回后重新计算。90／75／70为设计选择，应通过重复真实片段实验调优，64.909秒单次证据不足以称其稳定。

例如：first=65、second=90超时、其他开销10，总用165，剩135；可做一次75秒失败段修复，不能承诺两个70秒子段加15秒终验。first=30、second=90超时、其他开销10，总用130，剩170；有两次额度和安全证据时才允许两子段。两段首次各65、开销10、随后两次70秒补证，总280秒，尚余20秒；仍不代表四次模型都必定按此速度返回。

## 修复合同及冻结规则

建议 compiler 除候选外返回 `repairNeeds:[{stageId,personId:null|string,fixedEntityId:null|string,code,evidenceFrames,requestedRange}]`。码至少区分 `missing_participant`、`missing_route_evidence`、`missing_anchor_observation`、`uncertain_continuity`、`cross_cut_route`、`invalid_coordinates`、`source_mismatch`。

1. facts 结构／来源有效但缺某人物证据：一次请求合并该阶段全部 repairNeeds，携带只读原事实、稳定局部 ID、固定 P 清单和合法补帧，模型仅返回目标 ID 的 patch；不能为每个人各开循环。
2. 没有可解析 facts 的 no_response／timeout／transport：只处理失败父 stage。配置中存在不同备用模型才切换；同名显示同模型重试。认证／额度／模型配置错误不自动分段绕过。
3. 只替换明确声明的目标人物及关联动作；已验证其他人物／阶段摘要不变。新人物 ID 必须经过显式局部身份校验，不能当已有 ID 的自动续接。
4. 每次合并后重跑父阶段完整 V4 及固定 P 覆盖校验。若还失败，不把未审查位置插值成完整覆盖；记录对应 exception。
5. `ready` 父 stage 的候选／来源摘要／证据列表／调用次数冻结。后续修复和手动 retry 都不得重跑它；来源或草稿变更则旧任务 stale，不原地替换成功结果。

## 子阶段及边界

- `children` 的半开范围严格构成父范围的无缝、无重叠分区；两个子段的 union 等于父段。子段不是跳过困难部分的工具。
- 先在真实源切镜／身份风险处分界，再按真实时间及抽帧分布选中点。超过两个必须分开的镜头段，不能偷偷删掉第三段；保留父异常 `split_limits`。
- 每个子段保持父固定 P 义务清单。已知该子段无观测的 P 以明确 unknown／缺测记录保留，不能用 unknown 掩盖可见但未标的人；局部人物义务按真实该子段图像重新建立。
- 子段允许携带外部帧作只读连续性上下文，但本子候选的 evidenceFrames／anchorFrame 必须在子段内且本轮实际提供。两端至少各有两个不同观察帧；不够先自动解码补证，仍不够则 exception。
- 路线不能跨 cut／不确定身份／明确遮挡。不能通过插值或连接相邻子段末点恢复一条未经观察的连续路线；不同视角重建局部 ID，不自动共享真人身份。
- anchor 必须有相应人物的真实 observation；程序不得为满足校验虚构 anchor observation。接地、镜头补偿和米制精度仍需独立证据，参考帧路线不能冒充测量轨迹。
- 父 stage 只有所有子段都通过完整范围和覆盖验证才 ready；一子段成功另一失败时 partial，成功子段可预览但整个父范围不计完成。

## 状态与 UI

建议保持既有 status，新增可审计字段：

```json
{"progress":{"completed":1,"total":2,"elapsedSeconds":165,"remainingSeconds":135,"modelCallsUsed":2,"maxModelCalls":6,"repairPass":1,"automaticProcessing":true,"exceptionsCount":0},"stage":{"stageId":"stage-2","parentStageId":null,"mode":"facts_patch","status":"analyzing","targetPersonIds":["w1"],"originalRange":{"startFrame":685,"endFrameExclusive":1371},"runtime":{"modelOutputSeen":false,"elapsedSeconds":4,"attemptTimeoutSeconds":75,"imageCount":5,"transportImageCount":1,"retryMode":"same_model","reason":"missing_route_evidence"}}}
```

queued“正在准备”；waiting“等待本段模型返回”；facts returned“已收到观察，正在生成路线”；patch“正在自动补充该人物的路线依据”；split“正在自动分析本段的两个短片段”；验证后才“本段完成”。不要把建立CLI会话称为已在分析，不把一附件称为一观察帧，不把静止标记增加写成路线增加。

异常包 `exceptions:[{code,stageId,range,personIds,reason,automaticAttempts,canRetry,suggestedAction}]`。UI明确成功范围和未完成范围，列出为何自动修复停止；正常处理不需要人工逐阶段点击。不要求人手填帧号；例外提供定位视频／单段重试／编辑对应图形入口。cancel／stale必须终止后续调用及迟返发布；自动完成也只是可核对预览，不自动覆盖草稿。

## Review Focus

- 两段首轮均超时，剩余60秒不能发70秒修复。
- 一段成功后修复另一段，成功段完全冻结。
- 子段成功一半不能冒充父段完成；跨切镜路线不得接上。
- targeted patch不得替换其他人或降低固定P义务；未知不等于已覆盖。
- 时间耗尽、取消、来源／草稿变化及迟返结果不得发布。

## Implementation tasks（本轮未执行）

- [ ] Python 调度：独立 facts policy，共享deadline、6调用计数、ready冻结与每父段一次repair；使用配套JSON预算用例测试。
- [ ] 纯 compiler：typed repairNeeds、局部patch合并、完整父覆盖重新验证；显式meaning允许真实后续多点路线。
- [ ] split planner：以真实time／cut／身份边界分区，保留固定P清单，补源帧后再调模型；范围用例必须精确匹配。
- [ ] UI：接上述自动处理字段和具体exception，不把模型等待、unknown或partial显示成完成。
- [ ] 隔离002验收：完整自动生成、每阶段移动人物路线／静止位置、持球圈及正常人工异常边界分别核对；重复实测不能只择成功一次。任何计时模拟或单个facts成功均不等于全量稳定修复。
