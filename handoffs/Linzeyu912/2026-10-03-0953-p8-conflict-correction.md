# 交接：P8 冲突后无法重新选人的纠正入口

- 日期 / 时区：2026-10-03 09:53，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：本会话用户现场验收反馈“初始 P8 指定到 8 后不显示蓝 / 红框”；本轮前已核对远端，无对应开放 Issue。
- 分支：当前既有 `codex/local-workbench-20261002`
- 提交：本轮修复未提交；开始时 HEAD 为 `38ce2fb7852d1285d91cfada863d87ca92f60d8f`
- 状态：本地修复和验证完成，供用户继续验收

## 本次完成

- `engineering/tools/player-review/trajectory.mjs`：新增原子化 `correctFrameIdentity`，单帧明确绑定并确认，保留邻帧和同 T 人工几何。
- `engineering/tools/player-review/app.mjs`：冲突时点击只预览，接入单帧 / 向后纠正；登记后按实际有效状态显示确认或冲突提示。
- `engineering/tools/player-review/identity-ui.jsx`、`pipeline.css`：新增冲突原因、候选预览、两种范围按钮；同步画布与下拉预览。
- `engineering/tools/player-review/frame-identity-review.test.mjs`：新增 4 项 P8 场景回归；重建 `ui.bundle.mjs`。
- 工程说明：`engineering/docs/track-identity-review.md`、工具 `README.md`。

## 结论与依据

- 2026-10-03 正式页面 004 / team-stable 中，P8 已累计 T2、T7、T8、T9、T10、T12、T55，多个编号同帧重叠导致身份冲突。此现象不能证明 YOLO 漏检或跟踪器没产生候选；原交互缺少明显的冲突纠正入口。
- 当前 P 槽位编号与 T 临时编号不同，P8 不必对应 T8。测试使用 T8 只验证操作机制，真实人物由用户目视选择。
- 保留原检测及正式草稿，没有代用户批量更改真实身份。冲突通过明确人工规则解决，原累计记录仍可追溯、撤销。

## 验证

- 独立修复前端全套 233 / 233；另一工作任务加入审核状态代码后，共 239 / 239 通过。日志：本机 `artifacts/p8-conflict-frontend-tests.log`、`artifacts/p8-conflict-combined-tests.log`。
- bundle 构建、`node --check app.mjs`、`git diff --check` 通过。
- 真实片段第 41 帧七个 T 冲突夹具：本帧改选后其余 209 帧一致；后端 `review-edit` 往返、槽位交换及导出保留确认。证据：`artifacts/p8-conflict-http-check.json`。
- 浏览器隔离 QA：P8 归并 T1 后再归并 T8 产生冲突，提示未确认；仅本帧纠正恢复实线，第 2 帧仍冲突；向后纠正后第 2 帧为未确认虚线；每次撤销准确恢复。最终全部测试标注撤销，恢复测试前 2 人工 / 8 建议状态，控制台无 error。
- 纠正后截图：本机 `artifacts/p8-conflict-corrected.jpg`，属于测试模式截图，不代表正式身份验收结果。
- 视频元数据 / 暂存索引：5 数据集、142 条元数据、142 个 LFS 指针通过。未重跑全库视频字节检查；本机仍有无关视频 LFS 字节未下载的既有限制。

## 阻塞与待确认

- 同一工作目录中的另一活跃任务“改进球场标定与二维映射”正在修改 `app.mjs`、`pipeline.css`、`calibration-guide.mjs`、`workspace.mjs`、`tracking-display.mjs`、`index.html` 和新增 `review-status.test.mjs` 等。其改动保持原样，本轮不把混合文件整体提交，也不切换分支覆盖工作。
- 真实人物及纠正范围仍由用户验收；当前修复没有替用户猜测 P8 应对应哪个 T。

## 下一步

- 打开本机端口 8890 的 004 / team-stable，选择 8 号槽位，在冲突面板预览正确人物，选择仅本帧或向后采用。
- 两项本地任务结束后按最新用户同步授权和仓库工作流整合提交，注意 `app.mjs`、`pipeline.css` 的不同修改范围；不要遗漏已重建的 bundle。

## 同步状态

- 此前 `38ce2fb` 已在原独立分支同步；本轮 P8 修复保留本地，未新建分支、未合并、未推送到 main。
- 本轮交接及截图中的结果都是本地验收结果，不代表云端已部署。
