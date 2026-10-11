# 交接：开发主仓库改名为 CourtStory

- 日期 / 时区：2026-10-11 23:37 起，Asia/Singapore（UTC+8）。
- 成员：Linzeyu912。
- 任务 / Issue：用户明确要求原 Team Hub 改名为 CourtStory，比赛成果仓库改为 CourtStory Snapshot，取消上轮快照标签，两个仓库简介一致；读取时两个仓库开放 Issue 均为空。
- 分支：main。
- 提交：本记录随本轮文档与链接修正提交，另一个仓库独立记录其留档维护提交。
- 状态：两个仓库改名、简介统一、remote 更新和快照标签删除均已完成；文档验证通过，随本次提交同步。

## 本次范围

| 仓库身份 | 原名称 | 新名称 | 改名前 main |
| --- | --- | --- | --- |
| 持续开发主仓库 | broadcastcode-team-hub | [courtstory](https://github.com/Linzeyu912/courtstory) | `aacf686d3c6ff5ca3bbe06e23c1b45700403f8d8` |
| 比赛提交快照 | courtstory | [courtstory-snapshot](https://github.com/Linzeyu912/courtstory-snapshot) | `7fddf825679149fe134f80787a2971a06f55ad18` |

- 先让快照仓库使用新名称，再让开发主仓库使用 CourtStory，分别更新现有 checkout 的 origin。
- 两个 GitHub 简介统一为：CourtStory：由篮球观众打造的 AI 战术可视化与讲解工作台，支持球员标定、解说、战术绘制与成片。
- 按用户要求删除快照仓库本地及远端 `competition-snapshot-20261011` 标签；对应提交继续留在该仓库 main 历史中。
- 主仓库 README、协作流程、Agent 约定、状态和决策记录更新为新入口。历史 Markdown 只修正指向原仓库的 URL，保留当时名称文字及结论；旧 CourtStory 的来源链接现在指向快照仓库，避免误指向接用名称的开发主仓库。
- 原始研究来源快照保留采集时的原文，不改变业务代码、数据、视频或已共享提交；两个仓库仍为私有。

## 来源与验证

- 来源：用户本聊天、两个仓库 Git 对象和 GitHub API，读取日期 2026-10-11。
- 改名前两个工作区均干净，fetch 后本地 main 与远端一致。
- GitHub API 确认开发主仓库仍为 `R_kgDOUwPpWQ`，快照仓库仍为 `R_kgDOU-8Erg`；名称分别为 `courtstory`、`courtstory-snapshot`，两者简介完全一致且仍为私有。
- 两个 checkout 的 origin 已分别指向新地址；改名后 `ls-remote` 返回的 main 与上表基线完全一致，没有交换、重写或丢失原历史。
- 快照标签已从远端与本地删除；再次查询远端与本地标签均不存在，原 `7fddf82` 提交仍是快照 main 的祖先。
- 主仓库改动仅含 96 个 Markdown 文件；其中 89 个文件经逐字比较，变化仅为正确映射原仓库 URL。剩余为当前入口与状态说明、本交接。80 个当前入口或新增相对链接目标存在，差异与署名检查通过。
- 快照仓库改动仅含 8 个 Markdown 文件；68 个当前入口或新增相对链接目标存在。工程代码、数据及视频对象没有变化。
- 不涉及云部署、作品重新提交或业务功能调整。

## 阻塞与下一步

- 无。后续开发在 `courtstory` 的 main 继续；比赛快照只接受用户明确要求的留档维护。
- 其他电脑的开发 checkout 将 origin 改为 `https://github.com/Linzeyu912/courtstory.git`，快照 checkout 改为 `https://github.com/Linzeyu912/courtstory-snapshot.git`。

## 同步状态

- 本记录随当前 main 文档提交推送；最终两个仓库的远端提交、简介及标签核对结果在任务完成时报告。
