# 球员身份确认与初步 2K 匹配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有球员标注工作台中，让用户按赛季、球队和球衣号码查找名单，明确确认所选 ID 的球员资料，并查看同赛季 NBA 2K 能力原值与来源。

**Architecture:** 后端只读查询现有 `2K Player Data`，前端新增资料确认模块和折叠面板。球员资料、2K 引用与检测轨道分别保存；确认资料不修改追踪、几何或已有人工字段，导出通过包装现有结果增加身份信息。

**Tech Stack:** Python 标准库 HTTP 服务与 unittest；原生 JavaScript ESM、现有 HTML/CSS、Node test runner；现有 JSON/JSONL 数据包与浏览器草稿。

**Spec:** 用户已授权本轮直接实施；设计与实施计划合并于本文的[设计](#设计)。历史基线见 [17:45 交接](../../../handoffs/thy-0629/2026-10-02-1745-player-annotation-simple.md)，数据读取规则见 [2K 数据说明](../../../2K%20Player%20Data/AGENTS.md)。产品实现、本机验收与文档独立复核已完成，实测见[本轮记录](../../../research/vision/player-identity-2k-20261002.md)，最终依据见[独立报告](../../../artifacts/player-identity-2k-20261002/final-independent-verification.md)。

## Global Constraints

- 继续使用 `main` 和现有工作台；保留旧 dirty，不创建分支、不提交、不推送。
- 本轮完成人工资料确认与只读 2K 匹配；断轨续接、OCR、轨迹优化、投篮难度与云部署暂不实施。
- 不改原始名单、能力值、检测数据、模型、轨道关联、草稿命名空间或原片 PTS。
- 不改 `trajectory.mjs`、`ui.bundle.mjs`、原简版模块和自动编号模块。后端仅新增查询能力，前端只增加本计划面板、状态与导出包装。
- 保护清单为 `artifacts/player-identity-2k-20261002/before-preservation.json`：850 项原数据、媒体与历史 artifact 保持字节不变。67 个 dirty 文件中仅本任务获授权的 app / index / CSS / server / 文档增量允许变化，其他 dirty 和外部 18:46:59 备份字节不变；新增模块与测试按文件职责实施。不得修改保护清单。
- README、research、status 和新 handoff 在实际验证完成后再更新；计划不替代运行证据。

## Review Focus

1. **精确查询边界：** BOS 44 多候选、DET `0` / `00`、整季离队名单、赛季与能力范围不混淆；任务 1 用真实数据反例覆盖。
2. **缺失与来源：** 13 项 null、四种能力状态、逐字段来源和不同快照日期不被补值或合并；任务 1 覆盖。
3. **人工意图：** 点框只查看；重复球员、跨季冲突和失败操作不修改会话、不产生 Undo；任务 2 覆盖。
4. **迟返与兼容：** 切 ID / 改输入后旧请求不绑定新 ID，网络错误保留确认卡；原字段、十人导出和旧草稿不受影响；任务 2 覆盖。
5. **真实运行：** HTTP 路由与静态模块可加载，浏览器确认 / 清除 / 撤销 / 刷新有效，保护文件字节不变；任务 3 独立验证。

## 设计

### 界面与交互

```text
现有视频、播放 / 逐帧 / 进度条
ID 1  ID 2  …  ID 10                现有纠正编号
▸ 身份与2K能力
  当前 ID 3                          [已确认资料 / 尚未确认]
  赛季 [2024-25]  球队 [BOS]  号码 [44]  [查找]
  候选：○ 球员 A  ○ 球员 B          [确认该球员]
  名单属于整季；需结合视频核对当场球员。
  已确认姓名 / 球队 / 号码 / 赛季     [清除确认]
  投篮 / 突破 / 防守：13 项原值       ▸ 各项来源
```

- 面板默认折叠，保留视频和十个 ID 的主视图。普通选 ID、点已有框和切换高级工具只查看资料，不确认资料或轨道。
- 球衣号码使用文字输入，保留前导零。查找结果即使唯一也只是候选，必须明确点击确认；多个候选必须先选一个。
- 切换 ID 或修改任一查询输入立即失效旧候选。请求结果只进入发起请求时的 ID 与查询上下文；迟返、乱序结果不能重新开放旧确认按钮。
- 网络失败显示查询错误，原确认卡保持可见。资料确认与框的可信状态分别提示：球员当前无坐标仍允许明确确认资料，并显示“框需核对”。
- 能力卡头显示 overall 原始总评；投篮含 three_point_shot、mid_range_shot、close_shot；突破含 layup、driving_dunk、ball_handle、speed_with_ball；防守含 perimeter_defense、interior_defense、block、help_defense_iq、defensive_consistency。所有 13 项保留原值与 null，不计算分组综合分或投篮命中率。

### 只读 API 与数据语义

```text
GET /api/player-identity/options?season=2024-25
→ {seasons, teams:[{abbreviation,name,name_zh?}], dataset_scope}
  省略 season 时返回 seasons，teams=[]。

GET /api/player-identity/lookup?season=…&team=…&jersey=…
→ {query:{season,team,jersey},
   status:no_match|unique_candidate|multiple_candidates,
   candidates:[{player_id,name,season,team_abbreviation,jersey_number,
                season_roster,
                rating:{record_id,game,season,status,ratings,field_provenance}}]}
```

- `rating.ratings` 固定提供上述 13 个键；缺失值保留 null。`rating.status` 区分 `complete`、`partial`、`missing_record`、`not_in_rating_scope`，使用数据包记录语义，不按面板 13 项重新判定完整性。
- `field_provenance` 为每项提供 `source_id`、`url`、`game`、`snapshot_date`、`date_basis`；无来源的字段保留空值，不把默认来源冒充缺失字段的来源。
- 名单按 `index.json` 的赛季、球队、文字号码精确查询，再按 record 索引读取所需 JSONL 行。姓名使用现有 player_id / 原姓名；不模糊猜名、不跨赛季借能力值。
- 球队选项覆盖已收录 472 人两季履历中的 30 队，不限季后赛球队，也不代表各队完整名单。`dataset_scope` 明示：“已收录球员的整季球队名单，含离队球员，不证明当场阵容；能力表限各季16支季后赛球队的筛选范围”。`no_match` 只表示当前资料包查无候选，不证明该队没有这名球员。
- `season_roster` 明示整季名单范围；能力快照球队 / 号码不能覆盖名单查询依据。

### 会话、撤销与导出

```javascript
entity.playerProfile = {
  schemaVersion: 1, status: 'confirmed', method: 'human_exact_roster_candidate',
  player_id, player_id_namespace: 'normalized_name_key',
  name, season, team_abbreviation, jersey_number, confirmedAt,
  season_roster: structuredClone(candidate.season_roster),
  evidence: {
    videoSha256, trackingFingerprint, variant, frame, sourceFrame, sourcePTS,
    trackId, visibility
  }
};
entity.ratingReference = structuredClone(candidate.rating);
```

- 证据记录确认当时真实的来源帧、PTS、版本和可见情况；不存在的轨道 / 坐标不造值。保留旧 `name/team/jersey/modelBindings/keyframes/anchors` 原样，不把模型轨道升级为人工身份。
- `player_id_namespace='normalized_name_key'` 明示 player_id 是数据包的归一化姓名键，不是官方 NBA 稳定 ID。`season_roster` 深拷贝候选原对象，保留实际名册 source_id、URL 与 phase 等同名字段，供回溯确认依据。
- 只有明确确认或清除资料进入现有 `change` / Undo；先验证再修改。相同 `player_id + season` 已在另一 ID 确认时拒绝，失败无会话变更、无 Undo。
- 首次确认建立 `session.gameContext.season`。另一 ID 已确认不同赛季时拒绝新赛季确认，需先清除旧资料；清除最后一份资料保留 gameContext.season，之后没有其他已确认资料时允许改赛季。
- 清除只移除所选 ID 的 `playerProfile/ratingReference`；不删除其人工姓名、队伍、号码、几何和关联。撤销恢复整个资料动作，刷新从原草稿键恢复。
- `exportPlayerIdentities` 包装已有导出结果，增加 `gameContext` 与完整十项 `playerIdentities:[{id,playerProfile|null,ratingReference|null}]`；原 `entities/frames` 内容原样保留。

## 文件与职责

| 文件 | 本轮职责 |
| --- | --- |
| `engineering/scripts/player_identity_data.py`（新增） | 精确名单查询、能力与逐字段来源映射，只读数据包 |
| `engineering/scripts/test_player_identity_data.py`（新增） | 查询、状态、来源与真实 API 回归 |
| `engineering/scripts/serve_player_review.py` | 接入两个 GET 路由、新 ESM 静态白名单，保持现有接口 |
| `engineering/tools/player-review/player-identity.mjs`（新增） | 面板、异步查询上下文、资料校验 / 确认 / 清除、导出包装 |
| `engineering/tools/player-review/player-identity.test.mjs`（新增） | 资料行为与迟返 / 撤销 / 兼容回归 |
| `engineering/tools/player-review/app.mjs` | 从现有选择状态挂接面板、change / Undo / 草稿与导出 |
| `engineering/tools/player-review/index.html`、`pipeline.css` | 折叠容器与紧凑布局，保留既有入口 |

## 实施任务

### Task 1：只读资料查询与 HTTP 接口

**Files:** 新增 `player_identity_data.py`、`test_player_identity_data.py`；最小修改 `serve_player_review.py`。

**Interfaces:** 消费现有数据包索引、名单、records 和 sources；产出上述 options / lookup JSON。所有 GET 仅查询，不修改资料包或会话。

- [x] 先写失败用例：省略赛季 teams 为空；两季履历球队选项覆盖 30 队；BOS 44 保留多个候选；DET `0` / `00` 不混合；查无候选但不声明完整名单；缺记录与不在能力范围区别；13 项 null 与逐字段来源准确；跨季不借值，整季名单边界明确。
- [x] 运行 RED：`tmp/player-identity-test/.venv/Scripts/python.exe -m unittest discover -s engineering/scripts -p "test_player_identity_data.py" -v`，记录实际失败原因。
- [x] 实现按索引读取的查询模块与两条 GET 路由；新增原生模块静态白名单，不改变现有 clip / 草稿指纹接口。
- [x] 同命令运行 GREEN；HTTP 用例检查实际 JSON、查询回显与状态，错误输入不导致数据写入。记录命令、数量和结果。22项新测试通过。

### Task 2：折叠面板、明确资料确认与导出

**Files:** 新增 `player-identity.mjs` / `.test.mjs`；最小修改 `app.mjs`、`index.html`、`pipeline.css`。

**Interfaces:** 消费当前 session / clip / 选中 ID、Task 1 的响应以及现有 `change` / Undo；产出 playerProfile、深拷贝 ratingReference 和 `exportPlayerIdentities` 包装结果。确认与清除明确报告成功 / 失败，失败不得进入 change。

- [x] 先写行为 RED：普通点框 / 选 ID 不确认；唯一候选仍需确认；多候选明确选择；duplicate / 跨季拒绝无 mutation 与 Undo；最后清除后可换季；资料确认不改旧字段、不升级轨道；缺坐标允许确认并提示核对。
- [x] 写异步与兼容 RED：选 ID / 改输入使候选失效，迟返与乱序不误绑；网络错保留原确认卡；season_roster / ratingReference 与候选不共享可变对象、名册来源字段与姓名键 namespace 保留；确认 / 清除可撤销、草稿可恢复；十 ID 导出缺值为 null，原 entities / frames 不变。
- [x] 在 `engineering/tools/player-review` 运行 RED：`node --test player-identity.test.mjs`，记录行为失败。
- [x] 实现独立模块与最小接线。使用既有来源帧 / PTS 选择逻辑，不修改 React 源或 bundle；折叠面板展示原值、四种状态和可展开来源。
- [x] 同命令运行 GREEN；运行 `npm test`、`node --check app.mjs`、`node --check player-identity.mjs`，记录数量与结果。17项新 / 144项全量通过，既有简版 / 自动编号及 bundle 字节保持。

### Task 3：实际运行、独立复核与交接

**Files:** 验证证据写入 `artifacts/player-identity-2k-20261002/`；仅在结果返回后更新工作台 README、research / 索引、status 与新 handoff。

**Interfaces:** 消费 Task 1 / 2 的冻结文件、测试日志和 before-preservation；产出实际 HTTP、浏览器、独立审查 / verifier 证据及最终交接，不修改数据与保护清单。

- [x] 检查真实 HTTP：options、单候选 / 多候选 / no_match、`0` / `00`、能力缺失状态；新增 ESM 返回 200、正确 MIME 与内容。17版clip完整字节保持，8静态资源200 / SHA一致。
- [x] 原生浏览器正常流程16项：选 ID 仅查看、查找 / 选择 / 确认 / 清除 / Undo / 刷新、重复与跨季拦截、无位置仍保留资料、能力 / 来源可读、旧人工号码保留。网络失败与迟返 / A→B→A保护由实际app可控HTTP harness验证，未在原生浏览器注入断网 / 迟返；QA未执行正式导出下载，wrapper由JS测试验证。
- [x] 比对 before-preservation：850 项保护数据不变；67 个 dirty 中只允许本任务 app / index / CSS / server / 文档的授权增量，其他 dirty 与所有备份字节不变。检查旧草稿字段、来源帧 / PTS、原模型 / 候选 / 2K 数据与 bundle 未被改写。
- [x] 运行全量 Python 回归：`tmp/player-identity-test/.venv/Scripts/python.exe -m unittest discover -s engineering/scripts -p "test_*.py"`；前端全量 `npm test`；语法与 `git diff --check`。实际102项Python / 144项JS通过。
- [x] 由独立 reviewer 按 Review Focus 审查冻结实现，verifier 复核 HTTP / 保护字节 / 浏览器证据；后端 / 前端Approve，整体核验通过。另417 / 17个独立断言不计入单测总数，不由实现者自行批准。
- [x] 根据实际验证结果更新 README / research / status / handoff，区分人工资料确认与轨道确认，明确整季名单和缺失能力边界；记录入口、操作步骤、准确测试数量、已知限制与冻结 SHA。保留未提交状态，不执行 Git 同步或发布。
- [x] 由另一代理完成本轮文档独立复核与写入后的最终保全，结论Approve；依据为[最终独立报告](../../../artifacts/player-identity-2k-20261002/final-independent-verification.md)与[验收JSON](../../../artifacts/player-identity-2k-20261002/independent-acceptance.json)。本次文档作者不自行批准。
