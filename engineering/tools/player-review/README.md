# 球场数据工作台

## 2026-10-02 20:27：工作台与候选发布

当前工作台源码与预计算候选已推送至 GitHub `main`，实测远端提交为 [351292f](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/351292fba6c5e7accafea9f8780a81b93810caba)。本次最新发布说明与[20:27 交接](../../../handoffs/thy-0629/2026-10-02-2027-workbench-identity-publish.md)随本次文档提交同步，具体提交以 Git 日志为准；验证与范围见[发布记录](../../research/player-workbench-publish-20261002.md)。下方日期段落保留各轮当时的“未提交”状态，以本节为本轮最新发布说明。

默认简版、编号 1–10、人工姓名确认和 13 项 2K 能力逻辑保持。四个样例、17 个版本所需的本机篮球候选已按原字节复制为[22 份共享 JSON / metadata](../../../data/videos/tactics/acceptance/tracks/basketball-20261002/README.md)，约 19.7 MB；库中 11 条路径改指向副本，新目录 `*.json -text` 保留换行字节、SHA 与旧草稿指纹。候选是推理结果，不是模型权重，也不证明十人身份或断轨已稳定。

看预计算效果只需已有 Python / PyAV 环境与既有 Git LFS 视频，从仓库根启动：

```powershell
python engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

首次准备环境见[运行依赖](../../requirements-review.txt)和[工程入口](../../README.md)；视频沿用已有 LFS 成片，本轮不新增视频上传。模型权重、CUDA 推理环境、原缓存、QA 草稿和本机测试成片仍留本地。重跑检测才需要对应权重 / CUDA；离线 `basketball_render.py` 另须显式 `--ffmpeg <本机可执行路径>`，其历史 D 盘默认值不影响预计算工作台。本次没有新推理、OCR 或断轨续接。

更新：2026-10-02 19:30（Asia/Shanghai）。当前默认球员单标注，入口 `http://127.0.0.1:8876/?sample=004`；十个编号下新增折叠的“身份确认与 2K 能力”。三个[普通转播样例](../../../data/videos/tactics/acceptance/README.md)按对阵 / 节次命名；高级工具保留原数据提取流程。单标注范围见[原设计](../../docs/plans/2026-10-02-player-annotation-simple.md)，本轮身份资料与能力匹配见[计划](../../docs/plans/2026-10-02-player-identity-2k.md)和[实测记录](../../research/player-identity-2k-20261002.md)。

目录整理与分类共享状态见[最新同步交接](../../../handoffs/Linzeyu912/2026-10-02-1109-organize-publish.md)。下文按日期保留各轮验证记录中的当时状态；启动和测试命令已使用新工程路径。

## 2026-10-02：人工身份资料与 2K 能力

普通点击编号或球员框只查看。确认资料按以下步骤操作，和原来的“纠正编号”分开：

1. 选中一个编号，展开下方“身份确认与 2K 能力”。
2. 选择视频赛季、实际 NBA 球队，输入文字球衣号码；`0` 与 `00` 分开查询，蓝 / 橙框色不代替实际球队。
3. 点击“查找球员”，对照视频核对姓名，再从候选中选择。即使只有一人，也不会自动确认；整季同队同号可能返回多人。
4. 点击“确认身份”。能力卡显示该季游戏的总评和投篮 / 突破 / 防守原值，未知显示“未知”；展开来源可查看名册链接、各项快照日期和日期口径。
5. 需要重做时点“清除身份”或“撤销”；原编号、队色、手工姓名 / 球队 / 号码和轨道不变，刷新保留资料。切编号或改查询输入会失效原候选，需重新查找。

本机 QA 验收入口为 `http://127.0.0.1:8876/?sample=nba-lal-min-005&variant=team-stable&qa=1`。在隔离草稿中，首帧核对蓝衣 MIN 10 号 CONLEY 后，将编号 4 明确确认为 **Mike Conley / 2024-25 / NBA 2K25**；能力总评 79、三分 83、控球 89、外线防守 83。普通入口的正式草稿未写入这份示例资料。姓名确认只说明这个编号的资料已确认；框仍提示“需要核对”，不证明整段始终对应同一真人。没有位置时资料卡仍保留，也不生成球员框或坐标。

查询使用[现有 2K 数据包](../../../2K%20Player%20Data/AGENTS.md)：球队选项来自已收录 472 人两季履历中的 30 队，不是完整全队名单。整季名单含离队球员，不证明当场阵容；能力范围仍为各季 16 支季后赛球队的筛选范围。四种能力状态分别显示，保留所有 null，不跨季借值，不计算综合分或投篮命中率。

`&qa=1` 使用隔离测试草稿，可测试本轮资料确认 / 清除 / 撤销；正式导出在 QA 中禁用。实际浏览器本轮只写 QA 草稿，未改正式用户草稿、未执行真实下载；十人资料导出包装已通过 JavaScript 行为测试。两个编号不能确认同一赛季同一球员；其他编号尚有另一赛季资料时，先清除旧资料再换季。

本轮 17 项新 / 144 项全量 JavaScript、22 项新 / 102 项全量 Python、独立产品审查及真实浏览器正常流程通过；异步迟返和网络失败另由实际 app 的可控 HTTP harness 验证。原片、模型候选和历史产物不变。本地证据及[19:30 交接](../../../handoffs/thy-0629/2026-10-02-1930-player-identity-2k.md)均记录明确边界；此轮未提交或推送。

服务只读预计算候选和本地 2K 文件，不新增模型部署。已配置本机环境可在仓库根目录运行：

