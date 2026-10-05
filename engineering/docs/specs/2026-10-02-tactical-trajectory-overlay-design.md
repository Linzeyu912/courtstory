# 战术阶段与冻结画面轨迹叠加设计

- 日期：2026-10-02，Asia/Shanghai。
- 状态：书面规格已获用户批准，已授权按约定范围实施与验证；设计批准不代表功能已实现或真实样例已验收。
- 依据：本轮用户确认的表达需求，以及当前 `main` 的工作台源码与共享候选。
- 范围：复用已审阅视频和 schema 2 数据，产生与渲染框架无关的战术叠加清单。

## 1. 目标与已确认要求

在真实比赛视频的关键帧暂停，用清楚的大箭头表达一次完整动作，并按阶段讲清复杂配合。观看者应同时看见持球、无球切入、掩护、接应和拉开空间等相关球员，知道谁正在行动、谁随后行动、路线来自哪段真实画面。

本轮已确认：

1. 关键帧冻结真实视频，箭头方向和线条要清楚。
2. 当前正在执行的动作显示**完整路线实线**，包括冻结时刻之后、已在后续视频中观测到的部分。
3. 后续动作显示虚线，路线必须来自后续真实视频帧，不是 AI 预测。
4. 复杂战术划分为有顺序的阶段；每阶段保留所有参与者，不能只画持球人或静默截成前三人。
5. 队友正在重写前端，稍后提供接入位置；本模块独立处理数据和几何，现有工作台能力与草稿行为保持。

随本规格批准采用的默认值：已完成动作淡化；默认预览紧邻的整个下一阶段；阶段与动作先由人工或上游提供；质量不足时明确提示或停用相应几何；具体线宽与配色由接入方配置。

## 2. 当前基础与缺口

| 已有事实 | 对本设计的意义 |
|---|---|
| [`tracking-display.mjs`](../../tools/player-review/tracking-display.mjs) 的 `continuousTrail` 默认向前回看 1.2 秒，`app.mjs` 调用 P/T 尾迹 | 这是短历史尾迹，不具备动作完整范围和阶段语义；新叠加不能只把它加粗 |
| [`trajectory.mjs`](../../tools/player-review/trajectory.mjs) 的 `exportReview` 输出 schema 2、原图与球场轨迹、来源帧映射、视频/跟踪指纹和合并切镜点 | 作为只读输入；不另跑检测，不改写已保存轨迹 |
| [`court.mjs`](../../tools/player-review/court.mjs) 提供 `calibrationAt`、`buildCourtTrajectories`、`project` | 可复用每帧图像与球场的变换；有效映射不代表真实地面精度已验收 |
| `addEvent` 记录单实体、单帧事件，没有参与者关系、持续区间和地面朝向 | 旧事件只能辅助人工标注；不能自动升级成完整挡拆或阶段定义 |
| `identityConfirmed` 来自实体是否存在人工身份选择，`allFramesManuallyVerified` 为 false | 它不是每帧身份正确的证明；人工姓名/2K资料确认同样不升级轨道精度 |

当前未验收：整段同人身份、真实脚地接触、球场米制准确度及真实战术关系。首版不增加自动战术分类器、OCR、断轨续接、球的三维弧线或自动讲解生成。

## 3. 方案选择与边界

| 方案 | 好处 | 代价与取舍 |
|---|---|---|
| **独立纯逻辑层，输出叠加清单（推荐）** | 可测试时间、身份和投影；队友可用 Canvas、SVG 或视频渲染器消费 | 需要约定阶段数据和清单版本；适合当前前端接口尚未确定的情况 |
| 直接扩展现有 `app.mjs` 画布 | 能较快展示一段效果 | 数据判定与 DOM/播放状态耦合，前端重写时容易重复实现 |
| 先离线烧录箭头视频 | 演示结果固定、便于逐帧检查 | 阶段修改需重新渲染，难供交互页面复用；可作为后续清单消费者 |

