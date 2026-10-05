# E-BARD 检测模型：源码核查与本机对照

采集与实测：2026-10-02，Asia/Shanghai。来源为用户提供的 [Hugging Face 模型仓库](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models)。这是工程选型建议，不是赛事要求或团队已确认选型。

## 结论

**建议把 E-BARD YOLOv8n 作为下一轮篮球人物候选检测器进行接入验证。** 本机三个验收视频的离线结果显示，它能够将球员和裁判分开，并减少抽查画面中场边人员进入球员候选的情况。运行速度与现有通用 YOLOv8s 相近，当前不需要为这一步换更高配置设备。

它输出检测框、类别和分数。持续身份、球队、号码、脚下地面点、球场映射仍需其他模块；本轮未替换工作台候选或修改人工草稿，没有完成独立准确率、跟踪质量或完整成片时限验收。

## 权重与能力边界

作者仓库提供两种篮球微调检测器：YOLOv8n 和 RF-DETR Nano。YOLO 文件为 6,151,282 字节；RF-DETR `checkpoint_best_total.pth` 为 120,811,190 字节，不需要下载整个模型仓库。来源：[文件列表](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models/tree/main)。本次只下载并试跑 YOLO，未安装 RF-DETR 或全部作者依赖。

YOLO 权重 SHA-256：`dfe3534d51bb21024d1a400c37f0c1fbf0c8b96ea9a56a5f3cb5454813bfd641`，与 [HF 文件页](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models/blob/main/BODD_yolov8n_0001.pt)一致。使用已有环境和受限 `weights_only` 加载，类映射实读为：

| 类别 ID | 类别 | 可用于工作台的环节 |
|---|---|---|
| 0 | basketball | 篮球候选；本轮仍有漏检和重复框 |
| 1 | hoop | 篮筐候选；篮筐有高度，不能当作地面参照点 |
| 2 | player | 球员检测框，之后接跟踪和人工 P 身份 |
| 3 | referee | 裁判单独保留，可选关联到 R 身份 |

检查点记录 Ultralytics 8.3.101、训练输入 704；实际网络参数 3,006,428 个。无需重新训练即可推理。作者模型卡所列数据来自 NBA 2024–25 画面；现有历史转播样例的不同球衣、画质和遮挡仍需另行验收。[模型说明](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models)

## 本机实测

脚本：[benchmark_ebard.py](../../../engineering/scripts/benchmark_ebard.py)。完整摘要：[ebard-probe.json](ebard-probe.json)。

- 本机 NVIDIA GeForce RTX 5070 Laptop GPU 8 GB，PyTorch 2.11.0+cu128、Ultralytics 8.4.63；GPU FP16，batch 1。
- 输入为验收库 004 勇士电梯门、005 马刺挡拆、006 马刺弱侧转移，视频哈希逐一与登记核对。共 815 帧，约 29 秒。
- 两种模型分别测试 imgsz 704 / 960，conf 0.25、NMS IoU 0.5；使用保持比例的 letterbox。共 12 次片段运行、3,260 次帧推理。
- 通用模型只取 COCO person；E-BARD 保留四类。两者均不加场地 / 球衣 / 画面区域过滤，不启用 ByteTrack。
- 当前正式候选生成器使用 conf 0.07、imgsz 960 和几何筛选，因此这里是检测器同条件对照，不是与正式工作台最终候选的直接准确率比较。

### 耗时

单次运行，单位秒。包含视频解码、检测调用、结果回传和采集；不含模型加载、预热、绘图和 JSON 写盘，也不含跟踪、球场标定或人工操作。

| 输入设置 | 模型 | 004：210 帧 | 005：143 帧 | 006：462 帧 | 总计 |
|---|---|---:|---:|---:|---:|
| 704 | 通用 YOLOv8s | 3.37 | 2.61 | 8.57 | 14.55 |
| 704 | E-BARD YOLOv8n | 3.32 | 2.58 | 8.29 | 14.19 |
| 960 | 通用 YOLOv8s | 3.59 | 2.90 | 9.23 | 15.72 |
| 960 | E-BARD YOLOv8n | 3.27 | 2.59 | 8.33 | 14.19 |

E-BARD 的逐片段 predict 调用中位数在 704 输入下为 7.18–7.42 ms，在 960 下为 8.16–8.27 ms。解码等开销使纯网络大小的优势不等于整段明显加速；这次样本不支持“大幅更快”的结论，也没有 AWS 实测或十分钟完整成片保证。

### 目视抽查

对照预览每片选第 0、约 1/3、约 2/3、末帧，共 24 张双模型对照图，保存在本机 `artifacts/ebard-probe/`。本轮重点目视检查以下 5 张；不是逐帧人工标注集。

