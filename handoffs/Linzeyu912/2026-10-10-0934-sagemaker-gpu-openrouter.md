# 交接：新账号 SageMaker GPU 与 Astra 云端实测

- 日期 / 时区：2026-10-10 09:34，Asia/Singapore（UTC+8）。
- 成员：Linzeyu912。
- 任务 / Issue：本聊天用户明确要求准备 SageMaker GPU，并使用其提供的 OpenRouter key 从 Team25 AWS 测试 GPT-6 Astra；补充要求直接读最新代码确定用途。开放 Issue 查询为空。
- 分支：main；没有修改 UI 分支或执行合并。
- 提交：未提交、未推送。
- 状态：实例创建、GPU 代码验证、Astra 云端调用及停机核对已完成。

## 本次完成

- 新增 [SageMaker 视觉开发工程](../../engineering/infra/sagemaker-vision/README.md)：CDK、私有打包工具、首次启动环境与验证脚本。更新工程部署目录入口。
- 新增 [环境报告](../../environment/aws/gpu-openrouter-bootstrap-20261010.md)与[去标识化 JSON](../../environment/aws/gpu-openrouter-bootstrap-20261010.json)，更新 AWS 环境入口及团队状态。
- 当前账号 `us-east-1` 创建单台 `ml.g5.2xlarge` Notebook，复用预置工作负载角色，AL2023、IMDSv2、50 GiB 数据卷。未新建 IAM 角色或执行 CDK bootstrap。
- 核实新账号最初没有现成 EC2 / AgentCore / SageMaker 实例，因此本次外部 API 实测从新 Notebook 发出。

## 结论与依据

- 最新人物处理链仍是导入 worker 调用 YOLO + BoT-SORT / ByteTrack；现有执行器要求 CUDA。场地 YOLO11n 48 点后端保留，但映射 UI 已归档；OpenCV / SciPy 几何主要用 CPU。OpenRouter Astra 不在本队 GPU 上部署权重。
- 本队 G5 Notebook 配额已有 1 台，无需先申请提升；没有提交配额申请。Processing / Transform GPU 配额为 0，不能混用 Notebook 配额。
- GPU 实测两组各 30 帧均为 `cuda:0`，处理循环约 1.007 / 0.792 秒；场地关键点首帧推理返回 48×3。显存、驱动与库版本见报告。
- Astra 请求与返回均为 `openai/gpt-6-astra`，HTTP 200，正确回复测试标记，云端请求 2.281 秒，API 报告成本 0.00065 USD。
- 凭据通过不回显输入和一次性公钥加密传递；两份临时交换对象的版本已清理，剩余 0。未将 key 保存为代码、模板、环境配置或报告，也未撤销用户 key。
- 09:33:46（UTC+8）SageMaker 实例确认 Stopped，环境和工程快照保留；计算停止，数据卷保留。具体资源定位只在本机忽略目录和云账号中。

## 验证

- STS、资源列表、Service Quotas 完整分页、执行角色信任与可见策略查询。
- CDK synth / diff；首次 LifecycleConfigName 误用 ARN 的参数校验错误已修为名称与显式依赖，失败栈已清理后重建。最终 CREATE_COMPLETE。
- 三份权重原有 SHA 校验、Python 语法检查、可复现打包验证；两组真实 CUDA 跟踪、场地模型与云端 API 请求通过。
- 停机 waiter 与独立 DescribeNotebookInstance 均确认 Stopped。
- 新文件相对链接、JSON、敏感模式与 Git 空白检查通过。没有修改视频库、业务算法或模型权重，不运行无关前端 / 视频入库测试。

## 阻塞与待确认

- 本次 GPU 准备及 Astra 连通性请求无剩余阻塞。
- Notebook 尚未接入工作台的自动任务调度；主站仍需要另行在新账号恢复。30 帧兼容性验证不代表完整视频、跟踪准确率、球场几何精度或生产性能验收。
- AWS 账单费用未查询；报告只列 API 返回的 OpenRouter 成本，不声称 AWS 免费。

## 下一步

启动保留的 Notebook 后可直接用 `~/SageMaker/hks-vision/runtime/bin/python` 与 `~/SageMaker/hks-vision/workspace/` 中的工程快照继续运行模型。首次启动验证有标记，后续开机不会自动重复安装、调用 key 或自动停机；使用结束后应自行停机。

若继续接入线上处理，需把现有本地子进程入口适配为经过验证的云端任务调用，并补完整视频与业务流程验收；不把本轮机器准备直接标为主站已接通 GPU。

## 同步状态

- 本轮开始为本地 / 远端 main `0c219ae`；初次 fetch 曾连接失败，重试成功。收尾远端出现 `503a547`，已检查其身份范围控制与显式后端环境更新，GPU 算法、配置与导入 worker 未变化。
- 现有其他会话的答辩材料等未提交修改保留；本地仍为 `0c219ae`，未因收尾 fetch 强行合并覆盖。云端明确使用此代码快照。
- 本轮新增工程、环境报告及交接未提交 / 推送，没有 PR。私有部署参数、原始输出及加密交换控制脚本只在被忽略的 `tmp/gpu-openrouter-20261010/`。
