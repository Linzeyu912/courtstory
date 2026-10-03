# 交接：展示路线慢草稿与文字编辑竞态修复

- 日期 / 时区：2026-10-03 17:52，Asia/Shanghai。
- 成员：thy-0629。
- 基线：`40477f840cef994cae7b445be9649c8bae19b977`，main 本地修复，不推送。
- 状态：受影响验证通过，等待独立问题复核；Task3 尚未开始。

独立审阅发现：拖点已应用 presentation 后，慢 IndexedDB 写入期间编辑 title/notes 递增 revision，旧 post-draft guard 提前结束，model仍为来源路线。修复仅调整应用后的model同步条件：同文档、同上下文、同阶段且未加载时，从最新文档重建model，允许文字revision增加；编辑busy直到model就绪。校验前完整stamp以及换文档/加载/阶段防迟到保留。

真实 mount UI 回归先复现失败，再验证通过：慢草稿期间新讲解/标题、第一点修正、及时manual model均保留，切选P2再P1并拖第二点不会覆盖第一点。定向UI与编辑状态9项通过，JS语法和diff-check通过。使用说明补充在[编辑说明](../../engineering/docs/future-route-editor.md)。未触及旧未跟踪文件或其他任务规格/计划。
