# 成果与接续总览

更新：2026-10-05，Asia/Shanghai。本页按问题串联 Linzeyu912、chuali-zi、thy-0629 各自记录中的成果，方便在另一台电脑接手；不代表新增职责分配或团队技术共识。

本轮已拉取远端 `13923fd` / `82a8257`。chuali-zi 的 2D / Qwen 代码与研究此前已在本地基线中；新增两条提交来自 thy-0629。原交接的“未提交 / 未推送”保留当时事实，不能据此推断当前 Git 状态。**10 月 5 日 22:49 已核对五个主题提交推送至 main；本页、四类目录索引和发布记录随最后一条协作提交同步。** 分类提交与验证范围见[发布交接](../handoffs/Linzeyu912/2026-10-05-2250-classified-publication.md)。

## 按问题找成果

| 想继续什么 | 调研 / 依据 | 作品 / 操作入口 | 当前边界与下一步 |
| --- | --- | --- | --- |
| 篮球 / 人物检测与连续身份 | [视觉研究](../research/vision/README.md)、[身份绑定](../research/vision/vision-player-refinement/identity-binding-review.md) | [身份审核](../engineering/docs/track-identity-review.md)、[模型选择](../engineering/docs/model-selection-layout.md) | 候选和脚环不等于真人身份；先核对续接与缺口 |
| 脚点、球场与 2D 位置 | [脚部对照](../research/vision/vision-player-refinement/feet-model-comparison.md)、[全场实验](../research/vision/court-fullcourt-20261004.md) | [球场标定](../engineering/docs/court-calibration-backend.md)、[2D 主流程](../engineering/docs/2d-first-tactics-workbench-guide.md) | 映射覆盖不代表精度；保留人工复核和缺失标记 |
| 用 Qwen 反复看帧修正轨迹 | [讨论与源码研究](../research/agents/qwen-video-trajectory-agent-20261005.md) | [实现指南](../engineering/docs/qwen-ground-trajectory-agent.md)、[实施计划](../engineering/docs/plans/2026-10-05-qwen-ground-trajectory-agent-v1.md) | 首版代码已实现；原交接未完成真实模型和视频效果验收 |
| Agent 如何读取视频 | [OpenCode / Codex 源码](../research/agents/agent-video-understanding-20261005/README.md)、[视频模型研究](../research/agents/video-model-to-court-20261005/README.md) | [视觉接口](../engineering/docs/identity-vision-provider.md) | 固定源码和离线检查，不能当作真实推理成功 |
| 复用认可的战术大箭头效果 | [005 V2 原始资料](../engineering/archive/tactical-video/005-authored-v2/README.md) | [005 V2 流程](../engineering/docs/005-authored-v2-workflow.md)、[成片操作](../engineering/docs/tactics-authored-production-guide.md) | 共享的是配置、脚本和说明；成片 MP4 未随本次提交共享，新视频须重做人物与坐标核对 |
| 接续导入视频的身份 / 战术问题 | [新诊断入口](../research/vision/imported-video-diagnostics-20261005.md) | [2D 工作流](../engineering/docs/2d-first-tactics-workbench-guide.md)、[战术画布](../engineering/docs/tactics-canvas.md) | 续接存在错人，38.5 MB 草稿与服务端保存待处理；作者本机动画 / 草稿未同步 |
| 使用篮球论文模型 | [14 篇功能指南](../research/basketball-models/mentor-components-20261005/PAPER_GUIDE.md)、[权重核查](../research/basketball-models/mentor-components-20261005/OPEN_SOURCE_AUDIT.md) | [研究复现](../research/basketball-models/mentor-components-20261005/REPRODUCE.md) | 已有局部试跑；尚未接入工作台或验证本项目新视频精度 |
| 区分事实、候选和推断 | [数据证据与纠错研究](../research/evidence/README.md) | 各工作台来源 / 待审核字段 | 离线实验保留失败，不可直接升级成官方指标或人工真值 |
| 准备电脑与 AWS 账号 | [本机环境](../environment/local/README.md)、[AWS 状态](../environment/aws/README.md) | [上云设计](../engineering/docs/aws-workbench-deployment-guide.md)、[作品接续](../engineering/docs/contest-readiness-20261005.md) | CLI / CDK / 身份、S3 临时文本读写和 Qwen 单次文本请求已有记录；图片 / 工具调用与应用部署仍待完成 |
| 核对赛事与正式素材 | [赛事索引](../requirements/README.md)、[训练包核验](../requirements/training-package-check-20261005.md) | [视频数据入口](../data/videos/README.md) | 来源、指标、事件对齐及赛事接口按正式核验接续，不以研究数据替代 |

## 回到对应成员的原记录

| 记录来源 | 关键交接 | 用途 |
| --- | --- | --- |
| chuali-zi | [2D 工作流](../handoffs/chuali-zi/2026-10-05-0127-2d-first-tactics-workbench.md)、[Qwen 首版](../handoffs/chuali-zi/2026-10-05-0651-qwen-ground-trajectory-implementation.md)、[视频源码研究](../handoffs/chuali-zi/2026-10-05-0410-agent-video-source-study.md) | 找实现范围、环境限制和真实验收缺口 |
| thy-0629 | [导入视频进度及更正](../handoffs/thy-0629/2026-10-05-1910-agent-court-tactics-progress.md)、[005 流程归档](../handoffs/thy-0629/2026-10-05-2107-approved-005-workflow.md) | 区分本机草稿、已共享归档、风格认可和身份待确认 |
| Linzeyu912 | [模型发布核查](../handoffs/Linzeyu912/2026-10-05-2045-hoop-model-release-audit.md)、[AWS 盘点](../handoffs/Linzeyu912/2026-10-05-2148-aws-readiness-inventory.md)、[CDK / 训练包](../handoffs/Linzeyu912/2026-10-05-2203-cdk-workbench-cloud-guide.md)、[四类目录整理](../handoffs/Linzeyu912/2026-10-05-2220-repository-content-separation.md) | 找研究证据、环境结果与跨目录迁移依据 |

## 新文件继续放哪里

调研、实验和诊断归 [research](../research/README.md)，官方要求归 [requirements](../requirements/README.md)，依赖 / 账号准备归 [environment](../environment/README.md)，产品实现与操作归 [engineering](../engineering/README.md)。数据和原始快照留原入口，历史过程放 [handoffs](../handoffs/README.md)。本页只链接和说明接续关系，不复制每份报告全文。
