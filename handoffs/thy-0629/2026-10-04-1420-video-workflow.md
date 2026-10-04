# 交接：新视频导入、区间纠正与 Agent 战术主流程

- 日期 / 时区：2026-10-04 14:20，Asia/Shanghai
- 成员：thy-0629
- 任务：用户要求继续完成新视频到战术制作的主流程；未新建 Issue。
- 分支：main
- 提交：与本交接一同提交的本地功能提交；本轮未推送。
- 状态：已实现并在本机 8893 服务运行。

## 本次完成

- 顶部四步导航和直接「导入并识别球员」入口；模型设置默认折叠。操作说明：[`engineering/docs/tactics-canvas.md`](../../engineering/docs/tactics-canvas.md)。
- 服务独立工作集合。初始只激活 005 · SAS–MIA；其余 174 个素材条目归档，可以恢复。共享原视频、检测缓存和旧战术草稿保留；初始全量工作集合另存恢复备份。
- 新文件上传后默认运行篮球 YOLOv8n + BoT-SORT，显示真实任务状态，处理完成打开球员检查。缺失模型显示原因，旧缓存不掩盖新任务失败。
- 球员检查集中提供时间段、起止秒数/滑块、关键帧、预览、应用和整段撤销。支持身份替换和人物框/脚点相对偏移传播，区间结束后恢复原关联。
- 战术页接入实际 Codex CLI 视觉任务：整段/当前阶段、目标、任务状态、取消、候选预览、采用与保存。输出须通过严格来源、帧号、坐标和版本校验；迟到响应和旧建议不能覆盖新草稿。
- 新重点圈命中人物框后贴脚，换人和「重新贴脚」清除偏移；原有人工偏移保持兼容。同源位置同步保留图形，删除参与者的图形可归档恢复。
- 修复采用建议与立即保存的版本竞争。采用期间保存禁用，采用结束恢复；普通人工修改后保存仍可用。

## 运行和存储

本机主入口：[8893 工作台](http://127.0.0.1:8893/?sample=005&variant=team-stable)。原服务的 state、clips、inbox、imports 和 tactics 目录均继续使用。实际启动命令从仓库根目录运行：

```powershell
python engineering/scripts/serve_player_review.py `
  --library data/videos/tactics/acceptance/review-library.json `
  --port 8893 `
  --state-file artifacts/tactics-canvas-20261003/state.json `
  --trim-root artifacts/tactics-canvas-20261003/clips `
  --video-folder artifacts/tactics-canvas-20261003/inbox `
  --import-cache artifacts/tactics-canvas-20261003/imports `
  --tactics-folder artifacts/tactics-canvas-20261003/tactics `
  --inference-python tmp/player-identity-test/.venv/Scripts/python.exe `
  --models tmp/player-identity-test/models `
  --tactics-agent-cli tmp/tactics-agent-cli/codex.exe
```

主 Python 需能导入 PyAV，推理 Python 需 Torch/Ultralytics 和现有篮球权重，Node.js 22+ 需可发现。本机实际使用 Python 3.13、RTX 5060 Laptop GPU、Torch 2.14.1+cu130、Ultralytics 8.4.171；篮球权重可用，缺少通用 `yolov8s.pt` 的组合禁用。

默认集合文件在 `imports/workspace.json`，首次缩小前备份为 `workspace.before-narrowing.json`。两者、上传原片、检测缓存和所有本机运行依赖被 Git 忽略。

Agent 默认读取现有登录与可信配置的模型；本机是 gpt-6-astra，任务指定 low 推理强度、最多 12 张参考帧。可用 `--tactics-agent-reasoning-effort` / `--tactics-agent-max-images` 调整。不修改全局登录和配置。

本机独立 CLI 来自官方 npm 包 `@openai/codex@0.160.0-win32-x64`，包完整性已核对；二进制 SHA-256 为 `fdda5fa3cf3fb3d000b876720742857676293e4315e4b045fae6f8bd7e866d1d`，位置为 `tmp/tactics-agent-cli/codex.exe`，来源与完整性保存在同目录 `source.json`。本次旧应用内置同版本二进制持续超时；独立二进制的真实视觉任务成功，未覆盖应用内置安装。

CLI 以专用输入目录、read-only、ephemeral 启动，禁用 shell、浏览器、apps、plugins、skills、memory、多代理等工具，不执行模型输出。只取受控模型/推理强度，清理父进程内部 CODEX 变量，保留现有登录目录和网络代理。完整来源快照不因输入精简而变更。

## 验证

- Node：409 项，408 通过、1 项既有条件跳过、0 失败；Python：115 项全部通过。构建 `ui.bundle.mjs` 成功。日志在本机 `artifacts/video-workflow-20261004/*-tests-final.txt`。
- `scripts/validate_video_data.py --check-index` 通过：8 个数据集、175 个条目，175 个文件哈希和已暂存 LFS 指针均核对；本轮未改视频入库记录。
- 独立 reviewer 最终主功能审查无剩余 P1/P2；UI+Agent 24/24、后端 Agent+服务 34/34。追加顶部样式由不同 executor 修改，再独立复核和实际浏览器检查。
- 隔离 8894 服务通过内置浏览器上传 NYK–DET 5.7 秒原视频，真实 GPU 处理 142 帧，team-stable 完成后自动进入检查。
- 真正操作 0.80–1.60 秒身份区间（21 帧），检查区间外和结束后恢复；两关键帧框修正、一次撤销、脚点区间修正均实际执行。区间修改保留 manual_range 待核对来源。
- 实际点击人物身体放圈、改为 P2、回 P1、重新贴脚、逐帧跟随；新增挡拆，按钮转 15°，手柄自由旋转至 71.1°，删除/撤销恢复，保存版本 3 成功。
- 真实 Agent job `05d127bf-c391-43bc-84c5-573f52f04cfb` 取 12 张画面，完成候选校验，预览、采用、保存版本 2、刷新恢复成功；已有人工圈保留。后续手工挡拆保存到版本 3，磁盘为 4 个图形。CLI 事件没有 shell/命令执行或文件改写事件。
- 主服务 8893 API 实际返回活动素材仅 005、174 条归档、GPU 与篮球组合可用，Agent 配置为受限 CLI。QA 进程已停止，测试视频未混入主集合。
- 截图和机器可读证据在本机 `artifacts/video-workflow-20261004/verification.json`、`qa-agent-route-saved.jpg`、`qa-manual-screen-saved.jpg`。这些是交互测试，人工身份故意变更用于验证流程，不作为准确战术结论。

## 限制与下一步

主流程当前无阻塞。机器关联、Agent 图形与批量区间修正仍需人工核对，不证明每帧对应同一真实球员。Agent 可能生成多余图形，采用后可逐个编辑或删除。

无有效球场标定的像素路线只用于参考暂停帧；脚圈有有效人物位置即可跟随。地面路线需要有效标定，剩余路线按显示时间推进裁短。当前保存与数据导出可用，尚无工作台一键合成 MP4；报告也未新增画布图形。

下一步由用户导入自己的视频，按四步操作并指出需要改善的具体展示效果；不用逐帧重画整段。

## 同步状态

本轮修改直接留在 main。任务开始前已同步远端，原 HEAD 为 `88e8936`，当时 origin/main 为 `0dec1e3`。本轮选择性提交功能、测试、操作说明和本交接，尚未推送；原有其他任务的未跟踪文件保留。
