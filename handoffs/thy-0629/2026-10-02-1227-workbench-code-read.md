# 交接：测试视频复制与球场工作台源码了解

- 日期 / 时区：2026-10-02 12:27，Asia/Shanghai
- 成员：thy-0629
- 任务 / Issue：用户要求复制测试视频到剪贴板，拉取远端并了解新推送的工作台；未新建 Issue
- 分支：main
- 提交：本次未提交；HEAD 与 origin/main 均为 `6b3d7f7455d2bcdce821808e5ff0f238f86dee57`
- 状态：视频复制、远端同步、源码梳理和前端逻辑测试已完成

## 本次完成

- 将 `artifacts/player-test-005-20261002/tracked.mp4` 设置为 Windows 剪贴板的文件列表，实际读取确认该文件存在于剪贴板，可由用户到微信粘贴。未代用户发送消息。
- 实际执行 fetch 和 `pull --ff-only origin main`，返回 Already up to date；远端没有比上次测试期间拉取的版本更新。保留原有未提交实验报告、草案和状态修改。
- 前端与后端分开只读了解工作台，梳理操作、身份分界、裁切、时间契约和导出。重要代码入口见下方。

## 结论与依据

来源为本机当前源码与 JSON、Git 远端核对，读取日期 2026-10-02；工作台发布包含于 [486e8b9](https://github.com/Linzeyu912/courtstory/commit/486e8b99c07c7b76212799b8e81de1bd4f6f8032)。

- [前端入口](../../engineering/tools/player-review/app.mjs)、[身份面板](../../engineering/tools/player-review/identity-ui.jsx)、[工作区](../../engineering/tools/player-review/workspace.mjs)：人工筛选直播区间 → P1–P10 对应球员 → 修正 T 编号及补轨迹 → 导出。姓名、球队和号码由人工填写。
- [身份时间规则](../../engineering/tools/player-review/identity-timeline.mjs)：`forward_only_v1`，从确认帧向后生效，下一次确认或切镜形成边界；竞争者只释放实际重复占用的错误帧，位置编辑与身份修正分开。新 UI 草稿默认关闭自动插值。
- [轨迹与导出](../../engineering/tools/player-review/trajectory.mjs)：内部 schema 2，含固定身份、原图 / 球场轨迹、来源帧与时间、未解决区间和来源标记。`allFramesManuallyVerified:false`、球场 `metricAccuracyValidated:false` 保留；十人完成按钮不代表所有位置已准确核验。
- [本机服务](../../engineering/scripts/serve_player_review.py)：提供视频库、候选 JSON、视频 Range 与人工裁切，读取预先生成的检测，不在服务中运行模型。按实际视频 SHA / 连续帧 / PyAV 解码时间校验，时间差阈值 1 ms。
- [裁切](../../engineering/scripts/review_video_trim.py)：真实挑帧编码、更新候选时间和来源映射，在不连续保留区间设置切镜；正式缓存可恢复，当前只编码视频流，会生成无声剪辑。
- 草稿存在浏览器 localStorage，按视频哈希 / 跟踪版本 / QA 区分；裁切文件和库登记保存在本机忽略目录。

## 本次实验接入前须保留的边界

- [本次 LAL–MIN 检测](../../research/vision/player-test-20261002.md)尚未导入工作台，不替换库内 sample `005`。库内 `005` 是 SAS–MIA、143 帧；本次是 LAL–MIN、267 帧，哈希与身份草稿不同。
- 实验 `frames.json` 是对象包裹的帧数组；工作台需要顶层数组，每帧含 `frame/time/tracks/pending_detections/candidate_count`。
- tracks 行为 `[x1,y1,x2,y2,trackId,confidence,classId]`，无 ID 候选另放 `pending_detections`；保留篮球模型 player class 2，不能沿用通用 COCO 的 class 0 处理。
- 原 LAL–MIN 视频首帧为 0.120 秒，须使用实测容器时间，不能把 `i / 25` 直接作为输入 `time`。
- 模型框是候选，T 不是姓名。尚未接入自动 OCR、2K 能力联接、战术分析及讲解。

## 验证

- 独立前端和后端阅读者均依据源码核对，不把 README 历史测试当本轮证据。
- 本轮实际执行全部 `*.test.mjs`：46 项通过、0 失败。日志 `artifacts/workbench-code-read-20261002/node-tests.log`。
- 本次没有启动服务或进行浏览器 QA，没有重跑模型、安装依赖或改变正式草稿；上述测试验证逻辑，不代表球员身份 / 米制精度已验收。
- HEAD 与 origin/main 哈希一致，原有未提交工作保留；剪贴板文件列表末次核对仍包含测试视频。

## 阻塞与待确认

本次请求无阻塞。后续若将 LAL–MIN 结果接入工作台，需独立样例登记与格式适配；裁切后保留音轨另需处理时序。

## 下一步

可继续使用现有工作台承接人工确认和轨迹修正。若用户要求接入刚才的模型输出，再实现数据适配与实际端到端验证。

## 同步状态

此次只拉取远端和了解代码，没有提交或推送。本交接仍在本地；不把本机实验或视频称为云端成果。
