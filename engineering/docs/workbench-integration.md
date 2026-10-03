# 工作台整合与战术人工审核

更新：2026-10-03，Asia/Shanghai。本文记录当前实现；分类提交与同步结果见[发布交接](../../handoffs/Linzeyu912/2026-10-03-1630-workbench-updates-publication.md)。人工核验继续使用本机草稿。

## 完整操作路径

1. 顶部「当前视频」切换已有结果；「视频库 / 导入」合并展示共享目录与本地视频文件夹，支持文件名搜索和来源筛选。共享视频直接读取已登记的文件，不复制回导入目录。尚未下载的 LFS 文件不能启动推理。
2. 分别选择 YOLO 检测器与跟踪器，或在视频库选择组合后点击「处理并打开」。默认保留原篮球优化路线，两个推荐项各有小标记；各组合继续使用独立草稿。处理成功后回到该视频的处理页，清除前一视频的战术示例导航参数。见[后续选择与布局调整](model-selection-layout.md)。
3. 顶部按「直播画面筛选 → 球员标定 → 球场标定 → 2D 轨迹核对」排列。球员与球场两项标定可交替核对；十人关联登记后继续球场标定，已有位置和映射的帧自动生成 2D 轨迹。进入第 4 步会展开球场预览，显示当前帧的关联人数、映射和位置缺口；可直接继续到数据核对或战术页。人物 / 球场未确认与缺失状态分别保留，不因投影成功自动确认。镜头推拉导致交点离开画面时，可在球场标定的视频四周标点区估计位置；系统单独标记画外点并提示以可见点核验。
4. 点击左栏「战术分析与讲解」，首次点击「建立画布，开始手工标注」。已有参与者会保留，未关联球员也可直接手绘；用户自行确定动作与阶段，不自动推断战术。选择上方的「画路线」「挡拆标记」「重点球员圈」，在画面上放置图形；「选择 / 修改」可拖动图形或路线控制点。选中挡拆后，拖蓝色旋转柄或点左转 / 右转调整朝向；选中操作条可直接删除，撤销可恢复。见[人工画布操作](tactics-canvas.md)。
5. 选择阶段会将同步视频定位到冻结帧。「预览播放」从当前位置播放，只保留尚未走完的路线，到下一阶段冻结点自动暂停并精确定位；末阶段在最后一帧停止。「暂停」保留当前位置，「重播本段」先回到本阶段冻结帧再播放。底部播放键使用相同控制逻辑；拖动时间轴、逐帧前后移动会暂停并切到所在阶段，不自动继续。阶段名称、冻结帧、拆分和合并放在「阶段设置」中。
   原有逐段来源路线修正保留在「识别路线参考」内，可拖动、插入或删除内部控制点，恢复来源路线或撤销，缺测与审核断点保留。详见[展示路线编辑](future-route-editor.md)。手绘图形独立保存；有球场映射时按地面坐标投影，没有标定时只用于当前参考帧。画内不增加球员姓名或编号标签。
6. 在「动作审核与讲解」中编辑跑位、切入、顺下、外弹、持位、拉开和掩护，指定参与者和区间。填写审核人后点「我已核对本动作」，只记录该动作判断的人工审核；不会自动确认人物、接地点或球场标定。修改动作会撤回其旧审核，支持单独撤回与战术撤销。
7. 点击「保存」写入本机数据目录，重开后继续。「来源、草稿与导出」中的完整 JSON 保存来源快照、`presentation` 展示修正和 `annotations` 手绘图形；审核冻结报告包含实际冻结图、既有动作审核叠加和讲解意见，不包含新的平滑未来路线或手绘图形。完整修正保留在 JSON。
8. 日常处理由当前草稿在工作台内接续，修改会沿用原保存机制，不需要下载文件后再导入。左栏「导出与交付」保留视频和战术报告入口，并将轨迹 JSON 放在「轨迹文件备份（可选）」折叠项。视频烧录叠加、配音与字幕合成尚未实现。

