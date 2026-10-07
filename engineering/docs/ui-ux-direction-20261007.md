# UI / UX 改版方向与开发工具建议

日期：2026-10-07 09:40（Asia/Singapore，UTC+8）。状态：讨论建议，尚未实施、未形成团队选型。

## 用户目标与本轮范围

用户希望改善现有界面的朴素观感，参考“Cloud”式优雅体验，并询问 Claude Opus、语音转写的“QMK3”和 GPT 哪个能完成。暂把“Cloud”理解为 Claude 的界面气质；“QMK3”尚未确认，不能当作正式模型名，也不能擅自认定为 Gemini 3 或 Qwen3。

本轮读取工作台布局、HTML、样式及工程说明，没有实际启动浏览器验收，也没有修改界面。以下是产品方向和工具建议，不是三个模型在本仓库上的比较测试。

## 建议的页面方向

- 评委入口优先展示完整成片、简短战术概述和可操作的片段导航；打开后能立即理解作品并播放。依据是仓库已有的[评审路径整理](../../requirements/judging-operation-clarification-20261006.md)，本轮未重新核验赛事原始网站。
- 制作工作台保留视频、时间轴和标定 / 2D / 战术制作 / 成片流程。高级数据与技术参数按需展开，每个阶段突出当前动作、处理反馈和下一步。
- 视觉候选：暖白或浅灰背景、深灰正文、单一低饱和强调色；统一中文字号、间距、按钮层级和轻边框，视频为主要视觉区域。借鉴 Claude 的克制感，具体色板与布局仍需用户看稿选择。
- UX 验收应覆盖空白、加载、失败、保存、渲染进度以及窗口缩放；视频与标注位置保持一致。现有样式有多阶段叠加，实施前应梳理样式覆盖关系，避免只追加全局 CSS。

## 开发工具建议

GPT 已有完成前端设计和既有工程修改的能力依据；继续使用当前 Codex 环境做一个关键页的可交互样稿，是成本和上下文切换都较少的起点。若选 GPT 具体型号，可考虑官方前端指导中明确提到的 GPT-6 Astra；不据此断言它的视觉审美胜过其他厂商。

Claude Opus 也是合理候选，Claude Code 的官方 frontend-design 插件提供专门的设计工作流。若已有访问权限，可让它基于同一需求和参考做另一个关键页方案。若“QMK3”指 Gemini 3，Google 官方也展示了交互 Web UI 生成能力，可以参与同页样稿比较；若指 Qwen3，则需先明确具体型号，本轮不作审美排名。

建议先比较同一页的真实交互结果，选定字体、配色、间距和操作流程后再推广到其他页面。以上顺序是本任务的建议，不是客观性能榜。开发时选用的模型与作品运行时依赖哪个模型是两项独立选择；页面样式改动本身不要求替换现有运行模型。

## 官方来源

以下页面均于 2026-10-07 读取。官方能力描述能证明候选用途，不能证明在本项目上的效果排名。

- [OpenAI：Prompt engineering，Front-end engineering](https://developers.openai.com/api/docs/guides/prompt-engineering)：GPT-6 Astra 的前端与已有工程能力；明确字号、颜色、布局、交互状态与无障碍要求。
- [Anthropic：Frontend Design](https://claude.com/marketplace/plugins/frontend-design)：面向 Claude Code 的前端设计插件，先明确目的、受众与视觉方向。
- [Anthropic：Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)：前端提示与设计指导。
- [Google：Gemini 3，Build anything](https://blog.google/products-and-platforms/products/gemini/gemini-3/)：2025-11-18 发布文中的交互 Web UI 能力示例；不把当时榜单成绩当成 2026-10-07 的最新排名。

## 下一步

先明确参考界面与“QMK3”的实际名称，再以评委观看入口作为首个设计样稿。后续实现需使用真实视频和现有数据验证播放、导航、保存及布局，不以静态截图代替 UX 验收。
