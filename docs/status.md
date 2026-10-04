# 团队状态

2026-10-04：用户文件夹中的 18 段视频已按原名与原字节登记到 [独立上传批次](../data/videos/uploads/2026-10-04/README.md)，按用户要求保留赛季 / 比赛日期待核实；画面为火箭与独行侠 13 段、马刺与尼克斯 5 段，官方比赛匹配仅作候选。共享 catalog 现共 8 批 / 175 个文件，[素材总览](../data/videos/README.md)说明 100、30+9、THY 15、本次 18 和验收 3 的分组。18 段完整解码与复制哈希通过，全库 175 文件哈希通过；同步与远端下载状态见[本次交接](../handoffs/Linzeyu912/2026-10-04-0918-user-video-upload.md)。

2026-10-03 21:38：未来路线、阶段暂停 / 继续及人工战术画布已接入最新远端并推送 main，功能提交 [3a00c20](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/3a00c20e8412f969c891d209b515e426d15300aa) 已核对本地、origin/main 与远端一致。保留远端标定流程、篮球路线、2D 平滑及画外点，同时支持手绘路线、挡拆旋转 / 删除、脚底圈、撤销与保存；修复旧示例草稿因新增篮球字段无法保存的问题。前端 / 引擎 368 通过、1 既有权限跳过，后端 11 通过，157 个视频哈希及 LFS 指针检查通过；真实页面与独立审核通过，用户草稿保留。见[本轮同步交接](../handoffs/thy-0629/2026-10-03-2138-tactics-remote-integration.md)。下方“未推送”段落保留历史状态，由本条更新。

2026-10-03 20:58：按用户要求先后同步多级 Tab / 球员与球场标定流程（`ed874d1`），再同步球员 2D 显示平滑、篮球候选路线、画外球场参照点及人工篮球点优先修正（`cb8eac1`、`fc3c673`）。最新功能提交后 `git fetch origin` 核对本地与 `origin/main` 均为 `fc3c673b5f74d5770c2142df33016f4b39fe50cc`。6 个受影响 JavaScript 模块 `node --check` 通过，`git diff --check` 通过；本轮没有做浏览器实操或精度验收，篮球路线仍待人工核对，画外点属于估计。见[本轮交接](../handoffs/Linzeyu912/2026-10-03-2058-ball-court-trajectory.md)。

2026-10-03 16:56 本地流程调整（未提交推送）：球场标定紧接球员标定，支持两项交替核对；第 4 步改为 2D 轨迹核对，自动展开预览，并直接接入数据工作区和战术页。前置数据导出移为末端可选文件备份。316 项前端通过 / 1 权限跳过，内置浏览器验证映射与页面接续；本机正式草稿和服务保留。见[本轮交接](../handoffs/Linzeyu912/2026-10-03-1656-court-player-workflow.md)。

2026-10-03 未来路线展示与人工修正（本地提交，未推送）：THY 本机已接入平滑未来路线、关键阶段暂停 / 继续 / 重播，以及控制点拖动、插删、撤销和保存。视频上去掉新增的球员文字标签，仅显示路线、箭头、落点及编辑控制点。真实 005 视频编辑与播放验收、后端保存烟测和独立最终审查通过；完整相关 Node 348 通过 / 1 既有权限跳过，Python 战术集成 6 通过，末轮并发修复另有 14 项定向通过。最终功能修复为 `27c6545`，尚未发布至远端；真实轨迹与标定精度仍需人工核对，旧冻结 HTML 报告不含新展示修正，JSON 保留。见[本轮验收交接](../handoffs/thy-0629/2026-10-03-1828-future-route-acceptance.md)。

2026-10-03 16:30 整理同步：以下本地视频库、战术整合、模型选择、候选显示和布局更新已按用户授权分类提交并推送 `main`，远程功能提交核对为 `74967ed`。文档与历史交接另作一类同步。594 个数据 / 缓存文件的发布前后 SHA-256 一致；本机视频、人工核验草稿及 8890 正式服务保留。前端 314 通过 / 1 权限跳过，后端 199 通过，构建一致。见[完整分类与发布交接](../handoffs/Linzeyu912/2026-10-03-1630-workbench-updates-publication.md)。下方“未提交推送”描述保留各轮当时事实，已由本条更新；人工精度验收仍在继续。

