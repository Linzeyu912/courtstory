# 仓库决策与协作

这里管理 CourtStory 主仓库的决定、状态和协作方式。产品介绍在 [engineering/README.md](../engineering/README.md)，产品操作、设计与验收说明在 [engineering/docs/](../engineering/docs/README.md)；调研正文在 [research/](../research/README.md)，数据说明在 [data/](../data/README.md)。

## 决定、状态与交接的分工

| 你要记录或查找的内容 | 入口 | 记录原则 |
| --- | --- | --- |
| 已确认采用的选择及其依据 | [decisions.md](decisions.md) | 标明日期、决定、来源与范围；讨论中的方案不能写为已采用 |
| 当前进展、已完成事项与阻塞 | [status.md](status.md) | 最新记录在前；旧条目保留当时状态 |
| 每轮具体修改、验证和下一步 | [handoffs/](../handoffs/README.md) | 一次任务一份独立记录，当前状态通过链接引用 |
| 产品功能设计或技术方案 | [产品文档](../engineering/docs/README.md) | 实现细节、接口和验收随工程保存，必要的采用决定回链到本目录 |

## 仓库协作入口

| 内容 | 入口 |
| --- | --- |
| 内容分类、目录关系与放置规则 | [repository-map.md](repository-map.md) |
| main 同步、选择性提交与冲突处理 | [workflow.md](workflow.md) |
| 成员和职责记录 | [team.md](team.md) |
| 新提交署名与本机初始化 | [git-identity.md](git-identity.md) |
| 共享视频、LFS 与本地素材边界 | [video-data-management.md](video-data-management.md) |

## 历史与来源

- [成果与接续索引](work-index.md)：按专题回溯研究、实现和验证记录，条目按记录日期理解。
- [Team Hub 历史接续](repository-continuation-20261011.md)、[逐项提交对照](repository-update-history-20261011.md)：主仓库与比赛快照的历史关系。
- [原成果导入记录](product-import.md)、[2026-10-10 功能补齐记录](feature-sync-20261010.md)：保留原独立成果仓库建立时的事实，当前仓库入口以[根 README](../README.md)为准。
- [目录迁移记录](repository-migrations/)：定位过去的文件路径；迁移不等于实现新功能。

新增决定和仓库协作规范留在此处；论文、数据、官方要求、产品使用和云端操作分别回到相应目录，避免一份文档同时承担不同职责。
