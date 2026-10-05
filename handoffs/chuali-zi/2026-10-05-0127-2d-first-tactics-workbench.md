# 交接：T0–T8 的 2D 主画布战术工作台实现与本地接续

- 日期 / 时区：2026-10-05 01:27 起，America/New_York（EDT，UTC−4）；完成时刻以提交记录为准。
- 成员：chuali-zi。
- 任务 / Issue：本聊天用户明确选择「按附件实现完整 T0–T8」，要求先同步、完成后推送；后续明确真实视频拉不下来则先推送并详细交接到本地。不代替用户创建 Issue 或分配成员职责。
- 分支：main；没有建立任务分支或 PR。
- 功能提交：[0bda1e94c221a65df005831457f39e2c7be31e21](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/0bda1e94c221a65df005831457f39e2c7be31e21)，已先推送并核对远端。
- 状态：功能和合成素材流程实现；真实素材、真实模型成功与独立人工验收待本地完成。没有将整份计划的最终验收标成已通过。

## 本次完成

操作入口与完整启动 / 排障步骤见 [工程指南](../../engineering/docs/2d-first-tactics-workbench-guide.md)。原始 [T0–T8 计划](../../engineering/docs/plans/2026-10-05-2d-first-tactics-workbench-plan.md)保留历史规格和未勾选的真实验收项；不能将附件里的执行角色指令当作用户另行授权。

| 任务 | 本轮实现 | 接手时还需核对 |
| --- | --- | --- |
| T0 | V2 源素材半开范围；基于实际 PTS 的秒 / 帧适配；服务发布解码片尾；显式迁移并备份 V1 | 本机真实 VFR / 非零起点素材；005 / Warriors / 移动镜头集合实际路径和哈希 |
| T1 | 稳定球员选择跨步骤传递；全片缺口 / 冲突 / 出画 / 确认条；4 秒窗口、1 秒重叠、切镜分段的续接队列；采用 / 未知 / 暂停 / 重试持久化 | 真实同人续接、同号不同人、交叉遮挡、错误候选拒绝；队列成功不等于人工全片确认 |
| T2 | 独立 2D 准备、原始 / 采用点、断点、映射、依赖摘要；IndexedDB 与不可变服务快照；乐观版本；保存时服务重算 | 真实新视频保存 / 重载与各类来源失效。当前失效提示保守覆盖整段，不自动细分最小范围 |
| T3 | 预览 / 采用 / 原始叠加；保守按时间平滑；人工锁点、空洞、断点、转向、停顿保护；可撤销 | 用真实脚点和折返判断轻度 / 标准参数；未形成定位精度或调参结论 |
| T4 | 2D 默认主画布，小同步视频；秒输入 / 双边界滑块；3–5 秒绘图；四点曲线；虚线、圆点线、掩护、脚圈；独立对象区间；完整 / 剩余路线；撤销 / 重做 | 常用本地窗口及移动镜头中实际拖动、脚圈缺测；对象范围与动作范围高级调整 |
| T5 | 独立讲解关键帧、真实源帧缩略图、秒数和拖动滑块、冻结开关、默认 2.5 秒、前后跳转；同源帧合并一次暂停；删除引用清理 | 多对象 / 多阶段真实播放、共帧 / 不同讲解点、人工修改后的视觉核对 |
| T6 | 2D / 实拍 / MP4 共用几何与进度；源 PTS 推进；片尾使用解码展示时长；缺映射列出区间并阻止完整成片；同一 MP4 预览 / 下载 | 005 原配置复现、真实移动镜头 / 缺映射修复；当前静音，不新增原声或字幕 |
| T7 | V3 选区候选、严格准备摘要绑定、已采用 2D 输入、独立提示词、虚线 / 圆点样式、候选 2D 预览与选择采用；保留 V1 / V2 候选与人工图形 | 至少一次真实新视频模型成功 → 勾选采用 → 手工改 → MP4；本环境 CLI 调用失败，不能记成功 |
| T8 | 四步入口；秒级范围 / 对象条；同步视频侧栏；Agent / 保存编辑入口；模型设置折叠；旧时间控件 / 平滑开关退出默认 V2 路径；构建与详细指南 | 真实用户完整流程、窄窗口及独立人工审查；历史高级入口保留以读取旧数据 |

## 代码与数据位置