推荐层只负责校验、动作状态、参与者汇总、路线分段和坐标投影。它不读写浏览器草稿、不操作播放器、不请求模型，也不负责页面布局。接入层负责暂停/定位真实视频、确认呈现帧、视口缩放、绘制和交互。

## 4. 两种时间与动作状态

所有 `frame` 使用当前剪辑的**零基整数帧号**；范围统一为 `[startFrame, endFrameExclusive)`。旧数据的闭区间须在输入适配边界显式转换，不能混用。秒数取 `sourceFrameMapping` 的实际 `time/sourceTime`，不使用 `frame / fps` 代替 PTS。

- `mediaFrame`：此刻真实视频呈现的帧。暂停时它必须等于已确认的 `freezeFrame`。
- `phase`：讲解阶段，含有序 `phaseId`、展示区间、默认 `freezeFrame` 和动作引用。它组织叙述，不决定动作是否正在执行。
- `presentationTime`：接入方的强调/淡入动画时间；不能改变视频来源帧、路线范围或动作状态。

阶段展示区间按顺序排列、不重叠，并覆盖所选讲解范围。默认冻结帧必须在该阶段区间内。点阶段按钮后，播放器定位到该阶段默认冻结帧；只有实际解码帧确认后才显示对应叠加。阶段内逐帧调整直接重算；跨边界时由接入层在调用前选择包含新帧的阶段；不在任何阶段时关闭阶段叠加。函数自身不选阶段、不夹帧：`phaseId` 存在但 `freezeFrame` 不属于其区间时，返回 `refused` / `phase_frame_mismatch`；未知 `phaseId` 返回 `invalid_reference`。

对显示集合中的每个动作独立计算，多个动作可同时 active：

| 条件 | `temporalStatus` | 建议视觉 | 路线取值范围 |
|---|---|---|---|
| `start <= mediaFrame < end` | `active` | 实线、大方向箭头 | 动作完整 `[start,end)`，不在冻结帧截断 |
| `mediaFrame < start` | `pending` | 虚线、方向箭头 | 动作完整 `[start,end)` 的后续真实观测 |
| `end <= mediaFrame` | `completed` | 淡化实线 | 保留完整动作供回顾；淡化是本规格建议 |

边界例：在 `start` 帧进入 active，在 `end` 帧进入 completed。动作长度必须大于零；不能用零时长区间表示瞬时事件。瞬时事件独立使用 `eventFrame` 标记。

跨阶段持续的动作只定义一个 `actionId`，由涉及的阶段共同引用；去重后只画一次。阶段边界不裁短完整动作，也不因为切到下一阶段就重新把它算作 pending。实际动作区间不得越过所选 play 的总范围。

**仅为合成规则示例，以下帧号、P 编号和动作不是对现有视频的战术认定：**冻结在帧 30，A=`[10,50)`、B=`[20,40)` 都画完整实线；C=`[45,70)` 画完整虚线。A 的 31–49 帧仍为实线，C 不因属于当前选中阶段而变成实线。

## 5. 阶段显示集合与完整参与者

默认显示集合为当前阶段全部动作，加上紧邻下一阶段的全部动作；最后阶段无下一阶段。当前阶段尚未开始的动作也为虚线。下一阶段引用了当前已 active 的跨阶段动作时沿用 active，不强制改成虚线。`previewNextPhase` 可关闭，但不能只挑下一阶段的某一个球员。

`roster` 始终保留 `playDefinition.participants` 声明的全回合相关参与者，包含掩护者、受掩护者、明确涉及的防守者、无球跑动者和静态接应/拉开者，不假定恰好五人或十人。`highlightedParticipantIds` 是当前阶段参与者、全部动作/静态关系参与者及启用预览时下一阶段对应集合的并集；它决定强调程度，不决定谁从名单消失。

