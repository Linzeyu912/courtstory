# 作品工程

2026-10-09（America/New_York）：配音已切换为 Amazon Polly，默认 Zhiyu；其余模型与制作流程保持。AWS 配置、缓存兼容和验证范围见[配音工作流](docs/commentary-narration-workflow.md)。本轮未部署云端，真实中文试听待 AWS 登录后验证。

2026-10-09（America/New_York，单屏实施）：球员标定与战术布局直接在 main 开发，普通姓名可隐藏，有效重点圈始终显示关联姓名；见[实施说明与真实截图](docs/single-view-workbench-20261009.md)。此前[球员审核稿](docs/designs/player-single-view-20261009/README.md)和[战术审核稿](docs/designs/tactics-single-view-20261009/README.md)一并保留，产品实现以实际截图为准。

2026-10-10 本轮 TEAM 25 收敛：白色 TEAM／深蓝 25、顶栏字号层级、灰色图案定稿与最新 main 功能已完成整合验证，按界面、设计资料、协作记录分类发布；[发布与旧分支清理记录](docs/ui-team25-publication-20261010.md)提供实际状态。

2026-10-10 NBA UI 分类发布：用户已授权将真实工作台界面、资源服务、独立样稿及设计资料分别提交，先推送 UI 分支再合入 main；当前结果与验证见[发布记录](docs/ui-publication-20261010.md)。下方“未提交／未推送／未合并”保留各轮历史时点，Git 同步不等同于云部署。

2026-10-10：NBA UI 已同步 main `12c7413` 的前后端功能，按解说先行、独立绘图与联合成片调整真实页面；LIVE DESK 恢复斜体，球场映射入口归档。只在 UI 分支保存，未推送或部署；见[同步验收](docs/ui-main-sync-20261010.md)。

2026-10-10 01:04：按 NBA 官网实际样式更新正文 Roboto、直立窄体标题、黑白文字按钮和移动黑底线；复选勾蓝色、滑块白色，原红色品牌与重要状态点缀保留。只在 UI 分支维护，未提交／推送；见[规范](docs/broadcast-studio-style-20261009.md)、[审核图](docs/images/nba-ui-20261009/workbench-nba-interactions-20261010.jpg)与[交接](../handoffs/Linzeyu912/2026-10-10-0104-nba-text-interactions.md)。

2026-10-10 00:25：NBA UI 进一步统一为黑白主色、灰红点缀、蓝色交互；顶部只保留两组加粗的局部篮球／球场线稿，正文标题改为黑底白字。功能与标志保持，仅 UI 分支修改；见[规范](docs/broadcast-studio-style-20261009.md)和[交接](../handoffs/Linzeyu912/2026-10-10-0025-sparse-monochrome-ui.md)。

2026-10-10 00:12：NBA UI 黑栏简化为品牌与灰色篮球／球场线稿，四个工作流入口集中到第二行白栏，内部页签与原按钮完整保留。仅在 UI 分支修改，main 干净；见[当前规范](docs/broadcast-studio-style-20261009.md)和[交接](../handoffs/Linzeyu912/2026-10-10-0012-brand-header-workflow.md)。

2026-10-09 23:49：当前 NBA UI 已按最新要求改为黑白双层顶栏与浅灰白卡，原有按钮和业务功能保留。修改、文档及截图仅在 UI 分支，main 干净；见[当前规范](docs/broadcast-studio-style-20261009.md)和[交接](../handoffs/Linzeyu912/2026-10-09-2349-nba-double-topbar.md)。

2026-10-09 23:14：本聊天全部 UI 设计与配套文档已集中到 `codex/courtstory-ui-broadcast`，main 恢复干净；当前约定见 [AGENTS.md](../AGENTS.md)，设计入口见 [NBA Broadcast Studio](docs/ui-nba-direction-20261009.md)。本轮仅迁移与记录，没有改动现有产品代码，未提交 / 推送。

2026-10-09：按用户要求删除 Anthropic 纸感 UI 分支及其工作区，保留已有 [NBA Broadcast Studio](docs/ui-nba-direction-20261009.md)。NBA 的真实工作台适配位于本地 `codex/courtstory-ui-broadcast@eeb9169`，本轮保持原样；上一轮仅检查 main 导致的“尚未实现”判断已纠正。main 与云端未切换，本轮文档未提交 / 推送。

