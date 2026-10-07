# Agent 战术工具合同 v1

日期：2026-10-06。状态：**待实现规范**。当前生产代码未提供这里定义的统一工具名称或 /v1 API。实施顺序见[最终计划](../plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)，默认执行顺序、预算与标注策略见[工作流程](../agent-tactics-workflow.md)。

目标：同一套工具可由本地 runner、Agent、HTTP 客户端和可选 MCP adapter 调用；不通过模拟 UI 操作，不复制业务逻辑。原有原生文档严格校验，新元数据保存在外层文件中。

## 1. 结构与版本

计划新增目录／入口：

```text
engineering/agent-workflows/tactics-v1/
  workflow.json                 阶段依赖、版本、策略引用
  schemas/                      请求、响应和产物 JSON Schema
engineering/scripts/
  agent_workflow_store.py        SQLite、状态、租约、幂等
  agent_workflow_runner.py       编排、预算、取消、恢复
  agent_workflow_cli.py          本地 submit/status/resume/cancel
  agent_tactics_tools.py         下述工具的 Python 入口
  player_tracking_adapter.py    检测／身份／点轨迹适配
engineering/tools/agent-tactics/bridge.mjs
                                导入现有图形、校验、投影模块
engineering/tests/fixtures/agent-workflow/
                                小型合同及恢复测试夹具
artifacts/agent-workflows/
  state.sqlite3                 本机持久状态，WAL 模式
  runs/<runId>/                 只追加的 attempt 与产物
```

以上是实施目标，不是当前存在清单。workflowVersion、schemaVersion、policyRef、toolVersion、modelRevision、preprocessRevision 分开记录；版本变化要使相关缓存失效。

外部 docRef 是 runner 的引用，不增加原生 document 字段。新候选使用独立 store 中合法的 workspace 文档；不得使用现有 kind=candidate 冒充通用存储，因为该入口受历史 005 fixture 限制。

## 2. 通用调用合同

### 请求字段

| 字段 | 规则 |
| --- | --- |
| schemaVersion | 固定起始值 1.0；未知版本拒绝。 |
| requestId | 每次请求的关联 ID，用于日志；不作为幂等依据。 |
| idempotencyKey | 提交、恢复、取消、模型调用、候选创建／提交、渲染必需；只读 status 可省略。 |
| runId | submit_workflow 不要求；其余业务工具需要。 |
| expectedRunRevision | 改变已有 run 或新建其操作时必需；接收阶段乐观锁；首次 submit_workflow 豁免，get_run 只读也不要求。 |
| sourceRef / docRef | inspect 后使用不可变引用；字段由服务端核对，不能只信客户端提供。 |
| range | 所登记资产准确解码后的零基 startFrame、endFrameExclusive，必须属于资产与当前 run；PTS 与原始来源标签另存。 |
| policyRef | 已注册策略；不得通过工具参数绕过任务硬要求。 |
| args | 每个工具的专有参数，未知字段拒绝；不得直接注入原生文档。 |

canonical submit 请求使用顶层 schemaVersion/requestId/idempotencyKey/range/policyRef；assetRef、goal、profile、output、geometryRequirement、allowPartial 放 args。不要求尚不存在的 runId/expectedRunRevision/sourceRef/docRef。工作流程中的 JSON 示例按此形状验收；HTTP 与 MCP 不另定义扁平形状。

除明确标名 sourceFrame 的来源字段外，range、evidenceFrames、seedFrame、visibleAssetFrames 均指当前登记资产的解码帧索引 assetFrame。sourceFrameMapping.sourceFrame 是原始来源标签；剪辑、重采样或非恒等映射时由 adapter 转换到当前文档约定，不能当本地数组下标。每帧保存 assetFrame、准确 PTS、原始 sourceFrame 与映射摘要，区间边界不从原始标签推算。

