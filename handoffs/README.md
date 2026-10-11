# 交接记录

每位成员和 Agent 在一次任务结束时记录可接续的信息，方便其他人在另一台电脑上继续工作。

找当前成果先看[成果与接续总览](../docs/work-index.md)，再回到对应原交接。交接中的“未提交”“本机已完成”是当时状态；代码已拉取也不代表作者的浏览器草稿、模型、视频或本机输出已共享。

## 文件命名

`handoffs/<github-login>/YYYY-MM-DD-HHMM-topic.md`

时间使用北京时间，并在文内注明 `Asia/Shanghai`。一个会话一份文件；同一天的不同任务用不同短名。复制 [_template.md](_template.md) 开始，保留与本次工作有关的栏目即可。

## 必须能回答

1. 谁负责哪个任务，Issue 和 main 上的提交在哪里？
2. 做出了什么，文件在哪里？
3. 哪些结论有来源或验证，哪些仍是推测？
4. 下一位成员接下来具体要做什么？
5. 是否有阻塞、未提交修改或尚未推送的内容？

交接写结论和必要上下文，不要求保存整段聊天。不要记录登录凭据或私人报名信息。

自 2026-09-29 起直接在 `main` 协作，交接使用提交哈希或链接作为成果入口。旧交接保留当时的分支与 PR 记录；当前操作以 [AGENTS.md](../AGENTS.md) 和[协作流程](../docs/workflow.md)为准。

## 最近的资料整理

| 记录 | 内容 |
|---|---|
| [Team Hub 历史去重与线性接续](Linzeyu912/2026-10-11-2127-teamhub-linear-history.md) | 保留 Team Hub 197 条原始提交，接续 26 条本地提交；移除独立 CourtStory 历史连接，23 条更新各一份；未推送 |
| [分类接续更新与 Single 成果展示](Linzeyu912/2026-10-11-2113-classified-history-single-showcase.md) | 23 条独立更新、来源对照、技术介绍附件移出当前版本、README 展示 Single；仅本地，未推送 |
| [Team Hub 接续 CourtStory 开发历史](Linzeyu912/2026-10-11-2055-teamhub-courtstory-continuation.md) | 主仓库地址不变，连接两段原始历史并采用最新成果，名称介绍统一为 CourtStory |
| [开发 commit 保留方式比较](Linzeyu912/2026-10-11-2039-commit-history-preservation-options.md) | 核对两仓独立历史，比较原仓保留、Git 备份、历史标签及筛选历史；仅方案，未实施 |
| [删除 THY 历史对照工作树](Linzeyu912/2026-10-11-2036-remove-thy-worktree.md) | 按用户要求移除同级 THY 目录及 Git 注册；旧提交保留，两个正式仓库不变 |
| [本机仓库与 THY 工作目录核对](Linzeyu912/2026-10-11-2035-local-repository-mapping-audit.md) | Team Hub / CourtStory 的本地与远端对应、CourtStory 落后 10 个提交、THY 历史 worktree 的来源与状态 |
| [UI 分支删除与 main 完整性复核](Linzeyu912/2026-10-10-1124-ui-main-recheck.md) | 全部 UI 与既有功能提交已包含；同步队友 d1192f2，784 项前端通过，原有未提交资料保全 |
| [TEAM 25 分类发布与旧分支清理](Linzeyu912/2026-10-10-1115-team25-publication.md) | 定稿与最新 main 整合、分类提交、验证、远端核对和本地恢复资料；当前发布入口 |
| [任务栏灰色图案定稿](Linzeyu912/2026-10-10-1103-freeze-header-pattern.md) | 用户确认当前图案及位置固定；规范、Agent 约定与 CSS 注释记录基准，实际渲染保持 |
| [TEAM 25 附近的斜向灰线](Linzeyu912/2026-10-10-1101-angled-header-line.md) | 右侧球场线顺时针倾斜 7°，保持连贯并避开队伍文字；仅本地 UI 分支 |
| [顶栏字标主次与连贯灰线](Linzeyu912/2026-10-10-1056-header-hierarchy.md) | 主品牌／队伍／LIVE DESK 为 32／30／24px，56px 黑栏保留留白；灰色背景缩小、取消右侧截断 |
| [TEAM 25 深蓝队伍字标](Linzeyu912/2026-10-10-1044-team25-header.md) | 白色 TEAM、深蓝 25，等大粗斜体、无底色，置于顶栏右侧；仅本地 UI 分支 |
| [UI 与 main 同步状态核对](Linzeyu912/2026-10-10-0833-ui-main-sync-check.md) | 2026-10-10 实查两条远端分支及本地引用均为 c443d9e，已提交内容一致；本次核对记录仅保留本地 |
| [官方训练片打标与工作台接入](Linzeyu912/2026-10-05-2318-official-training-ingestion.md) | 两段 1080p 原片、10 维场景标签、2662 帧自动候选及远端 LFS 下载校验 |
| [六类提交与发布记录](Linzeyu912/2026-10-05-2250-classified-publication.md) | 全部现有本地成果按主题提交，main 推送、证据与视频检查范围 |
| [拉取合作者更新与成果总览](Linzeyu912/2026-10-05-2231-collaborator-sync-and-index.md) | 远端两条提交已合入、双方改动保留，研究与作品接续入口统一 |
| [四类目录整理](Linzeyu912/2026-10-05-2220-repository-content-separation.md) | 调研、赛事要求、环境准备与作品分目录，旧路径与验证范围 |
| [THY：005 V2 视觉基准](thy-0629/2026-10-05-2107-approved-005-workflow.md) | 配置、脚本、制作步骤与历史审查已归档；不含 MP4 |
| [THY：导入视频进度与更正](thy-0629/2026-10-05-1910-agent-court-tactics-progress.md) | 身份续接、投篮判断更正、球场与草稿保存缺口 |
| [chuali-zi：Qwen 首版](chuali-zi/2026-10-05-0651-qwen-ground-trajectory-implementation.md) | 多轮轨迹修正代码与本地待验收项 |
| [chuali-zi：2D 主工作流](chuali-zi/2026-10-05-0127-2d-first-tactics-workbench.md) | 身份 / 2D 准备、绘制和成片契约及验证边界 |
| [仓库审阅与选择性同步](Linzeyu912/2026-10-01-2118-repository-audit-sync.md) | 当前目录入口、检查结果、云端同步和本地开发边界 |
| [删除首批独立旧包](Linzeyu912/2026-10-01-2111-remove-first-batch-duplicates.md) | 只保留100段集合，001–003不删除 |
| [视频按赛季归并](Linzeyu912/2026-10-01-2104-video-season-organization.md) | 2024–25和2025–26目录归并过程 |

当前成果从[仓库目录说明](../docs/repository-map.md)查找；历史记录中的旧路径、当时未提交状态按记录时间理解。
