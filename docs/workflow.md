# 协作流程

自 2026-09-29 起，所有成员和 Agent 都直接在 `main` 上修改、提交和推送，不新建任务分支，也不使用 PR 合并流程。依据见[决策 D004](decisions.md#d004所有内容直接在-main-上改进)。

## 1. 每位队员首次使用

接受私有仓库邀请，在自己的电脑上安装 Git，并使用自己的 GitHub 账号完成认证。然后执行：

```sh
git clone https://github.com/Linzeyu912/broadcastcode-team-hub.git
cd broadcastcode-team-hub
```

将这个目录交给自己的 Agent 打开。先读 `AGENTS.md` 和 `docs/status.md`；需要填写 Git 提交姓名、邮箱时使用本人的信息。

发起人的本地目录是现有 `D:\HKS`；远端仓库名为 `broadcastcode-team-hub`。其他成员的本地目录名可以不同，相对路径保持一致即可。

## 2. 开工前同步 main

先检查是否有未提交工作。如果有，先确认其归属并妥善保存，不能覆盖或顺手提交他人的工作。工作区干净后执行：

```sh
git status
git switch main
git pull --ff-only origin main
```

确认当前分支为 `main` 后再开始编辑。通过 GitHub Issue 认领任务并写清涉及的文件或模块，避免两个人同时修改同一处。若 `pull --ff-only` 因本地与远端各有新提交而失败，按第 5 节处理；不要创建分支或重置工作区。

## 3. 工作中留下可同步产出

- 新发现：写入对应主题文档，保留来源和日期。
- 方案结论：写明选择及原因；团队已确认的结论汇总到 `docs/decisions.md`。
- 任务状态：更新对应 Issue；尚未确认的内容标为待确认。
- 每次收工：按模板创建 `handoffs/<your-login>/YYYY-MM-DD-HHMM-topic.md`。

Markdown 作为主要协作格式。Word 手册用于阅读和分享，尽量由一人根据 Markdown 统一生成，避免多人同时修改二进制文件。

## 4. 在 main 提交和推送

先确认本次改动及其验证结果，提交时只选择当前任务的文件：

```sh
git diff
git add path/to/changed-file.md handoffs/your-login/your-handoff.md
git diff --cached
git commit -m "docs: summarize video references"
git pull --rebase origin main
git push origin main
```

上述路径是示例，请换成实际文件。每条命令成功后再执行下一条；工作区仍有其他未提交修改时，先妥善保存再拉取。`pull --rebase` 只用于重放尚未推送的本地提交，不改写已经共享的提交。发生冲突或推送被拒绝时，按第 5 节处理。

推送后核对本地与远端，并把提交链接写入 Issue 或交接记录：

```sh
git fetch origin
git status --short --branch
git rev-parse HEAD origin/main
```

两个提交哈希一致时，说明当前本地内容已与远端同步。共同接口和团队结论仍需记录依据与讨论结果，可通过 Issue 和提交链接查看；不创建 PR。

## 5. 多人同时修改时同步 main

先选择性提交自己的改动，妥善保存其他未提交内容，保持工作区干净。若别人已推送新内容，或自己的推送因远端更新而被拒绝，在 `main` 上执行：

```sh
git fetch origin
git rebase origin/main
```

这会将尚未推送的本地提交依次放到最新远端提交之后，不产生分支合并提交。遇到冲突时，逐个检查文件，结合两侧目的处理，只暂存已解决的文件，再执行 `git rebase --continue`。无法判断时可用 `git rebase --abort` 回到开始前的状态，保留双方工作并说明问题。

同步成功后，检查差异并执行必要验证，再 `git push origin main`。若远端再次更新，重复以上步骤。禁止 force push；若发现需要改写已共享提交或远端历史异常，先保留现状并说明，不自动覆盖。

## 6. 大文件、数据和账号

- GitHub 保存资料、代码、轻量数据样例和获取说明。
- 用户授权共享的成片放入 `data/videos/`，使用 Git LFS；标签、清单和规格使用普通 Git。来源原片、缓存和重复ZIP保留本地。目录、去重、画质验收及下载方式见[视频数据管理规范](video-data-management.md)。
- AWS 凭据、模型 API 密钥及本地 `.env` 由各人自行配置，不在交接记录或 Issue 中粘贴。
- 当前流程按每次工作开始时拉取、结束时提交并推送运行；没有安装后台自动同步或跨机器 Agent 调度服务。
