# 新账号 SageMaker GPU 与 OpenRouter Astra 验证

日期：2026-10-10，Asia/Singapore（UTC+8）。用户授权为当前视觉流程准备 SageMaker GPU，并从 Team25 AWS 计算环境测试其提供的 OpenRouter key；随后明确要求直接根据最新代码选择用途，不再询问任务类型。

## 状态

**SageMaker GPU Notebook 已创建，现有两组检测 / 跟踪和场地关键点 GPU 推理均通过；从该 Notebook 调用 OpenRouter Astra 也已通过。** CloudFormation 为 CREATE_COMPLETE；2026-10-10 09:33:46（UTC+8）实例已确认 **Stopped**，环境与代码保存在 50 GiB Notebook 数据卷。计算已停止，保留数据卷仍可能产生存储费用。

逐项返回值、配额、版本、计时与清理证据见[去标识化 JSON](gpu-openrouter-bootstrap-20261010.json)。09:34 记录形成时，工程和说明尚未提交或推送；用户随后授权将这些资料整理到 TeamHub main。本次发布保留原始 JSON，云端状态、配额、计时与清理结论均为上午实测快照，本次整理未重新调用 AWS 或 OpenRouter，也未更新云端代码。

## 实测结果

| 检查 | 结果 | 耗时 |
| --- | --- | --- |
| E-BARD YOLOv8n + BoT-SORT 原生 ReID，005 前 30 帧 | `cuda:0`；原生特征已观测；30 帧候选生成成功 | 处理循环 1.007 秒；含导入等开销的进程约 5.375 秒 |
| 通用 YOLOv8s + ByteTrack，005 前 30 帧 | `cuda:0`；30 帧候选生成成功 | 处理循环 0.792 秒；进程约 5.024 秒 |
| YOLO11n 场地关键点，005 首帧 | GPU device 0；返回 48×3，24 点置信度至少 0.25 | 首次加载与推理 4.360 秒 |
| OpenRouter `openai/gpt-6-astra` | HTTP 200；返回模型与请求一致；正确回复 `TEAM25_ASTRA_OK`；provider 为 OpenAI | 云端 HTTP 请求 2.281 秒 |

上述跟踪小样沿用执行器默认 704 输入；常规导入流程对通用 YOLO 会选择 640，因此这些耗时不能直接代替完整导入耗时或跨模型性能排行。场地点置信度不等于几何精度。跟踪模型参数记录为 `torch.float32`，不因请求 16 位选项而称为完整 FP16 执行。

云端确认 NVIDIA A10G、可见显存 23028 MiB、驱动 595.91.07；实际 PyTorch 为 `2.11.0+cu128`、Ultralytics 为 `8.4.171`、PyAV 为 `17.0.0`。首次环境准备与 GPU 验证脚本约 136 秒，不包括 Notebook 创建等待。

Astra 本次输入 20 tokens、输出 9 tokens；API 报告费用 **0.00065 USD**，不包含 AWS 计算 / 存储账单。本轮只做文本连通性检查，没有把赛事画面或业务数据提交给 OpenRouter，也没有改工作台的模型配置。

临时加密凭据与公钥交换对象的版本已全部删除，复查剩余版本数为 0；用户的 OpenRouter key 本身未撤销。源代码 / 权重包与去敏结果保留在本队私有任务前缀，便于复现。

## 最新工程与 GPU 的对应关系

本轮远端读取开始时 GitHub 曾连接失败，随后重新 fetch 成功；检查的 main 为 `0c219ae`，已包含 `da87412` 的真实 Astra 解说 / 绘图 / 语音成果与 `2fc1edf` 的球场映射入口归档。现有 UI 分支的检测、跟踪与场地后端在本次核对范围内没有更新版本。

收尾 fetch 发现远端新增 `503a547`（身份范围控制与显式后端环境文件），已只读检查差异；本次涉及的检测器、跟踪器、场地模型、导入 worker 与跟踪配置未变化。工作区含其他会话未提交资料，未拉取覆盖；云端代码快照明确为 `0c219ae`，不能称为所有最新主站功能均已部署。

