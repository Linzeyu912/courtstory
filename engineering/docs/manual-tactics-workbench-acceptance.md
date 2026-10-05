# 006 人工制作：执行与验收记录

日期：2026-10-05，Etc/UTC。用户要求实际实施附件 006，参考 [005](005-authored-v2-workflow.md)，先同步远端、最后推送。开始时工作区干净，已同步 `main@36ab6e59fe44f56196604324f31640e5d40333fb`；开放 GitHub Issues 查询为空。前置核实、R1—R6 文件映射与浏览器基线见 [Task 0](manual-tactics-workbench-task0.md)，实际界面操作见 [指南](manual-tactics-workbench-guide.md)。

## 实际改动

| 任务 | 实施结果与主要位置 |
| --- | --- |
| 0 核实 | 真实空白浏览器基线揭示默认 2D、暂停必须先有对象、新视频对象未消费 1–5 秒选区、路线仅参考帧可见；没有把原 MP4 按钮当作人工闭环通过 |
| 1 直接编辑 | `tactics-ui.mjs` / `tactics.css` 默认视频；跑位、方向虚线传球、挡拆、选择、主弯曲柄、复制、名称、删除、撤销；AI、2D、关联球员放二级，圆点传球及跟随脚圈保留 |
| 2 独立时间 | `tactics-timeline-ui.mjs` 新标注先选区；逐对象秒输入、设置当前画面、全对象时间条端点/平移；源 PTS 吸附；修复连续输入时异步回显覆盖结束时间 |
| 3 剩余路线 | 新 `tactics-manual-editor.mjs` 接同 `annotations.items`；显式固定视频坐标/参考分辨率；同渲染器裁后半段、稳定箭头、整体淡出；点击完整辅助路线校正，普通 V2 用弧长、旧 authoredPath 用地面 Bezier 参数，不互换 |
| 4 暂停 | `tactics-keyframes.mjs` 兼容扩展明确的 explanation；先建空白、提前关联、同帧合并、单首次讲解、删除保留对象；统一最低 0.9 秒、约 1/6 秒停稳 + 0.7 秒绘制；源/输出时钟分离；无关已生效路线保持剩余状态 |
| 5 保存/成片 | `tactics-production-ui.mjs` 预览/正式导出先保存、显示版本/digest、失败保留；同 `compileProduction` → SVG worker → Sharp/PyAV/FFmpeg；原片播放不插入成片暂停 |
| 6 界面验收 | 新 `engineering/scripts/smoke_manual_tactics.py` 仅准备视频/源帧/可选既有映射，全部战术对象、校正、暂停与生成请求由真实 Chromium 鼠标/键盘经界面完成 |

为“打开视频不运行模型”，复用视频库增加 `manual` 处理选项：`video-library.mjs`、`local_video_library.py`、`process_local_video.py`、`index.html`。读取真实 PTS、保留源文件与已有模型结果、进入原战术页，未添加第二套项目/渲染系统。HTTP 静态路由显式登记新模块。

VFR 浏览器发现最后解码帧的 nominal duration 可超过真实视频流尾端；`serve_player_review.py::video_source_info` 改为优先采用有效 video stream end，读值发生在容器关闭前，缺失时才使用解码帧 duration。新增真实 VFR 回归，未用秒 × 30 推导源帧。

## 真实浏览器结果

本次合成素材明确不是比赛视频：960×540，两块移动色块便于观察冻结与恢复。每轮使用新目录、新浏览器上下文和空白文档，没有后台预填战术数据；`GET /api/tactics` 仅在制作完成后读取证据。

| 验收 | 原片 | 下载的输出 | 保存版本 / 摘要前缀 |
| --- | --- | --- | --- |
| 固定画面完整十步及附加操作 | 81 帧，10 fps，8.1 秒 | 393 帧，13.1 秒 | 2 / `d062cb61d7f0` |
| 已有移动球场映射，视频直接绘制 | 81 帧，10 fps，8.1 秒 | 393 帧，13.1 秒 | 2 / `61c934da0463` |
| 真实 VFR 上传及完整十步 | 121 帧，PTS 间隔 0.05 / 0.10 秒，8.05 秒 | 392 帧，13.066667 秒 | 2 / `8027ca372ede` |

三轮均完成：上传/打开 → 空白画布 → 1 秒空白暂停 2.5 秒 → A 1–5 秒弧线 → B 1–3.5 秒 → 挡拆 1.5–3 秒（旋转/放大）→ 传球 3–4.2 秒 → 四对象首次讲解关联 → 3 秒点击 A 约 65% 校正 → 5.5 秒第二暂停和 C 5.5–7.5 秒 → 真实成片播放器播放 → 修改 B 至 3.6 秒、删除挡拆并撤销 → 保存刷新恢复五对象/两暂停/校正 → 模拟 HTTP 503 编码请求失败、保留草稿 → 正式导出界面重试、下载 MP4。

