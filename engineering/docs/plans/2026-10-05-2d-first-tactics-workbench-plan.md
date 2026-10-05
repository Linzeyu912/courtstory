# 以 2D 球场为主画布的战术工作台实施计划

2026-10-05 实施接续：用户已明确授权完整 T0–T8，实现和合成流程验证见 [操作指南](../2d-first-tactics-workbench-guide.md)及 [详细交接](../../../handoffs/chuali-zi/2026-10-05-0127-2d-first-tactics-workbench.md)。托管环境真实视频下载与实际模型运行受限，按用户要求交接本地验收；以下历史计划 / 最终验收项保持原状，不因代码已落地批量标完成。

> **交给执行 Agent：**按本文任务顺序推进；使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`，逐项勾选、验证、记录。执行代码与独立审查分开。本文是本次用户要求的 PLAN，任务框未勾选不代表功能已经完成。

**Goal：**把工作台整理成「全片球员身份 → 2D 转换 → 2D 轨迹平滑 → 关键帧战术初稿 → 人工调整 → 投影回实拍视频」的完整流程，让用户明确知道每一步在哪里操作、处理哪个时间段、下一步是什么。

**Architecture：**以固定球场坐标作为战术图形的唯一编辑坐标。原始观测、准备好的 2D 轨迹、战术图形分层保存；2D 编辑、视频投影和 MP4 导出消费同一个战术文档和时间轴。

**Tech Stack：**沿用现有 JavaScript ES modules、React 局部界面、SVG/Canvas、Python 本地服务、现有 Agent 作业、Node/Sharp、PyAV/FFmpeg。首版不引入新的 3D 引擎或替换检测器。

**Spec：**本文第 1–7 节是从 2026-10-05 用户最新要求整理的产品规格；第 8–11 节是对应的执行与验收计划。初始参数及术语解释均标注为本计划的设计选择。

**基线：**`main@76ce1ad`，2026-10-05 11:33，Asia/Shanghai。已核对当前源码及既有说明；下述“现有能力”表示已有实现，不等于真实识别精度达标。远端后续更新须重新核查。当前无开放 GitHub Issue，不代替团队成员认领任务。

## 1. 本次方向与完成标准

用户要的核心变化：**先把人物和运动整理清楚，再在 2D 上制作战术，最后把同一份战术贴回视频。** 实拍视频用于核对和观看最终效果，2D 球场承担主要创作操作。

| 用户要求 | 本计划对应结果 |
| --- | --- |
| 标定球员，整段视频保持选中同一个人 | 稳定球员 ID 跨临时 T 编号续接；选择、队色与身份在全片一致，可按区间纠正 |
| 根据标定结果转成 2D | 逐帧脚下点通过该帧球场映射转换；视频与 2D 同步选人和定位 |
| 对 2D 跑位做平滑 | 独立、可保存、可撤回的派生轨迹版本；保留原始点、人工锚点与真实停顿 |
| 在 2D 标战术和关键帧 | 大曲线路线、虚线箭头、黄圆点传球、可旋转挡拆、跟随脚圈及关键帧面板 |
| Agent 初绘，人工补全 | 候选先预览再采用；采用后就是同一画布里的普通可编辑对象 |
| 从 2D 转到实拍视频 | 每帧重新投影贴地；冻结绘制、推进、保留未走完路线；同一 MP4 供预览下载 |
| 明确标 3–5 秒 | 秒级区间输入和拖动条常驻；先选时间段再画，时间条直接表示对象生效范围 |
| 简化第三部分 | 一个 2D 主画布、一组时间控件、一个 Agent 入口、一个属性栏；高级内容按需展开 |

### 1.1 术语与默认解释

- **“整段都有这个球员”**：身份连续。可见且有有效位置时显示框；遮挡、出画、漏检时保留球员卡和区间状态，不把上一帧的框冻结到后续画面，也不伪造位置。
- **“3D 视频”**：本期指原始实拍视频的透视画面。用 2D 球场到画面的映射实现贴地视觉；不做三维人体或完整场景重建。
- **“带指型”**：暂按前面对话约定的“直线虚线箭头”处理，工具名统一为「虚线箭头」。若用户另指运球波浪线，作为新增图形样式处理，不改变整套数据流程。
- **参考视频**：提取箭头、描边、节奏、脚圈等风格规则，不当作当前比赛的球员位置、路线或战术证据。
- **贴图**：产品上称贴图；工程上优先复用矢量图形，便于缩放、旋转、透视及人工编辑。

### 1.2 首版范围

完成单段已导入篮球视频的完整闭环；支持多阶段和镜头切换的分段处理。复用已能工作的导入、检测跟踪、身份 Agent 和 MP4 服务。字幕、配音、云部署、新模型训练、完整三维重建、空中篮球高度重建不属于本次主线。

## 2. 四个清晰工作区

```text
当前视频 [选择视频] [导入并识别]                       [保存状态]

① 球员标定  →  ② 2D 轨迹准备  →  ③ 战术制作  →  ④ 成片
               球场映射 → 平滑    关键帧 → Agent → 人工
