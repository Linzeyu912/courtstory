# Agent 与视频理解研究

| 专题 | 入口 | 范围 |
| --- | --- | --- |
| Qwen 主动看帧、修正地面轨迹 | [讨论与来源](qwen-video-trajectory-agent-20261005.md) | Agent 多轮工具与证据循环 |
| Qwen 官方训练片真实调用 | [测试、修复与结果](qwen-ground-official-20261005/README.md) | 两段官方原片、真实 API、像素到 2D 的多轮对照；AI 参照不代表人工真值 |
| 多模态视频模型到球场映射 | [研究包](video-model-to-court-20261005/README.md) | 模型能力、时间采样、跟踪与映射边界 |
| OpenCode / Codex 视频处理源码 | [源码研究](agent-video-understanding-20261005/README.md) | 固定版本、原样摘录与离线检查 |

调研不等于模型真实调用或新视频效果验收。已实现的 Qwen 功能与使用方式另见[工程说明](../../engineering/docs/qwen-ground-trajectory-agent.md)；实施计划、服务接口和产品代码随工程保存。

接手 chuali-zi 的实现时，先对照[Qwen 首版交接](../../handoffs/chuali-zi/2026-10-05-0651-qwen-ground-trajectory-implementation.md)和[2D 工作流交接](../../handoffs/chuali-zi/2026-10-05-0127-2d-first-tactics-workbench.md)的真实验收缺口。与人物、成片及云端接续的关系见[成果总览](../../docs/work-index.md)。
