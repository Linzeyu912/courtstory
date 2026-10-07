# 交接：EC2 Codex CLI 账号授权与真实调用通过

- 日期 / 时区：2026-10-07 22:24，Asia/Singapore（UTC+8）。
- 成员：Linzeyu912。
- 任务 / Issue：用户启用设备码登录后要求重新运行 `codex login --device-auth`，接续本聊天云端 CLI 安装任务；本任务查询时无对应开放 Issue。
- 分支：main。
- 提交：本轮未提交、未推送。
- 状态：完成安装、账号授权、最小模型请求及只读终端命令验证。

## 本次完成

- 接续[22:16 安装交接](2026-10-07-2216-codex-cli-ec2-install.md)，在既有服务器 `ubuntu` 用户下重新发起设备码登录；用户完成授权。
- 更新[环境记录](../../environment/aws/codex-cli-ec2-20261007.md)、[AWS 入口](../../environment/aws/README.md)及[团队状态](../../docs/status.md)。
- 在独立 `~/codex-workspace/` 执行两次 read-only / ephemeral CLI 测试，没有改动作品代码或既有服务配置。

## 结论与依据

- `codex login status` 成功返回 `Logged in using ChatGPT`。
- 首次 `codex exec` 未调用工具，真实模型返回 `CODEX_CLOUD_OK`，进程退出码 0。
- 第二次实际执行 `/bin/bash -lc pwd`，工具返回独立工作目录、退出码 0；最终返回 `CODEX_SHELL_OK`，CLI 进程退出码 0。
- [官方认证文档](https://learn.chatgpt.com/docs/auth)与[CLI 文档](https://learn.chatgpt.com/docs/cli)采集日期 2026-10-07；按官方设备码流程使用 ChatGPT 账号，没有复制本机登录缓存。

## 验证

- 登录缓存仅核对 owner `ubuntu` / 权限 600，未读取或输出令牌正文。
- 两次调用后 `hks-workbench` 和 `hks-gateway` 均为 active。
- 安装前首页探测 HTTP 403 未阻断本次真实 CLI 登录和调用；不将网页探测作为 CLI 不可用的结论。
- 当前只验证默认模型基础请求及只读命令，没有固定或单独验收某一模型、模型权限清单、剩余额度、项目改写及长任务。
- 本地证据在 Git 忽略目录 `tmp/codex-cli-ec2-20261007/`。一次性验证码、登录日志、资源 ID 和桶名不写入共享记录。

## 阻塞与待确认

- 本次安装与基础使用目标无阻塞。
- 后续具体开发任务仍需明确项目目录和改动范围；保持 `ubuntu` 用户及其 HOME，避免切到其他用户的登录缓存。

## 下一步

- 通过现有 SSM 会话进入服务器，执行 `sudo -iu ubuntu`、`cd ~/codex-workspace` 后运行 `codex`。
- 按后续任务授权准备实际项目代码；当前未把工作台发布目录转为 CLI 的开发工作区。

## 同步状态

- 云端程序安装及授权已真实完成，文档仍仅保存在本地 `main`。
- 本机已有其他任务未提交内容，保留原改动；未创建分支或 PR，也未提交 / 推送。最近 fetch 时本机落后远端 2 个提交，详情见安装交接；账号登录成功不改变 Git 同步状态。
