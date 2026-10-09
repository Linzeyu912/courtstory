# Broadcast Studio 静态资源

此目录供真实工作台与轨迹回放页使用。主题在上一层 `broadcast-studio.css` 和 `broadcast-replay.css`；源字体、样稿来源与组件规范见[视觉规范](../../../docs/broadcast-studio-style-20261009.md)。

- `mark.svg`：本项目绘制的白色篮球线条标记，用于黑色顶栏；不是 NBA 官方标志。2026-10-10 调整为 2px 圆头线条，拉开两侧弧形球缝与中线，改善 30px 实际显示时的辨识度。
- `court.svg`：按产品现有 28.6512 × 15.24 米球场坐标绘制的静态背景；仅在二维示意画布显示，不包含虚构球员或运动路线。
- `fonts.css`：本地字体声明，`font-display: swap`；中文与少见字形有系统字体回退。
- `fonts/manifest.json`：锁定的上游提交、来源 URL、源文件与产物 SHA-256、字节数和派生内部字体名称。
- `fonts/*-OFL.txt`：六个上游字体的许可证。

字体源自 Google Fonts 提交 `2eb0b48d5f760f62e286216f0859a8c540dbc1bd`。WOFF2 是子集化产物，内部家族名使用 `CourtStory Broadcast …` 或新增的 `CourtStory NBA …`，避免占用上游保留名称；网页中的字体别名由 `@font-face` 声明。

2026-10-10 新增 `roboto.woff2`（101,388 字节）与 `roboto-condensed.woff2`（81,624 字节），用于当前工作台及回放正文和直立窄体标题。两者保留拉丁／扩展拉丁、常用标点和可变字重；不包含中文，中文继续使用现有 Noto Sans SC。品牌继续使用 Barlow Condensed Bold Italic；IBM Plex Sans、JetBrains Mono 保留作历史资源，当前主题不再默认使用。上游来源和 SHA-256 已登记到 manifest，许可证为 SIL OFL 1.1。

原西文字体保留样稿使用的字符集。中文子集包含 GB2312 与本轮 `player-review` HTML、JavaScript、CSS 文案中的字符，体积约 1.95 MB。未来增加生僻姓名时可以使用系统回退，或按 manifest 的固定源重新以 FontTools 扩展子集；更新产物后同步其 SHA-256 和字节数。不得把客户端业务颜色与字体子集当作模型或数据协议的一部分。

服务器显式登记此目录内 `.css`、`.svg`、`.woff2`，并为 WOFF2 返回 `font/woff2`。不存在任意文件路径读取入口；许可与 manifest 留在仓库供交接。
