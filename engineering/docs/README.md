# 作品设计、功能与验收文档

2026-10-09 22:11（America/New_York）：[官方 001 的 Astra 姓名与全流程复跑](official-astra-names-and-reliability-20261009.md)已生成 36.2 秒 1080p 真实配音成片，姓名 / 号码、绘图和投篮反馈均进入 MP4；记录实际失败原因、阶段恢复和只重跑失败节点的修复，以及姓名 pending、身份冲突和定格节奏等剩余质量问题。

2026-10-09（America/New_York）：[Astra 全流程真实试跑](full-commentary-astra-20261009.md)记录真实 OpenRouter 理解、润色、独立绘图与审核、Seed TTS 和投篮评价成片的实际进度，以及试跑暴露的接口修复；区分短样片结果与未完成的 001 长片。

2026-10-09（America/New_York）：用户最终确认以截图中的 `player-review` 为核心工作台，并移除整个 2D 轨迹核对模块。本轮放大视频、展开标注区、精简画面说明并调整制作衔接，见[核心工作台布局与流程调整](core-workbench-layout-20261009.md)。此前[独立样稿接入检查](broadcast-studio-integration-audit-20261009.md)仅作历史参考。

2026-10-10：[NBA UI 分类发布记录](ui-publication-20261010.md)记录用户授权的分支推送、主分支合并、分类提交与验证；前轮 [UI 与 main 同步验收](ui-main-sync-20261010.md)保留源提交、后端能力、归档入口与解说／绘图／成片适配过程。

2026-10-10 00:55（Asia/Shanghai）：[远端解说功能整合](../../handoffs/thy-0629/2026-10-10-0055-commentary-remote-integration.md)完成回归与独立复核，保留润色／逐句人工编辑／配音口吻，并接入当前计划版本、姓名、关键节点、独立绘图和联合成片。下方 00:33 及其他“未提交”记录保留当时状态；本轮功能提交为 [4cae6b7](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/4cae6b71ec1d7e420c5b8725f7c6531a6290d000)，真实服务验收和云部署边界不变。

2026-10-10（本地未提交／未部署）：[解说先行、独立绘图与姓名接入设计](specs/2026-10-09-commentary-led-tactics-design.md)已按[实施计划](plans/2026-10-10-commentary-led-tactics-implementation.md)完成代码与独立复核。先解说后独立绘图，复用姓名（1A），绘图模型默认继承并可覆盖（2A），联合字幕／图形／姓名／音轨及音频缓存已接通；出手/2K 新规则暂缓。110 项 Python、前端及 Agent 全量 762 项 Node 通过，最后 UI 增量后 81 项完整 UI 回归通过；两段真实素材以测试音和测试图形验证渲染。真实模型与真实 TTS 凭据未配置，内容质量尚未验收。见[实施交接](../../handoffs/thy-0629/2026-10-10-0033-commentary-led-tactics-implementation.md)和[当前工作流](commentary-narration-workflow.md)。

2026-10-08姓名功能当前成果按用户要求发布，见[v4方法和实际结果](player-name-optimization-20261007.md)、[完整演示](../../data/videos/demos/player-name-v4-20261008/README.md)及[发布交接](../../handoffs/chuali-zi/2026-10-08-0230-player-name-v4-publication.md)。下文记录保留历史时点；全量前端测试尚未全部通过。

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

2026-10-06 首批实现进度见[Agent 战术工作流实施与验收](agent-tactics-implementation-20261006.md)，配套[运行命令](../agent-workflows/tactics-v1/README.md)及[T00 固定基线](agent-tactics-baseline-20261006.md)。下表“待实施”是原规划时点；当前能力、真实失败与剩余任务以实施报告为准。

| 要找的内容 | 入口 |
| --- | --- |
| 最新工作台实施方案（Final v1） | [Agent 工具与多球员标注执行计划](plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)；工具封装优先、视频主流程、几何按需、人工兜底；新增能力待实施 |
| Agent 执行入口与工具合同 | [工作流程、默认策略与异常处理](agent-tactics-workflow.md)、[工具输入输出、状态及第三方 API 合同](specs/agent-tactics-tools-v1.md)；保留当前战术布局与模块 |
| 工作台操作 | [人工视频制作（006）](manual-tactics-workbench-guide.md)、[2D 高级流程](2d-first-tactics-workbench-guide.md)、[视频库与导入](local-video-library.md) |
| 人工制作实施与验收 | [Task 0 文件/缺口核实](manual-tactics-workbench-task0.md)、[浏览器 MP4 验收与限制](manual-tactics-workbench-acceptance.md) |
| 人物与球场 | [身份审核](track-identity-review.md)、[可见性](player-visibility.md)、[球场标定](court-calibration-backend.md) |
| 战术编辑与成片 | [画布](tactics-canvas.md)、[成片生产](tactics-authored-production-guide.md)、[未来路线](future-route-editor.md) |
| 已认可的 005 成片视觉基准 | [005 V2 流程](005-authored-v2-workflow.md)、[原始资料归档](../archive/tactical-video/005-authored-v2/README.md) |
| 导入视频的待解决问题 | [人物 / 球场 / 战术诊断](../../research/vision/imported-video-diagnostics-20261005.md)，按原记录区分待验证结论与本机产物 |
| Agent 接口 | [Qwen 地面轨迹](qwen-ground-trajectory-agent.md)、[视觉接口](identity-vision-provider.md) |
| 上云与交付计划 | [服务分工与部署顺序](aws-deployment-architecture-20261006.md)、[10 月 6 日预检与 S3 实际上传](aws-cloud-preflight-20261006.md)、[AWS 迁移设计](aws-workbench-deployment-guide.md)、[接续清单](contest-readiness-20261005.md) |
| EC2 直接代码上云与本轮交互验收 | [拆分与上传方案](ec2-code-deployment-plan-20261007.md)、[10 月 7 日真实网页验收](ec2-cloud-interaction-acceptance-20261007.md)：EC2 / AgentCore ZIP / S3 / CloudFront 串联通过，GPU 未接入 |
| 产品规划 | [概念讨论](agent-concept-review.md)、`plans/`、`specs/` |
| 成品仓库 | [CourtStory 定位与 README 记录](product-repository-proposal-20261007.md)，私有仓库已加入简短 README，说明观众定位与本地 / 云端两种部署计划；代码及 Tag / Release 暂缓 |
| UI / UX 当前版本 | [NBA 官网字体／导航实读与现行规范](broadcast-studio-style-20261009.md)、[当前交互验证](broadcast-studio-workbench-20261009.md)；[NBA Broadcast Studio 分支与设计入口](ui-nba-direction-20261009.md)及[四张参考图](images/nba-ui-20261009/README.md)；NBA 真实工作台采用黑白双层顶栏与浅灰白卡，分类提交和 main 合并状态见[发布记录](ui-publication-20261010.md) |
| 已有功能的回归与问题 | [功能复检](function-audit-20261004.md)、[成果与问题](progress-and-open-issues-20261004.md)、[历次更新](workbench-history-20261005.md) |

这里记录产品如何实现和使用。模型选型与独立实验去 [research](../../research/README.md)，安装和账号准备去 [environment](../../environment/README.md)，赛事官方要求去 [requirements](../../requirements/README.md)。