```

导入入口常驻顶部。四个主工作区各只有一个主要任务。步骤可回退，前一步修改后明确说明哪些后续内容需要重新核对，不能无提示地清空或隐藏已有战术。

### 2.1 球员标定

默认显示原视频、球员卡、全片身份时间条和所选时间范围。

1. 检测与跟踪完成后，点画面人物或球员卡选中稳定球员。显示队色、已确认号码、人物缩略图；未知号码明确未知，不能只让用户猜 P1 是谁。
2. 「让 Agent 续接此球员」使用当前身份参考查找本段其他轨迹。临时 T 编号可变化，稳定球员 ID 不变；同队或不同队同号不能仅凭号码自动合并。
3. 默认修正所选区间，单帧作为次级模式。支持身份纠正、框/脚点偏移关键帧、遮挡/出画状态；应用前显示受影响区间与冲突，应用后一次撤销恢复。
4. 更换当前帧、切工作区、回放和保存重载都保持同一选中球员。检测框来自当前帧，身份标签来自稳定球员，不用固定矩形冒充连续跟踪。
5. 全片缺口列表可点击跳转。允许保留明确标记的未知区间，不要求用户逐帧处理全部十人后才能继续；当前战术涉及的球员和时段优先检查。

**出口：**「进入 2D 轨迹准备」，显示已关联球员、冲突、可见但缺位置的区间数量；出画不计为待补框缺口。

### 2.2 2D 轨迹准备

两个子步骤，先后关系清楚：

- **球场映射：**复用自动球场标定、人工选点和镜头跟随。逐帧把脚下点转换为固定球场坐标；默认同时展示小原视频与大 2D 球场，点同一球员两边高亮。
- **轨迹平滑：**只对已获得的 2D 坐标处理。常用项只有「关闭 / 轻度 / 标准」和「原始 / 平滑对比」；选择球员及时间范围后预览，满意再「采用这段平滑」。

球场标定不是可以省略的隐含步骤。只有人物框，不能可靠地完成视频与 2D 互相转换。无映射区间显示缺口和修复入口，不把像素坐标直接缩放成球场坐标。

平滑规则：

- 原始观测永不覆盖；采用时保存算法版本、参数、范围和依赖摘要。
- 在切镜、身份冲突/更换、长缺测、出画、无标定处断开。短缺测的补点若存在，属于单独标记的估计，不能借平滑悄悄补全。
- 人工锁定的 2D 点不移动；保护急停、转身、挡拆停顿、真实起点终点，避免把折返变成穿越路线。
- 默认只展示选中球员的完整轨迹，其他球员显示当前位置；可切「本队 / 全部」，避免十条线同时糊在一起。
- 采用后的同一版本进入战术 Agent、2D 战术预览、视频投影和导出。不能只让画面看起来变平滑，下游仍读原始抖动坐标。

**出口：**「采用轨迹，进入战术制作」。选定区间缺少有效运动证据时，仍可手工在 2D 绘制独立示意；不能宣称是自动恢复的真实跑位。实拍投影另受映射可用性检查。

### 2.3 战术制作

2D 是默认且始终可用的主画布，原视频作为同步核对窗。鼠标在 2D 上编辑直接转换为球场坐标，不先绕到视频坐标再转回来。

推荐操作顺序：**选时间段 → 加讲解关键帧 → Agent 初稿或手画 → 修改对象 → 预览所选段。**

Agent 可在一次任务中提出区间、关键帧和图形，但采用前必须显示候选范围。人工入口不依赖 Agent 成功或 API 可用。

### 2.4 成片

默认查看投影回实拍视频的效果；可切 2D 对照预览。只保留「生成/更新成片」「播放」「下载 MP4」「返回修改」。编辑后旧成片明确标为旧版本，不让原片下载混入主交付按钮。

## 3. 战术页文字线框

```text
战术制作    视频：xxx                         [撤销] [重做] [保存]

作用时间段  [00:03.000] ━━━━━━━━━ [00:05.000]   [播放这段]
            当前画面设为起点      当前画面设为终点

[选择] [跑位路线] [虚线箭头] [传球路线] [挡拆] [重点圈]
┌──────────────────────────────────┬─────────────────────┐
│                                  │ 原视频同步核对窗    │
│        2D 球场主编辑区            │                     │
│                                  ├─────────────────────┤
│ 球员圆点 + 当前选中的战术图形     │ 未选图形：          │
│ 拖动起点、终点、曲线手柄         │ [Agent 生成这段初稿]│
│                                  │ [手动画路线]        │
│                                  │ 已选图形：          │
│                                  │ 3.00–5.00 秒        │
│                                  │ 球员/颜色/大小      │
│                                  │ [删除] [更多设置 ▾] │
└──────────────────────────────────┴─────────────────────┘

关键帧与时间轴：  0 ─── ◆3.0 ─── ◆4.2 ─── 5.0 ───────
选中图形时间条：        [━━━━━━━━━━━━━━)
                      [+ 讲解关键帧]
关键帧卡： 3.0 秒 [暂停讲解 ✓] [停留 2.5 秒] [删除]

