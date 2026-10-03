# 临时跟踪编号归并与人工审核

记录日期：2026-10-02，Asia/Shanghai。适用于用户版与 THY 版的整合工作台；功能已发布到用户独立分支，见[本次分支记录](workbench-branch-update-20261002.md)。本页记录内部工程约定，不是赛事官方数据格式。

## 检测、跟踪与固定球员的区别

| 层次 | 含义 | 当前可用证据 |
|---|---|---|
| YOLO 检测 | 在单帧中产生人物框及分数 | THY 输出的 `tracks` 原检测坐标、`pending_detections`、`suppressed_detections` 和 `track_evidence.raw_detection_index` |
| 跟踪器 T 编号 | 跨帧关联检测框，编号可能中断或串人 | 当前帧 `tracks`、检测对应索引、低分续接及冲突提示 |
| 固定球员 P 身份 | 人工把多个临时 T 编号归到同一名球员 | 原人工关键帧 / 区间与本次整段观测归并记录 |
| 脚点和球场坐标 | 人工修正图像位置，再独立投影或标记球场位置 | `anchors`、`courtAnchors`、`courtCalibration` 及来源字段 |

检测候选索引只在当前帧有效，不是跨帧球员 ID。同一个人出现 T1、T2、T3 可能涉及遮挡、检测中断、过滤或跟踪关联；不能仅凭编号变化认定 YOLO 出错。未编号检测框可以说明本帧已有检测候选，但不能单独证明跟踪器匹配错误。旧 YOLO / E-BARD 输出没有逐框来源证据时，页面明确显示证据有限。

实现依据为本地核读的 [THY 检测与跟踪输出](../scripts/basketball_run.py)、[诊断显示](../tools/player-review/tracking-diagnostics.mjs)；采集日 2026-10-02。整合来源为 [THY 1839dcd](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/1839dcde5b5cc0aa362baa474e58e5b530e6c695) 与 [用户版 fffb6ea](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/fffb6ea7513b161dba0d0959ee4b822ae0469cf0)。本轮只读核对远端 main 仍为 1839dcd；GitHub open Issue 列表为空，范围依据用户本次指示。

## 如何操作

1. 在球员标定页选择固定球员，默认关联范围为“整个 T 编号的出现帧（含之前）”。
2. 在任意出现帧选中一个 T，归并当前视频及模型版本中该 T 的全部实际观测，包含所选帧之前的部分。缺失帧不会凭空补出位置。
3. 同一球员的其他 T 编号分别选一次，记录累计保留。面板列出已登记的编号、观测帧数和段数。
4. 同帧多个 T 归到同一球员、或同一个 T 被多个球员批量认领时，冲突保持可见。已有明确人工纠错优先，批量归并不会抢占另一球员的明确人工关联。
5. 如果某个 T 中途串到其他人，选择“从当前帧向后纠错”，或用已有的精确区间工具处理。重复整段归并不会抹掉已有人工取消、出画或纠正记录。

原图时间轴改称“原图位置覆盖”：模型位置为黄色待核对，人工操作为蓝色，缺失 / 冲突为红色。有位置不等于身份或脚点正确；整段归并也不等于逐帧审核通过。人物是否正确由人工核对；本轮补充逐帧人工确认状态，不自动判定真实身份。

## 后端和草稿兼容

复用 `POST /api/review-edit`，新增 operation：

```json
{"type":"assign_track","entityId":"P1","trackId":12,"frame":90}
```

请求继续携带原有 `sample`、`variant`、`qa` 与完整 `session`。后端验证所选 T 在当前帧存在，返回草稿副本和 `assignment: {trackId, observationCount, rangeCount, ranges}`；不改写模型候选文件。浏览器沿用既有撤销、请求期间版本检查、草稿隔离和保存路径。

每段写入 `entity.bindings`：

```json
{
  "kind":"track", "trackId":12, "start":10, "end":30,
  "scope":"track_occurrences", "origin":"human_track_assignment",
  "selectionFrame":90, "order":1, "exclusive":false, "reviewRequired":true
}
```

