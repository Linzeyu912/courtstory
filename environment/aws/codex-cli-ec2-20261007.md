# 在既有 EC2 安装 Codex CLI：资料核验与执行记录

研究结论、运行职责和验证边界另见[EC2 Codex CLI 实测报告](../../research/agents/codex-cli-ec2-20261007.md)；本页保留环境安装及接续操作。

采集日期：2026-10-07，Asia/Singapore（UTC+8）。范围来自本聊天用户：先查官方资料，在本机下载适合云端的 Codex CLI 安装包，再传入已有服务器、安装并尝试以自己的 ChatGPT 账号登录。

**已把官方 Codex CLI 0.160.1 从本机传入既有 EC2，完成用户级安装、ChatGPT 设备码授权、真实模型请求和只读终端命令测试。** 2026-10-07 22:24（Asia/Singapore）两次 `codex exec` 均成功；验证限于简单推理与 `pwd`，尚未运行项目修改或长任务。这里准备的是服务器上的开发工具；工作台的既有云端部署状态另见[工程验收](../../engineering/docs/ec2-cloud-interaction-acceptance-20261007.md)。

## 官方资料与本次选择

[Codex CLI 官方文档](https://developers.openai.com/codex/cli)在本次采集时返回新的 CLI 文档，列有 macOS / Linux 独立安装器和 npm 安装方式，并支持在终端检查文件、修改代码、执行命令。本次按用户要求选用独立 Linux 包，先下载到本机再上传；不在 Windows 上安装该 Linux 包。

[官方认证文档](https://learn.chatgpt.com/docs/auth)说明 CLI 支持 ChatGPT 登录及 API key 登录。本轮采用用户指定的 ChatGPT 账号登录，实际账号权限、可用模型与额度须以登录后的结果为准。无头或远程终端首选设备码认证：

```sh
codex login --device-auth
```

设备码登录目前在文档中标为 beta。个人账号须先在 ChatGPT 安全设置启用设备码登录；受管理工作区由管理员在工作区权限中启用。随后在自己的浏览器打开 CLI 显示的链接，登录并输入当次设备码。服务器安装完成和账号授权完成是两个独立步骤。

认证文档说明登录缓存可能保存在操作系统凭据存储，或 `~/.codex/auth.json`。后者包含访问令牌，应按密码对待：不进入仓库、S3 软件包、Issue、交接或共享日志；不读取其正文来证明登录成功。登录状态用以下命令核验：

```sh
codex login status
```

## 安装包定位

以下值由本轮主执行会话从官方安装器及发布元数据解析。`latest` 是可变渠道，复跑时应重新获取元数据，不能把本次版本称为永久最新。

| 项目 | 本次记录 |
| --- | --- |
| 官方安装器 | `https://chatgpt.com/codex/install.sh` |
| 发布元数据 | `https://releases.openai.com/codex/channels/latest` |
| 本次版本 | `rust-v0.160.1` |
| 目标平台 | `x86_64-unknown-linux-musl` |
| 包名 | `codex-package-x86_64-unknown-linux-musl.tar.gz` |
| 元数据 SHA-256 | `340801565906a7028f6baaa9ab6853addaef221f0016a1417a7c1ffdd96c21f0` |

包大小为 160,785,122 字节。本机 SHA-256、官方发布元数据、官方 `codex-package_SHA256SUMS` 及实例下载后的 `sha256sum -c` 四者一致。包内 `codex-package.json` 显示版本 `0.160.1`、目标 `x86_64-unknown-linux-musl`，54 个归档成员未发现绝对路径或 `..` 路径段。解析和校验使用本次固定版本，避免 `latest` 更新造成版本混用。

## 既有服务器前置核验

以下为本轮主执行会话报告的实际检查结果，不由历史部署记录推断。具体实例标识、私有桶名、对象完整路径和账号信息只保存在本机被忽略的任务目录。

| 检查 | 结果与解释 |
| --- | --- |
| AWS 认证 | 既有 AWS SSO 刷新成功，STS 返回本队参赛角色 |
| 远端管理 | Systems Manager 状态为 `Online`，可沿用 SSM 管理通道 |
| 系统与架构 | Ubuntu 24.04，`x86_64` |
| 操作用户 | `ubuntu` 用户存在，可采用其用户目录安装和登录 |
| 磁盘 | 实查约 34 GB 空闲，仅代表当时容量 |
| Codex | 检查时尚未安装 |
| 工作台服务 | `hks-workbench` 与 `hks-gateway` 均为 `active` |
| OpenAI 认证发现接口 | HTTP 200，证明该接口当时可达 |
| ChatGPT 首页探测 | HTTP 403；单个网页探测不能证明 Codex 登录或模型调用会失败，须实测对应流程 |

当前实例原有工作台以系统用户 `hks` 运行。Codex 采用 `ubuntu` 用户级安装，使程序、账号缓存及工作目录有明确归属。既有工作台的发布目录、服务用户与管理方式见[EC2 部署工程](../../engineering/infra/ec2-workbench/README.md)；本轮安装不需要更改该工程的发布包。

## 本次执行顺序与结果

传输路线：**本机下载官方包 → 既有私有 S3 发布前缀下的新 `tools/codex/` 对象 → SSM 驱动实例下载 → `ubuntu` 用户级安装 → 设备码登录 → 最小调用验证**。包和校验记录使用独立版本路径，沿用已有权限与网络。

| 阶段 | 当前记录 | 完成依据 |
| --- | --- | --- |
| 本机下载与校验 | 通过 | 160,785,122 字节，实际 SHA-256 与官方元数据及校验清单一致 |
| 上传私有 S3 | 通过 | HEAD 返回相同文件大小、AES256 服务端加密及本次 SHA-256 元数据 |
| 远端下载与校验 | 通过 | 实例角色下载成功，`sha256sum -c` 返回 `OK` |
| 用户级安装 | 通过 | 以 `ubuntu` 执行 `codex --version` 返回 `codex-cli 0.160.1` |
| ChatGPT 设备码登录 | 通过 | 用户启用设备码设置后重新发起登录；用户完成授权，`codex login status` 返回 `Logged in using ChatGPT` |
| 最小真实调用 | 通过 | 在独立工作目录执行 read-only / ephemeral `codex exec`，退出码 0，返回 `CODEX_CLOUD_OK` |
| 只读终端命令 | 通过 | 第二次 `codex exec` 实际执行 `/bin/bash -lc pwd`，工具退出码 0、目录与预期相符，最终返回 `CODEX_SHELL_OK` |
| 安装及调用后工作台检查 | 通过 | 两次测试后 `hks-workbench`、`hks-gateway` 均为 `active` |

本次手动解包保留官方 standalone 包布局，程序位于 `~/.codex/packages/standalone/releases/0.160.1-x86_64-unknown-linux-musl/`，`~/.local/bin/codex` 指向该版本的 `bin/codex`；`ubuntu` 登录 shell 已能直接找到 `codex`。账号目录权限为 700，登录后仅检查凭据文件 owner 为 `ubuntu`、权限为 600，没有读取其正文。另准备 `~/codex-workspace/` 作为独立工作目录，现在只含本次测试输出；没有启用自动更新或新增 Codex systemd 服务。

后续通过现有 Systems Manager 会话进入实例，切换到操作用户后使用：

```sh
sudo -iu ubuntu
codex --version
codex login status
cd ~/codex-workspace
codex
```

如果设备码过期，用 `codex login --device-auth` 生成新的当次验证码。实际安装与登录证据在被 Git 忽略的 `tmp/codex-cli-ec2-20261007/`；登录日志和 SSM 返回含短期验证码，不加入共享文件。

SSM Run Command 的初始身份与 `ubuntu` 登录会话不同。后续继续使用同一 `ubuntu` 用户及其 HOME，以复用正确的账号缓存。普通用户安装并不意味着该用户没有 sudo 权限。项目代码读写、需要额外权限的命令、长任务和生产目录开发尚未验收。

首次只测 ChatGPT 首页出现的 403 没有阻断本次设备码登录和两次真实 CLI 调用，因此不作为当前阻塞项。测试采用 CLI 当时默认模型，本轮未固定或单独核验某个模型名称、完整模型权限清单及剩余额度。

执行过程中不将设备码、访问令牌或认证文件正文写入共享记录。模型验证仅需要无业务内容的小请求，不以 `--version`、认证发现接口 HTTP 200 或登录状态代替推理成功证据。若设备码流程不可用，应记录实际错误后再决定下一条官方认证路线。

本轮已完成服务器开发工具安装；尚未修改作品使用的模型 provider、创建新的计算资源、接入赛事运行流程或提交赛事作品。开发工具的技术可用性不替代赛事对作品运行服务的要求。

## 来源与接续

官方资料采集于 2026-10-07（Asia/Singapore）：

- [Codex CLI 安装与使用](https://developers.openai.com/codex/cli)：Linux 独立安装器及终端工作方式。
- [Codex 认证](https://learn.chatgpt.com/docs/auth)：ChatGPT 登录、设备码登录、安全设置、登录状态及凭据存储。
- [官方独立安装脚本](https://chatgpt.com/codex/install.sh)：本次独立安装包的选择路径。
- [官方 latest 发布元数据](https://releases.openai.com/codex/channels/latest)：本次版本、平台包与预期摘要。

安装、授权、最小请求和只读命令已逐项实测。初次安装见[22:16 交接](../../handoffs/Linzeyu912/2026-10-07-2216-codex-cli-ec2-install.md)，授权及调用完成见[22:24 接续交接](../../handoffs/Linzeyu912/2026-10-07-2224-codex-cli-ec2-auth.md)。文档本轮仍未提交 / 推送，不把本地记录的写入视为已经共享到 GitHub。
