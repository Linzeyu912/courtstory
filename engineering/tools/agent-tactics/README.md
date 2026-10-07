# Agent 战术原生 bridge

`bridge.mjs` 是统一 workflow 的内部适配层。它导入现有 `player-review` 工厂、文档校验、投影、生产编排和 SVG 渲染函数；没有修改这些模块或工作台界面。外部客户端须经 runner 的注册资产、版本和权限检查，不能直接上传任意原生文档或本机路径。

## 调用

从仓库根目录运行：

```powershell
Get-Content -Raw .\artifacts\agent-workflows\request.json | node engineering/tools/agent-tactics/bridge.mjs
node --test engineering/tools/agent-tactics/bridge.test.mjs
```

标准输入是一份 JSON，标准输出只有 `{ "ok": true, "result": ... }` 或 `{ "ok": false, "error": ... }`。也可 import 对应导出函数；函数失败时抛出 `BridgeError`，`respond` 提供统一错误对象。bridge 不保存文件，候选、配套元数据及结果登记由 Python runner 负责。

| operation | 必需字段 | 主要结果 |
| --- | --- | --- |
| `create_baseline` | `review, range, snapshotId`，或以 `sourceRef` 代替 snapshotId | `document, documentDigest, sourceBinding, sourceRef` |
| `build_player_annotations` | `document, sourceRef, playerEvidence, playAnalysis, participantInventory` | `candidate, candidateDigest, annotationMap, renderPlan, inventoryDigest` |
| `check_participant_coverage` | `candidate, sourceRef, playerEvidence, participantInventory, annotationMap, renderPlan` | `pass, phases, missing, unavailable, wrongBindings` |
| `check_projection` | 同覆盖检查 | `pass, invalidRanges, hiddenReasons` |
| `preview_projection` | 同覆盖检查，可加 `frameSelection: [assetFrame, ...]` | `previews`，每项包括 SVG、资产帧、来源标签、PTS、生产显示状态 |

build 可选 `fps`、`jobId`、`profile: "richer_players_v1"`、`cameraEvidence`、`calibration`。检查使用 renderPlan 中固定的几何凭据。拒绝未知参数；上游丰富的 snapshot / analysis 不应直接展开进调用参数。

基线必须来自真实派生 review，带准确 `mediaEndTime` 和完整帧映射。仅有检测框身体中心时，原生 entity 的 `trajectory` 可为空；身体观测留在外层 `playerEvidence`，不能写作脚点。`create_baseline` 使用原生规范 JSON 计算摘要，返回 sourceRef，避免跨语言对 `1` / `1.0` 等数值序列化不同产生假错配。

## Intent 最小形状

以下是结构示例，不是任何实际视频的观测：

```json
{
  "intentId": "focus-P3",
  "phaseId": "setup",
  "playerId": "P3",
  "type": "spotlight",
  "displayIntent": "reference_frame",
  "range": {"startFrame": 0, "endFrameExclusive": 90},
  "anchorFrame": 20,
  "sourceSpace": "image_pixels",
  "anchorSemantics": "body_point",
  "evidenceFrames": [20],
  "evidenceRefs": ["registered-observation-P3-20"],
  "actionId": null
}
```

省略 marker 的 `points` 时，从该球员该参考帧的观测读取。指定坐标时检查与实际证据一致。静态参与者和相关防守者同样生成 marker；角色仅保存在 annotationMap，当前视频没有文字层。screen 需要阶段中属于该人的 `observed` screen action。route 需要阶段中的真实移动 action、至少两个观测端点及相机/几何证据。原生三个类型之外的关系保存在外层说明。

`playAnalysis.phases` 使用 `id`，冻结的 `participantInventory.phases` 使用 `phaseId`；两者的 range 和 participants 必须一致。生成器不能删掉未覆盖的人让检查通过。build 要求空白派生基线，遇到已有图形、动作或生产编排返回 `version_conflict`，保留原输入。

