# 赛事要求与来源资料

更新：2026-10-02，Asia/Shanghai。此目录保存官方要求的整理、来源快照和有日期的历史准备资料；软件实现与技术建议在[工程目录](../engineering/README.md)。

| 内容 | 入口 | 使用口径 |
|---|---|---|
| 9 月 28 日培训要求、评分与交付清单 | [赛事资料整理](BroadcastCode赛事资料整理.md) | 优先读取，转写疑点与团队建议单列；后续正式通知有变化时更新依据 |
| 9 月 17 日官网与报名资料 | [赛事与报名资料](archive/broadcast-code-12/赛事与报名资料.md)、[报名准备指南](archive/broadcast-code-12/报名准备指南.md) | 历史资料，不替代后续要求，不含个人报名材料 |
| 报名渠道核验及旧手册更正 | [渠道核验](archive/broadcast-code-12/expanded/报名渠道核验与更正.md) | 区分普通报名与其他推荐通道 |
| NBA 指标及其他赛事案例 | [扩展资料](archive/broadcast-code-12/expanded/扩展调研与团队讨论资料.md)、[NBA 图表核验](references/nba-china-xfg-chart.md) | 参考资料；其他赛事规则不能替代本届要求 |
| 原始来源 | [官网快照](archive/broadcast-code-12/official-page.md)、[来源索引](archive/broadcast-code-12/expanded/source-index.json) | 保留采集时原貌、URL 与日期 |
| 早期阅读手册 | [阅读版](archive/broadcast-code-12/Broadcast%20Code%2012%20黑客松赛事阅读手册.docx)、[讨论版](archive/broadcast-code-12/Broadcast%20Code%2012%20赛事理解与报名准备手册.docx) | 两个历史版本保留原字节，本轮未重新生成 |

Word 生成工具已移到 `scripts/requirements/`，依赖 `python-docx`。它们会写入本目录的对应手册，运行前应确认输出目的；本轮只修复路径和检查语法，没有运行生成器。渲染中间文件、个人报名材料及凭据继续排除。团队状态和仓库协作方式见[团队文档](../docs/status.md)。
