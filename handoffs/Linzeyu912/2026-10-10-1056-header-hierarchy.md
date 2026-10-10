# 交接：顶栏字标主次、留白与连贯灰线

- 日期 / 时区：2026-10-10 10:56，Asia/Singapore（UTC+8）。
- 成员：Linzeyu912。
- 任务 / Issue：本聊天用户连续三次 UI 反馈；本轮实际查询 GitHub open Issues 为空。
- 分支：`codex/courtstory-ui-broadcast`，独立 UI worktree。
- 提交：未提交、未推送。
- 状态：本地调整与浏览器检查完成，待用户视觉审阅。

## 本次完成

- 修改 `engineering/tools/player-review/broadcast-studio.css` 与 `broadcast-replay.css`，共用顶栏高度、主品牌／队伍字号与篮球图标尺寸变量。
- 桌面 COURTSIDE AGENT 为 32px、TEAM 25 为 30px，LIVE DESK 保持 24px；黑栏回到 56px、第二行仍为 44px。主品牌略大，队伍接近主品牌；白色 TEAM、深蓝 25、无底块继续保留。
- 桌面左右留白 32px；手机 16px。480px 以下品牌／队伍为 28／27px，360px 以下为 26／25px，篮球图标依次为 32／30／28px。
- 灰色背景篮球半径 260→175px、线宽 8→6px，移除队伍附近的 132px 右侧硬裁切；球场线从文字下方连续延伸至右边缘。
- 更新[视觉规范](../../engineering/docs/broadcast-studio-style-20261009.md)、工程与图片索引；保存[桌面截图](../../engineering/docs/images/nba-ui-20261009/workbench-team25-hierarchy-20261010.png)和[手机截图](../../engineering/docs/images/nba-ui-20261009/workbench-team25-mobile-20261010.png)。

## 结论与依据

- 来源：2026-10-10 本聊天用户直接要求主品牌最大、队伍其次、LIVE DESK 保持原大小；进一步强调不要贴近黑栏边界、字号只需有区分；最后要求 TEAM 25 再接近主品牌，并收窄任务栏。
- 按最后反馈撤回中途 64px 高栏和更大的品牌图标，最终为 56px 高栏、32／30／24px 桌面层级。没有新增外部参考、字体或业务逻辑。

## 验证

- Playwright 在真实工作台与回放页各检查 1440、1024、768、390、360、320px：共 12 组布局通过，顶栏和页面均无横向溢出，品牌与队伍不重叠。
- 计算样式确认主品牌始终略大于队伍，TEAM 与 25 同字号，LIVE DESK／REPLAY DESK 保持 24px；第一行 56px，第二行 44px、起点 y=56。
- 背景层右侧为 0，TEAM 与数字背景透明，颜色仍为白色和 `#1D428A`；实际截图已目视核对。
- 浏览器从空白页预先拦截非 GET API，再进入隔离预览；本轮未启动或采用模型任务，也未修改用户草稿。
- 仅 CSS 呈现变化，未重复执行前轮已通过的 24 项业务界面测试。几何结果与完整截图在忽略目录 `output/playwright/team25-hierarchy/`。

## 阻塞与下一步

- 无实现阻塞。后续按用户视觉反馈在原 UI 分支微调；发布仍需后续明确授权。

## 同步状态

- 本轮远端实查 UI 分支仍为 `c443d9e`，main 为 `57e8ecc`；未合并 main 新业务更新、未提交／推送／部署。
- 保留上一轮 TEAM 25 字标修改、已有交接与其他任务文件；没有修改主 checkout。
