# 地面位置、身份 OCR 与篮球 2D 对应

核查与实现日期：2026-10-04。状态：本地实现与实验，未提交 / 推送。

## 用户要求与保留边界

1. 保留 E-BARD YOLOv8n 及其球员、裁判、篮球、篮筐检测；不改原跟踪和已有人物身份关联。
2. 建立图像地面点与标准球场的关系，求解、检查逐帧矩阵，沿用球场线约束与镜头变化处理。
3. 对比姿态 / 脚部候选与原人物框位置，产出同源帧视频，不能以“点更多”代替“位置准确”。
4. OCR 号码跟随固定 P 身份；记分牌队伍作为红 / 蓝组实际球队的候选。人确认后采用，可撤销。
5. 篮球画面检测保留，优先处理持球与 2D 对应。没有明显且经验证的收益不替换检测器。
6. 原始观测、派生米制坐标、显示平滑分开。此次不扩展平滑，实验和导出均不平滑。

## 已有能力与本次新增

核查发现已有 `court.mjs`、`court-geometry.mjs` 与后端球场处理包含 A–J 地面点语义、NBA 模板、单应性、点线优化、镜头传播和失效处理。本次不将这些旧能力宣称为新实现。

新增：

- `fitHomographyRobust`：自动控制点至少 6 个时，枚举 4 点最小集，以 5 px 残差和至少 `max(5, ceil(0.7N))` 一致点筛选，再拟合。异常点保留，输出 `excludedControlIds`。人工控制点仍使用全部人工观测；不自动删除或改写人工点。
- `ground-position.mjs`：将独立脚部候选接入 2D 派生路径，按源视频哈希、原始跟踪哈希、逐帧时间匹配；仅替代 `tracked` 的投影输入。人工点优先。候选缺失回退并标记 `groundCandidateMissing`。
- `ground-comparison-ui.mjs`：六组已缓存模型可切换；改变当前草稿的派生来源，原框与 T/P 关联保留。原图显示所选球员的青色脚部候选圈。
- `courtMappings`：逐帧导出 `imageToCourt` / `courtToImage`、支持帧、独立核验残差、拟合方式与异常控制点。`coordinatePolicy.displaySmoothingApplied=false`。
- `identity_ocr.py` / `identity-ocr.mjs`：本机 RapidOCR，号码与记分牌队伍提议、证据帧和人工采用流程。
- `ball-court.mjs`：图像观测、持球关联、人工地面投影和未知位置分开。

## 接口与数据

### 姿态候选

服务可指定 `--ground-comparison-root <comparison-directory>`。`GET /api/ground-comparison?sample=005&variant=ebard` 只返回视频与原始跟踪哈希匹配的文件，裁剪为地面候选与手腕关键点。

当前实测缓存针对 acceptance 004 / 005 / 006 的 `ebard` 版本；其他跟踪版本不能按 T ID 借用这些缓存。界面显示无匹配结果，不静默套用。

完整 JSON 保留每个 keypoint、score、原 box、原底边中心、候选 anchor、source hashes、weight hashes、原 frame / time。`contactState=unknown`、`groundContactConfirmed=false`。双脚中点 / 双踝中点均未解决起跳接地问题。

当前用户选择的紧凑结果保存在 `session.groundComparison`；原始 `trajectory` 不受其影响，`courtTrajectory` 带 `rawImagePoint` 和实际投影 `imagePoint`。原有局部存储草稿可恢复此选择。

### OCR

`POST /api/identity-ocr` 请求包含 sample、variant、videoSha256、mode（jersey / scoreboard）与 1–24 个唯一 observations。人物框允许部分出画，裁切后识别；完全不相交 / 非有限 / 退化框拒绝。

号码仅接受 ASCII 一至两位完整字符串，不自动把 O 改 0，保留 `0` / `00`。人物躯干 crop 使用原色与 CLAHE 两个视图；增强视图不算独立帧。记分牌识别范围为画面下方 36%，队名按 NBA 别名匹配；其他布局可手工填写。

前端跨帧查找均匀抽样最多 16 个已关联帧并加入当前帧，最多 17 帧；不是穷举所有帧。极短清晰瞬间可在当前帧单独识别。候选附 OCR 分数（非正确率）、不同证据帧数量、跳转按钮。采用到当前 P 的 `jersey` 与 `jerseyEvidence`；不写 T 跟踪数据。进行中的 OCR 如遭遇 P 切换或身份关联 / 原图位置变化，拒绝误用旧结果。

