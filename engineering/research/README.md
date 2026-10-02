# 技术研究与实验索引

更新：2026-10-02，Asia/Shanghai。此目录集中软件方案依据、技术研究和测量；[赛事规则与历史来源](../../requirements/README.md)单独保存，实验结果不代替赛事要求。

| 专题 | 入口 | 已验证与限制 |
|---|---|---|
| E-BARD 篮球专用检测 | [模型评估与本机对照](vision-player-refinement/ebard-assessment.md)、[持续跟踪实测](vision-player-refinement/ebard-tracking-probe.json)、[工作台](../tools/player-review/README.md) | 已随 aa2ba4f 推送；三个样例提供通用 YOLOv8s / E-BARD YOLOv8n 可选，后者默认推荐；815 帧解码检测跟踪共 15.83 秒，含球 / 篮筐候选。身份和位置精度未验收；ByteTrack 后续转交 |
| 脚部与场地现成工具 | [来源核查](vision-player-refinement/ground-tools-survey.md)、[脚部实测](vision-player-refinement/feet-model-comparison.md)、[场地实测](vision-player-refinement/court-model-comparison.md)、[传播核验](vision-player-refinement/propagation-validation.md) | RTMPose-s 已生成三个样例的人工可采用候选；48 点模型与 KaliCalib 已实测，前者有半场误认。工作台接入可复核参考及 SIFT / LK 镜头跟随；真实接地、米制精度仍待验收 |
| 裁剪及人工身份规则 | [身份绑定核查](vision-player-refinement/identity-binding-review.md)、[工作台](../tools/player-review/README.md) | 多区间拼接、从确认帧向后绑定、重复 ID 错段释放；46 项 JavaScript 与 4 项裁切回归通过，真人身份仍需复核 |
| 当前数据提取流程 | [三步流程](vision-player-refinement/data-extraction-workflow.md) | 先筛直播、再标人、再补轨迹；战术分析与讲解后续处理 |
| 脚点、场地和相机 | [专项实验](vision-player-refinement/court-calibration-research.md) | 多点拟合、核验及局部敏感度；姿态与 KaliCalib 仅离线抽样，米制精度未验收 |
| 漏检与跨帧身份 | [实验和诊断](vision-player-refinement/README.md) | 五种跟踪配置和球衣约束对照，仍有串号；单片段调参不能推广准确率 |
| 本机与 AWS 可行性 | [部署评估](vision-local-aws-deployment.md)、[测量摘要](vision-deployment-benchmark/README.md) | 一个 8.1 秒片段十次运行；完整成片和云部署未验证 |
| 原视频叠加与关系模型 | [RelateAnything 评估](video-overlay-vision-assessment.md) | 源码和接口研究；关系模型尚未运行，不作为现成能力 |
| Jev 可用性 | [地区研究](jev-regional-availability.md)、[已发询问信](jev-support-email-2026-09-28.md) | 等待厂商回复，未实测或决定采用 |

原始 JSON 测量、参考点与来源快照保留采集时字节，其中的旧路径是历史记录；当前视频位置查[视频入口](../../data/videos/README.md)，当前命令使用 `engineering/scripts/`。实验输出、模型、第三方源码与浏览器草稿仍在本机忽略目录。归档共享不代表功能或精度已经验收。
