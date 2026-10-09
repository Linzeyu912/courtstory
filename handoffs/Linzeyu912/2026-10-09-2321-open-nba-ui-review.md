# 交接：打开 NBA 新 UI 工作台供审核

- 日期 / 时区：2026-10-09 23:21，Asia/Singapore（UTC+8）。
- 成员：Linzeyu912。
- 任务 / Issue：用户要求展开新 UI 工作台进行审核；沿用本聊天 UI 专用分支范围。
- 分支：`codex/courtstory-ui-broadcast`。
- 提交：本轮无代码提交；既有 UI 提交仍为 `eeb9169`。
- 状态：本机服务已启动，内置浏览器工作台已打开并保留标签。

## 本次完成

- 重新启动 UI 分支的真实 `engineering/scripts/serve_player_review.py` 服务，监听本机 8900。
- 审核入口：[NBA 新 UI 工作台](http://127.0.0.1:8900/?sample=005&qa=1)。
- 使用已有隔离验收库与战术草稿的副本，运行资料放在本分支忽略目录 `tmp/ui-review-20261009/`。源视频 / 跟踪资料只读复用，新的服务状态、导入、裁剪和草稿目录均在 UI worktree。
- 页面加载 005 SAS–MIA 示例，使用当前 NBA 主题，保留四个工作区。身份 provider 采用未配置的 `multimodal-api` 预览设置；本輪没有发起模型或配音调用。

## 验证

- 首页与 `broadcast-studio.css` 均 HTTP 200，HTML 确认加载当前主题。
- 内置浏览器实际显示 CourtStory 工作台、四个工作区入口与 005 视频帧，标签已标为交付后保留。
- main 工作区仍干净。没有修改 UI / 业务代码，没有推送或部署。
- 本轮只核对启动和展示，没有重新执行功能或模型验收；此前范围见[工作台集成说明](../../engineering/docs/broadcast-studio-workbench-20261009.md)。

## 阻塞与待确认

- 无；等待用户审阅界面反馈。

## 下一步

- 按用户指出的具体页面和位置，在本 UI 分支继续设计。
- 服务输出和错误日志为 `tmp/ui-review-20261009/stdout.log`、`stderr.log`，当前进程信息在 `server.json` 与 `process-id.txt`。本机进程停止后需重新启动。

## 同步状态

- 所有本轮运行资料与记录只在 UI worktree；未提交、未推送，未改 main 或云端。