```powershell
& tmp/player-identity-test/.venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

`--player-data-root` 可指定只读 2K 包，默认仓库的 `2K Player Data`。权重、独立环境及实验 `artifacts` 被 Git 忽略，克隆仓库不等于已有本机环境和全部可选候选；本轮没有运行新推理、OCR、自动断轨续接、轨迹优化、投篮概率或云部署。下文保留历史功能与验收记录。

## 2026-10-02：默认球员单标注

首屏只有视频选择、球员框与脚下数字、播放 / 逐帧 / 进度、编号 1–10 及纠正入口。打开便加载可用的自动编号，无需先配置五人槽位或点击载入建议。“高级工具”保留模型选择、原来的直播筛选、球场标定、轨迹、脚候选、对象编辑和导出；返回标注不修改草稿。

身份与队色分开：已有编号不重排，队色未知仍显示灰色数字框。明确的球员检测尚未接回固定编号时显示“编号未匹配”灰框；点框、点“纠正编号”、再点正确数字进行一次续接。普通点选只查看，不确认或抢占身份。分队可在纠正入口单独修改，保存成功后结束此次纠正；人工修改可撤销。没有临时跟踪编号的检测只能人工补当前帧，界面明确提示后续尚未检出。

原 r3 的队色过滤曾把 004 十个建议缩成五个，额外丢失 288 条本来有位置的编号观测。现在从同一原始检测 SHA 的未分组建议恢复编号，不修改检测文件或旧草稿指纹。004 第 1 / 71 / 178 帧实际分别显示 10 / 6 / 3 个已编号框，另有 0 / 4 / 3 个未匹配灰框；原来第 178 帧隐藏的三个球员框重新可见。已知身份 / 角色冲突的模型编号转灰框，明确人工身份优先。未跟踪的低分重复候选收进高级工具；所有已经跟踪的球员不因队色或低分而消失。

十个编号不证明已经锁准十名不同真人。原检测仍有重复框和未标记的同队串人；不为凑十个框生成遮挡坐标。默认画面是标注预览，自动结果仍为未确认模型建议，原图脚环仍是框底参考。本轮没有更换模型、重新推理或优化轨迹；详细证据见[本轮记录](../../research/player-annotation-simple-20261002.md)。下方关于手动载入建议、五人槽位和多步默认入口的描述是上一轮历史状态。

## 2026-10-02：远端新增入口与本机版本合并

后续球员身份与连续跟踪工作继续在本目录完成。顶部“检测与跟踪”选择器由 [review-library.json](../../../data/videos/tactics/acceptance/review-library.json) 登记版本，`app.mjs` 接入视频与操作，`identity-ui.jsx` 管理固定 P 身份，`tracking-display.mjs` 管理角色候选与尾迹，`team-overlay.mjs` 管理分队颜色与稳定展示。新增的 `scene-objects.mjs` / `scene-objects-ui.mjs` 管理独立篮球和篮筐编辑，`feet-candidates.mjs` 管理脚部候选，`calibration-guide.mjs` / `court.mjs` 管理球场参考与镜头映射。服务和多版本裁切入口分别为 `engineering/scripts/serve_player_review.py`、`engineering/scripts/review_video_trim.py`。

远端 `aa2ba4f` 的三个 E-BARD / ByteTrack 预计算版本与本机 `team-stable` / BoT-SORT 版本共同保留。本机四段优先 `team-stable`；004–006 缺少本地可选产物时回退已共享的 `ebard`。模型说明按当前版本显示。旧版本独立草稿、固定十人、人工分队和精确脚点继续使用；裁切同步保留各版本来源、分队建议与展示策略，来源拼接点保持断开。

远端 `b434660` / `72c74e0` 已接入三个样例的 RTMPose-s 脚部候选、场地参考和 SIFT / LK 镜头跟随候选。脚部缓存绑定 E-BARD 原始检测文件哈希与 T 编号，切换到本机分队或其他模型时不套用；同一视频的场地候选可共用，均需人工核对后采用。脚点分数、图像脚环与场地匹配覆盖都不证明真实接地或米制精度。来源和实测见[脚部对照](../../research/vision-player-refinement/feet-model-comparison.md)、[场地对照](../../research/vision-player-refinement/court-model-comparison.md)和[传播核验](../../research/vision-player-refinement/propagation-validation.md)。下文各轮“默认版本”与测试数量保留当时状态，以本节说明当前入口。

## 2026-10-02 补充：两队颜色、稳定框与脚下编号

四段本机样例现在优先选择 `team-stable`（“分队颜色 · 稳定框与脚下编号”），最终准备文件在 `artifacts/player-team-overlay-20261002/r3/`。新建议P1–P5为蓝队，P6–P10为橙队，每队最多五人；不够可靠的候选留待确认。下文的optimized默认描述为上一轮历史状态；缺少新产物时保留原版本回退。

在球员标定中载入建议，检查人物与队色，然后分别点击身份确认和分队确认。模型建议以问号 / 虚线提示，只确认其中一项仍保留待确认；人工分队保持同队框色，原姓名、球队文字、号码和人工编号保留。旧草稿不会静默重排成新的5+5编号。

“稳定显示”默认开启，仅减少有观测框的单帧尖峰；暂停、跳转和回看使用确定的展示几何。切镜、缺失、身份边界和人工锚点不跨越，不向遮挡中填充十人坐标。脚下椭圆和编号是框底图像参考，不是已验证地面位置；人工精确脚点另存。

修改坐标时自动关闭稳定显示，拖动或输入有限小数并保存，只修改当前帧；可重新开启稳定显示，人工值保持。轨迹导出及球场投影继续使用原始 / 人工坐标，不采用展示滤波坐标。浏览器QA草稿不会自动写入冻结的预览MP4。

本轮149项回归通过，最终两行小数输入收尾的17项相关回归、独立审查、四段真实HTTP / 全帧JS-Python对照、浏览器QA和267帧 / 508AAC包验证通过。LAL目前仅有4+4个分队建议，不代表十名真人已自动识别；遮挡串号仍需人工关联。依据、指标、来源、产物与复现见[本轮记录](../../research/player-team-overlay-20261002.md)。

入口 `http://127.0.0.1:8876/?sample=nba-lal-min-005&variant=team-stable`；先保留整段、进入球员标定，再载入建议。`&qa=1`是独立测试草稿，不能正式确认 / 导出。

