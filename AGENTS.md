# 仓库协作要求

正文优先中文。开始工作先阅读 README 和与任务相关的说明，保留已有未提交修改。

## 统一 Git 提交署名

仓库所有者于 2026-10-10 明确要求：其他电脑上的合作者也使用以下署名创建本仓库的新提交。

| 字段 | 作者 Author | 提交者 Committer |
| --- | --- | --- |
| 名称 | ZeYu.Lin | ZeYu.Lin |
| 邮箱 | Linzeyu912@gmail.com | Linzeyu912@gmail.com |

- GitHub 对应账号为 `Linzeyu912`。每台电脑、每个新克隆在首次提交前，按 [协作署名说明](docs/git-identity.md)运行初始化脚本。重复运行安全，配置只作用于本仓库。
- 提交前执行 `git var GIT_AUTHOR_IDENT` 和 `git var GIT_COMMITTER_IDENT`，确认名称与邮箱完全匹配。使用仓库的提交和推送检查，不用 `--no-verify` 或更改 hooks 路径绕过身份校验。
- 推送前运行 `sh scripts/check-commit-identity.sh HEAD`；Windows 可在 Git Bash 中执行。
- 各成员使用自己的 GitHub 登录凭据和已有仓库访问权限进行拉取/推送；统一署名不要求共享所有者的密码、Token 或 SSH 私钥。
- 本规则适用于新提交。不自动改写旧历史，不把引入的第三方提交直接改成所有者署名；发现已有不符提交时，先明确来源和处理范围。
- 身份检查实现与基线位于 [config/commit-identity.config](config/commit-identity.config) 和 `.githooks/`。修改协作身份规则需要所有者明确指示。