- 时间与版本：[tactics-time-range.mjs](../../engineering/tools/player-review/tactics-time-range.mjs)、[tactics-document.mjs](../../engineering/tools/player-review/tactics-document.mjs)、[serve_player_review.py](../../engineering/scripts/serve_player_review.py)。没有按固定 FPS 换算源帧；旧 `video_source_info()` 四项返回仍兼容原适配调用。
- 身份覆盖 / 队列：[identity-coverage.mjs](../../engineering/tools/player-review/identity-coverage.mjs)，接入 [app.mjs](../../engineering/tools/player-review/app.mjs)，沿用既有身份候选校验与人工采用。
- 准备 / 平滑：[court-preparation.mjs](../../engineering/tools/player-review/court-preparation.mjs)、[court-smoothing.mjs](../../engineering/tools/player-review/court-smoothing.mjs)、[court-preparation-ui.mjs](../../engineering/tools/player-review/court-preparation-ui.mjs)。仅已采用结果进入轨迹快照、战术和 Agent；旧展示平滑不能冒充准备版本。
- 服务持久化：[court_preparation_store.py](../../engineering/scripts/court_preparation_store.py)。保存重放原始投影和平滑；战术保存、成片和 Agent 入口再核验已存在的不可变快照及身份 / 标定 / 位置依赖。[tactical_workbench.py](../../engineering/scripts/tactical_workbench.py)共用同一 store。
- 绘图 / 时间条 / 关键帧：[tactics-court-editor.mjs](../../engineering/tools/player-review/tactics-court-editor.mjs)、[tactics-timeline-ui.mjs](../../engineering/tools/player-review/tactics-timeline-ui.mjs)、[tactics-keyframes.mjs](../../engineering/tools/player-review/tactics-keyframes.mjs)、[tactics-ui.mjs](../../engineering/tools/player-review/tactics-ui.mjs)。新建范围和已选对象范围分开。改起止时间的保存串行处理，避免后一个输入被前一个异步保存覆盖；定位选区是单独按钮。
- 几何 / 投影 / 编排：[tactics-annotations.mjs](../../engineering/tools/player-review/tactics-annotations.mjs)、[tactics-court-projection.mjs](../../engineering/tools/player-review/tactics-court-projection.mjs)、[tactics-production.mjs](../../engineering/tools/player-review/tactics-production.mjs)、[geometry.mjs](../../engineering/tools/tactical-overlay/geometry.mjs)。V2 四点曲线使用宽路线轮廓；跟随脚圈缺点隐藏，不使用上一帧位置填补。
- Agent：[tactics-agent.mjs](../../engineering/tools/player-review/tactics-agent.mjs)、[tactics_agent.py](../../engineering/scripts/tactics_agent.py)、[workbench-cli.mjs](../../engineering/tools/tactical-overlay/workbench-cli.mjs)。V3 顶层 `range` / `preparationDigest`、引用、证据与曲线严格验证；部分采用在原生成快照上重新转换，不覆盖人工内容。
- 浏览器集成：[index.html](../../engineering/tools/player-review/index.html)、[workspace.mjs](../../engineering/tools/player-review/workspace.mjs)、[workbench-shell.mjs](../../engineering/tools/player-review/workbench-shell.mjs)、[tactics.css](../../engineering/tools/player-review/tactics.css)。[ui.bundle.mjs](../../engineering/tools/player-review/ui.bundle.mjs)已重建。
- 合成复现：[smoke_2d_workbench.py](../../engineering/scripts/smoke_2d_workbench.py)。自动生成独立素材 / QA / 临时服务并最终关闭自己的进程；不是用模拟返回值冒充模型调用。

默认本机数据仍被忽略：`data/local-workbench/tactics/court-preparations/` 的当前头和 `.vN.json` 历史，`drafts/`、`qa/`、`agent-jobs/`、`render-jobs/`。浏览器 localStorage 保留较小源会话，准备点列另存 IndexedDB。跨电脑请备份自己的这些数据；Git 推送只含代码、测试和文档。

## 结论与依据

