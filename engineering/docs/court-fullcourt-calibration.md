# 全场联合标定（离线待复核候选）

2026-10-04，Asia/Shanghai。范围是球场标定；现有 E-BARD YOLOv8n 检测、人物轨迹、身份、脚下点、篮球与人工标定都保持原样。当前新增独立的离线模块和验收入口，尚未替换工作台的默认标定后端。

后续更新：工作台人物尾迹已改为[逐帧球场坐标再投回当前画面](court-relative-trajectories.md)，该修复不代表默认后端已接入本文件的全场联合求解。新增[开源工具比较与接入建议](../research/fullcourt-tools-and-camera-tracking-20261004.md)，覆盖篮球场线识别和广播镜头跟踪两个环节。

## 当前保留基线与验收重点（2026-10-04 用户补充）

- 用户认可样例 005（SAS–MIA 第四节）第一帧的场线贴合，要求保留既有边线、多帧点线拟合和中场约束。此评价作为回归参照，不扩展为整段视频或全场精度已通过。
- 半场点线优化与全场两端 / 中线联合求解均保留；中圈模板与圆弧残差接口也保留。仍区分“几何约束已实现”和“真实圆弧自动识别待验证”，不把队徽边缘当成中圈观测。
- 本次再次提供的视频经 SHA-256 核对，与[既有全场测试](../research/court-fullcourt-20261004.md)完全一致，哈希为 `994c43388a2c31a44fcc8259bba1d4d71abab0dd439aed46da09c22e14012b23`，无需重复登记成新样本。
- 下一次改进同时以 005 半场效果和全场连续镜头为回归依据，重点检查半场 → 中线 / 中圈区域 → 另一半场 → 返回时的场线贴合、坐标一致性、跳变及缺口。先验收球场，再分别验收人物和脚点，最后联合到 2D；本轮界面修改未改球场算法或重新生成精度结果。

## 为什么独立半场参照不够

禁区几个点在局部可以贴合，却未充分约束远处中线和另一端底线。之前把左、右、左三个参照窗口分别传播，局部看起来较好，但重叠处同一图像点落到全场坐标后相差数米。提高关键点模型输入尺寸能改善初始化，不能自动解决这种全场几何不一致。

## 本次实现

- [`court_fullcourt.py`](../scripts/court_fullcourt.py)：所有关键帧在同一个 NBA 全场坐标系中联合求解，长 28.6512 米、宽 15.24 米。仅支持同一侧机位、连续镜头的当前流程；场地的物理篮端和队伍进攻方向仍未确认。
- 两端禁区使用已核对的 A/B/C/D/E/I/J 点语义。仍保留原始模型观测，不猜测剩余 48 点槽位的身份，不把篮筐高度点放入地面拟合。
- 地板 SIFT 对应与短间隔双向光流构成相机关系图。遮掉人物、裁判和固定记分牌区域；比率、内点数、空间分布与前后向一致性均有门槛。无支持的节点不强行连接；切镜边不允许进入同一图。
- 用两端绝对地面点、可见禁区线和中线共同约束几何。中线支持亮线 / 暗线，排除中央队徽区域。图像纹理约束相机运动，场地点线决定尺度与位置；单独求解整体的八参数坐标变换，避免大量纹理对应使整体校正难以收敛。
- 中圈六英尺半径进入模板和圆弧残差接口，并有已知几何测试；**本片没有独立可见圆弧观测**，不自动拿队徽边缘拟合圆。可见圆弧的自动语义提取尚未实现，因此本片实际生效的是两端禁区、中线与地板运动的联合约束。
- 稀疏关键帧求解后，对每一原始帧重新测量到邻近关键帧的地板运动。邻近两参照的地面差异 P95 超过 0.75 米时留空；没有直接纹理 / 光流证据时也留空。相邻相机候选在投影控制点上协调，不插值球员位置，不冻结旧矩阵填满覆盖率。
- 所有输出仍为 `needs_review`，`metricAccuracyValidated=false`。数值优化的收敛状态、达到迭代上限、拟合残差、缺失原因均保留；有限迭代候选不等于精度验收通过。
- 最后对可见场地投影跳动较大的帧做独立检查：前、后联合标定关键帧（各不超过 20 帧）各自重新测量到当前帧的地板光流，两者必须在可见全场网格上相互吻合，才能修复当前矩阵的孤立异常。使用联合关键帧而非相邻未核验矩阵，避免相邻异常互相验证。`before-motion-audit/` 保留检查前的逐字节候选，不补缺失矩阵，不处理球员曲线。这一步修复了亮度降低时少量纹理匹配局部吻合、远处投影却跳动的情况。

