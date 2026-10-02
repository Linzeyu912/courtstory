# 视觉系统本地实测与 AWS 部署评估

- 日期：2026-10-01（Asia/Shanghai）。
- 用户要求：视觉系统接入解说 Agent，先本地运行，再迁移 AWS；处理最多等待 10 分钟，暂按当前电脑配置评估。
- 本文口径：将 10 分钟作为一次视频任务完成的目标，涵盖分析、解说和成片；输入视频的最长时长、并发数及上传是否计时尚未约定。
- 状态：本机 CUDA 与 YOLO 检测跟踪基线已实测；其他模型为官方资料评估；完整产品流程、Linux 容器和 AWS 尚未运行。以下选型为建议，未宣布团队共识。

## 1. 结论

**现有电脑足以继续开发和验证。建议先以 YOLOv8s + ByteTrack 作为速度基线，优先解决球员漏检、身份连续性与脚下贴图稳定性。现有证据不足以要求购买更高配置设备。**

YOLO 可以直接加载预训练权重，本次没有训练就完成了篮球视频人物检测与跟踪。ByteTrack 的关联算法无需另外训练；BoT-SORT 的可选外观重识别模块需要模型权重，但可以从预训练模型开始。它们可作为 Agent 调用的视觉工具，独立运行在 GPU 工作进程中。

本机处理一个 8.1 秒、1080p 片段时，YOLOv8s + ByteTrack 的检测跟踪阶段约用 2.7 秒；同样检测器配 BoT-SORT 约用 6.5 秒。两者在该片段均快于视频播放速度。**这支持继续实现短片段流程，尚不能证明完整任务已满足 600 秒上限。**

AWS 官方有适配这类推理的 GPU 实例及容器运行方式。但已读赛事官网和培训纪要没有给出本届账号可用的 GPU 型号、配额或预算金额，不能把 AWS 产品目录视为赛事资源承诺。

## 2. 当前电脑与运行环境

本轮通过系统信息、`nvidia-smi`、Python 包信息和 CUDA 实际运算核验：

| 项目 | 本机结果 |
|---|---|
| CPU | AMD Ryzen 9 9955HX，16 核 / 32 线程 |
| 系统内存 | 约 32 GB，系统报告约 31.2 GiB |
| GPU | NVIDIA GeForce RTX 5070 Laptop GPU |
| 显存 | `nvidia-smi` 报告 8151 MiB，约 8 GB |
| 驱动 | 596.21 |
| Python / PyTorch | Python 3.12.10；PyTorch 2.11.0+cu128；torchvision 0.26.0+cu128 |
| CUDA 验证 | CUDA 可用；设备计算能力 12.0；实际 GPU 矩阵运算通过 |
| 检测与跟踪依赖 | ultralytics 8.4.63、lap 0.5.13；本次固定此版本，不代表最新版本 |
| 其他库 | opencv-python 5.0.0.93、numpy 2.4.3 |
| ONNX Runtime | 当前安装的 1.25.0 只有 Azure / CPU provider，未启用 CUDA provider |
| 容器 | Docker CLI 与 WSL 发行版存在；本次 Docker 服务不可连接，未验证容器运行 |

本次在被 Git 忽略的 `tmp/vision-deploy-bench-venv/` 创建虚拟环境，复用本机已有 CUDA PyTorch。模型、缓存和诊断图片也留在被忽略目录；共享文件只包含脚本、结果与说明。没有创建云资源。

## 3. 本机实测

### 样片与测量方法

- 输入：[library100 的第 001 段](../../data/videos/nba/2024-25/clips/IND-OKC_Q4_pick-pop_8.1s_1080p.mp4)，1920×1080，约 29.97 fps，共 243 帧。按解码帧数和报告帧率计算为 8.1081 秒。
- 本轮仅测试这一个片段，共 10 次运行；没有把重复运行当作不同场景样本。
- 使用官方 YOLOv8n / YOLOv8s 预训练权重，FP16，仅检测 `person`，置信度阈值 0.1；每帧检测并跟踪，无跳帧。
- `imgsz=640` 是模型缩放尺寸参数，实际预处理图像为 384×640；`imgsz=1280` 为 736×1280。原片仍是 1080p。
- 每次先进行 10 帧检测预热，再计时完整视频的解码、人物检测、跟踪、首次跟踪器初始化和一张诊断图片保存。
- **不含** Python 启动及库导入、模型加载和预热、球检测、球场标定、姿态、分割、解说生成、配音、视频编码、上传和排队。模型加载与预热单独记录，不代表完整冷启动耗时。
- BoT-SORT 使用包内默认配置，启用稀疏光流相机运动补偿，`with_reid=False`。ByteTrack 使用同包配置。本轮没有比较重识别的收益。

