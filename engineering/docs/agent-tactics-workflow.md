# Agent 战术工作流程 v1

日期：2026-10-06。**这是待实施的运行合同，不代表下列工具已可调用。** 实施顺序见[最终计划](plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)，字段与错误见[工具合同](specs/agent-tactics-tools-v1.md)。本文件是默认执行顺序与策略的唯一维护入口。

## 1. Agent 的任务

把给定真实视频的指定区间制作成有证据、可编辑的多人战术讲解。输出不只关注持球人：要说明参与跑位、掩护、接应、拉开空间和直接相关防守的球员。主要由模型和工具自动完成，人工只接无法自动解决的具体异常区间。

正常调用只需要资产引用、源帧区间、制作目标。姓名和球衣号码可未知；用户无需提供球员坐标、先打开 2D 球场或逐个确认模型候选。保护当前工作台战术布局和编辑行为，结果保存为新的派生文档。

### 初始任务示例

以下是计划实现后的有效 JSON 形状；资产 ID 在执行时解析，示例不是已经提交的任务。

```json
{
  "schemaVersion": "1.0",
  "requestId": "example-request-001",
  "idempotencyKey": "example-pacers-richer-v1",
  "range": {"startFrame": 570, "endFrameExclusive": 870},
  "policyRef": "tactics-default-v1",
  "args": {
    "assetRef": "registered-pacers-sample",
    "goal": "解释这一段真实配合，覆盖持球、无球和直接参与防守的球员",
    "profile": "richer_players_v1",
    "output": {"video": true, "editableDocument": true, "fps": 30},
    "geometryRequirement": "auto",
    "allowPartial": true
  }
}
```

零基半开区间 [570,870) 指所登记视频资产准确解码后的第 570 至 869 帧；采样不能把结束边界当成已读取帧。资产若已剪辑或重采样，其 sourceFrameMapping.sourceFrame 是原始来源标签，未必等于本地帧索引，adapter 必须转换，不能直接当数组下标。时间以准确 PTS 与映射为准，不用名义 FPS 推算替代。

## 2. 默认策略 tactics-default-v1

| 参数 | 初始默认值 | 含义 |
| --- | --- | --- |
| maxModelCalls | 6 | 视觉／语义 provider 调用上限；重试、独立视觉复核也计入，不把工具拆分用来绕过预算。跟踪模型另记录推理次数与时间。 |
| maxRepairPasses | 1 | 质量检查后的模型修正最多一轮；仍不通过就给部分结果或异常包。 |
| maxWallSeconds | 600 | 接受任务起至终态的墙钟上限，包含排队；这是运行预算，不是速度承诺。到期终止可取消阶段并拒绝迟到提交。 |
| apiConcurrency | 2 | 同一 run 最多两个独立 API 请求；还需服从 provider 限流与全局配额。后续通过 1/2/3 对照调优。 |
| gpuConcurrency | 1 | 同一设备最多一个重推理任务；优先一批多查询共享特征，不给十人重复启动十份完整模型。 |
| maxCostUsd | null | 不声明已测成本；如用户提供金额上限而 provider 无法可靠计费／估算，返回 budget_unmeasurable。 |
| maxRoutesPerCue | 3 | 同屏主要路线硬上限；沿真实动作分段后增加覆盖。 |
| spotlightSoftLimit | 6 | 阅读性建议；超过要检查遮挡和密度，不能通过删球员清单解决。 |
| defaultPauseSeconds | 1.5 | 有效暂停讲解的默认长度，服从当前引擎合法关键帧与时间合同。 |
| tapirQueryToleranceAt720p | 8 | 查询帧自洽初始门限，像素尺度按源图高度 / 720 换算；不是跟踪准确率阈值。 |

优先复用仍有效的证据。缓存命中也必须核对视频 SHA、帧映射、预处理、模型及策略版本；不能混用另一视频、另一标定或上一版身份结果。

## 3. 标准步骤

### Step 0：提交、固定来源与能力