## 运行与输出

已有缓存由 [`benchmark_court_generalization.py`](../scripts/benchmark_court_generalization.py) 产生，包含每帧检测、960 输入的场地点扫描和上一版独立半场候选。新流程不重新训练，也不改检测缓存。可选环境见 [`requirements-court-fullcourt.txt`](../requirements-court-fullcourt.txt)。

以下从仓库根目录运行，`python` 指向具备这些依赖的环境，`--video` 指向已登记原片的本机路径：

```powershell
python engineering/scripts/benchmark_fullcourt.py --input artifacts/court-generalization-20261004 --output artifacts/court-fullcourt-20261004 --video <原片路径> --stage fit
python engineering/scripts/benchmark_fullcourt.py --input artifacts/court-generalization-20261004 --output artifacts/court-fullcourt-20261004 --video <原片路径> --stage dense
python engineering/scripts/audit_fullcourt_motion.py --previous artifacts/court-generalization-20261004 --output artifacts/court-fullcourt-20261004 --video <原片路径>
python engineering/scripts/report_fullcourt.py --previous artifacts/court-generalization-20261004 --output artifacts/court-fullcourt-20261004 --video <原片路径> --render
python engineering/scripts/serve_comparison_report.py --directory artifacts/court-fullcourt-20261004 --port 8902
```

每个版本保存 `*-graph.json`（原始点线观测、图像对应、排除的节点、输入哈希）、`*-joint.json`（关键帧和逐帧矩阵、质量信息、优化终止原因）。新增视频、图像和大 JSON 保留在忽略目录 `artifacts/`，旧报告完整保留。若输入有切镜，先按真实镜头分开处理；当前基准入口拒绝带 `sourceCuts` 的整体求解。

`report_fullcourt.py` 输出：

- `court-before-after.mp4`：之前的半场参照与本次全场联合标定同步对比。
- `court-augmentations.mp4`：原片、模糊压缩、额外缩放平移、降亮度四路复验。
- `index.html`、`summary.json`：覆盖率、缺失区间、点线观测数、优化终止状态及增强一致性。视频只叠球场，未投影人物 / 篮球。

## 验证边界

单元测试使用已知投影验证：两端约束对未参与拟合的中场点是否正确、整体坐标校正是否保持图像运动、断连和切镜是否拒绝、反转 / 穿过地平线是否拒绝、空白图像是否不伪造中线、真实圆弧约束是否保留正确几何。

另外用合成地板纹理视频检验：实际 LK 光流能纠正插入的 50 像素孤立矩阵错误，原候选不变，原缺失帧继续留空。

真实视频的覆盖率、模型点拟合残差、相邻相机一致性、增强前后的一致性均不是独立真值精度。另有 [6 个中场抽查帧的目视参考](../research/court-fullcourt-20261004-line-checks.json)，只用于报告，不进入拟合；由 Agent 从原图读取，约 ±5 像素，未经用户人工复核。增强的三个版本都来自同一片段，不能当作四场比赛的泛化证据。

球场标定复核完成后，再分别验收人物轨迹和脚下点。人物 / 球的 2D 联合量化、持球判断和显示平滑仍是后续工作。

## 来源

- [NBA 官方球场尺寸与设备规则](https://official.nba.com/rule-no-1-court-dimensions-equipment/)，2026-10-04 访问；本仓库既有 NBA 尺寸约定保持不变。
- [现用 YOLO11n 球场 48 点模型卡](https://huggingface.co/koppolusameer/yolo11n-basketball-court-keypoints)，2026-10-04 访问：模型输出像素关键点，球场坐标转换另行处理。
- [上一轮全场移动镜头实验](../research/court-generalization-20261004.md)，2026-10-04 本地结果，是本次失败定位和对照基线，不是独立真值。