- 仅按实际连续观测保存，缺帧及切镜分段。重复同 P / T 归并幂等；新加切镜后再次归并会重分段，保留原 order 和 selectionFrame。
- 新增切镜只断开显示轨迹，不取消已登记的后续实际观测。旧 forward 及人工区间继续按原规则处理切镜。
- 解析优先级为明确人工关键帧 / 区间、整段观测归并、模型建议。旧 forward 的 T 在本帧无观测且没有人工位置时，允许新归并的 T 补位；人工范围不自动让位。
- 保留全部原图手工脚点、框、检测证据、球场锚点与标定。旧独立位置编辑关联了不同 T 时保留其坐标，展示点的 `trackId` 留空；明确 forward 纠错仍使用已有的旧位置替换规则。
- 同帧身份冲突时显示空位置等待解决，原手工坐标记录仍在草稿。清空 / 取消 / 交换沿用原行为，撤销可恢复；取消区间保留阻止模型自动填回的证据。
- 导出使用 `identitySource: manual_track_occurrences`、`associationScope: track_occurrences`、`selectionFrame`、`reviewRequired: true`、`identityConfirmed: false`（未确认帧）；逐帧确认后的字段见下节。继续兼容原草稿版本及导出 schema 2。
- `identityInterval` 表示取消范围，包含批量段边界；`identityConfirmationInterval` 表示向后纠错的实际生效范围，只在下一明确人工边界或切镜处结束，避免 UI 提示比实际修改范围短。

实现入口：[后端编辑](../scripts/review_session.py)、[身份解析](../tools/player-review/identity-timeline.mjs)、[位置生成](../tools/player-review/trajectory.mjs)。脚点与场地模型无需接入新的身份写入逻辑。

## 检测候选与逐帧实线确认

2026-10-03 补充：视频下方“检测候选”同时显示跟踪观测、未跟踪检测及被后处理抑制的检测。候选坐标取保存的检测结果，不经过球员显示平滑；原始候选文件和模型版本指纹不改写。

| 画面 / 记录 | 排查方向 |
|---|---|
| 橙色虚线检测框，没有 T 编号 | 已产生检测框；检查跟踪关联、初始化和阈值条件 |
| 紫色虚线检测框，标记“已抑制” | 后处理抑制了候选，可能为重复框；保留证据供核对和本帧人工兜底 |
| 有 T 编号，但对应了错误球员 | 检查临时轨迹是否串人，以及固定球员的人工 / 模型归属 |
| 目标位置没有检测候选 | 检查遮挡、检测阈值和漏检；若旧数据缺少完整检测声明，不能仅凭没有显示框认定 YOLO 出错 |

当前帧摘要列出已跟踪、未跟踪、已抑制的数量。完整性仅覆盖所用置信度阈值和 NMS 之后、交给跟踪器之前的人物检测结果；不包含网络的全部原始预测。旧 THY 数据的三个分区继续可查，但缺少完整数量 / 索引声明时显示“证据有限”。新推理输出增加明确声明、原检测总数与分区索引，服务校验后才标记完整；裁切保留对应证据。

- 检测候选框一直使用虚线。红蓝球员框在 `frameIdentityConfirmed === true` 时使用实线，未确认、插值及手绘估计均用虚线。
- 点选候选归并 T 时，只登记点击帧的人工人物确认。其他实际观测仍是待核对；重复选择同一 T 的另一帧可累计确认，不重复建立绑定。
- “确认第 N 帧人物”只确认当前有效人物关联，不传播审核结果。已有人工选人锚点只在自身帧计为确认。手动补脚点并不会自动确认人物身份。
- 确认记录绑定当时的 T 和有效身份规则；身份变化、冲突、取消等情况不会沿用不匹配的实线状态。无 T 的人工位置也可单帧确认，后续修改几何会要求重新核对。
- `entity.frameConfirmations` 随草稿保存、撤销、清空、取消区间和整槽交换处理。导出逐帧状态，同时仍保留 `allFramesManuallyVerified: false`，不把部分确认写成整片审核完成。
- 实线表示这一帧的人物确认，框底中心是否接地、2D 标定精度及真实姓名仍按各自流程核对。
- 画布点击优先命中有 T 的候选，抑制框须从列表明确选择；关闭检测候选后不会暗中选中隐藏框。无 T 候选只写当前帧的人工兜底范围，不中断之后的旧 T。
- 已确认的风险模型观测允许显示，原风险提示继续保留；冲突和估计位置不能直接确认。2D 球员标记也按相同逐帧状态区分虚实线。

## 2026-10-03 验证