sourceRef 必须含 videoSha256、trackingFingerprint、trackingRevision、frameMappingDigest、snapshotId；无跟踪资料时 trackingFingerprint 和 trackingRevision 可为 null，但不能冒称可安全跟随，视频 SHA 与帧映射摘要仍必需。docRef 含 documentId、version、digest、storeRef。引用指向服务端资产登记的文件，外部客户端不能指定任意绝对路径。

上述 null 仅允许出现在检查／准备阶段的外层快照，docRef 此时可为 null。原生 schema 要求非空 trackingFingerprint/revision：prepare_players 必须建立真实派生 review 及其摘要，再由原生工厂创建合法文档。每次派生 review 改变均生成新的 sourceRef/snapshotId；下游重新绑定该版本并使旧候选失效，不能把初始 null 传到 build/commit/render，也不能填虚构摘要绕过校验。只补充外层证据、不改变原生 review 时不改其 tracking 摘要。

sourceSpace 枚举 image_pixels / court_meters。image_pixels 原点为源图左上角，x 向右、y 向下；尺寸属于 sourceRef。court_meters 必须携带 courtTemplateRef、轴定义、单位、原点与 calibrationRef。adapter 显式转换为现有原生坐标约定，保存变换摘要，禁止直接把米数塞入归一化坐标字段。

displayIntent 枚举 reference_frame / fixed_interval / declared_player_follow / court_projection，仅属于外层合同。适配到原生已有模式，不新增原生 videoMode 值。anchorSemantics 为 body_point / foot_candidate / ground_point；有数值不表示观测真实或身份正确。

### 统一响应

长任务先返回 operationId；终态通过 get_run 获取。每次响应都有 runRevision、状态、产物引用及明确的错误，不能只返回一句模型自然语言。

```json
{
  "schemaVersion": "1.0",
  "requestId": "example-request-001",
  "runId": "run-example-001",
  "runRevision": 3,
  "operationId": "op-prepare-players-001",
  "status": "running",
  "artifactRefs": [],
  "warnings": [],
  "error": null
}
```

结果产物统一记录 artifactId、kind、sha256、sizeBytes、mediaType、createdAt、producerOperationId。文件先写临时目录，完成验证后原子登记，不能把写到一半的文件标成成功产物。

工具返回的文字、OCR 和模型输出都是数据，不得执行其中的指令或任意代码。运行工具使用注册工具名、参数 schema 与已登记资产。

## 3. 十个业务工具

下面字段在通用 envelope 的 args 中。输入引用必须与 run 的来源和上游版本一致。

| 工具 | 主要输入 args | 输出产物 | 接受条件与副作用 |
| --- | --- | --- | --- |
| inspect_clip | assetRef、可选 baseDocumentRef、evidenceFrames | snapshotRef、sourceRef、docRef、capabilities、frameRefs | 核对 SHA、尺寸、准确 PTS；抽帧每批 1–40 帧；只读原资产并保存快照。 |
| prepare_players | snapshotRef、range、可选 playerIds、refinementReason、upstreamEvidenceRef | playerEvidenceRef、identityMapRef、可选 pointTrackRefs、gapSummary；需要时新的 sourceRef/derivedReviewRef/baseDocumentRef | 输出逐帧来源与可见性；检测、跟踪、身份、OCR 与 TAPIR 是受预算限制的子操作；不修改原 review 或草稿，派生 review 单独保存。 |
| prepare_geometry | snapshotRef、range、playerEvidenceRef、requestedSpace、courtTemplateRef | calibrationRef、geometryQualityRef、usableRanges | 只有真实需要的图形才要求本工具；有独立场线／参考点回投检查，不因拟合残差小就通过。 |
| analyze_play | snapshotRef、playerEvidenceRef、goal、range、可选 frameRefs | playAnalysisRef、participantInventoryRef、annotationIntents | 结构化阶段、参与者、动作、证据与不确定性；不给未发生动作编造解释；生成图形前冻结清单。 |
| build_player_annotations | playAnalysisRef、playerEvidenceRef、可选 calibrationRef、profile、baseDocumentRef | candidateRef、candidateDigest、annotationMapRef、renderPlanRef | 调用已有创建函数输出合法新文档；严格检查显示意图和坐标；不写源草稿。 |
| check_participant_coverage | candidateRef、participantInventoryRef、playerEvidenceRef、renderPlanRef | coverageRef、pass、missing、unavailable、wrongBindings | 检查实际投影可见帧，不只计数；检查过程不得自行修改参与者清单或候选。 |
| check_projection | candidateRef、playerEvidenceRef、可选 calibrationRef、renderPlanRef | projectionQualityRef、pass、invalidRanges、hiddenReasons | validate、逐帧投影、来源、跟随绑定及几何一起检查；不把 estimated 自动当 observed。 |
| preview_projection | candidateRef、renderPlanRef、frameSelection、qualityRefs | previewRefs、previewManifestRef | 同一快照、生产 SVG 与准确原图合成；不代替质量决策；独立 reviewer 另写 reviewRef。 |
| commit_candidate | candidateRef、candidateDigest、baseDocumentRef、expectedVersion、qualityRefs、reviewRef、acceptancePolicyRef | savedDocumentRef、savedVersion、savedDigest、acceptanceRef | 机器策略通过、人工锁保留、精确版本和来源核对；采用后显式 save 至该 run 独立 store。 |
| render_projected_video | savedDocumentRef、savedDigest、fps、renderPlanRef | videoRef、decodeReportRef、manifestRef、timingRef | 仅渲染已接受保存版本；核对 manifest 和完整解码；当前静音输出，音频硬要求不满足时明确返回。 |