2026-10-03 15:45 本地工作台改进（未提交推送）：检测器与跟踪器拆分为两个选项，默认保留篮球 YOLOv8n + BoT-SORT 外观续接，以小号「推荐」标记展示；四组合独立运行，历史结果保留。图例、诊断和说明移至左侧，中间视频扩大，右侧操作保留。314 项前端通过 / 1 权限跳过，199 项后端通过；两种新增组合均完成真实 143 帧处理。界面验收仅使用 Codex 内置浏览器。见[说明](../engineering/docs/model-selection-layout.md)和[交接](../handoffs/Linzeyu912/2026-10-03-1545-model-selection-layout.md)。

2026-10-03 工作台整合（本地实现与功能验证完成，待用户审核，未提交推送）：统一共享 / 本地视频库，接入 THY 分阶段冻结叠加和动作人工审核，补充 IndexedDB 即时草稿、本机文件保存及报告导出，保留已有模型选择与橙紫候选移除。前端 312 通过 / 1 权限跳过，后端 194 通过；实际新增视频处理 494 帧并完成保存恢复。当前实现及边界见[整合说明](../engineering/docs/workbench-integration.md)和[本轮交接](../handoffs/Linzeyu912/2026-10-03-1507-workbench-tactics-integration.md)。

更新日期：2026-10-03（Asia/Shanghai）

2026-10-03 11:03：独立多人战术轨迹首版的 23 个选定文件已推送 main，[功能提交 21d24df](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/21d24dffb06284858669af9b66e14bab8a820dc2)于 11:03:12 核对本地 HEAD、origin/main 与远端一致。接收自 1839dcd 起的 17 个远端提交，以 c0d2dcf 为整合基线；仅状态文档两处文字冲突，双方历史均保留。整合测试、复现与独立兼容复核通过，7 个无关未跟踪文件原样保留。预览、图像、QA 与备份仍仅在本机，真实身份 / 地面与战术精度及播放器接入待验收。见[同步交接](../handoffs/thy-0629/2026-10-03-1103-tactical-overlay-sync.md)；下方“未提交推送”保留各轮当时事实，本条及交接文档的后续提交以 Git 日志为准。

2026-10-03 10:05：人物关联冲突纠正和统一蓝绿审核状态已分类提交并推送工作分支；核对本地 / 远端一致后，与最新 main 合并并正常推送。功能合并 `7ee65bd` 已在 main 与原工作分支同步，保留双方历史、研究归档和用户验收的整合工作台。241 项前端、216 项后端、构建一致性及 142 条视频元数据 / LFS 指针检查通过；完整视频字节校验仍受本机部分 LFS 视频未下载限制。见[分类发布与合并交接](../handoffs/Linzeyu912/2026-10-03-1005-workbench-main-publication.md)。本条更新下方各轮的“未合入 main”状态，历史记录保留当时事实。

2026-10-03 09:03 续接“新建分支并推送本地内容”的额度中断任务：确认检测候选、逐帧虚实线、人工兜底及帧定位三个功能提交已在远端独立分支；待收尾的是五份说明与原交接的文档提交。完整复验 229 项前端、216 项 Python、构建字节一致、页面确认 / 邻帧 / 撤销通过，未发现本次范围内的功能缺口。本次补齐文档收尾，继续仅同步 `codex/local-workbench-20261002`；[续接交接](../handoffs/Linzeyu912/2026-10-03-0903-detection-review-completion.md)记录验证及旧数据边界。

2026-10-03 00:15 检测来源可视化、逐帧虚实线审核和精确帧定位已按三类提交推送到 `codex/local-workbench-20261002`，远端核对为 495a26c；main 仍为 1839dcd。229 项前端、216 项 Python、GPU 8 帧新证据烟测与 27 个旧版本兼容对照通过。机器候选及未审核帧用虚线，人工只确认点击帧；无 T 兜底不再中断后续跟踪。文档随独立提交补齐，见[本轮交接](../handoffs/Linzeyu912/2026-10-03-0010-detection-frame-review.md)。

2026-10-02 23:30 本轮整合已按五类功能提交推送到 `codex/local-workbench-20261002`，远端核对为 537a88d；main 仍为 1839dcd，未合入或推送 main。200 项前端、207 项 Python 与 142 条视频元数据 / LFS 指针检查通过。文档与双方来源记录单独提交，见[分支更新说明](../engineering/docs/workbench-branch-update-20261002.md)与[本轮交接](../handoffs/Linzeyu912/2026-10-02-2330-branch-integration-publish.md)。下方各轮“未提交”保留当时状态，本轮同步结果以本条为准。

