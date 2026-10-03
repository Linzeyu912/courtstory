# 战术轨迹叠加实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付独立战术叠加引擎与可目视核对的静态预览，正确表达完整当前动作、后续真实路线和所有参与者。

**Architecture:** 只读消费现有 schema 2，异步生成绑定来源的 manifest；SVG/静态报告与 CLI 使用同一引擎。按阶段预计算 manifest，真实样例使用对应帧 JPEG，不修改队友前端或正式草稿。

**Tech Stack:** 无新依赖的 ES modules、Node.js 22+、现代浏览器、Web Crypto SHA-256、SVG、Node 内置测试。当前实测运行时为 Node 24.15.0；不把它称为 Node 22 已实测。

**Spec:** [已批准设计规格](../specs/2026-10-02-tactical-trajectory-overlay-design.md)。用户已批准并授权执行，主代理协调实施与独立复核，不再增加用户批准关卡。

**完成检查点（2026-10-03，Asia/Shanghai）：** 任务 1–3、集中显示修正及残余路线遮挡修正均完成；最终独立验证为 SPEC Compliant / QUALITY Approved，无开放问题。真实候选、精确冻结图、合成演示、8 场景浏览器证据和中断恢复记录均已保存。真实精度人工验收与未来播放器接入不在本轮通过范围。见 [本轮交接](../../../handoffs/thy-0629/2026-10-03-0055-tactical-overlay-engine.md)。本轮只保存本地文件，不提交推送。

## 全局约束

- 直接在 `main` 工作；仓库约定覆盖技能默认 worktree/提交步骤。保留其他修改，不创建分支、worktree、commit 或 push。
- 所有新代码放在 `engineering/tools/tactical-overlay/`；只读复用 `../player-review/court.mjs` 与必要身份辅助函数，不改现有 frontend/package/bundle/server。
- 复用 schema 2 与已有检测/标定结果；原视频、轨迹、候选、正式草稿保持原样，不增加模型推理或新战术分类器。
- 帧为零基安全整数，区间为半开；当前 active 的完整动作实线，pending 的真实后续观测虚线，completed 淡化；静态参与者不造路线。
- 保留全 play roster，当前/下一阶段只决定路线与高亮；缺席实体仍输出 partial。估计、手绘、冲突及缺口不进入真实观测路线。
- 图像点按每个来源帧先到球场、再到冻结视角；失效时明确仅 2D/不可用，不使用旧像素顶替。
- 005 指 SAS–MIA 的 `ebard` 候选；真实身份、接地、关系未通过人工复核前必须保留警告，不用合成通过代替真实验收。

## 文件与接口

所有下列文件均位于 `engineering/tools/tactical-overlay/`，不新建 npm 包。

| 文件 | 责任 / 公开接口 |
|---|---|
| `binding.mjs` | `canonicalJSON(value) -> string`；`async createSourceBinding(review) -> SourceBinding`；按规格 canonical-json-v1 计算完整 review/帧映射摘要 |
| `validation.mjs` | `validateInputs({review,playDefinition,phaseId,freezeFrame,options}) -> issues[]`；结构、引用、枚举、范围校验，摘要比对由 overlay 调用 binding 后完成 |
| `geometry.mjs` | `buildActionGeometry(context,action) -> {paths,markers,breaks,issues}`；逐帧投影、有效分段、静态/掩护符号，保留来源 |
| `overlay.mjs` | `async buildTacticalOverlay({review,playDefinition,phaseId,freezeFrame,options}) -> Promise<Manifest>`；只读组合校验/摘要/状态/全 roster/质量/几何 |
| `fixtures/synthetic.mjs` | `async makeBoundaryFixture()`、`async makePresentationFixture()` 返回 `Promise<{review,playDefinition}>`；前者对应规格四帧例，后者含多参与者、无球动作、静态位置和掩护 |
| `render-svg.mjs` | `renderOverlaySvg(manifest,{mode,viewport}) -> string`；mode 为 video/court，数据与样式分离，正确转义文本 |
| `preview.mjs`、`export.mjs` | `buildPreviewHtml({title,scenes}) -> string` 生成自包含静态报告；CLI 生成 manifest/SVG/index.html 与来源索引；不生成新轨迹规则 |
| `binding.test.mjs`、`overlay.test.mjs`、`consumer.test.mjs` | 下表 1–9 的行为测试；夹具不得进入真实素材清单 |
| `README.md`、`fixtures/005-candidate/` | 接入/CLI说明；真实候选审阅副本、play 定义、来源与质量证据，视频/JPEG/大输出仍放忽略的 artifacts |

