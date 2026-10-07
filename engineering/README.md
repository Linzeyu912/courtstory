# 作品工程

2026-10-07（按用户授权发布当前成果）：固定原球员、框和球场材料，为十人各建独立Qwen上下文，完成001/002测试、Token Plan两路并行及实际重连；两片均无终态失败，候选仍partial。显式去噪和原观察台三层对照已验证，轻量回放随研究目录共享；定位准确性尚未通过验收。见[并行映射实验](../research/agents/qwen-parallel-20261007/README.md)与[去噪说明](docs/ground-trajectory-denoise.md)。

2026-10-07（本机工作台改进，未提交／推送）：针对整段初稿失败、多人标注不足、重点圈点击与 2D 难用，补齐分段保留／失败重试、刷新恢复、人工定位圈和可选球场映射步骤。21.54 秒真实片已在一次失败段重试后得到 22 个新增图形；原失败记录与两个测试圈保留。操作、实际验证及仍存在的模型耗时限制见[工作台可用性与人工接管](docs/workbench-usability-20261007.md)。这不替代前轮独立 runner 的 M0／M1 验收。

2026-10-06（首批实现，本地未提交／未推送）：按 Final v1 新增统一持久 runner、CLI、Bearer HTTP 薄入口和十个工具阶段，接通真实检测、多人暂停身体标记、独立复核、隔离保存及 MP4。最新 005 在一次修复后仍有重叠人物指向歧义，停在 needs_attention，M1 合格成片验收未完成。实际结果、失败证据及边界见[本轮实施与验收](docs/agent-tactics-implementation-20261006.md)，命令见[运行入口](agent-workflows/tactics-v1/README.md)，来源保护见[固定基线](docs/agent-tactics-baseline-20261006.md)。当前战术界面与原草稿保持；TAPIR、自动连续路线、几何生产分支、完整局部修复及六段完整验收仍须后续推进。下方规划记录保留历史时点。

2026-10-06（最终规划，本地未提交／未推送）：合并聊天决定、代码审计与实测，形成[Agent 工具／多球员标注执行计划](docs/plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)、[Agent 工作流程](docs/agent-tactics-workflow.md)和[工具合同](docs/specs/agent-tactics-tools-v1.md)。先交付一次调用的多人标注闭环，再增强 TAPIR 连续性、按需地面映射与第三方 API；当前战术布局／模块保持。新增工具与 runner 尚未实现，详见[交接](../handoffs/thy-0629/2026-10-06-1854-agent-tactics-final-plan.md)。

2026-10-06（本地未提交／未推送）：球员标定页增加球队／号码和固定身份续接常显入口、慢放；修复 OCR 置信度及名单衔接，接入待审核的队标视觉候选。当前视频 00 号的遮挡续接与实际页面采用已验证，缺测仍留空；十人全片身份与 2D 精度尚未验收。见[工作台操作](tools/player-review/README.md)、[真实试验](../research/vision/player-identity-continuation-20261006/README.md)及[交接](../handoffs/thy-0629/2026-10-06-1203-identity-continuation-and-team-matching.md)。

2026-10-06 晚间：[AWS 19 项服务独立实测](../environment/aws/services-live-audit-20261006.md)已有实际运行结果，临时探针已清理。下方预检和架构记录保留各自时间范围；完整工作台、正式 Agent 与成片展示网站的部署和验收仍待完成。

2026-10-06：新增 [AWS 服务分工与部署顺序](docs/aws-deployment-architecture-20261006.md)，说明 S3、AgentCore、Bedrock、CPU ECS/Fargate / EC2 与 SageMaker GPU 的接法及验收标准。本轮仅方案与只读核验；CLI 身份可用，AWS 插件需重新认证，尚未部署应用。

2026-10-06：两段官方训练片已上传本队 S3 并通过远端 SHA-256 校验；[账号 / 代码预检与上传说明](docs/aws-cloud-preflight-20261006.md)记录实际对象、复跑命令及部署缺口。AgentCore、EC2、CloudFront 应用尚未部署，不能把素材上传当成云端运行完成。

