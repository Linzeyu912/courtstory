# 云端工程

`engineering/infra/ec2-workbench/` 包含 EC2 工作台、AgentCore 推理入口、CloudFront 网关及 S3 备份工程。2026-10-10 已在赛事账号部署并通过公网登录与视频播放验证，运行方式与私有记录位置见 [AWS 工作台运行与维护](aws-live-deployment.md)。

| 入口 | 用途 |
| --- | --- |
| `prepare.py` | 准备代码、Agent 与样例包；`--upload` 会上传 |
| `app.py`、`cdk.json` | AWS CDK 基础设施定义 |
| `bootstrap.sh` | 安装运行环境与启动服务 |
| `gateway.py`、`agent_main.py` | 网关与 AgentCore 入口 |
| `update_release.py` | 给已有部署打包更新 |
| `prepare_rebuild.py`、`state_archive.py`、`restore_bootstrap.py` | 全量打包、状态备份和恢复 |

现有脚本沿用赛事环境约定，包括区域、权限边界、AWS profile、已有 S3 素材与部署配置，并非通用的一键部署。新环境应先核对 `prepare.py` 和 `app.py` 的配置，再进行 CDK synth / diff；不能把原账号的资源标识直接当作新环境配置。使用 boto3、AWS CDK Python 依赖和 CDK CLI，实际资源配置留在被忽略的 `tmp/`。

部署包和仓库当前只保留用户提供的 `single.mp4` 考试视频；默认以未识别状态打开，可在工作台选择模型处理。本地安装见[本地启动](local-setup.md)，环境变量和服务选项以工程参数为准。

网关直接进入工作台，无访问码或登录门户；旧 `/login` 链接跳转到首页。中文配音采用阿里云 `qwen-audio-3.1-tts-flash`，默认男声 `anmingyuan_v3.1`；模型候选仍需用户核对。运行中的语言与视觉 API 统一使用 OpenRouter。

## GPU 工程与身份运行数据

[SageMaker 视觉环境](../infra/sagemaker-vision/README.md)保留开发与验证脚本。新增 `worker.py` / `start_worker.sh`，通过私有 S3 作业连接 EC2 工作台，执行视频检测、跟踪和 48 点场地模型。

EC2 首次打包与更新打包已包含 `data/player-rosters/`，保证初稿 Agent 的明确比赛名单可随代码进入部署包。模型权重和凭据仍单独准备，迁入代码不代表已部署。
