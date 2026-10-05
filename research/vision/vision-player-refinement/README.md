# 远端漏检改进与人工轨迹复核

- 实测日期：2026-10-01（Asia/Shanghai）。
- 状态：同一片段上的诊断实验与本地复核原型；未训练模型、未部署 AWS，未完成独立准确率评测。
- 用户需求：排除观众和裁判误入、找回远端球员；允许通过前后帧估计短遮挡；先人工选定球员，再向后续加工输出。
- 使用说明：[球员选取界面](../../../engineering/tools/player-review/README.md)。
- 2026-10-02 新增实测与接入：[RTMPose-s 脚部对照](feet-model-comparison.md)、[YOLO11n / KaliCalib / LSD 场地对照](court-model-comparison.md)、[镜头传播与字幕干扰核查](propagation-validation.md)。工作台已有球 / 筐对象选择、人工可采用的脚部候选、标定向导和逐帧场地参考；位置精度仍待独立验收，ByteTrack 本轮未继续开发。
- 2026-10-02 用户收敛优先级：[直播画面筛选 → 球员标定 → 轨迹补全](data-extraction-workflow.md)。当前界面按此顺序工作；下面保留旧 IND–OKC 实验及诊断原貌，不能将该场景的球衣规则或测量推广到新素材。战术与讲解在轨迹提取后处理。
- 2026-10-02 人工身份修正：[裁剪能力及身份绑定核查](identity-binding-review.md)。普通选人已改成从确认帧向后生效，旧草稿先备份；只释放重复 ID 的受影响区间，保留其他球员后续正确确认。本机验证通过，未推送。

## 实际改动

1. `YOLOv8m` 以 1280 输入运行全画面及左右重叠分块，再合并重复框，提高远景人物的有效像素数。
2. 按手工绘制的候选区域、身体框形状及黄/白球衣颜色规则过滤。`clip001-profile.json` 绑定本段视频 SHA-256，禁止套到其他视频；这是场景规则，尚无自动球场标定或通用球员分类器。
3. 调整 ByteTrack 参数，弱框不再因置信度融合而过度降低关联分数。暂未取得稳定 ID 的有效检测用虚线“ID pending”显示，不伪造身份。
4. 加入人工固定身份 P1–P10、关键帧修正、短缺口前后插值、冲突提示、缺失跳转与带来源的 JSON 导出。可选裁判编号需自行补点。

实现：[检测筛选](../../../engineering/archive/vision-clip001/basketball_player_filter.py)、[视频及候选生成](../../../engineering/archive/vision-clip001/render_vision_tracking_demo.py)、[问题点评估](../scripts/evaluate_vision_problem_cases.py)、[本地服务](../../../engineering/scripts/serve_player_review.py)、[复核界面](../../../engineering/tools/player-review/README.md)。

## 后续诊断：编号中断与纠正

2026-10-01 21:34（Asia/Shanghai）补充。用户反馈 P1/P2 后半段持续红色，要求检查原因并提供新旧编号纠正手段。以下具体编号属于本段原跟踪结果；用户 P 编号可自行选择，不能固定等同于某个模型 ID。

### 为什么变红

1. **换号**：远端白衣球员原临时 ID 10 的最后一帧为下标 131，后续 ID 33 持续至 147。把界面第 133–148 帧关联到 33 后，恢复 16 帧；此前这 16 帧已有人物框，只是 P 身份没有续接。
2. **出画与画面边缘的残缺框**：该白衣球员约 5 秒后跑出右侧画面。下标 148–151 的检测只剩窄框或腿部，被形状/颜色规则过滤；152–154 未再找到对应边缘候选，154 帧原图已看不到该球员。出画应单独标记，不能为了填满轨迹继续猜位置。
3. **遮挡后过滤与重新建轨**：远端黄衣球员 ID 8 到下标 148 为止，候选 ID 39 从 159 开始。149、155–157 帧只检到上半身时，框底部被误当作脚下点，触发场外过滤；151–154 附近也存在没有单独检出该黄衣球员的帧。150 帧的弱候选虽保留，仍未成功维持原轨迹。问题涉及检测、我们自己的过滤规则和跟踪关联三层。
4. **串号**：原临时 ID 3 起初属于白衣 9 号，后来转到黄衣粉鞋球员；只按 ID 全片合并会把错误延续。人工关联必须允许限定区间。