- 不按人数、分数或“重要程度”静默删除；同一 P 可同时拥有多个角色/动作状态。
- 没有移动的参与者仍有编号、角色和位置标记，不伪造短箭头来凑路线。
- 缺少有效位置者仍保留在清单和参与者说明中，标记“位置待补”；不在视频任意放置假坐标。
- 仅在早前阶段行动的人可淡显当前有效位置；远期阶段的人保留名单与位置状态，暂不绘制远期长路线。每人明确输出 visible/missing/offscreen，不能把未检出误作出画。
- schema 2 只导出有关联的实体；定义中存在但导出中缺席的参与者仍保留，理由为 `entity_missing_from_review`，不自动用另一个 P 顶替。
- 画面过密时可降低已完成路线透明度、缩短文字或显式临时聚焦；必须提示被暂时聚焦隐藏的人数，并能恢复全部。数据清单始终完整。
- 模块只能检验“标注定义中的所有参与者是否都输出”；是否漏标真实参与者需人工看片验收，不能由十个槽位推断。

## 6. 输入契约 v1

`async buildTacticalOverlay({ review, playDefinition, phaseId, freezeFrame, options }) -> Promise<manifest>`

该函数已在 [独立工具](../../tools/tactical-overlay/README.md)中实现。输入不可变；相同输入、配置与契约版本得到相同输出。摘要计算与引擎调用均为异步，具体字段和消费方法见工具说明。实现通过规则测试，不代表真实身份、接地或战术已获人工验收。

| 对象 | 必需内容 |
|---|---|
| `review` | 现有 schema 2：`videoSha256/sourceVideoSha256`、`trackingFingerprint/trackingRevision`、尺寸、`sourceFrameMapping`、`settings.cuts/sourceCuts`、entities 的原图/球场轨迹、`court.calibration` |
| `playDefinition` | `schemaVersion`、`playId/revision`、当前剪辑总范围、`sourceBinding`、全局参与者、阶段、动作、关系和审阅证据 |
| `sourceBinding` | 预期视频 SHA、根源视频 SHA、跟踪指纹、帧映射摘要、review 内容摘要；摘要覆盖身份、坐标、切镜和标定版本 |
| `phase` | 唯一 `phaseId`、顺序、标题、`startFrame/endFrameExclusive`、默认 `freezeFrame`、`actionIds/participantIds/relationIds` |
| `action` | 唯一 `actionId`、`actorId/participantIds`、人工或上游提供的 `kind`、动作区间、证据帧范围、来源和审阅状态 |
| `participant` | 稳定 P 编号、显示名/球队等可选资料；阶段角色不覆盖原身份资料 |
| `screenRelation` | 掩护动作 ID、掩护者、受益者、明确涉及的防守者（可为空）、关系区间、朝向/位置证据 |
| `reviewEvidence` | 逐项的 reviewer、检查范围、来源帧、方法、结论；身份连续性、地面点和战术关系分别记录 |

`kind` 首版可表达 move/cut/roll/pop/hold/space/screen；标签不触发额外推断。来源至少区分 `human_video_review` 与 `upstream_supplied`，上游结论未复核时保留待确认。已有单帧事件只能通过显式引用成为证据，不能补造缺失区间或参与者。

`reviewDigest` 采用 `digestVersion: canonical-json-v1`，规则如下；视频、跟踪、剪辑映射、身份、坐标或标定变化后旧定义失效，重新核对并生成绑定，禁止只依靠 P 编号或文件名复用。

1. 输入只允许 JSON 的 null、boolean、string、有限 number、稠密 array、普通字符串键 object；递归拒绝 undefined、NaN、Infinity、BigInt、函数、Symbol、稀疏数组、循环和其他非 JSON 值，不静默丢弃或转为 null。
2. 递归按键名的 UTF-16 码元字典序输出对象成员；不用 locale 排序，也不让 JavaScript 的整数键枚举顺序改写排序。数组严格保留原顺序。
3. 字符串及键采用 ECMAScript `JSON.stringify(string)` 转义；不 trim、不改变大小写、不进行 Unicode 或时间字符串规范化。
4. 数字采用 ECMAScript `JSON.stringify(number)` 表示法；`1.0` 规范为 `1`，`-0` 为 `0`。帧字段先校验为安全整数，不把字符串 `"1"` 强制转为数值；其他数值同样必须有限。
5. 用 JSON 标点无空白拼接，编码为无 BOM 的 UTF-8，对全部字节求 SHA-256，输出 64 位小写十六进制。`frameMappingDigest` 对完整 `review.sourceFrameMapping` 用同一规则计算。
6. `reviewDigest` 覆盖输入 review 的全部实际字段，包括确认时间、附加来源和质量字段；不排除“无关”字段。摘要自身存于外部 `sourceBinding`，不是 review 输入字段；生成的 manifest 也不属于 review，不参与摘要。