### 结果

| 检测器与跟踪器 | 模型缩放尺寸 | 次数 | 处理 8.1 秒视频的耗时中位数 | 实测范围 |
|---|---:|---:|---:|---:|
| YOLOv8n + ByteTrack | 640 | 3 | 2.68 秒 | 2.62–3.80 秒 |
| YOLOv8s + ByteTrack | 640 | 3 | 2.66 秒 | 2.61–2.79 秒 |
| YOLOv8s + BoT-SORT，无 ReID | 640 | 3 | 6.53 秒 | 6.45–6.59 秒 |
| YOLOv8s + ByteTrack | 1280 | 1 | 3.74 秒 | 仅一次 |

依据：[汇总 JSON](vision-deployment-benchmark/summary.json)、[原始结果说明](vision-deployment-benchmark/README.md)、[测量脚本](../scripts/benchmark_vision_baseline.py)。每次均处理完整 243 帧，输入哈希一致。

小样本中 n 与 s 的耗时接近，首次跟踪器初始化和系统缓存存在影响，不能据此认定 s 比 n 更快。BoT-SORT 在这组配置下耗时更高；是否值得使用，要看遮挡与相机运动场景中身份错配是否减少。本轮没有测 ID 切换次数，不能把它直接评为更准。

### 效果抽查

查看了 n/640、s/640、s/1280 在第 60 帧的诊断图：

- n/640 在该帧漏掉了一些场上人物；s/640 检出的场上人物更多，但仍受重叠、遮挡影响。
- s/1280 检出了更多人物，同时也包括更多观众和场边人员；这不等于任务准确率更高。
- 裁判、观众属于通用模型正确的“人”类别，但下游需要的是参与战术的球员，必须增加球场区域与球队筛选。

这是单帧人工抽查，尚未计算检测精度、召回率、ID 连续性、球员姓名识别或贴图抖动。报告中的轨迹数量只用于观察输出，不能代替准确率。JSON 内 PyTorch 显存字段只统计该进程的张量分配器，不代表完整服务显存需求。

## 4. 哪些部分需要训练

| 能力 | 起步是否需要自行训练 | 后续工作 |
|---|---|---|
| 检测人物位置 | 不需要，预训练 YOLO 可直接推理 | 用篮球样片检查远景、遮挡、运动模糊；必要时微调 |
| ByteTrack 连续编号 | 算法本身不需要 | 调阈值，处理遮挡及切镜；轨迹 ID 不等于球员姓名 |
| BoT-SORT 连续编号 | 可直接运行；启用 ReID 时需相应权重，可先用预训练模型 | 评估同队球衣相似时的收益及额外耗时 |
| 脚下贴图锚点 | 可先用检测框底部中心，或预训练姿态模型的脚踝点 | 平滑、遮挡处理、落地位置估计；跳跃时脚踝不等于球场接触点 |
| 球场透视映射 | 几何求解本身不需要训练；先用人工关键帧标定可验证效果 | 自动提取球场线 / 关键点时可能需要篮球专项数据及训练；切镜需重新初始化 |
| 篮球位置与控球关系 | 通用预训练模型可试跑，但本轮未测试球 | 小目标、遮挡、快速运动可能需要裁剪、高分辨率和专项微调；控球需时序判断 |
| 球员姓名、球队、战术关系 | 通用人物检测不会自动提供 | 结合名单、号码、球衣、时序与几何信息；不把推测写成确定事实 |

因此，建议先做“预训练推理 → 标注失败样例 → 有针对性的微调”，不要把从零训练设为接入 Agent 的前提。[YOLOv8 官方文档][yolo]、[跟踪文档][tracking]、[ByteTrack 原仓库][bytetrack]、[BoT-SORT 原仓库][botsort]支持预训练推理与检测 / 关联模块的区分。

## 5. 其他视觉系统是否适合

下表是根据官方能力和集成成本作出的建议；只有 Ultralytics YOLOv8 组合在本轮实测。

