# 交接：本地视频文件夹、导入与显式模型选择

- 日期 / 时区：2026-10-03 11:40，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户要求集中视频文件夹、工作台选择 / 导入，以及可见的模型选项和历史首选推荐；GitHub 开放 Issue 查询为空。
- 分支：main。
- 提交：本轮未提交、未推送。开工从 c0d2dcf 快进至 origin/main 的 21d24df，保留全部此前未提交改动。
- 状态：已完成本地实现及验证。

## 本次完成

- 顶部常驻当前视频、视频库 / 导入、模型方案与推荐按钮，原折叠区保留模型来源说明。
- 建立 `data/local-videos/` 本地入口，支持子目录扫描、批量上传、按内容去重、同名不同内容保护。媒体被 Git 忽略；只新增[目录说明](../../data/local-videos/README.md)。
- 新视频通过本机串行 GPU 任务生成完整跟踪结果；保存状态、结果与日志，成功后打开，失败可重试。已有结果、旧视频和草稿保留。
- 本地导入草稿增加命名空间，避免相同视频字节的历史 original 草稿串用。增加模型时保留已有模型 fingerprint；顶部能选择待处理方案。
- 将已存在整合目录中的固定版本 Ultralytics 和两份权重复制到标准忽略目录。新建 `tmp/model-runtime/`，复用视觉依赖；不升级旧环境，没有外网下载。
- 已重启 8890 正式服务，PID 30592，标准视频文件夹与推理环境可用。用户原有正式页没有被代操作；浏览器测试采用 QA 草稿。

主要代码：[本地库与任务](../../engineering/scripts/local_video_library.py)、[处理入口](../../engineering/scripts/process_local_video.py)、[服务接口](../../engineering/scripts/serve_player_review.py)、[视频库界面](../../engineering/tools/player-review/video-library.mjs)、[顶部界面](../../engineering/tools/player-review/index.html)、[草稿键](../../engineering/tools/player-review/trajectory.mjs)。说明见[本地视频库](../../engineering/docs/local-video-library.md)与[工作台说明](../../engineering/tools/player-review/README.md)。

## 结论与依据

- 本轮通过 read_thread 查阅历史聊天「新建分支并推送本地内容」（01a0fcd8-2c63-7e41-84b7-7e7312494071）。其中用户 2026-10-02 明确要求 THY 全方案加推荐，因为此前选择中效果最好；当时整合交接见[22:29 记录](2026-10-02-2229-selected-integration.md)。
- 沿用 `team-stable`：E-BARD YOLOv8n + BoT-SORT / 原生 ReID 综合优化与稳定显示。不把人工选型写成独立准确率排名，不重新挑选外部模型。
- 原有四个样例直接切换全部预计算版本。新视频支持 team-stable、yolo、optimized、reid、low、baseline；旧样例的 E-BARD / ByteTrack 保留。
- 支持 MP4、MOV、MKV、WebM、AVI；页面每文件最多 2 GB，更大的视频直接放文件夹。兼容 MP4 复制保持字节，其他格式由已有 FFmpeg 转为播放副本，原文件不改。

## 验证

- 全部 246 项前端测试通过，后续小幅调整重复任务提示后复验 5 项视频库测试。新增覆盖真实文件对象传递、失败重试、未处理模型分流和草稿隔离。
- 相关 Python 集 92 项通过；追加 FFmpeg 转码用例后视频库 11 项全部通过，共覆盖 93 个不同后端测试。Windows 沙箱的 TemporaryDirectory ACL 阻止 PyAV 写入，获准使用正常权限后通过。
- 独立 8891 测试库经 HTTP 导入 004，真实页面点击处理 THY 完整方案与原 YOLO，两次 GPU 全片运行各 210 帧；新增三个可用版本，视频 SHA / 帧数一致，结果重启可恢复。
- 真实浏览器验证顶部视频 004 → 005 后 1920×1080 视频 readyState=4；原 YOLO → 使用推荐方案恢复 team-stable；待处理模型正确打开视频库并预选。900×650 与 390×844 下无整页横向溢出，临时 viewport 已恢复。
- 浏览器扩展未启用本地文件 URL 权限，自动 setFiles 失败；未改扩展权限，不声称真实浏览器文件选择上传通过。前端上传回调由测试验证，真实文件上传 / 解码走本机 HTTP，模型处理和打开走真实页面。
- 主页面截图：[常驻视频与模型入口](../../artifacts/video-library-20261003/workbench.jpg)。原截图接口超时，改用页面区域截图成功。测试视频和处理产物均留在独立忽略目录。
- 本机标准模型检查确认 Python 3.12.10、torch 2.11.0+cu128、Ultralytics 8.4.171、PyAV 17.0.0、RTX 5070 Laptop GPU；模型 SHA 与已有部署说明一致。
- React bundle 已构建。语法、文档路径和 git diff 空白检查通过。

## 阻塞与待确认

- 功能无阻塞。浏览器自动文件选择受扩展权限限制，上述测试边界已明确记录。
- 未重新评测模型准确率、长视频内存 / 耗时；新视频不自动预计算脚部或球场候选，继续使用现有标定工具。

## 下一步

- 用户刷新 8890，在「视频库 / 导入」放入自己的视频并选择方案。
- 如需同步，另按用户授权选择性提交本任务及此前本地改动；不要把权重、依赖、测试视频或处理缓存提交。

## 同步状态

- 已 fetch 并核对远端新增战术叠加文件与本地改动无重叠，安全快进 main 至 21d24df，未覆盖已有工作。
- 所有本轮功能和交接仍未提交推送；未创建分支或 PR。
