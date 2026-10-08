# 篮球视觉、跟踪与空间映射研究

这里集中人物 / 篮球检测、跟踪、身份与脚点绑定、球场标定的研究报告、实验脚本和已保存结果。当前产品操作查[工作台指南](../../engineering/tools/player-review/README.md)。

| 想查的问题 | 研究入口 | 配套结果 |
| --- | --- | --- |
| 姓名识别第一版真实调用与可开关成片 | [全员 Qwen 与三秒生产渲染 QA](player-name-identity-20261007/README.md)、[工程操作](../../engineering/docs/player-name-identification-20261007.md) | v3 二十次请求成功，冲突后五名有限区间候选；十人全片姓名精度仍未验收 |
| 如何认出球员姓名并在脚下按需显示 | [2026-10-07 方法调研与建议](player-name-identification-20261007.md)、[姓名渲染 QA](player-name-identity-20261007/README.md) | 工作台与两条 MP4 路径已接显示开关；真实 Qwen 候选短片通过，非十人姓名准确率验收 |
| TAPIR 能否补强原视频跟踪，是否可省略强制 2D 操作 | [2026-10-06 TAPIR 真实小试](tapir-direct-video-20261006/README.md)、[方案影响](tapir-direct-video-20261006/assessment.md) | 同片四个自动种子；保留宽屏适配失败与方形控制，三栏真实成片；0.900 秒为单人四点推理，不是十人全链 |
| Agent 能否直接在原视频上画战术，2D 投影有何区别 | [2026-10-06 三秒真实视频对照](direct-video-vs-court-20261006/README.md) | 同一次视觉候选复用现有像素 / 球场流程；本地成片、耗时与候选投影限制见报告，非十人全链验收 |
| 大模型能否接回遮挡后换 T 的球员，能否读号码与队标 | [2026-10-06 单球员真实续接试验](player-identity-continuation-20261006/README.md) | T2 → T39；181 帧区间内 52 → 156 个位置，25 帧保持未知；参考号码 00 与记分牌 IND / BKN 单次视觉证据，未采用到正式草稿 |
| TAPNet 能否辅助点选跟随、遮挡恢复与球场参照 | [TAPNext++ 可用性调研](tapnet-20261006/README.md) | 官方源码 / 权重许可核查；CPU 与 CUDA 随机参数接口探针通过，正式权重及篮球效果未测 |
| 新导入视频的错人续接、战术更正与大草稿 | [THY 诊断整理](imported-video-diagnostics-20261005.md) | 来源交接已同步；动画、浏览器草稿和多数截图仅在作者本机 |
| 篮球与人物如何检测、跨帧跟踪 | [模型与十人工作台对照](player-tracking-workbench-20261002.md)、[E-BARD 评估](vision-player-refinement/ebard-assessment.md) | [跟踪测量](vision-player-refinement/ebard-tracking-probe.json) |
| 脚环、编号、球队颜色怎样对应人物 | [脚下编号与分队](player-team-overlay-20261002.md)、[身份绑定核查](vision-player-refinement/identity-binding-review.md)、[身份与 2K 匹配](player-identity-2k-20261002.md) | [身份抽查](player-tracking-spotchecks-20261002.json) |
| 脚点来自检测框还是脚踝 | [脚部工具调研](vision-player-refinement/ground-tools-survey.md)、[脚部模型对照](vision-player-refinement/feet-model-comparison.md) | [脚部测量](vision-player-refinement/feet-model-comparison.json) |
| 球场、镜头和 2D 坐标如何对应 | [标定实验](vision-player-refinement/court-calibration-research.md)、[场地模型对照](vision-player-refinement/court-model-comparison.md)、[镜头传播验证](vision-player-refinement/propagation-validation.md) | 同专题 JSON、参考点和候选 |
| 全场与移动镜头效果如何 | [全场实验](court-fullcourt-20261004.md)、[泛化压力测试](court-generalization-20261004.md)、[开源工具比较](fullcourt-tools-and-camera-tracking-20261004.md) | [线段检查](court-fullcourt-20261004-line-checks.json) |
| 原视频叠加与关系模型 | [方案评估](video-overlay-vision-assessment.md) | 以报告标明的源码 / 实测边界为准 |
| 复跑纯研究脚本 | [scripts](scripts/README.md) | 默认输出、来源和参数见对应脚本 / 专题 |

`vision-player-refinement/` 保留完整的早期专题及结果配套，便于回溯。JSON、来源快照和原始测量保持字节不变；其中历史路径按[迁移表](../../docs/repository-map.md)定位。覆盖率、候选数量和跑通模型不能当作独立准确率。
