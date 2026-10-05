# 篮球视觉、跟踪与空间映射研究

这里集中人物 / 篮球检测、跟踪、身份与脚点绑定、球场标定的研究报告、实验脚本和已保存结果。当前产品操作查[工作台指南](../../engineering/tools/player-review/README.md)。

| 想查的问题 | 研究入口 | 配套结果 |
| --- | --- | --- |
| 新导入视频的错人续接、战术更正与大草稿 | [THY 诊断整理](imported-video-diagnostics-20261005.md) | 来源交接已同步；动画、浏览器草稿和多数截图仅在作者本机 |
| 篮球与人物如何检测、跨帧跟踪 | [模型与十人工作台对照](player-tracking-workbench-20261002.md)、[E-BARD 评估](vision-player-refinement/ebard-assessment.md) | [跟踪测量](vision-player-refinement/ebard-tracking-probe.json) |
| 脚环、编号、球队颜色怎样对应人物 | [脚下编号与分队](player-team-overlay-20261002.md)、[身份绑定核查](vision-player-refinement/identity-binding-review.md)、[身份与 2K 匹配](player-identity-2k-20261002.md) | [身份抽查](player-tracking-spotchecks-20261002.json) |
| 脚点来自检测框还是脚踝 | [脚部工具调研](vision-player-refinement/ground-tools-survey.md)、[脚部模型对照](vision-player-refinement/feet-model-comparison.md) | [脚部测量](vision-player-refinement/feet-model-comparison.json) |
| 球场、镜头和 2D 坐标如何对应 | [标定实验](vision-player-refinement/court-calibration-research.md)、[场地模型对照](vision-player-refinement/court-model-comparison.md)、[镜头传播验证](vision-player-refinement/propagation-validation.md) | 同专题 JSON、参考点和候选 |
| 全场与移动镜头效果如何 | [全场实验](court-fullcourt-20261004.md)、[泛化压力测试](court-generalization-20261004.md)、[开源工具比较](fullcourt-tools-and-camera-tracking-20261004.md) | [线段检查](court-fullcourt-20261004-line-checks.json) |
| 原视频叠加与关系模型 | [方案评估](video-overlay-vision-assessment.md) | 以报告标明的源码 / 实测边界为准 |
| 复跑纯研究脚本 | [scripts](scripts/README.md) | 默认输出、来源和参数见对应脚本 / 专题 |

`vision-player-refinement/` 保留完整的早期专题及结果配套，便于回溯。JSON、来源快照和原始测量保持字节不变；其中历史路径按[迁移表](../../docs/repository-map.md)定位。覆盖率、候选数量和跑通模型不能当作独立准确率。