2026-10-02 23:14 用户进一步要求可靠判断前不标攻守：本地整合版移除默认“红队进攻 / 蓝队防守”，仅保留红蓝分队；草稿迁移、编辑响应和导出省略 `teamRoles`。前端 200 项、人物编辑后端 36 项与页面检查通过，仍未提交推送。见[本轮交接](../handoffs/Linzeyu912/2026-10-02-2314-color-only-teams.md)。下方前次固定攻守安排保留当时记录，已由本条替代。

2026-10-02 23:08 本地整合新增临时 T 编号全部观测归并、多个 T 累计认领和检测 / 跟踪来源提示。时间轴区分位置覆盖与逐帧审核，保留用户版脚点及球场映射；修复新增切镜边界与逐帧时间戳量化问题。前端 200 项、相关后端 48 项及浏览器 QA 通过；仍在独立整合目录，未提交推送。见[工程说明](../engineering/docs/track-identity-review.md)与[本轮交接](../handoffs/Linzeyu912/2026-10-02-2308-track-identity-review.md)。

2026-10-02 22:29 按用户选择开展本地整合：以用户版 `fffb6ea` 保留左侧导航、分步骤操作、底部 2D 抽屉及球场 / 视频恢复，采用固定上红进攻、下蓝防守，接入 THY `1839dcd` 的模型方案和身份 / 2K 查询。THY 完整方案作为默认推荐，原 YOLO 保留可选。整合位于独立 detached 工作目录，未提交推送；后端 151 项测试及 8890 实际查询 / 编辑 / 球场接口核验通过，27 个样例 / 模型组合、GPU 补跑 2,712 帧与浏览器交互验收已完成，前端 171 项全部通过。见[本轮取舍](../engineering/docs/plans/2026-10-02-selected-integration.md)与[交接](../handoffs/Linzeyu912/2026-10-02-2229-selected-integration.md)。