## 2026-10-02 补充：篮球模型版本与固定球员身份

本轮沿用同一工作台，新增第四个**可选本机入口** `nba-lal-min-005`，复用赛季目录中的 [LAL–MIN 原转播片段](../../../data/videos/nba/2024-25/clips/005_LAL-MIN_Q2_catch-shoot_10.8s_720p.mp4)。实测 267 帧、1280×720、25 fps，首帧源 PTS 为 0.120 秒；原片 AAC 音轨保持。它没有替换旧 sample `005`（SAS–MIA）。下方旧轮次中的“三段 / 通用人物候选”描述保留当时状态；本轮结果入口为[篮球跟踪工作台实测记录](../../research/player-tracking-workbench-20261002.md)。

LAL–MIN 的可用版本由 [review-library.json](../../../data/videos/tactics/acceptance/review-library.json) 明确登记：

| 工作台版本 | 生成器 `--variant` / 本地产物 | 含义 |
|---|---|---|
| `original` | `baseline` / `baseline.json` | 篮球专用模型的原配置基线 |
| `low` | `low` / `low.json` | 放入低分检测参与既有轨迹续接 |
| `reid` | `reid` / `reid.json` | 增加模型外观特征续接；此对照版本可选 |
| `optimized` | `optimized` / `optimized.json` | 保留原生外观关联，增加队色复核标记与输出重复 / 完整框修正；仍是待核对候选 |

以上产物位于本机 `artifacts/player-tracking-workbench-20261002/`，每个 JSON 有相邻 `.meta.json`。旧 004–006 保留原候选，并登记可选 `004_optimized.json` / `005_optimized.json` / `006_optimized.json`；本机对应文件齐备时默认选择 optimized，否则回退 original。缺少 LAL–MIN 的源视频或必需对照产物时跳过该可选样例，不影响已下载成片的原三样例。旧单视频 `alternativeTracks` / `jersey` 继续兼容。

界面固定显示**球员 1–10**，存储身份仍为 P1–P10。内部 T 是模型临时编号，可超过十个、断裂或串人；十个槽位与十个框都不能证明已经识别出十名不同真人。模型缺乏可靠位置时显示“遮挡 / 断轨待续接”或空位置，不为凑十人生成隐藏坐标。

模型建议需要主动点击“载入十人建议（待确认）”才进入草稿，可撤销。它写入独立 `modelBindings`，每段保持 `identitySource: model_suggestion`、`identityConfirmed:false` 与 `reviewRequired:true`，采用记录的 `modelSuggestionLoad.verified` 仍为 false；已有人工姓名、身份确认、位置与出画记录保留。确认某个当前建议后才按原有“从当前帧向后生效”规则锁定该段身份；人工选人仍不代表已测量地面脚点，也不代表整段轨迹核验完成。

各版本显示模型 / tracker / 配置 / 权重来源，API 和导出保留 `trackingMetadata` 与跟踪指纹。原 original 和 legacy jersey 的已有草稿键保持；新增模型版本把元数据纳入指纹，避免参数或建议变更后沿用旧版本草稿。服务逐版本校验源视频 SHA、实际解码帧数和源 PTS，tracked / pending 行分别为 7 / 6 列，模型建议不自动成为人工确认。

**音轨与剪辑边界**：未裁切版本均播放同一源 MP4，LAL–MIN 原音轨保持；原 004–006 本身无声。保留整段不会重编码。应用非整段人工剪辑时，当前剪辑器只编码视频，**子视频不含音轨，原片音轨保留**。子候选仍保存模型来源、父版本与根来源帧 / 时间；模型建议只映射可见的保留帧，并在切镜、删除段和检测缺口处分段。新子片段不自动转移用户草稿中的人工身份或补点。

### 本轮本机生成与启动

仓库根目录运行。模型权重 `tmp/player-identity-test/models/BODD_yolov8n_0001.pt`、独立环境 `tmp/player-identity-test/.venv/` 和生成的 `artifacts/` 均被 Git 忽略，不随克隆自动提供。当前生成器要求已配置的 CUDA GPU、PyTorch / Ultralytics / PyAV 和本机权重；它先离线生成候选，服务随后只读取预计算文件。复现请选独立输出目录，保留现有模型对照和草稿对应的候选：

```powershell
& tmp/player-identity-test/.venv/Scripts/python.exe engineering/scripts/basketball_run.py --video data/videos/nba/2024-25/clips/005_LAL-MIN_Q2_catch-shoot_10.8s_720p.mp4 --weights tmp/player-identity-test/models/BODD_yolov8n_0001.pt --variant optimized --imgsz 704 --output artifacts/player-tracking-workbench-repro-20261002/optimized.json
& tmp/player-identity-test/.venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

生成其他对照时将 `--variant` 改为 `baseline` / `low` / `reid`，并使用对应的独立输出文件；要在界面载入复现文件，须另行明确登记其 tracks 路径，服务不会自动扫描或重新推理。当前配置入口在 `engineering/configs/tracking/`。新样例测试入口为 `http://127.0.0.1:8876/?sample=nba-lal-min-005&variant=optimized&qa=1`；去掉 `qa=1` 才使用该模型版本的正式本机草稿。以上能力不代表真人身份准确率或场地米制精度已验收。

## 界面层级

### 2026-10-02：对象选择、脚部候选与移动镜头标定

当前三个样例新增以下可操作入口。原有 P 身份选择保留，本轮没有继续修改 ByteTrack。