[2D 预览] [实拍投影预览]                     [进入成片]
```

小屏时原视频核对窗可收起，属性栏变为侧抽屉。工具栏、作用时间段、保存和 Agent 主入口仍应可发现。不要出现上方一条流程、左侧另一套同义流程。

## 4. “只给 3–5 秒画一条路线”的完整交互

这条场景必须先跑通，再扩展复杂战术。

1. 用户进入战术制作，在顶部填「开始 3.000 秒」「结束 5.000 秒」，或拖时间轴的两个区间手柄。
2. 界面常驻显示「接下来新建图形作用于 3.00–5.00 秒」，播放头默认定位到起点。输入为当前素材时间；如素材已剪辑，原片对应时间放在高级信息中。
3. 点「跑位路线」。有选中球员时可从该球员 3 秒位置吸附开始；没有选人也能画独立示意。点起点和终点生成平滑曲线，拖两个控制柄修改；原视频无需重新绘制一份。
4. 保存对象时带上 `startFrame`、`endFrameExclusive`，默认讲解参考帧为区间起点。右栏和时间条同步显示 3.00–5.00 秒。
5. 点「+ 讲解关键帧」，选择 3.0 秒并启用暂停讲解；默认停留 2.5 秒，可改。暂停时绘制完整未来路线，之后继续播放并逐渐去掉已走完部分。
6. 点「播放这段」：3 秒前无此对象；3 秒暂停绘制；3–5 秒随进度保留未走完路线；到 5 秒退出显示。目的地箭头不随着裁短反向漂移。
7. 调整到 3.5–5.5 秒时，先选对象，再拖它的时间条或改右栏时间；顶部“新建图形范围”本身不会偷偷改已有对象。首尾进度与显示范围作为一个可撤销操作更新。
8. 保存、切步骤、重载后区间、关键帧和图形仍保持；导出的 MP4 包含相同效果。

### 4.1 必须统一的时间语义

- 存储使用零起点、半开区间 `[startFrame, endFrameExclusive)`；人看到秒数，精确帧号仅在辅助提示中显示。
- 用 `sourceFrameMapping[].time` 找到第一个时间戳不早于开始/结束时间的帧。**不能用 `秒 × 30` 换算源视频帧号**；源视频可能是 25、59.94 fps 或非均匀时间戳。
- 3–5 秒指原素材的播放区间，不含成片插入的冻结时长。冻结只延长输出时间，不改变源帧身份、范围或球员轨迹。
- 结束时间可等于片尾；最后一帧后的结束哨兵用经解码确认的素材结束时间表示，不用最后一个帧时间代替片尾。界面回显实际对齐的边界。
- 零长、倒置、越界输入给出就地提示；跨切镜的路线需要分段。不能把两段不连续运动画成一条线。
- 已有讲解关键帧必须位于对象范围内。缩短范围导致它越界时，明确提供「将讲解点移到新区间起点」操作；不静默删除关键帧。

工程内部还须区分动作发生区间 `actionRange`、显示区间 `startFrame/endFrameExclusive`、讲解源帧 `cueFrame`、路线完成进度 `progressFrames`、输出冻结时长。默认前两者联动且都为 3–5 秒，用户只需操作一组区间；高级设置可以分开。仅延长显示时间不能改变球员动作速度，暂停输出也不能推进路线进度。旧稿迁移保留其既有时间行为。

## 5. 关键帧模块和图形规则

### 5.1 两类关键帧分开

| 类型 | 用途 | 入口 |
| --- | --- | --- |
| 战术关键帧 | 指定源视频某个时刻、选择本次讲解的图形、是否冻结及停留多久 | 第三步底部常驻关键帧面板 |
| 球场/镜头标定关键帧 | 确定画面与固定球场之间的映射 | 第二步球场映射；第三步只提供返回修复入口 |

战术关键帧不是逐帧画每个球员，也不是复制一整套战术对象。关键帧保存时间与对象引用；图形仍只在 `annotations.items` 保存一次。同一时间的讲解点合并为一次暂停，避免叠加多次停顿。

关键帧支持新增、拖动时间、删除、启停冻结、调整停留时长、前后跳转、缩略图/图形数量，以及撤销/重做。删除讲解点默认仅移除暂停安排，图形仍保留；删除图形则同步清理空引用。

### 5.2 图形的首版操作

| 工具 | 2D 操作 | 视频表现与关联 |
| --- | --- | --- |
| 跑位路线 | 起终点 + 平滑曲线手柄；调宽度/颜色 | 贴地宽箭头，播放保留剩余段；关联球员可帮助吸附与对齐进度 |
| 虚线箭头 | 两个端点，默认直线 | 虚线及清晰箭头；表达后续已观察到的动作，不作为模型预测标识 |
| 传球路线 | 起终点，可吸附传球人/接球人位置 | 黄色小圆点连线；首版是地面战术示意，不声称重建球在空中的轨迹 |
| 挡拆标记 | 点击放置、拖动、旋转 | 按地面朝向投影；范围内可见，支持删除 |
| 重点球员圈 | 点选球员并添加 | 默认绑定稳定球员的有效脚下位置；缺位置时隐藏圈并保留对象，不能飘到其他人脚下 |

画布中的球员名/号码用于认人，可按需显示；成片默认不加球员文字标签。静止参与者用圈或角色位置示意，不生成虚构跑位箭头。

**两种平滑不得混淆：**第二步平滑处理观测坐标的抖动；第三步 Agent/人工用少量控制点设计易读的战术曲线。后者允许示意化，但不回写球员真实轨迹。

## 6. Agent 初稿与人工修订

Agent 的输入必须明确指定视频、范围、稳定球员、采用的 2D 版本、断点/缺口、该段实际关键画面，以及可选风格参考。

输出包括：建议阶段、讲解关键帧、图形类型和球场坐标控制点、起止帧、关联球员、路线进度点、依据帧与待人工核对事项。显示候选前严格验证范围、坐标、引用、来源版本及切镜关系。

用户能「全部采用」「只采用勾选对象」「放弃」，采用后所有对象直接进入同一个 2D 画布。默认只为所选时间段生成或补充；重跑保留人工对象及人工修改，删除/替换必须在候选差异里明确显示并由用户选择。

低质量数据时明确列出“这段无可靠位置/球场映射”，缩小可建议范围或只生成独立示意；不能拿 005 模板或旧视频路线填充新视频。超时、取消、API 不可用均保留原草稿，手工工具继续可用。

首版复用现有作业和 provider 边界，不以接入新模型 API 作为前置条件。增加候选格式版本时保留旧版本解码和校验，不能静默改变已有 Agent V2 的字段含义。

## 7. 前端精简清单

| 现有功能 | 新位置/处理 |
| --- | --- |
| Agent 初稿、人工工具、保存撤销 | 第三步常驻；对象选中后才显示对应属性 |
| 逐帧起止数字、显示时间、阶段时间 | 合并到一套秒级区间与对象时间条；帧号放辅助信息 |
| 冻结前/绘制中/绘制后多个输入 | 常用只露「停留时长」与「暂停讲解」；三段细调归入关键帧高级设置 |
| 阶段列表与讲解点列表 | 同一时间轴表达，关键帧卡展示所选项；不再两套列表控制同一时间 |
| 关联球员长下拉列表 | 用带缩略图的球员选择器；用途写成“跟随谁 / 路线属于谁”，未知身份明确提示 |
| 相机四角、近似镜头参数 | 移到第二步/高级投影修复；普通战术制作不要求理解相机 ID |
| 识别路线参考、动作审核、来源哈希 | 默认折叠到「高级与诊断」，按需要查看 |
| THY 示例与当前草稿切换 | 退出主制作栏，示例进入素材/帮助入口；保留数据读取兼容 |
| JSON、旧审核 HTML、原片下载 | 第四步「数据备份」折叠；MP4 成片是主交付 |
| 多处 2D 开关/底部 2D 抽屉 | 第三步以主画布为准，隐藏重复入口；其他步骤保留必要核对视图 |

本期精简默认界面，不物理删除用户数据或停止读取旧草稿。技术来源和质量提示仍能查到，不能为“清爽”而把不确定结果展示成已确认。

## 8. 现有实现与改造边界

| 模块 | 当前已存在 | 本期缺口 |
| --- | --- | --- |
| 身份与区间 | `trajectory.mjs` 的 `replaceIdentityRange`，`identity-continuation.mjs`、`identity-range-ui.jsx`、身份 Agent、画面状态 | 全片选人状态统一、可见缺口总结、易发现的续接/批改主流程；真实续接可靠性另验 |
| 球场与脚点 | `court.mjs` 的 `calibrationAt`、`buildCourtTrajectories`；人工点优先、脚点来源与镜头内映射 | 统一准备状态、区间质量提示、下游绑定明确派生版本 |
| 平滑 | `smoothCourtTrajectory` 已用于部分显示；`exportCourtData` 仍明确未应用显示平滑 | 把采用的平滑版本持久化并提供给战术；不只换页面呈现 |
| 战术数据 | `annotations.items`、空间类型、起止帧、样式、旋转删除、撤销保存 | 2D 原生编辑；关键帧对象和可见时间条；标准球场坐标的宽曲线路径 |
| 战术读取 | `tactical-overlay/geometry.mjs` 的 `observedPoint` 仍主要由图像点反算 | 通过统一接口读取所选的准备后 2D 轨迹，禁止偷偷回到原始抖动数据 |
| 当前画布 | `tactics-ui.mjs` 同步播放时优先视频模式，2D 偏向映射失败时的回退 | 明确 2D 主模式；2D 命中/拖点不依赖视频映射可用 |
| 编排与 MP4 | 四点曲线、剩余路线、近似镜头、冻结时间、同源预览下载 | 正式球场坐标 → 每帧视频映射适配；旧近似相机稿兼容 |

可复用的说明：[区间与身份](../track-identity-review.md)、[画面状态](../player-visibility.md)、[球场相对轨迹](../court-relative-trajectories.md)、[现有成片操作](../tactics-authored-production-guide.md)。

当前源码核查还有三项不能遗漏：身份 Agent 采用有限抽样和局部候选区间，一次成功不表示整片已续接；现有显示平滑没有充分保护身份断点及原图人工脚点；战术 Agent 当前压缩输入未带入 `courtTrajectory`，现有候选格式也没有 `style.pattern`，不能直接生成 UI 已支持的虚线和黄圆点。T1、T3、T7 分别补齐这些缺口。

### 8.1 统一数据与时间契约

```text
原始视频 / 检测观测
  → 已整理身份和脚点 + 每帧球场映射
  → CourtPreparation（原始2D、平滑版本、断点、人工锁点、来源摘要）
  → TacticsDocument（单一 annotations 列表 + 关键帧引用）
  → 2D 展示 / 逐帧视频投影
  → 既有 production 时间轴与 MP4 任务
