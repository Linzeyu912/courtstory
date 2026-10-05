# 脚下地面点与球场映射：现成工具核查

采集日期：2026-10-02，Asia/Shanghai。按用户最终更正，调研范围为 **GitHub 与 Hugging Face**。本文件是工程选型建议，不是赛事要求或团队选型结论。

工作已按用户后续要求分开：双模型工作台接入先以 `aa2ba4f` 推送到 `main` 并核对远端；ByteTrack 后续由另一合作者处理。本研究随后独立整理，只讨论地面脚点与 2D 球场量化，不追加跟踪引擎开发。

本轮用 Exa 在三个方向检索：RF-DETR 的输入流程、脚部定位与接触状态、篮球场标定。相关检索返回 42 条结果（含重复及不适用项），再读取作者代码、模型文件列表、配置和许可证。新增候选均为源码与下载入口核查，**没有安装、下载权重或运行它们**；KaliCalib 的既有本机实验另见[之前的记录](court-calibration-research.md)。工作台检测 / 跟踪接入的实测应以本轮独立运行记录为准。

## 结论

已有工具能够替换部分环节，不必把脚点与透视变换全部从头训练。但目前没有核实到一个已在我们的 NBA 转播片段上验收、同时完成“身份持续跟踪、真实地面点、移动镜头标定、米制轨迹”的现成小模型。

建议优先验证两项：

1. **RTMPose-s Halpe26**：复用现有球员框，提供脚踝、脚趾和脚跟候选，改善框底中心这个粗略代理点。
2. **YOLO11n 篮球场 48 点模型 + 已有透视计算**：权重很小，能够提出场地点；接入前必须明确 48 个点的球场语义和尺寸。该映射表当前未在核查到的模型文件与数据配置中找到。

真正的脚地接触分类有研究实现，适合作为后续实验；不能把“识别到脚踝 / 鞋跟”直接升级为“确认接触地面”。自动场地初始化仍可与已有 KaliCalib 作同片段对照，人工校准继续保留。

## 1. E-BARD RF-DETR Nano 怎样处理视频