框、过滤原因和区间数据见 [tracking-diagnosis.json](tracking-diagnosis.json)。检测器给出人物框，跨帧编号由跟踪器关联；官方说明也分别列出两阶段低置信度关联、外观匹配和相机运动补偿等能力。[Ultralytics 跟踪文档](https://docs.ultralytics.com/modes/track/)（2026-10-01 查阅）；本轮同时检查了本机 `ultralytics 8.4.63` 源码。

### 直接调整跟踪是否够用

复用同一批 YOLOv8m 检测候选，对照 5 个配置，各运行一次。人工画了 17 处可见球员参考框，其中 4 处是首帧身份；“保持首帧 ID”只是这些问题点的身份连续性检查，不能换算成完整准确率。参考框只用于评估，未送入跟踪算法。

| 配置 | 解码及跟踪耗时，已缓存检测 | 17 处有对应框 | 其中保持首帧 ID | 累计临时 ID |
|---|---:|---:|---:|---:|
| 原 ByteTrack | 2.84 秒 | 17 | 8 | 21 |
| ByteTrack，保留失踪目标 60 帧 | 2.90 秒 | 17 | 8 | 21 |
| BoT-SORT，关闭 ReID、启用镜头运动补偿 | 7.18 秒 | 17 | 8 | 19 |
| OC-SORT，启用低置信度关联 | 2.89 秒 | 17 | 11 | 18 |
| ByteTrack，加入黄/白球衣约束 | 3.31 秒 | 17 | 11 | 23 |

依据：[耗时](tracker-comparison.json)、[身份参考框](identity-cases.json)、[逐项结果](identity-comparison.json)。临时 ID 更少并不代表身份更准：OC-SORT 在末帧仍出现黄衣球员使用原白衣编号的情况。球衣约束减少了已观察到的粉鞋黄衣球员串号，但没有消除遮挡后的换号，因此界面中作为**独立实验版本**保留，原草稿不迁移或覆盖。

这轮未训练或更换 YOLO 权重。仅修改 YOLO 的检测置信度不能保证编号稳定；颜色规则在遮挡、同队球员交叉时也有限。原先按框底部判断场内的规则仍有局限，当前以短缺口估计、分段关联和人工复核处理，不声称已完成自动遮挡恢复。

### 面板改进与验证

- “找回新编号”按时间、空间及最近可用的球衣线索提出候选；原轨迹末端可提出 `10 → 33` 和 `8 → 39`。候选须看片确认，不自动合并。
- 按帧区间关联，支持预览两端、调整区间、删除与撤销；已有人工锚点优先。出画区间以灰色保存；再次入画可覆盖相应范围。
- 测试副本中，白衣目标原有 111 帧待处理；接上 33 后剩 95 帧；将已检查的第 155–243 帧标为出画后，剩 6 帧仍待处理。出画的 89 帧没有生成坐标，也不算成模型识别成功。代理未代替用户修改正式草稿的身份关联或导出确认。
- 原跟踪补充了球衣线索；程序逐帧确认 243 帧的原 ID、坐标、时间戳完全不变。另修正候选匹配代码对跟踪器内部索引的依赖，增加高低置信度子集的回归测试；本片段待关联框总数仍为 35，不能据此宣称检测提升。
- 13 项轨迹/导出测试、2 项候选匹配测试通过；浏览器实测分段续接、出画、撤销、删除和版本草稿隔离，未发现控制台错误。截图保存在忽略目录 `artifacts/vision-tracking-repair/id-link-demo.jpg`。

### 本轮复现命令

检测缓存与对照运行（首次约需数十秒；依赖已有权重及环境）：

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/diagnose_player_tracking.py --video data/videos/nba/2024-25/clips/IND-OKC_Q4_pick-pop_8.1s_1080p.mp4 --cache artifacts/vision-tracking-repair/detections.json
python research/vision/scripts/evaluate_identity_cases.py
```

为复核界面补充球衣线索，输出路径须未被占用：

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/prepare_player_review.py --video data/videos/nba/2024-25/clips/IND-OKC_Q4_pick-pop_8.1s_1080p.mp4 --tracks artifacts/vision-player-refinement/player-candidates-v2.tracks.json --output artifacts/vision-tracking-repair/original-review.tracks.json
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/prepare_player_review.py --video data/videos/nba/2024-25/clips/IND-OKC_Q4_pick-pop_8.1s_1080p.mp4 --tracks artifacts/vision-tracking-repair/byte-jersey.tracks.json --output artifacts/vision-tracking-repair/jersey-review.tracks.json
```

然后按[操作说明](../../../engineering/tools/player-review/README.md)启动双版本服务。诊断缓存、逐帧轨迹和截图保持在忽略目录；共享报告、评估依据和代码。

## 同一问题片段的检查

片段 ID：`nba-2024-25-library100-001`；8.1 秒、1080p、243 帧。当前路径为 `data/videos/nba/2024-25/clips/IND-OKC_Q4_pick-pop_8.1s_1080p.mp4`。

SHA-256：`8ed5a5c07ee550ed89db2d9a01b8ba1d59ace52a85a1fec0c78a77ac7644ac7d`。

从原画面勾选了 16 个问题参考框，以 IoU ≥ 0.5 检查是否有对应可见框。参考框只用于评估，未用来生成输出框。它们来自调参时已看过的画面，因此以下是问题修复检查，不能视为独立测试集准确率。

| 检查项目 | 旧版 YOLOv8s 640 | 改进版 |
|---|---:|---:|
| 远端黄/白球员，3 帧共 6 处 | 1/6 有对应框 | 6/6 有对应框及临时 ID |
| 其他球员，4 处 | 4/4 | 4/4 |
| 裁判/场边非球员，6 处误入 | 4/6 被框出 | 0/6 被框出 |

依据：[参考框](problem-cases.json)、[逐项结果](comparison.json)。没有据此宣称所有观众、裁判均已排除，也没有确认每帧十名球员全部正确。

## 耗时与验证

同一台 RTX 5070 Laptop 8GB 电脑；环境详见[前轮本机实测](../../runtime/vision-local-aws-deployment.md)。本轮每种渲染配置各记录一次：

| 指标 | 旧版 | 改进版 |
|---|---:|---:|
| 含导入、检测、跟踪、绘框、编码 | 12.73 秒 | 34.52 秒 |
| 其中检测至渲染结束 | 9.03 秒 | 30.70 秒 |
| 全片累计临时 ID | 64 | 21 |

原始记录：[baseline-run.json](baseline-run.json)、[refined-run.json](refined-run.json)。这些是含视频编码的耗时，不能与此前只算解码/检测/跟踪的约 2.7 秒直接比较。34.52 秒仅是这一段 8.1 秒视频，不含人工复核、战术分析、语音或最终贴图；尚不能保证完整任务在十分钟内完成。

243 帧完整解码通过；输出与原片视频时间戳最大差为 0；351 个 AAC 包的内容哈希一致，见[媒体检查](media-validation.json)。轨迹与导出逻辑 8 项测试通过；浏览器检查见界面说明。

原始运行记录保留运行当时的 `library100/` 旧路径。测试期间另一个任务按赛季整理了本地素材；重新核对视频哈希后，服务和当前命令已改用新路径，未撤销该整理。

## 复现

模型文件放在忽略目录 `tmp/vision-deploy-bench/`。使用已有测试虚拟环境，无训练步骤。输出路径若已存在，脚本会拒绝覆盖，应换一个新文件名。

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/render_vision_tracking_demo.py --video data/videos/nba/2024-25/clips/IND-OKC_Q4_pick-pop_8.1s_1080p.mp4 --model tmp/vision-deploy-bench/yolov8m.pt --imgsz 1280 --player-profile research/vision/vision-player-refinement/clip001-profile.json --output artifacts/vision-player-refinement/player-candidates-v2.mp4
```

会同时生成 MP4、运行摘要和 `.tracks.json`。然后按[界面启动说明](../../../engineering/tools/player-review/README.md#本地启动)打开复核。旧版去掉 `--player-profile`，使用 `yolov8s.pt`、`--imgsz 640` 和独立输出路径。

```powershell
python research/vision/scripts/evaluate_vision_problem_cases.py --cases research/vision/vision-player-refinement/problem-cases.json --baseline artifacts/vision-player-refinement/baseline-with-tracks.tracks.json --improved artifacts/vision-player-refinement/player-candidates-v2.tracks.json --output artifacts/vision-player-refinement/rechecked-comparison.json
```

视频、候选数据、界面截图和权重保留在忽略目录；共享代码、规则、测量摘要及评估依据。

## 来源与边界

- 用户本轮口述：2026-10-01，要求人工选人、前后帧估计和选定后再加工。手动纠正能提高可控性，不能证明所有后续帧百分之百正确。
- [Ultralytics YOLOv8 官方文档](https://docs.ultralytics.com/models/yolov8/)：2026-10-01 查阅，核对模型规格与变体。
- [官方 YOLOv8m 预训练权重](https://github.com/ultralytics/assets/releases/download/v8.4.0/yolov8m.pt)：2026-10-01 下载；52,136,884 字节；SHA-256 `5d4a90cdc7a21786cc59cd19778e9eafff836df9e2da32524737c7ee6efe4fe5`。
- 素材来源记录见[片段 001](../../../data/videos/nba/2024-25/notes/001.md)；本轮使用已有本地成片，没有重新采集视频。
- 球衣规则、区域、插值间隔和像素速度门槛均为当前原型参数。换比赛、球衣、镜头或画幅必须复核；当前未做球员姓名自动识别、球场姿态标定、镜头运动补偿或战术成片生成。