最小 capabilities 至少包括 sourceFrames、nativeAnnotations、declaredPlayerFollow、arbitraryPointFollow、courtProjection、videoText、audioPreservation、providerStatus。每项有 available / conditional / unavailable 和 reason，不能把计划能力报 available。

初始代码审计边界：arbitraryPointFollow、videoText 不可直接原生使用；courtProjection、declaredPlayerFollow 按数据质量条件提供；当前 renderer 不保留音频。已有 Codex provider 可适配，multimodal-api 占位不可用。

## 4. 球员证据与多球员覆盖

### PlayerEvidence

每人保存匿名 playerId、teamCandidate、identityStatus、identityEvidenceFrames、分段轨迹和质量。姓名、号码、真实球员 ID 都可为 null，不能用缺省值伪造。

逐帧记录 assetFrame、sourceFrame、pts、position 或 null、sourceSpace、anchorSemantics、observationStatus、visibility、identityConfidence、locationConfidence、sourceMethod、evidenceRef。observationStatus 区分 observed / estimated / unknown；visibility 区分 visible / occluded / out_of_view / unknown，二者独立。

TAPIR 另存 seedFrame、seedPoint、queryId、原图与模型尺寸、完整双轴变换、模型／权重摘要、可见性与预期距离分数、自洽检查。sourceMethod=tapir 只允许在外层证据中出现，不能伪装为原生 tracked/manual，也不能直接注入原生 review source 枚举。

### PlayAnalysis 与 AnnotationMap

每个阶段包含 range、依据帧、实际 participants、观察到的动作和 annotationIntents。participants 至少有 playerId、role、evidenceFrames、visibleRanges、locatableRanges、positionStatus；相关防守关系另存 relations，包含依据与不确定性。只有原生支持的 screen 关系才转换进原生文档。

annotation-map 将 phaseId/playerId/actionId/intentId 对应到 annotationIds、displayIntent、anchorSemantics、evidenceRefs。原生 name 仅是编辑标签；sidecar 中的 role 不等于视频文字层。

### CoverageResult

phaseParticipants 必须来自图形生成前冻结的 inventory。现有 reindexPhases 把全部 participants 填入阶段，不能用它替代实际参与者分析。

