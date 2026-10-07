# NBA 2K 两季全联盟球队数据

版本2.0，更新于2026-10-07。已扩展为2024-25（NBA 2K25）与2025-26（NBA 2K26）各30队，按球队提供文件。共1151条球员赛季记录、687名球员、1316条球队赛季名单关联，另保留42条明确标记的交易关联。

从 [球队目录 TEAMS.md](TEAMS.md) 选择球队；每队有 players.csv 与 players.jsonl。CSV含该队号码、42项能力、两季球队号码履历和来源记录ID。跨队球员会在该季多队文件重复出现；球队文件不包含交易only关联。

| 赛季 | 球员赛季 | 有总评 | 36项个人能力齐全 | 部分个人能力 | 未取得评分 | 42项全齐 |
|---|---:|---:|---:|---:|---:|---:|
| 2024-25 | 569 | 539 | 539 | 0 | 30 | 539 |
| 2025-26 | 582 | 578 | 572 | 6 | 4 | 301 |

球队范围已补齐，能力仍有来源缺口。逐人缺口和逐字段统计见 [missing_ratings.json](missing_ratings.json)；null与CSV空字段表示未取得原值，不是0。complete只表示36项个人能力齐全，不能代表6项综合分类都有值。

旧包已有非空能力及其出处、身份、号码和交易信息均保留。新增范围使用固定同版历史CSV；2K26空值使用经核验历史HTML及固定Blacktop CURRENT个人属性。部分2K25空值由更早同版历史CSV及逐球员历史HTML补入，日期见逐字段出处。Blacktop派生cats不导入；不使用其他游戏版本填补。数据不是单一赛季最终补丁。

先读 [AGENTS.md](AGENTS.md) 与 [manifest.json](manifest.json)。程序仍可通过 index.json 的 by_player、by_record、by_team、by_jersey 查询，旧record_id保持兼容。by_team现有60个球队赛季键，qualifying_playoff_teams与球队布尔仍只表示实际入选的32个季后赛球队赛季。

号码是文本，0与00不同；CSV导入表格软件时应将team_jersey设为文本。JSONL保留准确字符串。snapshot只是来源评分快照标签，不能覆盖逐队赛季号码。履历排列不表示交易先后；交易关联不等于出场。

2KRatings、历史CSV、Blacktop/nba2kapi均为第三方评分整理，不是2K官方数据导出。NBA官网仅用于姓名身份或交易关联的佐证。