调用 submit_workflow，然后由 runner 调用 inspect_clip。固定 sourceRef、可用的 docRef、range、policyRef 与工具版本，保存不可变快照；查询准确源帧、尺寸、PTS 与现有轨迹。没有合法 tracking/review 时 docRef 暂为 null；先在 Step 1 建立实际派生 review 和来源摘要，再由当前原生工厂生成合法文档，不能让模型自由编造 schema 或把缺失摘要传入 save/render。

读取 capabilities，并预检实际推理 Python、模型／权重、GPU、Node、编码器和 provider 配置；沿用已核实运行环境，不能继续使用不存在的历史路径。缺少工具时返回明确不可用和所缺配置；不能照着本文件伪称已调用。保存原草稿摘要、人工锁和受保护模块基线。所有输出使用 run 自己的目录及独立 TacticalWorkbench store。

### Step 1：建立球员证据

调用 prepare_players。先复用合法检测／跟踪结果，建立画面内球员清单、匿名 ID、团队候选、身份连通与位置状态；号码识别和队伍识别作为证据增强项。跟踪编号稳定不自动证明始终是同一真人。若建立或改变了用于渲染的派生 review，生成新的 sourceRef/snapshotId 和合法基线文档，保留原快照；后续全部绑定到这个版本，不静默修改旧 sourceRef。

只对战术需要或身份冲突的短区间进行修复。已有可靠脚点可供原生人物圈跟随；身体点候选、估计点、不可见状态分开保存。不要把整段补平、再声称所有帧都有观测。

TAPIR 可用时：自动选可见且身份较明确的源帧作为种子；优先少量稳定身体区域；首版固定官方已验证版本、256×256 方形输入，保存 x/y 独立缩放。先查查询帧自洽，再查遮挡、身份排他、前后时间一致性与关键帧归属。可见分数 >0.5 只是候选筛选条件；失败点不能用于自动接受。

官方试验版本及权重摘要沿用[实测记录](../../research/vision/tapir-direct-video-20261006/README.md)。若未来变更输入形状或模型版本，先重做适配检查。没有安全原生绑定能力时，TAPIR 只提供诊断／修复证据，不直接进入跟随渲染。

### Step 2：盘点阶段与实际参与者

调用 analyze_play。先形成独立于图形生成的阶段清单与 participants，每人写角色、依据帧、可见区间、位置质量、实际动作及不确定点。把“画面出现”与“当前阶段参与战术”区分开。

输入不足时可以准确抽取补充帧，但仍计入预算。球员姓名不是前置。不能根据常见战术模板添加视频中未发生的跑位、防守轮转或传球。

在建立图形前冻结参与者清单。独立 reviewer 可以纠正分析，但必须保存理由和新的 analysisRevision，不能只删掉未被标注的人。

### Step 3：按展示意图选择几何

逐个 annotation intent 判定，而不是全片强制同一模式：

- reference_frame：在可靠暂停帧标注，可直接使用图像坐标。
- fixed_interval：明确固定在图像坐标的图形，不声称贴地。
- declared_player_follow：当前合法 P 轨迹上的人物圈跟随。
- court_projection：地面路线、相机运动下贴地图形及真实空间关系，调用 prepare_geometry。

把多个时刻的球员位置画到同一暂停帧时，需要相机对齐／几何证据，或独立证明该短段相机误差满足要求；不能简单串起屏幕位置冒充球场跑位。

几何不过时，仅在 allowPartial=true 且 geometryRequirement 不为 required 的任务中提供有证据的暂停讲解结果。未满足的请求写入 unmetRequirements；要求贴地但无法完成时返回 needs_attention。

### Step 4：生成更丰富的球员标注

调用 build_player_annotations，将已接受的角色／动作编译为原生 route、screen、spotlight。不要向原生文档加入 text、role、defender、tapir 等未知字段。

移动者使用真实动作路线，掩护者使用掩护标记，静态接应与空间球员用位置圈，相关防守者同样安排提示。对有证据的多人配合，不能只生成一个球员的一条箭头就结束。

