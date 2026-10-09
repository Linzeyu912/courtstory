# 交接：NBA 文字交互、字体与红色点缀

- 日期 / 时区：2026-10-10 01:04，Asia/Singapore（UTC+8）
- 成员：Linzeyu912
- 任务 / Issue：本聊天 UI 设计迭代；本轮 GitHub 开放 Issue 查询为空
- 分支：`codex/courtstory-ui-broadcast`
- 提交：HEAD 仍为 `eeb916965c4978edacbd6083d69a1d800a63c054`；本轮及前轮设计修改未提交、未推送
- 状态：本轮本地实现与检查完成，供用户审核

## 本次完成

- 按用户要求实际访问 NBA 官网，读取页面 DOM、计算样式和加载的 CSS。来源、实际字体与导航规则写入[现行规范](../../engineering/docs/broadcast-studio-style-20261009.md#来源与当前入口)。
- 工作台及回放普通文字按钮、链接、页签、下拉选项和聚焦编辑卡改为黑白／浅灰；复选勾继续用蓝色，滑块圆点白底黑边。用户随后要求找回红色点缀，已恢复红色 AGENT、原错误／危险提醒；原红色播放头与黑卡顶边保留。
- 在 [studio-tabs.mjs](../../engineering/tools/player-review/studio-tabs.mjs) 增加纯展示层底线定位，在 [index.html](../../engineering/tools/player-review/index.html) 挂载至工作流／处理步骤；战术内部页签同步挂载。悬停仅显示该项 4px 黑线，选中状态真正变化后共享底线才滑动，不修改业务选择逻辑。
- 新增 Roboto、Roboto Condensed 本地字体子集与许可证、更新清单；正文使用 Roboto，展示标题用直立窄体 Roboto Condensed，品牌保留 Barlow Condensed 斜体。详见[静态资源说明](../../engineering/tools/player-review/broadcast-studio/README.md)。
- 更新设计方向、规范、工程说明、状态和决策。保存[1440 × 900 审核图](../../engineering/docs/images/nba-ui-20261009/workbench-nba-interactions-20261010.jpg)，旧截图保留作历史记录。

## 结论与依据

- 2026-10-10 检查 [NBA Games](https://www.nba.com/games)：全局导航 Roboto 14px／600，分区链接 Roboto 14px／300；展示标题 Knockout Wide，直立。官网分区项使用 4px 底边切换，不将本项目的滑动实现误称为官网现成动画。比赛列表当时报错，未验收其动态内容卡。
- 工作台采用的 Roboto Condensed 是开源近似标题字体，没有复制 NBA 专有字体。两个新增字体来自固定 Google Fonts 提交，保留 OFL、来源与源／产物 SHA-256。
- 最终用色按用户最新修正：普通文字交互黑白，小型复选标记蓝色，同时保留原红色品牌与重要提醒。球队、轨迹及审核状态颜色继续表达既有业务含义。

## 验证

- Node 现有全量测试 730 / 730 通过。服务代码未改，历史 33 项服务测试未在本轮重跑。
- 原始 300 项控件／属性、295 个 ID 和 97 个 HTML 按钮完整，回放原控件属性保持；没有删除或替换功能入口。
- 浏览器完成四工作区切换、战术／解说点击与方向键切换，三句原验收草稿保留。底线最终位置与所选按钮矩形相符；也捕获从 0 → 96px 的移动中间位置。悬停在第一项、键盘选中第二项时，局部悬停线与真正选择分开。
- 1440、1280、360 宽度布局无整页横向溢出；手机四入口可见。工作台、回放字体与按钮颜色检查通过，两页浏览器错误日志为空。恢复红色后工作台 AGENT 实际计算为 `rgb(229, 51, 79)`，主按钮仍近黑，复选标记仍 NBA 蓝。
- 两个新增字体 HTTP 200、`font/woff2`、响应长度与 manifest 一致；六个字体清单摘要／尺寸及字形解析检查，旧四个字体字节保持。相对文档链接与 `git diff --check` 检查。
- 本机命令、样式摘录、截图、前后快照和测试日志保存在忽略目录 `tmp/ui-review-20261010/nba-interactions/`。本轮不新增模型、TTS、成片生成、导入或草稿改写。

## 阻塞与待确认

- 当前 UI 修改无阻塞。原生 select 展开菜单仍由运行平台绘制，不承诺各操作系统的菜单像素完全一致。
- 本地 UI 基于原 1a14be3 功能基线；远端 main 已更新，当前 UI 不能表述为已整合远端最新功能。

## 下一步

- 用户在本机 `http://127.0.0.1:8900/?sample=005&qa=1` 审核黑白文字交互、红色点缀和新字体；继续迭代时使用现有 NBA UI worktree。
- 若后续用户要求集成功能版本，再单独处理 main 新提交；不因本轮 UI 工作自动合并、提交、推送或部署。

## 同步状态

- 本轮仅修改 UI worktree，已有修改全部保留。main 工作区仍干净，HEAD 为 `1a14be3bb239001c5ec8cc1300a5d071186714c5`。
- 本轮只读 `ls-remote` 查询远端 main 为 `e2db182652f0db9d025ff2d6fb636324a31b5a82`，未 fetch、合并或推送；本地缓存 origin/main 不能作为最新同步证据。
- 当前运行的是本机隔离预览，未部署至云端，也没有创建分支或 PR。
