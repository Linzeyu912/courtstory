# CourtStory：在 Team Hub 接续成果更新与开发历史

- 日期 / 时区：2026-10-11，Asia/Singapore（UTC+8）。
- 用户决定：继续使用原 Team Hub 仓库作为主仓库，成果整理后的更新按不同 commit 接续，26 条接续提交已发布至 `082d61c`。用户随后将开发主仓库正式改名为 CourtStory，原成果仓库改名为 CourtStory Snapshot；此前暂不更名的安排已被替代。
- 开发主仓库：[Linzeyu912/courtstory](https://github.com/Linzeyu912/courtstory)；比赛成果快照：[Linzeyu912/courtstory-snapshot](https://github.com/Linzeyu912/courtstory-snapshot)。
- 两个仓库使用相同的产品简介；快照的用途由仓库名与 README 说明。用户取消上轮快照标签，相关提交仍保留。改名与标签处理见[本轮交接](../handoffs/Linzeyu912/2026-10-11-2337-repository-rename.md)。

## 历史如何接续

1. Team Hub `56e6466057c0560701d3163d2dbd1384e59249d2` 的 197 条原始提交保留。
2. 以 CourtStory `38e47e0` 为成果整理基线，对齐运行布局与测试夹具；该基线已补齐 Team Hub `56e6466` 的功能。Team Hub 873 个额外研发支持文件保留。
3. 基线之后的 23 条功能、修复、素材与文档更新分别接到 main，每条提交通过 `cherry picked from commit` 记录原始来源；逐条对应见[提交对照表](repository-update-history-20261011.md)。
4. 用户明确要求避免重复：CourtStory 截至 `c914c14` 的 31 条原始提交保留在原仓库和恢复包，不再合入 Team Hub main。23 条接续更新各自保留来源编号，原始作者保持，当前历史中每项更新只接续一次。
5. 技术亮点介绍的 `05b6f27`、`5fbd546` 不接入当前 main；README 以 Single 最终成片作为唯一成果视频展示入口。
6. 接续完成时 main 共 223 条提交：原有 197 条 + 成果基线 1 条 + 更新 23 条 + README 1 条 + 协作配置／记录 1 条。本次发布再补 1 条记录后共 224 条；新增部分是顺序接续，不包含独立成果仓库的第二条历史线。

上轮本地 `f0435be`、`4b5e417` 整合均未发布，已保存在完整 Git bundle 中。本轮从 main 移除连接 CourtStory 全部历史的 `d2af47f`，保留此前的成果基线与 23 条接续提交，重放其后的 README 与协作记录；业务代码和成片保持。只调整未发布的本地历史，不改写 Team Hub 或 CourtStory 已共享的历史，不 force push。

## 当前文件与展示

- 工作台、服务、Agent、云端工程、球员数据、考试素材和交付成片与 CourtStory `c914c14` 一致；本轮没有重新实现功能或改变模型策略。
- Team Hub 的研究、赛事、环境、工程说明和历次交接保留。旧记录中的名称、状态与素材数量仍表示当时情况；当前入口以根 README 为准。
- [Single 最终成片](../deliverables/single.mp4)通过 Git LFS 保存；根 README 说明其球员标记、战术路线、中文解说、字幕与出手定格效果。交付字幕保留在 `deliverables/`，输入素材保留在活动视频库，供工作台使用。
- 当前不保留独立技术亮点 HTML、配套图片和短视频；本机同主题草稿及附件已备份，来源仓库保留其原始 Git 历史。
- 统一新提交署名继续生效；Team Hub 固定历史基线保留原署名，见[署名说明](git-identity.md)。

## 本地与远端

- 主工作目录继续使用原 Team Hub checkout，origin 改为 `https://github.com/Linzeyu912/courtstory.git`；原成果 checkout 的 origin 改为 `https://github.com/Linzeyu912/courtstory-snapshot.git`。
- 后续开发直接在主仓库 main 继续；比赛快照留在独立仓库，两个仓库均保留私有属性。当前改名只更新名称、简介、Git 关联和文档，不改变已共享的开发历史。
- 21:05 核验远端 main 为 `56e6466`，简介仍为原 Team Hub 文案；此前中断的推送已上传两个 LFS 对象（约 173 MB），但 Git 提交未发布。这是上轮事实，不代表本轮已同步。
- 完整性证据与备份入口见[去重交接](../handoffs/Linzeyu912/2026-10-11-2127-teamhub-linear-history.md)；21:43 的成功推送及最终同步核对见[发布交接](../handoffs/Linzeyu912/2026-10-11-2144-teamhub-courtstory-publication.md)。

## 备份与验证

- 本轮去重前完整备份为本机忽略目录 `artifacts/repository-history-dedup-20261011/before-dedup.bundle`；此前 `artifacts/repository-history-20261011/before-split.bundle`、未提交文件、技术介绍附件和来源 LFS 缓存继续保留。
- 在干净的本地主目录 main 调整未发布的历史，无新任务分支或 PR；生成仅包含当前 main 的 bundle 并在新克隆中核验。
- 检查 Team Hub 197 条原始提交全部保留、CourtStory 原始 31 条不属于 main 祖先、23 条接续补丁各出现一次，以及核心文件、视频字节、署名检查与文档链接。
- 前轮同一核心快照已通过 827 项前端测试和相关后端检查；本轮核心代码内容不变，验证重点为历史与展示文件。本轮不部署云端、不重启线上服务、不调用收费模型。

来源读取日期：2026-10-11。依据为用户本聊天指示、两个仓库 Git 对象及[初次成果导入](product-import.md)、[功能补齐记录](feature-sync-20261010.md)。