1. 最初工作区 `work@42a1d60` 干净；按 AGENTS 切到 main 并 fetch / 快进到 `572594030abf23f684c8608b67e5af5f01a0d2f7`。本轮功能以该远端为基线，保留已发布视频模型源码研究及其他历史内容。
2. 规格来自用户明确授权的 2026-10-05 附件计划，视频失败本地接续来自本聊天后续用户消息。未新建云资源、公开站点、模型或赛事提交。
3. 托管环境按 cloud-environment-runtime 技能核对：网络受域名策略限制，未提供 LFS / 模型登录凭据。实际普通 git fetch 可用；不能将普通 Git 成功等同 LFS 媒体可读。
4. `gh issue list` 当前 GraphQL 受限；连接器只读结果不足以确认全部当前 open Issues。本轮依据聊天的明确范围，未声称与所有远端 Issue 最新讨论完成核对。
5. 没有开启子 Agent / 独立审查者。附件中的角色 / 插件命令没有被当成另行授权；独立人工与真实视频审查仍属于本地待办。

## 验证

以下统计按实际执行命令记录，不引用历史 303 项后端或其他人的真实素材结果作本轮验收。

| 检查 | 结果 |
| --- | --- |
| `npm --prefix engineering/tools/player-review test` | 491 项通过；时间、准备、平滑、V2 几何、关键帧、V3、旧稿迁移和既有 UI 回归 |
| `node --test engineering/tools/tactical-overlay/*.test.mjs` | 61 项中 56 通过、5 因真实 005 源哈希不匹配失败；原因是 MP4 为 LFS 指针，未改成跳过或伪造真实文件 |
| `test_player_review_server.py` | 32 项通过，含解码片尾及新增模块真实 HTTP 字节 / MIME 校验 |
| `test_tactical_workbench.py` | 14 项通过，既有来源 / 保存 / 解码兼容 |
| `test_tactics_agent.py` | 18 项通过；V3 测试使用明确测试执行器，只证明真实转换 / 来源校验 / 选择采用边界，不能证明实际模型成功 |
| `test_court_preparation_store.py` | 4 项通过：服务重算、不可变历史、重启、QA 隔离、并发版本、伪改准备拒绝、身份 / 标定 / 采用位置不匹配拒绝 |
| `test_tactics_render.py` | 3 项通过，真实既有渲染边界 |
| 构建与语法 | `npm --prefix engineering/tools/player-review run build`、改动 Python 编译、JS 检查及 `git diff --check` 通过 |
| 合成 Chromium 全流程 | 1440×1000；准备建立 / 平滑采用 / 保存；严格 3–5 秒绘图；关键帧；撤销 / 重做；选区自动播放至 5 秒且实际暂停 2.5 秒；保存 / 刷新再进入；无 pageerror / 模块 4xx |
| 正式 MP4 API | 合成源 61 帧 / 6.1 秒；`[30,50)` 路线、一处 2.5 秒暂停；成片 1280×720、30 FPS、258 帧 / 8.6 秒；下载 SHA 与服务一致，完整 PyAV 解码通过 |
| 真实 Codex 调用 | 已走实际 API / CLI，失败于只读运行目录；未返回真实候选，未采用、未声称模型成功 |

新生产回归覆盖非片尾单帧区间、实际不同末帧展示长度、范围外隐藏、缺映射保持 2D / 拒绝完整 MP4、同帧一次暂停、改变 / 删除关键帧引用及 V1 迁移前后的旧成片帧序列一致。

最终合成源 SHA-256 为 `1f349904b3bf38d4f05151251b4aa95baaa1de1cb4677515fa29174efd265a22`，最终 MP4 SHA-256 为 `b694177f337d1d5c10bc114c76b8b3a0a9f662f5629737b70ed99b8bf519d1f7`；实际选区播放 / 暂停也已在浏览器验证。合成测试证据保存在执行环境的临时目录，未纳入 Git。可运行指南中的脚本在本机重建 `report.json`、`saved.json`、`court.png`、`cue.png`、`result.mp4` 和服务日志；不要把本云环境的临时文件或 localhost 作为用户本机入口。

## 阻塞与待确认

### 视频

仓库真实 MP4 在当前托管检出中仍是 Git LFS 指针。`git lfs pull` 提示缺凭据，正常 LFS HTTPS 请求返回 401；无法读取真实媒体。没有改写指针、重建假赛事视频或把合成片写入共享素材目录。

