# 本地字体

本目录随样稿提供 WOFF2 与原作者的 OFL 许可证。来源固定为 Google Fonts 仓库提交 `2eb0b48d5f760f62e286216f0859a8c540dbc1bd`，完整 URL、源文件摘要和生成文件摘要见 `manifest.json`。

| CSS 中的角色 | 原始字体 | 本地派生内部名称 |
|---|---|---|
| 比分与展示数字 | Barlow Condensed Bold Italic | CourtStory Broadcast Display |
| 西文正文 | IBM Plex Sans | CourtStory Broadcast Sans |
| 数据标签 | JetBrains Mono | CourtStory Broadcast Mono |
| 中文正文 | Noto Sans SC | CourtStory Broadcast Chinese |

本地文件经过字符子集化；IBM Plex Sans 固定标准字宽并保留字重轴。派生文件使用新的内部名称，保留原始许可证。CSS 的 family 名称作为页面角色别名使用。

中文子集覆盖当前 HTML、CSS、SVG、脚本文案。自定义标注超出子集时回退到系统中文字体；正式产品接入时需要重新评估完整中文覆盖。页面不请求外部字体服务。
