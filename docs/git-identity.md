# 合作者统一提交署名

设立日期：2026-10-10，Asia/Singapore（UTC+8）。依据：仓库所有者明确要求其他电脑上的合作者也使用其信息创建提交。

本仓库的新提交使用以下身份：

| 项目 | 值 |
| --- | --- |
| GitHub 账号 | `Linzeyu912` |
| 作者和提交者姓名 | `ZeYu.Lin` |
| 作者和提交者邮箱 | `Linzeyu912@gmail.com` |

GitHub 根据提交邮箱关联账号。以上邮箱已通过仓库原有提交核对，作者和提交者均关联到 `Linzeyu912`；账号资料名称为 `ZeYu.Lin`。[GitHub 邮箱与提交说明](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)

## 每台电脑首次使用

用自己的 GitHub 凭据克隆本私有仓库；已有副本先同步最新版本：

```sh
git clone https://github.com/Linzeyu912/courtstory.git courtstory
cd courtstory
```

Windows PowerShell，在仓库目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-git-identity.ps1
```

macOS、Linux 或 Git Bash，在仓库目录运行：

```sh
sh scripts/setup-git-identity.sh
```

初始化将本仓库的 `user`、`author`、`committer` 姓名/邮箱全部设为上述值，启用 `user.useConfigOnly`，并将 `core.hooksPath` 指向版本管理中的 `.githooks`。不修改全局 Git 身份或登录凭据。脚本可以重复运行；每个新克隆都需要初始化一次，因为 Git 不会在克隆后自动执行仓库脚本。

完成时应显示：

```text
Author:    ZeYu.Lin <Linzeyu912@gmail.com>
Committer: ZeYu.Lin <Linzeyu912@gmail.com>
Repository hooks: .githooks
```

也可以手动核对，两行结尾的时间戳会不同：

```sh
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
```

若发现已有其他 hooks，脚本会保留文件并中止，避免静默停用已有检查。确认原检查已整合或可以替换后，Windows 增加 `-ReplaceHooksPath`，Shell 增加 `--replace-hooks-path`。替换只改变启用路径，原 hooks 文件继续保留。若环境变量覆盖身份，脚本会报错；先处理该终端中的 `GIT_AUTHOR_*` / `GIT_COMMITTER_*` 覆盖，再重新运行。

## 检查范围

- 提交前：检查本次作者和提交者，名字或邮箱任一不符就拒绝提交。
- 推送前：检查将推送的提交历史中，初始化基线之后的全部提交，防止绕过提交检查或保留了其他作者的提交进入远端。基线以前的历史不重写。
- 远端：GitHub Actions 的 `Commit identity` 工作流在推送、拉取请求或手动运行时检查提交记录。拉取请求检查实际分支提交，不把 GitHub 自动生成的合并预览当作团队提交。
- 手动检查：Git Bash/macOS/Linux 可运行 `sh scripts/check-commit-identity.sh HEAD`。

浅克隆缺少初始化基线时，检查会报错；先运行 `git fetch --unshallow origin` 取得历史，再重试。

本地 hooks 可被人为停用，其他电脑未初始化时也不会自动生效。远端工作流可以报告不合规，但推送触发的检查发生在接收提交之后。2026-10-10 查询本私有仓库规则集时，GitHub 返回 403，提示升级套餐或公开仓库；因此本次未配置服务器接收前的强制拦截，也未更改仓库可见性。[GitHub 规则集支持范围](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)

## 署名与登录

提交署名会统一关联到 `Linzeyu912`。执行推送的登录账号、GitHub 操作日志、签名验证和协作者权限仍按实际使用的账号记录；这里不承诺改变这些信息。每位合作者继续使用自己的访问凭据。

该约定适用于本项目按要求新建的提交。遇到 cherry-pick、补丁导入、第三方代码历史或已有不符署名时，应确认来源与处理范围，保留必要的实际作者和许可证信息，不自动重写历史或执行 force push。

## 文件入口

- [统一身份与历史基线](../config/commit-identity.config)
- [Windows 初始化](../scripts/setup-git-identity.ps1) / [Shell 初始化](../scripts/setup-git-identity.sh)
- [提交检查](../.githooks/pre-commit) / [推送检查](../.githooks/pre-push)
- [远端工作流](../.github/workflows/commit-identity.yml)

## 2026-10-11 开发历史接续

原 Team Hub 截至 `56e6466057c0560701d3163d2dbd1384e59249d2` 的提交保留原作者、提交者和 SHA。按用户最新要求，main 只接续成果整理后的更新，不再合入独立 CourtStory 历史；因此 `identity.baseline` 改为上述 Team Hub 固定提交，并移除额外历史基线。该提交之后的全部接续与未来新增提交仍须匹配统一身份，姓名和邮箱规则不变。

新克隆只需 main 可达的完整历史，不再依赖独立 CourtStory 根提交 `91b31a2`。本轮在只包含 main 的恢复包克隆中检查署名，并验证不符合署名要求的新提交仍会被拒绝。