函数在实际帧域校验所有引用、区间、重复 ID、帧映射、坐标有限性及绑定摘要；缺失指纹的真实样例不能进入正式可用状态。错误返回结构化原因，不自动猜测新旧版本相同。合成夹具单独带 `synthetic:true`，不得进入正式素材清单。

### 6.1 可消费状态与错误契约

输入 `playDefinition.schemaVersion=1`、输出 `manifest.schemaVersion=1`；现有 review 仍为 2。消费者必须识别版本后再使用；枚举之外的值为 `invalid_input`，以后扩展须升契约版本。

| 字段 | v1 有限枚举 |
|---|---|
| `manifest.status` | `ok / partial / refused` |
| `action.temporalStatus` | `active / pending / completed` |
| `renderability`（动作、关系、位置标记） | `ready / warning / unavailable` |
| `coverage`（动作几何） | `complete / partial / none` |
| `roster[].positionState` | `visible / missing / offscreen` |
| `quality.identity/position/calibration/tactic.state` | `reviewed / needs_review / invalid / not_applicable` |
| `issue.severity / issue.scope` | `fatal / warning / info`；`manifest / phase / action / participant / relation / segment` |

每个 issue 必须有全部字段：`{code,severity,scope,phaseId,actionId,entityId,relationId,range,details}`。不适用的 ID/range 为 null；`range` 非空时为 `{startFrame,endFrameExclusive}`；`details` 为 JSON 对象，保存具体输入字段或边界。消费者按 code 判定，不解析中文提示文字。

- fatal code：`schema_unsupported / invalid_input / invalid_reference / undeclared_participant / source_binding_mismatch / phase_frame_mismatch`。其中阶段/动作/关系引用不存在的定义为 invalid_reference；引用未在 play 全局参与者声明的 P 为 undeclared_participant。
- warning code：`entity_missing_from_review / identity_needs_review / position_needs_review / calibration_needs_review / tactic_needs_review / screen_orientation_missing / freeze_calibration_unavailable`，以及下列分段 code。
- 分段 code：`source_cut / identity_boundary / identity_conflict / missing_position / out_of_view / estimated_point / calibration_unavailable / calibration_boundary / court_reference_mismatch / non_monotonic_time / suspicious_jump`。`breakBefore/breakAfter` 只能用这些值或 null；范围和细节放入对应 issue。

汇总顺序固定：先做结构/版本/绑定校验；有任一 fatal 则 `refused`，所有可绘制数组及 roster 为空，只保留版本、请求选择值和 issues。否则按全 roster、当前/下一阶段预期动作与关系及冻结视频视图评估：任何 warning、任何预期几何不可用或 coverage 不完整，都为 `partial`；只有所需项均 ready、完整且无 warning 才为 `ok`。即使没有任何可画点，只要输入合法仍是 partial，不升级为 refused。

已声明 P 在 review 中缺席属于合法的不完整数据：保留 `positionState:missing`、`renderability:unavailable` 和 `entity_missing_from_review`，汇总 partial，不能误判 invalid_reference。明确 out_of_view 时保留 offscreen；无冻结位置、无伪造标记，同样 partial。全部分段理由均产生 warning；info 不影响汇总，但 v1 不以 info 降低上述缺口严重度。

## 7. 冻结视角下的完整路线

