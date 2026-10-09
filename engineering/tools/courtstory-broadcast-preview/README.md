# CourtStory · Broadcast Studio 设计样稿

2026-10-09：当前唯一的视觉方向为 **Broadcast Studio／白天的篮球转播演播室**。以用户提供的 NBA 蓝红白、木地板和篮球橙棕为基础，使用斜切模块标题、等宽数据标签、2px 圆角与平面白色面板。

完整规则见[视觉规范](../../docs/broadcast-studio-style-20261009.md)。本目录是可交互设计样稿，尚未集成到正式工作台。原有玻璃、纸感两条本地分支已归档，不继续迭代。

**工作位置：`codex/courtstory-ui-broadcast` 独立分支与独立 worktree。** 用户明确要求 UI 设计不得在 main 上进行，相关文档和交接也随本分支保存。主开发 checkout 保持 main 且工作区干净。

## 启动和入口

从仓库根目录执行（Python 3.10+，无运行时第三方依赖）：

```sh
python engineering/tools/courtstory-broadcast-preview/serve.py --port 8898
```

- 工作台：`http://127.0.0.1:8898/`
- 组件与色板：`http://127.0.0.1:8898/assets/components.html`

默认只读取既有 `data/videos/tactics/acceptance/clips/005_SAS_pick_roll.mp4`。如果视频未下载，使用 `--video` 指向已有 MP4。服务只监听本机，支持视频 Range 请求，只提供样稿文件、assets 与明确选中的视频，不开放仓库目录。

隔离 worktree 中的媒体可能是 LFS 指针；当前预览通过 `--video` 只读复用主 checkout 已存在的 005 视频，不复制或修改主 checkout 的素材。

## 已实现的样稿交互

- 真实视频播放、逐帧、倍速、时间轴定位与本地视频选择。
- 路线、重点圈、文字的创建、选择、拖动、属性修改、删除和撤销／重做。
- 助手／属性面板、专注模式、叠加预览、原生弹窗及焦点恢复。
- 独立缓存键 `courtstory:broadcast-preview:v1`；浅色默认为主，保留深色外观切换。
- 组件页的按钮反馈、选中态和表单焦点。篮球球场图可从工作台助手底部展开，也在组件页中完整展示。

没有接入 AI、正式草稿和 MP4 渲染。球员与映射入口延续旧样稿的范围提示；示例建议属于固定标注。球场图是配色示意，比分字体示例也明确标为示例。页面不把回放标成 LIVE。

## 文件与视觉规则

- `assets/design-tokens.css`：主色、语义色、字体角色与动效变量。
- `preview.css`：完整重写的 Broadcast Studio 页面样式，不载入旧玻璃 CSS。
- `index.html`：保留交互 ID 与按钮功能含义的工作台样稿。
- `preview.mjs`：沿用旧样稿交互，隔离草稿键，并同步上传素材的标签与外观可访问名称。
- `assets/ui-motion.mjs`：短暂平移与淡入淡出；原生模态、关闭事件与焦点语义。
- `assets/components.*`：可交互的风格规范页。
- `assets/court.svg`：自行绘制的平面球场配色示意。
- `assets/fonts/`：本地 WOFF2、OFL 许可证、来源提交及 SHA-256 清单。Noto Sans SC 是按样稿文案提取的子集，其他汉字使用系统回退。

封面和 8 张缩略图来自旧样稿已经登记的 005 比赛素材。视频本身仍使用共享库原文件，本轮没有改视频字节。来源登记沿用 `data/videos/tactics/acceptance/README.md`。

## 验证与限制

本机 Windows 的 Chrome/Playwright 已检查真实视频与四套字体载入、播放／暂停、逐帧、标注与属性、撤销／重做、缓存恢复、弹窗／焦点、叠加预览、专注与主题、减少动态效果，以及 1440、1280、900、390px 四档窗口下工作台和组件页无横向溢出。浏览器脚本错误与警告为 0。

纯色正文对比度已计算；这不等于整页无障碍认证。Safari、Firefox、真实触屏设备、正式后端／模型与云端部署未在本轮测试。页面保留纵向滚动；尺寸变化不隐藏编辑内容。

这轮成果只保存在本机的 `codex/courtstory-ui-broadcast`。该分支从 `main@1a14be3` 建立，新增样稿与文档仅在 UI 分支本地保存；没有推送、合入 main 或部署。最初位于主 checkout 的未提交设计文件已全部迁出，主 checkout 已恢复干净。