## 轨迹平滑与篮球路线

- 2D 球员轨迹默认开启显示层平滑：只处理连续的映射观测，使用前后各 2 帧的中值抑制小抖动与孤立尖峰。遇到缺失、估计点、人工球场点或切镜时断开；关闭「平滑显示球员轨迹」可直接查看原始映射。数据库草稿里的原图点、导出原图轨迹和 `courtTrajectory` 不被平滑覆盖。
- 篮球仍与球员身份分离。工作台以每帧篮球检测及人工修正点生成待核对的图像路线，按时间、运动方向、检测分数关联相邻观测；切镜、长遮挡和大跳变断开。原始候选仍逐帧保留，人工修正只写当前帧。
- 导出 `sceneObjects.basketballTrajectory` 保存路线观测、来源、关联段和缺口帧数，`basketballTrajectoryReviewed` 保持 false。篮球路线与球员轨迹使用同一原图像素坐标，可用于后续关联球员 / 传球分析；空中球不经地面单应投影，自动关联不能替代人工核对。

## THY 示例

点击战术页「THY 三阶段示例」，切到 005 SAS–MIA 的 E-BARD 来源，读取独立候选快照。它包含 6 名参与者、14 个动作、3 个阶段，原冻结帧为内部索引 15 / 40 / 90（界面第 16 / 41 / 91 帧）。可修改动作、阶段和意见，但不会替换工作台人物或标定草稿。

「当前视频草稿」与 THY 示例分别保存。示例上的人物身份、地面位置和战术关系仍待人工核对。原候选数据已原字节迁到 `data/tactics/005-candidate/annotation.json`；生成器仍位于工程目录。跨机器 Git 的 LF/CRLF 转换只在确认为已锁定文本的纯换行差异时接受，生成的来源绑定仍使用实际本机字节哈希。

## 帧与版本绑定

- 战术页使用一个同步主画面。背景复制现有 `video-display` 已呈现帧的 canvas，帧归属使用 `frameAtMediaTime`，定位使用 `frameSeekTime`。每帧只按媒体时间裁剪缓存曲线，再用当前帧标定投影；播放中不重新提取或平滑路线、不逐帧请求 JPEG。画内不显示球员姓名、编号或动作说明。
- 后端仍为冻结 HTML 报告按零基帧索引解码视频，核对视频 SHA-256、PTS、帧尺寸和源帧映射，返回真实 JPEG 与摘要。实时工作台的切阶段、回退与重播由本地解码器定位；旧异步准备以 epoch 失效，不能覆盖新阶段或播放画面。
- 当前帧标定不可用时保留同步视频，隐藏视频路线并提示；不使用旧标定投影。没有球场坐标时显示具体缺失信息并提供返回人物 / 球场核对入口，不画推测路线。未接播放器的独立预览仍可降级 2D。
- 每份战术定义绑定导出的 schema 2 轨迹快照。人物或标定改变后，旧草稿继续作为旧快照显示；用户显式更新快照时重新绑定并撤回战术审核。不同视频、模型和帧映射不能重新绑定为同一份草稿。
- 保存使用版本号检查，旧页面的保存不能覆盖较新版本；QA 与正式草稿隔离。
- 浏览器即时草稿使用 IndexedDB，避免长视频轨迹超出 localStorage 容量。旧战术草稿仅在迁移事务成功后移除原副本；视频 / 模型切换等待草稿写入完成。

`app.mjs` 向 `mountTacticsUI` 提供 `play()`、`pause()`、`seek(frame)` 和 `getPresentedFrame()`。已呈现事件只来自视频 canvas 绘制成功后的 `onFrame`，形状为 `{frame,time,source,paused}`；`source` 为同帧解码 canvas。UI 的 `onPresentedFrame(point)` 同步驱动缓存裁剪与阶段状态机，`externalSeek(frame)` 取消继续意图并定位所属阶段，`togglePlayback()` 将底部播放键接入同一控制器。`getPlaybackState()` 返回 `{phaseId,status,targetFrame}`，状态为 inactive / seeking / paused / playing / ended。原 `ready()`、`getSceneState()`、`renderFrame()`、草稿队列及编辑 hooks 保持兼容。

