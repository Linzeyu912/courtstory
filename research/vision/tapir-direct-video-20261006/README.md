# 官方 PyTorch TAPIR：原视频身体点小试

2026-10-06，Asia/Shanghai。**完成一次主试验和一次诊断控制：首轮非方形输入触发了这版官方采样代码的形状兼容问题，256×256 控制恢复了查询帧附近的合理位置。** 两轮全部保留；不能用首轮失败断言 TAPIR 整体无效，也不能把控制轮可见性覆盖当作身份 / 接地点精度。本专题是独立本机实验，未接入生产战术模块、UI 或用户草稿，未提交、未推送。

主入口：[三栏半速对照视频](../../../artifacts/tapir-direct-video-20261006/comparison-threeway/comparison-half-speed.mp4)，A 为现有框内锚点，B 为首轮异常输出，C 为方形控制。1440×696、150 帧、15 fps、10 秒，原片区间为 5 秒；[方案影响判断](assessment.md)另列后续建议。

## 测试范围

- 使用同一导入原片 `05_Pacers_20250106_Q2_0m44_team_motion_720p_silent.mp4`，SHA-256：`17c36f8d3b3e294f13f7119f23b82ec7f3fbe96d5564db9cbe7d61f49ebbbd7d`。
- 源帧半开 `[570,870)`，9.50–14.50 秒，原片 1280×720、60 fps；取 `570,572,…,868` 共 150 帧。源 622–646 的 25 帧检测缺口对应本次 13 个采样帧。
- 首轮输入 512×288，OpenCV `INTER_AREA` 等比例缩小，横纵均为 0.4。诊断控制直接缩放到官方默认 256×256，横向比例 0.2、纵向比例 256/720，分别逆变换回原图。两轮均不裁剪、不补边；逐帧索引、PTS、time base 单独保存。
- 标准 TAPIR，非 BootsTAPIR、非在线模型。离线模型能同时看到整个 5 秒采样序列，不能把本次推理时间称为在线跟踪延迟。
- 仅测试一个白衣 00 号候选的四个身体点。单点跟踪不证明实名身份、身体关节点、接地点或球场米制坐标。

## 自动种子与冻结规则

在查看任何 TAPIR 输出前固定规则：在源 570–620 的偶数帧里，选第一个同时满足 T2 检测置信度 ≥0.65、`torso.reliable=true`、`torso.reason=clear-torso` 的帧。实际得到源 **604**，检测置信度 0.698242、躯干重叠指标 0。源 570 的躯干重叠指标为 0.798，因此没有使用它作为查询帧。

四点使用检测框内部固定比例；没有用户手点，没有根据推理结果挑最好看的点或调整点位。执行前查看了 604 原图，保留全部候选；近躯干的候选可能位于上臂或球衣边缘，检测器的 clear-torso 也不能保证腿部或裁判重叠不存在。下列名称只是候选区域，不是姿态标注。

| 顺序 / query_id | 框内相对 `(x,y)` | 源图种子 `(x,y)` | 首轮可见 / 150 | 方形控制可见 / 150 |
| --- | --- | --- | --- | --- |
| 1 / torso_upper | (0.55, 0.30) | (469.955, 482.455) | 46 | 132 |
| 2 / torso_lower | (0.55, 0.43) | (469.955, 505.382) | 96 | 108 |
| 3 / hip_candidate | (0.58, 0.58) | (471.291, 531.836) | 17 | 87 |
| 4 / ankle_candidate | (0.72, 0.88) | (477.527, 584.745) | 12 | 119 |

查询时间是采样序列的 `t=17`，查询顺序为 `(t,y,x)`；不是原片帧号 604。四点坐标、检测框和检测证据都保存在 `seeds.json`。未把框底中心当作身体表面或脚底真值。

## 官方来源与实际配置