实线表示当前完整动作；虚线只表示后续已发生的真实动作，显式设置 later_observed_action，不能沿用 createManualAnnotation 对 dashed 的默认 pass 语义。生成时一次创建正确 agent origin；不要调用会标记 human_modified 的编辑函数来伪装模型修改。

沿用现有箭头、暂停、未完成路线播放及淡出行为。角色文字和一般防守关系写入配套说明／annotation-map，不承诺当前 MP4 显示姓名。

### Step 5：覆盖检查与投影检查

先调用 check_participant_coverage，再调用 check_projection。检查者读取源证据和冻结的参与者清单，不以生成器自报“已覆盖”为准。

逐阶段逐人检查 annotationIds、正确绑定、实际可见帧及隐藏原因。凡是明确可见且可定位的参与者，没有有效图形就是 missing，不能算 unavailable。图形全程隐藏、在画面外或绑定到别人都不算 covered。

几何、原生 schema、来源冲突、切镜、跳点和人物圈隐藏分别输出。court_player_foot 需外层排除策略不允许的 estimated 来源。route remaining 只是按动作进度裁短，不是人物跟踪。

### Step 6：真实画面预览与独立复核

调用 preview_projection，使用准确源帧和生产 SVG 合成，覆盖每阶段关键帧、动作边界、遮挡前后及检测缺口。检查参与者遗漏、错人、路线依据、圆圈偏离、贴地错位与可读性；不能只看抽象 JSON。

独立 reviewer 使用新的审查上下文和明确的判定表，可以是单独 provider 调用或测试验收 reviewer，不依赖另一个常驻 Agent。预览调用与审查调用分别记录，视觉调用计入预算。

可修复时最多一次局部修正，重新执行受影响的覆盖、投影与预览检查。通过后机器策略自动采用；正常流程不等待用户点击。

### Step 7：保存、渲染、交付

按顺序 commit_candidate → render_projected_video。采用与保存是两件事；检查 expectedVersion 和文档 digest，保存后用返回的准确版本渲染。两步失败分别记录，不把已有候选当成已导出的成片。

渲染完成后完整解码，核对尺寸、帧数、时间和结果摘要；现有 TacticsRenderer 是静音输出，应在结果中注明 audioMode。视频输入保留原文件与音频，不因渲染静音而改写源视频。需要保留音频的任务必须报告能力缺口，不能无声替换需求。

返回成片、可编辑文档、参与者覆盖矩阵、质量报告、耗时与 manifest。未知姓名、未完成贴地要求或不可见区间要可追溯，不在视频里虚构解释。

## 4. 失败后的动作

| 情况 | Agent 应做什么 |
| --- | --- |
| source_mismatch / version_conflict | 停止提交；重新读取快照并说明冲突，不 force 保存。 |
| tracking_gap / identity_conflict | 仅对具体区间补证据或重连；一轮后仍无解则返回 unknown 与候选证据。 |
| capability_unavailable | 选择已有合法显示方式；无法满足硬要求则 needs_attention，不假装工具已支持。 |
| geometry_unreliable | 禁止贴地图形自动采用；允许时提供明确的暂停讲解部分结果。 |
| coverage_incomplete | 对已有依据但未标注的参与者补图形；不能从参与者清单删除。 |
| budget_exhausted | 停止新调用，交付已验证部分与未完成阶段；不可测成本不写 0。 |
| cancelled | 丢弃旧 generation token 的迟到输出，保留审计记录；明确 resume 才启动新尝试。 |
| renderer_failed | 保留已接受的文档与预览；重试渲染，未得到可解码 MP4 前不宣布视频交付完成。 |

## 5. 可复跑与交付检查

三种操作分开：读取已保存的结果不重新推理；用已保存文档重新渲染不重新分析；重跑模型是新 attempt，并不承诺逐字或逐像素一致。manifest 必须说明选择了哪一种。

交付前确认：原草稿未覆盖；来源和版本一致；实际参与者有标注或具体不可用依据；不含无依据路线；独立复核通过；MP4 完整解码通过；状态与文件一致。只完成一部分时用 partial，不能称全部完成。
