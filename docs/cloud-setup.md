# 云端工程

`engineering/infra/ec2-workbench/` 保留现有 EC2 工作台、AgentCore 推理入口、CloudFront 网关及 S3 备份工程。本轮只迁移代码，没有创建或更新云资源。

| 入口 | 用途 |
| --- | --- |
| `prepare.py` | 准备代码、Agent 与样例包；`--upload` 会上传 |
| `app.py`、`cdk.json` | AWS CDK 基础设施定义 |
| `bootstrap.sh` | 安装运行环境与启动服务 |
| `gateway.py`、`agent_main.py` | 网关与 AgentCore 入口 |
| `update_release.py` | 给已有部署打包更新 |
| `prepare_rebuild.py`、`state_archive.py`、`restore_bootstrap.py` | 全量打包、状态备份和恢复 |

现有脚本沿用赛事环境约定，包括区域、权限边界、AWS profile、已有 S3 素材与部署配置，并非通用的一键部署。新环境应先核对 `prepare.py` 和 `app.py` 的配置，再进行 CDK synth / diff；不能把原账号的资源标识直接当作新环境配置。使用 boto3、AWS CDK Python 依赖和 CDK CLI，实际资源配置留在被忽略的 `tmp/`。

部署包仍采用两个官方训练样例。新仓库同时提供两段官方训练视频。本地安装见[本地启动](local-setup.md)，环境变量和服务选项以工程参数为准。

现有网关使用临时共享访问码，尚不代表生产多用户系统。模型候选质量、真实 Polly 中文配音和新账号部署仍需在目标环境验证。

## GPU 工程与身份运行数据

[SageMaker 视觉环境](../engineering/infra/sagemaker-vision/README.md)已迁入；默认探针改用本仓库官方训练 001，不再依赖旧 005 视频。它创建 Notebook 环境，尚未接通工作台远程 GPU 调度。

EC2 首次打包与更新打包已包含 `data/player-rosters/`，保证初稿 Agent 的明确比赛名单可随代码进入部署包。模型权重和凭据仍单独准备，迁入代码不代表已部署。