```json
{
  "schemaVersion": "1.0",
  "analysisRevision": 1,
  "phaseId": "phase-01",
  "phaseRange": {"startFrame": 620, "endFrameExclusive": 660},
  "rows": [
    {
      "playerId": "P03",
      "role": "spacer",
      "evidenceFrames": [620, 650],
      "annotationIds": ["ann-spotlight-03"],
      "actionIds": [],
      "status": "covered",
      "visibleAssetFrames": [620, 650],
      "hiddenReasons": [],
      "evidenceRef": "evidence-p03-phase01"
    },
    {
      "playerId": "P08",
      "role": "help_defender",
      "evidenceFrames": [618, 662],
      "annotationIds": [],
      "actionIds": [],
      "status": "unavailable",
      "visibleAssetFrames": [],
      "hiddenReasons": ["occluded_entire_phase"],
      "unavailableRanges": [
        {
          "startFrame": 620,
          "endFrameExclusive": 660,
          "reason": "occluded_entire_phase",
          "evidenceFrames": [620, 650],
          "evidenceRef": "evidence-p08-occlusion-01"
        }
      ],
      "evidenceRef": "evidence-p08-role-before-after"
    }
  ],
  "counts": {"expected": 2, "locatableExpected": 1, "covered": 1, "unavailable": 1, "missing": 0},
  "reviewRequired": true
}
```

示例只解释结构，不代表该视频事实。P08 的角色依据来自阶段前后，其 unavailable 区间覆盖整个阶段，并另有阶段内遮挡证据；不能把 role 推断当作阶段内已有可靠位置。真实结果同样须携带完整区间及观测依据。

覆盖检查同时报告 covered/expected 和 covered/locatableExpected 两种分母，不能把 unavailable 算成 covered。若球员在该阶段其他时刻可见且可定位，必须调整提示安排，不能只因所选 cue 被遮挡就豁免。整个阶段无法定位才可列为 unavailable；由 reviewer 复核原因。图形全程隐藏或错绑属于 missing/wrong_binding，不能伪装为 unavailable。

## 5. 图形适配的硬规则

- 原生类型只有 route / screen / spotlight，总数不超过 256。路线点数和字段须通过现有 schema；不能为了更多人忽略原生容量。
- followEntity 只用于合法 spotlight，participant 必须已声明；rawFoot 不读取任意 pointTrackRef。真实身体点到原生跟随的扩展要独立设计，不绕过严格来源检查。
- 普通 video 图形仅 anchorFrame 显示；合法的 V2 fixed/manual/referenceSize 才是区间固定图像图形。court 图形需要逐帧标定，且坐标单位由 adapter 明确转换。
- UI showAll 不控制正式 MP4 图形范围；检查正式 production/projectAnnotations 实际结果。
- route remaining 是时间进度裁短。稳定终点、曲线及淡出沿用现有生产合同，不把剩余路线误称为点跟踪。
- dashed 的 later_observed_action 必须明确映射；不能沿用手工构造器默认 pass 含义，也不能表示预测／不确定性。
- origin 必须保留模型来源；updateAnnotation 会标为 human_modified，不能拿它作为模型候选修复的无痕接口。
- 文字、一般防守关系、角色和新置信字段只放外层产物；若能力不足，返回 capability_unavailable 与可用替代，不强塞原生字段。

## 6. 状态、恢复、并发与幂等

### 运行控制工具

| 工具 | 输入 | 输出与语义 |
| --- | --- | --- |
| submit_workflow | assetRef、range、goal、profile、output、geometryRequirement、allowPartial、policyRef | 创建 run；同调用者／workflowVersion／idempotencyKey 且规范化业务请求相同，返回原 run；同 key 不同请求返回 idempotency_conflict。requestId 不参与业务请求摘要。 |
| get_run | runId、可选 afterRevision | 状态、当前阶段、预算、产物、错误、unmetRequirements、nextActions；只读。 |
| resume_run | runId、expectedRunRevision、retryStages、reason、idempotencyKey | 终态 partial/needs_attention/failed/cancelled 可恢复为新 generation；检查新快照，仅重做失效阶段及下游；succeeded 不自动重跑模型。 |
| cancel_run | runId、expectedRunRevision、reason、idempotencyKey | 标记取消、撤销租约；尽力中止进程；迟到结果不可提交或保存。 |