输入 review 必须是 JSON.parse 后的已序列化导出快照；现有内存 exportReview 的 undefined 可选值只能由调用方在明确的 JSON 序列化边界处理，引擎拒绝 undefined，不静默剥离字段。

`SourceBinding` 固定包含 `digestVersion,videoSha256,sourceVideoSha256,trackingFingerprint,trackingRevision,frameMappingDigest,reviewDigest`；所有实际字段参与摘要，修改内容后必须显式重建绑定。Node 使用 `globalThis.crypto?.subtle` 或 `node:crypto.webcrypto.subtle`，浏览器使用 Web Crypto；不得用伪摘要回退。

## 复核重点与行为断言

优先检查：同名素材/不同版本的旧清单；阶段与精确冻结图绑定错误；P 声明存在而 review 缺席；切镜/同人换 T 后无依据连线；原地掩护和静态站位被误画成路线。以下断言分别落入负责它的任务，不另开并行实现同一接口。

| 编号 / 测试名 | 关键断言 |
|---|---|
| 1 `canonical_json_and_binding` | `canonicalJSON({b:1,a:[2,1]}) === '{"a":[2,1],"b":1}'`；整数键按字典序；拒绝 undefined/非有限数/稀疏数组；改变任一 review 字段会改变 binding |
| 2 `reject_stale_or_invalid_input` | `schema_unsupported`、`phase_frame_mismatch`、绑定/映射/标定摘要变化均 refused，所有绘制数组为空；不改变输入 |
| 3 `whole_action_and_phase_boundaries` | 四帧例在 F=1：A 帧 `[0,1,2]` active，B 帧 `[2,3]` pending；F=2/S2 时 A/B 同时 active，跨阶段 A 仅一份；end 时 completed |
| 4 `complete_roster_and_status` | P3 已声明但缺席 review 为 missing/unavailable、整体 partial；未声明的 P 引用为 refused；关闭下一阶段预览也不删全 roster；静态无箭头 |
| 5 `project_every_source_frame` | 两个不同合成相机矩阵表示同一球场点，冻结投影相同；冻结矩阵无效时 videoOverlay=false、有效 court2d 保留；不能直接连接原图像素 |
| 6 `never_bridge_uncertain_segments` | cuts、缺失、冲突、manual_path/interpolated、无效标定、可疑跳点均分段并带 provenance；同 P 换 T 只在连续有效且复核条件满足时连接 |
| 7 `screen_and_quality_are_independent` | 地面掩护方向正确投影，缺朝向不猜；roll/pop 独立；warning 不把 active 改虚线；任何必需项 unavailable/partial 使总状态 partial |
| 8 `svg_preserves_meaning` | active/pending/completed 样式、多人箭头/掩护/静态标记/完整名单均保留；CSS px 不改变路线点；文字可安全包含 `<>&"` |
| 9 `consumer_source_and_stage` | CLI 产物绑定与引擎一致；JPEG 帧号/SHA/绑定不符拒绝叠加；切阶段同步选择已绑定图像与 manifest，不残留上阶段叠加；原文件未写入 |
| 10 `005_candidate_evidence` | 来源锁定 005-ebard；139 needs_review 与 108–111 invalid 未被静默升级；真实材料警告/缺口与原记录一致，合成图和真实候选明显分开 |

## Task 1: 独立纯逻辑引擎

**Files:** 新建 binding、validation、geometry、overlay、synthetic 夹具及 binding/overlay 测试。

**Consumes:** 已批准规格与现有只读 court/identity 辅助函数。
**Produces:** 上述 async `buildTacticalOverlay`、async `createSourceBinding`、sync `canonicalJSON` 及稳定 manifest v1，供任务 2 原样消费。

- [x] 先写断言 1–7；缺少函数时运行测试确认失败，不以语法错误充当需求反例。
- [x] 运行：`node --test engineering/tools/tactical-overlay/binding.test.mjs engineering/tools/tactical-overlay/overlay.test.mjs`，保存失败原因。
- [x] 实现摘要/校验、动作状态与全 roster，再实现逐帧投影/分段/质量/掩护；严格复制规格枚举、issue 必填形状与状态汇总。
- [x] 使用四帧夹具和丰富合成夹具核对输出；源数据结构冻结或深比较，证明调用没有修改 review/play。
- [x] 重跑同一命令至通过；独立 reviewer 核对契约与失败输入，修复有证据的问题后才把公共接口交给任务 2。

## Task 2: 同一引擎的 CLI 与静态预览

**Files:** 新建 render-svg、preview、export、consumer 测试；补充 README 运行步骤，不新增服务器。

