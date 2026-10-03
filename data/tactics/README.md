# 战术审核数据

此目录保存可共享的战术候选与来源说明；引擎、编辑界面和导出功能位于 `engineering/`。

- [005 三阶段候选](005-candidate/annotation.json)：THY 于 2026-10-02 形成的人工观察候选，2026-10-03 从工具的 fixtures 目录原字节迁入。它不是逐帧真值，人物、接地、标定和战术仍待人工核对。
- 生成适配器和复现步骤仍在 [战术工具](../../engineering/tools/tactical-overlay/fixtures/005-candidate/README.md)，通过来源哈希建立可审阅快照。
- 个人审核草稿由工作台保存到 `data/local-workbench/tactics/`，被 Git 忽略；需共享时先从界面导出审核 JSON，再按任务范围选择性入库。

本次整理依据：用户 2026-10-03 要求整合工作台、战术叠加和数据位置。未新增赛事官方要求或将候选升级为已确认结论。