| 方案 | 在本项目中的用途 | 建议与限制 |
|---|---|---|
| YOLOv8s + ByteTrack | 人物框与连续轨迹基线 | 本机已经跑通，先据此验证贴图；姿态、球场、球和身份另行接入 |
| [YOLOX-S / Tiny][yolox] + [ByteTrack][bytetrack] | 同类实时检测跟踪替代路线 | 有预训练及 ONNX / TensorRT 部署说明；代码分别为 Apache-2.0 / MIT。值得作为另一套基线，需实际验证当前依赖兼容性 |
| [RTMDet-tiny / s][rtmdet] + ByteTrack | 检测，并可扩展实例分割、接入 [RTMPose][rtmpose] | 官方生态覆盖检测、分割、姿态；MMDetection 代码为 Apache-2.0。适合更完整视觉模块，但部署配置较多 |
| [RT-DETRv2-S 原实现][rtdetr] | 另一种检测器对照 | 提供预训练和部署路线，代码 Apache-2.0；需在篮球样片上比较，不能用论文不同硬件的 FPS 直接排名 |
| [SAM 2][sam2] | 选定球员的轮廓与前景遮挡蒙版 | 适合重点片段精修；需要提示 / 初始化，不能直接包办球员身份和球场标定，多目标视频需另测耗时 |
| [RelateAnything][relate] | 检测后的区域关系候选 | 依赖外部区域输入；先证明相较几何与时序规则有增益，详见[前一轮报告](video-overlay-vision-assessment.md) |

**建议只保留一个当前基线和一个替代候选开展同样本比较。** 当前基线用 YOLOv8s + ByteTrack；替代优先考虑 YOLOX-S + ByteTrack，若确定需要同时整合分割和姿态，再评估 RTMDet 体系。不要在未验证收益时把多个大模型串入每一帧。

许可也影响可交付性：Ultralytics 提供 AGPL-3.0 与商业许可路径；替代方案的代码许可证较宽松，但仍需核查权重和依赖。这里不据许可证名称直接判定赛事私有仓库必须公开，也不把代码许可证等同于所有资产的授权。[Ultralytics 许可说明][license]

## 6. 如何接入 Agent，并迁移到 AWS

建议的数据流为：

```text
原视频 → Agent 提交视频任务 → 常驻 GPU 视觉进程
      → 带时间戳的轨迹、脚下锚点、球场映射与质量标记
      → Agent 组织战术讲解 → 原画面叠加与编码 → 返回成片
```

- Agent 按一次视频任务调用工具，读取结构化结果；逐帧视觉计算留在工作进程中。接口字段属于待验证设计，不是已确认的赛事数据格式。
- 模型常驻并预热，任务按容量排队，复用视频解码及中间结果。尽量避免反复启动 Python、加载权重和重复传整段视频。
- 脚下锚点与轨迹逐帧更新；球场标定结合关键帧与镜头变化；姿态、蒙版和关系模型先按讲解需要处理选定片段。
- 本地先跑通 Python 工作进程，然后验证固定依赖的 Linux GPU 容器。AWS 可用 EC2 GPU 直接承载，或以 ECS 的 EC2 GPU 容量运行容器。[ECS GPU 官方文档][ecs]
- 当前 Fargate 任务不支持 GPU；不能直接把这条 GPU 流程放入普通 Fargate 任务。[Fargate 限制][fargate]
- 可先保存 PyTorch / ONNX 模型，在目标机器验证运行库；TensorRT 引擎应在目标环境构建与验证。版本与硬件兼容需要明确配置，不能默认把笔记本生成的引擎原样搬到云 GPU。[导出文档][export]、[TensorRT 兼容性][tensorrt]
- Agent 服务仍须满足赛事要求。培训纪要没有清晰确定服务名称，本轮不自行指定为某个 AWS Agent 产品。

### 云端硬件候选与赛事已知信息

| 官方公开产品 | GPU | 如何用于后续比较 |
|---|---|---|
| [EC2 G4dn][g4] | NVIDIA T4 | 可作为推理候选；不能假定比本机更快 |
| [EC2 G5][g5] | NVIDIA A10G，标称每卡 24 GB 显存 | 可评估较多模型、高分辨率或更大批次的显存需求 |
| [EC2 G6][g6] | NVIDIA L4，标称每卡 24 GB 显存 | 可评估视觉推理与视频处理；具体实例还要选 CPU 和内存规格 |

以上为 AWS 产品规格，**尚未证明赛事账号获准使用**。本轮重新读取了[赛事公开页面][contest]及[9 月 28 日培训纪要][minutes]：

- 纪要提到每队一个 AWS 账号、指定区域，以及 EC2、容器等常见服务；提到消费上限，但未给出金额。
- 未发现具体 GPU 实例清单、GPU 数量、显存或服务配额。纪要为录音转写，区域等疑点仍按[赛事资料整理](../../requirements/BroadcastCode赛事资料整理.md)待核实。
- AWS 文档列出的按需 G / VT 实例默认 vCPU 配额为 0，实际账号配额可能不同；还要确认指定区域的供应与权限。[EC2 配额文档][quotas]

因此，迁移可行性可以确认到“有官方支持的部署路线”；真正可用的比赛配置要以团队账号、Portal 指南或主办方正式答复为准。本轮没有登录赛事 AWS 账号，也未创建、购买或压测实例。

