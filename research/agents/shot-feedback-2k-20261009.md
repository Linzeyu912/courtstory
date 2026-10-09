# 出手冻结、投篮机会与防守压力：现状核查和 2K 参考

核查日期：2026-10-09，Asia/Shanghai（UTC+08:00）。代码基线：`main` / `HEAD` / 远端 `main` 均为 `1a14be3bb239001c5ec8cc1300a5d071186714c5`，开工工作区干净。GitHub Issue 查询返回 EOF，未核对最新 Issue 讨论。本轮为研究与待评审接入建议，未修改产品代码、调用付费模型、提交、推送或部署，不表示功能已实现或设计已获批准。

用户所说的“投篮时机”已明确为比赛中的机会选择，例如空位是否出现、协防是否到位；不是游戏玩家松开投篮键的早晚。

## 当前两条链是否一致

两条链都由多模态模型根据实际抽取的图像理解视频，也都可以参考已有观察记录；当前代码没有把完整 MP4 直接交给模型一次性理解。它们的模型调用、取证方式、输出结构和成片时间轴不同，没有共享的出手事件。

| 项目 | 解说文字与配音 | 战术画图 |
| --- | --- | --- |
| 实际入口 | `CommentaryJobs`，网页调用 OpenRouter `openai/gpt-6-astra`；Pi Agent 可多轮调用观察工具 | `TacticsAgent`；模型取本机受信配置或显式覆盖，默认启用 V4 visual facts 与独立 visual audit；不能把重试模型当固定主模型 |
| 如何看视频 | 首次按最多 2 fps、约 120 帧预算生成全片概览；随后主动读取短窗口、单帧视图、局部裁图和已有观察，提示允许关键短窗口提高至 8–12 fps | 先选阶段起止、冻结帧、切镜两侧等画面，再按时间间隔补点；默认 `max_images=12`，普通目标约为 `ceil(阶段秒数/3)+1`，受必需帧和预算约束；默认 facts 模式实际发送所选原尺寸单帧 |
| 图像之外的证据 | `get_observations` 是辅助，提示要求优先核实图像；全帧视图会缩放至 1280 边界，不能称逐帧无损观看 | 稀疏轨迹和身份不确定性参与宿主覆盖检查；默认 facts 提示视图进一步压缩，不等于把所有 P 轨迹和身份档案都交给模型 |
| 输出 | 带片内相对秒数与图像证据帧的事件、句子、`during_play` / `pause` | `people/routes/ball/static` 等视觉事实，经宿主编译为 V4 图形，独立审核后供预览、采用与保存 |
| 冻结与成片 | 暂停句通常取建议区间中点附近的真实帧，停留长度随配音；字幕／配音成片有自己的时间轴 | 战术关键帧／生产 cue 编译为另一套播放与输出时间轴，由共享图形渲染器绘制；不是同一个解说成片任务 |

代码证据：解说模型和启动命令见 [commentary_jobs.py](../../engineering/scripts/commentary_jobs.py) 第 64、179–180 行；概览和工具见 [commentary_agent.py](../../engineering/scripts/commentary_agent.py) 第 116–121、229–241 行；图像模式见 [commentary_video.py](../../engineering/scripts/commentary_video.py) 第 304–323 行；多轮取证与时间要求见 [commentary-worker.mjs](../../engineering/tools/player-review/agents/commentary-worker.mjs) 第 7–13 行。战术默认模式、采样和原图输入见 [tactics_agent.py](../../engineering/scripts/tactics_agent.py) 第 312–350、446–478、761–842 行。

## 与新规则直接相关的缺口

