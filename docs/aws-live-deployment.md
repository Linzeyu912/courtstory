# AWS 工作台运行与维护

部署沿用 EC2 + AgentCore + CloudFront，GPU 使用现有 SageMaker `ml.g5.2xlarge`（NVIDIA A10G）。EC2 的 G/VT 按需配额为 0，因此通过私有 S3 任务目录调用 SageMaker；视频检测、跟踪和 48 点场地模型均在 GPU worker 中执行。手工制作仍在工作台本地运行。

所有在用语言与视觉模型统一通过 OpenRouter；AgentCore 战术分析与旧身份/球队识别适配器也使用 OpenRouter。旧 Qwen 地面轨迹和实测回放已移除工作台入口，其历史文件保留供归档查阅。中文配音使用 Amazon Polly `Zhiyu` / `neural`，EC2 通过实例角色取得权限。

## 私有部署记录

本次部署配置、资源输出、访问码和验证结果保存在被忽略的 `tmp/aws-live-20261010/`。具体账号、桶、前缀、实例 ID 和 CloudFront 域名以该目录为准，不写入源码。

- `config.json`：基础设施参数、S3 代码键、GPU 任务前缀和实例输出。
- `core-outputs.json`、`delivery-outputs.json`：CDK 资源输出。
- `access-code.txt`：临时入口访问码。
- `manage.py`：本次发布的上传、状态查询和 SSM 操作工具；不会输出产品密钥。
- `verify.sh`：从 EC2 实际调用 Polly、FFmpeg、GPU 跟踪、GPU 场地模型和 AgentCore/OpenRouter。

`.env` 经解析编码后独立上传至私有 S3，在 EC2 落地为 `/etc/hks/product.env`（`root:hks`，权限 `0640`）。它不进入代码 ZIP、前端或 Git。AWS 权限由实例角色提供，不复制开发电脑的临时 AWS 登录凭据。AgentCore 从同一发布前缀读取独立的 OpenRouter 配置对象。

## 服务与恢复

- EC2：`hks-workbench` 与 `hks-gateway` systemd 服务；工作目录 `/opt/hks/current`。
- SageMaker：`courtstory-gpu` systemd 服务；工作目录 `~/SageMaker/courtstory-live/current`，复用 `~/SageMaker/hks-vision/runtime`。
- GPU 启动脚本：`engineering/infra/sagemaker-vision/start_worker.sh`。Notebook 的 live 生命周期配置会下载部署脚本并启动安装服务；原始验证配置保留。
- 工作台每次提交 GPU 作业都会先核对 worker 心跳。实例停止或失联超过 90 秒时，界面将报告 GPU 未就绪；不会悄悄改用 CPU。
- 运行数据由网关按现有机制备份到当前发布的 S3 `workspace/` 目录。GPU 输入、结果和日志位于私有 `gpu/jobs/`，与模型 API key 分开。

查日志可通过 SSM 执行 `journalctl -u hks-workbench -u hks-gateway`；GPU 日志在 Notebook 内运行 `journalctl -u courtstory-gpu` 查看。GPU 安装日志为 `journalctl -u courtstory-install`。

临时演示期间 EC2 与 GPU 保持开机。结束演示后可停止 EC2 与 SageMaker Notebook，保留磁盘和数据；再次开机后核对 GPU 心跳及 CloudFront 登录。没有设置自动关机时间。

## 2026-10-10 上线验证

CloudFront HTTPS 登录、8 个前端静态资源、两个官方样例列表与浏览器播放已验证；身份、姓名和战术接口均报告 OpenRouter 可用，S3 状态备份无错误。公网验证结果保存在 `tmp/aws-live-20261010/public-validation.json`。

从 EC2 完成了 60 帧 YOLO GPU 跟踪、E-BARD / BoT-SORT 默认组合、MOV 转码导入、48 点场地模型、AgentCore/OpenRouter 视觉请求和 Node OpenRouter 流式请求。Polly `Zhiyu` / `neural` 实际合成了 3.9 秒中文音频。结果位于服务器 `artifacts/cloud-validation/results.json`；这些检查确认运行链路，不是识别精度或长视频质量验收。场地测试首帧返回的高置信度点为 0。

最终的小幅运行代码修正经 SSM 应用。`config.json` 指向最新恢复包，CloudFormation 保留首次启动所用包；现有实例重启保留运行目录，重建时使用最新配置重新 synth / deploy。

## 中文配音与字体修复

2026-10-10 的一次成片失败发生在字幕渲染阶段：6 段 Polly 配音已成功生成，但工作流向 Linux 传入了 Windows 的 `C:/Windows/Fonts/msyh.ttc`。解说工作流和两个渲染入口现统一自动选择系统中文字体：Linux 使用 `fonts-noto-cjk` 提供的 Noto Sans CJK，Windows 使用微软雅黑，macOS 使用 PingFang；也可用 `--font` 明确指定。字体检查在模型和配音调用前执行。部署和更新包均包含成片预览 HTML 模板。

在 `us-east-1` 使用工作台 EC2 实例角色真实合成的结果：

| 音色 | 引擎 | 结果 |
| --- | --- | --- |
| Zhiyu（普通话） | standard | 成功 |
| Zhiyu（普通话） | neural | 成功，当前默认 |
| Zhiyu（普通话） | long-form | ValidationException：音色不支持该引擎 |
| Zhiyu（普通话） | generative | ValidationException：音色不支持该引擎 |
| Hiujin（粤语） | neural | 成功 |

这覆盖该区域 Polly 音色列表列出的普通话、粤语音色及其支持的引擎。失败的两个组合属于音色能力限制，不是 IAM 拒绝。详细结果保存在服务器 `artifacts/cloud-validation/polly-engines.json`。失败任务可用原配置执行 `commentary_workflow.py --resume`，校验并复用已经生成的音频。