附加浏览器检查通过：无选区提示、同源帧暂停去重、半成品 Esc 取消、名称输入 Delete 不删对象、倒置时间就地拒绝、拖时间条整体平移并一次撤销、Ctrl+D / Ctrl+Z、原片播放越过讲解点、画布在 1440×1100 / 1100×900 下缩放。新源、模型、球场和原轨迹未用后台注入来替代人工操作。

每轮下载文件完整 PyAV 解码，抽取 13 个输出帧，覆盖：冻结开始、绘制中、看清、刚恢复、中途裁短、临近完成、第二暂停停稳/绘制、片尾。图中保留传球和挡拆，未见对象名称、编辑手柄或辅助路线；第二暂停没有重画旧对象。抽帧初次发现孤立短箭头后，补失败几何测试并修复整体淡出，最终固定画面输出帧 213 已无头部残留。

源 1 秒与 3 秒的目的地实测：固定画面输出 x=718 / 718；移动映射 x=718 / 734，符合 2 秒 × 8 像素/秒的已知相机位移。映射项目保存为 `space:'court'`，无映射为显式 `space:'video', videoMode:'fixed'`。这是确定性合成投影回归，不是比赛镜头精度证明。

预览版本 1 与正式输出版本 2 之间只改了不入画的对象名称；三轮两个正式任务的 MP4 SHA 均相同。每个任务的播放器和下载地址相同，最终版本/digest 与保存文档吻合。

## 可复现检查与本地证据

实际命令（仓库根目录）：

```sh
npm test --prefix engineering/tools/player-review
npm run build --prefix engineering/tools/player-review
PYTHONPATH=engineering/scripts python -m unittest test_local_video_library test_tactics_render test_player_review_server test_review_video_trim test_review_variants
PYTHONPATH=engineering/scripts python -m unittest test_tactical_workbench test_workspace_collection test_workbench_models
node --test engineering/tools/tactical-overlay/*.test.mjs
python scripts/validate_video_data.py --check-index
git diff --check
```

前端 **500 测试通过**、构建通过；第一轮在默认沙箱的报告测试因 Node `spawnSync EPERM` 失败，允许本机子进程后全套通过。相关 Python **74 测试通过**；额外保存/集合/模型测试结果见交接。语法/编译检查通过。几何、跟随脚圈、源播放重播、旧编排透视点击校正等新测试先复现失败再修复。

运行浏览器验收需主 Python 的 PyAV/numpy/Playwright、Chromium、Playwright FFmpeg 录像依赖、正式 worker 的 Sharp 和 FFmpeg；不需要模型/CUDA/AI 凭据。测试代码控制真实 UI；它不是交付给用户的独立制作/渲染流程：

```sh
python engineering/scripts/smoke_manual_tactics.py --extra --output-dir artifacts/manual-tactics-006-fixed-final
python engineering/scripts/smoke_manual_tactics.py --mapped --output-dir artifacts/manual-tactics-006-mapped-final
python engineering/scripts/smoke_manual_tactics.py --vfr --output-dir artifacts/manual-tactics-006-vfr-pass
```

每次需要新的空目录。非默认 Sharp 安装用 `TACTICS_SHARP_MODULE` 指向其模块目录；本次依赖安装在忽略的临时运行目录，未改变用户模型环境。三个本地目录各保留 `result.mp4`、`saved.json`、`report.json`、`trace.zip`、`operation-video/*.webm`、服务日志及 `output-*.png`；录像和视频没有作为原片/共享 LFS 素材推送。

固定画面最终 MP4 SHA：`1599433a91662289e63891d60a7e01ca89a8362e7b0836fdb6490a3e63065e88`。VFR 最终 SHA：`e0c118c1917a418a10cb4334a289606749bcdecedfa398908ca732caf48ccc22`。失败尝试保留在其他本地目录，不列为通过证据。

## 未完成 / 未验证

- **真实 005 原片/认可成片重新播放及逐帧回归未验证。** 当前 005 为 LFS pointer；下载先缺 credential，接现有 GitHub 登录后 LFS 返回 `Maximum number of login attempts exceeded`。历史归档、原配置和成片未改。旧编排结构、独立相机恢复及 **386 输出帧** 合同通过前端测试，但不能替代真实样片视觉验收。
- **真实比赛移动镜头精度、真实历史草稿迁移和真实 AI 草稿的浏览器修改未验证。** 已通过合成移动映射和旧结构/Agent 来源自动回归；模型未调用。固定画面随时间裁短不能宣称随相机贴地。
- 额外 overlay 套件 **56/61 通过，5 项因 005 源 hash mismatch（LFS pointer）失败**；全仓视频索引检查因 `nba-2024-25-library100-001` 未下载终止，不能登记为通过。未为了测试改动视频索引、源 hash 或历史 fixture。
- 成片仍为既有链路的静音 30 fps；没有新增音频、AI 分析、云部署或批量改时。
