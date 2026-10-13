# CourtStory 协作流程

> 2026-10-11 当前入口：原 Team Hub 开发主仓库正式使用 [Linzeyu912/courtstory](https://github.com/Linzeyu912/courtstory)，比赛提交快照使用 [Linzeyu912/courtstory-snapshot](https://github.com/Linzeyu912/courtstory-snapshot)。后续工作在开发主仓库 main 继续，不新建分支或 PR。改名范围与验证见[本轮交接](../handoffs/Linzeyu912/2026-10-11-2337-repository-rename.md)。

2026-10-10 UI 收敛更新：用户授权将 TEAM 25 等现有 UI 成果分类提交并推送 main，在确认成果完整保留后删除无用的旧 UI 分支。此前要求继续原 UI 分支的阶段约定不再作为接续入口；本轮保存旧工作区恢复资料并保留其他任务未提交内容。具体范围与结果见[TEAM 25 发布记录](../engineering/docs/ui-team25-publication-20261010.md)，后续工作遵循最新 [AGENTS.md](../AGENTS.md)。此次授权不包含云部署。

自 2026-09-29 起，所有成员和 Agent 的开发工作都直接在 `main` 上进行，不新建任务分支，也不使用 PR 合并流程。依据见[决策 D004](decisions.md#d004所有内容直接在-main-上改进)。

2026-10-13 管理约定：是否编辑、提交、推送或部署，按**当前任务**的用户授权执行。“只读”“先不提交”“先不推送”等明确限制优先；旧任务的发布授权不作为以后任务的永久授权。已有覆盖当前操作的授权时继续执行，不反复要求确认。下文命令是对应阶段的操作方法，不代表每次任务都应执行全部阶段。

## 1. 每位队员首次使用

接受私有仓库邀请，在自己的电脑上安装 Git，并使用自己的 GitHub 账号完成认证。然后执行：

```sh
git clone https://github.com/Linzeyu912/courtstory.git courtstory
cd courtstory
```

将这个目录交给自己的 Agent 打开。先读 `AGENTS.md` 和 `docs/status.md`；新提交署名按 [统一身份说明](git-identity.md) 配置；GitHub 登录仍使用各人的凭据。

本地目录名不必与 GitHub 仓库同名；原 Team Hub 工作目录可继续使用，将其 origin 更新为 `https://github.com/Linzeyu912/courtstory.git`。原独立成果仓库的 checkout 应改用 `https://github.com/Linzeyu912/courtstory-snapshot.git`；不要把它推送到已由开发主仓库使用的旧地址。具体变更结果见[接续记录](repository-continuation-20261011.md)。

## 2. 开工前同步 main

先阅读当前任务要求、`AGENTS.md`、状态与相关交接，检查分支、未提交修改和远端关联；只读任务保持只读。进入开发同步时，如果有未提交工作，先确认归属并妥善保存，不能覆盖、丢弃或顺手提交他人的工作。工作区安全后执行：

```sh
git status
git switch main
git pull --ff-only origin main
```

确认当前分支为 `main` 后再开始编辑。以已有 GitHub Issue 的负责人和最新讨论核对任务范围，结合当前用户指示确定涉及的文件或模块；需要创建或更新 Issue 时按该操作的授权执行。若 `pull --ff-only` 因本地与远端各有新提交而失败，按第 5 节处理；不要创建分支或重置工作区。无法读取远端时说明本地资料时点，不声称已经同步。

## 3. 工作中留下可同步产出

- 新发现：写入对应主题文档，保留来源和日期。
- 方案结论：写明选择及原因；团队已确认的结论汇总到 `docs/decisions.md`。
- 任务状态：更新任务相关的状态记录；在已授权的 Issue 流程中同步对应讨论，尚未确认的内容标为待确认。
- 每次收工：按模板创建 `handoffs/<your-login>/YYYY-MM-DD-HHMM-topic.md`。

Markdown 作为主要协作格式，共享文本使用 UTF-8，新增或编辑的文字优先使用 LF。保留已有文件的格式合同，按 `.gitattributes` 处理明确规定的文件；不为格式统一批量改写无关文件。Word 手册用于阅读和分享，尽量由一人根据 Markdown 统一生成，避免多人同时修改二进制文件。

## 4. 在 main 按授权提交与发布

### 区分四种操作

| 操作 | 实际结果 | 授权与报告边界 |
| --- | --- | --- |
| `git commit` | 在本地 main 创建提交 | 按当前任务的提交授权执行；不能称为已经发布到 GitHub |
| `git push origin main` | 更新 GitHub 的 main 引用及 Git 对象 | 按当前任务的推送授权执行；核对远端后再报告同步成功 |
| Git LFS 对象上传 | 上传视频等大文件字节 | 与选定提交所需媒体一起核对；对象上传成功不等于 Git 提交已推送或网页已可播放 |
| AWS 部署 / 更新运行服务 | 改变实际云端资源或服务版本 | 需要覆盖部署操作的当前授权；仓库提交、GitHub 推送不等于 AWS 部署 |

用户仅要求检查或整理时，不能据旧任务的推送记录自动发布。用户已授权当前任务提交和推送时，完成相关检查后继续执行，不重复询问。若用户明确“先不提交”或“先不推送”，分别停在对应阶段之前，报告实际完成位置。

### 提交主题与格式

提交消息沿用 `type: English summary`，`type` 使用 `feat`、`fix`、`docs`、`refactor`、`test` 或 `chore`。英文摘要说明实际变更，例如 `fix: unblock video trimming`、`docs: separate repository guide from product documentation`。

每条提交只包含一个能独立说明和验证的主题。同一主题的实现、回归测试和必要文档一起提交；按独立目的拆分，不按文件数量机械拆分，也不把其他任务的修改带入。交接记录写明验证范围及仍未解决的问题。

### 创建本地提交

在当前任务已授权提交时，先检查差异与验证结果，只暂存相关文件，并保持既定主署名：Author / Committer 均为 `ZeYu.Lin <Linzeyu912@gmail.com>`，细节见[统一署名要求](git-identity.md)。

```sh
git diff
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
git add path/to/changed-file.md handoffs/your-login/your-handoff.md
git diff --cached
git diff --cached --check
git commit -m "docs: clarify repository workflow"
```

上述路径是示例，请换成实际文件；每条命令成功后再继续。检查暂存区不能仅看文件名，需确认没有混入其他任务或本机私有资料。不使用 `--no-verify` 或修改 hooks 路径绕过仓库检查。提交完成后，若未授权推送，保留本地提交并报告其编号即可。

### 推送当前任务的提交

在当前任务已授权推送时，确认其他未提交工作已妥善保存，再同步并验证：

```sh
git pull --rebase origin main
sh scripts/check-commit-identity.sh HEAD
git push origin main
```

Windows 可在 Git Bash 执行署名检查。`pull --rebase` 只重放尚未推送的本地提交，不改写已经共享的提交；发生冲突或推送被拒绝时按第 5 节处理。若包含视频，先完成[视频规范](video-data-management.md#6-下载校验提交与发布)中的输入素材或最终成果检查，核对将上传的 LFS 对象。

推送中的 LFS hook 可能先上传大文件，之后 Git 推送才完成；Git 推送失败时应分别报告两者状态，不把大文件已上传说成 main 已更新。推送后读取远端并核对：

```sh
git fetch origin
git status --short --branch
git rev-parse HEAD origin/main
```

本地与已刷新远端的提交哈希一致，说明该提交已经同步；视频可下载、网页播放和 AWS 服务运行需要各自的验证。把本次提交和实际同步结果写入交接记录，在已授权的 Issue 流程中附提交链接；不创建 PR。

## 5. 多人同时修改时同步 main

在当前任务允许提交时先选择性提交自己的改动，妥善保存其他未提交内容，保持工作区干净；若用户要求先不提交，保留工作并说明同步条件，不能为同步擅自提交或丢弃修改。若别人已推送新内容，或自己的推送因远端更新而被拒绝，在 `main` 上执行：

```sh
git fetch origin
git rebase origin/main
```

这会将尚未推送的本地提交依次放到最新远端提交之后，不产生分支合并提交。遇到冲突时，逐个检查文件，结合两侧目的处理，只暂存已解决的文件，再执行 `git rebase --continue`。无法判断时可用 `git rebase --abort` 回到开始前的状态，保留双方工作并说明问题。

同步成功后，检查差异并执行必要验证；当前任务已授权推送时再 `git push origin main`。若远端再次更新，重复以上步骤。禁止 force push；若发现需要改写已共享提交或远端历史异常，先保留现状并说明，不自动覆盖。

## 6. 大文件、数据和账号

- GitHub 保存资料、代码、轻量数据样例和获取说明。
- 用户选定并授权共享的输入素材放入 `data/videos/`；最终展示视频放入 `deliverables/*.mp4`，两类视频均按 `.gitattributes` 使用 Git LFS。字幕 SRT、标签、清单和说明使用普通 Git。工作台导入、裁剪与渲染不会自动入库；来源原片、缓存和重复 ZIP 保留在本机忽略目录。两类视频的分别校验与下载方式见[视频数据管理规范](video-data-management.md)。
- AWS 凭据、模型 API 密钥及本地 `.env` 由各人自行配置，不在交接记录或 Issue 中粘贴。
- 同步与发布由当前任务驱动，按授权停在编辑、本地提交、GitHub / LFS 推送或 AWS 部署的实际阶段；没有后台自动同步或跨机器 Agent 调度服务。
