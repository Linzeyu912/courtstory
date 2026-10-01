# NBA 2K Player Data — Agent reading guide

这是现有本地数据的结构转换包。先读 `manifest.json` 与本指南，再通过程序查找或 `rg` 查询 `index.json`，按索引定位需要的 JSONL 行。不要把整个索引输出到对话上下文，也不要默认整包加载。清单与本指南可全文阅读。所有路径相对于本目录，JSONL 行号从 1 开始；编码为 UTF-8 无 BOM。

## 常用查询

- 查球员：按 `index.name_normalization` 规范化英文姓名，在 `by_player` 找到候选 player_id。值总是数组，不能假定唯一。
- 查能力：在 `index.players[player_id].seasons[season]` 获取 record_id，再按 `by_record` 的文件和行号读取。`not_in_rating_scope` 表示该季不在能力表范围；已有记录的 `availability.status=missing_record` 才表示有名单记录但缺评分。
- 查球队：`by_team["2024-25|GSW"]` 返回该季符合筛选范围的球员记录。该口径包括赛季中离队球员。
- 查号码：`by_jersey["2024-25|DET|00"]` 返回所有匹配 player_id，不保证号码唯一。查询值必须为文本。
- 查两季球队经历：使用 `history_by_player[player_id]`，其中包含非季后赛球队和单独标记的官方交易关联。
- 理解字段与来源：按需读 `schema.json`、`sources.json`；通过 `source_id`/`*_text_id` 解析 URL 与原始说明。姓名别名和未匹配审计保存在 `audits.json`。
- 查每项能力出处：按 `provenance.rating_fields_ref` 在 `field_provenance.json.records[record_id]` 查找。补入字段用 `field_source_ids[field]`；原有字段仅在 `baseline_fields` 中时使用 `default_source_id`。来源 URL、游戏版与 `snapshot_date`/`date_basis` 均可解析。

## 必须保留的数据口径

1. 能力 null 表示未知，不是 0。不得用另一季或当前网页的值填补。
2. 号码为字符串：`0` 与 `00` 不同；`00, 0` 原样保留，`jersey_numbers` 仅为分拆索引，不表示先后。
3. `snapshot.team` / `snapshot.jersey` 是评分快照标签，不能覆盖真实赛季名单。杜兰特 2K26 来源快照号码为35，HOU赛季名单为7；原始差异已保留。
4. `association_kind`、`phase` 区分赛季名单、交易关联及休赛期。交易关联不证明出场，未知号码保持null。队伍排列不代表转队先后，交易追踪页日期不是完整到离队时间。
5. 能力表范围是两季各16支正式季后赛球队的整季名单，包括季中离队球员，不是季后赛实际出场名单。
6. 2K25原记录保持不变。2K26原有非空值保留早期混合历史来源；仅原null补入真实2K26历史页面或固定2026-08-08、07-21、05-28第三方快照。补采字段逐项标来源和时间；仓库同步/提交日不等于逐页抓取日或游戏补丁日。
7. player_id沿用上游精确规范化姓名键；BBR稳定编号未取得。仅使用已审定别名，不做模糊匹配或编造中文球员名。
8. `snapshot`、原始 `rating_source_*` 与 `identity.join_method` 只描述保留的原来源，不代表整条补采记录。`mixed_field_sources` 记录不得宣称单一快照；各游戏补丁日期未知。
9. Blacktop `cats` 是派生均值，未导入六个 `cat_*`。综合分类只从真实HTML原始显示值补入，找不到则null。`complete`仅表示36个人能力齐全，不能据此推断42项全有值。

## Python 标准库最小读取示例

```python
import json
from itertools import islice
from pathlib import Path

root = Path("2K Player Data")  # 从仓库根目录运行
index = json.loads((root / "index.json").read_text(encoding="utf-8"))
player_id = index["by_player"]["stephencurry"][0]
slot = index["players"][player_id]["seasons"]["2024-25"]
if slot["record_id"] is not None:
    location = index["by_record"][slot["record_id"]]
    with (root / location["path"]).open(encoding="utf-8") as handle:
        record = json.loads(next(islice(handle, location["line"] - 1, None)))
    print(record["ratings"]["three_point_shot"])
```

此示例只读取目标JSONL行，不需要第三方库。完整来源限制及覆盖数字见 `sources.json.upstream_metadata`。
