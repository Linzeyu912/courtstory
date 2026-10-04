# 交接：修复球场标定后导入视频的模型加载失败

- 日期 / 时区：2026-10-04 21:01，Asia/Shanghai（UTC+08:00）
- 成员：Linzeyu912
- 任务 / Issue：用户反馈桌面全场视频导入后 `basketball_run.py` 退出；当前打开的 GitHub Issue 列表为空。
- 分支：main
- 提交：未提交、未推送。
- 状态：本地修复完成，完整导入和页面播放通过。

## 本次完成

- 新增 `engineering/scripts/yolo_checkpoint.py`：提取既有 E-BARD 明确架构允许列表，人物和原 E-BARD 检测入口共用；强制受限加载，未知类型仍拒绝。
- `engineering/scripts/basketball_run.py` 使用共享加载器；`engineering/scripts/benchmark_ebard.py` 保留原 `load_detector` 导出入口，由共享模块实现，配套球 / 筐 / 裁判流程兼容。
- `engineering/scripts/workbench_runtime.py` 优先提取底层错误，而不是只显示末尾 `CalledProcessError` 的长命令。权重加载不兼容给出可读摘要，详细日志继续保留。
- 新增 `test_yolo_checkpoint.py`，补充 `test_workbench_runtime.py` 的嵌套异常回归。
- 更新 `engineering/docs/model-deployment.md` 与 `docs/status.md`。

## 结论与依据

- 本次失败日志位于本机 `artifacts/thy-sync-20261004/imports/local-994c43388a2c31a44fcc8259bba1d4d71abab0dd439aed46da09c22e14012b23/9b8378d5935d496a84c04ece03a7be2d/processing.log`。
- 实际错误为受限反序列化拒绝 `ultralytics.nn.tasks.DetectionModel`。球场模型将 `TORCH_FORCE_WEIGHTS_ONLY_LOAD=1` 写入服务环境，识别子进程继承；原人物入口缺少相应允许类型，原 E-BARD 对照入口已有正确处理。
- 实测权重 SHA-256 与已核验值一致，不是视频上传失败、权重损坏或 BoT-SORT 算法错误。未更换权重、跟踪器或依赖版本，未改球场几何算法。
- 新运行目录为同一视频缓存下的 `3a336492d9c244b8a5a94f77270df54b/`。失败目录保留，新的 `sample.json` 已通过后端验证并登记至本地库。

## 验证

- 受限环境中实际加载两份已部署权重（篮球 YOLOv8n、通用 YOLOv8s）成功，允许类型上下文退出后恢复；未知类型测试确认在构造 YOLO 前拒绝。2 项通过。
- 错误展示 / 运行环境 3 项、视频库 22 项通过，共 27 项 Python 测试。
- 从真实浏览器点击“重试识别”，完整生成 `optimized`、`team-stable`、`ebard` 配套参照各 1080 帧，逐帧编号和时间戳严格递增，范围 0–35.966666667 秒。
- 当前人物结果 metadata 明确为 `detector=ebard`、`tracker=botsort-reid`、`profile=optimized`，当前页面为 `variant=team-stable`。独立 `ebard` 参照提供球 / 筐及裁判候选，不替代当前人物 BoT-SORT 结果。
- 桌面源片哈希保持 `994c43388a2c31a44fcc8259bba1d4d71abab0dd439aed46da09c22e14012b23`；浏览器兼容副本哈希为 `33451144346166310ddbe3f74e6eca6394ac9f17de12e68311306c3170da39ea`，分别与登记字段一致；模型哈希不变。
- 等后台任务完成后重启 8903 服务，沿用原视频库 / 缓存 / 战术目录，新服务实际 PID 27504（启动父进程 20808）。结果从磁盘恢复成功，浏览器重载、末帧定位、播放及暂停均通过可见画面验证。
- 本机证据：`artifacts/import-checkpoint-fix-20261004/`，含测试日志、完整结果核对、浏览器状态、首尾 / 后段截图及服务日志。
- 本轮验证的是导入和识别流程恢复；身份、脚点、球场和 2D 精度仍需各自核对。

## 阻塞与待确认

- 无本轮阻塞；未进行新的跟踪器精度比较或全场标定验收。

## 下一步

- 已打开这段全场视频，可继续人工核对人物与球场。

## 同步状态

- 开始时已 fetch；本地与 `origin/main` 同为 `aada11c039d877bf326f3c6369393b178ddfab87`，领先 / 落后为 0。
- 代码、文档与交接留在本地，未提交推送，其他任务未提交工作保留。