本次同步：按用户要求，2026-10-02 21:44 已将晚间本地工作台改动作为 `b557622` 推送到 [`codex/local-workbench-20261002`](https://github.com/Linzeyu912/broadcastcode-team-hub/tree/codex/local-workbench-20261002)。下文各轮“本地未提交”描述保留当时状态，本次同步结果见[分支交接](../handoffs/Linzeyu912/2026-10-02-2144-local-workbench-branch-push.md)。该分支基于本机 `72c74e0`，未合入远端 main 后续两次提交；此次分支操作是用户明确指定的任务例外。


## 当前阶段

NBA解释与纠错层研究按用户指令收尾归档，见[研究包](../engineering/research/nba-evidence-study-20261002/README.md)与[交接](../handoffs/chuali-zi/2026-10-02-2135-nba-evidence-study-closeout.md)。完成真实输入审计、来源适配Schema、离线故障/投影/球候选实验与事实门控比较。11个合成错误世界事实中，能力和依赖门控仍放行5个，且损失部分正确候选；实验不能宣称生产准确率。7项独立人类复核、米制真值与真实处理延迟未建立。本次选择性发布研究文件，生产提取及总结生成模块保持原状。

赛事资料与本机数据提取原型开发并行。赛事要求集中在 `requirements/`，代码、设计和技术实验集中在 `engineering/`；完整 Agent 流程、真实身份 / 位置精度验收和 AWS 部署尚未完成。

2026-10-02 晚间，工作台本地增加取消人物误关联、清空槽位和红蓝两队拖动交换；原图 / 2D 同步留空或换人，草稿与撤销保留。73项JavaScript、76项Python与独立浏览器QA通过，8876本机服务已重启，正式草稿未代操作；用户要求只保存在本地，未提交推送。见[交接](../handoffs/Linzeyu912/2026-10-02-2046-roster-cancel-swap.md)。

2026-10-02 晚间，本地后端新增篮筐方向约束的球场自动初始化接口及命令行入口；005实际初始化后生成139/143帧待复核映射，后端60项回归和9项HTTP检查通过。代码尚未提交推送，该轮交接时正式服务尚未重启，米制精度未验收；见[后端说明](../engineering/docs/court-calibration-backend.md)与[交接](../handoffs/Linzeyu912/2026-10-02-2010-hoop-court-backend.md)。

2026-10-03 本机完成第一版独立多人战术轨迹引擎与冻结帧静态报告：当前完整动作实线、后续真实观测虚线、完成动作淡化，保留全参与者、分阶段和有朝向证据的掩护标记。真实 005 SAS–MIA 为 3 阶段 / 6 人待复核候选，与合成规则演示分开；全套曾完成 57 项（56 通过 / 1 Windows 权限跳过），最后路线避让修正重跑受影响消费器 27 项（26 通过 / 同一项跳过），均 0 失败。8 个实际浏览器场景及最终独立复核通过，标签不再遮住路线、箭头或掩护横杠；窄侧栏可横向查看完整画布。原工作台与正式草稿未改，真实身份/地面精度及播放器接入未验收；本轮未提交推送。见[工具与接口](../engineering/tools/tactical-overlay/README.md)、[本轮交接和恢复步骤](../handoffs/thy-0629/2026-10-03-0055-tactical-overlay-engine.md)。

2026-10-02 20:27 发布记录：当前工作台源码与预计算候选已按授权推送 `main`，GitHub API、ls-remote 与 fetch 实测为 [351292f](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/351292fba6c5e7accafea9f8780a81b93810caba)。四样例 / 17 版所需本机结果复制为 22 份共享 JSON / metadata，库中 11 条路径改指向副本，完整 clip payload 与运行中原路径 API 一致；默认简版、人工资料确认和 13 项能力逻辑保持。本次新运行 144 JS、102 Python及 38 项离线篮球测试通过，视频校验 5 批 / 142 条及 142 文件 / LFS 指针通过。本次最新说明与[发布交接](../handoffs/thy-0629/2026-10-02-2027-workbench-identity-publish.md)随本次文档提交同步，具体提交以 Git 日志为准；下方按轮次保留旧同步状态。模型权重、GPU 环境、原缓存、QA 草稿 / 测试成片不在发布范围，没有新增断轨续接或 OCR。

2026-10-02 16:57，本机 `main` 已同步至远端 `72c74e0`，合并新增模型选择、球 / 筐编辑、脚部候选和场地工具，同时保留本机分队、稳定框与固定身份。105项JS / 78项Python、独立数据 / API / 六场景剪辑及浏览器QA通过；兼容整合与本机实验仍未提交推送。后续就在此工作台继续修改，见[本轮同步交接](../handoffs/thy-0629/2026-10-02-1657-workbench-remote-sync.md)。

2026-10-02 下午，双模型工作台已随 `aa2ba4f` 推送。随后按用户要求实际下载并比较 RTMPose-s、48点球场模型与 KaliCalib，新增球 / 筐选择、脚部候选、标定向导和逐帧镜头跟随；原图脚点到2D轨迹已在浏览器验证。米制精度、真实接地和通用自动标定仍未验收；ByteTrack 后续继续由用户安排的另一合作者处理。具体产出、验证与同步状态见[本轮交接](../handoffs/Linzeyu912/2026-10-02-1604-scene-ground-workbench.md)。

2026-10-02 已按用户授权把此前全部改动分成六类提交到 main 并推送，远端提交一致，三个新验收成片独立下载与哈希核验通过；分类提交和验证结果见[本次整理交接](../handoffs/Linzeyu912/2026-10-02-1109-organize-publish.md)。归档共享不代表实验已经达到产品验收标准。

**协作方式：所有内容直接在 `main` 修改、提交和推送，不新建任务分支，不使用 PR 合并。** 见[协作流程](workflow.md)与[决策 D004](decisions.md#d004所有内容直接在-main-上改进)。

2026-10-02 17:45，按用户要求把工作台默认入口收敛为球员单标注，自动编号1–10，队色不确定仍保留灰色编号，原工具收进高级入口。排查发现004分队筛选曾把十个建议缩成五个，并隐藏未关联的检测；现恢复同源模型建议与可见灰框。四段恢复636条实际编号观测，原检测、帧 / PTS、草稿与高级功能保留；重复框、遮挡和串人仍需后续处理，本机改动未提交推送。见[本轮单标注交接](../handoffs/thy-0629/2026-10-02-1745-player-annotation-simple.md)。

2026-10-02 19:30，本机工作台新增人工球员资料确认与初步 2K 匹配：按赛季、实际球队和文字号码查询，选姓名后明确确认，支持清除 / 撤销 / 刷新；13 项原能力与逐字段来源保留。LAL–MIN 首帧在 QA 中将编号 4 明确确认为 Mike Conley（2024-25 / NBA 2K25，总评79、三分83、控球89），轨道仍需核对。17 新 / 144 全 JS、22 新 / 102 全 Python及独立产品审查通过；实际浏览器正常流程与保护 / HTTP验收通过，迟返和网络错误由实际 app 可控 harness 验证。main 与远端仍为 `72c74e041fd673de81488ebdf48cb97d39427bda`，此轮未提交推送；未做OCR、自动断轨续接或云部署。见[19:30交接](../handoffs/thy-0629/2026-10-02-1930-player-identity-2k.md)。

## 已有成果

| 成果 | 文件 / 入口 | 状态 |
|---|---|---|
| 多人分阶段战术轨迹 | [接口 / 复现说明](../engineering/tools/tactical-overlay/README.md)、[批准规格](../engineering/docs/specs/2026-10-02-tactical-trajectory-overlay-design.md)、[实现交接](../handoffs/thy-0629/2026-10-03-0055-tactical-overlay-engine.md)、[同步交接](../handoffs/thy-0629/2026-10-03-1103-tactical-overlay-sync.md) | 首版功能已推送 main（21d24df）：来源绑定 manifest、SVG、三阶段真实候选、多人实虚线与掩护关系；标签避让路线、窄画布滚动及 8 场景实际验证通过，最终独立复核通过。真实精度与前端接入待完成；预览、图像与 QA 仍仅在本地 |
| 人工身份资料与初步 2K 匹配 | [实测记录](../engineering/research/player-identity-2k-20261002.md)、[使用说明](../engineering/tools/player-review/README.md#2026-10-02人工身份资料与-2k-能力) | 本地折叠面板、精确名单候选、明确确认和13项能力卡；整季名单不证明当场阵容，null不补值、轨道不升级。144 JS / 102 Python全量通过，真实QA与独立产品审查通过；850项原文件 / 67备份 / 17版clip字节保持。正式草稿及真实下载未操作，代码 / 文档未提交推送 |
| 默认球员单标注与漏框修复 | [原因与同片结果](../engineering/research/player-annotation-simple-20261002.md)、[操作说明](../engineering/tools/player-review/README.md)、[交接](../handoffs/thy-0629/2026-10-02-1745-player-annotation-simple.md) | 简版视频、固定数字与可撤销纠正，自动补空编号，未知队色不删身份；004第178帧原被隐藏的三个球员框重新可见。最终127JS / 80Python、独立代码 / 数据 / API与真实浏览器验证通过，原检测重复与同队串人未解决；未提交推送 |
| 最新工作台同步与兼容整合 | [同步交接](../handoffs/thy-0629/2026-10-02-1657-workbench-remote-sync.md)、[当前工作台](../engineering/tools/player-review/README.md) | 本机main与origin/main同为72c74e0；四个新增提交已同步，本机两队 / 稳定展示 / 精确人工标注与新对象 / 脚部 / 球场工具共同保留；105JS、78Python及独立验收通过，原始视频 / 数据保留，本机整合未提交推送 |
| 两队颜色、稳定框与脚下编号 | [实现 / 同片指标](../engineering/research/player-team-overlay-20261002.md)、[操作说明](../engineering/tools/player-review/README.md) | 本地四段team-stable、两组五人槽位及蓝 / 橙框色，独立人工分队、稳定展示与脚下编号；149项回归、最终17项输入相关回归、独立代码 / 媒体 / 数据验证及真实QA通过。LAL仅4+4个未确认分队建议，脚环为图像近似，身份串号未解决；原数据 / 草稿保留，未提交推送 |
| 篮球模型与固定十人工作台 | [实施 / 同片对照](../engineering/research/player-tracking-workbench-20261002.md)、[操作说明](../engineering/tools/player-review/README.md) | 本地四段接入篮球专用模型和原生外观追踪，固定显示球员 1–10；建议与人工记录分开，保留原版本 / 草稿。127 项回归、真实 HTTP / QA 界面及成片 PTS / 原 AAC 独立验证通过。重复 / 完整框有具体改善，T21 / T12 跨队错误排除建议、自动片段连接为 0，仍需人工确认；本轮未提交推送 / 云部署 |
| E-BARD 篮球专用模型单片段测试 | [005 实测报告](../engineering/research/player-test-20261002.md) | 2026-10-02 本机 RTX 5060 已完整处理 267 帧并导出 H.264 标注视频；候选 6–11 个、存在漏检 / 重复框 / 跨队串 ID，不能直接绑定姓名。独立解码、帧记录及音画起点检查通过；这次报告和产物仍在本地，未推送或云部署 |
| 9 月 28 日培训内容、评分和交付要求 | [赛事资料整理](../requirements/BroadcastCode赛事资料整理.md) | 已整理，转写疑点有单独标注 |
| 腾讯体育「深度赛场」官方参考片段 | 同上第 8 节 | G1–G4 链接已核验；日期为 2026 年 6 月 |
| 官网与报名渠道核验、扩展调研、Word 手册 | [调研索引](../engineering/research/README.md) | 已归档；主要采集于 9 月 17 日 |
| 共享文档结构、Agent 指引与交接模板 | [协作流程](workflow.md)、[交接目录](../handoffs/README.md) | 已准备 |
| GitHub 私有仓库与首次同步 | [broadcastcode-team-hub](https://github.com/Linzeyu912/broadcastcode-team-hub) | 已创建并推送，已核对私有状态及本地与远端提交一致 |
| TypeSafe Jev 珠海与澳门可用性调研 | [调研结论与验证步骤](../engineering/research/jev-regional-availability.md) | 已发邮件向厂商确认，等待答复；未实测，尚未决定采用 |
| 解说 Agent 方案总结与直播纪要核对 | [方案讨论稿](../engineering/docs/agent-concept-review.md) | 已同步至 main（8bb3611）；按数据采集、数据处理、内容呈现整理；重点为战术意图、行为动因与声画同步；球员引力待验证，另两项核心指标后续再议 |
| E-BARD 检测模型接入与评估 | [源码核查与本机对照](../engineering/research/vision-player-refinement/ebard-assessment.md)、[工作台说明](../engineering/tools/player-review/README.md)、[管线测量](../engineering/research/vision-player-refinement/ebard-tracking-probe.json) | 2026-10-02 三个样例已接入通用 YOLOv8s / E-BARD YOLOv8n 可选，默认推荐后者；独立草稿、篮球 / 篮筐显示与导出、多版本裁切已实现。815 帧解码检测跟踪共 15.83 秒，不含渲染或人工修正，身份与地面位置精度未验收。用户要求先提交此状态；ByteTrack 后续交另一合作者，脚点 / 2D 映射调研单独整理 |
| 原视频战术叠加与位置提取调研 | [关系与球场映射评估](../engineering/research/video-overlay-vision-assessment.md)、[本机实测与 AWS 部署评估](../engineering/research/vision-local-aws-deployment.md)、[预览与复现](../handoffs/Linzeyu912/2026-10-01-2026-vision-tracking-preview.md) | 本机已完成一个 8.1 秒片段的 10 次检测跟踪测量；YOLOv8s + ByteTrack 约 2.7 秒，BoT-SORT 约 6.5 秒。已本地生成并打开带人物框和 ID 的视频预览；准确率、完整战术成片的 10 分钟目标及云部署待验证，选型仍为建议 |
| 人工选人与遮挡复核原型 | [改进实验及编号中断诊断](../engineering/research/vision-player-refinement/README.md)、[本地界面说明](../engineering/tools/player-review/README.md)、[身份绑定核查](../engineering/research/vision-player-refinement/identity-binding-review.md) | 本地已实现固定 P 编号、关键帧修正、短缺口估计、续接候选、按区间关联新旧编号、出画标记及导出。2026-10-02 选人改为从确认帧向后生效，位置编辑独立；重复 ID 只释放受影响错段，保留前段及后续正确确认，旧草稿原样备份。46 项 JavaScript、4 项裁切测试及独立浏览器 QA 通过；模型串号和旧草稿推断分界仍需复核，未接入 Agent 或云部署，分类共享状态见本次整理交接 |
| 2D 球场数据工作台 | [界面与坐标说明](../engineering/tools/player-review/README.md)、[脚部实测](../engineering/research/vision-player-refinement/feet-model-comparison.md)、[场地比较](../engineering/research/vision-player-refinement/court-model-comparison.md)、[传播核查](../engineering/research/vision-player-refinement/propagation-validation.md) | 支持球 / 筐目标修正、RTMPose-s左右脚人工采用、具名点标定向导、投影检查与SIFT / LK镜头跟随。三个样例有逐帧待复核候选，采用后接通2D，失败留空；004/005/006分别可映射102/210、139/143、300/462帧，这些不是准确率。模型左右误认、固定字幕干扰及遮挡错脚均已记录；真实地面精度、Agent和云部署未完成 |
| 直播画面筛选与人工轨迹提取 | [三步流程](../engineering/research/vision-player-refinement/data-extraction-workflow.md)、[替换样例](../data/videos/tactics/acceptance/README.md)、[操作说明](../engineering/tools/player-review/README.md) | 按用户要求先筛普通直播区间，再对应 P1–P10、归并多个 T 编号并手动补轨迹；实际裁切保留来源帧 / 时间，删除段之间断开，缓存重启可恢复；第三步直接显示同步 2D 球场并可补当前帧，校准独立；裁判和米制球场坐标可选。旧教学001–003已退回，004–006为三个正常速度、无音轨的前场配合，不冒充完整原始球权；界面不预设战术。当前46项JavaScript、6项Python及浏览器流程通过；自动画面分类、身份OCR、独立位置精度、战术分析与讲解未完成，分类共享状态见本次整理交接 |
| NBA 2K25 / 2K26 季后赛球队球员能力数据 | [Agent 数据包](../2K%20Player%20Data/manifest.json)、[读取指引](../2K%20Player%20Data/AGENTS.md)、[覆盖说明](../2K%20Player%20Data/README.md) | 补采版 1.1 已推送 main（[a417fa7](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/a417fa749e51edb8b82fff07cc7b33afc69bd563)），独立验收 42/42 通过；635 条赛季记录、472 人、42 项能力，613 条有总评；仅原 2K26 空值新增 4,792 个值，2K26 为 318 条有总评、314 条个人能力完整、4 条仅总评，防守综合原值 195/318；2K25 保持 22 条评分缺失。已有评分、球队及号码不改，逐字段记录混合来源，剩余 null 保留；验证与远端同步见[补采交接](../handoffs/thy-0629/2026-10-01-1129-nba2k-null-remediation.md) |
| 2024–25 NBA 训练素材100段 | [素材说明](../data/videos/nba/2024-25/collection-report.md)、[播放目录](../data/videos/nba/2024-25/INDEX.md) | 已推送main（[ef840fb](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/ef840fb1a0d73b13363e64becccb08d1770f6db4)）：100段LFS成片，共647,393,804字节，独立远端下载及哈希核验100/100通过；16场、17队，14段完整球权；同类动作16组，包含首批3段；见[交接](../handoffs/Linzeyu912/2026-10-01-0848-video-lfs-management.md) |
| 2025–26 赛季 NBA 备赛视频素材（30 段+历史9段） | [赛季清单](../data/videos/nba/2025-26/manifest.json)、[标签与要求复核](../data/videos/nba/2025-26/review.md) | 39个成片已于2026-10-01入库Git LFS并推送main（见[交接](../handoffs/Linzeyu912/2026-10-01-2307-raw-clips-lfs-upload.md)）：batch030三十段字节与原采集记录逐一相符，尺寸/帧率/时长ffprobe实测；历史8段与单段独立登记，与三十段对应关系未确认；标签均为草案，画面复核待看片 |
| 视频按赛季归并与仓库资料审阅 | [目录说明](repository-map.md)、[视频入口](../data/videos/README.md)、[同步记录](../handoffs/Linzeyu912/2026-10-01-2118-repository-audit-sync.md) | 2026-10-01已完成资料整理与审阅：2024–25共100段，首批独立旧文件已删除；2025–26为30条待取得成片记录。用户已授权选择性同步，正在开发的文件与文档增量保留本地；实际推送和核验结果见同步记录 |
| 视频管理规范与统一批次登记 | [管理规范](video-data-management.md)、[批次清单](../data/videos/catalog.json)、[校验脚本](../scripts/validate_video_data.py) | 成片用LFS、元数据用普通Git；100段与2025–26的39段均已登记并入库；区分实测/采集记录、已看片标签/草案、完整回合/局部片段和内容重复/同类动作 |

## 待认领任务

下面是任务候选清单。开始时从 [GitHub 新建任务](https://github.com/Linzeyu912/broadcastcode-team-hub/issues/new?template=task.yml)，填写负责人和完成标准，并把 Issue 链接补入最后一列。创建 Issue 后，以 Issue 里的状态和负责人为准。

| 优先级 | 任务 | 完成标准 | 负责人 / Issue |
|---|---|---|---|
| 后续 | 队友接入（按用户要求暂缓） | 两位队友接受邀请、完成克隆并能按协作流程同步 main | 等待后续安排 |
| P0 | 核实技术硬性要求 | 指定区域、Agent 服务名称、模型 ID 有正式来源 | 待认领 |
| P0 | 核实素材发放与数据结构 | 记录下载入口、权限、格式、字段、单位、视频时间对齐方式 | 待认领 |
| P1 | 拆解官方参考视频 | 记录预期命中率、球员引力、胜率影响力的呈现方式及可借鉴点 | 待认领 |
| P1 | 确定最小演示范围和三人接口 | 明确输入、输出、模块边界、负责人和验收样例 | 待认领 |
| P1 | 验证部署流程 | 在允许使用的环境中验证 CDK、Agent 服务与 CloudFront 页面 | 待认领 |

## 关键时间

- 10 月 9 日：珠海签到。
- 10 月 10 日 08:00：考试视频抽签。
- 10 月 10 日 18:00：考试视频发布。
- **10 月 10 日 20:00：代码与作品 URL 提交截止。**
- 10 月 11 日：澳门决赛路演。

以上来自培训纪要；后续正式通知有变化时更新出处及日期。

## 交接记录

- [2026-10-03：多人战术轨迹首版同步与兼容核验](../handoffs/thy-0629/2026-10-03-1103-tactical-overlay-sync.md)
- [2026-10-02：人工球员资料确认与初步 2K 匹配](../handoffs/thy-0629/2026-10-02-1930-player-identity-2k.md)
- [2026-10-02：默认单标注、恢复漏框与固定编号](../handoffs/thy-0629/2026-10-02-1745-player-annotation-simple.md)
- [2026-10-02：同步最新工作台并保留本机篮球跟踪改动](../handoffs/thy-0629/2026-10-02-1657-workbench-remote-sync.md)
- [2026-10-02：两队颜色、稳定框与脚下编号](../handoffs/thy-0629/2026-10-02-1553-player-team-overlay.md)
- [2026-10-02：篮球模型与固定十人工作台](../handoffs/thy-0629/2026-10-02-1441-basketball-tracking-workbench.md)
- [2026-09-28：建立团队资料仓库](../handoffs/Linzeyu912/2026-09-28-repository-setup.md)
- [2026-09-28：Jev 地区可用性调研](../handoffs/Linzeyu912/2026-09-28-2159-jev-regional-availability.md)
- [2026-09-28：向 TypeSafe 发送地区支持询问信](../handoffs/Linzeyu912/2026-09-28-2206-jev-support-email.md)
- [2026-09-29：改为直接在 main 协作](../handoffs/Linzeyu912/2026-09-29-1428-main-only-workflow.md)
- [2026-09-29：三部分思路总结与纪要核对](../handoffs/Linzeyu912/2026-09-29-2115-agent-concept-review.md)
- [2026-09-29：收敛战术解读与声画表达](../handoffs/Linzeyu912/2026-09-29-2140-tactical-storytelling.md)
- [2026-09-29：方案总结结构与文风调整](../handoffs/Linzeyu912/2026-09-29-2147-summary-format.md)
- [2026-09-30：方案总结远端同步核验](../handoffs/Linzeyu912/2026-09-30-1038-agent-summary-sync.md)

- [2026-10-01：NBA 2K 球员数据包入库与远端同步](../handoffs/thy-0629/2026-10-01-0003-nba2k-player-data.md)
- [2026-10-01：NBA 2K26 缺失能力补采与逐字段来源](../handoffs/thy-0629/2026-10-01-1129-nba2k-null-remediation.md)

- [2026-10-01：NBA训练素材100段](../handoffs/Linzeyu912/2026-10-01-0031-nba-library100.md)
- [2026-10-01：视频数据管理与LFS共享](../handoffs/Linzeyu912/2026-10-01-0848-video-lfs-management.md)
- [2026-10-01：2025–26原始成片39段LFS入库与推送](../handoffs/Linzeyu912/2026-10-01-2307-raw-clips-lfs-upload.md)
- [2026-10-01：原视频定位与关系模型调研](../handoffs/Linzeyu912/2026-10-01-0953-video-overlay-vision.md)
- [2026-10-01：清理本地评分草稿并同步视频调研](../handoffs/Linzeyu912/2026-10-01-1546-cleanup-video-research-sync.md)

日常任务过程放在各自交接文件中；只在团队阶段、任务入口或关键依赖变化时修改本页，减少多人同时编辑冲突。
