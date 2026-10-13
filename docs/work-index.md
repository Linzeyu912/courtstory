# 历史成果与接续索引

本页保留历次调研与实现的接续关系。查找当前目录请先看[仓库 README](../README.md)，产品介绍见[产品 README](../engineering/README.md)，数据见[数据总览](../data/README.md)，团队决定与协作入口见[团队文档](README.md)，最新进展见[状态记录](status.md)。

## 历史记录的阅读方式

以下“当前”“已完成”“待执行”和云端状态均保留记录当时的含义，不代表今天重新验证。已移除的旧样例链接到 Git 历史版本，不能作为当前工作台输入。

更新：2026-10-07，Asia/Singapore（UTC+8）。本页按问题串联 Linzeyu912、chuali-zi、thy-0629 各自记录中的成果，方便在另一台电脑接手；不代表新增职责分配或团队技术共识。

当前先看[云端当前版本实测](../engineering/docs/cloud-current-version-20261007.md)和[10 月 8 日重置后的恢复计划](../engineering/docs/plans/2026-10-08-cloud-reset-redeployment.md)：人工闭环与真实换目录恢复已通过，模型候选生成 / 采用仍未通过最新验收。下方历史交接中的“未提交”保留当时语境，分类发布情况见[10 月 7 日发布记录](../handoffs/Linzeyu912/2026-10-07-2345-classified-publication.md)。

2026-10-06 21:18 已将六组主题更新推送至 `main`，并核对远端为 `0336ac9`；本页、根入口、团队状态与发布交接随最后一条协作提交同步。AWS 可用性、赛事交付规则、工程准备和模型调研分别存放，分类提交清单见[本次发布交接](../handoffs/Linzeyu912/2026-10-06-2118-classified-publication.md)。原交接的“未提交 / 未推送”保留当时事实，当前共享状态以最新发布记录及 Git 为准。

历史发布：10 月 5 日整理时已拉取远端 `13923fd` / `82a8257`，其中新增两条提交来自 thy-0629；同日 22:49 已核对五个主题提交推送至 main，详见[10 月 5 日发布交接](../handoffs/Linzeyu912/2026-10-05-2250-classified-publication.md)。10 月 6 日早间又拉取至 `be5c43d`，新增人工制作和 Qwen 实测回放，见[合作者更新核对](../handoffs/Linzeyu912/2026-10-06-0844-collaborator-update-review.md)。

## 按问题找成果