## 7. 如何检验 10 分钟目标，何时升级硬件

完整任务应分别记录：上传 / 排队、冷启动、解码与视觉分析、解说与配音、叠加编码、产物传输，总计与 600 秒比较。任务开始点和输入最长时长需要在产品验收中固定；输入时长不受限时，无法保证统一的完成上限。

当前结果仅显示一个短片段的检测跟踪有余量。建议下一轮使用现有素材中不同机位、遮挡和镜头运动的代表片段，并加入较长片段；测量最终成片耗时和视觉质量后，再决定是否换模型或设备。

升级触发条件建议如下：

1. **显存不足**：增加高分辨率、分割或多个常驻模型出现显存不足，再考虑 16–24 GB 显存档位，或先按阶段加载、减少批次。
2. **GPU 推理成为主要耗时**：比较目标 GPU 上相同模型、精度和视频的实测结果，再决定升级。
3. **CPU、编码或传输成为瓶颈**：调整视频处理流程与对应资源。仅增加 GPU 不一定能缩短这一部分。
4. **识别效果不足**：先改球场筛选、标注、模型或微调。更大显存为更大模型提供条件，但不能保证减少遮挡漏检、身份交换或战术误判。

现阶段建议继续用当前电脑，不需要先购置设备；也不建议现在将最大检测器、全程分割、全程姿态和关系模型全部开启。

## 8. 复现与来源

从仓库根目录运行。环境需先具备适配显卡的 CUDA PyTorch；本次使用已有环境，新机器应独立验证 GPU 运算。示例采用本轮实际版本：

```powershell
python -m venv --system-site-packages tmp/vision-deploy-bench-venv
tmp/vision-deploy-bench-venv/Scripts/python.exe -m pip install ultralytics==8.4.63 lap==0.5.13
tmp/vision-deploy-bench-venv/Scripts/python.exe -u engineering/scripts/benchmark_vision_baseline.py --video data/videos/nba/2024-25/clips/IND-OKC_Q4_pick-pop_8.1s_1080p.mp4 --model tmp/vision-deploy-bench/yolov8s.pt --tracker bytetrack.yaml --imgsz 640 --output tmp/vision-deploy-bench/reproduction.json --snapshot artifacts/vision-deployment-benchmark/reproduction.jpg
```

先从官方资产下载本轮权重至上述本地目录：[YOLOv8s 权重][weights-s]、[YOLOv8n 权重][weights-n]。脚本要求视频和权重已在本地，不自动下载。视频来自仓库 Git LFS 素材，下载方法见[管理规范](../../docs/video-data-management.md)。原始结果记录输入与权重 SHA-256，可据此核对复现版本。

本轮已做：CUDA 实际运算、10 次完整片段推理、三张诊断图检查、脚本语法检查及结果汇总一致性核验。尚未做：准确率标注评测、其他检测器对照、容器打包、AWS 部署、完整成片计时。

所有下列动态文档 / 仓库页面采集日期均为 2026-10-01。训练和部署能力来自官方文档；推荐顺序、升级条件和接口安排是本项目建议。

[yolo]: https://docs.ultralytics.com/models/yolov8/
[tracking]: https://docs.ultralytics.com/modes/track/
[export]: https://docs.ultralytics.com/modes/export/
[license]: https://www.ultralytics.com/license
[bytetrack]: https://github.com/FoundationVision/ByteTrack
[botsort]: https://github.com/NirAharon/BoT-SORT
[yolox]: https://github.com/Megvii-BaseDetection/YOLOX
[rtmdet]: https://github.com/open-mmlab/mmdetection/tree/main/configs/rtmdet
[rtmpose]: https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose
[rtdetr]: https://github.com/lyuwenyu/RT-DETR
[sam2]: https://github.com/facebookresearch/sam2
[relate]: https://github.com/Maelic/RelateAnything
[ecs]: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-gpu.html
[fargate]: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html
[g4]: https://aws.amazon.com/ec2/instance-types/g4/
[g5]: https://aws.amazon.com/ec2/instance-types/g5/
[g6]: https://aws.amazon.com/ec2/instance-types/g6/
[quotas]: https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html
[tensorrt]: https://docs.nvidia.com/deeplearning/tensorrt/latest/inference-library/version-compatibility.html
[contest]: https://builderx.csdn.net/bcast-code?from=yaofoundation#eligibility
[minutes]: https://csdn.feishu.cn/docx/FS05dToF1oUmTGxaEjdckPD1nwe
[weights-s]: https://github.com/ultralytics/assets/releases/download/v8.4.0/yolov8s.pt
[weights-n]: https://github.com/ultralytics/assets/releases/download/v8.4.0/yolov8n.pt
