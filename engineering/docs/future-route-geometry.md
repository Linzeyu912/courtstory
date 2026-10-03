# 未来路线数据与几何接口

2026-10-03，Asia/Shanghai。模块：`engineering/tools/player-review/tactics-presentation.mjs`。这是展示层，不修改原始轨迹、身份关联、动作审核或原冻结报告。

## 建立稳定路线

```js
const model = await buildPhaseRoutes(document, phaseId, options);
// options 可省略，仅接受 tactical-overlay DEFAULT_OPTIONS 已有字段。
// 默认 maxStepSeconds=.2，maxSpeedMetresPerSecond=12，stationaryThresholdMetres=.1。
```

返回 `{schemaVersion:1, phaseId, phase, sourceBinding, routes, breaks, issues, presentation, width, height, context}`。`context` 是只在运行时使用的标定/观测上下文；不要持久化整个 model。

每条 route 对应一个合法连续段，字段：

```js
{
  routeId: 'phase-1:P1:12-61', phaseId: 'phase-1', entityId: 'P1',
  startFrame: 12, endFrameExclusive: 61,
  source: {policy:'future-route-v1', sourceBinding, phase,
           startFrame:12, endFrameExclusive:61, options, geometryDigest},
  sourcePoints: [{frame:12, time:1.2, x:18.44, y:10.11}, /* 全部合法观测 */],
  controlPoints: [{frame:12,x:18.44,y:10.11}, /* 提供给编辑器 */],
  curve: [{frame:12,time:1.2,x:18.44,y:10.11}, /* 预先生成的稳定采样 */],
  manual: false, breakBefore: null, breakAfter: null
}
```

阶段参与者从 `freezeFrame` 到 `endFrameExclusive` 直接提取，不要求有动作。单点段没有路线；静止段保留数据，绘制时总位移不超过 0.1m 的段省略。缺测、估计点、出画、身份冲突、切镜、异常跳跃和标定边界复用已有 `createGeometryContext` / `buildActionGeometry` 的拒绝与分段规则，不补造审核证据。人工逐帧点若没有既有连续性审核，可能被安全规则拆为单点。

默认曲线先按媒体时间简化：误差阈值 0.08m、锚点间隔不超过 0.5s；随后做单调分量三次插值，每个采样相对来源折线同一时间位置的位移不超过 0.12m。端点和超过容差的转向保留。人工曲线保留所有控制帧锚点；插值偏离控制折线的幅度也有界。只裁剪已有曲线，不在播放时重新拟合。

## 编辑与文档校验

```js
const controls = extractRouteControlPoints(route); // 深拷贝 [{frame,x,y}]
const preview = previewRouteControlPoints(route, controls); // 同步，只重建单条临时曲线
const next = updateRouteControlPoints(document, route, controls); // 同步，返回新文档
const restored = restoreRoute(next, route.routeId); // 删除这一项展示修正
const errors = validatePresentation(next.presentation); // [] 或 fatal issue 数组
await validateDocument(next); // 同时校验展示字段和既有来源绑定
```

pointermove 使用 `previewRouteControlPoints`，返回与 route 相同结构、manual=true 的临时 route；只重建单条曲线，不克隆整个文档、不做来源hash、不落盘。用临时 route 替换绘图 model 中对应项。松手后使用 updateRouteControlPoints 提交一次，取消手势丢弃临时 route。

控制点只能在一个合法段内；帧为严格递增整数，第一帧固定为段起点，最后一帧固定为 `endFrameExclusive-1`。位置为 NBA 球场米制坐标 `0≤x≤28.6512`、`0≤y≤15.24`；每段 2–128 点，一份文档最多 1000 项修正；字符串标识最多 256 字符。不接受 NaN/Infinity、重复路线、乱序帧、未知字段或错误来源绑定。内部点可以插入/删除，端点帧不能删除/改动；坐标可以改动。

持久化只保存独立的可选字段：

```js
document.presentation = {schemaVersion:1, routes:[{
  routeId, phaseId, entityId, source, controlPoints
}]};
```

`source` 绑定完整 review 的已有 SHA-256、阶段范围/冻结点、几何选项，以及合法段原观测/断点/标定来源的 SHA-256。旧文档没有 presentation 仍有效。更新点不改变 `review` 或 `playDefinition`，最后一项恢复后移除 presentation 字段。

`presentationStatus(document, routes, {phaseId,options})` 返回 `{applied,stale,pending}`；build 的 `model.presentation` 已提供同样结果。`stale` 保存原修正并给出 `reason`（`source_changed` / `phase_changed` / `policy_changed` / `geometry_changed` / `route_unavailable`）。其他阶段尚未提取的修正标为 pending，不能错误标成当前阶段缺失。分段、合并或显式刷新快照都保留字段；失效修正不会被套入新的路线。

## 播放裁剪、投影与绘图

```js
const remaining = clipRoute(route, video.currentTime); // null 表示已到达/无运动
const scene = projectPhaseRoutes(model, {
  frame: currentFrame, mediaTime: video.currentTime,
  selectedEntityId: 'P1', showAll: false
});
const svg = renderPresentationSVG(scene, {space:'video', width:1280, height:720});
const point = videoToCourt(model, currentFrame, {x:imageX, y:imageY});
const pixels = courtToVideo(model, currentFrame, {x:metresX, y:metresY});
```

`mediaTime` 是视频本地 `currentTime` 秒数，不是原来源 `sourceTime`、墙上时间或帧号。省略时使用当前帧的 mapping.time。`clipRoute` 的返回保留 route 字段，只有 `curve` 被裁剪；到达时严格返回 null。重复的静止尾部从首次到达时间开始消失。默认突出第一名阶段参与者，显式 selectedEntityId 可以换人，showAll=true 查看全部。

scene 返回 `{frame,mediaTime,width,height,videoAvailable,routes}`。绘制项为 `{routeId,entityId,manual,selected,remaining,court,video,projectionReason}`；`court` / `video` 包含 `{curve:[{x,y}], chevrons:[[{x,y},{x,y},{x,y}]], ring:[{x,y}]}`，ring 为闭合的 33 点折线。人字箭头沿曲线按米制距离排列，宽度/长度先在球场构造，终点圈半径 0.3m，再投影到当前帧。

没有当前帧有效标定时 `videoAvailable=false`、各项 video=null，坐标转换返回 null，仍可用 `space:'court'` 预览。跨镜头没有既有同一球场参照和标定审核证据时，相关 video 为 null。不能使用上一帧矩阵兜底。返回 `projectionReason` 解释隐藏原因；videoAvailable 只说明当前矩阵可用，不保证每段都能投影。

SVG 保留来源分辨率 viewBox，width/height 可以设置展示尺寸。浅色衬边增强可见性，选中线路突出，其余线路降低透明度。**视频叠加不绘制可见球员编号、姓名、动作说明或文字标签**，选人 UI 应在画面外；编辑器可以额外画控制点。

## 验证范围

相关单元测试覆盖无动作路线、缺测/切镜/身份/标定/速度边界、有界去抖、帧时间锚点、剩余裁剪、到达隐藏、人工保存/恢复/校验、来源失效和透视圈/箭头。真实 005 候选只读提取：三阶段 6 人，分别 7 / 19 / 36 个合法段，冻结时可绘制 7 / 19 / 26 段；其他段不足默认运动阈值。来源标定/身份仍需人工核验，这些数字不是精度结论。