| 想继续什么 | 调研 / 依据 | 作品 / 操作入口 | 当前边界与下一步 |
| --- | --- | --- | --- |
| 重建当前云端工作台 | [现版本实测](../engineering/docs/cloud-current-version-20261007.md)、[重置恢复计划](../engineering/docs/plans/2026-10-08-cloud-reset-redeployment.md) | [部署 / 快照 / 迁移工具](../engineering/infra/ec2-workbench/README.md) | 本机完整包保留；新账号环境重新发现后才部署；GPU / 身份链路未全部接齐 |
| 在 EC2 使用 Codex 与核对外部视觉模型 | [Codex CLI 实测报告](../research/agents/codex-cli-ec2-20261007.md)、[OpenRouter 多模态实测](../environment/aws/openrouter-multimodal-connectivity-20261007.md) | [Codex 环境记录](../environment/aws/codex-cli-ec2-20261007.md) | 安装、个人授权和短请求通过；不代表工作台服务用户已授权或多轮 / 长任务验收 |
| 继续产品与界面设计 | [CourtStory 定位](../engineering/docs/product-repository-proposal-20261007.md)、[NBA Broadcast Studio 入口](../engineering/docs/ui-nba-direction-20261009.md) | [工程文档入口](../engineering/docs/README.md) | 已删除 Anthropic 纸感分支及工作区，NBA 界面已改为黑白双层顶栏；分类提交与 main 合并状态见[发布记录](../engineering/docs/ui-publication-20261010.md)，成品仓库代码 / Tag / Release 仍暂缓 |
| 篮球 / 人物检测与连续身份 | [视觉研究](../research/vision/README.md)、[身份绑定](../research/vision/vision-player-refinement/identity-binding-review.md) | [身份审核](../engineering/docs/track-identity-review.md)、[模型选择](../engineering/docs/model-selection-layout.md) | 候选和脚环不等于真人身份；先核对续接与缺口 |
| 脚点、球场与 2D 位置 | [脚部对照](../research/vision/vision-player-refinement/feet-model-comparison.md)、[全场实验](../research/vision/court-fullcourt-20261004.md) | [球场标定](../engineering/docs/court-calibration-backend.md)、[2D 主流程](../engineering/docs/2d-first-tactics-workbench-guide.md) | 映射覆盖不代表精度；保留人工复核和缺失标记 |
| 用 Qwen 反复看帧修正轨迹 | [讨论与源码研究](../research/agents/qwen-video-trajectory-agent-20261005.md)、[官方两片实测](../research/agents/qwen-ground-official-20261005/README.md) | [实现指南](../engineering/docs/qwen-ground-trajectory-agent.md)、[更新核对](../handoffs/Linzeyu912/2026-10-06-0844-collaborator-update-review.md) | 已有真实模型调用与同步回放；每片仅一人约 5 秒，002 存在误删可见点，定位精度与采用 / 撤销流程仍待验收 |
| 比较多模态模型与理解 Qwen 规格 | [多模态篮球调研](../research/agents/multimodal-basketball-20261006/README.md)、[Qwen3-VL 说明](../research/agents/multimodal-basketball-20261006/qwen3-vl-235b-a22b.md) | [本队 Bedrock 白名单与实测](../environment/aws/bedrock-model-access-20261006.md) | 厂商规格不等于本队可调用；本队 Qwen 文本请求通过，Sonnet 尚未调用 |
| 评估点选跟随与遮挡恢复 | [TAPNext++ 研究](../research/vision/tapnet-20261006/README.md) | [独立运行探针](../research/vision/tapnet-20261006/probe_runtime.py) | CPU / CUDA 随机参数接口通过；正式权重与篮球效果未测，未接工作台 |
| Agent 如何读取视频 | [OpenCode / Codex 源码](../research/agents/agent-video-understanding-20261005/README.md)、[视频模型研究](../research/agents/video-model-to-court-20261005/README.md) | [视觉接口](../engineering/docs/identity-vision-provider.md) | 固定源码和离线检查，不能当作真实推理成功 |
| 复用认可的战术大箭头效果 | [005 V2 原始资料（历史版本）](https://github.com/Linzeyu912/courtstory/blob/56e6466057c0560701d3163d2dbd1384e59249d2/engineering/archive/tactical-video/005-authored-v2/README.md) | [005 V2 流程](../engineering/docs/005-authored-v2-workflow.md)、[成片操作](../engineering/docs/tactics-authored-production-guide.md) | 共享的是配置、脚本和说明；成片 MP4 未随本次提交共享，新视频须重做人物与坐标核对 |
| 接续导入视频的身份 / 战术问题 | [新诊断入口](../research/vision/imported-video-diagnostics-20261005.md) | [2D 工作流](../engineering/docs/2d-first-tactics-workbench-guide.md)、[战术画布](../engineering/docs/tactics-canvas.md) | 续接存在错人，38.5 MB 草稿与服务端保存待处理；作者本机动画 / 草稿未同步 |
| 使用篮球论文模型 | [14 篇功能指南](../research/basketball-models/mentor-components-20261005/PAPER_GUIDE.md)、[权重核查](../research/basketball-models/mentor-components-20261005/OPEN_SOURCE_AUDIT.md)、[遮挡球员热图论文](../research/basketball-models/occluded-player-heatmap-20261006.md) | [研究复现](../research/basketball-models/mentor-components-20261005/REPRODUCE.md) | 已有局部试跑；热图论文未确认公开代码 / 权重；尚未验证本项目新视频精度 |
| 区分事实、候选和推断 | [数据证据与纠错研究](../research/evidence/README.md) | 各工作台来源 / 待审核字段 | 离线实验保留失败，不可直接升级成官方指标或人工真值 |
| 准备电脑与核对 AWS 服务 | [本机环境](../environment/local/README.md)、[19 项服务实测](../environment/aws/services-live-audit-20261006.md)、[服务入门](../environment/aws/services-primer-20261006.md) | [当前 EC2 部署](../engineering/infra/ec2-workbench/README.md)、[S3 实际上传与脚本](../engineering/docs/aws-cloud-preflight-20261006.md) | 10 月 6 日独立探针已清理；10 月 7 日工作台云服务保留，具体限制见当前验收；两轮资源状态不能混用 |
| 理解 CloudFront、代码重跑和截止时间 | [评审与截止时间澄清](../requirements/judging-operation-clarification-20261006.md)、[CDK 补充通知](../requirements/cdk-deployment-notice-20261006.md) | [提交入口与制作工作台](../engineering/docs/aws-workbench-deployment-guide.md#作品提交入口与制作工作台) | 考试视频 18:00 发布，19:45 结束调优，20:00 截止；截止后继续加工没有已读规则支持，机器评测接口仍待明确 |
| 核对赛事与正式素材 | [赛事索引](../requirements/README.md)、[训练包核验](../requirements/training-package-check-20261005.md)、[官方训练重点素材（历史版本）](https://github.com/Linzeyu912/courtstory/blob/56e6466057c0560701d3163d2dbd1384e59249d2/data/videos/uploads/2026-10-05-official-training/README.md) | [视频数据入口](../data/videos/README.md) | 两段已按10维打标并接入工作台，优先用于回归；官方指标与事件对齐仍需补齐 |

## 回到对应成员的原记录

| 记录来源 | 关键交接 | 用途 |
| --- | --- | --- |
| chuali-zi | [2D 工作流](../handoffs/chuali-zi/2026-10-05-0127-2d-first-tactics-workbench.md)、[Qwen 首版](../handoffs/chuali-zi/2026-10-05-0651-qwen-ground-trajectory-implementation.md)、[视频源码研究](../handoffs/chuali-zi/2026-10-05-0410-agent-video-source-study.md) | 找实现范围、环境限制和真实验收缺口 |
| thy-0629 | [导入视频进度及更正](../handoffs/thy-0629/2026-10-05-1910-agent-court-tactics-progress.md)、[005 流程归档](../handoffs/thy-0629/2026-10-05-2107-approved-005-workflow.md) | 区分本机草稿、已共享归档、风格认可和身份待确认 |
| Linzeyu912 | [模型发布核查](../handoffs/Linzeyu912/2026-10-05-2045-hoop-model-release-audit.md)、[AWS 盘点](../handoffs/Linzeyu912/2026-10-05-2148-aws-readiness-inventory.md)、[CDK / 训练包](../handoffs/Linzeyu912/2026-10-05-2203-cdk-workbench-cloud-guide.md)、[四类目录整理](../handoffs/Linzeyu912/2026-10-05-2220-repository-content-separation.md) | 找研究证据、环境结果与跨目录迁移依据 |

## 新文件继续放哪里

调研、实验和诊断归 [research](../research/README.md)，官方要求归 [requirements](../requirements/README.md)，依赖 / 账号准备归 [environment](../environment/README.md)，产品实现与操作归 [engineering](../engineering/README.md)。数据和原始快照留原入口，历史过程放 [handoffs](../handoffs/README.md)。本页只链接和说明接续关系，不复制每份报告全文。