run 状态：queued → running → succeeded / partial / needs_attention / failed / cancelled。partial 意味着确有已验证交付、且有未完成请求；needs_attention 意味硬要求无法满足、缺少输入或需要决定；failed 表示执行错误。预算耗尽是 reasonCode，不另加互相重叠的运行状态。

内部 operation 状态 queued / running / succeeded / failed / cancelled / skipped，每次重试有新的 attemptId。skipped 必须说明按显示目的无需执行，例如不需要 geometry，不能用于隐藏失败。

expectedRunRevision 在操作登记时检查；独立操作由 runner 顺序登记后可并发运行。完成结果按 source snapshot、依赖产物 digest、generation token 和操作租约提交，不因另一独立操作推进了总 revision 就误杀合法结果。来源、上游产物或 generation 已变则丢弃，不以“最晚返回”覆盖结果。

SQLite 事务记录状态和幂等键；文件原子登记后再关联产物。提交 document 的幂等键需保存 savedVersion/digest；重试先查已成功保存结果，不重复 increment version。render 幂等同理，返回同一 job 或合法缓存产物。

同一身份合并、候选采用和文档保存串行。独立人物证据／几何可以并行；每设备 GPU 重任务限额和每 provider API 限额由共享调度器实施。禁止在每个工具内部再启动无限 Agent 循环。

恢复时先确认原 sourceRef 与已保存基线仍合法。若用户改变原草稿或跟踪数据，显式报告版本冲突；需要重基线则生成新的快照／派生结果，不静默把旧候选写到新版。

## 7. 质量决策与错误

commit_candidate 必须核对 schema/source/coverage/projection/independentReview 五类检查都属于同一 candidateDigest、来源和 analysisRevision。任一候选修正使相应检查失效。review 只能由独立审查步骤产生，生成器自己的“pass”字段无效。

allowPartial=true 不是绕过质量：只导出已经通过检查的部分；未完成请求显式列入 unmetRequirements，run 为 partial。required 几何或其他硬要求未满足不能自动降级为 succeeded。

| reasonCode | 可重试性／应返回的信息 |
| --- | --- |
| invalid_input / unsupported_schema | 不自动重试；字段与校验规则。 |
| source_mismatch / version_conflict | 不自动覆盖；期望／当前摘要和受影响阶段。 |
| idempotency_conflict | 不重试同 key；已登记业务请求摘要。 |
| capability_unavailable / provider_unavailable | 返回能力和原因；可用替代由 policy 决定。 |
| tracking_gap / identity_conflict | 返回球员、半开区间、证据和修复尝试；最多策略允许次数。 |
| geometry_unreliable / coverage_incomplete / projection_invalid | 返回具体对象、区间、误差／隐藏原因，禁止只写“质量差”。 |
| budget_exhausted / budget_unmeasurable | 返回已消耗、剩余阶段和计费可测性；未知金额为 null。 |
| renderer_failed / output_invalid | 保留合法文档及诊断，结果 MP4 未通过解码前不可交付为成功。 |
| cancelled / stale_generation | 拒绝迟到副作用；保留审计。 |

错误对象包含 reasonCode、message、retryable、affectedRanges、evidenceRefs、suggestedAction。不要把模型思考文本、密钥或本机敏感路径暴露给外部客户端。

## 8. 现有能力的准确落点

