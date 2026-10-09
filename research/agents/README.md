# Agent 与视频理解研究

2026-10-09：[出手冻结、投篮机会与防守压力](shot-feedback-2k-20261009.md)，核查解说／战术两条实际分析链与 2K 数据接入，结合 2K25／2K26 官方玩法说明提出共享出手事件建议；仅研究，产品代码未改，HUD 视觉核对未完成。

2026-10-07 晚间：[OpenRouter Astra 解说对照](video-commentary-20261007/openrouter-astra.md)，官方001/002各5条解说及Qwen对照；主线程直接读图复核，同时保留12轮未保存方案的失败记录。

2026-10-07：[独立解说 Agent 真实试跑](video-commentary-20261007/README.md)，Pi 工具循环已跑通，保留两个样片的原始文字结果与内容误差；不是准确率验收通过。

| 专题 | 入口 | 范围 |
| --- | --- | --- |
| 解说口语感与幽默表达 | [开源项目与技术调研](commentary-personality-20261009.md)、[2026-10-09 实测](commentary-personality-20261009/README.md) | 24条表达材料、Astra三段真实视频润色、虚构用梗测试、Seed两种口吻及四个成片；梗卡增益尚未证明 |
| 出手冻结与 2K 攻防能力参照 | [2026-10-09 核查](shot-feedback-2k-20261009.md) | 两条视频分析链、真实数据字段与缺口、机会选择和防守压力建议；未实现或批准设计 |
| 视频理解与带时机的解说复用 | [2026-10-07 核查](video-commentary-reuse-20261007.md) | Pi、多页拼帧、主动取证、Codex 实际边界与现有代码复用；附独立解说 Agent 协作建议，未实施 |
| 当前多模态模型与篮球战术理解 | [2026-10-06 调研](multimodal-basketball-20261006/README.md)、[10 月 7 日云端多模态实测](../../environment/aws/openrouter-multimodal-connectivity-20261007.md) | 官方规格、价格、篮球专项证据；后续九模型合成样例调用通过，真实篮球质量待测 |
| Qwen 主动看帧、修正地面轨迹 | [讨论与来源](qwen-video-trajectory-agent-20261005.md) | Agent 多轮工具与证据循环 |
| Qwen 官方训练片真实调用 | [测试、修复与结果](qwen-ground-official-20261005/README.md) | 两段官方原片、真实 API、像素到 2D 的多轮对照；AI 参照不代表人工真值 |
| Qwen 官方训练片全部球员测试 | [多人测试与复跑](qwen-all-players-20261007/README.md) | 两片完整时间轴、两队身份与多人轨迹；保留近景、缺测和调用失败 |
| Qwen 十个单人 Agent 与去噪 | [并行映射实验](qwen-parallel-20261007/README.md) | 固定前置材料，两片十人、Token Plan两路及重连已实测；去噪和反投影精度未通过验收 |
| 多模态视频模型到球场映射 | [研究包](video-model-to-court-20261005/README.md) | 模型能力、时间采样、跟踪与映射边界 |
| OpenCode / Codex 视频处理源码 | [源码研究](agent-video-understanding-20261005/README.md) | 固定版本、原样摘录与离线检查 |
| Codex CLI 在 EC2 上运行 | [可行性与实测报告](codex-cli-ec2-20261007.md) | 本机下载传包、用户级安装、ChatGPT 设备码登录、真实回复与只读命令通过；区分 EC2 执行与远程模型推理 |

调研不等于模型真实调用或新视频效果验收。已实现的 Qwen 功能与使用方式另见[工程说明](../../engineering/docs/qwen-ground-trajectory-agent.md)；实施计划、服务接口和产品代码随工程保存。

接手 chuali-zi 的实现时，先对照[Qwen 首版交接](../../handoffs/chuali-zi/2026-10-05-0651-qwen-ground-trajectory-implementation.md)和[2D 工作流交接](../../handoffs/chuali-zi/2026-10-05-0127-2d-first-tactics-workbench.md)的真实验收缺口。与人物、成片及云端接续的关系见[成果总览](../../docs/work-index.md)。
