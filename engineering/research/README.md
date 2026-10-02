# 技术研究与实验索引

更新：2026-10-02，Asia/Shanghai。此目录集中软件方案依据、技术研究和测量；[赛事规则与历史来源](../../requirements/README.md)单独保存，实验结果不代替赛事要求。

当前工作台整合说明见[独立分支更新记录](../docs/workbench-branch-update-20261002.md)：沿用用户版左侧导航、分步骤工具和底部 2D 抽屉，接入 THY 模型与 2K 查询，并增加整段 T 归并与审核来源提示。红蓝只表示分队，不推断攻守。发布目标为 `codex/local-workbench-20261002`，不合入 main；实际提交和同步状态以该记录及最新交接为准。

THY 的 20:27 [发布记录](player-workbench-publish-20261002.md)和[交接](../../handoffs/thy-0629/2026-10-02-2027-workbench-identity-publish.md)是本次来源。下表的默认简版、提交位置与实测状态对应各自历史轮次；当前界面以[工作台说明](../tools/player-review/README.md)为准。

2026-10-02 19:30，十个编号下新增折叠的[人工资料确认与 2K 能力](player-identity-2k-20261002.md)：按赛季、球队和文字号码查找，核对候选后明确确认。资料与轨道状态独立；本轮没有优化追踪或部署新模型。

| 专题 | 入口 | 已验证与限制 |
|---|---|---|
| 人工球员资料与初步 2K 匹配 | [接口、使用与实测](player-identity-2k-20261002.md)、[计划](../docs/plans/2026-10-02-player-identity-2k.md) | 13 项原能力、null 与逐字段来源；0 / 00 分开、多候选须选人、确认 / 清除可撤销。17 新 / 144 全 JS、22 新 / 102 全 Python及独立产品审查通过，真实 QA 流程通过；迟返 / 网络故障用实际 app 可控 harness 验证。850 项原文件、67 项备份和 17 版 clip 字节保持，资料确认不证明整段真人一致；本机未提交推送，证据在忽略目录 |
| 球员单标注与漏框修复 | [原因、同片计数与验证](player-annotation-simple-20261002.md)、[设计与验收](../docs/plans/2026-10-02-player-annotation-simple.md) | 默认简版、自动编号与可撤销纠正；四段恢复636条实际编号观测，队色不再删身份。原检测、帧 / PTS、草稿指纹与高级工具保留；重复框、遮挡和未标记串人仍待处理。本机改动未提交推送 |
| E-BARD 篮球专用检测 | [模型评估与本机对照](vision-player-refinement/ebard-assessment.md)、[持续跟踪实测](vision-player-refinement/ebard-tracking-probe.json)、[工作台](../tools/player-review/README.md) | 已随 aa2ba4f 推送；三个样例提供通用 YOLOv8s / E-BARD YOLOv8n 可选，后者默认推荐；815 帧解码检测跟踪共 15.83 秒，含球 / 篮筐候选。身份和位置精度未验收；ByteTrack 后续转交 |
| 脚部与场地现成工具 | [来源核查](vision-player-refinement/ground-tools-survey.md)、[脚部实测](vision-player-refinement/feet-model-comparison.md)、[场地实测](vision-player-refinement/court-model-comparison.md)、[传播核验](vision-player-refinement/propagation-validation.md) | RTMPose-s 已生成三个样例的人工可采用候选；48 点模型与 KaliCalib 已实测，前者有半场误认。工作台接入可复核参考及 SIFT / LK 镜头跟随；真实接地、米制精度仍待验收 |
| 两队颜色、稳定框与脚下编号 | [实现 / 同片指标 / 复现](player-team-overlay-20261002.md) | 本地四段team-stable、两组五人槽位、同队同色、独立人工分队及展示滤波；149项回归、最终17项输入相关回归、独立审查 / 媒体 / HTTP / 浏览器QA通过。LAL只有4+4个未确认分队建议，脚环为图像参考，身份串号未解决；未提交推送 |
| 篮球模型与固定十人工作台 | [实施与同片对照](player-tracking-workbench-20261002.md) | 本地四段篮球候选、固定球员 1–10 和人工建议复核；127 项回归及真实界面 / 音轨 / PTS 验证通过。改善重复和完整框，原生跨队串号及零自动片段连接明确保留；未提交推送 |
| 篮球专用权重单段试跑 | [E-BARD / 005 实测](player-test-20261002.md) | 本机 CUDA 完整处理 267 帧；标注视频本地可播放，存在漏检、重复框及跨队串 ID，未达到自动身份验收要求 |
| 裁剪及人工身份规则 | [身份绑定核查](vision-player-refinement/identity-binding-review.md)、[工作台](../tools/player-review/README.md) | 多区间拼接、从确认帧向后绑定、重复 ID 错段释放；46 项 JavaScript 与 4 项裁切回归通过，真人身份仍需复核 |
| 当前数据提取流程 | [三步流程](vision-player-refinement/data-extraction-workflow.md) | 先筛直播、再标人、再补轨迹；战术分析与讲解后续处理 |
| 脚点、场地和相机 | [专项实验](vision-player-refinement/court-calibration-research.md) | 多点拟合、核验及局部敏感度；姿态与 KaliCalib 仅离线抽样，米制精度未验收 |
| 漏检与跨帧身份 | [实验和诊断](vision-player-refinement/README.md) | 五种跟踪配置和球衣约束对照，仍有串号；单片段调参不能推广准确率 |
| 本机与 AWS 可行性 | [部署评估](vision-local-aws-deployment.md)、[测量摘要](vision-deployment-benchmark/README.md) | 一个 8.1 秒片段十次运行；完整成片和云部署未验证 |
| 原视频叠加与关系模型 | [RelateAnything 评估](video-overlay-vision-assessment.md) | 源码和接口研究；关系模型尚未运行，不作为现成能力 |
| Jev 可用性 | [地区研究](jev-regional-availability.md)、[已发询问信](jev-support-email-2026-09-28.md) | 等待厂商回复，未实测或决定采用 |

原始 JSON 测量、参考点与来源快照保留采集时字节，其中的旧路径是历史记录；当前视频位置查[视频入口](../../data/videos/README.md)，当前命令使用 `engineering/scripts/`。实验输出、模型、第三方源码与浏览器草稿仍在本机忽略目录。归档共享不代表功能或精度已经验收。