对动作每个有效观测帧 `f`，先取真实图像脚点 `p(f)`，用该帧映射 `H(f).toCourt` 转到统一球场，再用冻结帧映射 `H(F).toImage` 投回冻结画面：

`pFreeze(f) = H(F).toImage( H(f).toCourt( p(f) ) )`

这让早期/后期的观测在同一冻结镜头下叠加。禁止把不同帧的原图像素直接连线；移动镜头不能用冻结帧矩阵近似所有帧。已有 `courtTrajectory` 只有在来源、标定和摘要一致时复用，并保留逐点来源；独立人工球场点也要有对应视频证据，不能自动当作观测路线。

所有几何以原视频像素和球场米数保存。渲染层统一处理 letterbox、裁剪、缩放和设备像素比；线宽、箭头头部尺寸、文字、描边使用 **CSS px**。建议初值为主线 6 CSS px、箭头头部 18 CSS px、外描边 2 CSS px，作为可配置显示值，不是精度结论。

“大箭头”通过清晰线宽、箭头头部和对比度表达，不人为拉长实际路线或偏移路径。过短/静止路线用位置标记；未裁剪原始几何与视口裁剪结果分开保存，出视口不等于轨迹缺失。

冻结帧位置标记必须来源于冻结帧有效观测。下一动作的起点可另标“后续动作起点”，携带自己的来源帧；不能让其冒充球员当前所在位置。静态角色可保留阶段位置证据，但缺乏当前帧位置时明确标注不可用。

## 8. 连续性与质量规则

时间状态与数据质量是两个独立维度。**虚线只表示后续动作，不表示不确定；实线也不证明身份、位置或战术已核准。**质量用独立徽标、警告、缺口符号和清单字段表达。

建议 `quality` 分别输出 identity、position、calibration、tactic 的状态和理由，不合成一个掩盖问题的分数。实体级 `identityConfirmed` 仅作线索；要结合区间身份来源、P–T 关联边界和人工检查记录，不能推导为所有帧都确认。

| 条件 | 建议输出 |
|---|---|
| 来源与版本匹配，有真实观测、有效映射，所用身份区间/地面/关系已按验收范围复核 | `renderability: ready`；仍原样保留 `metricAccuracyValidated:false` 等精度边界 |
| 有真实观测和可计算几何，但身份连续性、地面或战术仍待核对 | `warning`，作为带醒目标识的预览；不得宣称真实样例验收通过 |
| 无位置、身份冲突、非法映射或没有可支撑的几何 | 对应片段/标记 `unavailable`；保留参与者、原因和来源范围 |
| schema、哈希/指纹、帧映射或区间引用不匹配 | 整次 `refused`，禁止套用旧清单到当前视频 |

可观测点包括有原帧检测记录的 `tracked` 和逐帧实际点选的 `manual`；“来自观测”仍不等于定位准确。`interpolated`、`manual_path`、`court_estimated` 不进入实/虚线观测路线。`court_manual` 只有明确的原帧观测依据才可进入，不能凭来源名推断；估计和手绘只留在独立复核材料中。

必须断开的边界：真实拼接/人工切镜、身份冲突或不明确的关联边界、缺失/出画、估计点、无效标定、球场参考不一致、非单调时间和可疑跳点。阈值以 `geometryPolicyVersion` 与配置记录；跳点阈值是保护策略，不宣称运动学真值。

同一 P 换了 T 不足以自动跨段连线。若区间身份已经复核、每个相邻帧都有有效观测、映射相容且没有不确定性，可保持同一 P 的连续几何；只要中间有缺口就分段，不能用“已确认同人”补一条连接线。人工修正和标定来源切换默认形成分段边界，只有显式复核边界连续性后才合并。

切镜两侧不画连接线。后段若与冻结帧具有经核对的共同球场坐标，可独立投影其有效片段；否则仅保留该片段的不可用说明。每段携带 `breakBefore/breakAfter` 及来源，不用箭头暗示跨缺口完成了连续动作。

