# AWS 工作台运行与维护

部署沿用 EC2 + AgentCore + CloudFront，GPU 使用现有 SageMaker `ml.g5.2xlarge`（NVIDIA A10G）。EC2 的 G/VT 按需配额为 0，因此通过私有 S3 任务目录调用 SageMaker；视频检测、跟踪和 48 点场地模型均在 GPU worker 中执行。手工制作仍在工作台本地运行。

所有在用语言与视觉模型统一通过 OpenRouter；AgentCore 战术分析与旧身份/球队识别适配器也使用 OpenRouter。旧 Qwen 地面轨迹和实测回放已移除工作台入口，其历史文件保留供归档查阅。中文配音使用阿里云 `qwen-audio-3.1-tts-flash`，默认男声 `anmingyuan_v3.1`。TTS 不再调用 Amazon Polly。

## 私有部署记录

本次部署配置、资源输出、访问码和验证结果保存在被忽略的 `tmp/aws-live-20261010/`。具体账号、桶、前缀、实例 ID 和 CloudFront 域名以该目录为准，不写入源码。

- `config.json`：基础设施参数、S3 代码键、GPU 任务前缀和实例输出。
- `core-outputs.json`、`delivery-outputs.json`：CDK 资源输出。
- `access-code.txt`：旧版门户的历史访问码，当前部署不再使用。
- `manage.py`：本次发布的上传、状态查询和 SSM 操作工具；不会输出产品密钥。
- `verify.sh`：从 EC2 实际调用 Polly、FFmpeg、GPU 跟踪、GPU 场地模型和 AgentCore/OpenRouter。

`.env` 经解析编码后独立上传至私有 S3，在 EC2 落地为 `/etc/hks/product.env`（`root:hks`，权限 `0640`）。它不进入代码 ZIP、前端或 Git。AWS 权限由实例角色提供，不复制开发电脑的临时 AWS 登录凭据。AgentCore 从同一发布前缀读取独立的 OpenRouter 配置对象。

## 服务与恢复

工作台现直接公开访问，不再要求访问码或会话 Cookie。旧 `/login` 地址跳转到首页；网关仍校验请求的 Host / Origin，并保持密钥文件与工作台静态资源隔离。

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

## 草稿恢复、请求恢复与联合成片修复

2026-10-10 排查发现，浏览器恢复旧草稿时未读取服务器保存版本，配音与绘图启动前的保存会重复触发版本冲突。现在恢复时核对服务器版本；落后的不同内容先保存在浏览器的恢复前备份中，再读取服务器版本，备份可在“来源、草稿与导出”下载。保存已提交但响应丢失时，相同内容重试返回已保存版本；不同内容仍保留冲突检查。

工作台状态读取增加短暂断线重试；新建模型任务不盲目重发。API 登录过期返回 JSON 401，并提示重新登录。网关健康检查同时确认工作台监听已就绪；服务启动阶段返回 503。网关与工作台扩大连接等待队列，静态路由补齐请求恢复模块和现有绘图运动模块。战术保存接口仅返回版本号与保存时间，避免回传浏览器已有的大体积轨迹文档。

成品页接入联合成片的生成、进度、视频预览和 MP4 / SRT 下载。重新打开页面可恢复上一份完成的视频，即使最近另一个任务失败也不会隐藏已完成结果。投篮图形与解说节点的关联在配音启动前检查，缺少已采纳图形时直接提示回到绘图流程。整轮绘图预算从 8 分钟调整到 30 分钟，逐节点生成与复核的限制保留；进度按已完成节点更新。

此次发布保留了原运行数据。服务器发布前备份位于 `/opt/hks/backups/flow-repair-20261010/`，实际流程验证文件位于 `/opt/hks/current/artifacts/flow-repair/`；公网模块和保存重试的检查结果在本地私有部署目录的 `flow-network-validation.json` 与 `flow-save-validation.json`。完整流程是否通过以 `artifacts/flow-repair/validation.json` 和最终视频为准。

实际流程已完成一次联合成片：官方训练 001 的已保存解说包含 6 段，6 个绘图节点完成后采纳候选，使用 18 个图形输出 1920×1080、42.77 秒的 H.264 / AAC MP4（56,060,333 字节）。验证使用该解说原有身份快照的独立文档，没有覆盖用户后来修改的工作区身份。该结果证明这条样例链路能完成；绘图候选仍有未定位对象等缺口，不等于所有动作识别质量已人工验收。

## 阿里云男声配音

TTS 使用北京地域百炼 API，服务端配置 `DASHSCOPE_API_KEY`（兼容已有 `QWEN_API_KEY`）。默认模型为 `qwen-audio-3.1-tts-flash`，默认男声为 `anmingyuan_v3.1`；可分别通过 `QWEN_TTS_MODEL`、`QWEN_TTS_VOICE` 覆盖。

未设置 Workspace ID 时使用 `dashscope.aliyuncs.com`。仅在专属端点已验证可用后配置 `SFM_WORKSPACE_ID` 或 `DASHSCOPE_WORKSPACE_ID`。密钥保存在 `/etc/hks/product.env` 和私有 S3 环境配置中，不进入发布 ZIP。

接入依据：[阿里云 HTTP API](https://help.aliyun.com/en/model-studio/qwen-audio-tts-http-api)和[音色列表](https://help.aliyun.com/en/model-studio/qwen-audio-tts-voice-list)。返回音频转换为现有成片流程所需的单声道 16 kHz WAV，并以实际 PCM 长度修正流式 WAV 文件头。缓存键包含服务商、模型、音色与风格，旧 Polly 配音不会被新任务复用。上文 Polly 验证记录属于迁移前的历史结果。

## 固定展示成片

“成片”页顶部固定展示 `deliverables/single.mp4`，字幕使用 `deliverables/single.srt`，由 `/team25-final.mp4` 和 `/team25-final.srt` 提供。该展示不依赖当前样本、浏览器草稿或解说任务记录，访客无需导入、识别或生成。当前样本自己的制作与导出仍在下方。

部署时须同时发布上述两个交付文件、`engineering/tools/player-review/index.html` 和 `engineering/scripts/serve_player_review.py`，并重启 `hks-workbench` 以注册媒体路径。S3 发布包需保留同样内容，恢复或再次部署后即可继续展示。
