# 作品设计、功能与验收文档

产品介绍、Single 成果视频和使用入口见[产品 README](../README.md)；本目录保存产品的设计、操作、接口、计划与验收文档。仓库分类和团队决定分别见[仓库导览](../../README.md)与[决策记录](../../docs/decisions.md)。

## 当前阅读入口

| 要了解什么 | 入口 |
| --- | --- |
| 安装与启动工作台 | [本地安装](local-setup.md)、[工作台工具](../tools/player-review/README.md) |
| 部署工程与既有运行记录 | [云端工程](cloud-setup.md)、[运维记录](aws-live-deployment.md)、[部署脚本](../infra/ec2-workbench/README.md) |
| 产品结构、制作流程与最终样例 | [产品 README](../README.md) |
| 当前团队进展与本轮修改 | [团队状态](../../docs/status.md)、[交接记录](../../handoffs/README.md) |

## 历史设计与验收索引

以下按原记录的日期保留当时结论，其中“当前”“最新”“待实施”“未提交”和部署状态均指该阶段；不能据此判断今天的运行状态。已移除的旧样例与流程入口链接到对应的 Git 历史版本，当前目录从上方入口查找。

2026-10-10：[第一部分视频身份初稿与人工审核](video-identity-review-20261010.md)复用第三部分视频工具，接通检测准备、暂定身份、名单候选、人工修改和保存；本轮补齐首次比赛上下文、已保存姓名面板和共享配置，保留远端单屏／Astra／Polly 更新。805 项前端测试及独立 API／下游验收通过；Agent 只做待人工审核的初稿，完整同步记录见[发布交接](../../handoffs/thy-0629/2026-10-10-1147-identity-remote-sync.md)。

2026-10-10 本轮：[TEAM 25 分类发布与旧 UI 分支清理](ui-team25-publication-20261010.md)记录最新 main 整合、定稿保存、验证与推送核对；下方“仅本地”描述保留各轮历史状态。

2026-10-09 22:11（America/New_York）：[官方 001 的 Astra 姓名与全流程复跑](official-astra-names-and-reliability-20261009.md)已生成 36.2 秒 1080p 真实配音成片，姓名 / 号码、绘图和投篮反馈均进入 MP4；记录实际失败原因、阶段恢复和只重跑失败节点的修复，以及姓名 pending、身份冲突和定格节奏等剩余质量问题。

2026-10-10 决赛答辩入口：[技术路线与答辩母稿](finals-defense-technical-route-20261010.md)包含流程/部署图、Agent 分工、数据边界、验收证据、7 页 5 分钟安排和评委问答；发布整理已纳入 005/001 历史成片及质量缺口、TEAM25、单屏 UI、GPU 实测与 Polly 代码替换。官方条款、评分与时间见[当日核验表](../../requirements/finals-defense-requirements-20261010.md)；最终 PPT、赛事提交和新版云端全流程仍待执行。