冻结参与者的 `visibleRanges` / `locatableRanges` 是该阶段已确认人物身份的可见／可定位范围，不是所有同名 raw track ID 的检测范围。`locatableRanges` 必须处于 `visibleRanges` 内，范围内每帧都需无冲突的实际观测。仅确认离散证据帧时，保存各帧的 `[f, f+1)` 小区间，不填满中间帧；原始检测仍可完整保留在 PlayerEvidence。角色依据 `participant.evidenceFrames` 可以是阶段前后证据，但图形的参考帧和位置依据、跟随的每个显示帧、路线的每个动作帧都必须在本阶段冻结的可靠定位范围内。扩大范围必须重新分析并生成新的 inventory 摘要及下游质量结果。

## 显示、几何与时间边界

- `reference_frame`：仅在指定原图参考帧显示；原生关键帧增加 1.5 秒暂停，允许身体位置证据。
- `fixed_interval`：原生 V2 `manual/fixed/referenceSize` 固定图像图形，不声称人物跟随或贴地。
- `declared_player_follow`：仅合法 spotlight。逐帧比对外层观测与原生脚点；身体点、TAPIR、估计、身份冲突及轨迹缺口拒绝跟随。
- `court_projection`：明确 NBA 米制、原点、轴向，逐帧原生标定和独立参考点回投检查。坐标变换摘要保存在 annotationMap。当前适配使用固定地面图形，不启用未经检查的 `court_player_foot`。

跨帧图像路线目前接受经过独立参考点测量的 `stationary_camera_validation`：凭据必须覆盖显示区间、引用每个动作观测和参考帧，至少 4 个检查点，残差不高于按视频高度缩放的 8 像素 / 720p 阈值。没有凭据时拒绝路线，不能把多时刻屏幕点拼成跑位。运动相机下请使用已经通过检查的 court_projection；不会自动假装相机静止。

路线还须在整个动作区间逐帧有可用观测。正式曲线采样与观测轨迹折线相互检查距离，Bezier 控制柄不能制造无依据的绕行，缺失帧不能靠曲线补成观察。每个实际生产显示状态同时最多 3 条路线，不能通过拆成不同 anchor 的重叠 interval 绕过密度限制。

实线语义为 `current_action`。虚线强制 `later_observed_action`，并要求后续视频观测在参考帧之后；适配时不沿用手绘构造器的 `pass` 默认值。所有新图形保留 `origin.kind=agent`，不调用会写 `human_modified` 的编辑接口。

所有输入区间、观测帧和 origin.sourceFrames 使用当前资产的零基半开范围。原生 production 的 `sourceFrame` 也是资产索引，原始来源标签由 `review.sourceFrameMapping[assetFrame].sourceFrame` 另行转换。renderPlan / preview 同时提供 `assetFrame`、原始 `sourceFrame` 和秒制 `pts`；不能用原始标签当本地数组下标。低输出 FPS 跳过的原图仍可预览，以原生 source 播放状态渲染并返回 `outputFrame: null`。

覆盖检查遍历实际生产帧与暂停状态，核对逐阶段逐人绑定、可见几何、透明度、画面范围和位置证据；只有落在冻结可靠范围内的实际显示帧才算覆盖，单独的同名 raw detection 不能计入。全隐藏或仅显示在未确认身份帧的图形是 missing；只有整个阶段无可定位位置且有完整不可用区间证据、没有声称存在有效图形时才可列 unavailable。清空可靠范围不能隐藏参与者或自动取得 unavailable 豁免。两种覆盖分母分别保存，unavailable 不计作 covered。

SVG 是透明图层，Python 必须与同一 assetFrame 的准确原视频画面合成。preview 本身不产生独立审查结论，也不代替模型/人工对身份、战术和观感的复核。

## 验证范围

`bridge.test.mjs` 使用明确标记的合成位置记录测试适配合同，覆盖多人/静态/防守标注、十人只画一人、错绑、全隐藏、遮挡豁免、无依据路线、虚线语义、来源摘要、未知字段、脚点边界和非恒等帧映射。它不证明实际视频身份准确、球场标定精度或成片视觉质量；实际样本由 workflow 另留证。
