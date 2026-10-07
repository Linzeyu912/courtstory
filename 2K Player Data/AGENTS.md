# NBA 2K Player Data — Agent reading guide

版本2.0：两季各30队的整个赛季名单。先读manifest.json；按index定位JSONL行，不默认加载整包。JSON/JSONL为UTF-8无BOM，行号从1开始；球队CSV为UTF-8 BOM便于Excel中文导入。

## 查询

- 按球队：打开TEAMS.md或index.team_files；by_team["2025-26|GSW"]返回该队整季名单record_id，含赛季中离队球员，排除交易only。
- 按球员：规范化英文姓名后查by_player（值始终为数组），再查players[player_id].seasons与by_record定位文件/行。
- 按号码：by_jersey["2024-25|DET|00"]，必须传文本，结果不保证身份唯一。
- 两季履历：history_by_player定位team_history.jsonl。phase与association_kind区分名单/交易/休赛期。
- 逐指标来源：field_provenance.json.records[record_id]；优先field_source_ids[field]，仅baseline_fields中的项可用default_source_id。null无数值出处。sources保存同版、日期与date_basis，不能混称单一快照。
- 缺口：missing_ratings.json列逐人/逐项null。complete只代表36个人能力齐全，全部字段共42项。

## 必须保留的口径

1. null是未知，不是0；不跨游戏版填空，不推算综合分类。Blacktop cats是派生均值，禁止导入cat_*。
2. 号码为字符串，0与00不同；00, 0原样保留，分拆不表示先后。CSV须将号码列按文本导入。
3. snapshot.team/jersey保留源标签，不覆盖真实赛季名单。杜兰特来源号码35与HOU名单号码7的差异仍保留。
4. 旧非空评分及出处、身份、号码、交易信息保留；旧null可按审定同版历史来源补入，changes逐格记录。部分2K25补值源于2024年10月同版CSV及逐球员历史HTML；不代表赛季末能力。
5. 仅规范化精确姓名或已审定显式别名；不模糊合并，不编中文名。player_id保持旧键，BBR编号无证据仍null。
6. snapshot、identity.join_method及原rating_source_*只说明baseline来源；supplement_matches说明补值连接；mixed_field_sources不能标成同一日期。
7. 球队文件按名单分组，跨队球员重复是预期。交易only关联保留在履历，不能据此认定出场。
8. in_rating_scope使用2.0全队范围；baseline_in_rating_scope保留旧1.1布尔，新履历为null。not_in_rating_scope表示所用名单该季无记录，不同于existing missing_record（有名单无评分）。

## 最小查询

```python
import json
from itertools import islice
from pathlib import Path
root = Path("2K Player Data")
index = json.loads((root / "index.json").read_text(encoding="utf-8"))
rid = index["players"]["name:stephencurry"]["seasons"]["2025-26"]["record_id"]
location = index["by_record"][rid]
with (root / location["path"]).open(encoding="utf-8") as handle:
    record = json.loads(next(islice(handle, location["line"] - 1, None)))
print(record["ratings"]["three_point_shot"])
```

来源性质：2KRatings、历史CSV、Blacktop/nba2kapi均为第三方评分整理，不是2K官方数据导出。NBA官网仅用于身份或交易佐证，不能据此把评分来源称为官方。
