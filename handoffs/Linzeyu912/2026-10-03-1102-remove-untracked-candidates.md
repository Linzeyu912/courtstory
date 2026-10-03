# 交接：移除橙紫候选与无 T 补帧功能

- 日期 / 时区：2026-10-03 11:02，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：用户要求先整体移除橙色未跟踪、紫色已抑制候选及其补帧功能，减少干扰；本轮 GitHub 开放 Issue 检索为空
- 分支：main
- 提交：未提交；基线 `c0d2dcfc62f163a67741a2bea0225c4f78752958`
- 状态：本地功能移除、构建与验证完成

## 本次完成

- [人物候选](../../engineering/tools/player-review/tracking-display.mjs)增加仅接受 T 观测的工作台入口；点击命中拒绝无 T、未跟踪及抑制分区。
- [工作台入口](../../engineering/tools/player-review/app.mjs)移除无 T 预览与补入分支，关联入口拒绝无 T 输入；[自动候选](../../engineering/tools/player-review/automatic-annotations.mjs)同样不再提供未编号检测。
- [身份逻辑](../../engineering/tools/player-review/identity-timeline.mjs)删除 `confirmUntrackedFrame` 写入函数；已有草稿中的人工位置、绑定及审核记录继续兼容。
- [页面](../../engineering/tools/player-review/index.html)、[人物面板](../../engineering/tools/player-review/identity-ui.jsx)及[样式](../../engineering/tools/player-review/pipeline.css)移除橙紫图例、列表提示与分区计数；开关显示“跟踪候选”，摘要只显示 T 候选数。
- 保留上一轮 T 标签与红蓝队对应，更新[工作台说明](../../engineering/tools/player-review/README.md)和[编号审核说明](../../engineering/docs/track-identity-review.md)，重新构建前端 bundle。

## 结论与依据

- 依据为本聊天用户要求及 2026-10-03 核读的本地源码 / [在线工作台](http://127.0.0.1:8890/?sample=004)。本次为内部工作台取舍，不是赛事要求。
- 模型选择、模型权重、推理参数、已保存的检测记录均未改动，未重新推理；未将用户对模型准确率的判断写成新增测量结论。
- 原始未跟踪 / 抑制分区仍保留用于来源校验，人物审核界面不再提供显示和补入操作；历史人工位置可读取、导出和删除，不因功能移除清空用户标注。
- 正常 T 归并、红蓝队对应、逐帧确认、球 / 筐及已有位置编辑继续沿用原流程。

## 验证

- 70 项相关 JavaScript 测试通过，包含画布 / 候选列表不提供无 T 检测、隐藏候选无法拦截点击、直接补入请求被拒绝且不改草稿、普通 T 关联 / 撤销、历史人工记录兼容，以及原始检测证据不被删改。
- `node --check` 通过；使用已安装 esbuild 原生命令重建 `ui.bundle.mjs` 成功。
- Chrome 独立测试草稿检查 004 第 1 帧和第 33 帧：列表均只有 10 个带 T 候选；原未跟踪和抑制选项、提示与图例已消失。第 33 帧实际截图确认保留正常红蓝框与编号。
- 截图位于被忽略的 `artifacts/tracked-only-20261003/preview.jpg`。全页截图两次超时，改用已读取边界的工作台区域截图成功。
- 用户正式标签页及正式草稿未操作。测试中仅在 QA 草稿保留并应用整段直播范围，没有新增人物标注；收尾时测试标签页已不存在，未能通过该页撤销这两步，QA 范围记录可能仍留在浏览器测试命名空间。
- 9 份修改后的在线运行文件与本地文件逐字节一致。相对文档链接和 `git diff --check` 通过。

## 阻塞与待确认

- 无功能交付阻塞。模型真实准确率、跟踪串人与真实分队仍按原有人工验收流程判断。

## 下一步

- 刷新原工作台页面加载精简后的候选显示；继续使用正式草稿核对 T 对应。

## 同步状态

- 本轮 fetch 成功，HEAD 与 origin/main 均为 `c0d2dcf`；现有未提交的红蓝队配色和三份早先交接保持。
- 当前功能、说明和本交接只在本地，未提交、推送或创建 PR。