| 环节 | 实际代码与调用路径 | 计算需求 |
| --- | --- | --- |
| 人物检测 | `serve_player_review.py` → `local_video_library.py` → `process_local_video.py` → `basketball_run.py`；默认 E-BARD YOLOv8n，可选通用 YOLOv8s | 执行器显式要求 CUDA，无静默 CPU 回退 |
| 多目标跟踪 | 默认 BoT-SORT、检测器原生外观特征；可选 ByteTrack | 检测 / 特征提取使用 GPU，关联、光流和导出也使用 CPU；不是为每种跟踪器单独部署大模型 |
| 球、篮筐、裁判参照 | E-BARD 导入流程还调用 `build_ebard_review_tracks.py`，补充多类别参照 | YOLO 检测可使用 GPU；不等同人物跟踪已解决所有身份问题 |
| 场地关键点 | `court_calibration.py` 的 YOLO11n 48 点模型；API 后端保留，主 UI 映射入口已归档 | 有 CUDA 时用 GPU，允许 CPU 后备；本轮验收要求确实使用 GPU |
| 场地几何 | OpenCV、NumPy、SciPy；`court_fullcourt.py` 为独立离线模块 | 主要为 CPU；不能把关键点推理通过说成整套标定精度验收 |
| Astra 解说 / 理解 | OpenRouter HTTPS API，模型 ID `openai/gpt-6-astra` | 云端发出 API 请求，不在本队 GPU 上运行 Astra 权重 |

当前导入后台仍启动本地 Python 子进程；新增 Notebook 不会自动将工作台请求路由到远程 GPU。完整在线调度与主站重部署另行验收。

## 新账号资源与实例选择

- STS 已核实当前 Team25 ParticipantRole。资源区域为 `us-east-1`；初次盘点时 EC2、SSM 托管实例、AgentCore Runtime、SageMaker Notebook / Training / Endpoint / Domain 均无活动条目。旧账号的部署记录不作为新账号现状。
- 完整分页配额查询显示 `ml.g5.xlarge` 与 `ml.g5.2xlarge` 各有 1 台 Notebook、1 台按需 Training 配额。相关 GPU Processing / Batch Transform 配额为 0。因此本轮无需申请提升 Notebook 配额，也没有提交提升申请。
- 选择 **ml.g5.2xlarge**：1 张 NVIDIA A10G，标称 24 GB 显存，8 vCPU、32 GiB 系统内存；比 xlarge 增加 CPU / 内存以支持视频解码与几何工作，不增加 GPU 显存。
- 使用 AL2023 Notebook、50 GiB 数据卷、IMDSv2、既有 `NBAHackathonWorkloadRole`。CDK 仅创建 Notebook 与生命周期配置；未新建 IAM 角色、修改平台策略或运行 bootstrap。
- 首次模板的生命周期配置误用了 Ref 返回 ARN，SageMaker 在创建参数校验阶段拒绝；已修为名称并显式建立资源依赖，清理失败栈后重试。该次失败没有启动 GPU。

## 测试范围

准备独立 Python 3.12 环境，沿用本机已验证版本：PyTorch 2.11.0 / CUDA 12.8、torchvision 0.26.0、Ultralytics 8.4.171、NumPy 2.4.3、PyAV 17.0.0。三份权重逐一核对原有 SHA-256。

GPU 探针使用已有 005 视频：E-BARD + BoT-SORT 与 YOLOv8s + ByteTrack 各取前 30 帧，检查实际参数设备和原执行器输出，再检测首帧 48 点场地关键点。这是兼容性与基础性能检查，不是完整视频、独立精度、端到端人工流程或生产负载验收。

OpenRouter 只接收固定的文本标记请求。临时密钥在本机通过隐藏输入交给加密进程，以云端一次性公钥加密后通过本队私有 S3 传递；云端私钥和 API key 明文只在进程内存中使用。代码、模板、共享报告和日志不保存 key。此临时机制不替代作品正式凭据管理。

## 来源

采集日期均为 2026-10-10；账号可用性以本轮 API 与运行结果为准。

- [实例工程与复现说明](../../engineering/infra/sagemaker-vision/README.md)。
- [AWS AL2023 Notebook](https://docs.aws.amazon.com/sagemaker/latest/dg/nbi-al2023.html)、[生命周期配置](https://docs.aws.amazon.com/sagemaker/latest/dg/notebook-lifecycle-config.html)。
- [AWS G5 硬件](https://aws.amazon.com/ec2/instance-types/g5/)、[SageMaker 配额](https://docs.aws.amazon.com/sagemaker/latest/dg/regions-quotas.html)。
- [PyTorch 历史版本安装](https://pytorch.org/get-started/previous-versions/)。
- [OpenRouter 实时模型目录](https://openrouter.ai/api/v1/models)、[Chat Completions API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion)。
- 历史参考：[10 月 6 日配额检查](sagemaker-gpu-availability-20261006.md)、[10 月 7 日云端 API 实测](openrouter-cloud-connectivity-20261007.md)。
