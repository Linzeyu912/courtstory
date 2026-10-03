# 交接：未来路线阶段播放与同步视频

- 日期 / 时区：2026-10-03 18:17，Asia/Shanghai
- 成员：thy-0629
- 任务 / Issue：用户要求编辑可平滑未来路线，并在阶段冻结点暂停播放；本次为 Task3 播放接入。未创建或修改 GitHub Issue。
- 分支：main
- 提交：基线 `0765d2488a2aab0bdf7c395deeaad71f3280f979`；本轮选择性本地提交包含此文件，未推送。
- 状态：实现与必要程序验证完成；统筹代理已通过主要真实播放验收，等待独立最终代码审阅。

## 本次完成

- `engineering/tools/player-review/tactics-playback.mjs` 以已呈现帧驱动纯状态机。选择阶段定位冻结帧，继续跨过下一冻结点时 pause + seek 精确定位；末阶段在最后一帧停止。暂停、重播、外部回退和退出取消旧播放意图，不反复触发同一冻结点。
- `app.mjs` 桥接已呈现 canvas、媒体时间、明确 play / pause / seek；保留 `frameAtMediaTime` / `frameSeekTime` 的已有时间量化处理。底部播放按钮复用战术控制器，时间轴及前后帧导航保持暂停。
- `tactics-ui.mjs` 复用已有稳定背景 canvas / SVG 和路线 model；每帧只裁剪缓存曲线并用当前帧标定投影。播放时无标定继续显示已解码视频、隐藏视频路线并提示。目标帧尚未呈现时隐藏旧画面，避免新阶段路线覆盖旧背景。画内无球员编号、姓名或动作说明。
- `video-display.mjs` 增加明确 `play()`，同目标边界 seek 的重入在回调结束后补呈现；直接外部 seek 可以替代尚未完成的旧目标。定位容差与注释帧归属统一到微秒，避免已呈现末帧而 currentTime 尚落在前一帧时卡住。更新静态模块路由，并重建 `ui.bundle.mjs`。
- 保留 Task2 应用前完整 stamp、应用后同 document / context / phase / loading guard 和 sceneReady 前 busy，慢 IndexedDB 期间的文字修改继续保留。草稿排队、CAS、工作区 / 候选和 QA / 正式隔离保留。
- 文档更新：`engineering/docs/workbench-integration.md`、`engineering/docs/future-route-editor.md`。JSON 包含独立 presentation；现有 HTML 报告继续只导出既有动作审核，不包含新平滑路线或人工展示修正。

## 结论与依据

- 输入依据为本次 Task3 brief、Task2 审阅后基线及实际播放 / 编辑接口；不修改原视频、review、身份或动作审核来修正展示。
- 播放背景使用浏览器已成功绘制的同帧解码 canvas；实时工作台不请求冻结 JPEG。后端精确 JPEG 接口仍服务静态报告与未接播放器的独立预览。
- 程序测试只验证交互、来源边界和同步行为，不确认球员身份、接地点、标定精度或战术判断。

## 验证

- 新状态机关键行为先观察失败再实现：跳帧跨冻结、最后帧、重播、暂停、外部 seek、退出。真实 mount UI 回归覆盖零 JPEG、model / canvas 复用、无标定、阶段准备期间外部 seek、慢 seek 不显示旧背景。video-display 组合覆盖精确命中边界 / 末帧和跨帧回 seek。
- 完整 Node：`node --test engineering/tools/player-review/*.test.mjs engineering/tools/tactical-overlay/*.test.mjs`，349 项，348 通过 / 1 Windows 符号链接权限跳过 / 0 失败。日志在被忽略的 `artifacts/future-route-editor/task3-node-verified-tests.log`。随后最后一处退出幂等调整的状态机 / mount UI 定向 5 项通过，重复非战术导航不再暂停普通播放器。
- Python：`C:\python313\python.exe -m unittest discover -s engineering/scripts -p test_tactical_workbench.py`，6 项通过。日志 `artifacts/future-route-editor/task3-python-tests.log`。
- `npm run build` 成功；esbuild `write:false` 再构建输出与保存 bundle / LEGAL 逐字节相同。app / UI 语法与 `git diff --check` 通过。真实验收曾发现未构建 bundle 使旧播放器缺少 play，已重建并复验；更新源码后部署必须包含对应产物。
- 统筹代理在独立 8892 QA 服务真实观察：阶段 1 第16帧暂停 → 播放第23帧 → 第41帧自动暂停 → 第91帧自动暂停 → 第143帧末阶段停止，完成后叠加 path / circle / text 为 0、视频 canvas 可见；阶段重播从第91帧推进，暂停、前一帧、时间轴回第1帧及播放中退出均通过。返回后 P2 人工修正仍保留。第41帧18条 polyline 播放到第48帧减为12条，无文字；第109帧缺标定仍显示1920×1080视频、路线为0并提示。真实 QA 又发现从第109帧继续时 native currentTime 落后 RVFC 548µs 会卡末帧，定向测试先红后绿后，浏览器复验第143帧 / timeline 一致、currentTime=4.733335、末阶段结束且可重播。独立记录位于 `artifacts/future-route-editor/browser-playback-qa.md`。

## 阻塞与待确认

- 没有已知实现阻断；独立最终代码审阅与补充浏览器证据由统筹代理完成。
- 实际轨迹、身份和标定质量待人工审核；静态 HTML 报告的绘制范围与实时未来路线不同，页面与导出正文均已标明。

## 下一步

- 统筹代理以本轮提交进行独立审阅，发现阻断再定向修复；不把程序通过作为真实战术准确率结论。
- 运行环境需要重新构建或分发同步的 `ui.bundle.mjs`。本轮只本地提交，后续远端同步须按用户授权范围执行。

## 同步状态

- 仅选择性提交 Task3 文件到 main，不创建分支 / worktree，不推送、不派生代理。
- 统筹代理的 spec / plan 未提交改动与所有原有未跟踪文件保持原样；QA 视频、草稿、日志与截图仍留在被忽略的独立目录。
