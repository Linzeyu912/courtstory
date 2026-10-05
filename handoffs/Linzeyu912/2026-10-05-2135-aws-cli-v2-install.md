# 交接：本机 AWS CLI v2 安装

- 日期 / 时区：2026-10-05 21:35，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户明确要求在本地安装 AWS CLI v2；当前开放 Issue 查询为空。
- 分支：main。
- 提交：未提交 / 未推送。
- 状态：安装与命令验证完成。

## 本次完成

- 从 AWS 官方下载当前用户版 `AWSCLIV2-User.msi`，验证数字签名有效、发布者为 Amazon Web Services, Inc. 后，以 MSI 静默安装完成，退出码 0。
- 安装在当前用户的 `%LOCALAPPDATA%\Programs\Amazon\AWSCLIV2`，安装程序已登记用户 PATH，无需管理员权限。
- 实测版本：`aws-cli/2.37.9 Python/3.14.6 Windows/11 exe/AMD64`。
- 安装包和日志留在仓库忽略目录 `tmp/aws-cli-install-20261005/`；没有将软件二进制纳入 Git。

## 结论与依据

- [AWS CLI 官方安装文档](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)，2026-10-05 查阅 Windows 当前用户 MSI 安装说明。
- 安装包来源：[AWSCLIV2-User.msi](https://awscli.amazonaws.com/AWSCLIV2-User.msi)，50,057,216 字节，SHA-256 为 `49cf1eeba914dde190d074843ead19e14c200d9b91cf53f1c6a991932d314739`。
- 赛事后续登录要求沿用[Portal 核验](../../requirements/portal-access-20261005.md)：nba-sso 用于登录，nba 用于本队资源操作，应用区域 us-east-1。

## 验证

- MSI Authenticode 状态 `Valid`，AWS 发布者核对通过。
- MSI 退出码 0，默认安装目录存在 aws.exe，通过绝对路径运行版本命令成功。
- 注册的用户 PATH 包含安装目录；刷新当前验证进程的环境后，Get-Command aws 能找到该安装，直接执行 aws --version 成功。
- 旧 PowerShell / Codex 进程可能保留安装前 PATH，重新打开终端或刷新其环境后使用。
- 本轮没有配置 profile、读取/修改 AWS 凭据、执行 SSO 登录或创建云资源；未安装 CDK。

## 阻塞与待确认

- 安装无剩余阻塞。赛事账号双 profile 与身份验证属于后续步骤，不将工具安装称为账号联通。
- 本轮 fetch 发现远端新增两个提交，origin/main 为 `82a8257`，本地仍为 `b90f816`；远端与现有本地修改都涉及 docs/status.md，因此保留工作区，未执行可能冲突的拉取或覆盖。

## 下一步

重新打开 PowerShell，执行 `aws --version`。后续配置时从本队 Portal 复制双 profile 到用户级配置，执行 `aws sso login --profile nba-sso`，再用 `aws sts get-caller-identity --profile nba --region us-east-1` 验证本队角色。

## 同步状态

安装仅作用于本机，不会随 Git 同步给队友。此交接和本轮状态说明仍在本地，未提交或推送；此前所有未提交资料保留。无分支、PR、云部署或赛事提交。