| 本地文件／入口 | 已有能力 | adapter 注意事项 |
| --- | --- | --- |
| [tactical_workbench.py](../../scripts/tactical_workbench.py) | load/save/frames/run；来源与 expectedVersion 校验 | run 调用 tactical-overlay/workbench-cli.mjs；独立 folder 存派生文档；不能借任意路径 API 暴露本机。 |
| [workbench-cli.mjs](../../tools/tactical-overlay/workbench-cli.mjs) | preparation、ground-trajectory、agent、production、validate、export | 图形创建不是现 CLI operation；新 bridge 导入已有函数。candidate 是历史 fixture；export 是 HTML。 |
| [tactics_agent.py](../../scripts/tactics_agent.py) | phase/play/range 工作与 adopt | range 有 V2/courtPreparation 条件；adopt 返回文档，不自动保存。视频直接分支用新 adapter，不伪装成现 V3 court API。 |
| [tactics_render.py](../../scripts/tactics_render.py) | job/cancel/video、完整解码；FPS 24/25/30/60 | 当前静音、单 worker、最多 3 个排队／运行任务、偶数尺寸且 ≤4K、≤18000 帧。 |
| [vision_provider.py](../../scripts/vision_provider.py) | status/generate，已有 Codex provider | 新 provider 需实现能力、超时、取消和计费适配；不能仅改配置就宣称 multimodal-api 可用。 |
| [tactics-annotations.mjs](../../tools/player-review/tactics-annotations.mjs) | 创建、投影与 SVG | 原生严格字段及跟随隐藏逻辑保持；外层增加真实覆盖、来源与语义检查。 |

当前 HTTP /api/tactics、/api/tactics/save、/api/tactics/frame、/api/tactics-agent/jobs、/api/tactics-render/jobs 仅作为本机已有入口证据，有 localhost Host/Origin 限制。新 API 应通过 runner 的进程内调用或安全 adapter 使用这些能力，不关闭原本的保护来对外暴露。

## 9. 第三方 API 与模型 provider

计划提供以下 HTTP 面，鉴权后的客户端仅使用注册资产 ID 和 run ID：

```text
POST /v1/workflows                     对应 submit_workflow，202 或已有 run
GET  /v1/workflows/{runId}             对应 get_run
POST /v1/workflows/{runId}/resume      对应 resume_run
POST /v1/workflows/{runId}/cancel      对应 cancel_run
GET  /v1/workflows/{runId}/artifacts   返回授权后的产物引用
POST /v1/tools/{toolName}:call         可选高级分步入口，同一 runner
```

凭据来自部署配置，不写入请求示例、视频报告或 manifest。调用者只能访问自己的授权资产／run。外部资产先走受限上传或内部登记，校验内容与 SHA；不能把任意 URL／文件路径当作读取权限。上传具体实现属于 T10，不通过 UI 自动点击代替。

MCP 若需要，仅映射相同的工具 schema 和状态，不再实现另一套调度。provider 与工作流程解耦：status/capabilities/generate/cancel、用量和原始响应证据由 adapter 归一化。模型在不同阶段可配置，但固定在 manifest 中。并行优先短证据包和独立区间，不让十个 Agent 竞相修改同一身份表。

## 10. Manifest、复现与测试

manifest 至少包含：workflow/schema/policy/tool 版本、源视频 SHA、准确帧区间和 PTS 映射摘要、tracking/calibration/document 摘要、模型及权重版本、预处理与种子、每步输入输出摘要、attempt、预算／耗时／可测费用、机器接受依据、未完成请求、最终媒体 SHA 和解码结果。

三种复现模式明确区分：replay_artifacts 读取已有文件；render_saved_document 对保存的准确文档重新编码；rerun_models 重新执行模型并产生新 attempt。前两者不能冒称模型再次得到同一结论；第三者不承诺字节一致。成功任务需重新推理时用新的提交／幂等键，保留父 run 引用。

必须测试：schema 拒绝未知字段且接受工作流程中的 canonical submit 示例；来源错配；剪辑／重采样后的非恒等 sourceFrameMapping；同键同请求／异请求；人工锁与版本冲突；adopt 后 save 失败恢复；渲染重复请求；崩溃重启；取消迟到输出；预算耗尽；无标定；人物圈全程隐藏；十人 document 但只标一人的覆盖失败；静态／无球／相关防守者覆盖；无依据路线拒绝；TAPIR 非方形适配失败及身体点不可冒充脚点。

验收按[最终计划](../plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)的小样本对照执行。合同测试与实际视频审查各自留证；只通过 JSON 校验不代表轨迹和战术正确。
