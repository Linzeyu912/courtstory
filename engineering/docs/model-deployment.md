# 本机模型与可选跟踪方案

2026-10-03 本地更新：前端改为检测器与跟踪器独立选择，新增两种交叉组合，默认仍沿用原篮球优化路线。实际映射、参数和新后端字段见[选择与布局说明](model-selection-layout.md)；下文保留原运行记录。

核验日期：2026-10-02（Asia/Shanghai）。本轮按用户选择将 THY 完整方案作为默认推荐；推荐标记不代表独立准确率评测结论。

## 当前部署

2026-10-03 本地更新：工作台新增[视频文件夹与导入入口](local-video-library.md)。已有结果直接切换；新视频或尚未处理的方案需要点击「处理并打开」，后台使用本机 GPU 生成完整候选。下文命令仍可用于离线复现，已有候选和旧草稿保持兼容。

| 方案 | 检测权重 | 跟踪 / 展示 | 说明 |
|---|---|---|---|
| `team-stable`，默认推荐 | E-BARD YOLOv8n | THY optimized + 稳定框展示 | 沿用 THY 原候选；前端使用上排红队、下排蓝队的颜色分组 |
| `optimized` | E-BARD YOLOv8n | BoT-SORT、原生 ReID、重复框修正、分队复核建议 | 不保证遮挡续接或真实身份正确 |
| `reid` | E-BARD YOLOv8n | BoT-SORT + 检测器原生外观特征 | 没有独立 ReID 权重，无隐式下载 |
| `low` | E-BARD YOLOv8n | BoT-SORT，检测下限 0.10 | 保留低分续接候选 |
| `baseline` | E-BARD YOLOv8n | BoT-SORT，检测下限 0.25 | THY 的原配置对照；LAL 样例中原有 `original` 即此方案 |
| `ebard` | E-BARD YOLOv8n | 原有 ByteTrack | 004–006 原候选保持；球员 / 裁判分开跟踪，球 / 筐为逐帧检测 |
| `original` / `yolo` | 通用 YOLOv8s | ByteTrack | 004–006 沿用原 `original`；LAL 新增 `yolo`，通用 person 类可能包括观众和裁判 |

`team-stable` 是同一组观测的展示处理，不是另一套检测模型。所有框、分队和编号建议仍需人工确认。球场标定继续使用原有 48 点模型与篮筐方向约束，独立于这里的人物跟踪选择。

### 权重

本轮从已有本机文件复制到忽略目录，原权重未改；没有重新下载这两个权重。

| 本机相对路径 | 字节数 | SHA-256 |
|---|---:|---|
| `tmp/models/BODD_yolov8n_0001.pt` | 6,151,282 | `dfe3534d51bb21024d1a400c37f0c1fbf0c8b96ea9a56a5f3cb5454813bfd641` |
| `tmp/models/yolov8s.pt` | 22,588,772 | `1f47a78bf100391c2a140b7ac73a1caae18c32779be7d310658112f7ac9aa78a` |

