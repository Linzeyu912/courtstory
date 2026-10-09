# 交接：转播演播室 UI 方向与旧分支归档

- 日期 / 时区：2026-10-09 17:13，Asia/Singapore（UTC+8）
- 成员：Linzeyu912
- 任务 / Issue：本轮用户要求整理 Broadcast Studio 色彩风格，停用两条旧 UI 支线，并按新方向重新设计；GitHub open Issue 列表为空，未向其他成员发消息。
- 分支：`codex/courtstory-ui-broadcast`，从 `main@1a14be3` 创建并使用独立 worktree
- 提交：本地设计分支；未推送、未合入 main
- 状态：本地设计交付完成；未进入正式工作台视觉集成

## 本次完成

- 新增[风格规范](../../engineering/docs/broadcast-studio-style-20261009.md)：颜色职责、字体、模块标签、组件、互动与可读性规则。
- 新增[独立交互样稿](../../engineering/tools/courtstory-broadcast-preview/README.md)，本机端口 8898；包含工作台和组件色板页。
- 蓝红顶栏、斜切标题、白底面板、浅蓝选择、平面细线与 2px 圆角。实际回放标为 REPLAY；球场示意可展开，默认优先显示助手输入。
- 本地打包 Barlow Condensed、IBM Plex Sans、JetBrains Mono、Noto Sans SC 字体，保留许可证、锁定来源及文件摘要。
- 复用旧稿的视频和编辑交互；新缓存键 `courtstory:broadcast-preview:v1`，并修正本地视频标签和主题恢复时的可访问名称。

## 旧分支处理

| 已删除的活动分支 | 原提交 | 归档标签 |
|---|---|---|
| `codex/courtstory-ui-glass` | `660b87c86cce9a2828a094ddaa016533deec03d7` | `archive/ui-glass-20261009` |
| `codex/courtstory-ui-paper` | `89712e627c87531aad29e724ae3bb46abc008d65` | `archive/ui-paper-20261009` |

删除前确认两个工作区干净、分支 tip 未变化，创建标签和增量 bundle，`git bundle verify` 通过且标签指回原提交。bundle 依赖仓库中已有的 `9e18beed87e30fdaa2c8c1081c1ed19b89ce0e55`。旧目录在原位置以 detached HEAD 保留，未删除被忽略的参考图片／工具等资料；已停止 8896、8897 的旧预览服务。标签和 bundle 都是本地归档，未推送远端。

## 验证

- Node 模块和 Python 服务语法检查通过。
- Playwright 实际 Chrome 验证：005 视频 1920×1080、四种字体成功加载；播放／暂停／逐帧／时间轴；建议标注、改名、属性、撤销重做、刷新恢复；模态关闭、焦点恢复、叠加预览、专注模式、浅深色偏好、减少动态效果。
- 本地选择视频后，SOURCE 标签与对象数正确更新；缩放后的画布实际鼠标拖绘生成预期的归一化坐标；删除撤销、返回示例、球场示意折叠通过。
- 工作台与组件页均检查 1440×900、1280×720、900×760、390×844，无横向溢出。已查看桌面和手机截图。浏览器控制台 0 error、0 warning。
- 主颜色配对比值见风格规范；未宣称整页无障碍认证。
- `python scripts/validate_video_data.py --check-index` 通过：10 个数据集，166 个视频，166 个 LFS 索引指针。

## 结论与边界

用户已选择 Broadcast Studio，玻璃／纸感不再作为活动设计方向。继续遵守此前用户对独立样稿的约定：不改变按钮名称、用途和功能定义，先确认组件与设计效果。

用户在交付前明确纠正工作位置：UI 必须放在新建分支。最初写在主 checkout 的设计文件当时均未提交；现已全部迁移到 `codex/courtstory-ui-broadcast` 的独立 worktree，包含两处索引修改、新规范、样稿与本交接。主 checkout 已恢复干净，main tip 保持 `1a14be3`。根 AGENTS.md 的 UI 专用例外只写入设计分支，明确后续不能在主 checkout 编辑 UI。

本轮没有修改 `engineering/tools/player-review/` 功能实现、正式草稿、模型接口、成品 CourtStory 仓库或云端部署。样稿的 AI 建议是固定示例，球员和映射入口仍是范围提示。Safari、Firefox、真实触屏与生产后端未测试。

## 下一步

以后按本规范向正式工作台映射语义 token 与组件规则。应同时覆盖当前 main 的新解说／配音模块，并使用隔离状态验证绘制坐标、草稿、视频和导出；不能把这次样稿验收视作生产集成验收。赞助方品牌色仍待用户提供。

## 同步状态

开工曾 fetch 并快进同步 main 到 `1a14be3`。当前所有新样稿、规范、状态入口与交接均迁入 `codex/courtstory-ui-broadcast`，只在该分支本地保存；没有推送、合入 main 或部署。8898 服务已切换到新分支工作目录。用户可在本轮聊天 outputs 中取得更新后的便携源码包、规范、截图和旧分支恢复包。