冻结映射无效时 `videoOverlay.available=false`。已有有效球场点仍可输出 `court2d`，并明确“仅 2D，原视频叠加不可用”；不能静默拿旧帧像素或旧矩阵画到冻结视频。若原帧映射和球场点都无效，仅返回关系/缺口信息。

## 9. 掩护与静态参与者

掩护需要人工或上游提供的关系区间：谁掩护、给谁创造空间、相关防守者是谁，以及地面上的位置和朝向证据。两人距离近不能单独证明掩护成立。

`screenRelation.orientation` 使用球场坐标中的单位方向或两个地面端点，附证据帧与复核状态。短横杠从地面坐标经冻结帧投影，不能永远画屏幕水平线；它是掩护符号，不是测得的身体宽度。建议符号宽度 0.8 米可配置，并明确为显示约定。

缺少有效朝向时保留掩护者编号与“朝向待核对”，不猜横杠方向。掩护动作本身用位置/横杠表达；掩护后的 roll/pop 为独立移动动作与路线。静态拉开、等待接球等角色只保留点/圈与角色说明；已有轻微检测抖动不自动转成移动箭头。

## 10. 输出给前端的清单

| 字段 | 内容与约束 |
|---|---|
| `schemaVersion/geometryPolicyVersion/sourceBinding` | 输出契约、判定策略和绑定摘要，供缓存与过期拒绝 |
| `phaseId/freezeFrame/sourceFrame/sourceTime` | 当前叙事阶段和确切视频来源；不含播放器私有状态 |
| `status/issues` | `ok/partial/refused` 与可定位到实体/动作/帧范围的原因 |
| `roster/highlightedParticipantIds` | 全回合声明参与者、冻结位置状态、角色/动作状态与当前/下一阶段强调集合，包含无几何者 |
| `actions` | 唯一动作 ID、完整范围、active/pending/completed、质量、可绘制性 |
| `paths[].segments[]` | 全动作有效分段的球场/冻结图像点，逐点原帧/时间/P/T/来源/标定依据 |
| `markers/relations` | 冻结位置、后续起点、静态角色、掩护横杠及其来源帧/区间 |
| `breaks/unavailableRanges` | 切镜、身份、缺失、估计、标定、跳点等原因；原始数据不改写 |
| `videoOverlay/court2d/styleHints` | 两种视图各自的可用性、原视频尺寸与 CSS px 样式建议 |

路线“完整”指不受 1.2 秒窗口、冻结时刻或阶段边界裁短；真实缺口仍保留。若完整范围存在缺口，输出 `coverage:partial` 和缺口列表，不能把几段有效点称为无缺失完整路线。

前端接入前必须核对清单绑定和实际视频呈现帧。暂停/seek 尚未完成、呈现帧不匹配或切换素材时不显示陈旧叠加。播放、逐帧、模型选择、身份/2K、球/筐、脚部、标定、裁切、撤销、草稿隔离和原导出沿用现有行为；新模块不承担这些功能的重写。

### 10.1 四帧合成输入与预期输出

以下为**契约片段与预期值，不是可直接调用的完整 mock，也不是 005 的观测结论**。前置条件：完整夹具带 `synthetic:true`，已通过 schema/全部摘要绑定；P1/P2 的身份、位置、标定及动作质量均为合成的 reviewed；没有切镜、估计或缺口。其输入 review 含下表实际列出的四帧，不允许运行时外推后续点。

| 帧 / time / sourceFrame / sourceTime | P1 原图点 → 球场点 | P2 原图点 → 球场点 |
|---|---|---|
| `0 / 0.00 / 0 / 0.00` | `(10,10) → (1,1)` | `(10,20) → (1,2)` |
| `1 / 0.04 / 1 / 0.04` | `(20,10) → (2,1)` | `(20,20) → (2,2)` |
| `2 / 0.08 / 2 / 0.08` | `(30,10) → (3,1)` | `(30,20) → (3,2)` |
| `3 / 0.12 / 3 / 0.12` | `(40,10) → (4,1)` | `(40,20) → (4,2)` |

