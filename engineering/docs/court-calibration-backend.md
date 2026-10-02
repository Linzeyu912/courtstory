# 篮筐方向约束的球场标定后端

更新：2026-10-02，Asia/Shanghai。依据用户要求实现“找篮筐 → 判断方向 → 约束场地关键点 → 用地面交点计算位置”。这是本机工程功能；全部输出仍需复核，米制精度尚未验收。

## 处理流程

1. 读取与当前视频、帧和时间对应的 E-BARD 篮筐检测。当前复用已有检测结果，不重新运行人物检测或更改 ByteTrack。浏览器选择通用检测版本时，后端可以读取同一视频已登记的 E-BARD 对象，分别记录两个检测版本的指纹。
2. 运行本机 YOLO11n 48 点模型，分别检查两组已有语义定义的场地点。根据禁区底线到罚球线的方向、远近边关系及篮筐与推算篮下地面位置的一致性，判断当前视图的左右朝向。没有采用“篮筐横坐标小于画面一半就是左半场”的规则，也不再仅以两组点的置信度总和选边。
3. 如果地面结构与篮筐一致，但模型将其放入另一侧槽位，可以重新解释左右语义。保留原始像素坐标、`modelSlot`、`slotSide` 和重解释依据。预测出虚假的镜像球场、地面点不足或多组几何冲突时返回失败原因。
4. 只用具名地面点拟合球场到画面的 `courtToImage`，并提供反向矩阵 `imageToCourt`。篮圈有高度，绝不作为地面拟合点。球员脚点仍须单独确认是否接地。
5. 请求镜头传播时，使用本次初始地面参照调用已有 SIFT / LK 流程，整段保持初始方向，在来源剪辑边界及传入切镜边界处停止。失效帧保留空白。

当前方向按同侧主转播视图解释。反向机位、镜像、篮下视角及跨机位物理球篮身份仍需人工核对；后端没有自动辨认球队进攻端。多筐、不可见篮筐、退化点布局、异常透视等情况会返回不确定，不能当作全自动通用标定。

代码：[方向与几何](../scripts/court_orientation.py)、[模型运行与初始化](../scripts/court_calibration.py)、[镜头传播](../scripts/court_propagation.py)。

## 本机模型

使用此前下载并核验的模型，默认路径为 `tmp/court-models-v2/best.pt`，SHA-256：

```text
68e5faf5fb5388cf83477238abe22e9824a69fb33a4cf34f79ab61858f410064
```

服务只在首次自动标定请求时加载模型。可用 `--court-model` 指定这份权重的其他本地路径，用 `--court-imgsz 640` 或 `960` 选择输入尺寸，默认 640。缺少权重、哈希不符或推理依赖不可用时返回明确错误，不自动下载或安装。原先只使用人工标定及剪辑的操作无需加载模型。

依赖使用已有视觉环境，见[运行环境记录](../research/vision-local-aws-deployment.md)。共享仓库不包含模型权重。

## HTTP 接口

启动服务的原命令保持可用：

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

新增 `POST /api/court-calibrate`，请求类型为 `application/json`，只服务本机登记的视频：

```json
{
  "sample": "005",
  "variant": "ebard",
  "frame": 0,
  "cuts": [],
  "propagate": false
}
```

- `frame` 为从零开始的帧号；`variant` 省略时取该样例默认版本。
- `cuts` 为额外切镜边界；真实来源剪辑边界始终保留。
- `propagate: false` 只返回初始参照，设为 `true` 则继续生成同镜头逐帧候选。
- 返回既有 `courtCandidates` 格式：`schemaVersion: 1`、`template: "NBA"`、`videoHash`、`keyframes`、`invalidFrames` 等。新增 `initialization` 记录方向依据、原始来源帧 / 时间和模型版本。
- 初始化不确定时返回 HTTP 200，`initialization.status: "invalid"`、`keyframes: []`、`unresolvedFrames: [frame]`，保留机器可读的原因；不会伪造左右侧来填满候选。非法请求返回 400，缺少可用本地模型返回 503。
- 有效候选保留 `needs_review`、`reviewRequired: true`、`metricAccuracyValidated: false`。

该接口与原 `/api/court-propagate` 一样只返回提议，不修改浏览器草稿或服务器已加载的候选文件。此次只改后端，前端如需新按钮，应调用本接口并继续走已有人工采用流程。返回值未经保存并重新登记前，不会自动随另一次剪辑进入缓存。

## 命令行生成文件

省略 `--seed` 时自动根据篮筐与场地点初始化；必须指定新输出路径，已有文件会被拒绝覆盖：

```powershell
# 只看初始场地候选
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/build_court_review_candidates.py --sample 005 --frame 0 --initial-only --output artifacts/court-auto-005-initial.json

# 初始化后跟随同一镜头
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/build_court_review_candidates.py --sample 005 --frame 0 --output artifacts/court-auto-005-motion.json
```

原来的 `--seed <JSON路径>` 入口继续使用指定的地面参照。自动初始化失败时仍写出含原因的诊断 JSON，调用方需要检查 `initialization.status` 和 `summary.validFrames`，不能仅凭命令退出成功判断已获得标定。

生成文件可经复核后在视频库显式登记为 `courtCandidates`。旧研究、种子和共享候选不会自动替换。已登记的候选经过裁切时，初始化的本地帧号和待处理帧会同步映射；参考帧被删掉则标 `source_removed`，保留原始来源帧和时间，不在二次裁切时恢复为有效初始化。模型输入的旧检测指纹用于追溯原始证据，不代表重新推理过裁切视频。

## 来源与验证入口

- [E-BARD 模型卡](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models)：球员、裁判、篮球和篮筐检测；2026-10-02 复核。
- [48 点模型卡](https://huggingface.co/koppolusameer/yolo11n-basketball-court-keypoints)：输出像素关键点，地面映射为后续步骤；2026-10-02 复核。
- [OpenCV 单应教程](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)：平面映射；2026-10-02 复核。
- [既有模型对照](../research/vision-player-refinement/court-model-comparison.md)：部分点序依据、原样例和原实验限制。

测试入口为 `test_court_orientation.py`、`test_court_calibration.py`、`test_court_initialization_trim.py`，并与原有场地、剪辑和多检测版本测试共同运行。合成测试验证几何关系和接口保护；旧样例复测只说明这些画面中的变化，不构成独立定位准确率。

2026-10-02 本机验证：后端 60 项回归、前端现有球场契约 23 项及实际 HTTP 9 项检查通过。新命令实际从005第0帧自动初始化并传播，得到139/143帧待复核映射；现有前端采用函数接收139帧，4帧保留失效。该结果验证接口和处理流程，不能解读为139帧位置均准确。完整范围、旧帧对照和同步状态见[本轮交接](../../handoffs/Linzeyu912/2026-10-02-2010-hoop-court-backend.md)。

另复用原实验的12帧关键点输出及同帧E-BARD篮筐，隔离比较方向选择逻辑：640输入保留4帧、拒绝8帧；960输入保留7帧、拒绝5帧。006第308帧的640输出从旧右侧改为左侧；004前段的错误镜像场地被拒绝。该对照没有重新推理关键点，不能将候选数量当准确率或把不同输入尺寸当同一模型输出。逐帧结果、失败原因与输入哈希见[本轮验证记录](../research/vision-player-refinement/hoop-constrained-calibration.json)。
