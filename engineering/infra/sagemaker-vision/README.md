# SageMaker 视觉开发实例

本目录通过 CDK 创建一台 GPU Notebook，复用主办方预置 `NBAHackathonWorkloadRole`。默认 `ml.g5.2xlarge`、AL2023、50 GiB 持久磁盘；不创建 IAM 角色，不执行 CDK bootstrap，也不部署推理 Endpoint。Notebook 首次启动的环境安装脚本另见下文。

## 与现有工程的对应关系

- `engineering/scripts/basketball_run.py`：E-BARD YOLOv8n / YOLOv8s 检测与 BoT-SORT / ByteTrack；现有执行器要求 CUDA。
- `engineering/scripts/court_calibration.py`：YOLO11n 48 点关键点检测；有 CUDA 时使用 GPU，后续单应与几何计算主要由 CPU 执行。
- `engineering/scripts/local_video_library.py` → `process_local_video.py`：当前仍调用本地 Python 子进程。本实例创建成功不代表已把工作台改为远程 GPU 调度。
- OpenRouter 请求从 Notebook 内经 HTTPS 发出，不在 GPU 上部署 Astra 模型。

## 文件与部署

`app.py` 定义 Notebook 与首次启动脚本；`bootstrap.py` 建立独立 Python 3.12 环境；`vision_smoke.py` 运行原有两组检测 / 跟踪代码各 30 帧及一次场地关键点检测。首次验证结束后调用 StopNotebookInstance，磁盘保留。再次启动时不会自动重跑安装或外部模型请求。

在独立虚拟环境安装本目录 `requirements.txt`。实际账号、桶、前缀、代码 ZIP、校验摘要及 CDK 输出放在被忽略的 `tmp/`。设置 `HKS_SAGEMAKER_CONFIG` 指向该目录的 `deploy-private.json`，其字段为：`account`、`region`、`stack_name`、`notebook_name`、`instance_type`、`bucket`、`prefix`、`bootstrap_sha256`。不得把具体账号配置或凭据加入 Git。

在仓库根目录运行 `python engineering/infra/sagemaker-vision/prepare.py --output tmp/<全新任务目录> --expected-account <STS核实的账号> --notebook-name <实例名称> --upload`，准备 `vision-bundle.zip`（原有 Python 脚本、跟踪配置、三份已校验权重和 官方训练 001（弗拉格）测试片）及 `bootstrap.zip`（启动脚本、验证脚本、文件清单与 rsa/pyasn1 依赖）。省略 `--upload` 不上传文件，但仍会通过指定 AWS profile 调用 STS 校验账号，需有效登录状态。启动脚本验证两个 ZIP 的 SHA-256。上传到本队私有桶中全新的任务前缀后，进入本目录执行：

```powershell
cdk synth --strict --profile nba
cdk diff --profile nba --no-change-set
cdk deploy --profile nba
```

仅首次启动会接收临时加密测试凭据：云端产生一次性 RSA 公钥；本机用公钥加密用户提供的 API key；密文经私有 S3 传入，私钥和明文只留在测试进程内存。代码、模板、Notebook 和输出日志均不保存明文 key。云端测试只发送固定文本标记，不上传比赛画面给 OpenRouter。该机制用于单次连通性检查，正式产品凭据配置需独立实现。

## 使用与边界

开发环境位于 Notebook 的 `~/SageMaker/hks-vision/runtime/`，工程快照位于 `~/SageMaker/hks-vision/workspace/`。它们保存在 Notebook 数据卷中，停机后仍保留；删除实例会影响该卷，因此 CDK 对 Notebook 设置 Retain。

通过 SageMaker 控制台启动该实例后，可打开 JupyterLab 或终端运行已有脚本。任务结束后停机；停机停止计算计费，保留磁盘仍可能产生存储费用。30 帧检查是运行兼容性验证，不是完整视频、跟踪准确率、标定精度或在线产品验收。

本目录从 Team Hub 迁入，测试片已适配本仓库保留的官方训练 001。模型权重仍需单独准备；历史云端验收属于旧工程快照，本仓库迁移后未重新开机或调用模型。
