# 球场边线辅助标定调研

更新：2026-10-03，Asia/Shanghai。来源于本机球场标定代码检查及 Hugging Face / GitHub / 论文原始页面；这是工程调研与建议，不代表团队已选型或精度验收。

## 结论

**中线点不是当前自动标定的必需输入。** 工作区已有 48 点篮球场模型，后端按左右半场分别从 A、B、C、D、E、I、J 对应的地面关键点中取候选，不使用中圈点。代码要求至少 4 个一般位置的有效地面点来拟合单应矩阵，并额外用一个可靠篮筐检测核对场地朝向。由此：中圈被遮挡时，只要别的交点可见、拟合布局不退化且篮筐可靠，仍能提出待复核候选；缺少篮筐时，当前自动入口会返回 `missing_reliable_hoop`。

调研采集时（21:48）的后端把检测到的**点坐标**交给 `cv2.findHomography`，尚未把线缘作为拟合观测。工作台当时已能在原视频四周的画外区域估计 A–J 点，但这和直接标注视频内的线段是两种交互。其后本机实现状态见下方“本轮工程更新”。

机器辅助识别边线可行，适合做成“模型提议 + 几何检查 + 人工确认”。若用户只标两条平行边线，它们不足以唯一决定完整球场单应映射；还需要一条或多条有已知语义的横向线、罚球线、底线、三分线或其它分散的交点约束。具体可见结构不同，最低可用组合也不同。画面外延长线属于估计，不能作为直接观测点等权参与拟合。

## 旋转摇摄 / 俯仰 / 变焦时该怎样标定

这里按用户描述理解为机位大致固定、摄像头云台转动跟随比赛，伴随俯仰和推拉变焦，而不是沿球场平移。**标准球场在世界坐标里始终不变；变化的是每一帧的相机到球场映射。** 透视下球场会呈梯形、近边看起来更长，这不意味着真实球场变形。

将同一段视频导出成 GIF 或把所有帧摊成一张图，不会自动得到一个标准球场。应将 NBA 球场尺寸和线条定义为固定模板，对第 `t` 帧单独估计 `H_t`：图像像素 `p_t ~ H_t [X,Y,1]ᵀ`，其中 `(X,Y)` 是固定球场坐标；再用 `H_t⁻¹` 把该帧中位于地面的像素投到模板。镜头摇摄、俯仰、滚转或变焦时 `H_t` 会变化；不要把整段视频中的像素点取平均，也不要让一张静态映射覆盖镜头运动。

