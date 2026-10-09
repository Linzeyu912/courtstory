# 解说先行与独立绘图实施计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 按任务实施，保留独立复核。用户已于 2026-10-10 授权按现有方案推进，无需重复请求实施许可。

**Goal:** 姓名进入解说，已保存解说和关键节点驱动独立绘图 Agent，共同编排字幕、语音及战术成片。

**Architecture:** 解说计划作为不可变、带来源版本的交接对象；解说与绘图分别创建 Pi Agent。图形复用原生候选与编辑链；成片复用共享 SVG 与姓名层，由统一时间轴编排。

**Tech Stack:** Python、Node ESM、现有 Pi/OpenRouter provider、PyAV、FFmpeg、原生工作台 UI。

**Spec:** [已批准设计](../specs/2026-10-09-commentary-led-tactics-design.md)。

## Global Constraints

- 直接在 main 修改；保留已有研究文档；本轮不自行提交、推送或部署。
- 解说先完成、绘图后启动，两个 Agent 各自上下文及写入工具。
- 姓名复用现有身份解析器（1A）；绘图模型默认继承计划的实际生成模型，可单独覆盖（2A）。
- 时间域与坐标转换按设计显式映射；证据只登记实际返回图片；禁止从资产 PTS 推算父原片时间。
- 原始视频和人工草稿保持；缺少证据报告缺口；出手与 2K 规则暂缓。

## Review Focus

- 保存/生成迟到覆盖用户编辑：任务 1 的 revision/CAS 测试。
- 名字同号换人、身份冲突及位置未核对：任务 1/4 的快照与有效范围测试。
- 绘图查看未返回的帧、越界窗口及错误裁图坐标：任务 2 的工具边界测试。
- 全局模型改变后旧计划绘图漂移：任务 1/2 的配置快照与重试测试。
- 同一资产帧重复冻结、语音截断及父原片偏移串用：任务 3 的编排测试和实际解码。

## 任务 1：解说交接契约、姓名输入和模型配置

Files: `engineering/scripts/commentary_jobs.py`, `commentary_agent.py`, 新 `commentary_plan.py`；`engineering/tools/player-review/agents/commentary-tools.mjs`, `commentary-worker.mjs`, `commentary-provider.mjs` 与对应测试。

Interfaces: 服务请求增加 `review`（当前已保存 review，含姓名快照）；计划增加 `schemaVersion/planId/revision/digest/sourceRef/nameSnapshotRef/producerJobRef/producerConfigSnapshot/nodes/participants`。`CommentaryJobs.resolve_plan(ref,clip,variant,qa,review=None)` 返回经当前来源和版本检查的保存计划；`save` 以 `expectedRevision` 防并发覆盖。模型由服务配置注入并随计划锁定。

- [x] 为节点、来源、姓名引用及并发保存写失败测试并验证失败。
- [x] 实现契约验证及历史不可变版本，传入解说 worker 的当前姓名信息，生成实际证据节点。
- [x] 配置当前解说模型、保存生产配置快照，保留旧解说阅读及独立渲染。
- [x] 运行 commentary 相关 Node/Python 测试，记录结果供独立复核。

## 任务 2：独立绘图 worker 与本机作业服务

Files: 新 `engineering/scripts/commentary_drawing.py`、`commentary_drawing_jobs.py`；新 `engineering/tools/player-review/agents/drawing-worker.mjs`、`drawing-tools.mjs`；共享 `commentary_video.py`（本任务独占）；对应测试。

Interfaces: `CommentaryDrawingJobs(root,tactics,commentary,python=...)` 提供与原战术 agent 一致的 `create/get/cancel/adopt/retry/status/close` 签名及候选预览结构。请求含 `document/commentaryPlanRef/nodeIds/drawingModelOverride`；`create` 从任务 1 的 `resolve_plan` 读取计划，仅节点内取图。输出通过原生 candidate 转换和独立视觉审核，附计划引用、生产配置与节点状态。

- [x] 为独立工具集、模型继承、窗口/证据/坐标、上游过期采用写失败测试。
- [x] 实现独立 Pi worker 与 JSONL 宿主，限制取证范围、工具预算与结果写入；保留节点级缺口和上游审核状态。
- [x] 接入现有候选验证、预览、采用接口；旧 Codex 入口保留显式兼容路径。
- [x] 测试取消、失败和重试来源快照不变，报告单元与集成结果。

