# 交接：本机两个仓库与 THY 历史工作目录核对

- 日期 / 时区：2026-10-11 20:35，Asia/Singapore（UTC+8）。
- 成员：Linzeyu912。
- 任务 / Issue：用户要求检查 Team Hub、CourtStory 的本地目录与远端对应关系，并解释 THY 文件夹用途；两个仓库的开放 Issue 查询均为空。
- 分支：Team Hub 与 CourtStory 均为 main；THY 参考工作目录为 detached HEAD。
- 提交：本轮记录仅本地，未提交、未推送。
- 状态：路径、Git 关联、远端提交与历史用途核对完成。

## 本次完成

- 检查本机同一父目录下的 `HKS/`、`courtstory/`、`HKS-thy-20261002/`。这三个名称是本机布局，其他成员不必沿用；本文使用相对位置，不依赖本机盘符。
- 核对 Git remote、main 上游、工作树注册、实际 Git 元数据位置、工作区状态及 GitHub main 提交。
- 对 CourtStory 执行 `git fetch --no-tags origin`，更新远端引用并计算差异；未推进本地 main 或改写检出文件。

## 结论与依据

| 本机目录（以共同父目录为参照） | GitHub 仓库 | 当前身份及结果 |
| --- | --- | --- |
| `HKS/` | [broadcastcode-team-hub](https://github.com/Linzeyu912/broadcastcode-team-hub) | 独立仓库的主工作目录，main 跟踪 origin/main；本地、缓存引用和实查远端均为 `56e6466057c0560701d3163d2dbd1384e59249d2` |
| `courtstory/` | [courtstory](https://github.com/Linzeyu912/courtstory) | 另一个独立仓库，main 跟踪 origin/main；本地为 `769dca11ae7f56a451ce70f7da76bd1cfa3ca6fd`，远端为 `c914c145f5ea355482ae294d72ce6e8afa84ad35`，本地领先 0、落后 10 个提交 |
| `HKS-thy-20261002/` | 同一个 Team Hub 仓库 | 附加 Git worktree；共享 `HKS/.git`，固定在 `1839dcde5b5cc0aa362baa474e58e5b530e6c695`，没有检出的命名分支 |

- 两个正式仓库的 fetch / push 地址均对应各自仓库，没有互相指错。它们各有独立 `.git` 目录，分别维护提交与同步。
- CourtStory 本地已有工程、配置、数据、文档与维护脚本；Team Hub 中 10 月 7 日“仅有 README”的记录属于历史时点，不能代表当前状态。
- THY 目录中的 `.git` 是指向 Team Hub 工作树管理目录的文本文件。其用途由[10 月 2 日隔离交接](2026-10-02-2203-thy-isolated-comparison.md)及[原比较方案](../../engineering/docs/plans/2026-10-02-thy-comparison.md)直接确认：保留队友 THY 已发布版本原貌，与当时用户版本分开比较。
- THY 提交已是当前 Team Hub main 的祖先；`HEAD...main` 的独有提交计数为 `0 / 160`。它不是队友后续更新的自动同步目录，也不是第三个独立仓库。
- 来源采集日期均为 2026-10-11：本机 Git 状态、GitHub refs 和上述已提交历史记录。未据此核验云端部署或赛事绑定状态。

## 验证

- 两仓库 `git ls-remote --symref origin HEAD refs/heads/main` 成功；默认分支均为 main。
- CourtStory fetch 成功；`git rev-list --left-right --count HEAD...origin/main` 返回 `0 10`，其工作区干净。
- THY `git status --porcelain=v1 --untracked-files=all` 为空；忽略文件枚举计数为 0；祖先关系检查退出码为 0。
- THY 的 Git LFS 文件抽查仍为指针，与原历史对照用途一致；本轮未下载视频、安装依赖或启动该工作台。
- 三个目录均为普通磁盘目录，未显示符号链接或目录联接属性；THY 的关联由 Git worktree 管理。
- Team Hub 开工时存在三个其他任务未跟踪入口，保持原状：`engineering/docs/finals-presentation-intro-20261010.md`、`engineering/docs/images/tech-highlights-20261010/`、`engineering/docs/tech-highlights-20261010.html`。
- 本轮只增加本文与交接索引入口，检查相对文档链接和差异空白；没有产品代码变更，无需产品测试。

## 阻塞与待确认

- 检查无阻塞。CourtStory 的正确远端关联不代表检出内容已更新；这 10 个提交尚未合入本地 main。

## 下一步

- 后续继续 CourtStory 开发前，重新确认工作区及远端状态，再按任务需要同步 main。
- THY 目录保留为历史比较样本；如以后整理本机工作树，使用 Git worktree 流程处理，本轮未删除。

## 同步状态

- Team Hub 本地 main 与本轮实查远端一致；原有未跟踪资料及本文仍在本地。
- CourtStory 仅更新 origin/main 引用，本地 main 保持 `769dca1`，落后已核对的远端 `c914c14` 10 个提交。
- 未更改 remote、分支配置或现有源码，未提交、推送、删除工作树或部署。