OpenCV 的几何说明指出，平面点与图像之间可用单应映射；纯旋转相机也可用由内参和旋转构成的帧间单应。现阶段直接从已知 NBA 球场模板拟合每帧地面映射更合适，不必先完整恢复相机的三维旋转参数。[OpenCV homography 教程](https://docs.opencv.org/5.0/tutorials/features/homography/homography.html)；体育场地标定研究也把相机 pan / tilt / roll 和场地线、点统一放入重投影误差中求解。[TVCalib 论文](https://openaccess.thecvf.com/content/WACV2023/papers/Theiner_TVCalib_Camera_Calibration_for_Sports_Field_Registration_in_Soccer_WACV_2023_paper.pdf)。

### 建议的帧间流程

1. **固定球场模板**：先明确 NBA 模板坐标、线条类别和尺寸，不根据每帧画面重新定义球场形状。
2. **按视角找关键帧**：在摇摄较慢、线条清楚的帧上，结合现有 48 点模型与球场线分割 / 人工线段，拟合初始 `H_t`。标出可见的边线段，并至少再用一种横向线或交点约束；中圈不需要出现在画面里。
3. **短时传播并持续校验**：相邻帧用光流 / 线特征跟踪作初值，同时重估或小幅修正 `H_t`。快速摇摄、推拉、切镜、画面模糊，或线条投影残差变大时，停止旧映射传播，重新检测 / 标关键帧。
4. **以模板重投影验收**：把标准球场线投回当前原始帧。通过的线应贴合真实可见线条；保留留出线残差、可见范围和不确定状态。线少或几何布局退化时输出“无法可靠标定”，不凭上一帧硬填。
5. **必要时检查非理想成像**：若一张 `H_t` 无法让多条直线同时对齐，且误差随画面位置规律弯曲，可能有镜头畸变、滚动快门、画面拼接或强烈局部变形。先排查原片 / 裁剪和镜头畸变，再考虑带畸变的相机模型；不要把这种系统残差误当成标准球场在移动。

所以建议先做“固定 NBA 模板 + 每帧 / 关键帧独立标定 + 短时追踪更新”，而不是把视频动图变成一张球场图。点 / 线联合优化在同一帧解决可见约束不足和遮挡；时间信息只作初值与漂移检查，不能替代当前帧的线索。

## 既有篮球 / 篮筐检测：沿用，不重复建设

- 工作台当前推荐组合的检测器是 **E-BARD YOLOv8n**；检测器类别 ID 为 `0 basketball`、`1 hoop`、`2 player`、`3 referee`。本机核验的权重文件名为 `BODD_yolov8n_0001.pt`，SHA-256 为 `dfe3534d51bb21024d1a400c37f0c1fbf0c8b96ea9a56a5f3cb5454813bfd641`，上游为 [E-BARD Hugging Face 模型仓库](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models)。默认 detector + tracker 组合见[模型选择配置](../../../engineering/configs/tracking/workbench-models.json)：E-BARD YOLOv8n + BoT-SORT 外观续接。
- [E-BARD 候选生成器](../../../engineering/scripts/build_ebard_review_tracks.py)已经逐帧输出篮球和篮筐检测框，阈值为 0.25；球 / 筐对象与球员 / 裁判身份跟踪分开。工作台已有检测框展示、逐帧人工改点和篮球图像路线串接；它不是新球检测器，也没有给空中球做地面投影。
- [球场自动初始化](../../../engineering/scripts/court_calibration.py)直接复用已登记的 E-BARD 篮筐对象，选择通用人物检测版本时也会读取 E-BARD 篮筐证据。因此新的工作应针对球场识别和标定，不增加第二套球 / 筐检测或重复做篮球轨迹识别。
- **球场模型是另一个模型**：Hugging Face 上的 YOLO11n 48 点模型输出球场关键点，不是篮球检测模型。它和 E-BARD 的职责不同。

用户认可当前篮球识别效果；本段是仓库来源和数据流核对，不构成新的模型准确率判断。

## 本机能力核对

- [自动初始化后端](../../../engineering/scripts/court_calibration.py)调用本机忽略目录中的 `tmp/court-models-v2/best.pt`；球场预测器输出 48 组 `(x, y, confidence)` 像素关键点。模型权重 SHA-256 为 `68e5faf5fb5388cf83477238abe22e9824a69fb33a4cf34f79ab61858f410064`，未入库。
- [方向与拟合代码](../../../engineering/scripts/court_orientation.py)目前选用半场槽位 `{A,B,C,D,E,I,J}`；`_determines_homography` 检查点位几何分布，`_hypothesis` 执行点到点单应拟合及投影残差检查。中场关键点不在映射集合内。篮筐只做方向 / 合理性证据，不作为地面拟合点。
- 现有接口将初始化候选标记为 `needs_review`；没有把可解出矩阵等同于准确标定。模型曾出现半场方向误认，旧实验记录在[场地模型实测](court-model-comparison.md)。
- 目前 48 点模型不生成线段或线掩码；不能单靠它取得任意边线的连续像素证据。

## 公开模型和工具

| 来源 | 做法 | 对当前工作的价值 | 适配边界 |
|---|---|---|---|
| [Hugging Face：YOLO11n basketball court keypoints](https://huggingface.co/koppolusameer/yolo11n-basketball-court-keypoints) | YOLO11n 输出 48 槽位球场关键点像素坐标；模型卡说明像素点到球场坐标的单应变换是下游步骤。 | 这就是本机已有的模型权重，可继续承担可见交点候选；不必因为缺中圈点另找模型。 | 模型本身不输出边线掩码或单应矩阵，模型卡标注 AGPL-3.0；共享 / 再分发权重前需单独核实适用条件。模型卡的示例代码含占位版本号，应按本机已固定的推理代码使用。 |
| [GitHub：DeepSportRadar camera-calibration-challenge](https://github.com/DeepSportRadar/camera-calibration-challenge) | 篮球专用基线先用 DeepLabv3 分割 20 条球场线，再提取图像中的线交点，与已知球场位置对应；交点充足时计算相机参数。 | 与“找整条边线而非依赖一个中心点”的思路最接近，可作为线掩码、交点抽取和几何校验参考。 | 数据和示例面向 DeepSportRadar 的 Keemotion 单帧裁切及 FIBA 场地，相机目标是完整 3D 校准；与本机 NBA 半场透视单应、摇镜 / 推拉不是可直接替换的现成接口。 |
| [GitHub：CEA-LIST/KaliCalib](https://github.com/CEA-LIST/KaliCalib)；[论文](https://arxiv.org/abs/2209.07795) | 篮球场模板上采样 91 个透视感知地面点，并回归篮筐位置；编码器—解码器预测点热图，RANSAC + DLT 拟合单应。代码使用 CeCILL 2.1。 | 证明篮球场可由许多分布较广的点和篮筐几何自动提出注册结果；本机已在旧实验中跑过其挑战权重。 | 训练 / 评估源自 2022 MMSports / FIBA Keemotion 数据；其原生模板、镜头和篮球场尺寸与 NBA 广播片段不同，旧实验在本机样例上也有显著偏移，需做模板适配和重新验收。 |
| [GitHub：InfiniZero/sports_field_registration](https://github.com/InfiniZero/sports_field_registration) | 针对转播画面做边界感知语义分割、单应初值预测、迭代细化及基于距离场的优化；仓库提供 NBA 2018 数据与权重的外链说明。 | 适合作为“线 / 边缘掩码 + 球场模板距离场细化”的 NBA 相关实现参考。 | 仓库依赖较旧，数据和多个权重需外部获取；本轮只检查了 README，未下载运行或核查数据 / 权重授权，不能视作工作台可直接接入方案。 |

上述页面均于 2026-10-03 访问。模型发布页分别写明 48 点输出、AGPL-3.0；DeepSportRadar 仓库描述 20 条篮球线与交点流程；KaliCalib 论文描述 91 个地面点、篮筐热图和 RANSAC / DLT；InfiniZero 仓库描述分割、初值、细化和距离场流程。链接提供来源，以上总结是对这些公开材料的归纳。

## 本轮工程更新（2026-10-03 22:30，待样片验收）

- 初始 48 点映射和约 1 秒间隔的球场模型重估可尝试用 NBA 线模板采样，与 Canny 边缘做局部 RANSAC 点线修正；采用时要求多线组支持、边缘距离改善和控制点位移受限。重估继续复用已有球场模型和 E-BARD 篮筐结果，并锁定同镜头篮侧。
- 候选逐帧回投影标准 NBA 球场线，保存线缘中位距离、3 原始像素内支持率、投影可视球场范围、可视线组和线缘不确定提示；工作台可查看这些项目。
- 此次没有加入交互式手绘线段、也没有接入 DeepLab / 专用语义球场线权重。Canny 会把场地纹理、广告和球员边缘当候选；这是保守的传统图像约束，不代表定位精度。当前还未在推拉和旋转样片上做运行 / 误差验收。

## 后续研究与验收建议

1. 保留现有关键点模型作为首轮候选，不把中圈是否可见设成硬门槛；缺篮筐时可再评估由边线语义和方向约束确定左右的路径。
2. 在人工标注器里允许沿可见边线标一段线（至少两点或折线），并标明近 / 远边线、底线、罚球线等语义。线段应基于画面实际可见部分；画外延长部分仍显式标成估计。当前工作台还没有该交互。
3. 自动检测可采用线语义分割，或先检测线掩码再用 OpenCV 直线拟合；按已知 NBA 球场模板匹配线族与交点。当前 Canny 路径需要与语义分割基线对比，并检查对广告 / 地板纹理的误匹配。
4. 当前已增加约 1 秒的同侧模型重估、投影线回检及局部点线修正。还需在切镜、明显推拉和快速摇镜片段上比较候选连续性、处理时间与误差；不可把旧相机映射当作当前真值。
5. 先在带人工线标注的短片上验收：含中圈遮挡、只见半场、近远两条边线、推拉和切镜。记录成功率、失败原因、线缘残差及人工复核量；没有这些对照前，不宣称自动标注精度。

稳定球场映射后再进入投影：球员应以可见且确认接地的脚点投到球场平面；篮球的图像检测中心常在空中，不能直接套地面单应矩阵，后续要单独决定是否只保留图像轨迹、估计球与地面的交点，或进一步恢复三维球路。

## 来源

- Hugging Face 模型卡：[koppolusameer/yolo11n-basketball-court-keypoints](https://huggingface.co/koppolusameer/yolo11n-basketball-court-keypoints)，采集日期 2026-10-03。
- DeepSportRadar 官方挑战仓库：[camera-calibration-challenge](https://github.com/DeepSportRadar/camera-calibration-challenge)，采集日期 2026-10-03。
- KaliCalib 官方代码：[CEA-LIST/KaliCalib](https://github.com/CEA-LIST/KaliCalib)，论文：[arXiv:2209.07795](https://arxiv.org/abs/2209.07795)，采集日期 2026-10-03。
- NBA 广播球场注册研究代码：[InfiniZero/sports_field_registration](https://github.com/InfiniZero/sports_field_registration)，采集日期 2026-10-03。
- OpenCV 几何说明：[homography tutorial](https://docs.opencv.org/5.0/tutorials/features/homography/homography.html)，体育场地 pan / tilt / roll 标定论文：[TVCalib](https://openaccess.thecvf.com/content/WACV2023/papers/Theiner_TVCalib_Camera_Calibration_for_Sports_Field_Registration_in_Soccer_WACV_2023_paper.pdf)，采集日期 2026-10-03。
- 本机实现：[court_orientation.py](../../../engineering/scripts/court_orientation.py)、[court_calibration.py](../../../engineering/scripts/court_calibration.py)；本机既有实验：[court-model-comparison.md](court-model-comparison.md)。