```

执行期新增的契约名称固定如下，字段仍须按现有严格校验风格实现：

- `FrameRange = {startFrame, endFrameExclusive}`；跨模块统一使用此类型。调用现有采用“含结束帧”的身份接口时在适配层明确转换，不能直接混用。
- `CourtPreparation` 包含 `schemaVersion:1`、`revision`、`videoSha256`、依赖摘要、`frameMapping`、`mediaEndTime`、`rawByPlayer`、`preparedByPlayer`、`breaksByPlayer`、`smoothingPatches`。球场坐标单位米，原点、长宽复用 `COURT`；时间戳来自素材帧映射，`mediaEndTime` 与其中 `time` 使用同一素材时间基准。
- `dependencies` 至少覆盖跟踪版本、身份区间、可见状态、脚点/人工位置、标定、剪辑映射、平滑参数。摘要从实际内容计算，服务端复算，不能相信调用方自报版本。
- `CourtPoint` 保留 `frame,time,x,y,source` 与已有质量/估计标记；缺位置保持 `x/y:null`，不以 `(0,0)` 充当缺失。
- `TacticKeyframe = {id, frame, annotationIds, freezeEnabled, settleFrames, drawFrames, holdFrames}`。冻结帧计数遵循 production 的 `timebaseFps`，不是源视频帧率。多个对象可以共用关键帧。
- V2 中 `tacticKeyframes` 是暂停时刻的唯一来源；`annotation.anchorFrame` 只作绘制/证据参考，`phase.freezeFrame` 只留旧稿适配。新增讲解点不修改整个阶段的身份；阶段绑定比较 ID 与范围，不再因为一次讲解点调整让全部图形失效。旧暂停来源在迁移时合并去重，再由关键帧编译成 production cues。
- 外层 `TacticsDocument` 引入 V2，保存 `courtPreparation` 的不可变快照与 `tacticKeyframes`；`annotations.items` 仍是唯一图形集合。源 review、身份确认和战术编辑分别记录，不互相覆写。
- 新球场宽曲线沿用 annotation 的 `space:'court'` 和 `points` 作为唯一几何；`authoredPath.version:2` 区分标准球场路径、进度和米制样式，不再强制引用旧近似相机。旧 `authoredPath.version:1` 仍按原相机和视频参考点解释。
- V2 图形增加 `actionRange:FrameRange`，现有 `startFrame/endFrameExclusive` 继续表示可见范围。新建时联动一致，默认按动作区间更新进度；只改可见范围不重新缩放动作进度。两种范围都不跨越未处理切镜。
- 2D 图形投影使用当前源帧的 `courtToImage`；路线先在米制平面形成轮廓，再整体投影，脚圈同理。画面裁切在投影之后完成。
- 路线进度是显式、单调的 `progressFrames`，可由有效轨迹拟合或 Agent 建议，再由人工调整。V2 进度点用帧号引用证据，但点间插值按 `sourceFrameMapping.time` 计算；片尾边界用 `mediaEndTime` 结束哨兵，不按帧号差假定匀速。旧 V1 保持原有进度语义。折返/交叉路径不使用简单最近点匹配导致进度倒退。示意时间进度须标注其来源。
- 新 Agent 输出使用候选 V3：球场坐标图形、关键帧、依赖的准备版本、依据与缺口。旧 V1/V2 保持原校验和采用路径。
- 候选 V3 明确支持 `style.pattern = solid | dashed | dots`，与人工图形同一枚举；传球默认为黄色点线。不能在提示中要求一种样式、却让严格 schema 拒绝该样式。
- 图形另存 `meaning = current_action | later_observed_action | pass | screen | focus` 及依据帧；可引用已有动作关系和稳定球员。含义、样式与审核质量独立，虚线不代表低置信度。跑位默认 `displayMode:'remaining'`，冻结参考时显示完整未来路线；高级设置可改整段保留，不能由改显示时间暗中切换模式。

### 8.2 保存、失效与兼容

第二步使用独立服务存档，建议新增 `/api/court-preparation` 的读取/保存操作，仍校验 sample、variant、qa、视频哈希与 `expectedVersion`。战术保存和成片任务复用现有 `/api/tactics` 与 `/api/tactics-render/jobs`。

身份、标定或平滑改变后，列出受影响的球员/区间/对象；保留人工控制点。用户可选择“沿用人工示意并重新核对”或“对选中对象重新生成”，不能直接擦掉对象或悄悄套用新位置。改标题等无关内容不应令全部运动数据失效；精确源文档校验仍保留，不能删字段绕过旧来源检查。

读取旧稿先保持原样可打开；转为 V2 时生成可恢复副本并做严格迁移。已有 `space:'court'` 的普通对象可以验证后复用。旧视频像素对象/近似相机对象不自动宣称是标准米制坐标：保留旧渲染适配或让用户在有效参考帧显式转换。保存失败、版本冲突、模型失败都不能丢失草稿。

## 9. Agent 任务清单与依赖

**实施优先级：**先打通用户手动 3–5 秒的 2D→视频闭环，再完善自动初稿。不要先增加更多模型按钮。

```text
T0 契约与样例 → T1 身份体验 → T2 2D准备与持久化 → T3平滑
                                  ↓                 ↓
                       T4 2D区间编辑 → T5关键帧 → T6投影/成片
                                                    ↓
                                      T7 Agent初稿 → T8整合验收