每个图像点均为 `source:manual`、`footMethod:human_image_anchor`、`identitySource:manual_range`，各有对应帧证据；球场点为 `source:projected`、`imageSource:manual`。四帧映射都是 `toCourt=diag(0.1,0.1,1)`、`toImage=diag(10,10,1)`，来源标定与冻结映射一致。review 没有 P3 实体；play 明确声明 P1/P2/P3，P3 的角色为静态拉开，无移动动作。

| 定义 | 输入值 |
|---|---|
| play / participants | 范围 `[0,4)`；`[P1,P2,P3]` |
| 动作 A | `actorId:P1, participantIds:[P1], kind:move, [0,3)` |
| 动作 B | `actorId:P2, participantIds:[P2], kind:cut, [2,4)` |
| 阶段 S1 | `[0,2)`，默认 freeze=1，actionIds=`[A]`，participantIds=`[P1,P3]` |
| 阶段 S2 | `[2,4)`，默认 freeze=2，actionIds=`[A,B]`，participantIds=`[P1,P2,P3]` |
| 本次选择 | `phaseId:S1, freezeFrame:1, options.previewNextPhase:true`；两阶段 relationIds 都为空 |

预期 manifest 为 `status:partial`、`phaseId:S1/freezeFrame:1/sourceFrame:1/sourceTime:0.04`，并有以下内容：

- A：`active/ready/complete`，仅一份路径，帧 `[0,1,2]` 的冻结图像点为 `[(10,10),(20,10),(30,10)]`；整个动作实线，包括 freeze 之后的帧 2。
- B：`pending/ready/complete`，帧 `[2,3]` 的冻结图像点为 `[(30,20),(40,20)]`；整个动作虚线，两个点都来自已列出的后续帧。
- roster 完整为 P1/P2/P3，高亮集合也为三人；P1/P2 为 visible/ready，冻结标记分别 `(20,10)`、`(20,20)`；P3 为 missing/unavailable，位置为 null，不输出坐标标记或箭头。
- 唯一 issue：`{code:entity_missing_from_review,severity:warning,scope:participant,phaseId:null,actionId:null,entityId:P3,relationId:null,range:null,details:{}}`。两条路线完整仍不能把总状态提升为 ok。

若只把调用的 freezeFrame 改成 2 而仍传 S1，预期 `refused` 和 `phase_frame_mismatch`，无可绘制输出。接入层先改成 S2 再调用时，A/B 都 active；A 仍保留帧 0–2 全路线且只出现一次，P3 的缺席仍使总状态为 partial。

## 11. 文字线框：仅表达接入契约

```text
[阶段 1] [阶段 2 · 当前] [阶段 3]       [预览下一阶段：开]
┌─────────────────────────────────────────────┐
│ 真实视频冻结帧                               │
│  P1 ━━━━━▶ 当前动作全程                      │
│  P2 ┄┄┄┄┄▶ 后续真实动作   P3 ━ 掩护符号      │
│  P4 ○ 拉开空间            P5 位置待补         │
└─────────────────────────────────────────────┘
实线：当前动作全程  虚线：后续真实动作  淡线：已完成
参与者：全部 5 人 · 1 人位置待补   [质量与来源]
```

这里的 P 编号、人数和布局均为合成说明，不分配队友页面工作。最终控制位置、样式和可访问性交互由前端接入规格确定；显示含义、完整清单与缺口提示属于必须保持的契约。

## 12. 第一份交付与验收

按已批准规格，首个可评审结果应为：一份合成阶段夹具、一份确定性叠加清单、逐项验收记录，以及一个人工审阅真实片段的候选清单。可配简单验证视图，但先复用同一契约，不把队友正式 UI 改造列为前置依赖。

真实首选候选是验收库 **`005`（SAS–MIA）**，与 `nba-lal-min-005` 不是同一视频。锁定 `ebard` 版本及其实际指纹，因为已登记脚部缓存对应 005 E-BARD，不能直接套到默认 team-stable。片名和采集标签不能充当本轮战术已复核的证据。

