# 人工球员资料确认与初步 2K 匹配：2026-10-02

记录时间：2026-10-02 19:30，Asia/Shanghai。本轮按用户授权，在现有工作台完成人工资料确认与只读 2K 查询；断轨续接暂缓。设计与接口见[实施计划](../../engineering/docs/plans/2026-10-02-player-identity-2k.md)，操作入口见[工作台说明](../../engineering/tools/player-review/README.md)，交接见[19:30记录](../../handoffs/thy-0629/2026-10-02-1930-player-identity-2k.md)。代码与文档尚未提交或推送。

## 当前行为

视频和十个编号保持主界面，下面默认折叠“身份确认与 2K 能力”。选 ID 或点框只查看，随后选择视频赛季、实际球队与文字号码，查找、核对并选择姓名，明确点击确认后才保存资料和能力引用。蓝 / 橙是标注队色，不代替实际 NBA 球队。

唯一候选也不自动确认；BOS 44 等整季同号情况保留多人供核对。DET `0` / `00` 独立查询，前导零保留。两个编号不能确认同一赛季同一球员；其他编号存在另一赛季确认时拒绝新赛季。确认 / 清除可撤销，旧姓名、球队文字、号码、人工几何、轨道关联与草稿键保留。

确认资料与确认轨道是两件事。自动轨道继续保持模型状态；资料卡不证明整段始终跟踪到同一个真人。当前没有位置时仍可明确确认资料，证据标明位置未知；不生成隐藏框、脚点或连续轨迹。此轮没有OCR、自动断轨续接、轨迹优化、投篮难度 / 概率、新模型推理或云部署。

## 数据与接口

数据来源为现有[2K读取指引](../../2K%20Player%20Data/AGENTS.md)及[覆盖说明](../../2K%20Player%20Data/README.md)。已收录 472 人两季球队履历提供各季 30 队选项，不代表各队完整名单。整季名单包含离队球员，不证明当场阵容；能力表限定为各季16支季后赛球队的筛选范围。`no_match` 表示包内查无候选，不证明球队没有这人。

只读接口为 `GET /api/player-identity/options?season=…` 和 `GET /api/player-identity/lookup?season=…&team=…&jersey=…`。省略 season 的 options 返回赛季选项与空 teams；lookup 返回 no_match / unique_candidate / multiple_candidates，不写入会话。坏参数返回 JSON 400，资料包缺失返回 JSON 503，视频接口仍可用。

确认保存 `entity.playerProfile` 和深拷贝的 `ratingReference`；资料保留 `player_id_namespace='normalized_name_key'`，姓名键不是官方 NBA 稳定 ID。候选 season_roster 深拷贝保存实际名册 source_id、URL、phase；确认时另外保存视频 SHA、跟踪指纹、版本、来源帧 / PTS、轨道与可见情况。清除只移除资料 / 能力引用，最后一次清除仍保留 gameContext.season；没有其他已确认资料时可重新选择赛季。

能力卡提供 13 项原值：overall 放总评卡头，其他项分投篮 / 突破 / 防守三组；null 显示未知。complete / partial / missing_record / not_in_rating_scope 使用数据包原状态，不跨季借值，也不按这13项重新判定全记录完整性。来源逐字段保存 source_id、URL、game、snapshot_date、date_basis；来源快照日不等于比赛当日或游戏补丁日。没有综合分或 FG%。

导出在原结果外增加 gameContext 与完整十项 playerIdentities，未确认引用为 null；原 entities / frames、原片来源 PTS 和模型轨道保持。工作台 `&qa=1` 隔离测试草稿，禁用正式导出。

## 实际样例

验收使用本机 LAL–MIN 样例 `nba-lal-min-005` 的 team-stable 版本，界面首帧为第 1 / 267 帧。核对蓝衣 MIN 10 号 CONLEY 后，在 QA 草稿将编号4明确确认为 **Mike Conley / 2024-25 / NBA 2K25**。编号框仍显示“需要核对”。