2026-10-05：现有工作台新增 [人工视频制作流程](docs/manual-tactics-workbench-guide.md)，支持不识别直接打开视频、多个跑位/传球/挡拆的独立时间、讲解暂停、点击路线校正、保存与正式 MP4。固定画面、合成移动映射与真实 VFR 已从空白通过界面导出；真实 005 与历史迁移未验证，详见 [006 验收](docs/manual-tactics-workbench-acceptance.md)。

跨成员成果与下一步从[接续总览](../docs/work-index.md)进入。新拉取的 [005 V2 成片流程](docs/005-authored-v2-workflow.md)保留认可的视觉基准；[导入视频诊断](../research/vision/imported-video-diagnostics-20261005.md)记录身份和大草稿的实际缺口，两者分别维护。

更新：2026-10-05，Asia/Shanghai。这里集中工作台、Agent、图形渲染、产品设计与测试；独立[调研与实验](../research/README.md)及[环境准备](../environment/README.md)已分目录。[赛事要求](../requirements/README.md)、[视频数据](../data/videos/README.md)和[团队协作](../docs/workflow.md)分别维护。

本轮[仓库清理](docs/repository-cleanup-20261005.md)已完成并分类推送：旧入口与像素尾迹删除、候选去重、七个历史脚本归档；默认验收样例改为 005。三条实现提交及后续文档同步见[发布交接](../handoffs/Linzeyu912/2026-10-05-1014-cleanup-classified-publication.md)，既有功能进展仍见下方汇总。

优先阅读[当前成果、问题与调研汇总](docs/progress-and-open-issues-20261004.md)：包含分类提交、THY 整合、已知失败、最新回归与接续建议。离线全场标定尚未接入工作台默认后端，矩阵覆盖和人物联合准确性分别记录。

| 部分 | 位置 | 当前作用 |
|---|---|---|
| 素材标签人工审核 | [tools/material-label-review/](tools/material-label-review/README.md) | 逐项评价、去留决定与落盘；当前标签及人工来源见结构化素材目录 |
| 人工复核工作台 | [tools/player-review/](tools/player-review/README.md) | 直播多区间裁剪、P1–P10 身份分界、轨迹补点与同步 2D 球场 |
| Python 服务及视觉工具 | [scripts/](scripts/README.md) | 本机 HTTP 服务、裁剪与候选处理；检测、跟踪与场地实验单独运行 |
| 历史专用脚本 | [archive/](archive/README.md) | 旧单片球衣实验和旧素材审核生成器；不作为当前工作台入口 |
| 产品设计 | [docs/agent-concept-review.md](docs/agent-concept-review.md) | 解说 Agent 讨论稿，技术选型及完整产品待验收 |
| 产品文档与交付设计 | [docs/](docs/README.md) | 功能接口、设计、实施计划及验收记录 |

研究报告、纯实验脚本和原始测量集中在仓库根 `research/`；安装、模型依赖和 AWS 登录状态集中在 `environment/`。本目录不再承接这些独立资料。未来 CDK 应用代码属于作品工程，可放在 `engineering/infra/`，目前尚未实现。

## 环境与运行

先按[本机环境准备](../environment/local/README.md)安装依赖与取得 LFS 视频，再按[工作台说明](tools/player-review/README.md)启动和操作。模型权重、Python / CUDA 环境及版本说明在[模型环境](../environment/local/model-runtime.md)，AWS CLI / CDK 与身份状态在[AWS 准备](../environment/aws/README.md)。

依赖清单、构建配置和功能测试随工程代码保留；安装步骤在环境目录维护。

目前工作台已支持 OCR 候选证据、身份续接候选、战术 Agent 生成 / 预览 / 采用和人工图形编辑，但真实调用成功、身份与米制精度仍需逐项核对。自动直播分类、完整战术讲解和云部署尚未完成；当前导入不会自动运行姿态模型。字段是内部原型约定，不是赛事官方数据格式。
