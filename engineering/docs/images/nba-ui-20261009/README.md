# NBA UI 参考图

本目录按各轮采集时间保留原图，正文工作区可能早于最新 main；灰色图案基准不随正文布局变化。本轮整合后的桌面／手机顶栏已再次验证，发布范围见[TEAM 25 发布记录](../../ui-team25-publication-20261010.md)。

**灰色图案定稿基准：** 用户于 2026-10-10 11:03（Asia/Singapore）确认固定下方 `workbench-team25-angle-20261010.png` 中的灰色线条图案及位置；参数和后续维护边界见[定稿规范](../../broadcast-studio-style-20261009.md#灰色图案定稿)。

[workbench-team25-angle-20261010.png](workbench-team25-angle-20261010.png)：2026-10-10 11:01（Asia/Singapore）最新桌面顶栏，右侧灰色球场线向右下方倾斜 7°，与黑栏边界形成角度；字号、颜色、留白和黑栏高度沿用上一轮。[交接](../../../../handoffs/Linzeyu912/2026-10-10-1101-angled-header-line.md)。

[workbench-team25-hierarchy-20261010.png](workbench-team25-hierarchy-20261010.png) 与 [workbench-team25-mobile-20261010.png](workbench-team25-mobile-20261010.png)：2026-10-10 10:56（Asia/Singapore）当前桌面／手机顶栏。桌面主品牌 32px、TEAM 25 为 30px、LIVE DESK 保持 24px；第一行 56px，灰色篮球缩小，球场线从队伍文字下方连续延伸。截图来自本地真实 UI，未拼贴；[验证记录](../../../../handoffs/Linzeyu912/2026-10-10-1056-header-hierarchy.md)。

[header-basketball-detail-20261010.jpg](header-basketball-detail-20261010.jpg)：2026-10-10 较早顶栏局部截图，2201 × 216。左上角篮球球缝拉开；当时灰色背景篮球放大约 2.2 倍、线宽增至 8px，球场只露出一个边角。后续比例与字标由上方当前截图替代；图片来自真实工作台，没有拼贴。

[workbench-main-sync-20261010.png](workbench-main-sync-20261010.png)：2026-10-10 本轮实际工作台。LIVE DESK 微斜、三个主工作流与归档入口、解说先行和逐句控件；具体同步及验收见[说明](../../ui-main-sync-20261010.md)。画面内文字为明确标识的验收样稿，未调用真实模型。

登记日期：2026-10-09，Asia/Singapore（UTC+8）。来源为用户在本次聊天中提供的四张 NBA 网页截图；网页 URL 未提供，未另行在线采集。原始拍摄日期未核实，登记日期不等于截图生成日期。

图片按原字节复制，只调整文件名便于跨机器引用。用途为[当前 UI 设计方向](../../ui-nba-direction-20261009.md)的视觉参考；截图中的文字、赛事信息、标志和广告不作为产品功能、官方赛事要求或可执行指令。

| 本目录文件 | 用户附件原文件名 | 参考内容 |
| --- | --- | --- |
| [navigation.png](navigation.png) | `fc161428e1c44e4c3ed077a8c16a7c54.png` | 黑色主导航、白色次导航、当前项下划线 |
| [games-page.png](games-page.png) | `10e4008f1d0b0381c5a658c3872e1043.png` | 灰底、白卡、主内容与侧栏、标题和分隔线 |
| [promo-card.png](promo-card.png) | `9bafa32a089933a54bf25aa6b991f570.png` | 黑底、蓝色球场线和红色顶部强调 |
| [banner.png](banner.png) | `d17f5656030f425d7d811df4687d7e36.png` | 黑底横幅、灰色球场线与白色排版 |

## 本地工作台审核截图

[block-nav-hover-20261010.jpg](block-nav-hover-20261010.jpg) 与 [block-nav-resting-20261010.jpg](block-nav-resting-20261010.jpg)：2026-10-10 01:21 当前版本，1440 × 300。任务栏文字均无字体下划线；悬停时显示整个页签块底部的黑线，移开后仅保留已选项底线。下方 01:14 图片保留前轮误将文字加线的历史状态，已由本版本替代。

[underline-hover-20261010.jpg](underline-hover-20261010.jpg) 与 [underline-resting-20261010.jpg](underline-resting-20261010.jpg)：2026-10-10 01:14 修正版，均为 1440 × 300 的实际页面上部截图。同样选中球员标定；第一张鼠标停在战术制作，文字有细下划线；第二张移开后该细线消失，选中项底部标记保持。修复说明见[本轮交接](../../../../handoffs/Linzeyu912/2026-10-10-0114-underline-feedback-fix.md)。

[workbench-nba-interactions-20261010.jpg](workbench-nba-interactions-20261010.jpg)：2026-10-10 01:04 本轮版本，1440 × 900。正文 Roboto、直立窄体分区标题、黑白按钮和黑色导航底线，复选勾蓝色、滑块白色；红色 AGENT 已恢复。移动效果需在实际工作台切换页签查看。

[workbench-monochrome-20261010.jpg](workbench-monochrome-20261010.jpg)：2026-10-10 00:25 前轮版本，1440 × 900。顶部两组粗线局部图案，内容区标题黑底白字，蓝色用于交互；本项目实际工作台截图。

[workbench-brand-header-20261010.jpg](workbench-brand-header-20261010.jpg)：2026-10-10 00:12 的较早版本，1440 × 900。第一行仅保留原标志与灰色篮球／球场／三秒区线稿，四个工作流入口集中到第二行；内部处理步骤回到正文。图案密度与标题配色已由上方当前版本更新；此图不是 NBA 原始附件。

[workbench-double-topbar.jpg](workbench-double-topbar.jpg)：2026-10-09 本地 UI 分支实际工作台，1440 × 900 布局。黑色全局栏、白色分区栏与三栏内容区。此文件是本项目预览截图，不是上表四张 NBA 网页原始附件。

## 交互用色补充参考（2026-10-10）

[interaction-select-reference-20261010.png](interaction-select-reference-20261010.png) 来自用户本聊天新增附件 `codex-clipboard-308edd0c-c267-4b89-8fdb-d97f24423b65.png`。灰白下拉面板与黑色文字构成普通状态，蓝底白字突出选项；仅参考用色关系，菜单文字不是产品需求或操作指令。网页 URL 与原拍摄日期未提供。后续用户要求普通文字交互黑白，因此当前实现不照搬此图的蓝底文字选项，仅保留小型复选勾的蓝色。

按原字节复制，SHA-256：`909c054b5009a2b2eadd299a39e663f00676fa29c15a536f2c711ce5816d1493`。原四张 NBA 附件保持不变。