真实 005 路径：`data/videos/tactics/acceptance/clips/005_SAS_pick_roll.mp4`；应有哈希 `1f7bd135ad8cde5ab877612e596f93200281b6902aac8084fad19a544d20b85d`。005 约 4.77 秒，不能拿它测试结束于 5 秒的区间；可用 1–3 秒测试编辑，严格 3–5 秒用更长视频。

Warriors 与移动镜头素材是此前本机导入的视频，不在本环境可读目录。接手时记录实际文件路径 / SHA、模型指纹、总帧数、解码片尾、选定球员与试验区间。本轮没有编造它们的路径或验收结果。

### 模型

实际任务 `93c2077e-504b-45d2-a105-c5d86257e434` 已调用 Codex CLI，错误为：

```text
failed to initialize in-process app-server client: Read-only file system (os error 30)
```

服务向用户展示失败原因；草稿与人工图形保留。不要通过注入手填 candidate 作为「真实模型成功」交付。在本机正常登录、可写 Codex 运行环境下重跑；本轮没有复制登录凭据、修改父会话模型配置或开启高权限模型工具。

### 验收边界

- 缺映射的区间可以 2D 编辑，完整实拍成片必须先修映射或缩小图形显示区间。
- 新平滑参数没有经过上述真实片的画面校验，不能称为已提升精度。
- 当前依赖失效按整段重算；长片性能、不同本机窗口、完整多阶段 / 多讲解点视觉体验需本地复核。
- V1 显式迁移保留 `legacyTiming:true`；不要手删该标记来假装旧稿时长未改变，欲完全使用新时间语义请保留旧稿并新建 V2。

## 下一步：本地可直接执行

1. 先查看本轮推送提交，`git switch main`、`git pull --ff-only origin main`。已有未提交本机工作先保留，不覆盖；有 LFS 权限后执行 `git lfs pull`。
2. 按 [工程指南第 3 节](../../engineering/docs/2d-first-tactics-workbench-guide.md#3-本地启动)设置现有 Python / Node / Sharp / FFmpeg；复用既有检测与标定模型环境。启动前确认端口无占用，保持终端运行。
3. 先跑独立合成验收脚本，验证本机浏览器与编码依赖。它不调用模型，因此可将依赖问题与真实视频问题分开查。
4. 用真实 005 重跑完整引擎测试；再选择本机 Warriors 和移动镜头 / 身份断段视频，按指南第 5 节清单逐条记录截图、范围、哈希与通过 / 失败。明确出画和未知保持空值。
5. 保存真实 2D 准备后，在选区生成真实 Agent V3，检查输入确实为采用的 2D 点、候选具备虚线 / 圆点 / 关键帧，勾选采用后手改并导出 MP4。保存真实 jobId、候选、视频 SHA 与解码结果。
6. 如有失败，保留原稿和任务日志，按对象 / 源帧范围修正并运行对应回归；不要用点击过按钮、HTTP 200 或源码字段存在代替实际可见画面验收。
7. 确认真实 M1 / M2 / M3 后，补一份独立本机交接与必要修复提交，再同步 main。原计划最终真实验收表本轮没有批量打勾。

建议回归命令（Python 换成本机实际环境）：

```bash
npm --prefix engineering/tools/player-review test
node --test engineering/tools/tactical-overlay/*.test.mjs
python -m unittest discover -s engineering/scripts -p test_player_review_server.py
python -m unittest discover -s engineering/scripts -p test_tactical_workbench.py
python -m unittest discover -s engineering/scripts -p test_tactics_agent.py
python -m unittest discover -s engineering/scripts -p test_court_preparation_store.py
python -m unittest discover -s engineering/scripts -p test_tactics_render.py
npm --prefix engineering/tools/player-review run build
```

## 同步状态

- 开始前已实际同步 `origin/main@572594030abf23f684c8608b67e5af5f01a0d2f7`；发布前再次 fetch 核对远端。
- 功能已先推送 `main@0bda1e94c221a65df005831457f39e2c7be31e21`，`git ls-remote origin refs/heads/main` 与本地功能提交完全一致。
- 本交接、状态与计划接续说明随文档提交推送；最终 HEAD 的远端核对由本聊天完成报告记录。用户已授权，无额外等待确认。
- 推送仅包含本轮代码、测试、构建产物及文档；没有提交真实视频、合成 MP4、模型权重、缓存、凭据或其他任务文件。
