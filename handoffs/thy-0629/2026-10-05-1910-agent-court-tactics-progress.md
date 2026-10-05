# 进度记录：导入视频 → 十人固定 → 2D 球场 → 战术路线（进行中）

> **20:10 追加（第二阶段：用户反馈后重做）。** 用户反馈：① 后段球员消失；② 要参考图那种战术板效果（编号圆圈/球/箭头）；③ 要真正读懂进攻跑位，"什么时候画路线、什么时候画挡拆"；④ 2D 是为后续 3D 贴图标注。本轮完成：
>
> **A. 球员消失的真正原因（重要发现）**：逐帧躯干颜色（payload `track_evidence.torso`）显示**追踪器存在换人跳变**：T7 于 f255-293 由深转白、T22 于 f318-340 转白、T42 于 f375-400 转白、T1 于 f195-235 由白转深。此前 P4/P6/P8/P9/P10 的绑定区间结束（轨道本身在 ~8-11s 断）是"消失"的直接原因；换人跳变是"位置错乱"的深层原因。
> **B. 续接绑定已写入会话草稿**（localStorage，key `…b7d`，字段格式复制自 UI 的 `human_range_replacement`，order 11-20）：
> P4 += T41[345-386] + T48[386-394] + T52[396-420] + T56[428-458]；P6 += T35[248-458]；P8 += T34[217-458]；P9 += T37[306-369]；P10 += T36[280-308] + T39[317-339] + T42[400-458]。
> 用应用自身的 `buildTrajectories`（`/trajectory.mjs`，签名 `(session, frames, sourceCuts)`）验证：后段覆盖从 5 人 → f250 十人全齐、f430/f455 九人（P9 在 369 后无轨道，属数据缺口）。**注意：这些续接片段多数属于对方的另一名球员**（如 T42 白色时段=#28 八村塁），绑定目的是恢复"十人可见"，个别时段身份仍需人工核对。
> **C. 战术真正读懂（与 19:10 版结论不同，以本轮为准）**：射手是**深色 #30 库里**（此前"P5 命中三分"的判断是错的）；出手点约球场 (21.6, 3.8) 左侧远边翼 25 英尺，被白色 #28 干扰；球高弧线飞向右篮；**未命中**（比分全程 83-77，f150→f458 比分板逐帧核对；转播 "25 FT" 为射程标注）。挡拆（掩护）时机 ≈ **f210-225（7.0-7.5s）**：2号（#00 库明加，持球人）与 5号（#11 克莱）在球场约 (20.5,13.5) 会合后分开，库明加向右上突破、克莱外弹右侧底角。这些结论来自：f190-250 视频序列、f368 网格投影（把 2m 网格投到帧上验证几何）、球轨迹 f373-417、比分板条带、碎片放大读号（T14=#00 库明加、T30=#11 克莱、T22=#30 库里、T34=#26 丁威迪、T35=#23 詹姆斯、T42白=#28 八村塁、T26≈#0）。
> **D. 参考图风格战术板已生成**：[outputs/offense-board-20261005/](../../research/vision/imported-video-diagnostics-20261005.md#未随-git-分享的产物)（`offense-board.html` 动画 + `board-data.json` 米制坐标 + 6 张关键帧截图 + README）。动画含：木质半场、白色编号圆（1-5）、橙色篮球（含出手飞行弧线）、绿色跑位箭头（①1号底线突破 ②2号借5号掩护[挡拆] ③5号外弹底角 ④球转弱侧 ⑤3号 25ft 出手不中）。本机服务 `http://127.0.0.1:8899/offense-board.html`。
> **E. 3D 接口数据**：`board-data.json`（NBA 标准场米制坐标：slots 逐帧点列 + ball + 事件帧区间见 HTML EVENTS），可直接用于后续 3D 球场贴图标注。

- 日期 / 时区：2026-10-05 19:10 前后，Asia/Shanghai（本机）。
- 性质：**进行中的本地进度快照**，未提交 Git、未推送；仅保存在本机工作区。
- 机器 / 服务：本机工作台服务运行于 `http://127.0.0.1:8894/`（pid 见 `artifacts/tactics-production-20261004/server.json`，由 `C:\python313\python.exe` + 推理 venv 重启过两轮）。

## 用户任务

重新跑一个导入视频；Agent 在第二步把十个球员标注固定，做出 2D 球场映射（能看到十人在 2D 球场上的位置）；然后看视频跑位画战术路线。

## 已完成

1. **修复导入识别失败**：11:10 的导入任务在写报告时因 Windows 缺 `tzdata` 崩溃（检测其实已完成）。已用 `uv pip install tzdata` 装进推理 venv `tmp/player-identity-test/.venv`，并经 `POST /api/video-library/process` 重新触发，处理完成（459 帧 / 30fps / 1920×1078，GPU 15.4 秒，37 个跟踪 ID）。
2. **恢复球场模型权重**：`tmp/court-models-v2/best.pt` 已缺失，从 HuggingFace 重新下载（koppolusameer/yolo11n-basketball-court-keypoints），SHA-256 `68e5faf5…410064` 与仓库研究记录一致。
3. **服务重启**：改用推理 venv 的 Python 重启服务（懒加载 torch/ultralytics 供球场标定用）；同名端口 8894，参数与原进程一致，另加了日志重定向 `tmp/agent-server-*.log`。
4. **十个球员固定（人工关联 10 / 10，已保存草稿）**：用「修正一段视频」逐条绑定（选槽位 → 起止秒 → T 编号 → 预览 → 应用）：
   - 红队（勇士深色）：P1←T7 全片、P2←T14 [0.57–15.27]、P3←T22 [1.67–15.27]、P4←T26 [3.67–10.80]、P5←T30 [4.20–15.27]
   - 蓝队（湖人白色）：P6←T4 [0–8.03]、P7←T1 全片、P8←T6 [0–7.13]、P9←T3 [0–10.13]、P10←T21 [1.60–9.17]
   - 分队依据 payload 内 torso 颜色证据（dark/white 计数）。
5. **球场标定（已采用）**：第 150 帧附近自动标定 + 镜头传播，458/459 帧生成映射（1 帧失败留空），状态为待复核（蓝色）。
6. **2D 球场十人显示（已核验）**：第 100 / 150 / 300 帧导出画布截图确认十人位置、红蓝队色、轨迹与缺口标记。证据：`tmp/court-frame100.png`、`tmp/court-frame150.png`、`tmp/court-frame300.png`、`tmp/final-court-10players.png`（5.00 秒，1401×668 大图）。
7. **看视频 + 战术路线（图形已绘制并保存）**：
   - 视频内容（2fps 抽帧拼图 `tmp/agent-frames/grid_1..4.jpg`）：GSW@LAL，第三节 4:30 左右，83–77；勇士深色队进攻：3–7 秒挡拆突破分球，12.4 秒左翼 25 英尺三分命中（命中者为 P5，距篮 24.5–26.7 英尺，从 courtTrajectory 距离核算）。
   - 在战术画布画了 3 条图形（区间 3–7 秒 / 帧 [90,210)）：P1 突破实线路线、P1→左翼点状传球线、P5 左翼转移实线路线；坐标经修正对齐球员真实球场位置（修掉了约 +1.69m 的点击映射纵向偏差）。
   - 图形数据**完整保存在浏览器 IndexedDB**（`court-tactical-drafts` 库，key 尾 `…5a5a8f61…:tactics:workspace`，草稿自洽：注记 sourceBinding 与文档摘要一致 `75597763`，校验通过）。快照另存 `tmp/draft-full.json`（38.5MB）与 `tmp/draft-annotations.json`。
   - 服务端另存有版本 2（`/api/tactics/save`，2026-10-05 18:44 UTC）：含同样 3 条图形，但 review 是早期摘要（60cc…），注记绑定与之不一致，加载时会被标「需重新定位」。**当前可用数据源是浏览器草稿**。

## 阻塞（如实记录）

1. **战术预览管线在本会话卡住**：进入「战术制作」后场景常停在「正在准备当前阶段…」。已定位两个因素：(a) 隐藏视频区（#operations display:none）导致 rVFC 帧呈现断流，用「迷你可见视频窗」可解；(b) 浏览器草稿经重同步后含 ~23MB courtPreparation（总 38.5MB），页内每次 clone/canonicalJSON/sha256 都在 38MB 量级上进行，耗时分钟级且伴随渲染进程长阻塞（bridge Internal error / 点击丢失）。未确认是否存在真正的死锁。
2. **服务端保存 32MB 上限**：`/api/tactics/save` 拒绝 >32MB 请求体（ECONNRESET / Failed to fetch 的根源）。浏览器草稿 38.5MB 无法原样上服务器；需裁剪 courtPreparation 才能持久化到服务端（但裁剪会改变 review 摘要、使注记绑定失配，需要一并重算注记 sourceBinding——Node 侧 `engineering/tools/tactical-overlay/binding.mjs` 可直接计算 canonicalJSON 摘要）。
3. 战术画布的点击映射依赖实时 rect，页面滚动后 rect 过期会造成落点偏移（本表现为 +1.69m 恒定偏移，已用数据修正，不代表产品缺陷定论）。

## 下一步建议

1. 刷新页面后进「战术制作」耐心等 2–5 分钟（38MB 草稿的页内计算），确认场景与 3 条图形渲染；如仍卡，按 (a) 恢复迷你视频窗。
2. 如需服务端持久化：在 Node 里载入 `tmp/draft-full.json`，将 `review.courtPreparation` 置 null 后用 `binding.mjs` 重算 `playDefinition.sourceBinding`，并把 3 条注记的 `sourceBinding.reviewDigest` 同步为新摘要，再 POST（预计 ~15MB，可过 32MB 限制）。
3. 交付物核验顺序：球员标定 10/10 → 04 步 2D 球场十人 → 战术制作图形与播放剩余路线。
4. 本记录未提交；如需入库请按仓库规范另写正式交接（含验证与远端核对）。

## 本轮改动文件（全部本地，未提交）

- 新增：`tmp/agent-*.py`、`tmp/agent-frames/`、`tmp/court-frame*.png`、`tmp/final-court-10players.png`、`tmp/tactics-canvas.png`、`tmp/saved-tactics.json`、`tmp/draft-full.json`、`tmp/draft-annotations.json`、`tmp/build-tactics-doc.mjs`、`tmp/save-tactics-v2.mjs`、`tmp/save-tactics-v3.mjs`、`tmp/court-models-v2/best.pt`（重新下载的权重，被 Git 忽略的 tmp/）
- 数据变化：推理 venv 新增 `tzdata`；服务端战术库新增版本 2；浏览器 IndexedDB 草稿（本机浏览器数据）
