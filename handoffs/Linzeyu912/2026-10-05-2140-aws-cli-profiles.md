# 交接：本机 Team25 AWS CLI 双 profile 配置

- 日期 / 时区：2026-10-05 21:40，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户要求代为填写本机 `.aws/config`；当前开放 Issue 查询为空。
- 分支：main。
- 提交：未提交 / 未推送。
- 状态：配置写入和本地解析验证完成，SSO 登录尚未执行。

## 本次完成

- 复读用户已登录 Chrome 中的 Team25 Portal，根据页面实际配置新建用户级 `~/.aws/config`。检查时原文件不存在，没有覆盖任何已有配置或凭据。
- 写入 `nba-sso` 登录 profile 和 `nba` 本队角色 profile；SSO 区域 us-west-2、应用区域 us-east-1，输出 JSON。使用 UTF-8 无 BOM、无文件扩展名。
- 配置含本队账号与角色信息，仅写在本机用户目录；未复制进仓库、交接或其他共享资料。
- 同次只读观察发现 Portal 已显示现有私有仓库 `Linzeyu912/broadcastcode-team-hub` 被锁定绑定。此为用户操作后的页面状态，本轮没有点击绑定或更改权限。作品 URL 仍为空。

## 结论与依据

- [Team Portal](https://du5imhgxabl0d.cloudfront.net/portal)，2026-10-05 21:40 浏览器实读 Team25 的 AWS CLI 配置和仓库卡片。
- 两个 profile 职责及操作说明见[Portal 核验记录](../../requirements/portal-access-20261005.md)。本机 AWS CLI 安装结果见[安装交接](2026-10-05-2135-aws-cli-v2-install.md)。

## 验证

- AWS CLI `configure list-profiles` 成功列出 nba-sso 与 nba。
- 使用 `configure get` 逐项核对两个 profile 的 10 个参数，全部与实际 Portal 配置一致。
- 写入使用文件 CreateNew，若检查后出现用户新建文件会中止，避免竞争覆盖；实际一次创建成功。
- 本轮只做本地配置解析，没有获取临时凭据、SSO 登录、STS 身份调用或创建 AWS 资源。
- 文档差异空白、相对链接及账号信息未入库检查在收尾完成。

## 阻塞与待确认

- 配置无剩余阻塞；配置正确不等于账号已联通，尚需用户完成 SSO 授权并验证本队身份。
- git fetch 后本地 b90f816 仍落后 origin/main 两个提交（82a8257），远端与当前工作区重叠 docs/status.md，保留本地未提交工作，未拉取覆盖。

## 下一步

在能够识别 aws 命令的新终端执行 `aws sso login --profile nba-sso`，完成官方登录后，再执行 `aws sts get-caller-identity --profile nba --region us-east-1`，确认返回本队角色。日常资源操作使用 nba，区域 us-east-1。

## 同步状态

本机配置不随 Git 同步，各成员须从自己的授权页面配置。本轮交接与状态更新仍在本地，未提交推送；原有研究和门户资料保留。未创建分支、PR、云资源或赛事提交。
