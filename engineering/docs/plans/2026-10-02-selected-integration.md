# 2026-10-02：按用户选择整合两版工作台

记录时间：2026-10-02 22:29，Asia/Shanghai。当前为独立目录内的本地整合，HEAD 处于 detached 状态；未提交、未推送。原用户版与 THY 对照目录保留。本文件记录工程取舍，不属于赛事官方要求，也不代表三人共同完成技术选型。

## 发布补充

2026-10-02 23:30，本轮整合的五类功能提交已推送至 `codex/local-workbench-20261002`，未合入 main。来源归档、分类提交与最终验证见[本次分支记录](../workbench-branch-update-20261002.md)。下面整合过程中的未提交状态保留当时记录。

## 后续调整：红蓝仅表示分队

2026-10-02 用户进一步要求：目前没有可靠的攻守判断，因此去掉默认进攻 / 防守字段。当前界面仅显示上排红队、下排蓝队；新草稿、旧草稿载入、编辑响应与导出不再附带 `teamRoles`，颜色分队与人物资料保留。以下原始取舍和验证记录保留当时状态，其中固定红攻蓝守的安排已被本条替代。

## 来源与采用范围

- 用户版基线：[fffb6ea](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/fffb6ea7513b161dba0d0959ee4b822ae0469cf0)。保留左侧导航、分步骤操作、底部 2D 数据抽屉、人物编辑、球场标定和视频恢复能力。
- THY 来源：[1839dcd](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/1839dcde5b5cc0aa362baa474e58e5b530e6c695)。接入检测 / 跟踪方案、待核对编号建议、稳定显示和球员身份 / 2K 查询展示。
- 取舍依据：2026-10-02 本聊天用户明确要求现在开始整合；此前“只比较、不合并”的范围已由本次指示更新。本轮源码和本地接口采集日期均为 2026-10-02。
- 既有来源说明：[用户版人物编辑交接](../../../handoffs/Linzeyu912/2026-10-02-2046-roster-cancel-swap.md)、[THY 身份与 2K 交接](../../../handoffs/thy-0629/2026-10-02-1930-player-identity-2k.md)、[THY 发布交接](../../../handoffs/thy-0629/2026-10-02-2027-workbench-identity-publish.md)。历史记录保留当时状态。

| 部分 | 本次选择 |
|---|---|
| 页面布局 | 保留用户版左侧固定导航、分步工具和底部 2D 抽屉。 |
| 两队排列 | 上行红队进攻，下行蓝队防守；去掉攻守选择器，界面使用球员 1–10。内部 P1–P10 继续作为草稿兼容键。 |
| 拖动与纠错 | 整个人物资料和轨迹随交换移动；槽位颜色固定。取消区间与整段清空都能阻止模型建议自动填回。 |
| 检测 / 跟踪选择 | 默认推荐 THY 完整方案，保留原通用 YOLO 和其他已准备的对照版本；每版独立草稿。本轮共接入四个样例、27 个可用版本组合，见下文。 |
| 身份与 2K | 接入 THY 的赛季、球队、文字号码查询，人工选名确认，展示 13 项原始能力和逐字段来源。 |
| 球场标定 | 保留用户版具名点、篮筐方向约束初始化、镜头跟随和原图到 2D 映射；候选仍需采用与核对。 |
| 视频显示 | 保留黑屏恢复、重新加载和结束重播修复，接入 THY 的稳定显示 / 实际呈现帧同步。 |

“推荐”来自本轮用户的选择和现有样例观察，不是对所有视频的身份准确率结论。稳定显示、自动编号建议与真实同人连续性仍分别判断。

## 数据与接口约定

- `teamRoles` 固定为 `{"red":"offense","blue":"defense"}`；旧草稿的空值或反向设置在当前编辑 / 导出流程中归一。实际人物如分错队，通过交换槽位修正。
- `clear_player` 清空模型和人工关联、位置及事件，保留姓名、球衣资料和已确认的 `playerProfile` / `ratingReference`，写入 `identitySuggestionsDismissed: true`；`dismissedModelBindings` 保留被拒绝的模型观察区间，阻止换到空槽后自动回到旧槽。清除身份资料使用 2K 面板的独立操作。
- `release_identity` 保留范围外证据，在取消范围内裁剪 `modelBindings`，将交集加入 `dismissedModelBindings`，并保留人工 `unassigned` 屏障。`swap_players` 连同模型绑定、取消标记和能力引用交换，目标槽位的 `id` / `teamSide` 重算。
- 保留 `POST /api/review-edit`、`POST /api/court-calibrate`、`POST /api/court-propagate`；新增只读 `GET /api/player-identity/options` 与 `/lookup`。人物编辑只返回草稿副本，由浏览器保存；查询和标定不写人物草稿。
- 裁切同时保留模型来源、原片帧 / PTS、脚点检测指纹和球场初始化来源。被删除的初始化参考标记为 `source_removed`；模型建议只映射到保留且实际可见的轨道区间。
- 人工草稿不自动迁移到新裁切视频：源草稿及 `dismissedModelBindings` 留在原存储键，新视频按新的 SHA / 检测指纹创建或读取独立草稿。保留整段时仍使用当前草稿。

实现入口：[后端服务](../../scripts/serve_player_review.py)、[人物编辑](../../scripts/review_session.py)、[裁切](../../scripts/review_video_trim.py)、[工作台说明](../../tools/player-review/README.md)。