队伍证据保存到 `teamIdentities` 并写入所选颜色组球员 `team`。不能覆盖已确认的冲突球队 / 号码，不能把两组绑定成同队。真实姓名仍由既有“赛季 + 球队 + 号码”名单接口确认。

重要边界：本地名单仅含 2024-25 / 2025-26，不能用它为较早的 004 / 005 / 006 比赛强行确定姓名。

### 篮球

原来的 `sceneObjects` / basketball image trajectory 保留。新增导出 `ballCourtTrajectory`、`ballStateEdits`、`ballGroundAnchors`。

- 候选持球：优先手腕距离，否则人物区域接近；连续帧、相对位置变化和多人接近歧义共同判断。不是训练完成的持球分类器，输出 `reviewRequired=true`。
- 手腕路径至少 3 帧 / 0.06 秒，人物区域路径至少 6 帧 / 0.15 秒；0.12 秒以上帧间隔断开证据。短时遮挡仅预测 0.2 秒，切镜重置。
- 持球关联 `positionKind=possession_proxy`，`displayX/displayY` 来自球员地面站位，真实球 `x/y=null`，`metricPositionAvailable=false`。禁止据此算篮球距离 / 速度。
- 用户可指定当前帧控球者 / 飞行 / 未知，或在原图标注球正下方的地面位置。人工地面投影经 H 得到米制点，仍不是自动高度估计，也未验证位置准确率。
- 空中球心不使用地面 H 直接投影。缺少相机参数和高度 / 飞行约束时，单目图像点不能唯一确定篮球水平位置。本版保留未知值。

## 实验与初步结论

三段完整输入：004=210 帧，005=143 帧，006=462 帧，共 815 帧 / 每候选模型；帧时间与视频一致。

姿态模型：YOLOv8s Pose、YOLO11n Pose、YOLO26n Pose、RTMPose-s HALPE26、RTMW-l、ViTPose+ small。既有主检测器始终不替换。

YOLO Pose 使用独立全图检测、1280 输入，再以 IoU >=0.35 一对一关联到原框。RTMPose / RTMW / ViTPose 使用原框。这是不同接入方案的实际比较，不是严格同条件排行榜。RTM 在 CPU，YOLO / ViTPose 在 GPU，耗时不作统一硬件性能排名。

005 双侧候选覆盖率：95.8%、94.8%、92.0%、86.3%、96.1%、93.7%（按上述模型次序）。RTMW 提供脚趾脚跟而非只取脚踝，值得优先人工核对；尚无真实地面标注，不能宣称精度胜出。

同一矩阵下，005 RTMW 对原框底边中心的距离差中位数约 0.50 米，YOLO / ViTPose 双踝约 0.85–0.92 米；是定义与观测差异，不是误差或改善幅度。

篮球使用 WASB 官方模型库公开的 WASB / TrackNetV2 篮球权重，三帧 RGB 输入、ImageNet 归一化、512×288、0.5 热图阈值、加权连通域，保留全部候选并标记最大分量。末尾不足三帧重复末帧并留标记。005 原检测 76 / 143 帧有候选，WASB 90 / 143、TrackNetV2 91 / 143；没有真值，这些不能当作召回率，主模型保持不变。

对比视频黄十字为原框底边，青圆为新脚部点，小球场共用相同矩阵，不做平滑。篮球对比只画图像候选。全部视频按 15 FPS 慢放，保留原帧序与源时间标签；004 约 0.626 倍速，005 / 006 为 0.5 倍速。

首版矩阵：004 / 006 沿用已有镜头传播候选，005 沿用已有点线融合结果。首版完整范围分别有 102 / 210、139 / 143、300 / 462 帧可用，其他帧留空。此历史结果已由下方 16:10 的修复验收更新；独立地面真值准确率仍未验证。

OCR 实测：005 T2 的 7 个取样帧中，3 帧读到 #21，另有 #2、#3 备选；记分牌第 1 帧读到 SAS、MIA。较模糊 P1/T5 返回 #3 / #37 多候选，保留人工选择，不自动认人。

## 复现

