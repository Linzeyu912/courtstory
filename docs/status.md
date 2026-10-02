# 团队状态

更新日期：2026-10-02（Asia/Shanghai）

## 当前阶段

赛事资料与本机数据提取原型开发并行。赛事要求集中在 `requirements/`，代码、设计和技术实验集中在 `engineering/`；完整 Agent 流程、真实身份 / 位置精度验收和 AWS 部署尚未完成。

2026-10-02 用户授权整理此前全部改动，按类别直接提交并同步 main；分类提交、LFS 校验和远端结果见[本次整理交接](../handoffs/Linzeyu912/2026-10-02-1109-organize-publish.md)。归档共享不代表实验已经达到产品验收标准。

**协作方式：所有内容直接在 `main` 修改、提交和推送，不新建任务分支，不使用 PR 合并。** 见[协作流程](workflow.md)与[决策 D004](decisions.md#d004所有内容直接在-main-上改进)。

## 已有成果

| 成果 | 文件 / 入口 | 状态 |
|---|---|---|
| 9 月 28 日培训内容、评分和交付要求 | [赛事资料整理](../requirements/BroadcastCode赛事资料整理.md) | 已整理，转写疑点有单独标注 |
| 腾讯体育「深度赛场」官方参考片段 | 同上第 8 节 | G1–G4 链接已核验；日期为 2026 年 6 月 |
| 官网与报名渠道核验、扩展调研、Word 手册 | [调研索引](../engineering/research/README.md) | 已归档；主要采集于 9 月 17 日 |
| 共享文档结构、Agent 指引与交接模板 | [协作流程](workflow.md)、[交接目录](../handoffs/README.md) | 已准备 |
| GitHub 私有仓库与首次同步 | [broadcastcode-team-hub](https://github.com/Linzeyu912/broadcastcode-team-hub) | 已创建并推送，已核对私有状态及本地与远端提交一致 |
| TypeSafe Jev 珠海与澳门可用性调研 | [调研结论与验证步骤](../engineering/research/jev-regional-availability.md) | 已发邮件向厂商确认，等待答复；未实测，尚未决定采用 |
| 解说 Agent 方案总结与直播纪要核对 | [方案讨论稿](../engineering/docs/agent-concept-review.md) | 已同步至 main（8bb3611）；按数据采集、数据处理、内容呈现整理；重点为战术意图、行为动因与声画同步；球员引力待验证，另两项核心指标后续再议 |
| 原视频战术叠加与位置提取调研 | [关系与球场映射评估](../engineering/research/video-overlay-vision-assessment.md)、[本机实测与 AWS 部署评估](../engineering/research/vision-local-aws-deployment.md)、[预览与复现](../handoffs/Linzeyu912/2026-10-01-2026-vision-tracking-preview.md) | 本机已完成一个 8.1 秒片段的 10 次检测跟踪测量；YOLOv8s + ByteTrack 约 2.7 秒，BoT-SORT 约 6.5 秒。已本地生成并打开带人物框和 ID 的视频预览；准确率、完整战术成片的 10 分钟目标及云部署待验证，选型仍为建议 |
| 人工选人与遮挡复核原型 | [改进实验及编号中断诊断](../engineering/research/vision-player-refinement/README.md)、[本地界面说明](../engineering/tools/player-review/README.md)、[身份绑定核查](../engineering/research/vision-player-refinement/identity-binding-review.md) | 本地已实现固定 P 编号、关键帧修正、短缺口估计、续接候选、按区间关联新旧编号、出画标记及导出。2026-10-02 选人改为从确认帧向后生效，位置编辑独立；重复 ID 只释放受影响错段，保留前段及后续正确确认，旧草稿原样备份。46 项 JavaScript、4 项裁切测试及独立浏览器 QA 通过；模型串号和旧草稿推断分界仍需复核，未接入 Agent 或云部署，分类共享状态见本次整理交接 |
| 2D 球场数据工作台 | [界面与坐标说明](../engineering/tools/player-review/README.md)、[场地、脚点及镜头实测](../engineering/research/vision-player-refinement/court-calibration-research.md) | 本地支持滑动半场 / 全场、五个步骤、缺口定位、补点和事件；浅木色球场、具名参照点纠正、多点拟合及原视频投影线。新增留出核验点、脚点来源、像素到米坐标及局部敏感度，28 项 JavaScript 测试通过。YOLOv8s-pose 和 KaliCalib 作者网络已离线抽样试跑；脚踝并非地面点，原生场地模板及自动标定仍需适配核验，未接入正式轨迹。在线纠偏、独立精度验收、Agent 和云部署待完成，分类共享状态见本次整理交接 |
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
