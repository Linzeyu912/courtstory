# 视频理解与解说 Agent：已有能力复用核查

核查日期：2026-10-07，America/New_York。范围：用户负责视频理解、战术重点与带时机的解说词；研究 Pi 基座、多帧拼图、主动取证与绘图协作。未运行新模型、未更改产品代码。代码基线为 `9e18beed87e30fdaa2c8c1081c1ed19b89ce0e55`，本轮服务器 main 与本地一致。

## 结论

建议新增独立的 Pi 视频理解与解说 Agent，复用已有读图和 provider 能力，直接消费视频与 YOLO / 身份 / 可选球场观测。现有六帧绘图分析不适合作为它的必经上游。新的理解结果可同时服务解说与绘图意图，已有绘图及渲染继续作为下游。

最接近所需能力的代码已经在本仓库：Pi 地面轨迹 Agent 已实现真实图片工具结果和多轮读取；开源项目更适合作为方法参考，不必再安装一整套视频研究框架。当前任务不能只改地面 Agent 提示词，因为工具和终止条件仍绑定米制轨迹修正。

## 1. 本仓库可复用什么

| 组件 | 已核实的代码 / 记录 | 可复用部分 | 必须调整或保留的边界 |
| --- | --- | --- | --- |
| 精确取帧 | [TacticalWorkbench.frames](../../engineering/scripts/tactical_workbench.py) | PyAV 解码、真实 time / sourceTime / PTS、原帧映射与 JPEG；单次最多 40 帧 | 需要 clip 帧元数据；通用读取入口应让缺少球场标定的视频仍可使用 |
| 多帧拼图与裁图 | [ground_trajectory_images.py](../../engineering/scripts/ground_trajectory_images.py) | inspect_images：时间标签、两列每页六格、多页；人物 / 脚部裁图；返回图片字节和格子 / 裁剪变换 | 六格是每页布局，不是整片只能看六帧。现有 sheet 单格宽至多 640，full 至多 1280；需增加干净高清原图、任意区域和多人物联合区域，不能照搬脚部刻度 |
| Pi 运行循环 | [ground-trajectory-worker.mjs](../../engineering/tools/player-review/agents/ground-trajectory-worker.mjs) | Agent、工具执行、模型事件、预算、中断、进度与恢复接法 | 提示词、锚点状态和 finish_candidate 专用于地面修正；新解说 worker 应独立 |
| 图片工具协议 | [ground-trajectory-tools.mjs](../../engineering/tools/player-review/agents/ground-trajectory-tools.mjs) | content 中实际 image，读取过的帧、资产索引及元数据 | inspect_frames 单次最多 12 帧，现有业务层限定任务球员和范围；不能把整个工具集照搬 |
| 模型适配 | [qwen-provider.mjs](../../engineering/tools/player-review/agents/qwen-provider.mjs)、[package.json](../../engineering/tools/player-review/agents/package.json) | 已固定 Pi core / ai 1.0.2，兼容图片与工具调用的 provider | 阿里云专用适配；复用不代表替用户确定最终模型，也不代表赛事模型已走通同一接口 |
| 缓存与重连 | [frame cache](../../engineering/scripts/ground_trajectory_frame_cache.py)、[reconnect](../../engineering/tools/player-review/agents/ground-trajectory-reconnect.mjs) | 按视频 / 帧缓存，连接恢复 | 只复用通用机制，不需要继承十人并行任务或每人一个上下文 |
| 已有真实调用 | [官方两片实验](qwen-ground-official-20261005/README.md)、[近期多人记录](qwen-parallel-20261007/README.md) | 已证明工具图片 → 模型续读 → 后续工具可运行 | 地面修正效果仍有缺口；没有证明战术和解说准确率 |
| 渲染与标注 | [bridge](../../engineering/tools/agent-tactics/bridge.mjs)、[生产编排](../../engineering/tools/player-review/tactics-production.mjs) | 原生图形、暂停及成片基础 | 当前 runner 不提供可直接接收任意新解说事件的成品入口；需由绘图侧适配 |

特别注意现有 worker 的 transformContext：每次主要保留最近两个图片工具结果，再保留当前地面反馈。整段理解需要改为保留全段概览、事件摘要和当前局部证据，历史高清图可按引用重读。已返回图片只能表示模型收到证据，不能等同于已理解每个动作。

## 2. 已有调研对应哪些开源项目

已有记录：[10 月 5 日源码调研](qwen-video-trajectory-agent-20261005.md)、[版本与来源](qwen-video-trajectory-agent-20261005-sources.json)、[10 月 3 日工具对照](../../engineering/experiments/tactical_analysis/tools-map.md)。三个 VideoAgent 名称相同，但不是同一个项目。

