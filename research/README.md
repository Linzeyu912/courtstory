# 调研与实验结果

这里保存“研究过什么、怎样验证、实际结果和限制是什么”。调研报告、实验脚本、来源与结果按专题配套保存。

跨成员、跨研究与作品的关系见[成果与接续总览](../docs/work-index.md)。本次远端新增的[导入视频诊断](vision/imported-video-diagnostics-20261005.md)已从交接整理为独立入口；005 成片制作流程属于作品工程，见[制作基准](../engineering/docs/005-authored-v2-workflow.md)。

| 专题目录 | 内容 |
| --- | --- |
| [vision/](vision/README.md) | 篮球 / 人物检测与跟踪、脚环编号、身份与脚点绑定、球场标定、镜头跟随、2D 映射 |
| [agents/](agents/README.md) | 视频理解、Qwen 地面轨迹 Agent、OpenCode / Codex 源码研究 |
| [basketball-models/](basketball-models/README.md) | 篮球论文、Hoop 系列模型、权重审计与本地试验 |
| [evidence/](evidence/README.md) | 数据来源规范、事实核验、纠错与故障实验 |
| [runtime/](runtime/README.md) | 历史运行性能、部署可行性与外部服务可用性调查 |

完整的旧专题清单与各轮结论见[历次研究索引](catalog-20261005.md)。它保留对应日期的状态；模型可下载、代码跑通、作者样例有效和本项目真实效果验收应分别判断。

当前环境设置去 [environment](../environment/README.md)，作品实现去 [engineering](../engineering/README.md)，官方任务去 [requirements](../requirements/README.md)。实验原始 JSON / 来源快照保持原貌；旧路径通过[迁移表](../docs/repository-map.md)定位。