## 已完成的运行核验

2026-10-02 22:28，在独立预览 `http://127.0.0.1:8890/` 完成以下调用。整合服务随后由主任务重启载入最新实现，并于 22:38 补验跨槽拒绝记录；接口验证未修改正式草稿，原 8876 服务保留。

1. `GET /api/player-identity/lookup?season=2024-25&team=MIN&jersey=10` 返回 HTTP 200、唯一候选 Mike Conley / `name:mikeconley`。13 项能力逐一匹配本地 `2K Player Data/players/2024-25.jsonl` 第 86 行；总评 79、三分 83、控球 89、外线防守 83。
2. 名册来源为 [Basketball Reference 的 MIN 2024–25 名单](https://www.basketball-reference.com/teams/MIN/2025.html)，包内采集日为 2026-09-30。13 项能力均保留[固定 GitHub CSV 快照](https://github.com/ReinerJasin/NBA2k25_Web_Scraping/blob/bdf93420a846f073e4028de432a5cbd8a557ed51/output/current_nba_players.csv)与 `2024-11-26T02:25:26Z` 快照时间；游戏补丁日期未知。本轮核对的是本地记录和返回来源，没有重新抓取这些网页。
3. 对样例 005 / `team-stable` 发送纯请求内 QA 草稿，清空、取消、交换均 HTTP 200。核对了清空抑制、2K 引用保留 / 随人移动、固定红蓝攻守和范围；测试中的 Mike Conley 资料只用于接口结构验证，未标注为 005 的真实球员。
4. `POST /api/court-calibrate` 最小请求为 `{"sample":"005","variant":"team-stable","frame":0,"cuts":[],"propagate":false,"qa":true}`。实际加载本地 `yolo11n-court48` 权重后 HTTP 200，首帧返回右侧、`needs_review`、1 个有效候选帧；处理约 8.50 秒，含该次首次加载。仍为 `reviewRequired: true`、`metricAccuracyValidated: false`。
5. 上述操作前后，005 / `team-stable` 完整 clip payload 一致。后端全套 151 项 Python 测试、Python 编译和相应 `git diff --check` 通过；包含模型 / 球场重复裁切与合并后 HTTP 路由回归。
6. 最新服务中补验清空 / 区间取消重复请求、JSON 恢复后交换到原空槽 P9：`dismissedModelBindings` 保留对应 T1 的 0–142 / 7–142 区间，重复操作不累加重复记录，槽位颜色与固定攻守正确；源 clip 保持不变。

本机证据为 `artifacts/integration-runtime-qa/runtime-checks.json`、`artifacts/integration-runtime-qa/court-calibration-response.json`、`artifacts/integration-runtime-qa/dismissed-observations-http.json` 和 `backend-integration-tests.log`；这些位于忽略目录或使用被忽略的扩展名，不是已共享的云端产物。

## 最终模型与界面验收（22:39，Asia/Shanghai）

- 004 / 005 / 006 各有 original、ebard、baseline、low、reid、optimized、team-stable 七项；LAL 有原 THY 基线 original、low、reid、optimized、team-stable 与通用 YOLO yolo 六项。所有样例默认且唯一推荐项为 team-stable，合计 27 个组合逐一 HTTP 校验视频 SHA、帧数与版本标识通过。
- 独立模型环境锁定 Ultralytics 8.4.171，复用 CUDA Torch，部署 E-BARD 与 YOLOv8s 权重；五种配置及旧 E-BARD / ByteTrack 实际 GPU 短帧验证通过。新补 10 组、2,712 帧完整候选。原 THY 22 份 JSON 均与 1839dcd 原字节一致。见[部署复现](../../../environment/local/model-runtime.md)、[机器可读核验](../../../research/vision/model-integration-20261002.json)与[新增候选](../../../data/videos/tactics/acceptance/tracks/integration-20261002/README.md)。
- JavaScript 171 项全部通过（使用仓库共享快照，0 跳过）；151 项后端 Python 通过；46 项跟踪 / 渲染 / 展示测试通过（后者部分也在后端集合内，不相加作为独立总数）。前端 bundle 构建与 app / workspace 语法检查通过。
- 浏览器 QA 完成直播筛选门禁、两行固定红蓝及无攻守选择器、底部 2D 抽屉、2K 实际查询与能力展示、清除测试资料、模型建议确认、取消后刷新及重新检查不复活、主动重选、跨队交换 / 撤销、模型切换草稿隔离、视频结束重播与重新加载恢复。浏览器控制台无错误；这些操作只在 QA 草稿中进行。
- 视频校验 `python scripts/validate_video_data.py --metadata-only --check-index` 通过：5 个数据集、142 条、142 个索引 LFS 指针；本轮没有新视频。Git 补丁空白检查通过。
- 当前预览 `http://127.0.0.1:8890/` 已载入整合实现；原 8876 服务和用户工作目录保留。汇总证据 `artifacts/integration-verification.json`、`artifacts/http-model-matrix.json`、`artifacts/integration-preview.jpg` 均为本机忽略产物。

本轮本地实现已完成，尚未提交或推送。后续可从样例逐段核对人物身份及球场映射，再按用户指示同步。真实身份和米制位置准确率仍沿用此前未验收边界。