它是**单帧目标检测器**。E-BARD 作者的[模型卡](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models)将输入描述为单帧，输出篮球、篮筐、球员、裁判四类框；[评估源码](https://github.com/GabrieleGiudic/E-BARD/blob/main/detection/eval/yolo_vs_detr.py)循环读取图片后调用 `predict(img)`。[RF-DETR 官方视频示例](https://rfdetr.roboflow.com/develop/learn/run/detection/)同样先用 OpenCV 解码一帧，再调用 `predict(frame_rgb)`。

因此，接到视频上时应按以下方式组织：

```text
视频帧 → E-BARD 检测框 → ByteTrack 临时 T 编号
                         ↓
               人工按区间关联到 P 身份
                         ↓
            脚下位置候选 / 人工修正 → 当前帧球场映射
```

- 对多张图片作批处理只改变推理调度，不等于学习跨帧身份。
- [ByteTrack](https://github.com/ifzhang/ByteTrack) 使用前后帧检测结果维持轨迹；人物交叉、遮挡和漏检仍可能换号。固定 P 身份和人工区间关联属于我们上层的数据整理。
- 检测框、跟踪编号、真实身份、地面点、米制坐标应各自保留来源和状态，不能只用一个置信度代表全部可靠性。
- E-BARD 的 YOLO 与 RF-DETR 类别 ID 应各自核对，不能沿用 COCO 的类别表。作者旧比较脚本的 RF-DETR 参数问题见[已有评估](ebard-assessment.md#作者评估的可用范围)，不能照抄其 `conf_threshold` / `resolution` 调用作为当前版本接口。

## 2. 四个适配候选

| 候选 | 已核实的可用内容 | 在我们的流程中做什么 | 尚需验证 / 补齐 |
|---|---|---|---|
| **RTMPose-s Halpe26，经 rtmlib 运行** | 作者配置、预训练 ONNX 下载；输入 192×256（宽×高），26 个关键点；官方参数表为 5.70M | 对已有球员框定位脚趾、脚跟和脚踝 | 远端鞋只有少量像素；遮挡 / 抬脚时关键点可不可靠；不输出真实接触状态 |
| **YOLO11n basketball court keypoints** | HF `best.pt` 为 7,934,664 字节；48 点及逐点置信度 | 提出场地关键点，接现有人工确认和单应矩阵求解 | 点编号到真实场地的映射表缺失；未核实 NBA 尺寸、训练分区独立性或镜头变化精度 |
| **Contacts and Human Dynamics，接触检测子模块** | 作者提供 3,854,707 字节预训练权重与 2D 姿态序列推理脚本 | 判断左右脚跟 / 脚趾的逐帧接触状态，可辅助拒绝抬脚候选 | 输入 OpenPose 姿态序列；需适配我们的关键点格式和多人跟踪；历史环境较旧；仅限非商业研究的许可 |
| **KaliCalib，既有对照** | 篮球专用关键点网络、两份权重、RANSAC / 相机标定代码 | 自动提出场形与初始地面映射 | 本机已做过部分网络实验，不能当本轮新能力；FIBA 模板与 NBA 不同，完整作者管线和新片段仍未验收 |

### 2.1 RTMPose-s：最适合先补“鞋在哪里”

来源：[MMPose 官方 Halpe26 模型表](https://github.com/open-mmlab/mmpose/blob/main/configs/body_2d_keypoint/rtmpose/body8/rtmpose_body8-halpe26.md)、[rtmlib BodyWithFeet 配置](https://github.com/Tau-J/rtmlib/blob/main/rtmlib/tools/solution/body_with_feet.py)、[Halpe26 点定义](https://github.com/open-mmlab/mmpose/blob/main/configs/_base_/datasets/halpe26.py)。

Halpe26 的左右脚踝为 15 / 16，大脚趾为 20 / 21，小脚趾为 22 / 23，脚跟为 24 / 25。与先前 YOLOv8s-pose 只提供脚踝相比，它更接近我们要检查的鞋底区域；这仍是人体关键点，不能直接视为鞋底接触像素真值。

`BodyWithFeet(lightweight)` 配有 YOLOX 检测器和 RTMPose-s。已有 E-BARD 框时，可调用[底层 RTMPose 的 `image, bboxes` 接口](https://github.com/Tau-J/rtmlib/blob/main/rtmlib/tools/pose_estimation/rtmpose.py)，复用球员候选，避免再检测一次所有人物。这是根据公开接口提出的接法，尚未在本项目运行。

- 作者 ONNX 压缩包：[rtmpose-s Halpe26](https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-s_simcc-body7_pt-body7-halpe26_700e-256x192-7f134165_20230605.zip)。本轮只做 HEAD 请求，返回 200，21,371,025 字节；没有下载或验证模型输出。
- Hugging Face 上也找到 [pocketpose 的 Halpe26 ONNX 文件](https://huggingface.co/pocketpose/onnx-models/tree/main/pose_estimation-halpe26)，s 版约 22.8 MB。它是另一个发布者的打包，模型卡标 CC BY-NC 4.0，不能直接继承 OpenMMLab 代码的许可。
- [rtmlib 代码](https://github.com/Tau-J/rtmlib/blob/main/LICENSE)与 [MMPose 代码](https://github.com/open-mmlab/mmpose/blob/main/LICENSE)标 Apache-2.0；本记录不把代码许可自动扩展到所有训练数据或镜像权重。
- rtmlib 提供 ONNXRuntime / OpenCV 等后端。单人模型参数小不代表十人逐帧管线的耗时已知，需测完整裁框、姿态、关联与输出时间。

### 2.2 篮球场 48 点小模型：可试跑，但还缺点的含义

来源：[HF 模型卡](https://huggingface.co/koppolusameer/yolo11n-basketball-court-keypoints)、[文件列表](https://huggingface.co/koppolusameer/yolo11n-basketball-court-keypoints/tree/main)、[数据配置](https://huggingface.co/datasets/koppolusameer/basketball-keypoint-detection-yolov8/blob/main/data.yaml)。采集时模型提交为 `6cb899251439982067a81baa225b33f45f335981`。

模型卡明确输出像素坐标和 48 个点的置信度，米制映射是独立后续步骤。`data.yaml` 确认 `kpt_shape: [48, 3]`、一个 `court` 类和左右翻转索引，但没有各点名称与米制坐标。模型仓库仅有 `.gitattributes`、`README.md`、`best.pt`。这意味着不能只按数组顺序随意配到我们 A–J 参照点。

本轮对权重入口 HEAD 请求返回 200；未下载、运行或测准确率。建议试跑先显示编号点和置信度，取得 / 核对模板语义后，再拟合地面映射。人工仍可选择可见交点建立对应。

许可按来源分别保留：[模型卡原文](https://huggingface.co/koppolusameer/yolo11n-basketball-court-keypoints/raw/main/README.md)标 AGPL-3.0；[HF 数据卡](https://huggingface.co/datasets/koppolusameer/basketball-keypoint-detection-yolov8)标 MIT，但数据包 `data.yaml` 的 Roboflow 来源栏标 CC BY 4.0。它们不是同一条可互换的声明。本轮不据此作云端分发结论。

### 2.3 接触检测：有小权重，但依赖可靠姿态序列

来源：[作者 GitHub](https://github.com/davrempe/contact-human-dynamics)、[预训练权重脚本](https://github.com/davrempe/contact-human-dynamics/blob/main/pretrained_weights/download.sh)。这是 ECCV 2020 项目的一个子模块，输入已提取的 2D 姿态序列，输出每帧左脚跟、左脚趾、右脚跟、右脚趾四个二值接触标签。仅运行接触检测不需要完整物理重建管线，但仍需要姿态输入。

预训练文件 HTTPS 入口 HEAD 返回 200、3,854,707 字节，未下载。作者环境为 Ubuntu 16.04 / Python 3.6，训练素材包含合成角色运动。因而它不能直接证明适合多人遮挡、远景鞋点和摇镜 NBA 片段。将 RTMPose 输出替代 OpenPose 前，要核对点定义、归一化、置信度与时间窗口；不能把数组尺寸对齐视为已适配。

[LICENSE.txt](https://github.com/davrempe/contact-human-dynamics/blob/main/LICENSE.txt)为 Adobe Research License，明确限非商业研究。本轮把它列为“接触状态实验对照”，不直接引入生产服务。

### 2.4 KaliCalib：继续利用已经做过的实验

[作者仓库](https://github.com/CEA-LIST/KaliCalib)和[论文](https://arxiv.org/abs/2209.07795)提供篮球场关键点网络和透视估计。我们之前已跑过作者网络：部分帧能给接近球场的候选，也出现明显失败；原生 28×15 米 FIBA 模板尚未完整适配 NBA。[之前的实验](court-calibration-research.md)已记录输出和限制。

它应作为新场地模型的对照，而不是宣称现在已经自动标定准确。作者失败回退到平均映射的机制不能直接作为工作台可靠坐标输出；失败时应保留失效状态或要求人工校准。仓库 [LICENSE.txt](https://github.com/CEA-LIST/KaliCalib/blob/main/LICENSE.txt)为 CeCILL 2.1。

## 3. 找到了，但暂不作为首选

| 项目 / 来源 | 实际内容 | 不直接接入的原因 |
|---|---|---|
| [FECO](https://github.com/dqj5182/FECO_RELEASE) + [作者 HF 权重](https://huggingface.co/datasets/dqj5182/feco-checkpoints/tree/main/CVPR2026) | 密集足部接触估计；含 ResNet18 至 ViT-H 多份权重 | ResNet18 文件仍有 378,911,829 字节，ViT-H 约 4.21 GB；本机速度未知。代码标 CC BY-NC 4.0，当前 demo 只取首个人物的右脚裁图，输出足部模板接触值，不能直接给原图地面坐标 |
| [sports-field-homography](https://github.com/darkAlert/sports-field-homography) | UNet + STN 预测矩阵，含点映射示例 | README 声称可自动下载，但核查到的[下载脚本](https://github.com/darkAlert/sports-field-homography/blob/master/scripts/download_s3.sh)指向 `s3://boost-cv-models/boost-court-models` 并涉及凭据，未验证公开可下载检查点；不作为已就绪模型 |
| [PnLCalib](https://github.com/mguti97/PnLCalib) | 有点、线模型及权重，联合几何优化 | 训练与模板针对足球；可参考点线约束，不能把现成权重直接称为篮球模型 |
| [HF basketball-keypoint-detection-yolov8 数据集](https://huggingface.co/datasets/koppolusameer/basketball-keypoint-detection-yolov8) | 图片及 YOLO 关键点标签；可为微调和模板调查提供材料 | 数据集本身不是可推理模型；训练数据条数也不能代表场地定位已达到验收精度 |

FECO 的 [demo.py](https://github.com/dqj5182/FECO_RELEASE/blob/main/demo.py)和[接触可视化](https://github.com/dqj5182/FECO_RELEASE/blob/main/lib/utils/vis_utils.py)已核查；作者 ResNet18 权重入口 HEAD 返回 200。它证明“真实接触建模有现成研究”，但不能用一张鞋底接触渲染图替代球员在原图中的地面位置。以上新增项目均未在本机运行。

## 4. 2D 转换已有成熟工具，难点是给对输入

[OpenCV 的单应矩阵教程](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)已经提供平面映射原理和代码。已有工作台也实现了具名地面点、多点拟合、留出核验及关键帧插值；不需要再训练一个网络来执行矩阵乘法。

**不必先求出相机夹角，才能把地面点转为 2D 坐标。** 已知至少四个有效、没有三点共线的地面点对应关系，就能估计平面映射。四点必须知道真实身份与场地坐标；四个禁区角可以建立禁区的对应，不能当成全场四角。如果另要解出相机俯仰 / 朝向、焦距和距离，单帧四个点并不足以无条件唯一确定这些物理量；还需要相机内参或额外约束。OpenCV 的姿态恢复示例也明确假定内参已知。因此我们的优先目标应是校准可核验的地面映射，相机角度可作为另一个结果。

对每帧 `t`，建立真实场地地面 `(X,Y)` 到图像 `(u,v)` 的单应矩阵 `H_t`：

```text
[u, v, 1] ∝ H_t × [X, Y, 1]
[a, b, c] = inverse(H_t) × [u, v, 1]
球场坐标 = (a/c, b/c)
```

实际工程要保证：

1. **语义正确**：禁区角配禁区角，中线与边线交点配对应交点，不能把禁区四角当整场边界。四点需构成有效二维布局；可用更多分散点和线约束。
2. **同一平面**：用于地面单应的参照必须在地面。脚踝或抬起的鞋底不满足这个条件。只有确认接触的脚部点才可直接按地面点投影；双脚离地时保留估计 / 未知状态。
3. **时间同步**：移动镜头要更新映射，切镜重建；静态一张 H 不能覆盖整段摇镜。光流传播还要定期重校，已有漂移实验见前文链接。
4. **独立核验**：留出未参与拟合的场地点；轨迹检验还需人工标注的真实脚部参考。拟合残差小不等于球员真实位置误差小。

建议接口分别保存左右脚的候选和接触状态，再定义本项目的“球员位置”：单脚支撑时采用已确认的支撑点，双脚接触时可以约定为两个地面支撑点的中点；遮挡或腾空时保留未知 / 估计，不能把可见鞋点直接当落地位置。这个约定是工程建议，尚未实现或形成团队共识。最终每条量化记录应保留像素点、来源帧、接触依据、所用标定和米制坐标，方便之后人工追溯。

## 5. 篮筐和篮球值得检测，但要分别使用

- **篮筐**：可辅助判断攻防方向、球篮身份、局部区域和场形一致性。篮圈在地面上方，其图像中心不能配到地面模板上作为第五个平面参照点；检测框中心也未必是篮圈的几何中心。若要用于相机姿态求解，需要带高度的三维几何与相机参数方案。[KaliCalib 论文](https://arxiv.org/abs/2209.07795)也明确把篮筐作为辅助网络任务，而不把篮筐点用于地面单应拟合。
- **篮球**：应先保留原图球心、框、置信度及独立轨迹。持球、传球、投篮中的球通常离地，直接经过地面单应得到的是“把该图像点假设在地面”的位置，不是实际篮球的水平位置。需要高度 / 多视角 / 轨迹约束等额外信息才能恢复真实三维运动。
- **2D 展示**：可以显示当前进攻篮筐这一固定场地对象；可把未确认高度的球作为原图标记。若在 2D 显示球的代理位置，必须明确其假设，不能混进球员地面坐标作为真值。

这些边界来自投影几何和上述模型输出定义，不代表本轮已完成三维球轨迹或物理相机参数恢复。

## 6. 建议下一轮怎样验收

建议在现有三个验收视频上，先做同帧并排对照，再决定是否替换当前脚点和场地候选：

- **脚部**：框底中心、既有 YOLOv8s-pose 脚踝、RTMPose-s 脚趾 / 脚跟同屏；人工分别记录清晰、远端、遮挡、单脚支撑、腾空片段。考察可确认地面点的覆盖率与修正次数，不只看“出了几个关键点”。
- **场地**：人工标定、KaliCalib、48 点模型使用同一批独立核验点；分别报告像素偏差、有效映射覆盖、米制核验偏差、失败和左右场误认次数。
- **轨迹**：把自动 T 号中断 / 串号与人工 P 关联分开；比较完整轨迹覆盖、人工重连次数与修正耗时。插值明确标估计，不能计为模型直接观测。
- **运行时间**：测解码、检测、跟踪、脚部推理、场地更新与写盘的总耗时；逐人姿态应计十人负载。无需用作者其他硬件上的单模型延迟承诺本机或 AWS 完整流程。

本轮调研没有产生新精度、速度或商业部署结论。用户要求的可操作检测器选择、球 / 篮筐显示和 ByteTrack 演示属于并行实现，应在各自运行记录中说明实际完成状态。