| 分组 | 字段 | 本季原值 |
| --- | --- | --- |
| 总评 | overall | 79 |
| 投篮 | three_point_shot | 83 |
| 投篮 | mid_range_shot | 67 |
| 投篮 | close_shot | 87 |
| 突破 | layup | 76 |
| 突破 | driving_dunk | 30 |
| 突破 | ball_handle | 89 |
| 突破 | speed_with_ball | 83 |
| 防守 | perimeter_defense | 83 |
| 防守 | interior_defense | 31 |
| 防守 | block | 45 |
| 防守 | help_defense_iq | 83 |
| 防守 | defensive_consistency | 80 |

这些值由实际 API、数据包源记录和浏览器能力卡对照。旧 P3 人工号码 `27` 保留。多候选 / 未知能力的 UI 检查曾临时选 BOS Miles Norris，已撤销；这只验证界面，不声称 Norris 出现在这段 LAL–MIN 视频中。

## 验证与证据

| 验证层 | 已完成 | 证据范围 |
| --- | --- | --- |
| 前端行为 | 17 项新测试、144 项全量 JS通过 | 实际 app，替换布局 / 媒体 / HTTP 的可控 harness；新17已包含在144内 |
| 后端 | 22 项新测试、102 项全量 Python通过 | 精确名单、0 / 00、多候选、null / 状态 / 来源、真实HTTP和旧回归；新22已包含在102内 |
| 独立产品审查 | 后端与前端 Approve | 作者与 reviewer 分离；另417个源数据 / HTTP不变量断言及17个前端边界断言，不加成单测总数 |
| 原生浏览器 | 16项正常操作记录，console为空 | 明确确认、清除、Undo、刷新、重复 / 跨季拒绝、输入失效候选、多人选名、未知能力、旧号码保留、来源展开逐帧保留、播放无位置时资料仍在；仅QA草稿 |
| 异步 / 网络边界 | app单测与独立 replay通过 | 迟返、A→B→A、查询输入变化和网络失败；未在原生浏览器注入断网 / 迟返 |
| 保护 / HTTP | 850项原文件、67项备份无错；17版clip响应完整字节一致；8静态资源200 / SHA一致 | 原媒体、模型候选、2K数据和历史产物不变，实际服务读取冻结源码 |

QA没有操作正式用户草稿，也没有执行真实导出下载。十人资料导出包装由实际 app 的 JavaScript 行为测试验证；不能把它写成原生浏览器下载验收。完整 Agent、自动身份识别准确率与整段同人连续性未在此轮验收。

本机证据位于 `artifacts/player-identity-2k-20261002/`，被 Git 忽略，**不是 GitHub 共享产物**。主要入口为[浏览器记录](../../artifacts/player-identity-2k-20261002/browser-qa.json)、[本机最终截图](../../artifacts/player-identity-2k-20261002/workbench-identity-2k-final.jpg)、[最终保护](../../artifacts/player-identity-2k-20261002/final-preservation.json)、[最终HTTP](../../artifacts/player-identity-2k-20261002/final-live-checks.json)、[后端独立审查](../../artifacts/player-identity-2k-20261002/backend-independent-review.md)和[前端独立审查](../../artifacts/player-identity-2k-20261002/frontend-independent-review.md)。这些相对链接仅在保留本机产物的 checkout 中可读取。

## 本机运行与同步

当前服务 `http://127.0.0.1:8876`，工作进程 PID40028、launcher PID26404；PID是验收时状态，重启后会变化。服务只读预计算检测 / 元数据和本地2K包，不在线部署或推理新模型。已配置环境从仓库根目录启动：

```powershell
& tmp/player-identity-test/.venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

实际模型权重、独立 Python 环境和实验 artifacts 未随 Git 共享，克隆不能直接复现所有本机版本。默认数据包路径为仓库 `2K Player Data`，可用 `--player-data-root` 明确指定只读副本；无需新增模型部署。

本轮实测分支 main、本地及远端仍为 `72c74e041fd673de81488ebdf48cb97d39427bda`，没有本轮提交、推送或 staged 内容。保护备份保留；另一代理已独立复核六文档并Approve，最终依据见[独立报告](../../artifacts/player-identity-2k-20261002/final-independent-verification.md)与[验收JSON](../../artifacts/player-identity-2k-20261002/independent-acceptance.json)。
