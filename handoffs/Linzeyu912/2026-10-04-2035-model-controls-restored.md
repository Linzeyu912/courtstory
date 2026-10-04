# 交接：恢复顶部 YOLO 检测器和跟踪器选项

- 日期 / 时区：2026-10-04 20:35，Asia/Shanghai（UTC+08:00）
- 成员：Linzeyu912
- 任务 / Issue：用户要求恢复消失的 YOLO 人物检测模型和跟踪器选择入口；本轮同步检查未发现新增远端提交。
- 分支：main
- 提交：本次改动未提交、未推送。
- 状态：已完成本地修复和验证。

## 本次完成

- `engineering/tools/player-review/index.html`：将检测器、跟踪器和应用按钮从默认关闭的“模型设置”中移出，恢复为视频工具栏常驻控件，沿用原有控件 ID 和事件逻辑。
- `engineering/tools/player-review/pipeline.css`：恢复直接显示的布局，窄窗口分行排列。
- `engineering/tools/player-review/tactics.css`：移除战术页独立隐藏模型控件的样式，统一工具栏布局。
- `engineering/docs/model-selection-layout.md`：补充本次入口恢复说明。
- 本地证据：`artifacts/model-controls-restore-20261004/`，包含修改前备份、浏览器检查结果、测试日志和截图。

## 结论与依据

- 依据 2026-10-04 本地源码和工作台浏览器验证：选项未从模型注册表删除，而是被默认折叠入口及战术页隐藏样式遮蔽。
- 检测器仍为 `YOLOv8n · 篮球`、`YOLOv8s · 通用`；跟踪器仍为 `BoT-SORT · 外观续接`、`ByteTrack`。
- 当前样例 005 保持历史 `variant=ebard`，选择框恢复为进入任务时的 `ebard` + `bytetrack`。历史结果与新参数组合 `ebard-byte` 不等同，因此“识别并应用”提示仍然有效。没有点击应用或触发推理。

## 验证

- `node --test model-selection.test.mjs video-library.test.mjs`：15 项全部通过。
- 浏览器逐一选择四种检测器 / 跟踪器组合，应用按钮状态与提示正常，最后恢复原选择。
- 浏览器依次检查“数据核对与处理”“战术制作”“保存与导出”“球员与球场检查”：两个选择框均可见。
- 原视频和候选标注可见；最终浏览器错误日志查询为空。
- 对相关文件执行 `git diff --check`，通过。
- 本次仅调整 HTML/CSS，未重新运行模型推理；自动化单元测试不等同于模型精度验证。

## 阻塞与待确认

- 无本地功能阻塞；本次未获得提交推送指令，保留工作区已有其他未提交修改。

## 下一步

- 用户可直接使用顶部选择框；选定组合后由应用按钮切换已有结果或发起识别。

## 同步状态

- 本轮已 fetch；核对时本地 HEAD 和 `origin/main` 均为 `aada11c039d877bf326f3c6369393b178ddfab87`，领先 / 落后均为 0。
- 本次界面修复及工程文档、交接仍在本地，未声称云端已更新。