005 场地候选共有 143 帧，其中 139 帧仍为 `needs_review`，108–111 帧为 invalid；`maxKeyframeGapSeconds=0`。现有 `calibrationAt` 拒绝 needs_review/invalid，不能把 139 个候选说成 139 个已可用映射。须在独立 QA 数据中显式采用并人工核对所用帧的地面位置和冻结投影；采用后的 `accepted_reference` 也只表示采用参考，不证明精度。无效区间保留缺口或选择不覆盖它的真实动作，不扩大范围补猜。

真实验收还需逐段确认 P 身份、动作起止、所有参与者和掩护关系。测试材料与正式浏览器草稿隔离，不替用户做正式身份确认；不足时记录具体阻塞，不以合成通过代替真实效果通过。

| 验收场景 | 必须可观察的结果 |
|---|---|
| 合成 A/B/C 在帧 30 与各 start/end 边界 | 两个同时 active 全路线实线；C 虚线；边界无一帧歧义 |
| 一个动作跨阶段、下一阶段预览 | 同一 ID 去重，完整路线不裁短；下一阶段所有动作和参与者进入集合 |
| 多人无球跑动、掩护、静态站位 | 所有人保留；静态无伪造箭头；不存在固定 top-3 限制 |
| 后续来源包含手绘/插值或缺失 | 相关位置断开并说明；不能作为“后续真实动作”虚线 |
| 同 P 换 T、有缺口、身份竞争 | 有效同人连续观测可复用；缺口/冲突绝不被桥接 |
| 移动镜头的已知合成单应变换 | 不同来源帧投到同一冻结视角；人工原像素串线反例须失败 |
| 冻结标定无效、来源标定缺口、切镜 | 输出 partial/不可用范围或仅 2D；无旧像素伪装叠加 |
| 哈希、跟踪版本、裁切帧映射或标定变化 | 旧定义被拒绝，原因可定位；原 review 和草稿不变 |
| 原画幅缩放、短路线和屏幕边缘 | CSS px 样式清楚；路线真实长度不变，视口裁剪不改原几何 |
| 005 独立人工复核样例 | 记录身份/地面/关系证据及失败帧，逐项比较真实视频；不预宣称通过 |

高层依赖顺序（非实施任务拆解）：

- [x] 书面规格审阅：时间语义、完整参与者、质量提示和降级默认值已获用户批准。
- [x] 契约与合成不变量验收：先证明状态、边界、分段和投影逻辑。
- [ ] 005 固定版本的独立人工复核：提供可追溯动作/身份/标定证据。
- [ ] 与前端对接清单和冻结帧确认机制，再验收真实画面与既有功能兼容。

未决项：队友接入接口；线宽/配色与淡化程度；各质量提示的产品呈现；真实样例能否通过身份和地面复核。它们不改变“完整当前动作实线、后续观测虚线、所有参与者保留”的已确认目标。

## 13. 来源与文档状态

事实核对入口：工作台 [README](../../tools/player-review/README.md)、[最新发布交接](../../../handoffs/thy-0629/2026-10-02-2027-workbench-identity-publish.md)、[场地接入交接](../../../handoffs/Linzeyu912/2026-10-02-1604-scene-ground-workbench.md)、[样例库](../../../data/videos/tactics/acceptance/review-library.json)、[005 场地候选](../../../research/vision/vision-player-refinement/court-candidates-005.json)。本规格引用的是当前本地可读源码/资料，不将历史测试数量当作本功能测试结果。

本文件为已批准的本地设计；按[实施计划](../plans/2026-10-02-tactical-overlay.md)实现了独立引擎与静态预览，实际进度、验证和恢复步骤见[本轮交接](../../../handoffs/thy-0629/2026-10-03-0055-tactical-overlay-engine.md)。真实候选仍有质量和缺口限制，尚未完成人工精度验收或播放器接入，未提交/推送。本轮继续执行已获授权，无新增用户批准环节；对外发布和提交推送不在本次实施范围内。