同日用户补充的[八项推进工作与更新位置](finals-defense-technical-route-20261010.md#13-推进中的工作与更新位置)记录后端流程 Tab/按钮、UI 适配、人工全流程测试、成品仓库转移、README 架构与亮点、云端部署测试、火箭队数据强化和 TEAM25 标识。按证据区分已实现、部分验收与待补项，附填写模板和答辩页映射。

2026-10-09（America/New_York）：[Astra 全流程真实试跑](full-commentary-astra-20261009.md)记录真实 OpenRouter 理解、润色、独立绘图与审核、Seed TTS 和投篮评价成片的实际进度，以及试跑暴露的接口修复；区分短样片结果与未完成的 001 长片。

2026-10-09（America/New_York）：用户最终确认以截图中的 `player-review` 为核心工作台，并移除整个 2D 轨迹核对模块。本轮放大视频、展开标注区、精简画面说明并调整制作衔接，见[核心工作台布局与流程调整](core-workbench-layout-20261009.md)。此前[独立样稿接入检查](broadcast-studio-integration-audit-20261009.md)仅作历史参考。

2026-10-10 11:03：用户已确认[任务栏灰色图案及位置定稿](broadcast-studio-style-20261009.md#灰色图案定稿)，后续普通 UI 调整不改动这一基准；[定稿交接](../../handoffs/Linzeyu912/2026-10-10-1103-freeze-header-pattern.md)。

2026-10-10 11:01（UI 分支本地）：[TEAM 25 附近灰线角度](../../handoffs/Linzeyu912/2026-10-10-1101-angled-header-line.md)已改为向右下方倾斜 7°，保留上一轮字号与留白；[最新截图](images/nba-ui-20261009/workbench-team25-angle-20261010.png)。

2026-10-10（UI 分支本地）：[最新顶栏层级](broadcast-studio-style-20261009.md#字体形状与质感)采用主品牌／队伍／LIVE DESK 为 32／30／24px，第一行保持 56px；TEAM 白色、25 深蓝无底块，灰色球场线连续延伸。[本轮交接](../../handoffs/Linzeyu912/2026-10-10-1056-header-hierarchy.md)记录留白、手机与回放页验证。此次尚未提交、推送或合入 main。

2026-10-10：[NBA UI 分类发布记录](ui-publication-20261010.md)记录用户授权的分支推送、主分支合并、分类提交与验证；前轮 [UI 与 main 同步验收](ui-main-sync-20261010.md)保留源提交、后端能力、归档入口与解说／绘图／成片适配过程。

2026-10-10 00:55（Asia/Shanghai）：[远端解说功能整合](../../handoffs/thy-0629/2026-10-10-0055-commentary-remote-integration.md)完成回归与独立复核，保留润色／逐句人工编辑／配音口吻，并接入当前计划版本、姓名、关键节点、独立绘图和联合成片。下方 00:33 及其他“未提交”记录保留当时状态；本轮功能提交为 [4cae6b7](https://github.com/Linzeyu912/courtstory/commit/4cae6b71ec1d7e420c5b8725f7c6531a6290d000)，真实服务验收和云部署边界不变。

2026-10-10（本地未提交／未部署）：[解说先行、独立绘图与姓名接入设计](specs/2026-10-09-commentary-led-tactics-design.md)已按[实施计划](plans/2026-10-10-commentary-led-tactics-implementation.md)完成代码与独立复核。先解说后独立绘图，复用姓名（1A），绘图模型默认继承并可覆盖（2A），联合字幕／图形／姓名／音轨及音频缓存已接通；出手/2K 新规则暂缓。110 项 Python、前端及 Agent 全量 762 项 Node 通过，最后 UI 增量后 81 项完整 UI 回归通过；两段真实素材以测试音和测试图形验证渲染。真实模型与真实 TTS 凭据未配置，内容质量尚未验收。见[实施交接](../../handoffs/thy-0629/2026-10-10-0033-commentary-led-tactics-implementation.md)和[当前工作流](commentary-narration-workflow.md)。

2026-10-08姓名功能当前成果按用户要求发布，见[v4方法和实际结果](player-name-optimization-20261007.md)、[完整演示（历史版本）](https://github.com/Linzeyu912/courtstory/blob/56e6466057c0560701d3163d2dbd1384e59249d2/data/videos/demos/player-name-v4-20261008/README.md)及[发布交接](../../handoffs/chuali-zi/2026-10-08-0230-player-name-v4-publication.md)。下文记录保留历史时点；全量前端测试尚未全部通过。

2026-10-09：总工作台第三部分的[解说与配音工作流](commentary-narration-workflow.md)新增整段文本润色、候选对照/采用/撤回、自然有趣配音口吻及[逐句人工编辑与UI迁移接口](commentary-cue-editing-api.md)；[三段实测与试听](../../research/agents/commentary-personality-20261009/README.md)。当前接入本机工作台，未更新运行中的云服务。

2026-10-07 配音成片增量：[火山 TTS 与字幕成片工作流](commentary-narration-workflow.md)，复用 Astra 两段结果，10句真实语音合成成功，原视频烧录字幕并混入配音；两片本机成片和播放已验证，未部署到团队工作台。

2026-10-07 本地解说增量：[独立 Pi 视频理解与解说 Agent](video-commentary-agent.md)，多页概览、按需回看/裁图、可选检测候选、带时间文字输出；真实样片与错误分析见[试跑记录](../../research/agents/video-commentary-20261007/README.md)。

2026-10-07 本地姓名识别第一版：[全员多帧号码／名单识别、身份冲突、脚底标签及按需显示](player-name-identification-20261007.md)。Qwen Token Plan 真实试验与3秒成片已跑；全员姓名精度未验收，代码未提交／推送，远端同期更新待安全合入。

2026-10-07–08 后续：[全员姓名 v4 优化与复测](player-name-optimization-20261007.md)。修复目标裁图、历史颜色复核状态、有限错接、姓名与位置状态分离；十名源图身份参考已建立，覆盖及整片结果按该文最终复测记录为准。

2026-10-07 晚间：[10 月 8 日云账号重置后重新部署计划](plans/2026-10-08-cloud-reset-redeployment.md)，包含服务 / 路径分工、重置前快照、重置后只读发现 / CDK 顺序、验收与失败处理，已有完整恢复包与 Linux 真实恢复 / 重制 MP4 证据。

2026-10-07 晚间：[当前版本云端更新与 CloudFront 复验](cloud-current-version-20261007.md)，记录服务边界、包校验、草稿保护、页面 / 成片结果及 AgentCore 实际失败与修复。

2026-10-07 解说职责讨论：[独立 Pi 视频理解与解说 Agent](video-commentary-agent-discussion-20261007.md)，复用已有多页拼帧与工具图片循环，输出事件、解说时机与绘图意图。方案待讨论，未修改现有绘图实现；来源与复用核查见[研究记录](../../research/agents/video-commentary-reuse-20261007.md)。

2026-10-07 球员标定改进进行中：[YOLO 角色校验、主动身份初检与少量人工修正计划](plans/2026-10-07-player-identification-and-proactive-agent.md)。本轮聚焦第一部分球员标定，真实验收结果另行记录，不将计划当作完成。

2026-10-07 工作台可用性修复见[整段初稿、重点圈、可选映射与人工接管](workbench-usability-20261007.md)，配套[本轮计划](plans/2026-10-07-workbench-usability-and-manual-fallback.md)。本轮处理实际页面，不替代下方新版 runner 的整体验收结论。

2026-10-06 独立验收：111 项新增回归重跑通过，但追加场景发现 1 项 P1、2 项 P2，真实 005 指人问题仍在，M0／M1 不予整体签收。见[验收结论与复验条件](agent-tactics-acceptance-20261006.md)。

2026-10-06 首批实现进度见[Agent 战术工作流实施与验收](agent-tactics-implementation-20261006.md)，配套[运行命令（历史版本）](https://github.com/Linzeyu912/courtstory/blob/56e6466057c0560701d3163d2dbd1384e59249d2/engineering/agent-workflows/tactics-v1/README.md)及[T00 固定基线](agent-tactics-baseline-20261006.md)。下表“待实施”是原规划时点；当前能力、真实失败与剩余任务以实施报告为准。

| 要找的内容 | 入口 |
| --- | --- |
| 最新工作台实施方案（Final v1） | [Agent 工具与多球员标注执行计划](plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)；工具封装优先、视频主流程、几何按需、人工兜底；新增能力待实施 |
| Agent 执行入口与工具合同 | [工作流程、默认策略与异常处理](agent-tactics-workflow.md)、[工具输入输出、状态及第三方 API 合同](specs/agent-tactics-tools-v1.md)；保留当前战术布局与模块 |
| 工作台操作 | [人工视频制作（006）](manual-tactics-workbench-guide.md)、[2D 高级流程](2d-first-tactics-workbench-guide.md)、[视频库与导入](local-video-library.md) |
| 人工制作实施与验收 | [Task 0 文件/缺口核实](manual-tactics-workbench-task0.md)、[浏览器 MP4 验收与限制](manual-tactics-workbench-acceptance.md) |
| 人物与球场 | [视频身份初稿与人工审核](video-identity-review-20261010.md)、[身份审核](track-identity-review.md)、[可见性](player-visibility.md)、[球场标定](court-calibration-backend.md) |
| 战术编辑与成片 | [画布](tactics-canvas.md)、[成片生产](tactics-authored-production-guide.md)、[未来路线](future-route-editor.md) |
| 已认可的 005 成片视觉基准 | [005 V2 流程](005-authored-v2-workflow.md)、[原始资料归档（历史版本）](https://github.com/Linzeyu912/courtstory/blob/56e6466057c0560701d3163d2dbd1384e59249d2/engineering/archive/tactical-video/005-authored-v2/README.md) |
| 导入视频的待解决问题 | [人物 / 球场 / 战术诊断](../../research/vision/imported-video-diagnostics-20261005.md)，按原记录区分待验证结论与本机产物 |
| Agent 接口 | [Qwen 地面轨迹](qwen-ground-trajectory-agent.md)、[视觉接口](identity-vision-provider.md) |
| 上云与交付计划 | [服务分工与部署顺序](aws-deployment-architecture-20261006.md)、[10 月 6 日预检与 S3 实际上传](aws-cloud-preflight-20261006.md)、[AWS 迁移设计](aws-workbench-deployment-guide.md)、[接续清单](contest-readiness-20261005.md) |
| EC2 直接代码上云与本轮交互验收 | [拆分与上传方案](ec2-code-deployment-plan-20261007.md)、[10 月 7 日真实网页验收](ec2-cloud-interaction-acceptance-20261007.md)：EC2 / AgentCore ZIP / S3 / CloudFront 串联通过，GPU 未接入 |
| 产品规划 | [概念讨论](agent-concept-review.md)、`plans/`、`specs/` |
| 成品仓库 | [CourtStory 定位与 README 记录](product-repository-proposal-20261007.md)，私有仓库已加入简短 README，说明观众定位与本地 / 云端两种部署计划；代码及 Tag / Release 暂缓 |
| UI / UX 当前版本 | [NBA 官网字体／导航实读与现行规范](broadcast-studio-style-20261009.md)、[当前交互验证](broadcast-studio-workbench-20261009.md)；[NBA Broadcast Studio 分支与设计入口](ui-nba-direction-20261009.md)及[四张参考图](images/nba-ui-20261009/README.md)；NBA 真实工作台采用黑白双层顶栏与浅灰白卡，分类提交和 main 合并状态见[发布记录](ui-publication-20261010.md) |
| 已有功能的回归与问题 | [功能复检](function-audit-20261004.md)、[成果与问题](progress-and-open-issues-20261004.md)、[历次更新](workbench-history-20261005.md) |

这里记录产品如何实现和使用。模型选型与独立实验去 [research](../../research/README.md)，安装和账号准备去 [environment](../../environment/README.md)，赛事官方要求去 [requirements](../../requirements/README.md)。