- **篮球 / 篮筐目标**：跟踪目标面板下方逐帧列出候选，点击可高亮、改图像点或框、排除 / 恢复误检，也可在原图补点。它们独立于 P 槽保存，没有跨帧球身份或球的地面投影。
- **所选球员的脚部候选**：E-BARD 版本可展开 RTMPose-s 左右脚候选，显示脚趾 / 脚跟来源和分数。明确点击采用才改当前帧，原检测框和其他人工帧保留；可撤销。`pose_candidate_human_adopted` 仍带 `groundContactConfirmed: false`，因为模型点不证明鞋与地面接触。切换通用 YOLO 时不会套用 E-BARD 编号的脚部缓存。
- **球场标定 → 2D**：按“选篮侧 → 点具名交点 → 核对反投影线 → 预览 2D”操作。示意图显示 A–J 的具体含义，原图可逐点重选；ABCD 是禁区四角。候选不会自动变成已确认数据。
- **跟随镜头**：从一帧有效地面参考生成 SIFT / LK 图像运动候选。匹配不足、切镜或范围外保持空白；人工标定帧优先。采用后，同一个 P 的原图脚点和轨迹才按每帧映射显示在 2D。当前逐帧候选禁止跨缺失帧插值，保留来源与质量信息。

**快速验收**：打开样例 005，保留整段并关联一个球员。在“球场标定 → 2D”点“跳到参考帧”，先核对原图场地线，再点“采用候选并预览 2D（精度待核对）”。上方会出现该 P 的球场轨迹及缺口。004 的参考在界面第 71 帧，来自 AI 目视点选，D 点有遮挡，需重点核对；005 / 006 的首帧参考来自经方向筛选的模型候选。已有人工标定不会被这些候选覆盖。

模型已在本机实际下载、比较并运行：[脚部对照](../../research/vision-player-refinement/feet-model-comparison.md)、[场地模型对照](../../research/vision-player-refinement/court-model-comparison.md)、[移动镜头核验](../../research/vision-player-refinement/propagation-validation.md)。YOLO11n 场地点在 12 帧中有 7 帧认反半场，保留作待核对参考；KaliCalib 使用原生 FIBA 模板，保留离线对照。工作台当前选择“可审阅参考点 + 地面特征跟随”，不能称为自动精确标定。

本机 API `POST /api/court-propagate` 在参考帧前后各最多 20 秒、同一镜头内计算。屏蔽检测框与画面底部 25%，是针对这三个转播样例的启发式；其他字幕位置仍需适配。脚部候选和场地候选严格绑定视频，脚部另绑定检测文件字节哈希；裁切同时重映射帧、时间和来源。修改或删除参考几何、补切镜后，依赖旧参考的映射停止生效，需重新核对或生成；独立人工标定保留。当前没有自动直播 / 回放分类，也没有任意上传视频的全自动推理入口。

**相机角度**：地面到图像的单应矩阵足够进行脚下地面点的 2D 映射，不必先求相机俯仰角。要恢复真实相机姿态，还需内参等条件；本轮没有输出未经验证的角度。原理见 [OpenCV 官方教程](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)（2026-10-02 查阅）。所有米制结果仍需独立精度验收。

当前共享场地候选的实际覆盖如下；有矩阵仅表示通过本轮匹配门槛，仍需检查投影线和地面点。计时含解码、CPU 特征提取 / 匹配和记录收集，不含已有 E-BARD 检测、写盘、渲染与人工校准。

| 样例 | 初始参照 | 可生成映射 / 总帧 | 连续 LK 回退上限 | 本机耗时 |
|---|---|---:|---:|---:|
| 004 | 第70帧 AI 目视四角，E 留出核验 | 102 / 210 | 60帧，仅该片段经过抽查 | 11.84秒 |
| 005 | 第0帧 YOLO11n 具名点，已目视核对方向 | 139 / 143 | 12帧 | 8.27秒 |
| 006 | 第0帧 YOLO11n 具名点，已目视核对方向 | 300 / 462 | 12帧 | 26.46秒 |

表中帧号为零基，界面加一显示。实时按钮采用较保守的12帧回退；004的60帧配置只保留已抽查的预计算短段，不推广为通用上限。缺失帧可在清楚可见处补新的标定关键帧，再生成并采用局部候选。场地线残差与脚部模型分数都不是地面精度。

复现预计算候选（仓库根目录）：

```powershell
tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/build_court_review_candidates.py --sample 004 --seed engineering/research/vision-player-refinement/court-seed-004.json --fallback-frames 60 --output artifacts/court-004-new-run.json
tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/build_court_review_candidates.py --sample 005 --seed engineering/research/vision-player-refinement/court-seed-005.json --output artifacts/court-005-new-run.json
tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/build_court_review_candidates.py --sample 006 --seed engineering/research/vision-player-refinement/court-seed-006.json --output artifacts/court-006-new-run.json
```

### 2026-10-02：两种检测版本与持续跟踪演示

004–006 均可在顶部切换 **通用 YOLOv8s + ByteTrack** 与 **E-BARD YOLOv8n + ByteTrack（推荐）**，默认打开 E-BARD。当前界面读取已在本机跑好的逐帧结果；上传任意视频并自动推理的入口尚未实现。两种版本分别保存草稿，原版草稿键保留；实际裁剪会同步裁剪两种结果、篮球 / 篮筐候选及来源帧，切换时不会把旧 T 编号直接套到新模型。

原画面新增最近 1.2 秒的 T / P 尾迹，所选 P 高亮；缺失、冲突、估计、切镜和异常跳跃处断开。它是受镜头移动影响的图像轨迹，不能直接当球场跑动距离。E-BARD 将球员和裁判分别送入 ByteTrack，输出全局唯一 T 编号；同一人物可能同时被分成两类，此时保留并提示“角色待核对”，仍需人工筛选。

篮球橙框、篮筐粉框及中心点单独显示，可用“篮球 / 篮筐”开关隐藏；不进入 P 候选。兼容导出 `sceneObjects` 包含逐帧框、置信度和来源，标明 `coordinateSystem: image_pixels`、`continuousTracking: false`、`groundProjection: false`。它们尚未做跨帧球轨迹，篮筐与空中球也不能混入地面单应标定。

**可复核例子**：004 的蓝衣 30 号在零基第 0 帧为 T2，零基第 100 帧为 T23；界面对应第 1 / 101 帧。把这两个确认点归入 P1，早段继续 T2，后段使用 T23，中间缺口保持空。白衣 15 号 T1 可作稳定输出对照。这里只核对了若干可辨认画面，不能据此宣称整段真人身份准确；其他编号也观察到串人。