1. **尚无结构化出手事件。** 当前 facts 的角色只有 `ball_handler/screener/receiver/off_ball/defender/other`，动作只有 `move/cut/roll/pop/hold/space/screen/unknown`，没有 `shooter`、`shot`、离手时刻或前 1 秒防守窗口。仅追加提示词不足以让新字段通过严格 schema、编译和审核。见 [tactics_visual_facts.py](../../engineering/scripts/tactics_visual_facts.py) 第 12–14、48–75 行。
2. **现有重点圈限制为该帧持球者，涉及多个校验层。** facts 提示要求 `ball` 指向参考帧实际持球人，同帧最多一人；编译后设为 `ball_handler` 并生成 `spotlight`，见同文件第 98、225–235 行。独立 [tactics_visual_audit.py](../../engineering/scripts/tactics_visual_audit.py) 第 178–179 行只接受有球／手证据的持球或控球运球；前端 [tactics-agent.mjs](../../engineering/tools/player-review/tactics-agent.mjs) 第 65–71 行会将非持球者重点圈改成位置标记，第 99–101 行还会拒绝缺少当前持球依据的重点圈。球刚离手的投手可能因此失去高亮条件。新规则须由出手事件确认投手，并同步更新 schema、编译和审核／采用约束；不能只改 facts 提示，也不能要求冻结帧中球仍在手里。非 facts 的 V4 提示同样有该限制，见 [tactics_agent.py](../../engineering/scripts/tactics_agent.py) 第 186 行。
3. **一般战术采样不足以保证覆盖离手及此前 1 秒。** 当前稀疏抽帧适合概览路线，可能跳过举球、扑防和离手变化；更多轨迹元数据不等于更多模型实际看过的图像。需要围绕候选出手主动加密取证。
4. **解说暂停尚未绑定投篮离手。** 当前按句子建议区间中点选择真实帧，不能保证冻结在出手瞬间。见 [render_commentary_narration.py](../../engineering/scripts/render_commentary_narration.py) 第 21–64 行。
5. **2K 能力没有进入战术模型输入。** 身份确认可以保存 `playerProfile/ratingReference`，但 `agent_entity_inputs()` 只选 `id/name/role/teamSide`、轨迹和合法视觉身份参考；后续 pack 没有追加 2K。默认 facts 提示取更小的视图，也不包含能力数据。见 [player-identity.mjs](../../engineering/tools/player-review/player-identity.mjs) 第 37–51 行、[tactics_agent.py](../../engineering/scripts/tactics_agent.py) 第 110–150、818–829 行、[tactics_visual_facts.py](../../engineering/scripts/tactics_visual_facts.py) 第 78–87 行。
6. **解说和战术尚未联合成片。** 解说服务以源视频和解说计划生成 `commentary-final.mp4`；战术生产器读取战术 document 编译另一套 timeline。第三部分同时出现两个入口不代表两者已共用暂停。见 [commentary_jobs.py](../../engineering/scripts/commentary_jobs.py) 第 166–204 行、[tactics-production.mjs](../../engineering/tools/player-review/tactics-production.mjs) 第 112、155 行、[production-worker.mjs](../../engineering/tools/tactical-overlay/production-worker.mjs) 第 7、21 行。

## NBA 2K 可借鉴的依据与边界

本轮通过本机 HTTPS 成功读取以下官方页面正文。网页工具访问曾返回 403，浏览器访问也失败；未完成官方游戏 HUD 的截图／实机视觉核对，因此本报告不声称复刻了其具体布局、颜色或字段位置，也不把自拟卡片当成官方截图。

选择 2K25／2K26 是为了对应本地数据版本，不表示它们是核查日的最新游戏版本。