状态先更新再执行播放器命令，避免暂停与 seek 回调重入重复触发冻结。正好命中边界而无需重新解码时，视频显示层在当前回调结束后补呈现；跳过冻结点时执行 pause + seek，确认目标已呈现后保持暂停。退出战术页会暂停、取消手势与异步意图；返回时重新定位当前阶段冻结帧。

## 文件位置

| 内容 | 位置 |
|---|---|
| 共享视频、清单、标签 | `data/videos/` |
| 用户本机导入 | `data/local-videos/` |
| 共享战术候选与来源 | `data/tactics/` |
| 本机正式 / QA 战术草稿 | `data/local-workbench/tactics/drafts/`、`qa/` |
| 已有视频处理缓存与日志 | `artifacts/player-review-imports/`，保持原路径及结果 |
| 工作台界面与文档适配 | `engineering/tools/player-review/tactics-ui.mjs`、`tactics-document.mjs` |
| 纯阶段播放状态机 | `engineering/tools/player-review/tactics-playback.mjs` |
| 独立引擎及报告构建 | `engineering/tools/tactical-overlay/` |
| 本机持久化与解码接口 | `engineering/scripts/tactical_workbench.py` |

## 接口

- `GET /api/video-library`：在现有本地库基础上包含 catalog 登记的共享素材、来源类别和实际可用性。已有样例结果可直接打开。
- `GET /api/tactics?sample=...&variant=...&qa=0|1&kind=workspace|candidate`：读取本机已保存的文档及版本。
- `GET /api/tactics/candidate`：通过锁定来源适配器建立 THY 示例快照。
- `POST /api/tactics/frame`：传入 sample、variant、videoSha256 和最多 40 个 frames，取得核对后的精确 JPEG。
- `POST /api/tactics/save`：sample、variant、qa、kind、document、expectedVersion；在 Node 引擎验证来源与定义后原子写入。
- `POST /api/tactics/export`：相同来源和 document，返回包含全部阶段的 HTML。

写接口限定本机 Host / Origin，不接受任意来源路径或执行命令。启动新增可选参数 `--shared-video-catalog`、`--tactics-folder`；原命令与视频 / 模型 / 草稿入口兼容。Node.js 22+ 用于战术验证和导出，PyAV 使用已有服务环境。

## 验证入口

```powershell
node --test engineering/tools/player-review/*.test.mjs engineering/tools/tactical-overlay/*.test.mjs
& tmp/vision-deploy-bench-venv/Scripts/python.exe -m unittest discover -s engineering/scripts -p test_tactical_workbench.py
& tmp/vision-deploy-bench-venv/Scripts/python.exe -m unittest discover -s engineering/scripts -p test_local_video_library.py
```

真实战术判断由用户后续验收。本轮不重新评测模型准确率，不将程序测试当作位置、身份或战术准确率结论。

2026-10-03 实测：前端 313 项中 312 通过、1 项 Windows 符号链接权限跳过；后端 194 项全部通过。共享清单 7 批 / 157 条及索引 LFS 指针检查通过。真实新增 MIL 片段用推荐方案处理 494 帧，并通过打开、建立战术草稿、保存和刷新恢复；005 示例通过三阶段精确帧与独立 HTML 导出。宽屏及窄屏页面均检查了交互与 DOM 尺寸；浏览器截图接口超时，未取得截图级视觉验收证据。

正式本机审核入口：`http://127.0.0.1:8890/?sample=005&variant=ebard&area=tactics&candidate=1`。2026-10-03 的未来路线编辑与播放验收使用独立 8892 服务及 QA 存储，入口带 `qa=1`；测试修改不代表用户已审核，也不写入正式草稿。此前整合验证见[整合交接](../../handoffs/Linzeyu912/2026-10-03-1507-workbench-tactics-integration.md)。