- [官方仓库固定版本](https://github.com/google-deepmind/tapnet/tree/730cda1c730877cfedbe01bf87fb1cadb78a565d)，commit `730cda1c730877cfedbe01bf87fb1cadb78a565d`；仅获取 PyTorch 源文件、官方 demo、配置、README 和许可证，没有修改上游源码。
- [官方 PyTorch TAPIR 权重](https://storage.googleapis.com/dm-tapnet/tapir_checkpoint_panning.pt)，124,348,474 字节，SHA-256 `628611c656b3bd65d4a70fbf5526b62afe82d1b085ce6044685287fb78509daa`。
- `TAPIR(pyramid_level=0, extra_convs=False, feature_extractor_chunk_size=5, use_casual_conv=False)`；188 个权重键严格加载全部匹配。配置对应标准 TAPIR 权重，不使用 demo 默认的 BootsTAPIR 构造配置。
- 两轮均为 FP32，`eval()` + `torch.inference_mode()`，查询 chunk 为 4。首轮自动细化分辨率为 `(256,256)`、`(288,512)`；控制只有 `(256,256)`，没有额外高分辨率细化。没有半精度、编译、时间插值、种子强制锁定或手工平滑。
- 原始 `tracks` 为 `(x,y)` 像素坐标；`occlusion` 和 `expected_dist` 都是 logits，后者不是像素距离或真实误差。按照[官方 demo](https://github.com/google-deepmind/tapnet/blob/730cda1c730877cfedbe01bf87fb1cadb78a565d/colabs/torch_tapir_demo.ipynb)使用 `score=(1-sigmoid(occlusion))*(1-sigmoid(expected_dist))`，`score>0.5` 才显示。该分数没有在本片外部校准。

`probe.py` 固定每个上游文件、权重和依赖 wheel 的 SHA-256。实际源码、权重与 wheel 放在忽略目录 `tmp/tapir-probe-20261006/`。使用既有 CUDA PyTorch Python；仅将 einshape 1.0、dm-tree 0.1.10、attrs 26.1.0、wrapt 2.5.0、absl-py 2.5.0 的校验过 wheel 解压到隔离 `deps/`。没有安装 JAX，也没有升级或向原 venv 安装依赖。本锁定文件支持 Windows x64 / CPython 3.13。

## 测量

本机为 RTX 5060 Laptop GPU，PyTorch 2.14.1+cu130 / CUDA runtime 13.0。两种配置各跑一次，均无暖机；控制为首轮异常触发的明确诊断，两份结果同时保留，没有重选种子或隐藏失败轮。

| 阶段 | 首轮 512×288 | 控制 256×256 |
| --- | --- | --- |
| 执行脚本准备至推理前，已缓存源码 / 权重 | 8.256 秒 | 7.015 秒 |
| 其中导入依赖 | 3.511 秒 | 3.371 秒 |
| 其中顺序解码及缩放 | 1.862 秒 | 1.919 秒 |
| 其中加载模型并传 GPU | 0.261 秒 | 0.218 秒 |
| 其中输入上传 / 归一化 | 0.084 秒 | 0.039 秒 |
| 首次 GPU 推理，前后同步 CUDA | 2.190 秒 | 0.900 秒 |
| 保存输出完成前总运行时间 | 10.461 秒 | 7.959 秒 |
| 暖机后推理 | 未测 | 未测 |
| 推理峰值 PyTorch allocated | 3,884.69 MiB / 3.794 GiB | 1,591.66 MiB / 1.554 GiB |
| 推理峰值 PyTorch reserved | 4,620.00 MiB / 4.512 GiB | 1,984.00 MiB / 1.938 GiB |

显存是 PyTorch 分配器峰值，不包含其他进程或驱动占用。下载发生在运行脚本前：固定源码下载记录为 20.539 秒，权重 245.193 秒，成功依赖准备记录 50.112 秒。它们不是同一次串行全链计时，不相加冒充首次安装总墙钟时间；之前的依赖准备尝试还遇到 venv 无 pip、系统 pip 临时目录权限问题及多 wheel 候选选择问题，随后改为隔离下载 / 校验 / 解压，没有发生 GPU 推理失败或 OOM。

## 非方形细化诊断

固定版本的[官方 `map_coordinates_2d` 第 99–104 行](https://github.com/google-deepmind/tapnet/blob/730cda1c730877cfedbe01bf87fb1cadb78a565d/tapnet/torch/utils.py#L99-L104)读取网格 `h,w` 后，用 `y = 2 * (y / h) - 1` 同时归一化两个坐标。上游 `refine_pips` 已按真实宽高换算到网格，再传入 `(y,x)`；非方形时横坐标仍除以高度，因此与 `grid_sample` 的宽度尺度不一致。此 helper 实际具有方形网格假设；外围输入 / 输出的比例还原并不能抵消内部采样位置错误。

另以 CPU 调用原封不动的官方 helper 做了可复算的小网格诊断，没有第三次模型推理：令每个格子的值等于横向像素中心，72×128 网格在 x=47.5 处本应采得 47.5，实际返回 84.444；同样坐标在 72×72 网格返回正确的 47.5。18×32 的 x=24.5 甚至被采到网格外并返回 0，方形控制则正确。证据为 `inference-256-control/shape-diagnostic.json`。

随后仅增加显式 `--square` 选项，保持默认首轮配置不变，同视频、同 150 源帧、同源帧 604、同四个原图种子，运行一次 256×256 控制。没有修改官方模型源码或权重。该控制同时改变了输入缩放几何与细化层数，可确认方形适配路径的表现，不能严格分离这两个变化的贡献。

## 两轮结果与限制

首轮在查询帧 604 自身，最终四点相对自动输入种子的偏移约为 **50.8、106.0、110.5、9.6** 个源像素，而模型可见分数仍为 0.988、0.977、0.962、0.959。最初 cost-volume 输出在查询帧与种子吻合；保存的 256 分辨率细化结果偏移较小，后续非方形高分辨率细化中出现明显漂移。全部原始细化数组保留。这反映首轮配置不适配这版代码，不能据此否定 TAPIR 整体能力。

方形控制的查询帧偏移降为 **3.14、3.26、1.84、3.17** 个源像素，初始 cost-volume 仍与输入种子精确吻合。可见覆盖改善，但查询帧自洽检查只能排查明显适配错误，不能证明之后的每帧仍跟对人。源 622–646 缺口的 13 个采样帧，四点分别被判为可见 13 / 1 / 0 / 7 帧；这些仍需结合画面复核，不称准确恢复数量。

控制轮另查看了 604、634、660、704、780、868 六张真实关键帧，见 `control-keyframes.png`：634 的第 1 点仍落在白 00 身体区域；704 的四点整体随目标，780 的第 1 / 4 点仍在目标身体附近；868 第 4 点留在白 00 腿部附近，没有随另一名白衣球员走。660 的腰髋候选与前景裁判重叠区域仍有疑点，需要进一步检查遮挡可信度。这里仅确认这些关键帧的身体归属明显好于异常首轮，没有确认连续 150 帧的同一物理表面、关节点或地面位置。

首轮源检测缺口 622–646 的 13 个采样帧中，只有第 1 点被模型判为可见 11 帧；另外三点为 0。看图可见 634 的第 1 点位于目标右上侧空地，所以这 **11 帧不是 11 帧正确恢复**。首轮 570 / 660 等帧也能看到高置信候选离开目标，704 / 780 四点都隐藏；868 的第 2 点落在另一个白衣球员附近。没有人工点真值，不能给出精确定位准确率。

对照左侧使用原始 T2→T39 候选关联对应检测框的相同比例锚点，右侧使用 TAPIR 原始点及阈值。两者目标不同：框内相对锚点会随检测框变化，TAPIR 试图追踪特定外观位置。本轮对照用于观察实际漂移 / 缺口，不是对两者严格同类任务的排名。已有标签关联也不是身份真值。

## 本机产物与复跑

输出均位于仓库忽略目录 `artifacts/tapir-direct-video-20261006/`，未上传到云端：

- `inference/result.json`：四个 query 的原始模型 / 源图坐标、遮挡和不确定度 logits、可见分数、布尔可见性、精确源帧映射。
- `inference/predictions.npz`：最终原始输出、全部 8 组中间细化输出、源图坐标、可见性和查询点。最终数组带原始 batch 维度；中间数组首维为细化阶段。
- `inference/input.npz`：真实输入 RGB uint8 视频与查询点；便于独立检查模型输入。
- `inference/seeds.json`、`seed-frame.png`、`frame_mapping.json`：自动种子与映射证据。
- `inference/manifest.json`：模型 / 素材 / 依赖 / 脚本摘要、配置、实际耗时与显存；`numeric-check.json` 是数字核对，首轮查询帧位置检查明确失败。
- `inference-256-control/`：相同结构的方形诊断控制，另含 `shape-diagnostic.json`；两份 `probe-used.py` 分别保存实际运行脚本，摘要与各自 manifest 的 `probe_script_sha256` 一致。审计副本与检查在运行结束后添加，不属于已记录推理 / 总运行耗时。
- `comparison-threeway/comparison-half-speed.mp4`：最终三栏主入口，1440×696、150 帧、15 fps、10 秒，7,946,496 字节，SHA-256 `3716f05f538b389e1b9cd6374b64cf72c0aea3d8994f02ecaa4382e6f9981737`。同目录 `frame-log.json`、`metrics.json`、关键帧 JPG 记录每帧显示策略和复查证据，可见帧数不称准确率。
- `comparison-threeway/review.json`：推理作者独立复核对照作者的脚本与视频，14 项检查通过，含全 150 帧解码 / PTS、两轮 1200 个原始模型点与可见性记录、种子一致、哈希、编码后三栏 450 个画面块与原视频同帧比对；另看 604、634、660、704、780、868 六张关键帧。技术通过不等于身体点精度或十人身份验收。
- `comparison/comparison-half-speed.mp4`：仅含首轮的旧二栏诊断证据，仍保留原貌；最终观看请使用三栏版。

从仓库根目录复跑，使用已有 CUDA PyTorch 环境，并指定新的输出目录保存首轮原始结果：

```powershell
& 'tmp/player-identity-test/.venv/Scripts/python.exe' `
  'research/vision/tapir-direct-video-20261006/probe.py' `
  --output 'artifacts/tapir-direct-video-20261006/inference-reproduction'
```

方形控制的复跑使用新的独立输出目录：

```powershell
& 'tmp/player-identity-test/.venv/Scripts/python.exe' `
  'research/vision/tapir-direct-video-20261006/probe.py' `
  --width 256 --square `
  --output 'artifacts/tapir-direct-video-20261006/inference-256-control-reproduction'
```

脚本自行校验 / 获取固定源码、权重与隔离依赖。它会拒绝覆盖已有 `result.json`、`manifest.json` 或 `failure.json`。默认输入仍为首轮同一 5 秒 512×288 配置；如果发生错误，会保存真实 `failure.json`。`--prepare-only` 只准备固定依赖。当前记录仅包含上述两个明确配置，没有再次挑选参数。

当前验证范围是输入 / 输出字节、精确时钟和坐标还原、权重严格加载、真实 GPU 执行与有限关键帧视觉检查。十人全片、长遮挡、真实接地点、米制球场轨迹、在线性能和生产接入均未验证。