在仓库根目录执行，输出目录由调用者选择，不能指向原始跟踪目录：

```powershell
tmp/model-runtime/Scripts/python.exe engineering/scripts/compare_ground_models.py --output <pose-output> --cache <model-cache>
# 已有同源部分结果可加 --extend，仅续跑缺少的后续帧。
tmp/model-runtime/Scripts/python.exe engineering/scripts/compare_ball_models.py --upstream <WASB-SBDT-clone> --weights <basketball-weight-directory> --output <ball-output> --max-frames 9999
node engineering/scripts/export_comparison_maps.mjs <comparison-maps.json>
tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/render_model_comparisons.py --pose-root <pose-output> --ball-root <ball-output> --maps <comparison-maps.json> --output <video-output>
tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8897 --ground-comparison-root <pose-output>
```

姿态脚本复用已有 `tmp/vision-deploy-bench/yolov8s-pose.pt`、`tmp/feet-models-v2/rtmpose-s`；其余按官方地址下载。RTM 依赖 `rtmlib`，OCR 依赖 `rapidocr_onnxruntime`，渲染依赖 PyAV / Pillow / OpenCV；本机已有专用虚拟环境。无需更改原模型文件。

WASB 篮球权重来自项目 `MODEL_ZOO.md`，文件名分别 `wasb-basketball.pth`、`tracknetv2-basketball.pth`。加载使用 `weights_only=True`、严格匹配 state dict；未加载无关训练代码。

## 验证与待办

- 新增前端核心测试 8 项通过，覆盖异常控制点、人类修正优先、源哈希、原始轨迹不变、OCR 固定身份 / 00、球队冲突、持球代理无伪造米制点、切镜重置与导出。
- Python OCR / 球场 / 传播 / 方位 / 草稿共 77 项通过；边缘框修正后 OCR 3 项复测通过。
- 前端完整回归 322 项：320 通过、2 失败。两项都是 `simple-annotation.test.mjs` 中“标定抽屉应半屏”断言；在独立导出的未修改 HEAD 基线同样失败，未修改其他任务的抽屉行为。
- 浏览器使用独立 `qa=1` 草稿实测六模型载入与切换、139 帧映射预览、OCR 多候选、无控制台错误。没有写正式用户草稿。
- 9 个 MP4 全量解码，确认实际帧数；原始检测 JSON 的 SHA256 与实验开始时一致。
- 待独立标注真实地面点 / 可见球心以计算位置误差、检测精度。空中球自动水平坐标仍需相机与高度约束；未用代理坐标替代。

本次对照成片、HTML 报告、统计、矩阵验证、OCR 证据和原始候选 ZIP 交付至调用会话的 `outputs/`。大文件与下载权重未加入仓库或推送。

## 对比报告播放修复（2026-10-04）

用户反馈报告播放器黑屏。检查发现原 MP4 的 `moov` 播放索引在末尾，原 `python -m http.server` 对视频 Range 请求返回 200 全文件；最大文件约 34 MB。这两项会增加首次加载和切换时的等待，但未复现用户黑屏的唯一触发条件。

- 9 段成片无损重封装为 `faststart`，压缩视频包 SHA256 与精确有理数表示的 PTS / DTS / 持续时间逐一相同；全部再次完整解码。容器时间基可变化，不代表帧时间变化。
- `render_model_comparisons.py` 后续直接生成索引在前的 MP4 和 `*-poster.jpg` 首帧预览。
- 新增 `serve_comparison_report.py`，只绑定本机地址，支持视频单段 Range、206 / 416、HEAD、根目录约束和切换时断开连接。
- 交付报告与生成模板同步增加首帧预览、加载 / 播放 / 错误状态、显式播放与重新加载按钮；切换源仍暂停并重新加载。视频请求附版本参数，避免沿用旧封装缓存。
- `test_comparison_report.py` 4 项通过，覆盖完整文件、前缀 / 中段 / 后缀范围、无效范围、HEAD 与缺失文件。运行中的服务器对 9 段文件均实际返回正确的 206 与对应字节。
- 浏览器检查 005 专项姿态、006 专项姿态、004 篮球、005 YOLO 播放；006 跳到 15.4 秒后 `readyState=4`。此次截图接口不可用，未将旧截图充作修复后的截图。

