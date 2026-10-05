# Portal 环境操作步骤（10 月 5 日采集）

从赛事核验文档拆出的账号、登录与工具步骤。正文保留采集时操作和观察，后续安装、绑定、SSO / STS 及 CDK 已完成的最新状态统一查[AWS 环境](README.md)；不要把早期“尚未安装”当作当前状态。赛事规则仍查[正式要求](../../requirements/portal-access-20261005.md)。

## 4. 实际操作入口

### 仓库

在 Portal 的“GitHub 仓库”点击“连接 GitHub 仓库”，随后在 GitHub 安装界面选择实际用于评审的私有仓库。**选择只能设置一次**，操作前核对为 `Linzeyu912/broadcastcode-team-hub`，只给本次赛事所需仓库的读取范围。绑定后必须回到 Portal 查看已绑定结果。页面没有提供可随意改选的承诺。

### AWS 控制台

1. Portal →“登录 AWS”，完成共享账号控制台加载；该账号自身没有业务资源权限。
2. 返回 Portal →“切换到您的帐户”，按 AWS 页面确认进入本队角色。
3. 资源操作保持 `us-east-1`。约一小时后控制台角色过期，重新执行第二步；不把空资源/权限错误直接解释成未分配资源。

### AWS CLI

先安装 AWS CLI v2。从 Team25 Portal 复制完整双 profile 配置到用户级 `~/.aws/config`（Windows 同样位于用户目录的 `.aws/config`），保留已有其他 profile，避免重复段名。

```powershell
aws sso login --profile nba-sso
aws sts get-caller-identity --profile nba --region us-east-1
```

检查返回为本队账号与 `assumed-role/NBAHackathonParticipantRole`；若显示 `AWSReservedSSO`，说明仍用了登录 profile。后续明确使用 `--profile nba --region us-east-1`。配置和命令来自实际 Portal，不是通用单 profile 配方。

本机只读检查：当前 PowerShell PATH 未找到 `aws` 和 `cdk` 命令；这仅说明当前 shell 不可用，不断言磁盘或其他开发环境从未安装。本轮未安装工具、修改配置或调用 AWS 资源 API。

### 数据与说明

- [NBA 深度赛场](https://china.nba.cn/inside-the-game)
- [NBA 全球比赛页](https://www.nba.com/games)
- [官方训练 ZIP（Portal 标注 2 个文件）](https://comfile.csdnimg.cn/file/train_video.zip)
- [终极指南](https://csdn.feishu.cn/wiki/B3NSwj16GiSCR7kcM5vc9RjMnQb)
- [有效双语 Quick Start](https://csdn.feishu.cn/docx/Y21TdJqrHopofmx2w21cmqHLnLb)
- [AWS 服务指南](https://du5imhgxabl0d.cloudfront.net/services)：本轮实读 CDK 与 AI / Agent → Amazon Bedrock AgentCore 示例。

Portal 原 Quick Start 链接 `H0N3d4467osmp5x45VLc7RRgnqh` 已变成合并提示，应进入上面的 `Y21Td...` 正文。服务指南中的代码是教学片段，不等于已经获得完整可部署工程。