2026-10-09（真实 UI 集成，独立分支）：用户确认风格后授权覆盖现有产品页面。`player-review` 的四个工作区、内部步骤、视频库、解说与成片，以及独立轨迹回放页已统一为 Broadcast Studio。真实视频标注、草稿保存和 1080p 成片通过；730 项前端和 33 项服务测试通过。见[集成与验收](docs/broadcast-studio-workbench-20261009.md)。改动只在 `codex/courtstory-ui-broadcast`，main 与运行中的云服务保持原版本，本轮未推送。

2026-10-09（独立 UI 分支设计样稿）：用户选定 **Broadcast Studio／转播演播室**，旧玻璃与纸感 UI 分支已归档并从活动分支移除。新增[风格规范](docs/broadcast-studio-style-20261009.md)与[可交互样稿](tools/courtstory-broadcast-preview/README.md)，蓝红白、木色与篮球橙棕各有明确职责。真实视频、标注交互与四档窗口检查通过；尚未套用正式工作台，未推送。见[交接](../handoffs/Linzeyu912/2026-10-09-1713-broadcast-studio-ui.md)。 全部设计成果现已迁入 `codex/courtstory-ui-broadcast` 的独立 worktree；主开发 checkout 保持 main 且已恢复干净。

2026-10-10：[出手冻结与三色反馈](docs/shot-feedback-agent.md)接入解说先行、独立绘图和联合成片：分析出手前一秒，在已确认离手帧高亮出手者，显示投篮机会与防守压力。评价由后端保存，工作台不新增评分面板；代码验证与真实模型、云部署验收分别记录。

2026-10-09：[解说润色](docs/commentary-narration-workflow.md)已接入本机工作台：整段Astra文本润色、24条篮球表达材料、候选采用/撤回与两种配音口吻。三段真实视频与四个成片的[实测结果](../research/agents/commentary-personality-20261009/README.md)已保存；未部署云端。

2026-10-08按用户要求发布当前[全员姓名v4](docs/player-name-optimization-20261007.md)代码、复测记录与[完整渲染演示](../data/videos/demos/player-name-v4-20261008/README.md)。实际推送核对见[发布交接](../handoffs/chuali-zi/2026-10-08-0230-player-name-v4-publication.md)；历史“本地未提交”保留当时状态，Git共享不代表云端部署或准确率验收。

2026-10-07：总工作台第三部分现已接入「解说与配音」：Astra 生成带时间解说，逐句编辑保存，火山 TTS 配音、字幕成片预览与下载。运行与限制见[工作流](docs/commentary-narration-workflow.md)。

2026-10-07 本地新增 [球员姓名识别与脚底按需显示](docs/player-name-identification-20261007.md)：分段号码证据、比赛名单、有限补看、冲突保留，网页及正式 MP4 共用显示选择。真实试验保留未知，未通过十人全片姓名验收，未提交／推送。

2026-10-08 本地后续 [姓名识别 v4 优化](docs/player-name-optimization-20261007.md)：十名实际源图身份参考已齐，清晰号码和同人比较分别支持有限位置区间，修正旧机器错接与历史颜色状态造成的缺口；结果覆盖与新全片预览以优化记录为准，不把覆盖率当作准确率。

2026-10-07 分类发布：本页涉及的当前云端工程、恢复工具和方案记录随[分类提交记录](../handoffs/Linzeyu912/2026-10-07-2345-classified-publication.md)统一同步到 `main`。下方“未提交 / 推送”保留各轮写作时点；Git 同步不等同于更新运行中的云服务。

2026-10-07 晚间：已准备[10 月 8 日 09:00 全账号重置后的重新部署计划](docs/plans/2026-10-08-cloud-reset-redeployment.md)，明确当前四层服务位置、全量本机恢复包和执行顺序。真实 Linux 新目录恢复 73 文件，4 素材来源指纹与版本 2 草稿保持，旧成片及重新成片摘要一致；49 项相关测试和两个 CDK 栈离线合成通过。尚未执行明早新资源部署，代码 / 记录未提交或推送。

2026-10-07 晚间：复用既有云服务更新[当前版本并复验 CloudFront](docs/cloud-current-version-20261007.md)，保留原有草稿，页面播放、手工编辑、保存恢复、CPU MP4 与 S3 成片校验已通过。AgentCore 启动超时已修复且实际模型响应返回，但候选仍未通过业务校验；生成 / 采用闭环未通过。新增可复用更新打包器；本轮 Git 修改仍未提交 / 推送。