启动报告：

```powershell
python engineering/scripts/serve_comparison_report.py --directory <report-output> --port 8898
```

修复的逐文件依据见交付目录 `playback-fix-verification.json` 与 `report-range-verification.json`。原有视频已在会话 `work/report-before-faststart/` 留备份；原检测数据与模型不变。

## 中后段 2D 映射修复（2026-10-04 16:10，Asia/Shanghai）

已修复固定地面参考失配、短程光流达到上限后导致的长段矩阵缺失。新增近期地面参照及帧间运动一致性检查，保留人工参照、原模型和切镜约束；实现及准确性边界见[球场后端说明](court-calibration-backend.md#长镜头映射缺口修复与验收2026-10-04-1610asiashanghai)。

| 样本 | 有效变换帧 | 六个姿态候选各自同时显示黄圈 / 青点的帧覆盖率 |
|---|---:|---:|
| 004 | 210 / 210 | 100% |
| 005 | 143 / 143 | 100% |
| 006 | 461 / 462 | 99.78% |

达到每段超过 90% 的覆盖要求；006 第 418 帧仍留空。每帧有标记不等于十人都完整或身份全已绑定，006 仍有场线偏差，不能把覆盖率解释为米制定位准确率。保持原始检测 / 姿态数据、原时间标签和不平滑的对比方式。小球场用带深色描边的黄圈与青点，并显示数量，减少浅色背景和位置重叠的影响。

9 段成片已更新到原会话 `outputs/`；原报告本机地址仍为 `http://127.0.0.1:8898/`，独立复核工作台为 `http://127.0.0.1:8899/?sample=006&variant=ebard&qa=1`。工作台 QA 的晚段部分 T 尚未关联到 P，不能用该 QA 中固定身份的点数代表报告的检测覆盖率；未替用户自动认领这些身份或覆盖正式草稿。

当前验收文件为 `mapping-repair-acceptance.json`、`mapping-repair-source-verification.json`、`video-verification.json`、`matrix-validation.json` 及 `mapping-repair-004.jpg` / `005.jpg` / `006.jpg`；最新浏览器截图为 `mapping-repair-playback.jpg`。报告内的旧工作台截图只是前轮功能示例，当前修复证据以以上文件为准。前轮 `playback-fix-verification.json`、`report-range-verification.json` 和 `2d-marker-diagnostics.json` 保留为历史证据，不对应重新渲染后的文件哈希。旧视频、映射和报告模板备份在会话 `work/report-before-mapping-repair/`。

本轮完成 43 项球场相关 Python 测试、815 帧真实传播、18 组实际脚部投影检查、9 段视频完整解码、源视频 / 检测哈希核对，以及新版 006 浏览器末帧播放检查。前轮的 320 / 322 前端结果仍是历史记录，本轮没有把它记作新的完整前端回归。当前代码与文档未提交推送，见[交接](../../handoffs/Linzeyu912/2026-10-04-1610-court-mapping-recovery.md)。

## 新全场视频的泛化压力测试（2026-10-04 16:41）

用户另指定 36 秒连续全场移动视频。原片及三种增强已完整测试；脚部按固定 3 Hz 对比 YOLOv8s Pose / RTMW-l。960 输入改善 Court48 可初始化时刻，分段参照改善两端投影，但中场交接仍有米级不一致，排除接续冲突后只有 88.52%–88.89% 帧可显示，未达到此前的 90% 目标。原来的三段验收结果不能推广为这一新场景已经通过。

原 YOLOv8n 和正式草稿保留；新实验没有训练或替换工作台默认流程。完整参数、分母、失败区间、增强同源分组及复现入口见[全场泛化测试](../../research/vision/court-generalization-20261004.md)。

## 来源

以下为模型 / 方法的一手资料，采集 2026-10-04；本地实测结论不等于项目官方性能声明。

- [Ultralytics Pose](https://docs.ultralytics.com/tasks/pose/)
- [RTMPose](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose)、[RTMW](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmw)
- [ViTPose+ small](https://huggingface.co/usyd-community/vitpose-plus-small)
- [WASB-SBDT 与篮球权重](https://github.com/nttcom/WASB-SBDT)
- [RapidOCR](https://github.com/RapidAI/RapidOCR)
- [OpenCV Homography](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)
