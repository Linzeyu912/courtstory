# 场地小模型实测：保留候选工具，先由人工确认初始几何

日期：2026-10-02，Asia/Shanghai。范围：004 GSW–MEM 第四节、005 SAS–MIA 第四节、006 SAS–MIA 第二节三个本地验收视频。对阵与节次用于识别素材，战术标签仍需后续分析确认。本文是工程实验，不是赛事官方要求、部署承诺或团队共同选型。

## 结论

已经下载并实际运行 **YOLO11n 篮球场 48 点模型**，与已有 **KaliCalib challenge** 和 OpenCV LSD 直线检测作同帧对比。三个视频各取首帧、1/3、2/3、末帧，共 12 帧；YOLO 分别跑 640、960 两种尺寸。

**当前保留 YOLO11n 作为人工校准的点位候选工具，不能直接接管自动标定。** 它在 005、006 的一些帧能找对禁区和边界，但两种尺寸各有 7/12 帧把左右半场认反；其中 004 的四个抽样帧全部错向。提高分辨率没有稳定解决这个问题。错误候选也可能成功解出单应矩阵，不能用“矩阵可求”代替质量检查。

工作台适合采用：选择 / 确认球篮方向 → 检查具名候选或人工点选 → 用投回原图的场地线核验 → 镜头内传播 → 失效处停下并允许重校。以下模型试验没有修改 ByteTrack。

## 下载与运行范围