**Consumes:** 任务 1 的三个公开函数、Manifest v1；可选冻结帧索引 `{videoSha256,frames:[{frame,time,file,sha256}]}`。
**Produces:** 每阶段 manifest JSON、SVG、阶段按钮静态 HTML、来源索引；真实背景使用对应帧 JPEG，合成背景明确标注“合成规则演示”。

- [x] 先写断言 8–9；证明阶段、冻结图与 manifest 一一绑定，拒绝不匹配的输入资产，再运行 `node --test engineering/tools/tactical-overlay/consumer.test.mjs` 确认失败。
- [x] 实现 SVG 消费器：不重新推断 temporalStatus、不加长路线、不隐藏缺席者；显示独立质量警告，冻结视频不可用时只提供明确标记的 2D。
- [x] 实现 CLI：`node engineering/tools/tactical-overlay/export.mjs --review <review.json> --play <play.json> --frames <frames.json> --out artifacts/tactical-overlay-preview`；frames 可省略，仅允许合成/2D 产物。
- [x] 按阶段默认 freezeFrame 调用引擎，生成嵌入 manifest、SVG 与精确帧背景的自包含 HTML，阶段按钮只切换已绑定的完整场景。转义 HTML/SVG/嵌入 JSON，不请求实时视频或发起 seek。
- [x] 用现有 `python -m http.server 8890 --bind 127.0.0.1 --directory artifacts/tactical-overlay-preview` 在需要时打开 QA，服务根限定为产物目录；不占用现有 8876，不调用 player-review API 写草稿。
- [x] 重跑 consumer 与引擎测试通过；独立 reviewer 检查来源绑定与 SVG 语义。README 单列未来 live video 接入必须在 seek 前隐藏叠加，实际呈现帧匹配后才恢复，不把本静态预览声称为已接入播放器。

## Task 3: 真实候选、目视 QA 与交接

**Files:** 新建 `fixtures/005-candidate/` 的小型数据/来源说明；更新 tactical-overlay README；独立交接与共享状态由主代理统一维护。

**Consumes:** 任务 1–2 已复核产物、独立数据审阅结果和现有 005 视频/候选。
**Produces:** 合成全功能演示、真实候选预览、逐项验收证据与明确剩余限制，不宣称未经复核的战术或地面真值。

- [x] 先完成断言 10 的来源/状态核对；在独立 QA 副本中组装 review/play，记录 P–T 区间、动作/关系证据和未确认项，绝不改正式草稿或原候选。
- [x] 用现有工具按实际解码帧号提取冻结 JPEG，记录帧/PTS/视频 SHA/JPEG SHA；不得用近似时间 seek 的截图冒充精确帧。未充分复核的数据保持 warning，缺失则保留 partial。
- [x] 使用同一 CLI 生成两类预览，浏览器实际查看：当前动作越过冻结帧仍是实线、下一阶段完整虚线、所有参与者、屏幕缩放、掩护朝向、缺口与仅 2D 状态；保存截图与观察结果。追加核对标签与路线/箭头/横杠不相交，以及窄侧栏内部滚动和阶段替换。
- [x] 运行 binding / overlay / consumer / candidate 四份 JS 测试（57 项 / 56 通过 / 1 权限跳过）；最后仅渲染器与消费器回归改动后重跑 consumer（27 项 / 26 通过 / 1 同一权限跳过）。检查本次差异与链接。既有 player-review 基线已由主代理运行 144/144 通过（Node 24.15.0，13.17 秒）；未改共享代码时不重复整套，不跑无关 Python 全量。
- [x] 最终由新上下文 reviewer 做整体复核；集中修正后独立复核，残余路线遮挡经定点修正与验证通过。README 写清 API/命令/真实候选限制/队友接入方法，交付本地结果与证据；不提交推送。

## 执行与完成判据

顺序为任务 1 独立复核 → 任务 2 独立复核 → 任务 3 整体验证。真实资料只读审阅可与任务 1 并行，由主代理负责独立文件范围；产品实现遵循本计划接口，不并行覆盖相同文件。

完成要求：新增行为测试通过，静态报告已实际打开并核对，来源/缺口/质量可追溯，现有工作台文件未改变，独立 reviewer 结论与剩余真实数据限制已记录。真实数据达不到验收条件时仍交付可用引擎与明确标警的候选，不把它写成已验证战术成片。

参考实现约束：[Node Web Crypto](https://nodejs.org/docs/latest-v24.x/api/webcrypto.html) 的 `subtle.digest` 返回 Promise；[SVG marker](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/marker) 支持方向与 markerUnits。官方文档已由主代理核对，本计划不引入其他框架。