- [NBA 2K25 Gameplay Courtside Report](https://nba.2k.com/2k25/courtside-report/gameplay/) 的 Contest System 说明：干扰计算动态考虑起手与出手时的防守情况，外线／内线防守能力及身高差对 coverage 更重要。这支持观察出手前防守变化，再结合攻防能力解释的方向；本轮所读官方报告未公开可直接移植的数值公式。
- 同一份 2K25 报告的 Rhythm Shooting 讨论 push timing 与 tempo；[NBA 2K26 Gameplay Courtside Report](https://nba.2k.com/2k26/courtside-report/gameplay/) 继续以 timing／tempo 描述操作输入与投篮动画，并讨论难度相关的 Green or Miss。这些机制不等于真实比赛中的投篮机会选择，也不能转换成真实命中率。2K25 的可调 risk/reward 设置不能直接表述为 2K26 的现状。

适合借鉴的是把“出手机会”和“受到的防守”分开反馈，以及考虑起手至出手之间的变化。此前 1 秒窗口、8–12 fps 初查、等级名称和冻结时长均为本项目建议，不是 2K 公布的标准。

展示层的补充依据：[2KLab 的固定 2K26 设置记录](https://www.nba2klab.com/nba2k-best-settings-2k26)列出 Shot Feedback 的 All Shots／Free Throws／Off／Simple／User Only 选项，并说明 Shot Meter 可在 Customize HUD 调整样式、颜色、大小和位置。这是第三方自行采集的操作记录，非 2K 官方资料；未采用其命中提升比例建议，也未使用已轮换到 2K27 的通用页面。另一个 [2K26 实际截图的图像索引](https://universe.roboflow.com/2k26-shot-meter-detection/my-first-project-yflii)描述包含 `TEMPO EXCELLENT`、`TIMING EXCELLENT`、`COVERAGE WIDE OPEN`、`DISTANCE 24'7`，支持分项反馈的参考方向；当前工具未展示原图像素，因此这属于来源页面／图像检索描述核对，不是逐像素视觉验收。拟议卡片使用“机会选择＋防守压力＋2K 能力”，不照搬玩家 timing／tempo。

## 现有 2K 数据能提供什么

当前本地数据包为 2.0：两季各 30 队，1,151 条球员赛季记录、687 人；1,111 条个人能力完整、6 条部分缺失、34 条缺评分记录。`complete` 仅代表 36 项个人能力齐全，不代表全部 42 项字段都有值。见 [manifest](../../2K%20Player%20Data/manifest.json) 第 16–39 行及 [读取约定](../../2K%20Player%20Data/AGENTS.md) 第 7–23 行。

| 用途 | 当前查询 API 已暴露的字段 | 数据包有、API 尚未暴露的相关字段 |
| --- | --- | --- |
| 出手能力背景 | `three_point_shot`、`mid_range_shot`、`close_shot`、`layup`、`driving_dunk` | `shot_iq`、`offensive_consistency`、`post_fade` 等 |
| 防守能力背景 | `perimeter_defense`、`interior_defense`、`block`、`help_defense_iq`、`defensive_consistency` | `agility`、`speed`、`vertical`、`strength` 等 |
| 基础资料 | `overall`、`ball_handle`、`speed_with_ball` | 原始来源的 `cat_*` 综合分类，缺值不得推算 |

已有 `/api/player-identity/options` 和 `/api/player-identity/lookup`，后者按赛季、球队、文本号码查询候选，只输出 13 项能力及逐字段来源。见 [player_identity_data.py](../../engineering/scripts/player_identity_data.py) 第 11–18、144–219 行与 [服务路由](../../engineering/scripts/serve_player_review.py) 第 588–610 行。现有能力卡仅展示原值与“未知”，尚无本次投篮机会或防守压力的评分公式／卡片，见 [player-identity.mjs](../../engineering/tools/player-review/player-identity.mjs) 第 89–114 行。

真实数据示例仅用于说明可读取的属性，不是某个视频回合的评分：Curry 2K26 的三分 99、中投 97、投篮选择 75、进攻稳定性 95，见 [2025–26 记录](../../2K%20Player%20Data/players/2025-26.jsonl) 第 7 行；Gobert 2K25 的内线防守 95、盖帽 81、协防意识 95，见 [2024–25 记录](../../2K%20Player%20Data/players/2024-25.jsonl) 第 57 行。`shot_iq` 是静态游戏属性，不能当作“这一球的投篮时机”。

关联必须保留赛季／游戏版、球队和球员身份依据：2024–25 对应 2K25，2025–26 对应 2K26；姓名仅精确规范化或使用审定别名，号码 `0` 与 `00` 区分，交易关系不证明当场出场，P 槽或机器姓名不自动证明此刻人物身份。新姓名链使用的 [PlayerGameRoster](../../engineering/scripts/player_game_roster.py) 第 1–36 行可独立返回当场名单，但不返回 2K 能力。

逐指标优先采用 `field_source_ids[field]`，只对 baseline 字段回退到 `default_source_id`；保留 null，不跨版填空、不补零、不推算综合分。来源日期可能混合，不能称比赛当天能力或统一赛季末快照；这些评分为第三方历史整理，并非 2K 官方导出。见 [逐字段来源](../../2K%20Player%20Data/field_provenance.json) 第 4–32 行及 [数据约定](../../2K%20Player%20Data/AGENTS.md) 第 16–23、40 行。

另发现范围文案落后于数据：后端 `DATASET_SCOPE` 与前端来源说明仍写“各季 16 支季后赛球队”，实际包与查询已覆盖全联盟。位置为 [player_identity_data.py](../../engineering/scripts/player_identity_data.py) 第 17–18 行、[player-identity.mjs](../../engineering/tools/player-review/player-identity.mjs) 第 108 行。本轮仅记录，未修产品代码。

## 最小接入建议，待评审

建议先建立两个消费者共用的 `ShotEvent`，不立即合并全部 Agent。它至少需要事件 ID、源视频摘要、真实离手 PTS／源帧与片内帧映射、投手及相关防守者、身份与位置证据、前 1 秒可用窗口、观察事实、评估结果和逐字段 2K 引用。评估字段须随 schema 版本新增，明确区分事实、推断、未知和失败原因，不能通过任意扩展旧 strict schema 偷渡。

建议证据与显示顺序如下；这是接入边界说明，不是正式开发计划：

1. 从概览定位候选出手，对出手前 1 秒先按 8–12 fps 看防守变化，再在临近离手处按源帧细查。定位事件可以查看离手后的少量帧，但机会与压力评估只消费时间不晚于离手的证据，不能用投进／投丢反推选择好坏。
2. 保存实际 PTS 和原始映射，保留 VFR、裁剪偏移、切镜与不足 1 秒的边界。切镜不拼成连续防守；离手或人物被遮挡时允许“无法判断”，不捏造精确时刻、距离或身份。
3. 根据同一出手事件产生解说、冻结 cue、既有 `spotlight` 和评估卡。投手高亮建立在出手身份上，即使冻结帧已经离手也应能显示。复用 [共享图形渲染器](../../engineering/tools/player-review/tactics-annotations.mjs) 第 474 行及生产调用，保持人工编辑和预览／MP4 一致。
4. 共用源时间到输出时间的映射；建议默认冻结 2.5 秒，可调并随配音延长。同一源帧已有人工或解说 hold 时合并展示，避免重复暂停；用户已有 cue 的内容和人工修改需保留。
5. 防守压力优先由视频可见事实分级，2K 参与有条件的定性解释：投手相应三分／中投能力辅助判断该出手是否适合他；防守值只在画面确认对应防守者实际到位、扑防或举手等情况下解释威胁，不能因远处球员外防高便判高压。这是本项目建议，不设未经校准的数字权重。没有标注校准前，不给“23% 干扰”、真实命中率或伪称官方的数值公式；身份／能力缺失时照常给有依据的匿名观察，能力显示未知。

建议冻结卡的文字结构：

| 显示项 | 建议内容 |
| --- | --- |
| 投篮机会 | 较好／一般／勉强／无法判断；评价空位出现、协防到位等本回合机会 |
| 防守压力 | 空位／轻度／中度／重度／无法判断；必须有视频依据 |
| 一行证据 | 概括出手前的可见变化，例如“防守者绕过掩护后追出，离手时尚未完成举手干扰”；此句为写法示意，不是本轮实测 |
| 攻防能力参照 | 按实际出手类型选择三分或中投等属性，对照相关防守者外防／内防／盖帽；未可靠匹配时显示未知 |
| 来源 | 游戏版本与可展开的逐字段出处、来源日期口径；示意数值必须标假设，不冒充当前视频实测 |

## 建议验收与本轮验证范围

后续验收至少覆盖接球投篮、追防补防、协防到位、切镜、遮挡、可用前窗不足 1 秒、VFR／裁剪时间映射、2K null、错误赛季或身份、同帧人工 cue 合并、预览与 MP4 冻结帧和高亮一致。还应验证同一出手前证据不会因后续进球或投丢而改变机会与压力判据。

本轮已执行源码与 schema 交叉读取。独立 verifier 复核结论：**PASS（研究文档核查）**。已独立确认两条分析链、2K 输入缺口、facts／audit／前端持球高亮限制与引用行号；三份文档的 49 个相对链接全部存在，两个本地数据包的 manifest、index、schema、field_provenance、两季主 JSONL 六项 SHA256 相同；实际调用 `PlayerIdentityData.lookup('2025-26', 'GSW', '30')` 返回唯一 Curry 候选、13 项原始能力及 13 项来源，`git diff --check` 通过。独立读取的官方正文支持动态干扰与版本区分，公式表述已收窄至本轮所读报告。HUD 视觉核对未完成；此 PASS 不表示设计已获用户批准、功能已实现、模型准确性已通过或服务已部署。本轮未执行新模型分析、产品端到端测试或投篮评分准确性验收。
