# 交接：画面说明随视频吸附

- 日期 / 时区：2026-10-09 22:48，America/New_York（UTC-04:00）。
- 成员：chuali-zi。
- 任务 / Issue：用户截图要求向下浏览右侧工具时，左侧画面说明持续贴在视频左边；未指定 Issue。
- 分支：codex/courtstory-ui-broadcast；基于当前 main 57e8ecc 的独立工作区。
- 提交：本地未提交、未推送。
- 状态：样式修改与浏览器验证完成。

## 本次完成

- 修改 `engineering/tools/player-review/broadcast-studio.css` 的桌面三栏规则，为说明栏增加 sticky 与 12px 顶部间距，和视频对齐。
- 说明栏最高为视口减 24px，超高内容在栏内滚动；1050px 及以下不启用说明栏吸附。
- 本机 8892 预览改从 UI 工作区读取同版本代码及新样式，继续使用原视频、草稿目录和启动配置。主 checkout 保持 main。

## 结论与依据

- 原样式只给视频设置 sticky，说明栏会随整页滚走。本次复用相同布局，只新增一条 CSS 规则。
- 来源为本聊天用户截图和明确指令，以及当前页面实际 DOM；未调整业务操作。

## 验证

- 真实官方训练 001 页面，在 1440×650 视口滚动到 scrollY=242 后，说明栏与视频 top 均为 12px。
- 展开审核状态与来源后，说明栏 clientHeight=624、scrollHeight=1010，栏内可滚动至底部，视频位置保持。
- 390×844 下说明栏 position=static、视频 position=relative，页面 scrollWidth=375，无横向溢出；已恢复原窗口尺寸与折叠状态。
- UI 分支 `git diff --check` 通过。仅 CSS 修改，未新增或运行业务单元测试；未改用户直播区间或触发剪辑。
- 本地预览图保存在本 UI 工作区的忽略目录 `tmp/sticky-info-preview/preview.png`。

## 阻塞与待确认

- 无本次布局阻塞；后端功能问题沿用此前记录，本轮未处理。

## 下一步

- 用户在球员标定长工具区继续实测吸附体验。

## 同步状态

- 修改仅在 UI 工作区，未合入 main、未推送或部署。
