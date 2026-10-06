# TAPNet / TAPNext++ 对本项目的可用性调研

采集与验证：2026-10-06，Asia/Shanghai。范围：用户提供的 [google-deepmind/tapnet](https://github.com/google-deepmind/tapnet)，固定源码提交 `730cda1c730877cfedbe01bf87fb1cadb78a565d`（提交日期 2026-09-15）。本报告为研究建议，尚未形成团队选型或工程接入。

**结论：值得试，最适合成为工作台的“点选后自动跟随”工具。优先评估 TAPNext++，用 BootsTAPIR 作离线对照。** 它可以为球员标签、局部标注和球场参照提供跨帧点位候选；不能单独完成球员身份识别、脚部接地判断、米制球场映射或战术理解。当前赛事账号记录 GPU 配额为 0，因此先定位为本地制作辅助，不把 GPU 推理设为云端交付的必要依赖。

本轮已检查官方源码、预训练权重入口和许可证，并在现有 Windows 环境跑通 CPU / CUDA 的**显式随机参数接口探针**。未下载预训练权重，未运行篮球视频，未测跟踪准确率，未修改工作台功能。证据在 [sources.json](sources.json)、[runtime-probe.json](runtime-probe.json)；过程见[交接](../../../handoffs/Linzeyu912/2026-10-06-1354-tapnet-research.md)。

## 1. 它实际做什么

给定视频，以及某帧中人工或检测器指定的几个点，模型估计这些点在后续帧的位置和可见性。例如，在一名球员球衣上选一个有辨识度的点，得到它随画面运动的像素轨迹。这个点可以关联我们已经确认的 P 编号，但模型不会告诉我们球员姓名、球队、挡拆角色或持球状态。

它针对的是持续的点对应关系，比相邻两帧的光流更强调长时间跟随和遮挡恢复；仍可能漂移或跟错。TAPNext++ 采用逐帧因果推理，状态可在帧之间延续，不需要先把整段视频装进显存。“online”在此指逐帧推理，不是在线 API。普通离线 TAPIR / BootsTAPIR 会利用视频的前后文，适合作另一类对照。[官方仓库说明](https://github.com/google-deepmind/tapnet/blob/730cda1c730877cfedbe01bf87fb1cadb78a565d/README.md)、[TAPIR 作者页](https://deepmind-tapir.github.io/)。

| 模型 / 模块 | 本项目判断 | 依据与边界 |
| --- | --- | --- |
| 原始 TAP-Net | 不作为首选 | 早期基线；仓库名称不等于当前推荐模型 |
| TAPIR / BootsTAPIR | BootsTAPIR 可作离线对照 | 官方有 PyTorch 权重；可测试前后文对遮挡与小目标的帮助，不能预判胜过新版 |
| TAPNext / BootsTAPNext | 不优先用于整段篮球镜头 | 作者明确记录超过约 150 帧时的长序列失败；这是观测到的限制，不是 API 硬上限 |
| TAPNext++ 256 | 第一轮候选 | 沿用 TAPNext 架构，重点改善长序列、遮挡后重定位及出画再入画 |
| TAPNext++ 512 | 第二轮小目标对照 | 有单独权重及官方逐帧封装，分辨率提高也增加计算量；需验证是否改善远景鞋点 |
| TAPVid / TAPVid-3D | 评测资料 | TAPVid-3D 是数据与评测，不表示现成模型能把我们的单目视频直接变成球场米制 3D |
| TRAJAN / RoboTAP | 暂不优先 | 前者是轨迹表示 / 重建研究，后者主要面向机器人；均不等于篮球战术分类器 |

版本选择依据：[TAPNext 作者页及 Limitations](https://tap-next.github.io/)、[TAPNext++ 作者页](https://tap-next-plus-plus.github.io/)、[公开权重说明](https://github.com/google-deepmind/tapnet/blob/730cda1c730877cfedbe01bf87fb1cadb78a565d/tapnet/tapnextpp/README.md)、[512 版本说明](https://github.com/google-deepmind/tapnet/blob/730cda1c730877cfedbe01bf87fb1cadb78a565d/tapnet/tapnextpp/votsp2026/README.md)。

## 2. 放到我们的哪一层

以下是结合现有工程的推断，尚未通过本项目视频验证。

| 用途 | 适配度 | 怎样使用、还缺什么 |
| --- | --- | --- |
| 重点球员标签 / 局部标注随人移动 | 高，优先试 | 用户确认人和起始点，选若干有纹理的身体表面点辅助跟随；遮挡保留未知，允许重新点选。显示标签可以参考这些点，地面脚环仍需单独求地面位置 |
| 已标定球场的参照点跟随 | 中高，第二优先 | 跟踪分散的地面纹理 / 交点，为现有 SIFT / LK 提供对照或补充；过滤人物、篮板等非地面点，再做 RANSAC、单应矩阵和反投影检查 |
| 少量球员轨迹缺口修补 | 中，需明确点语义 | 只能提供可见表面点证据，必须与已有身份、检测、脚点及标定合并；不能直接覆盖 preparedByPlayer 的地面轨迹 |
| 十名球员身份与跨镜头续接 | 低 | 同服装、遮挡和切镜仍可能串人；既有 P/T 对应、检测 / ReID 和人工确认继续需要 |
| 篮球全程跟踪 | 低，后置 | 球小、快、模糊、旋转；球表面的物理点与球的几何中心不同，不能把一个 TAP 查询点当稳定球心 |
| 挡拆、传球、战术解释 | 无直接能力 | 应由上层规则、篮球模型或多模态模型解释，TAP 仅提供运动证据 |

现有[球场后端](../../../engineering/docs/court-calibration-backend.md)已经使用 SIFT / LK、多帧点线拟合和人工参照保护。因此建议先做同镜头的独立对照，不整体替换已采用流程。可靠平面变换至少需要 4 个布局不退化的地面对应点，实际应多选、剔除离群点；重复场线、大片单色地板和遮挡仍是困难情况。

现有[人工制作](../../../engineering/docs/manual-tactics-workbench-guide.md)已经能画跑位、传球和挡拆，也支持手动校正移动节奏。TAP 最直接的价值是减少重复定位操作。[Qwen 地面轨迹 Agent](../../../engineering/docs/qwen-ground-trajectory-agent.md)则负责读取证据、提出地面锚点和未知区间；可考虑由 TAP 提供连续像素候选，再交给上层检查少量异常帧。是否减少模型调用和人工修正，要用同片实验验证。

### 最容易误用的地方：鞋点不等于地面点

- 跟踪鞋面时，脚离地会带着查询点一起上升；用地面单应矩阵投影该点会产生错误水平位移。
- 双脚之间的“地面中心”是人为定义的虚拟位置，不一定对应同一物理表面点；直接把它交给点跟踪器，可能跟住地板或鞋，而不是持续跟随球员的地面中心。
- 要得到可信 2D 球场轨迹，仍需接触状态 / 姿态 / 人体几何、逐帧有效标定和人工核对。不能把平滑的输出线条当成真实地面运动。
- 遮挡期间预测的位置只是估计。TAPNext++ 作者页展示的杯球例子也明确承认遮挡中跟不准，只在重新可见后找回；本项目应保存可见性和缺口，不把隐藏段填成观测。

这些是点跟踪与本项目地面位置定义之间的区别，不能靠更换 checkpoint 自动消除。相关既有研究见[脚点与接触工具](../vision-player-refinement/ground-tools-survey.md)。

## 3. 开源与权重是否真能取得

截至本次固定提交，仓库根说明明确把 TAP-Net、TAPIR、BootsTAPIR、TAPNext、TAPNext++、TRAJAN 的已链接预训练权重列为 Apache-2.0；一般软件代码也为 Apache-2.0。TAPNext++ 的两个子目录分别再次确认其权重许可。按当前发布声明，可以作为集成候选；分发时保留许可证、版权及适用声明，修改文件说明变更。它不是 Google 官方支持的产品。[许可证及声明](https://github.com/google-deepmind/tapnet/blob/730cda1c730877cfedbe01bf87fb1cadb78a565d/README.md#license-and-disclaimer)。

许可不能扩展到所有视频素材：TAPVid-3D 有独立许可，TAP-Vid 标注、DAVIS / Kinetics 源视频也应按各自来源判断。本轮无需下载这些数据集，未上传任何本项目视频到 Colab 或外部服务。

三条官方存储链接均在本轮匿名 HTTPS HEAD 检查中返回 200；这里只确认入口及响应长度，没有下载校验文件或加载权重。

| 权重 | HTTP Content-Length | 官方入口 |
| --- | ---: | --- |
| TAPNext++ 256 | 2,532,282,370 字节，约 2.53 GB | [tapnextpp_ckpt.pt](https://storage.googleapis.com/dm-tapnet/tapnextpp/tapnextpp_ckpt.pt) |
| TAPNext++ 512 | 2,532,283,010 字节，约 2.53 GB | [tapnextpp_512.ckpt](https://storage.googleapis.com/gresearch/tapnextpp/tapnextpp_512.ckpt) |
| BootsTAPIR v2 PyTorch | 218,886,140 字节，约 219 MB | [bootstapir_checkpoint_v2.pt](https://storage.googleapis.com/dm-tapnet/bootstap/bootstapir_checkpoint_v2.pt) |

文件大小不能当成模型显存占用。TAPNext 架构本轮实例化得到 194,202,881 个参数；未解包上述 checkpoint，不能断言其额外体积由哪些内容组成。

### 不要把论文最佳成绩套到公开权重

TAPNext++ 官方子目录明确说：公开 256 权重在 PointOdyssey v1.2 + Kubric-1024 上微调，**没有训练 DynHumans**。其公布 DAVIS AJ 为 65.6、RoboTAP AJ 为 61.1、Kinetics AJ 为 53.9；作者论文 / 项目页的最佳混合训练结果并非完全相同模型。根表中的 BootsTAPIR 和 TAPNext 也在部分数据集优于公开 TAPNext++，因此不能仅按新旧宣布全面胜出。

AJ 联合衡量位置和遮挡，不能解释成“识别球员正确率”或本项目的成功率。官方展示的数百 FPS 依赖 H100、点数、分辨率以及逐帧 / 窗口推理模式；不能套用到 1080p NBA 视频、这台笔记本或赛事 CPU。[公开 256 权重指标](https://github.com/google-deepmind/tapnet/blob/730cda1c730877cfedbe01bf87fb1cadb78a565d/tapnet/tapnextpp/README.md)、[作者页的配置与比较](https://tap-next-plus-plus.github.io/)。

## 4. 本机运行检查

实查环境：Windows、Python 3.12.10、PyTorch 2.11.0+cu128、torchvision 0.26.0+cu128、RTX 5070 Laptop GPU，驱动报告显存 8,151 MiB。沿用被忽略的现有视觉环境，没有安装 / 升级依赖，也没有启动工作台或云资源。

官方 `TAPNextPP` 封装可直接接收 BGR 图像和像素坐标，返回点位、可见性和下一帧状态。核心路径使用现有 torch / torchvision / numpy / einops 即可完成本轮探针。通用 `pip install .` 会带入 JAX 等依赖，官方完整 Notebook 还涉及数据集、绘图和额外依赖；这不代表纯 PyTorch 推理也必须安装整套训练环境。`torch.compile` 是可选项，本轮关闭；没有安装独立 FlashAttention 包。[包依赖](https://github.com/google-deepmind/tapnet/blob/730cda1c730877cfedbe01bf87fb1cadb78a565d/pyproject.toml)、[逐帧封装源码](https://github.com/google-deepmind/tapnet/blob/730cda1c730877cfedbe01bf87fb1cadb78a565d/tapnet/tapnextpp/votsp2026/model.py)。

### 探针结果，仅说明接口可执行

输入为重复的 1920×1080 随机图，6 个查询点，每种配置 3 帧。**全部参数显式随机初始化，没有训练权重，点位没有业务意义。** 计时包含封装预处理及 CPU 输出，不含视频解码、权重下载、实际标注及渲染。后续帧耗时只是两帧中位数，不是稳定吞吐基准。

| 配置 | 形状 / 有限值 / 状态递进 | 后续帧耗时 | PyTorch 峰值 allocated / reserved |
| --- | --- | ---: | ---: |
| CPU、256 输入、FP32 | 通过 | 约 734 ms | 未测进程内存 |
| CUDA、256 输入、FP16 autocast | 通过 | 约 55 ms | 约 1.58 / 1.86 GiB |
| CUDA、512 输入、FP16 autocast | 通过 | 约 146 ms | 约 2.43 / 2.70 GiB |

输出均为 `[6, 2]`，可见性为 `[6]`，状态帧号为 1、2、3；1080p 显示坐标往返转换最大误差约 0.000122 像素。这说明当前机器具备进一步加载正式权重试验的基础，不说明真实权重在长视频、多点 / 支持点或批量处理中有相同显存和速度。

首次未显式初始化全部参数的探针在 CUDA 的断言处失败，原始记录保存在 [runtime-probe-uninitialized.json](runtime-probe-uninitialized.json)。随后源码检查发现自定义循环层使用 `torch.empty`，依赖 checkpoint 加载来赋值；因此首次结果不能用于评价模型或 CUDA 支持。修正探针、给所有参数显式有限随机值后，三组通过。上游源码未修改；本轮仍未测试正式 checkpoint 加载。

可复跑命令（仓库根目录，使用自己已就绪的 PyTorch 环境）：

```powershell
git clone https://github.com/google-deepmind/tapnet.git tmp/tapnet-audit-20261006
git -C tmp/tapnet-audit-20261006 checkout 730cda1c730877cfedbe01bf87fb1cadb78a565d
python research/vision/tapnet-20261006/probe_runtime.py --source tmp/tapnet-audit-20261006 --output artifacts/tapnet-runtime-probe.json
```

已有源码目录时跳过 clone。本轮实际使用已有 `tmp/model-runtime/Scripts/python.exe`；输出到 `artifacts/` 可避免覆盖已归档证据。

## 5. 接入时必须处理的细节

以下为后续实现建议，当前没有加入产品。

1. **点的含义与坐标格式。** TAPIR 通常输出 `(x,y)`；此版本 TAPNext 核心输出 `(y,x)`，查询点是 `(t,y,x)`。官方封装会转换成显示像素 `(x,y)`。尤其 512 封装虽然输入图为 512×512，内部坐标标尺仍使用 256；应复用并验证该封装，不自行重复乘二。相关转换见[源码](https://github.com/google-deepmind/tapnet/blob/730cda1c730877cfedbe01bf87fb1cadb78a565d/tapnet/tapnextpp/votsp2026/utils.py)。
2. **图像缩放与裁图。** 1080p 画面缩到 256 后，远景鞋 / 球可能只剩少数像素。可比较 512 或稳定 ROI；每帧变化的裁图必须有严格逆变换，不能把裁图运动当球员运动。保留源帧 PTS 和模型序列索引，不按假定恒定 FPS 对齐原片。
3. **遮挡与切镜。** 保存 visibility，不把低可信输出当观测；切镜重置状态并重新确认身份和点。因果跟踪只使用当时及此前帧；从中间帧点选要覆盖之前片段时，需要另做反向处理并核对，不能假定一次前向补全过去。
4. **支持点不是免费增益。** VOTSp2026 的 runner 给每个目标增加 64 个局部支持点，独立 `track_frame` 封装并不自动添加。若照抄比赛 runner，点数与算力会增加；篮球里附近支持点可能落在另一球员或地板上，要单独测试。[runner 说明](https://github.com/google-deepmind/tapnet/blob/730cda1c730877cfedbe01bf87fb1cadb78a565d/tapnet/tapnextpp/votsp2026/README.md)。
5. **来源和采用。** 候选需带模型版本、种子点、源帧 / PTS、可见性、点类型和坐标变换记录。先预览、再由用户采用，保留撤销和人工锁点。球衣点、鞋面点、地面参照点分别保存，不能默认为地面真值。暂不新增正式字段或改既有保存契约。

建议的数据流：已确认球员 / 人工点选 → TAP 像素跟踪候选 → 可见性与身份核对 → 画面标注；只有确实处于地面的点，才进一步进入现有标定与 2D 准备。

## 6. 赛事适用边界与下一步

根据仓库 2026-10-05 已核验的[正式指南整理](../../../requirements/portal-access-20261005.md)，赛事要求 CPU + Bedrock 路线，GPU 配额为 0，完整跑动轨迹复原不属于赛题主线。这里引用的是已有核验记录，本轮没有重新登录赛事 Portal 或重新查询 AWS 配额。不能由本机 CUDA 探针推导“已经可以在赛事云端部署”。CPU 接口本轮可执行，但云端真实性能与成本未验证。

**建议做一个小范围真实权重实验后再决定接入：**

1. 使用现有 005，以及[官方训练 001 / 002](../../../data/videos/uploads/2026-10-05-official-training/README.md)，先取各 5–10 秒连续镜头；不上传到外部 Colab。覆盖横移 / 推拉、同队遮挡、起跳、出画再入画。切镜另外作为应停止续接的测试。
2. 每段先选 1–2 名球员，各 3–5 个明确表面点；另选分散地面纹理。建立少量人工参照帧，遮挡标未知，避免用原有模型输出冒充真值。
3. 比较 TAPNext++ 256、512 与 BootsTAPIR 离线版；球场传播与当前 SIFT / LK 对照，人物标注与现有流程对照。相同片段 / 点定义 / 采样率下比较，先低点数逐帧，后测支持点。
4. 记录可见帧像素误差、可见性误判、错人续接、重新出现后的恢复时延、人工修正次数、完整耗时和峰值显存。可见像素误差与地面误差分开；不要只看可视化是否顺滑。
5. 只有减少人工修正且不增加错人 / 假可见问题，才接入“选点跟随候选”。地面映射另做验收；保留人工制作和原有球场流程。

研究阶段无需训练模型。本轮没有创建 Issue、分配人员、提交 / 推送仓库、创建云资源或宣布团队采用。

## 文件与证据

- [sources.json](sources.json)：来源 URL、采集时间、固定提交、13 个所审查源码文件的 SHA-256、权重 HEAD 响应与本仓库基线。
- [probe_runtime.py](probe_runtime.py)：无下载、无安装的随机参数接口探针。
- [runtime-probe.json](runtime-probe.json)：显式初始化后的本机检查。
- [runtime-probe-uninitialized.json](runtime-probe-uninitialized.json)：首次无效初始化探针，作为诊断历史保留，不作为可行性结论。

重要结论以本报告区分的“官方声明 / 本轮本机检查 / 项目建议 / 未验证”四种范围解读。上游下载源码仍留在被忽略的 `tmp/`，没有把外部整个仓库或模型权重纳入团队仓库。
