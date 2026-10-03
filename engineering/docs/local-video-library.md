# 工作台本地视频库

2026-10-03 整合补充：视频库同时列出 `data/videos/catalog.json` 登记的共享素材与 `data/local-videos/`，可搜索文件名并筛选来源；共享素材原地处理，未下载完整的 LFS 条目禁用处理。已有预计算结果直接打开。详见[工作台整合](workbench-integration.md)。

更新：2026-10-03（Asia/Shanghai）。功能的分类提交与同步结果见[发布交接](../../handoffs/Linzeyu912/2026-10-03-1630-workbench-updates-publication.md)；导入视频、缓存与人工草稿继续只保存在本机。

## 使用方式

1. 在工作台顶部选择「当前视频」，直接切换已处理素材。
2. 新视频放入仓库根目录 `data/local-videos/`（支持子目录），点击「视频库 / 导入」→「刷新文件夹」。也可多选文件导入，复制到同一目录。
3. 分别选择 YOLO 检测器与跟踪器，默认是带「推荐」小标记的篮球 YOLOv8n 与 BoT-SORT 外观续接。点击某段视频的「处理并打开」，完成后进入直播筛选、球员标定与球场映射流程。
4. 顶部两个下拉框可选择四种组合；点击「应用组合」打开已有结果，或「处理并应用」运行新组合。历史结果保留在左侧模型来源详情。具体对应关系见[选择与布局说明](model-selection-layout.md)。

支持 MP4 / MOV / MKV / WebM / AVI。页面上传每个文件最多 2 GB；更大的文件直接放入文件夹。文件夹相同内容按 SHA-256 合并展示；导入重名但不同内容时追加随机后缀，不覆盖已有文件。视频长短、分辨率和硬件影响处理耗时；没有建立整场视频的时间或内存上限保证。

## 推荐来源与选项

本轮检索了 Codex 历史聊天「新建分支并推送本地内容」，其中 2026-10-02 的用户消息明确要求 THY 全方案加推荐，理由是此前人工比较认为效果最好。同轮仓库记录见[选择性整合交接](../../handoffs/Linzeyu912/2026-10-02-2229-selected-integration.md)和[模型部署](model-deployment.md)。本轮沿用这一选择，不新增独立精度评测结论。

新视频界面提供 `team-stable`、`ebard-byte`、`yolo-team`、`yolo` 四个组合。默认组合同时保存对应 `optimized` 原观测和稳定展示元数据。旧样例的 `ebard`、`original` 及各实验参数结果保留。不同 T 编号属于各自模型运行；切换后不能把旧 T 当成同一球员。

## 本地存储与启动

| 内容 | 仓库相对位置 |
|---|---|
| 导入视频 / 用户放入的文件 | `data/local-videos/` |
| 持久化清单 | `artifacts/player-review-imports/library.json` |
| 每段视频的兼容播放副本 | `artifacts/player-review-imports/local-<SHA256>/video.mp4` |
| 各次处理结果和日志 | 上述目录的独立运行子目录，包含 `sample.json`、候选、元数据及 `processing.log` |
| 推理 Python / 模型权重 | `tmp/model-runtime/Scripts/python.exe` / `tmp/models/` |

默认启动命令仍是：

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8890
```

可通过 `--video-folder`、`--import-cache`、`--inference-python`、`--models` 调整本机位置。推理过程运行在独立子进程，固定校验 Ultralytics 8.4.171、CUDA 与两份权重哈希，沿用[已有模型契约](model-deployment.md)。原服务的球场和人工编辑环境不被升级。

2026-10-03 本机将已存在的整合环境、权重复制到标准忽略目录。`prepare_tracking_variants.py --check` 已确认 Python 3.12.10、PyTorch 2.11.0+cu128、Ultralytics 8.4.171、PyAV 17.0.0 与 RTX 5070 Laptop GPU。其他电脑仍需按模型部署说明自行准备依赖和合法来源权重。

兼容 H.264 / yuv420p / AAC 的 MP4 副本保持原字节。其他输入由本机 FFmpeg 转为 H.264 MP4，原片保留；轨迹按播放副本的实际解码时间生成并核验。`importSourceSha256` 记录源文件身份，导入草稿增加本地命名空间，避免与相同视频的旧样例串用。新模型加入时保留已有版本的 fingerprint 和默认设置。球场 / 脚部候选仍按现有工具操作，本轮不会自动生成其预计算结果。

## 接口与失败处理

- `GET /api/video-library`：扫描文件夹，返回文件、可用版本、处理状态、路径和方案说明。
- `POST /api/video-library/import`：`application/octet-stream` 原始文件字节；`X-Video-Filename` 为 URL 编码的文件名。限定大小，拒绝路径和危险文件名，解码检查通过后才入库。
- `POST /api/video-library/process`：JSON `{ "id": "local-<SHA256>", "variant": "team-stable" }`，返回排队或已有结果。同一视频重复启动复用在途任务，任务串行，失败可重试。
- `GET /api/library`：继续返回已可打开的样例，增加 `processingPresets`。
- `GET /api/clip`：导入样例增加 `importSourceSha256`；旧样例为 null。已有接口、草稿和裁切格式保持兼容。

新写接口限定当前 loopback Host / Origin，不接收任意文件路径或任意执行命令。生成完整结果后先验证源视频哈希、解码帧数、PTS 和检测契约，再原子保存清单。失败不覆盖已经发布的结果，页面给出日志位置。关闭浏览器后处理继续；服务被终止的任务不会自动续跑，可在重启后重试。文件仍在文件夹中时可再次选择；已生成的缓存独立于原文件。

## 本轮验证

- 前端 246 项、相关 Python 93 项通过（先运行相关集 92 项，再追加转码用例并复验视频库 11 项）；包含真实 HTTP 导入、解码拒绝、去重、重名、越界文件名、大小、失败重试、重复启动、重启恢复、旧草稿隔离和新增模型后 fingerprint 保留。
- 独立 8891 测试库导入 004（210 帧），从真实页面启动 THY 完整方案和原 YOLO 两次 GPU 全片处理。帧数、视频 SHA 一致；顶部切换和一键回到推荐方案正常。
- 真实页面验证桌面、900×650 和 390×844 窗口，无整页横向溢出；临时尺寸已恢复。视频选择、推荐标识和本地文件夹路径可见。
- 浏览器扩展缺少本地文件访问权限，自动文件选择无法完成，因此不声称真实浏览器文件选择上传已通过。上传入口的文件字节、进度 / 错误回调用前端测试验证，真实上传和解码用 HTTP 验证，之后的模型处理及打开通过真实页面操作。
- 8890 正式地址已重启加载新后端，标准目录与运行环境可用。测试库和正式库分开，用户正式页面的标注未代操作。
