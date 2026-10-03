# 人工展示路线编辑与保存

2026-10-03，Asia/Shanghai。战术画布消费[路线几何接口](future-route-geometry.md)，默认突出所选球员，可切全部。画面只含路线、箭头、最后剩余路线段落点和编辑控制点，不绘制球员编号、姓名或动作文字。审核名单与问题仍在画面外的折叠详情。

## 使用

1. 在画面外选择球员，再选择一个合法连续路线段；缺测、切镜、身份或标定断点不跨接。
2. 拖动圆点，松手提交一次；控制点下拉显示帧锚点。插点仅提供段内尚未使用的来源帧，端点可移动、不可删除。
3. 使用「恢复来源路线」删除此项修正；「撤销战术修改」可恢复上一文档。展示修正只进入顶层 `presentation`，不修改 `review` 或动作审核。
4. 自动草稿经原 IndexedDB 排队写入，「保存到本机」仍采用版本检查。工作区/候选、QA/正式分离，旧文档无 `presentation` 仍能打开。

切阶段、加载或退出取消手势。异步校验结束检查文档引用、上下文、阶段、修订号及加载状态；过期操作不提交。提交期间禁用新编辑，防止从旧控制点覆盖刚保存的修正。纯展示修正复用已解码背景，不重新请求同一冻结 JPEG；来源更新或切阶段仍清除旧预览并验证帧绑定。

JSON 包含完整展示修正与来源绑定。现有 HTML 冻结报告仍使用既有动作审核绘图，**不包含平滑未来路线或人工展示修正**；UI 与报告正文都明确此范围。过期修正保留在 JSON，不套用到新路线。

## 播放集成接口

`mountTacticsUI(api)` 返回：

| 方法 | 用途 |
|---|---|
| `saveDraft()` | 等待原草稿排队写入 |
| `ready()` | 当前异步阶段准备 Promise |
| `getSceneState()` | `{model,phase,phaseId,frame,mediaTime,active,loading,editBusy,editingEnabled,selectedEntityId,showAll,background}`；background 是稳定 canvas；model 只在运行时使用 |
| `renderFrame(frame,mediaTime,backgroundSource,{editing=true})` | 从缓存 model 同步裁剪/投影，复制提供的已呈现画面到稳定 canvas；播放传 `editing:false`，暂停后传 true；无 model 或加载中返回 false |
| `invalidatePreview()` | 递增请求 epoch 并取消手势，保留缓存 model，供开始播放或退出前使用 |
| `cancelEditing()` | 丢弃当前拖动与临时曲线，不写文档 |

背景 scene/canvas/overlay 节点保持稳定；SVG 内容刷新，pointer capture 固定在画布外层。`renderFrame` 不重新提取路线、不请求 JPEG、不更新审核名单；仅编辑模式变化时更新编辑控件。播放接入尚由后续任务完成，当前依然为独立冻结图。

编辑状态与 SVG 逆 CTM 坐标映射位于 `tactics-route-editor.mjs`。pointermove 只重建单条临时曲线，不克隆文档/hash/持久化。

## 验证

编辑状态 8 项、真实 mount UI/IndexedDB 事件集成 1 项、报告范围 1 项、路线显示 1 项；关键新增行为先观察失败再实现。UI 集成覆盖松手单次、提交中第二拖动隔离、插点选中、删内部点、切阶段取消、保存恢复、来源恢复/撤销、review 不变及 JPEG 复用。坐标测试覆盖 SVG 缩放/滚动逆映射和当前帧缺标定拒绝；真实浏览器验收由任务统筹独立执行。