- JavaScript 229 项、Python 216 项回归通过，bundle 构建通过。
- 浏览器 QA 核对本帧确认实线、相邻帧虚线、已抑制候选来源、单帧兜底后的 T 恢复、后端往返和撤销。所有验证新增标注均已撤销，正式草稿未操作。
- 真实 GPU 烟测 8 帧得到 94 个原检测：82 个已跟踪、12 个未跟踪、0 个已抑制，原索引和分区总数校验通过。空检测及抑制分区的完整性另由测试夹具覆盖。
- 27 个现存样例 / 版本与修改前 loader 逐个对照，观测、模型元数据、身份建议和草稿指纹相同。历史数据没有补写完整性声明，也没有改写原视频或共享候选。
- 142 条视频元数据及暂存 LFS 指针检查通过。完整视频字节检查仍受本机未下载的无关 LFS 视频限制，见[此前说明](workbench-branch-update-20261002.md#验证与限制)。
- 本机证据：`artifacts/detection-review-frontend-tests.log`、`artifacts/detection-review-backend-tests.log`、`artifacts/detection-candidates-preview.jpg`；GPU 烟测输出在 `tmp/frame-confirmation-evidence-20261002/`。它们是本机忽略产物。
- 8890 预览服务已切换到本分支主工作目录；模型与人工草稿的隔离方式保持。
- 修复浏览器微秒截断导致实际解码上一帧：跳转目标进入该帧最多 2 微秒，不改写源时间戳或放宽帧匹配容差。回归覆盖 004 的全部 210 帧；浏览器第 1 → 2 帧、连续 32 步到第 33 帧、33 → 34 → 33 均准确停稳。

## 2026-10-03 09:03 续接复核

额度中断发生在文档提交前；上述三个功能提交已经推送。本轮重新运行全套 229 项 JavaScript 和 216 项 Python 测试，均通过。独立重建的 `ui.bundle.mjs` 与已提交文件 SHA-256 一致，页面第 2 帧人工确认后用实线，第 3 帧仍待核对，返回第 2 帧后撤销能恢复待确认状态。浏览器无错误日志，测试新增确认已撤销。

`python scripts/validate_video_data.py --metadata-only --check-index` 检查通过，覆盖 5 个数据集、142 条元数据及 142 个索引 LFS 指针。完整 `--check-index` 还会读取视频字节，仍受本机未下载的无关视频限制；此前末次失败由此产生，不能写成全库视频已校验。历史检测文件的完整性限制继续保留；本轮未重新推理或改写检测数据。

本轮证据保存在被忽略的 `artifacts/detection-completion-frontend-tests.log`、`artifacts/detection-completion-backend-tests.log`、`artifacts/detection-completion-build/` 和 `artifacts/detection-completion-confirmed.png`。完整接续及同步范围见[独立交接](../../handoffs/Linzeyu912/2026-10-03-0903-detection-review-completion.md)。

## 原 2026-10-02 验证

- 前端全套 200 项通过，后端 `test_review*.py` 48 项通过（包含人物编辑、真实 HTTP、版本校验与裁切）；前端构建、语法和补丁空白检查通过。
- 浏览器 QA：在 004 / team-stable 第 158 帧归并 T6，登记 197 个实际观测帧 / 4 段；跳回第 1 帧显示归并来源，刷新恢复。再归并重叠 T46 后显示冲突，撤销恢复 T6。
- 新加切镜后后续 T6 观测保留、路径断开；取消测试切镜后恢复。既有底部 2D 抽屉可打开，缺少标定仍明确留空。正式草稿未操作。
- 逐帧检查发现浏览器把 `.082707551` 秒量化为 `.082707`，旧 0.1 微秒容差错误退回前帧；将边界容差调整为 1 微秒加浮点余量后，实际页面第 1 → 2 → 3 → 2 帧正确。仍使用解码帧时间，保留可变帧率的区间查找；210 帧精确 / 截断 / 四舍五入时间与边界回归通过。
- 本机证据：`artifacts/frontend-track-assignment-tests.log`、`artifacts/review-backend-track-tests.log`、`artifacts/track-assignment-preview.jpg`、`artifacts/track-assignment-detail.jpg`。这些为被忽略的本地证据，不是共享云端文件。

当前预览端口为 8890，原 8876 服务保留。以上验证覆盖功能与兼容性，尚未完成真实人物逐帧准确率或脚点 / 米制位置精度验收。