```

T1 与 T2 可在 T0 契约确定后分别推进，T3 依赖 T2，T4 数据接线依赖 T2/T3。同一人负责 `workspace.mjs`/`tactics-ui.mjs` 的整合，避免并行改同一文件。每项先写能覆盖失败场景的测试，再实现，再独立审查；测试命令中的新文件由相应任务创建。

路径约定：未写完整前缀的 `.mjs`、`.jsx`、`.css` 文件均位于 `engineering/tools/player-review/`；Python 文件均位于 `engineering/scripts/`。所有验证命令从仓库根执行，`python` 使用已安装本项目 review 依赖的解释器。新增文件是执行任务的产物，不是目前已经存在的能力。

每项新增浏览器模块时，同步检查 `serve_player_review.py` 的静态模块允许列表、`/player-review` 别名与导入路径，补 `test_player_review_server.py` 的真实 HTTP 200/模块依赖验证；不能只让 Node 单测能导入、浏览器却报 404。

### T0 统一时间、版本和验收素材

**文件：**新增 `engineering/tools/player-review/tactics-time-range.mjs`、同名 `.test.mjs`；调整 `tactics-document.mjs` 及测试、`serve_player_review.py`/`local_video_library.py` 的素材时间元数据和对应服务测试；选定样例记录写入本计划对应交接。

**接口：**`rangeFromSeconds(frameMapping, {startSeconds,endSeconds,durationSeconds}) -> FrameRange`；`rangeToSeconds(frameMapping, range, durationSeconds) -> {startSeconds,endSeconds}`。拒绝无效映射和边界，映射保留来源。

- [ ] 添加 59.94 fps、非均匀 PTS、裁剪后时间、片尾、倒置/空区间回归。3–5 秒测试必须断言选中的都是 `3 <= time < 5`，不能只验算帧率乘积。
- [ ] 提供并绑定解码核实的 `mediaEndTime`：优先使用最后帧 PTS 与有效展示时长，容器时长仅在与解码时间一致时采用；保存到 clip、准备对象和文档快照。无法可靠取得片尾时明确不可用，不能静默用最后两帧间隔猜测 V2 成片终点。非片尾区间结束一律取 `frameMapping[endFrameExclusive].time`。
- [ ] 明确文档 V1→V2 与 Agent V1/V2/V3 的独立版本，建立旧稿只读/副本迁移策略和夹具。
- [ ] 选 005、当前导入 Warriors 视频、含移动镜头及身份断段的视频作为验收集，记录真实路径/哈希/测试范围，不引用已删除的 004。
- [ ] 运行 `node --test engineering/tools/player-review/tactics-time-range.test.mjs engineering/tools/player-review/tactics-document.test.mjs` 及受影响的素材/服务 Python 测试；全部通过后提交此项。

### T1 全片身份与区间纠正

**复用/修改：**`trajectory.mjs`、`identity-continuation.mjs`、`identity-range-ui.jsx`、`identity-ui.jsx`、`workspace.mjs`、`identity-timeline.mjs`、`engineering/scripts/identity_agent.py` 及其测试；测试复用 `range-edit.test.mjs`、`player-visibility.test.mjs`、`identity-continuation.test.mjs`、`identity-range-ui.test.mjs`。新增 `identity-coverage.mjs/.test.mjs`。

**接口：**沿用稳定 `entityId`；共享 `selectedEntityId`，不新造第二套球员编号。`FrameRange` 到旧身份接口的含尾边界转换放在唯一适配函数。

新增 `buildIdentityCoverage(session,frames) -> {byPlayer,unresolvedRanges,conflicts}` 和 `planContinuationWindows(coverage,{range,windowSeconds,overlapSeconds}) -> FrameRange[]`。按切镜和未解决区间建立可恢复任务队列，记录每窗状态与真实覆盖；窗口默认 4 秒、重叠 1 秒作为首轮参数，可按实测调整。重叠结果必须做身份冲突校验，不能最后一个结果无条件覆盖前一个。

- [ ] 测试同一球员 T 断开/换号、两队同球衣号、误绑定冲突、只纠正 3–5 秒、出画再返回及撤销。
- [ ] 整合全片身份时间条、缺口跳转、带图球员卡和「续接此球员」；跨帧/视图保持选择，明确缺测状态。
- [ ] 增加分窗续接、去重、取消后续跑和覆盖汇总；区分扫描过、建议已生成、已采用与人工核对，不能把“请求成功”显示成“全片身份完成”。无码球员始终允许手工区间关联。
- [ ] 检查区间外身份和人工位置未改变，批量采用不伪装成逐帧人工确认。
- [ ] 运行上述四个测试文件及 `identity-coverage.test.mjs` 的 `node --test`，以及 `python -m unittest discover -s engineering/scripts -p test_identity_agent.py`；用真实视频从头到尾核对至少一个会换 T 的球员，记录错误段；提交并独立审查。

### T2 建立统一 2D 准备结果

**文件：**新增 `court-preparation.mjs/.test.mjs`、`court-preparation-ui.mjs`；新增 `engineering/scripts/court_preparation_store.py` 及 `test_court_preparation_store.py`；修改 `court.mjs`、`workspace.mjs`、`serve_player_review.py`。

**接口：**`buildCourtPreparation({session,clip,maps}) -> CourtPreparation`；`courtPreparationStatus(preparation, dependencies) -> {current,affectedRanges,reasons}`；服务按不可变快照和乐观版本保存。

- [ ] 测试逐帧不同映射、人工脚点优先、无标定/出画空点、来源版本错误、保存重载及版本冲突。
- [ ] 把现有 `buildCourtTrajectories` 输出纳入统一准备对象；显示 2D 与视频同步球员和区间状态。
- [ ] 实现第二步保存与恢复；后续模块只通过准备对象读取采用的点，保留 raw 数据。
- [ ] 运行 `node --test engineering/tools/player-review/court-preparation.test.mjs engineering/tools/player-review/court.test.mjs` 和 `python -m unittest discover -s engineering/scripts -p test_court_preparation_store.py`；通过后提交并审查。

### T3 2D 平滑采用与对比

**文件：**新增 `court-smoothing.mjs/.test.mjs`；修改 `court-preparation.mjs`、`court-preparation-ui.mjs`，复用 `court.mjs` 的现有平滑基础。

**接口：**`previewCourtSmoothing(preparation,{entityIds,range,preset}) -> {candidate,diff,issues}`；`adoptCourtSmoothing(preparation,candidate) -> CourtPreparation`。

- [ ] 测试固定人物受小噪声抖动、真实急停折返、锁定点不移、缺口/切镜/身份边界不连接、区间外不变、撤销恢复和重新计算失效。锁点既包含人工 2D 点，也包含投影前的原图人工脚点，不能仅根据 `source:'projected'` 判断可平滑。
- [ ] 初版先复用已存在的保守局部平滑，按实际时间戳选窗口。默认轻度；具体窗口、异常门槛记入算法版本，通过验收片比较决定，不把调参结果写成通用精度保证。
- [ ] 原始与平滑叠加对比，显示修改范围、最大位移和未处理缺口；显式采用后形成版本，下游获得同一坐标。
- [ ] 运行 `node --test engineering/tools/player-review/court-smoothing.test.mjs engineering/tools/player-review/court-preparation.test.mjs`；保存平滑前后视频/2D 对照后提交并审查。

### T4 2D 主画布与 3–5 秒手绘

**文件：**新增 `tactics-court-editor.mjs/.test.mjs`、`tactics-timeline-ui.mjs/.test.mjs`；修改 `tactics-ui.mjs`、`tactics-annotations.mjs`、`tactics-route-editor.mjs`、`tactics.css`、`tactics-document.mjs`。

**接口：**`courtCanvasPoint(viewBox,pointer) -> {x,y}` 不依赖相机；`setAnnotationRange(document,id,range,{scope='linked'}) -> document` 原子校验范围、进度与讲解点关系，`scope` 可为 `linked`、`action`、`visibility`；图形创建沿用 `createAnnotation`。

- [ ] 测试无视频映射时仍能在 2D 拖点、选择已有图形自动显示范围、新建范围不改旧对象、删除/旋转/曲线/脚圈、重做撤销及 3–5 秒持久化。
- [ ] 默认主画布改为 2D，顶端秒级区间常驻；先实现第 4 节的手工流程和对象时间条。
- [ ] 2D 关联脚圈新增球场空间跟随模式；当前位置缺失时显示状态而不是沿用上一点。
- [ ] 运行 `node --test engineering/tools/player-review/tactics-court-editor.test.mjs engineering/tools/player-review/tactics-timeline-ui.test.mjs engineering/tools/player-review/tactics-annotations.test.mjs`；真实浏览器完成 3–5 秒画线/改线/删除/撤销/重载后提交并审查。

### T5 战术关键帧面板

**文件：**新增 `tactics-keyframes.mjs/.test.mjs`；修改时间轴 UI、文档验证、`tactics-playback.mjs`、`tactics-production.mjs` 及对应测试。

**接口：**`upsertTacticKeyframe(document,keyframe) -> document`；`removeTacticKeyframe(document,id) -> document`；`compileTacticKeyframes(document) -> productionCues`。

- [ ] 测试两个图形同一帧仅暂停一次、拖动/删除关键帧不删图形、不触发整个阶段来源失效、旧 anchor/phase 暂停不重复触发、空引用清理、越界提示、冻结增时但源范围不变。
- [ ] 增加常驻关键帧卡、缩略图、停留时间、暂停开关和前后跳转；自动生成与手工关键帧共用同一模型。
- [ ] 运行 `node --test engineering/tools/player-review/tactics-keyframes.test.mjs engineering/tools/player-review/tactics-playback.test.mjs engineering/tools/player-review/tactics-production.test.mjs`；录制一次暂停绘制后继续的实操，提交并审查。

### T6 标准 2D 战术投影与正式成片

**文件：**新增 `tactics-court-projection.mjs/.test.mjs`；修改 `tactics-authored-geometry.mjs`、`tactics-annotations.mjs`、`tactics-production.mjs`、`engineering/tools/tactical-overlay/geometry.mjs`、`engineering/tools/tactical-overlay/workbench-cli.mjs`、`engineering/scripts/tactics_render.py` 及相应测试。

**接口：**`projectCourtAnnotations(document,{frame,view}) -> scene`，`view` 为 `court` 或 `video`；共享球场几何、进度、可见区间和关键帧。`observedPoint` 通过准备版本适配读取，不再另算一份未平滑运动。

- [ ] 测试移动/缩放镜头、四点宽箭头透视、方向与脚圈、进度裁短、映射断点、2D/视频/导出的区间与几何一致、旧 V1 近似相机稿仍可渲染。
- [ ] V2 路线进度按源时间戳插值：添加非均匀 PTS 下 3–5 秒的时间中点为 50% 的回归，并核对片尾进度点与结束哨兵；2D、视频预览和成片共用此计算。V1 旧稿不静默换算。
- [ ] 生产编译使用 T0 的真实时间边界：补 VFR 最后一帧展示时长不同、单帧区间和非片尾区间回归。不得再用最后两帧 PTS 差推测 V2 区间时长；冻结输出帧数与源片尾边界分别校验。
- [ ] 有效注释区间内无投影时列出准确缺口并阻止把该结果作为完整成片交付；可以返回第二步修复。无图形的普通视频区间正常播放，无须虚构标定。
- [ ] 复用既有成片队列、取消、快照/版本校验和预览下载；输出冻结不修改原帧映射。两套坐标各保存一份并分别修改的方案禁止采用。
- [ ] 运行 `node --test engineering/tools/player-review/tactics-court-projection.test.mjs engineering/tools/player-review/tactics-production.test.mjs engineering/tools/tactical-overlay/workbench-cli.test.mjs` 与 `python -m unittest discover -s engineering/scripts -p test_tactics_render.py`；正式 API 导出一段含 3–5 秒标注的 MP4，完整解码并目视检查，提交审查。

### T7 Agent 根据准备好的 2D 生成初稿

**文件：**修改 `engineering/scripts/tactics_agent.py`、`test_tactics_agent.py`、`tactics-agent.mjs/.test.mjs`、`tactics-ui.mjs`，复用已有风格参考清单。

**接口：**沿用 `/api/tactics-agent/jobs`、取消和采用操作；新增 `scope:'range'` 与 `range:FrameRange`，绑定 sample/variant/qa/kind、文档摘要和采用的 `CourtPreparation` 摘要。候选 V3 严格绑定范围与原证据帧，采用函数保留已有版本分支。现有 `phase/play` 只作为兼容路径，不能把用户的 3–5 秒悄悄扩大为整阶段。

范围生成默认不改变已有阶段边界；跨阶段/切镜时按现有边界产生分段候选和图形引用。只有空草稿的整段初次生成可提出新阶段，采用时整体校验；选区不是自动新建阶段的命令。

- [ ] 测试选区外图形被拒、球员/准备版本错配、空证据、跨切镜、失败/取消保草稿、勾选采用、重跑不覆盖人工内容，以及旧候选兼容。
- [ ] 改造证据压缩路径，实际传入采用后的 2D 数据与原视频证据；输出少量可调控制点、关键帧、进度和样式，不输出逐帧噪声折线。验证一份真实候选能合法生成虚线箭头和黄色点线，不止在人工 UI 中支持它们。
- [ ] 生成状态清楚区分准备证据、模型分析、验证候选、等待采用；实际失败原因与重试入口可见。
- [ ] 运行 `node --test engineering/tools/player-review/tactics-agent.test.mjs` 与 `python -m unittest discover -s engineering/scripts -p test_tactics_agent.py`；至少一次真实新视频模型调用、选择采用、手工修改和 MP4 导出成功后提交审查。不能用手填候选冒充 Agent 成功。

### T8 精简收口与用户全流程验收

**文件：**修改 `workbench-shell.mjs`、`workspace.mjs`、`tactics.css`、操作说明；按现有脚本重建 `ui.bundle.mjs`。补充针对实际流程的浏览器验收记录，不为纯文案新增重复单测。

- [ ] 落实第 7 节的保留、折叠和移出主流程清单，去除重复导航与时间控件。
- [ ] 验证进入每步、返回、保存、刷新、Agent 不可用、视频重载、版本冲突时都有明确下一步；开发启动命令和进程保持方式写入说明，避免给用户打不开的 localhost 链接。
- [ ] 检查常用窗口下 2D 画布、范围、Agent、保存、下载按钮真实可见可点；视频 CSS 不遮挡按钮。保存完成截图。
- [ ] 运行本轮受影响测试及 `npm --prefix engineering/tools/player-review run build`；完整验收通过后选择性提交、同步 main，保留其他任务文件，并留下交接。涉及视频入库时才按视频规范运行对应验证和 LFS 检查。

## 10. 里程碑与最终验收表

不以按钮出现、测试全绿或“生成了一个 JSON”代替用户流程完成。

| 里程碑 | 必须交付的可见结果 |
| --- | --- |
| M1，T0–T3 | 新视频选中同一球员全片查看，区间纠错；原始/平滑 2D 对比可保存重载 |
| M2，T4–T6 | 用户独立为 3–5 秒手绘路线和关键帧，投回实拍并导出同一成片 |
| M3，T7–T8 | Agent 在同一画布生成可编辑初稿，人工补全、修改、预览、下载全部可用 |

最终逐项验收，失败项不得标完成：

- [ ] 同一球员换 T 编号后不换成另一个人；号码识别清楚时能用于核对但不越过冲突检查。
- [ ] 身份及位置修正只影响选中区间；出画有状态，无虚构框/2D 点。
- [ ] 每帧使用对应球场映射；移动镜头下静止球员不因为镜头移动而跑遍 2D。
- [ ] 平滑结果与原始观测可比较、可撤回、可重载；人工锁点与停顿保持。
- [ ] 新视频的 Agent、2D 画布和视频投影确实使用同一个采用后版本。
- [ ] 3–5 秒标注在 3 秒前不出现，到 5 秒退出；可在时间条修改范围。
- [ ] 暂停绘制清楚可读，继续后只保留未走完路线；目的地与箭头方向稳定。
- [ ] 关键帧与图形可独立删除/撤销，多个对象共用一次暂停。
- [ ] 路线、虚线箭头、黄圆点传球、挡拆旋转删除、重点球员圈均可人工完成。
- [ ] Agent 失败也能做完整人工流程；采用后拖动控制点、保存重载不退回旧候选。
- [ ] 旧草稿可打开，新迁移可恢复，原始人工审核内容未被平滑或战术改写。
- [ ] 普通窗口下主要控件可见可点；不靠解释专业相机参数才能做基础路线。
- [ ] 成片由正式工作台 API 生成；预览/下载同一产物，完整解码正常；关键帧截图和最终短视频可直接交给用户。

**Review Focus：**T0 的非均匀时间戳与片尾；T1 的同号/身份冲突；T3 的折返与人工锁点；T5 的共帧暂停与删除语义；T6/T7 的缺映射、来源更新及人工内容保护。各项必须由独立审查者检查对应回归和真实证据。

## 11. 可直接交给执行 Agent 的指令

```text
请按 engineering/docs/plans/2026-10-05-2d-first-tactics-workbench-plan.md 推进。
先读取仓库 AGENTS.md、状态和本计划，检查 main 与本地已有修改，再安全同步。
逐项完成 T0–T8；优先交付 M1 和手工 3–5 秒的 M2，不先增加新的模型或高级面板。
保留原始观测、人工身份/位置、现有草稿和旧版成片兼容。
以采用后的 2D 轨迹为战术输入，2D/视频/导出共用一套图形和时间模型。
每项提供修改文件、回归结果、实际界面或视频证据，再由独立 reviewer 复核。
遇到精度缺口就记录具体球员/区间并提供人工修正；不要捏造连续跟踪或标定。
不要用独立脚本成片、手填模型候选或固定 005 模板冒充工作台全流程完成。
同一模块避免并发写；仅提交当前任务文件，不创建分支/PR，不强推。
在交接中更新任务勾选、已完成里程碑、未解决项与下一项，不能把计划当完成报告。
```

本计划的提议参数可在实际验收中调整，但身份连续、原始数据保留、2D 单一坐标、区间明确、人工可改、预览导出一致这六项不能被弱化。