2026-10-07（按用户授权发布当前成果）：固定原球员、框和球场材料，为十人各建独立Qwen上下文，完成001/002测试、Token Plan两路并行及实际重连；两片均无终态失败，候选仍partial。显式去噪和原观察台三层对照已验证，轻量回放随研究目录共享；定位准确性尚未通过验收。见[并行映射实验](../research/agents/qwen-parallel-20261007/README.md)与[去噪说明](docs/ground-trajectory-denoise.md)。

2026-10-07：按本聊天用户要求完成 [EC2 直接代码部署](docs/ec2-code-deployment-plan-20261007.md)的首轮 [CloudFront 网页实测](docs/ec2-cloud-interaction-acceptance-20261007.md)：视频上传与播放、人工草稿保存、AgentCore 候选生成与采用、CPU MP4 导出和 S3 备份均有真实结果。工程入口为 [infra/ec2-workbench](infra/ec2-workbench/README.md)。没有自建容器，SageMaker GPU 未接入；本轮代码与文档尚未提交 / 推送，历史记录保留当时状态。

下次执行当前工作台自动战术流程，先读[Agent执行手册](docs/tactics-agent-execution-runbook.md)：复用已有任务和观察，只补失败步骤，遵守调用预算及停止条件。该流程按用户要求留存；稳定性未通过项仍以真实记录为准。

2026-10-07（自动核心实现已载入，本轮验收未全通过，本地未提交／推送）：原视频V4接通紧凑事实、高清原图独立核对、定点修正、复审及同预算有限传输重试。001一次提交475.190秒完成2/2；独立原图核对19条非平凡路线可作10人的端点示意、7圈均为实际持球者，极短线P2保留；隔离采用、保存、重载和正式MP4已实测。002仍连续断流，恢复实际自动重试一次仍无审核结果，不能宣称全片可靠性已通过。详见[真实结果与未解决项](docs/automatic-tactics-core-20261007.md)和[交接](../handoffs/thy-0629/2026-10-07-2040-automatic-tactics-core.md)。

2026-10-07（本机修改，未提交／推送）：战术初稿改为路线优先、重点圈仅标当前持球人、静止参与者用位置标记；补漏人支持两端点预览整段后一次应用／撤销。生成等待显示实际模型输出状态，保留重试预算与失败原因。V4 抽帧拼图真实生成前半段 8 条路线、2 个位置标记与 1 个持球圈；后半段重试仍失败，完整生成稳定性未通过。前端和人工流程已验证，见[本轮调整与验证](docs/tactics-adjustment-20261007.md)。

2026-10-07（本机修改，未提交／推送）：根据用户截图简化第一部分人工修改：点人物后直接选择目标球员和关联，建议带范围一键采用；自动识别比分牌两队，人工选择赛季，再识别选中人物的球队／号码并匹配姓名。修复换帧沿用旧人物、采用后目标回跳及迟到结果覆盖人工输入。官方 002 的 T60 关联／撤销和 HOU、DAL、30 号识别已在隔离界面实测，见[操作与验证](docs/manual-player-correction-20261007.md)和[实施计划](docs/plans/2026-10-07-manual-player-correction.md)。

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

研究报告、纯实验脚本和原始测量集中在仓库根 `research/`；安装、模型依赖和 AWS 登录状态集中在 `environment/`。本目录不再承接这些独立资料。CDK 应用代码已放在 [infra/](infra/README.md)，当前实现范围见本轮验收。

## 环境与运行

先按[本机环境准备](../environment/local/README.md)安装依赖与取得 LFS 视频，再按[工作台说明](tools/player-review/README.md)启动和操作。模型权重、Python / CUDA 环境及版本说明在[模型环境](../environment/local/model-runtime.md)，AWS CLI / CDK 与身份状态在[AWS 准备](../environment/aws/README.md)。

依赖清单、构建配置和功能测试随工程代码保留；安装步骤在环境目录维护。

目前工作台已支持 OCR 候选证据、身份续接候选、战术 Agent 生成 / 预览 / 采用和人工图形编辑；最新云端人工制作链路通过，战术模型调用已连通，但本轮候选生成 / 采用未通过业务校验。身份与米制精度仍需逐项核对。自动直播分类、完整战术讲解、GPU 接入和生产部署仍未完成；当前导入不会自动运行姿态模型。字段是内部原型约定，不是赛事官方数据格式。