## 任务 3：统一成片时间轴与音轨

Files: `engineering/tools/player-review/tactics-production.mjs`、相关 render worker；`engineering/scripts/tactics_render.py`、`render_commentary_narration.py`、`commentary_workflow.py`；可增加独立 joint workflow 模块与测试。本任务不改 commentary_jobs.py。

Interfaces: joint render 输入保存的 `document/plan`、音频清单和来源引用。对 commentary_jobs 暴露可选 `commentary_workflow.py --document PATH`；按实际 TTS 时长生成唯一编排，渲染原生图形/姓名/字幕及音频，仍输出 `render/commentary-final.mp4`、`render/commentary.srt`。

- [x] 为同帧合并暂停、关键节点锚点、非零 PTS/父映射、音频长度写失败测试。
- [x] 编排唯一输出帧表，保留人工图形时长，字幕和音轨使用输出时间；保存编排快照供预览。
- [x] 接入正式共享 SVG/姓名渲染与音轨，保留 standalone commentary 的兼容行为。
- [x] 运行生产/渲染回归与本地实际短片解码，区分模拟音频验证和真实 TTS 验证。

## 任务 4：工作台顺序入口、姓名快照与服务路由

Files: `engineering/tools/player-review/app.mjs`、`commentary-ui.mjs`、`tactics-ui.mjs`；`engineering/scripts/serve_player_review.py`；对应测试。

Interfaces: UI 保存当前 review 后提交解说，保存响应更新 revision/digest；默认绘图携带所选 `commentaryPlanRef`，保留单独模型输入及清除继承。服务将新绘图作业路由与旧执行器兼容区分，联合成片请求传当前 document 及计划引用。

- [x] 扩展现有姓名快照、通过解析器生成有效区间并传入 review。
- [x] 接入解说保存、绘图触发与关键节点定位；默认整段绘图必须依赖解说，可顺序衔接。
- [x] 在采用与成片时核对上游版本；修改文案/身份后显示过期并阻止旧结果误用。
- [x] 运行 UI/HTTP 回归，使用本机服务核验可见入口和状态。

## 任务 5：整合、独立审核与交付

- [x] 各模块测试后做独立代码审核，修复实质问题并针对性复测。
- [x] 两段实际视频测试，检查顺序调用、内容/图形/姓名及联合成片；若凭据或外部服务阻断，明确保留未验证边界。
- [x] 更新工程说明与独立交接，记录测试、产物及尚存限制，不把本地实现说成云端上线。

## 执行记录

- 2026-10-10：用户批准设计并授权推进。任务 1/2/3 分文件并行，任务 4 由主线程接合；任务 1 提供计划契约，任务 2 消费；任务 3 提供 `--document`，任务 1 接入 render。
- 预检：任务 1/2 共享 provider/计划接口但无文件写入重叠；任务 1/3 通过 CLI 连接；任务 4 独占前端及服务路由。测试不宣称已执行。
- Ruling: 用户已授权现有方案实施，沿当前 main 工作区执行；不再次以技能默认工作树或计划审阅流程要求许可。风险由本地可逆修改和独立审核控制。

## 实施与验收状态（2026-10-10）

代码、回归、独立复核和文档已完成，详见[实施交接](../../../handoffs/thy-0629/2026-10-10-0033-commentary-led-tactics-implementation.md)。主线程 Python 110 项通过；前端及 Agent 全量 Node 762 项通过，最后 UI 增量后完整 UI 81 项通过；tactical-overlay 60 项通过、1 项已有可选测试跳过。两段实际视频的联合媒体链路验证通过，但使用测试音和测试文字／图形／姓名标签。

- [ ] 待服务端凭据配置后，真实运行解说、独立绘图、TTS，并人工核对两个不同回合的事实、姓名、路线和听感。本轮没有可用的理解／语音服务凭据，不能将媒体链路测试作为该项验收。
- 本轮未提交、推送或部署。出手／2K 规则仍暂缓。
