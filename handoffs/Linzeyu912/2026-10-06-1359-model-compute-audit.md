# 交接：当前模型的 GPU、CPU 与云端运行位置

- 日期 / 时区：2026-10-06 13:59，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户询问当前使用的全部模型运行在 GPU 还是 CPU；GitHub open Issue 查询为空，无对应负责人或讨论。
- 分支：main。
- 提交：基于 `be5c43d17c78f04b4df55eda38aa6f82fde8f803`；本记录未提交 / 未推送。
- 状态：代码、现有实验记录及本机环境核对完成。

## 本次完成

- 区分工作台实际接入、可选缓存 / 离线比较与研究探针；记录执行设备，未改模型配置或产品代码。
- 本机 `nvidia-smi` 确认 NVIDIA GeForce RTX 5070 Laptop GPU、8151 MiB 显存；推理解释器确认 PyTorch 2.11.0+cu128、CUDA 可用。
- 用户追问跟踪器硬件后，`Win32_Processor` 确认本机 CPU 为 AMD Ryzen 9 9955HX（16 核）；检查已安装 Ultralytics 实现，默认 `model: auto` 将检测器原生特征通过 `.cpu().numpy()` 转入 CPU，随后以 NumPy 距离矩阵和 `lap.lapjv` 完成关联。因此当前 BoT-SORT 是 GPU 检测 / 特征提取加 CPU 跟踪；ByteTrack 的关联也在 CPU。

## 结论与依据

采集日期为本交接日期。以下设备指当前代码的执行选择及已记录的测试设备，不表示这些模型此刻同时运行。

| 范围 / 模型 | 设备 | 依据与边界 |
| --- | --- | --- |
| 工作台人物检测：E-BARD YOLOv8n、通用 YOLOv8s | 本机 GPU | [执行器](../../engineering/scripts/basketball_run.py)强制 `cuda:0`；[环境检查](../../engineering/scripts/workbench_runtime.py)无 CUDA 时拒绝。E-BARD 还提供篮球 / 篮筐等对象检测。 |
| BoT-SORT / ByteTrack 跟踪 | CPU 关联计算，检测及原生外观特征来自 GPU 模型 | 跟踪算法不能全部称为 GPU 神经网络；当前原生 ReID 没有另外一份独立权重，见[模型环境](../../environment/local/model-runtime.md)。 |
| 球场 YOLO11n Court48 | CUDA 可用时 GPU，否则 CPU | [球场模型](../../engineering/scripts/court_calibration.py)明确选择设备；实际使用工作台服务的 Python 环境，不能仅凭电脑有显卡保证服务已启用 CUDA。 |
| RTMPose-s HALPE26、RTMW-l 脚点候选 / 比较 | CPU | [比较脚本](../../engineering/scripts/compare_ground_models.py)固定 ONNX Runtime `CPUExecutionProvider`，4 线程；不是所有姿态模型都使用 GPU。 |
| RapidOCR 球衣号码 / 记分牌 | 当前配置 CPU | [OCR 入口](../../engineering/scripts/identity_ocr.py)未开启加速；本机安装包默认配置的检测、分类、识别均为 `use_cuda: false`、`use_dml: false`。 |
| Qwen 地面轨迹 Agent | 阿里云远程模型 | [provider](../../engineering/tools/player-review/agents/qwen-provider.mjs)使用阿里云 DashScope HTTPS API，默认 `qwen3.8-max`；本机只承担工具、图片处理和拟合，不加载大模型权重。 |
| 战术 / 身份 Codex Agent | 本机 CLI 发起远程模型调用 | [战术入口](../../engineering/scripts/tactics_agent.py)、[身份 provider](../../engineering/scripts/vision_provider.py)；本机 CLI 不等于本地大模型推理，型号取可信配置。 |
| 离线姿态比较：YOLOv8s / YOLO11n / YOLO26n Pose、ViTPose+ small | 最近比较使用 GPU，可按脚本回退 CPU | [比较说明](../../engineering/docs/ground-mapping-ocr-comparison.md)；早期 YOLOv8s Pose 也有 CPU 对照，不能把最近 GPU 比较推广到全部历史运行。 |
| 离线篮球比较：WASB、TrackNetV2 | GPU | [比较脚本](../../engineering/scripts/compare_ball_models.py)明确 `.to('cuda')`，尚未替代默认检测器。 |
| HoopPad / qSQ 研究 | 已记录测试 CPU | [探针](../../research/basketball-models/mentor-components-20261005/probe_hooppad.py)，未接入工作台。 |
| HoopTransformer、HoopEval、TAPNext++ 研究 | CPU / GPU 均有探针记录 | [Hoop 研究](../../research/basketball-models/mentor-components-20261005/README.md)、[权重核查](../../research/basketball-models/mentor-components-20261005/OPEN_SOURCE_AUDIT.md)、[TAP 研究](../../research/vision/tapnet-20261006/README.md)。HoopTransformer / TAPNext++ 是随机参数接口测试；HoopEval 后续另有历史权重合成输入测试。均不代表生产接入或业务精度通过。 |

- SIFT / LK 镜头跟随、几何拟合、轨迹处理及现有 `libx264` 正式视频编码使用 CPU 路径；这些不是另一批大模型。浏览已有缓存和人工制作无需重新运行检测模型。
- Bedrock 已有单次文本连通性测试，完整工作台尚未迁移。仓库 2026-10-05 核验的比赛账号 GPU 配额为 0，见[上云说明](../../engineering/docs/aws-workbench-deployment-guide.md)。本轮未重新查询 AWS 配额；托管模型底层设备由供应商管理，不能从本队 GPU 配额推断模型使用 CPU。

## 验证

- 阅读仓库入口、状态、成员、决策、工作流程、近期交接及上述代码和报告。
- `git ls-remote origin refs/heads/main`、本地 HEAD、origin/main 完整 SHA 一致；工作区有其他会话未提交研究，因此保留原样，未执行多余拉取或暂存。
- 执行只读显卡、PyTorch CUDA 与 OCR 安装包配置检查。未做新视频推理、性能测试或云模型调用，也未采样正在运行进程的实际模型利用率。
- 检查本交接的相对文件链接与空白格式。

## 阻塞与待确认

- 回答运行位置无阻塞。工作台服务解释器是否与被检查的推理解释器一致，需针对实际启动进程另查；球场设备因此保留条件描述。
- 云供应商单次请求实际使用何种 GPU / 加速器对本项目不可见，不作硬件型号断言。

## 下一步

- 若后续迁移纯 CPU 云环境，先改并实测人物检测主入口的 CUDA 强制检查；仅把部署机器换成 CPU 不足以运行现有自动检测流程。

## 同步状态

- 只新增本交接；其他会话未提交文件保留。本轮没有提交、推送、新建分支或创建 PR。
