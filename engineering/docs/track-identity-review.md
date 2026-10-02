# 临时跟踪编号归并与人工审核

记录日期：2026-10-02，Asia/Shanghai。适用于用户版与 THY 版的整合工作台；功能已发布到用户独立分支，见[本次分支记录](workbench-branch-update-20261002.md)。本页记录内部工程约定，不是赛事官方数据格式。

## 检测、跟踪与固定球员的区别

| 层次 | 含义 | 当前可用证据 |
|---|---|---|
| YOLO 检测 | 在单帧中产生人物框及分数 | THY 输出的 `pending_detections`、`track_evidence.raw_detection_index` |
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

原图时间轴改称“原图位置覆盖”：模型位置为黄色待核对，人工操作为蓝色，缺失 / 冲突为红色。有位置不等于身份或脚点正确；整段归并也不等于逐帧审核通过。本次没有新增自动判定真实身份或逐帧审核完成状态的机制。

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
- 导出使用 `identitySource: manual_track_occurrences`、`associationScope: track_occurrences`、`selectionFrame`、`reviewRequired: true`、`identityConfirmed: false`。继续兼容原草稿版本及导出 schema 2。
- `identityInterval` 表示取消范围，包含批量段边界；`identityConfirmationInterval` 表示向后纠错的实际生效范围，只在下一明确人工边界或切镜处结束，避免 UI 提示比实际修改范围短。

实现入口：[后端编辑](../scripts/review_session.py)、[身份解析](../tools/player-review/identity-timeline.mjs)、[位置生成](../tools/player-review/trajectory.mjs)。脚点与场地模型无需接入新的身份写入逻辑。

## 验证

- 前端全套 200 项通过，后端 `test_review*.py` 48 项通过（包含人物编辑、真实 HTTP、版本校验与裁切）；前端构建、语法和补丁空白检查通过。
- 浏览器 QA：在 004 / team-stable 第 158 帧归并 T6，登记 197 个实际观测帧 / 4 段；跳回第 1 帧显示归并来源，刷新恢复。再归并重叠 T46 后显示冲突，撤销恢复 T6。
- 新加切镜后后续 T6 观测保留、路径断开；取消测试切镜后恢复。既有底部 2D 抽屉可打开，缺少标定仍明确留空。正式草稿未操作。
- 逐帧检查发现浏览器把 `.082707551` 秒量化为 `.082707`，旧 0.1 微秒容差错误退回前帧；将边界容差调整为 1 微秒加浮点余量后，实际页面第 1 → 2 → 3 → 2 帧正确。仍使用解码帧时间，保留可变帧率的区间查找；210 帧精确 / 截断 / 四舍五入时间与边界回归通过。
- 本机证据：`artifacts/frontend-track-assignment-tests.log`、`artifacts/review-backend-track-tests.log`、`artifacts/track-assignment-preview.jpg`、`artifacts/track-assignment-detail.jpg`。这些为被忽略的本地证据，不是共享云端文件。

当前预览端口为 8890，原 8876 服务保留。以上验证覆盖功能与兼容性，尚未完成真实人物逐帧准确率或脚点 / 米制位置精度验收。