本机 RTX 5070 Laptop 上，三段 815 帧的解码、检测、分角色跟踪和结果收集共 **15.83 秒**；加载与预热另为 0.52 秒，不含结果渲染、JSON 写盘或人工修正。参数和逐段结果见[运行记录](../../research/vision-player-refinement/ebard-tracking-probe.json)。已有性能不能承诺未知长度视频的完整处理一定少于十分钟。

RF-DETR Nano 仍为调研候选，未加入本轮选择器；它同样逐帧检测，需要后接跟踪器。真实脚地接触、移动镜头自动标定和米制位置精度仍待验证。

用户在该轮收尾时将 ByteTrack 后续工作交给另一位合作者，保留已完成代码与样例，不再追加持续跟踪开发。双检测模型接入已随 `aa2ba4f` 推送；随后独立整理[脚下地面点和 2D 球场转换调研](../../research/vision-player-refinement/ground-tools-survey.md)，本轮进一步实测和接入的范围见上节。

- **第一步：直播画面筛选**。先逐帧选择能看清整体站位的直播区间，排除特写、回放、采访、停帧和慢放。可保留整段或多个区间；应用后生成实际 MP4 和匹配的候选帧。删除段不进入输出，保留段之间设置切镜边界。当前是人工筛选，尚无自动画面分类。
- **第二步：球员标定**。十个固定身份槽位 P1–P10，React 面板用于候选预览、明确关联、姓名 / 球队 / 号码及坐标修改。候选人数不保证十人，需排除观众 / 裁判并补漏；裁判 R1–R3 可选。十人完成按钮要求全选且无重复编号冲突；可以先检查一个球员的轨迹。
- **第三步：轨迹补全**。原视频下方直接显示同步的 2D 球场，保留滑动半场 / 全场、跟随球员及点击轨迹定位。保持同一个 P，把前后多个 T 编号按正确区间归并，处理串号 / 出画，再补原图脚点、改框或手绘拟补路径；也可直接在球场补当前帧并撤销。没有有效标定时提示校准，人工球场点单独保存。新草稿默认关闭自动补点，旧草稿保留设置。
- **数据导出**。保留身份、来源帧 / 时间、轨迹、人工 / 模型 / 估计来源、手绘待核对帧及缺口。不把十人选择或手绘路径当成逐帧位置已验证。
- **可选球场标定**。从第三步的“校准球场”或独立页签进入，核对地面参照点，再返回轨迹补全。先提取像素数据不要求完成米制映射；原有场地实验与草稿保留。

战术不在开始时预设。先得到轨迹，再分析防守、进攻站位和场上关系，之后才做讲解。现有动作标签仅作为采集参考。自动球衣识别、环境 / 战术分析、Agent 接入和讲解生成尚未实现。

## 球场映射与补点

