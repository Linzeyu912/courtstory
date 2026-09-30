# 调研索引

## 最新专题

| 文件 | 日期 | 结论 |
|---|---|---|
| [NBA 中国预期命中率图表核验](nba-china-xfg-chart.md) | 2026-09-30 | 已找到深度赛场入口，复现总决赛 G1 图表；记录横轴、纵向堆叠及追踪样本与普通统计的差异 |
| [TypeSafe Jev 地区可用性](jev-regional-availability.md) | 2026-09-28 | 珠海与澳门的支持状态仍需厂商确认及实测；附官方依据和验证步骤 |

## 历史资料

此前资料集中在 `broadcast-code-12/`，主要采集日期为 **2026-09-17**。最新培训信息和参考视频见根目录的[赛事资料整理](../BroadcastCode赛事资料整理.md)。

| 文件 | 内容 |
|---|---|
| [赛事与报名资料](broadcast-code-12/赛事与报名资料.md) | 官网要求、赛程、报名字段及当时的待确认项 |
| [报名准备指南](broadcast-code-12/报名准备指南.md) | 个人介绍、经历、团队证据的准备建议 |
| [报名渠道核验与更正](broadcast-code-12/expanded/报名渠道核验与更正.md) | 普通报名与 BSU 推荐通道差异、旧手册更正 |
| [扩展调研与团队讨论资料](broadcast-code-12/expanded/扩展调研与团队讨论资料.md) | NBA 官方指标、其他黑客松案例与讨论问题 |
| [来源索引](broadcast-code-12/expanded/source-index.json) | 来源 URL、日期和读取状态 |
| [官网原文快照](broadcast-code-12/official-page.md) | 采集时的官网文字 |
| [赛事阅读手册](broadcast-code-12/Broadcast%20Code%2012%20黑客松赛事阅读手册.docx) | 早期 Word 阅读版 |
| [赛事理解与报名准备手册](broadcast-code-12/Broadcast%20Code%2012%20赛事理解与报名准备手册.docx) | 整合后的 Word 讨论版 |

`build_doc.py` 和 `build_integrated.py` 为已有文档生成脚本，依赖 `python-docx`。生成脚本可能覆盖对应 Word 文件，修改前先确认目标。`official-snapshot.json`、`research-log.json` 与 `expanded/channel-page.html` 保留来源采集记录。

本地 `qa/`、`qa-integrated/` 是文档渲染和排版检查的中间输出，不加入 Git；最终 Word 手册和可编辑的 Markdown 源文件均保留。旧文档不因归档就代表最新赛事规则，先看时间与来源。