| 项目 | 本次核查 / 历史版本 | 借鉴什么 | 使用建议 |
| --- | --- | --- | --- |
| [Pi](https://github.com/earendil-works/pi) | 本次作者仓库确认 agent-core / ai 分工；本地已固定安装 1.0.2 | 模型—工具—图片结果—继续调用 | 直接沿用已跑通 SDK，不为本次讨论升级整套依赖 |
| [IG-VLM](https://github.com/imagegridworth/IG-VLM) | 本次 README 确认单张多帧网格方法；历史源码锁定 00d11ab4 | 时间顺序的 image grid | BSD-3-Clause；现有 Pillow 拼图已覆盖基础需求，可借组织方法，没必要安装评测环境。它本身不是多轮 Agent |
| [VideoAgent tools / yuanyunchen](https://github.com/yuanyunchen/VideoAgent) | 本次 README 确认 view_frame、工具循环及 API-only 模式；历史源码 81400d43 | 模型主动选帧、读取图片、继续询问 | 借工具设计，不引入第二套 LangGraph 循环。README 仅称 research purposes，未确认明确复用许可证，不按宽松授权直接复制代码 |
| [VideoAgent / YueFan1014](https://github.com/YueFan1014/VideoAgent) | 本次 README 确认先构造记忆，再使用工具查询；历史 42e1b70d | 对象记忆、事件片段、局部 VQA | Apache-2.0；全套依赖较重，已有 YOLO 与轨迹应直接利用，短视频不必先建 embedding 索引 |
| [VideoAgent / wxh1996](https://github.com/wxh1996/VideoAgent) | 沿用已有 119be7c3 源码调研，本轮未重新实读 | 迭代检索 / 帧描述 / 回答 | 作为方法背景，不称本轮运行验证 |

IG-VLM 与 VideoAgent-tools 的固定提交源码链接本次 web 抓取失败；相应细节沿用有版本的旧核查，不声称本轮重新下载完整源码。当前作者 README 已重新读取。其他 VideoINSTA、VideoTree、VTS 仍保留在原调研，本轮无需把所有候选都变成产品依赖。

## 3. Codex 是否内置“逐帧拼成大表反复看”

本次重新读取了本地保存的固定 Codex 源码摘录：[UserInput](agent-video-understanding-20261005/excerpts/codex/user-input.rs)、[图片工具输出](agent-video-understanding-20261005/excerpts/codex/view-image-output.rs)、[研究报告](agent-video-understanding-20261005/REPORT.md)。固定版本 `7f892275e31002f0422477c6219189284560e689` 的输入没有 Video 类型，view_image 返回真正的 InputImage；没有证据说明它内置一种固定的全视频拼帧算法。该结论限于已查公开版本，不概括所有产品内部能力。

本次也实读 [OpenAI 官方 Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)，其 view_image 示例说明将本地图片加入当前上下文，未规定自动视频拼帧流程。

用户描述的方法可由 Codex 工具执行实现：外部解码 / 拼图 → 模型读图 → 选择下一窗口 / 高清帧 → 工具返回新图片。我们自己的[历史素材审核](../../handoffs/chuali-zi/2026-10-04-0624-structured-video-scenarios.md)确实记录过 382 张联系图、4,617 采样帧及 44 张原尺寸复查帧；这证明我们曾采用这种工作方式，不证明 Codex 默认内部如此处理，也不证明做过逐帧完整审阅。

## 4. 对当前问题的判断

- 固定六时刻可用作缩略预览，但不应作为约二十秒篮球战术解说的主要信息基础。应建立覆盖完整时间轴的分段序列阅读，从一开始让模型有连续动作上下文，再进一步细读。
- 建议实验起点：约 22 秒片以 2 fps 左右生成约 44–45 个采样时刻，按 6–9 格分页；重点动作窗口增加到例如 6–8 fps，并允许请求更密集帧和单帧原图。这些是待测参数，不是充分性或准确率保证。
- 拼图只负责时间组织。过大网格经过 provider 缩放可能损失球、号码和接触细节；应按实际模型的图像尺寸预算分页，配合多人交互裁图和干净原图。局部裁图也不能替代全场空间关系。
- YOLO 框 / T 号、P 身份范围、号码 / 姓名、球候选、可选 2D 坐标都可以查询；保持原始、估计、未知与冲突的区别。没有可靠 2D 或身份时，仍应允许进行可支持的文字分析。
- 理解完成后可以同时决定“说什么”和“画什么”；精确画在哪里、如何跟随和编码仍是绘图能力的责任。这样可避免两次独立理解产生互相矛盾的解说与图形。

工程讨论、工具草案和协作交付见[独立 Pi 解说 Agent 方案](../../engineering/docs/video-commentary-agent-discussion-20261007.md)。本轮仅核查与建议，未对新方案准确性、耗时或成本作实测结论。
