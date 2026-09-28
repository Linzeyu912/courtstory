# 协作流程

## 1. 每位队员首次使用

接受私有仓库邀请，在自己的电脑上安装 Git，并使用自己的 GitHub 账号完成认证。然后执行：

```sh
git clone https://github.com/Linzeyu912/broadcastcode-team-hub.git
cd broadcastcode-team-hub
```

将这个目录交给自己的 Agent 打开。先读 `AGENTS.md` 和 `docs/status.md`；需要填写 Git 提交姓名、邮箱时使用本人的信息。

发起人的本地目录是现有 `D:\HKS`；远端仓库名为 `broadcastcode-team-hub`。其他成员的本地目录名可以不同，相对路径保持一致即可。

## 2. 开工前拉取并建立任务分支

先检查是否有未提交工作。如果有，先保存或提交当前任务，避免带到新任务中。

```sh
git status
git switch main
git pull --ff-only origin main
git switch -c work/your-login/topic
```

把 `your-login` 换成自己的 GitHub 用户名，`topic` 换成任务短名，例如 `video-reference-notes`。一个任务使用一个分支。通过 GitHub Issue 认领任务并写清涉及的文件或模块，避免两个人同时改同一块内容。

## 3. 工作中留下可同步产出

- 新发现：写入对应主题文档，保留来源和日期。
- 方案结论：写明选择及原因；团队已确认的结论汇总到 `docs/decisions.md`。
- 任务状态：更新对应 Issue；尚未确认的内容标为待确认。
- 每次收工：按模板创建 `handoffs/<your-login>/YYYY-MM-DD-HHMM-topic.md`。

Markdown 作为主要协作格式。Word 手册用于阅读和分享，尽量由一人根据 Markdown 统一生成，避免多人同时修改二进制文件。

## 4. 提交、推送、发起 PR

```sh
git diff
git add path/to/changed-file.md handoffs/your-login/your-handoff.md
git diff --cached
git commit -m "docs: summarize video references"
git push -u origin HEAD
```

上述路径是示例，请换成实际文件。检查暂存内容，只提交当前任务的产出。

推送后在 GitHub 页面创建 Pull Request（PR，合并请求），目标分支为 `main`，说明改动、对应 Issue、来源和验证方式。安装了 GitHub CLI 的成员也可以执行：

```sh
gh pr create --base main --fill
```

涉及共同接口或团队结论时请相关队友看一遍。PR 合并后，其他成员在下一次开工前拉取 `main`。未合并的结果可先通过 PR 链接查看。

## 5. 当前任务进行到一半时同步主分支

先提交或妥善保存当前改动，再在自己的任务分支执行：

```sh
git fetch origin
git merge origin/main
```

有冲突时，结合两侧变更内容解决，再检查最终结果并提交；不要直接用整份文件覆盖队友的内容。日常同步不需要 force push。

## 6. 大文件、数据和账号

- GitHub 保存资料、代码、轻量数据样例和获取说明。
- 原始视频、大型数据和生成视频使用团队后续选定的存储，文档记录文件名、版本、访问方式及授权范围。当前尚未配置共享视频存储。
- AWS 凭据、模型 API 密钥及本地 `.env` 由各人自行配置，不在交接记录或 Issue 中粘贴。
- 当前流程按每次工作开始时拉取、结束时提交并推送运行；没有安装后台自动同步或跨机器 Agent 调度服务。
