# 作品设计、功能与验收文档

2026-10-07 球员标定改进进行中：[YOLO 角色校验、主动身份初检与少量人工修正计划](plans/2026-10-07-player-identification-and-proactive-agent.md)。本轮聚焦第一部分球员标定，真实验收结果另行记录，不将计划当作完成。

2026-10-07 工作台可用性修复见[整段初稿、重点圈、可选映射与人工接管](workbench-usability-20261007.md)，配套[本轮计划](plans/2026-10-07-workbench-usability-and-manual-fallback.md)。本轮处理实际页面，不替代下方新版 runner 的整体验收结论。

2026-10-06 独立验收：111 项新增回归重跑通过，但追加场景发现 1 项 P1、2 项 P2，真实 005 指人问题仍在，M0／M1 不予整体签收。见[验收结论与复验条件](agent-tactics-acceptance-20261006.md)。

2026-10-06 首批实现进度见[Agent 战术工作流实施与验收](agent-tactics-implementation-20261006.md)，配套[运行命令](../agent-workflows/tactics-v1/README.md)及[T00 固定基线](agent-tactics-baseline-20261006.md)。下表“待实施”是原规划时点；当前能力、真实失败与剩余任务以实施报告为准。

| 要找的内容 | 入口 |
| --- | --- |
| 最新工作台实施方案（Final v1） | [Agent 工具与多球员标注执行计划](plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)；工具封装优先、视频主流程、几何按需、人工兜底；新增能力待实施 |
| Agent 执行入口与工具合同 | [工作流程、默认策略与异常处理](agent-tactics-workflow.md)、[工具输入输出、状态及第三方 API 合同](specs/agent-tactics-tools-v1.md)；保留当前战术布局与模块 |
| 工作台操作 | [人工视频制作（006）](manual-tactics-workbench-guide.md)、[2D 高级流程](2d-first-tactics-workbench-guide.md)、[视频库与导入](local-video-library.md) |
| 人工制作实施与验收 | [Task 0 文件/缺口核实](manual-tactics-workbench-task0.md)、[浏览器 MP4 验收与限制](manual-tactics-workbench-acceptance.md) |
| 人物与球场 | [身份审核](track-identity-review.md)、[可见性](player-visibility.md)、[球场标定](court-calibration-backend.md) |
| 战术编辑与成片 | [画布](tactics-canvas.md)、[成片生产](tactics-authored-production-guide.md)、[未来路线](future-route-editor.md) |
| 已认可的 005 成片视觉基准 | [005 V2 流程](005-authored-v2-workflow.md)、[原始资料归档](../archive/tactical-video/005-authored-v2/README.md) |
| 导入视频的待解决问题 | [人物 / 球场 / 战术诊断](../../research/vision/imported-video-diagnostics-20261005.md)，按原记录区分待验证结论与本机产物 |
| Agent 接口 | [Qwen 地面轨迹](qwen-ground-trajectory-agent.md)、[视觉接口](identity-vision-provider.md) |
| 上云与交付计划 | [服务分工与部署顺序](aws-deployment-architecture-20261006.md)、[10 月 6 日预检与 S3 实际上传](aws-cloud-preflight-20261006.md)、[AWS 迁移设计](aws-workbench-deployment-guide.md)、[接续清单](contest-readiness-20261005.md) |
| 产品规划 | [概念讨论](agent-concept-review.md)、`plans/`、`specs/` |
| 已有功能的回归与问题 | [功能复检](function-audit-20261004.md)、[成果与问题](progress-and-open-issues-20261004.md)、[历次更新](workbench-history-20261005.md) |

这里记录产品如何实现和使用。模型选型与独立实验去 [research](../../research/README.md)，安装和账号准备去 [environment](../../environment/README.md)，赛事官方要求去 [requirements](../../requirements/README.md)。