- 新权重：[koppolusameer/yolo11n-basketball-court-keypoints](https://huggingface.co/koppolusameer/yolo11n-basketball-court-keypoints)，模型提交 `6cb899251439982067a81baa225b33f45f335981`。`best.pt` 为 **7,934,664 字节**，SHA-256 为 `68e5faf5fb5388cf83477238abe22e9824a69fb33a4cf34f79ab61858f410064`。
- 标签证据：[作者 HF 数据集](https://huggingface.co/datasets/koppolusameer/basketball-keypoint-detection-yolov8)，提交 `98d6979ac482c0ff6945754550e06ac7aa67d941`；下载 5 对公开 test 图片及标签，只用于核对编号语义，没有用于训练或本地准确率评估。
- 对照：[KaliCalib 作者实现](https://github.com/CEA-LIST/KaliCalib/tree/3b3f52b)，使用已有 `model_challenge.pth`，58,264,589 字节。运行作者网络、响应区域中心和 RANSAC 平面拟合，未运行完整相机优化，也未采用默认相机兜底。其原生模板仍是 **28 × 15 米 FIBA**。
- 传统算法：[OpenCV LSD](https://docs.opencv.org/4.x/db/d73/classcv_1_1LineSegmentDetector.html)，960×540 灰度输入，只保留长度至少 60 像素的线段。它没有篮球场语义，不能单独输出 A/B/C/D。
- 本机：RTX 5070 Laptop GPU，现有 PyTorch 2.11 + CUDA 12.8、Ultralytics 8.4.63 环境；CPU OpenCV 4 线程。没有安装新 Python 包，没有训练新模型。

第三方权重和图片仅放在被忽略的 `tmp/court-models-v2/`；可视化与原始输出在被忽略的 `artifacts/court-models-v2/`、`artifacts/court-models-v2-960/`。权重通过 PyTorch `weights_only` 和显式架构白名单加载，遇到未知反序列化类型会拒绝，没有退回任意 pickle 加载。

## 48 个点并不是现成的米制模板

模型卡明确表示像素点到球场坐标是下游步骤，但没有发布完整的 index → 场地位置表。不能直接套用另一个项目的点序。

本次查看原始标签在左右半场图片上的位置，并与 `data.yaml` 中的 `flip_idx` 对照，得到以下**部分工程映射**。它来自标签的目视核查，不是作者正式发布的完整 48 点定义。

| 工作台点 | 场地语义 | 左半场模型索引 | 右半场模型索引 |
|---|---|---:|---:|
| A | 底线 × 远禁区线 | 3 | 38 |
| B | 罚球线 × 远禁区线 | 12 | 29 |
| C | 罚球线 × 近禁区线 | 14 | 31 |
| D | 底线 × 近禁区线 | 4 | 39 |
| E | 底线 × 远边线 | 0 | 35 |
| I | 底线 × 远侧三分直线 | 1 | 36 |
| J | 底线 × 近侧三分直线 | 6 | 41 |

可复查的原始文件包括测试集 `boston-celtics-new-york-knicks-game-1-q1-01_54-01_48_mp4-0005_jpg.rf.V0xGo60oOVweXj2o9XOE`（右半场）和 `...03_16-03_11_mp4-0002_jpg.rf.ez6gsaTqCnUwpiVqnVep`（左半场）的 `.jpg` / `.txt`。下载目录中的 `dataset-0-labels.jpg`、`dataset-1-labels.jpg`、`dataset-2-labels.jpg` 把原标签编号画回了图片。

没有使用未核实的中线索引、篮筐投影中心或三分弧极值来凑四点。特别是有高度的篮圈中心不能作为地面单应点。[Roboflow sports 的篮球分支](https://github.com/roboflow/sports/blob/415751384e34f1cb7089a00909e0d7932fe73a75/sports/basketball/config.py)另有 33 点模板；本次核查确认它与这里的 48 槽位序列不同，未直接套用。

## 速度和失败情况

| 方案 | 预热后中位耗时 | 原始矩阵可求 | 方向正确且矩阵可求 | 左右误认 |
|---|---:|---:|---:|---:|
| YOLO11n，640 | 8.35 ms / 抽样帧 | 8/12 | 3/12 | 7/12 |
| YOLO11n，960 | 10.44 ms / 抽样帧 | 9/12 | 5/12 | 7/12 |
| KaliCalib challenge | 16.98 ms / 抽样帧 | 12/12 | 未以 NBA 模板统计 | 原生场形需逐帧检查 |
| OpenCV LSD | 46.63 ms / 抽样帧 | 不适用 | 不适用 | 无语义输出 |

YOLO 计时含 `predict`、结果回传与 GPU 同步，不含视频读取、加载预热、预览写盘；两次加载 + 3 次预热分别约 3.18 / 3.14 秒。KaliCalib 计时包括预处理、网络、CPU 响应区域计算和 RANSAC；LSD 包括缩放、灰度转换、检测和长度筛选。几种时间口径不同，不能直接把表解释成完整系统速度排名，也不能推算整段视频或 AWS 的十分钟保证。

“方向正确且矩阵可求”仍不是准确率：005 首帧可出现轻微错位，006 后段可出现明显错向，控制点外区域更容易偏移。所有采用候选均标 `needs_review`。

### 首帧粗略目视参考差异

另对三个首帧目视读取可辨认的禁区和外角；部分角被球员遮挡，通过相邻线延长估计。已经看过模型输出，因此这不是盲标，更不是测量真值。只用于诊断，不据此声称米制精度。

| 输出 | 005 首帧 | 006 首帧 |
|---|---:|---:|
| YOLO640 直接点与目视点距离中位数 | 6.3 px（4 点） | 5.5 px（4 点） |
| YOLO960 直接点与目视点距离中位数 | 12.2 px（5 点） | 35.1 px（3 点） |

两种尺寸的可见点数量不同，不能当严格的同点精度对照。004 的 YOLO 左右语义错误，因此不把它的错向点包装成一个正常误差数字。KaliCalib 原生 FIBA 投影与 004/005/006 目视角点的中位差分别为 11.6 / 33.1 / 14.5 px；由于模板不同，这只是场形差异，不能与 NBA 点模型作同口径准确率排名。

## 提供给工作台的候选

保留目视方向正确、至少四个有效具名点且能够拟合的部分帧作为**待用户确认的起点**：

- 004：无可用模型初始化；四个抽样帧的左右识别均错误，保留明确失败说明。
- 005：第 0 帧取 640 输出；第 95 帧取 960 输出。
- 006：第 0 / 154 帧取 640 输出；第 308 帧取 960 输出。

这些是人工查看实验后的选择，不是自动质量分类器。记录在 `artifacts/court-models-v2/<编号>-reviewed-candidates.json`；其中包括来源、输入尺寸、原始点分数、方向核查状态和失败原因。未筛选的 `<编号>-court-candidates.json` 只属于实验原始输出，不应自动导入正式标定。

首帧四方案对比图为 `artifacts/court-models-v2/004-comparison.jpg`、`005-comparison.jpg`、`006-comparison.jpg`。`all-yolo.jpg` 展示 12 帧中的成功和失败，不能只展示接近正确的样例。

## 004：人工初始参考与独立检查点

[court-seed-004.json](court-seed-004.json)记录第 70 帧的人工目视参考：A=(632,272)、B=(139,326)、C=(273,462)、D=(816,386)，右半场 NBA 16ft 禁区。该球场的黄色条带外侧灰线才是选取边界，深蓝色内侧区域更窄。D 被白色 15 号球员遮挡，是线延长估计，需要重点复核。

E=(467,175) 为远侧底线与边线交点，仅作核验。只使用 A–D 拟合时，E 投影与目视位置相差约 **11.27 px**；原先 A=(640,278) 等四点的差异为约 **26.88 px**。A 经局部放大图改选黄色条带外侧交点；E 没有加入拟合。误差变小不能证明整张场地已准确，近 / 远侧更多独立点和用户复核仍必要。

该参考保留 `human_visual_reference` 来源、`needs_review` 状态和遮挡说明，不冒充人工用户确认。它可作为镜头传播实验的起点，传播失败帧必须留空；传播结果的速度和覆盖率由对应管线另行记录。

## 复现与共享产物

脚本：[probe_court_models_v2.py](../scripts/probe_court_models_v2.py)。汇总、逐帧诊断、部分语义表和粗参考：[court-model-comparison.json](court-model-comparison.json)。它们保留失败样例和计时范围。

准备上述作者权重及 KaliCalib 源码后，在仓库根目录运行；输出目录必须新建，以免覆盖旧测量：

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe research/vision/scripts/probe_court_models_v2.py --imgsz 640 --output artifacts/court-models-v2
& tmp/vision-deploy-bench-venv/Scripts/python.exe research/vision/scripts/probe_court_models_v2.py --imgsz 960 --output artifacts/court-models-v2-960
```

脚本校验库中视频哈希，抽取同一组 12 帧，保留全部原始关键点、模型矩阵、编号图、KaliCalib 和 LSD 对比图。人工筛选列表与目视种子是随后核查产生的资料，不由模型脚本自动赋予可信状态。

模型卡标 AGPL-3.0；HF 数据卡标 MIT，而数据包 Roboflow 来源栏为 CC BY 4.0；KaliCalib 为 CeCILL 2.1。分别保留来源声明，本次本机研究不构成云端分发许可结论。