当前只提供 NBA 模板：全长 28.6512 米、宽 15.24 米；原点为平面图左侧底线与远侧边线交点，X 向右、Y 向近侧。尺寸依据 [NBA 官方规则球场图，第 8 页](https://cdn.nba.com/manage/2026/01/Official-2025-26-NBA-Playing-Rules.pdf)，2026-10-01 读取。这只是球场模板依据，不是 BroadcastCode 新增要求。

1. 直播筛选确认后进入球员标定；按需打开“球场标定 → 2D”，或在第三步 2D 球场中点“校准球场”。选择左 / 右球篮，暂停并核对禁区、三分线、边线和中线。A–D 为禁区四角，E–H 为底线 / 中线与边线交点，I–J 为底线与三分直线交点；选择地面对应点。三个样例已有待复核候选，需明确采用。
2. 从下拉框选择一个参照点，再点击“在原视频重选这个点”并点选原图。其他点保留。可以停用、删除、撤销，也可重做整组禁区四角。至少需要 4 个不共线点；尽量增加分布更广的参照。点不足或布局退化时停止映射。
3. 多点拟合球场到图像的单应矩阵，再求逆得到图像到球场映射。原图显示整套反投影场地线，点列表显示拟合残差。额外的点可切换为“仅作核验”：不参与拟合，单独显示原图像素偏差与还原后的球场距离。核验需要至少 4 个其他有效标定点；不足时停止映射。方法依据 [OpenCV 单应教程](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)，2026-10-01 读取；前端实现不加载 OpenCV。拟合残差不代表独立精度，核验点也必须正确识别和点选。
4. 旧手工关键帧方案在同侧间隔不超过 1.2 秒时，按时间估计四个图像参照点。新镜头跟随候选使用逐帧变换，`maxKeyframeGapSeconds: 0`；失效帧、待核对帧和切镜边界不靠插值填满。二者都需要投影线核验。
5. “轨迹补全”优先允许在原图脚下补点，也支持在 2D 球场补当前帧。球场点另存 `courtAnchors`，不改写原图锚点；当前帧有冲突 / 出画状态时先修身份或区间。球场补点不自动插值长缺口。

为已入库的 001 片段提供 [9 帧扩展参考](../../research/vision-player-refinement/clip001-court-expanded.json)：0、30、60、90、120、150、180、210、242；首帧 6 点，其余 5 点。服务仅在视频 SHA-256 相符时提供；已有草稿没有标定字段时加载参考值。旧草稿可点击“载入扩展参照点（保留人工帧）”，手工编辑过的整帧保留。原始[四角快照](../../research/vision-player-refinement/clip001-court-reference.json)保持原值，用户修正只写本机草稿。

**准确性边界**：这些参照点由画面目视读取，尚无独立地面点误差验收；前端关键帧之间仍使用近似插值。默认投影点是人物框底边中心，遮挡、起跳、脚点偏移与角点误差都会影响位置。拟合及数值往返测试仅验证计算，不代表物理位置准确。所有映射和人工球场点保留待复核标记，`metricAccuracyValidated: false`；不计算跑动距离或速度。非 YOLO 场地识别调研、离线光流实测及漂移问题见[专项记录](../../research/vision-player-refinement/court-calibration-research.md)。

## 操作

1. 第一页设置保留起止帧，查看起点 / 终点后添加区间。当前整段正常时可“保留当前整段”，再点“应用剪辑，进入球员标定”。非整段选择会写本机 `artifacts/player-review-clips/`，实际裁切、同步候选并保留原帧号 / 时间；重启可恢复，源视频及源草稿不改。
2. 第二页依次选 P1–P10，暂停到人物清楚的帧，预览后明确关联候选。填写身份描述；十人选择可确认，裁判可选。
3. 第三页把不同 T 编号按正确区间归到同一个 P。拖脚点修位置、拖框边移动、拖四角缩放或输入像素坐标；只修改当前帧并保留原始检测框。没有检测时点击脚下补点，可撤销。
4. 手绘选项只拟补所选区间的缺失帧。按视频时间沿路径均匀分配位置，`manual_path` 显示为待核对；不能跨切镜，不覆盖已有位置、冲突或出画状态。逐帧点击 / 拖动 / 保存坐标可确认当前帧；其他手绘点保持待核对。镜头移动时优先逐帧补点。
5. 数据导出保存像素轨迹及未解决状态；战术与讲解由后续模块处理。球场米制坐标仍需另外标定和精度验收。

删除中间广告时，分别添加广告前、广告后的两个**保留区间**，再应用剪辑。例如 25 秒素材中 10–15 秒为广告，保留 0–10 秒及 15–25 秒对应的帧，输出约 20 秒。起止输入以帧为单位且包含端点，应先逐帧查看边界；保留区间会按原时间顺序拼接。拼接点断开轨迹，需要在下一段重新确认身份。

### 从当前帧开始确认身份

- 在第 6 秒选 P1 并关联 T60，就从该帧起使用 T60；第 6 秒之前仍保留原 T10 规则。T10 后面还存在，也不会作为 T60 缺失时的回退编号。后面在第 10 秒关联 T70，则从第 10 秒起换成 T70。
- 每个身份确认持续到下一次人工身份确认、后续区间规则起点或切镜。往回修较早时间时，已存在的后续身份确认继续作为边界。**错误若从第 5 秒开始，应在第 5 秒确认；第 6 秒确认不会自动修正第 5–6 秒。**
- 身份面板的“身份确认时间点”可定位或删除某个分界；删除和撤销会重新计算相应时间段。“删除位置”只删除当前帧的人工位置，不删除身份分界。拖脚点、改框和数值修改都只改当前帧位置。
- 新确认的 ID 若仍被另一 P 使用，时间较晚的身份分界优先；同一分界帧以最新确认操作为准。旧身份只在实际重复占用该 ID 的区间变成待关联，保留 `previousTrackId` / `claimedBy`。另一 P 后续确认的正确身份保持，不自动猜测替代 ID，也不交换整段身份。旧草稿中未经过新确认的重复绑定仍标冲突。
- 旧草稿第一次加载新规则时，原始 JSON 备份在同一浏览器原草稿键的 `:before-forward-identity` 项；原人工位置和区间记录保留。旧版没有明确区分身份确认与位置编辑，因此连续相同 ID 的旧锚点合并为一个推断分界，仍需查看迁移后的时间轴；之后的身份确认单独记录。备份保存在本机浏览器，不上传。

原因、规则及验证见[裁剪与身份绑定核查](../../research/vision-player-refinement/identity-binding-review.md)。

### 找回新编号与分段纠正

- 选中要修正的 P 编号，在第三步“把不同临时编号归到同一球员”中点击“查找可能的续接编号”。建议参考轨迹末端的时间、位置及可用球衣颜色，未经人工确认不会自动合并。
- 点击候选，可预览它在原视频中的位置。检查“查看起点 / 查看终点”，必要时播放区间；同一临时编号也可能中途串人，不能只看两端就保证整段身份正确。
- 填写起止帧，点击“把这段编号关联到 P…”。只在指定区间生效，范围外继续原规则；区间中后来确认的身份分界优先。同一开始帧按最新确认操作处理；绑定被更换后，旧 ID 的人工位置不会压住新身份。可从区间列表删除或撤销。
- 球员确实出画时，点击“从当前帧起标记离开画面”。时间轴显示灰色，导出状态为 `out_of_view`。再次入画时用新的编号关联区间覆盖；不向画外推算脚下位置。
- 切镜处不自动延续编号。重复编号经新人工确认后只释放受影响的旧关联；无法确定先后的旧重复绑定仍标冲突。桌面下方步骤面板可独立滚动，原视频保持在左侧。

旧单视频实验继续提供“原跟踪”和“球衣约束实验”两个版本；当前三段验收库则使用本页开头所述的通用 / E-BARD 两种检测结果。原跟踪保持已有 ID、坐标和草稿；实验版拥有独立草稿，不把旧 ID 直接套用到新跟踪结果。球衣实验只局部改善串号，仍需复核，见[原因及对照](../../research/vision-player-refinement/README.md#后续诊断编号中断与纠正)。

修改会自动保存在当前浏览器的本机草稿中。视频 SHA-256 相同时可继续编辑；换浏览器或清理站点存储会失去该草稿。导出的 JSON 是下游数据，当前页面尚不支持重新导入。`?qa=1` 使用独立测试草稿，禁止正式确认与导出。

## 位置和身份的含义

| 状态 | 含义 |
|---|---|
| `manual` | 人工点击候选框或补位置的当前帧 |
| `manual_path` | 手绘拟补位置；时间均匀分配，需要逐帧核对，导出含 `unverifiedPathFrames` |
| `tracked` | 与人工身份锚点关联的临时模型 ID；可能仍有串人或坐标误差 |
| `interpolated` | 前后端点间按图像坐标做线性估计；保留支持帧和 `reviewRequired: true` |
| `missing` | 无可用位置，不外推 |
| `conflict` | 同时出现竞争 ID，或同一临时 ID 被绑定给多个固定身份，需要人工修正 |
| `out_of_view` | 人工指定的出画区间；无坐标、灰色展示，不计入待处理缺失 |

新草稿默认关闭自动补点。按需可启用端点间隔不超过 0.2、0.5 或 1 秒的线性估计；旧草稿保留原设置。跨人工切镜标记、有身份冲突或图像位移速度超过 1800 像素/秒时不补点。速度阈值只是当前 1080p 素材的实验保护条件，不是球员运动学模型。镜头运动、突然变向、较长遮挡均可能使线性估计失准。

P1–P10 是人工确认的片段内固定身份；模型临时 ID 累计到几十或几百，并不表示实际人数。点击选人建立从这一帧起的身份分界，不能保证后续跟踪 ID 一直对应同一真人；发现串人应在错误起点重新确认。补位置修正当前帧，不建立或取消身份分界。

原图坐标单位为像素。点击候选框时用框底部中心作为脚下参考点，再通过当前帧标定另算球场坐标。**人工选人不等于人工确认了地面脚点**；页面已区分这两种操作。YOLOv8s-pose 用于离线对照；RTMPose-s 已接入人工可采用的脚部候选，镜头运动入口见上节。旧 IND–OKC 候选筛选针对黄、白球衣；新样例不套用该条件。可添加 R1–R3，E-BARD 版本提供独立的裁判候选跟踪，但分类与身份仍需复核。

主视图右侧显示所选球员当前帧的原图坐标 → 球场坐标、脚点来源，以及是否位于标定点包围范围内。插值帧要求位置同时在两端控制点范围内才显示“内”。范围外仍保留投影结果并提示补附近参照，范围内也不能保证准确。脚点偏 5 px 的示例使用局部雅可比矩阵计算最敏感方向的近似米数；它不包含标定误差，不是实测误差或置信区间。

## 本地启动

仓库根目录运行。依赖和模型准备见[本机环境记录](../../research/vision-local-aws-deployment.md)，候选数据生成见[改进实验](../../research/vision-player-refinement/README.md)。当前多视频入口：

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

库内显式登记每段视频、对应逐帧候选、哈希和切镜；服务启动时实际解码验证匹配。004–006为基础验收样例，LAL–MIN为可选第四段；原候选随数据目录保存，篮球模型和team-stable产物仍在本机忽略目录。成片下载需 Git LFS，见样例说明。

React 只接管身份与选中目标面板，现有画布、球场和轨迹逻辑继续工作。运行界面无需联网或 CDN；修改 `identity-ui.jsx` 后在 `engineering/tools/player-review/` 构建并保留本地 bundle 和许可证文件：

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
```

下列单视频命令继续兼容，用于原样例实验：

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/serve_player_review.py --video data/videos/nba/2024-25/clips/IND-OKC_Q4_pick-pop_8.1s_1080p.mp4 --tracks artifacts/vision-player-refinement/player-candidates-v2.tracks.json --port 8876
```

服务只监听 `127.0.0.1`，提供静态界面、显式登记的视频和候选帧数据；支持视频字节区间请求。页面计算和草稿保存在浏览器，不上传到外部服务。后台进程信息写在忽略目录 `artifacts/vision-player-refinement/review-server.json`。更换视频必须提供与之匹配的逐帧候选数据；服务不替用户生成检测结果。草稿按视频哈希隔离；旧样例原跟踪继续使用原草稿键。

旧实验生成补充球衣线索的候选文件后，可独立使用以下命令开启两个版本；生成方式见上述实验记录。

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/serve_player_review.py --video data/videos/nba/2024-25/clips/IND-OKC_Q4_pick-pop_8.1s_1080p.mp4 --tracks artifacts/vision-tracking-repair/original-review.tracks.json --alternative-tracks artifacts/vision-tracking-repair/jersey-review.tracks.json --port 8876
```

## 输出与验证

本次导出升级为 `schemaVersion: 2`；本机草稿仍兼容 version 1。保留 `trajectory` 的原图像素坐标，新增独立 `courtTrajectory`（米）、`courtUnresolved`、`court.calibration` 和逐点标定来源。实体还包含 `team`、`jersey`、`courtAnchors`、`events`。这些都是内部原型约定，未来接入 Agent 时需一起确认接口。

球场来源：`projected` 为原图位置投影，`court_estimated` 为先按原图补点再投影，`court_manual` 为直接人工球场点；`uncalibrated` 表示缺少有效映射。`missing`、`conflict`、`out_of_view` 的空坐标继续保留。`court_manual` 不消除原图中的缺失记录，也不覆盖身份冲突 / 出画标记。

新增字段仍属于 schema 2 的兼容补充：

- `footMethod`：`bbox_bottom_center`（框底中心）、`human_image_anchor`（人工原图点）、`interpolated_image_point`（原图估计）、`human_court_anchor`（人工球场点）。保留旧 `manual` 来源表示人工操作，并通过此字段区分选人与补点。
- `boxMethod: human_image_box` 表示人工改框，`detectorBox` 保存修改前的模型框。框与脚点可独立修正，手工确认的脚点不会因四角缩放而自动挪回框底。
- 标定点 `role: check` 表示只作核验；未设置时参与拟合。重选点保留其角色，启停、删除和撤销仍有效。
- `settings.sourceCuts` 保留真实剪辑拼接点，并合并到 `settings.cuts`；真实边界不可通过手工切镜、旧草稿或撤销删除，导出时再次保护。手工新增的切镜仍可移除。
- `calibrationSupport`：`inside_controls` / `outside_controls`，描述控制点在地面上的凸包范围。
- `sensitivity`：包含假定像素偏移、局部近似米数和 `excludesCalibrationError: true`。人工直接球场点没有图像投影敏感度。

上述字段帮助追查误差来源；`metricAccuracyValidated` 继续为 false。实验结果与位置验收建议见[脚点与场地实测](../../research/vision-player-refinement/court-calibration-research.md#脚点与场地网络补充实测2026-10-01)。

导出含视频 SHA-256、原图尺寸、固定身份、人工锚点、逐帧位置来源、待处理区间及补点设置。`selectionConfirmed: true` 仅代表所选目标经过确认；`allFramesManuallyVerified: false` 明确保留逐帧未核验状态。字段为本原型内部约定，不是赛事官方数据格式。

新增 `bindings` 保存分段关联与出画区间，`trackingRevision` 和 `trackingFingerprint` 标明所用跟踪数据。`tracked` 且 `identitySource: manual_range` 表示人工关联了该段身份，坐标仍来自模型，不是逐帧手工测量。

2026-10-02 身份修正新增 `identityKeyframes`，导出设置 `identityBindingMode: forward_only_v1`；`identitySource: manual_forward` 表示从人工确认帧向后使用 ID。`identityStartFrame`、`identityOrder`、`identityExclusive` 保留生效分界与重复 ID 处理依据；`identitySource: reassigned` 的空位置含 `previousTrackId` / `claimedBy`，需要重新选人。仍为内部 schema 2 的兼容补充。

```powershell
node --test engineering/tools/player-review/trajectory.test.mjs
node --test engineering/tools/player-review/court.test.mjs
node --check engineering/tools/player-review/app.mjs
node --check engineering/tools/player-review/workspace.mjs
```

2026-10-01：初版 8 项、增加编号纠正后 13 项轨迹与导出测试通过；另有 2 项候选匹配测试。浏览器验证了选人、逐帧跳转、缺失跳转、补位置、分段关联、出画标记、撤销、版本草稿隔离和测试模式导出保护。正式导出数据构造经过单元测试，未替用户点击正式确认按钮。

同日新增 8 项球场测试，共 21 项 JavaScript 测试通过：左右场映射、数值往返、退化输入、移动镜头关键帧插值、切镜边界、缺失分类、独立球场补点、轨迹断开及导出来源。参考样本 243 帧均有可解映射，仅是数值验证。浏览器独立 QA 草稿验证了半场拖动 / 全场切换、缺失区间跳转、补球场点与撤销、四角重标与撤销、人工事件与撤销、身份字段、播放及 QA 导出保护。正式草稿保留原选人记录。

同日扩展场地参照后新增 4 项测试，共 25 项通过：多点拟合与独立合成点核验、停用 / 重复 / 退化点、不同控制点集合插值、243 帧扩展参考的数值可逆性。浏览器验证单点重选、停用至不足 4 点后停止映射、删除、撤销、重载参照保留人工帧；测试修改已撤销。正式工作台保留既有 P1 的 3 个原图锚点与 4 段待处理区间。新版截图在本机 `artifacts/court-calibration-audit/workspace-updated.jpg`。

同日晚间新增留出点、控制点范围与投影敏感度、人工选人和补点来源区分 3 项测试，合计 28 项通过。浏览器将 E/F 设为核验点：A–D 拟合残差为 0.0 px，E/F 与目视参考分别差 19.1 / 86.3 px，对应 0.58 / 1.50 米。这是粗参考差异，不是准确率。QA 变更已全部撤销，正式草稿未改。截图在本机 `artifacts/ground-anchor-audit/heldout-check.jpg`。

2026-10-02 08:19 初版：新增脚点与框编辑 3 项测试，合计 31 项通过；多视频 API、真实解码 / 哈希 / 时间戳、浏览器关联与拖动 / 缩放 / 数值输入 / 撤销、视频切换草稿恢复、旧跟踪版本、播放、NCAA 范围保护和 QA 导出限制通过。测试只改 `?qa=1` 草稿，未代用户确认正式数据。截图在本机 `output/playwright/tactic-interaction.png`；来源与复现见[样例说明](../../../data/videos/tactics/acceptance/README.md)。


2026-10-02 本轮：用户拒绝教学素材后更换004–006，移除预设战术名称，并调整三步数据提取流程。35 项 JavaScript、4 项 Python 裁切测试通过；浏览器实际裁切 / 来源映射 / 切镜、身份编辑、两个 T 区间归到 P1、手绘缺口、草稿切换、三段播放、响应布局和 QA 导出保护通过。保存剪辑后重启恢复与 Range 请求通过；测试只操作 QA 草稿 / 独立缓存，不代表真实同人识别准确。截图为本机 `output/playwright/live-data-pipeline.png`。

本轮导出补充 `liveSelection`、`identitySelection`、`sourceVideoSha256`、`sourceFrameMapping` 和实体 `unverifiedPathFrames`。`sourceTime` 指最初导入工作台的视频时间，公开来源集锦的裁切偏移另见样例清单。`manual_path` 的 `footMethod=human_drawn_image_path` / `method=uniform_time_along_drawn_path` 区分手绘路线与逐帧点选。所有字段仍是内部原型约定；本轮未提交推送。

2026-10-02 身份向后生效修正：46 项 JavaScript、4 项 Python 裁切测试通过。独立浏览器 QA 验证前段逐帧一致、后段续接、P4 重叠段释放与后续正确段保留、位置与身份分离、删除 / 撤销、刷新、旧草稿原样备份、多区间实际裁切、2D 球场保留及 720px 布局；无脚本错误。测试候选用于交互验证，不代表真实同人识别准确，正式草稿未代为操作。仍未提交推送。

2026-10-02 双模型接入收尾：52 项 JavaScript、14 项 Python 测试通过；React bundle 构建与语法检查通过。浏览器 QA 验证双版本草稿隔离、人工重新关联及早段保留、整数脚点 / 框保存和撤销、对象开关、播放至末帧、两区间实际剪辑保留两版本及固定拼接点保护，无脚本错误。截图在本机 `artifacts/ebard-workspace-audit/model-selector.png`。用户要求收尾推送、ByteTrack 后续转交，当前交接见[模型接入交接](../../../handoffs/Linzeyu912/2026-10-02-1513-model-selector-handoff.md)。