已记录的上游来源：[E-BARD 模型仓库](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models)，修订 `3f4789c4431aa73269f60107a4ba0a5f86b7af8b`；[Ultralytics YOLOv8s 发布权重](https://github.com/ultralytics/assets/releases/download/v8.4.0/yolov8s.pt)。来源与类别说明沿用[原模型核查](../research/vision-player-refinement/ebard-assessment.md)及[THY 运行记录](../research/player-tracking-workbench-20261002.md)；本轮核实本地字节及实际运行，不重新宣称已验证训练来源。

### 环境

本轮推理入口为 `tmp/model-runtime/Scripts/python.exe`：Python 3.12.10、PyTorch 2.11.0+cu128、CUDA 12.8、Ultralytics **8.4.171**、PyAV 17.0.0，GPU 为 NVIDIA GeForce RTX 5070 Laptop GPU。

原环境 Ultralytics 8.4.63 运行 THY 配置时，在第 4 帧触发原始检测索引重复校验。为保持 THY 方案，独立环境只安装其已用的 8.4.171，复用已有 CUDA 依赖。原环境未升级。`prepare_tracking_variants.py` 明确检查此版本及 CUDA；不会静默改为 CPU。

THY 默认请求 `quantize=16`。执行器保留请求，并记录实际参数类型；本轮记录为 `torch.float32`，不能据请求声称整模型实际使用 FP16。执行器在旧 API 中可使用 `half` 参数，但旧运行库没有完成 THY 验证，不应用它生成正式 THY 对照。

## 在另一台机器准备

### 只浏览已有候选

先取得本分支和 Git LFS 成片。预计算工作台可使用 Python 3.12 与 PyAV，本轮验证的 PyAV 版本为 17.0.0；展示已有候选不需要 CUDA 或人物模型权重。

```powershell
python -m venv .venv
& .venv/Scripts/python.exe -m pip install av==17.0.0
git lfs pull
& .venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8890
```

浏览器打开 `http://127.0.0.1:8890/`。React bundle 已随源码保存；修改 React 源码时再在 `engineering/tools/player-review/` 运行 `npm ci` 和 `npm run build`。新环境安装命令为依赖准备说明，本轮运行验证使用下文已有视觉环境。

自动球场初始化另需[球场后端说明](court-calibration-backend.md)中的视觉依赖和[球场模型来源](../research/vision-player-refinement/court-model-comparison.md)；没有准备该模型时仍可人工标定。离线视频渲染优先使用 `--ffmpeg` 指定程序，否则先查找 PATH，再查仓库 `tmp/tactics-ffmpeg.exe`；未找到时明确报错，不依赖作者电脑的绝对路径。

### 重新运行人物模型

先准备可用的 CUDA / PyTorch 视觉环境、上述两份匹配 SHA 的权重及完整 LFS 视频。下面使用自己的已有视觉环境，运行位置为仓库根目录。`$visionPython` 按该电脑实际位置设置；以下相对位置是原工程环境的惯例。

```powershell
$visionPython = (Resolve-Path tmp/vision-deploy-bench-venv/Scripts/python.exe).Path
& $visionPython -m venv --system-site-packages --without-pip tmp/model-runtime
$visionPackages = & $visionPython -c "import sysconfig; print(sysconfig.get_paths()['purelib'])"
Set-Content tmp/model-runtime/Lib/site-packages/reused-vision-dependencies.pth $visionPackages
& $visionPython -m pip install --no-deps --index-url https://pypi.org/simple --target tmp/model-runtime/Lib/site-packages ultralytics==8.4.171
& tmp/model-runtime/Scripts/python.exe engineering/scripts/prepare_tracking_variants.py --check
```

仅本机 `.pth` 文件保存所复用环境的位置，留在忽略目录，不提交。`--check` 校验两份模型 SHA、库版本和 CUDA；缺失依赖应在视觉环境中按[已有环境说明](../research/vision-local-aws-deployment.md)准备。不要把其他电脑的虚拟环境直接复制过来。

## 生成与复现

批处理先核验视频 SHA，拒绝覆盖已有候选、元数据或报告。它只输出候选和建议的 `library_entry`，不修改样例清单或草稿。

```powershell
# 先在短帧检查五种执行配置；partial_run=true，不登记工作台。
& tmp/model-runtime/Scripts/python.exe engineering/scripts/prepare_tracking_variants.py --sample 004 --variants baseline low reid optimized yolo --max-frames 8 --output-dir tmp/check-new --report tmp/check-new-report.json

# 新视频或需要的新对照使用全片；输出和报告路径必须未被占用。
& tmp/model-runtime/Scripts/python.exe engineering/scripts/prepare_tracking_variants.py --sample 004 --variants baseline low reid --output-dir tmp/new-candidates --report tmp/new-candidates-report.json

# 也可直接运行 THY 完整跟踪配置，保留解码 PTS。
& tmp/model-runtime/Scripts/python.exe engineering/scripts/basketball_run.py --video data/videos/tactics/acceptance/clips/004_GSW_elevator.mp4 --weights tmp/models/BODD_yolov8n_0001.pt --variant optimized --output tmp/new-optimized.json --evidence-frames
```

生成 `team-stable` 展示元数据使用既有 `prepare_basketball_team_overlay.py`，输入清单中必须先登记 `optimized`。原 E-BARD + ByteTrack 入口为 `build_ebard_review_tracks.py`；该入口也拒绝覆盖旧候选。原候选与新结果的临时 T 编号不应互相套用。

## 本轮验证

- 五种执行配置各完成 8 帧 GPU 检查；E-BARD + ByteTrack 另以原有逐角色跟踪逻辑完成 8 帧检查。ReID 确认收到原生检测特征。
- 为 004 / 005 / 006 分别生成 baseline、low、reid 全片候选，帧数分别为 **210 / 143 / 462**；为 LAL 新增通用 YOLO + ByteTrack **267 帧**。共 10 组、2,712 帧观测。
- 逐一核对源视频 SHA、完整解码帧数、顺序、每帧唯一 T 编号和 PTS。输出时间保留 9 位小数，最大舍入误差约 `4.99e-10` 秒。
- 四个样例已有 optimized / team-stable 的 JSON 与元数据，共 **16 个文件**，与 THY `1839dcd` 快照 SHA 完全一致。
- 38 项跟踪 / 渲染测试和 8 项展示测试通过。Windows 沙箱下的临时目录 ACL 阻止了两项文件测试；在获准提升执行后完整通过。

新候选位于 `data/videos/tactics/acceptance/tracks/integration-20261002/`。权重、每组候选、配置、元数据及保留文件的哈希见[机器可读核验](../research/model-integration-20261002.json)。本轮没有独立真人身份真值、IDF1 / MOTA 或米制脚点误差评测；检测数量和显示稳定性均不等于准确率。