| 画面 | 观察 |
|---|---|
| 004 / 704 / 第 0 帧 | 通用模型共 14 个 person 框；E-BARD 输出 10 个 player 和 3 个 referee，场边观众候选明显减少。数量不证明十个人全都正确 |
| 004 / 704 / 第 209 帧 | 通用模型还框出了场边工作人员和观众；E-BARD 主要保留画面内 6 个球员候选。画面裁切后不足十人是可能的，不能一概称为漏检 |
| 006 / 704 / 第 308 帧 | 大部分观众候选被排除，但近侧裁判仍有跨类别重叠框，篮球候选也需复核 |
| 006 / 960 / 第 154 帧 | 输出 11 个 player、3 个 referee；可见近侧裁判同时被标成球员，局部有重复框。需要跨类别冲突处理和时序复核 |
| 005 / 960 / 第 142 帧 | 篮筐附近出现两个 basketball 候选，不能直接当作可靠的球轨迹 |

增加输入尺寸没有稳定消除错误。不同类别的同一对象可能同时保留，类别 NMS 与后续跟踪应联合检查；简单限制最多十个框也不能保证保留正确球员。

## 作者评估的可用范围

模型卡中 YOLO 球员 F1@IoU0.5 约 0.950、裁判约 0.929，篮球召回约 0.566。原作者[比较日志](https://github.com/GabrieleGiudic/E-BARD/blob/main/detection/eval/yolo_vs_detr.out)确有对应数值。这是检测框的类别评估，不是身份、脚点或轨迹正确率。

本轮同时核查作者代码和数据包，发现以下边界：

1. **没有按比赛隔离。** 通过 HTTP Range 读取[公开数据包](https://huggingface.co/datasets/GabrieleGiudici/E-BARD-detection/blob/00563215490c9a9642797b1495ea178535b3f59c/all.zip)中央目录：train 1,440 帧 / 60 场、val 180 帧 / 59 场、test 180 帧 / 56 场。相同图片文件名没有跨分区重复，但验证、测试的比赛都在训练中出现。这能评价同批比赛的留出帧，不能直接代表新比赛泛化。
2. **公开 YAML 与历史训练日志不一致。** 数据包 `yolo/data.yaml` 的 val 指向 `test/images`、test 指向 `val/images`；历史[训练日志](https://github.com/GabrieleGiudic/E-BARD/blob/main/detection/src/yolo/train.out)却读取 val、180 帧 / 2,220 实例，之后[评估日志](https://github.com/GabrieleGiudic/E-BARD/blob/main/detection/src/yolo/eval.out)读取 test、180 帧 / 2,210 实例。复现前应核对配置；不能据此断言当前权重用测试集选优。
3. **RF-DETR 比较参数没有按声称生效。** 作者[依赖](https://github.com/GabrieleGiudic/E-BARD/blob/main/detection/requirements.txt)固定 rfdetr 1.3.0，[比较脚本](https://github.com/GabrieleGiudic/E-BARD/blob/main/detection/eval/yolo_vs_detr.py)传 `conf_threshold=0.25` 和 `resolution=704`；该版官方 [predict](https://github.com/roboflow/rf-detr/blob/1.3.0/rfdetr/detr.py#L201)只使用 `threshold`，额外 kwargs 未应用。按公开代码运行会保留 0.5 阈值及模型配置分辨率，不能据此作严格同条件排名。RF-DETR 本轮未实测。

这些问题限制公开数字的解释，不否定本机看到的检测改善。作者 GitHub 核查版本为 `f8314e03179b6558fb6ef0d26a9135fdc3572b78`。未运行作者训练 / 评估代码，也未完整下载其数据集。

## 接入时必须改的地方

现有 [build_review_tracks.py](../../../engineering/scripts/build_review_tracks.py)固定 `classes=[0]`，在 COCO 中是人，**在 E-BARD 中是篮球**。不能只替换权重文件名就沿用这个配置。建议下一轮：

1. 单独增加实验检测配置，按权重的类别名称找到 player（当前 ID 2）；裁判（ID 3）可用独立类别通道保留。
2. 检查同物体跨类别重复和逐帧类别跳变；将 player 候选接到 ByteTrack，再比较漏检、ID 切换和每人轨迹覆盖率。篮球、篮筐不能混进人物 ID。
3. 为新跟踪结果使用独立版本指纹和草稿，不能把新 T 编号直接套进已有 P 的人工关联。
4. 继续使用已有脚点 / 框编辑和人工身份分界。框底中心仍是脚下位置代理；地面点与相机映射的精度单独验收。

本轮以模型评估为范围，完成下载、运行和源码核查；上述接入仍是建议。没有改正式服务、候选、视频或用户草稿。

## 复现与本轮验证

从仓库根目录，用已有视觉环境运行；首次需从上面的官方模型页取得权重，保存到默认参数位置，或显式传 `--ebard`。无需新训练、安装 RF-DETR 或下载全部模型仓库。

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/benchmark_ebard.py --output artifacts/ebard-probe-new
```

脚本拒绝覆盖已有 report，逐一核对视频哈希，对照既有通用权重，使用明确的已知架构 allowlist 进行受限加载。原始检测、预览和权重留在被忽略的 `artifacts/` 与 `tmp/`；共享摘要只包含模型哈希、参数和测量。12 组输出帧数、顺序、时间戳、框格式通过检查，脚本通过编译检查。本轮没有改工作台运行逻辑，因此未重跑 UI 回归或替用户点击正式确认。
