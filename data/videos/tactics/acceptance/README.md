# 直播画面与数据提取验收样例

2026-10-09 姓名流程接入：`review-library.json` 的官方 001 条目增加可选 `nameContext`（2025-26 / 0022500701 / A=HOU、B=DAL），供工作台全员姓名表单预填；草稿已有信息优先，不改变轨迹或确认身份。来源与验证见[工作台接线记录](../../../../engineering/docs/player-name-workbench-integration-20261009.md)。

2026-10-05 当前入口：工作台默认样例改为 `005`，当前清单提供 005、006 和 LAL–MIN 共 20 个版本组合。004 视频已由人工审核删除，现从活动工作台清单移除；其剩余候选仅用于历史追溯和既有回归。四组相同跟踪观测已合并，版本侧车元数据与草稿指纹保持，见[候选说明](tracks/basketball-20261002/README.md)。下方按日期保留历史发布口径。

2026-10-04 人工审核更新：本目录当前保留 **2 段**。已按用户决定删除 004；活动清单以本目录 manifest 和[正式场景目录](../../classification/README.md)为准；下文原始收集数量、统计与来源说明保留历史口径。人工记录见[本轮审核](../../reviews/human-2026-10-04/README.md)。

## 2026-10-02 晚间：按用户选择的本地整合

本节对应先前推送到 `codex/local-workbench-20261002`、现已于 2026-10-03 合入 main 的整合功能；提交与验证见[工作台更新记录](../../../../engineering/docs/workbench-branch-update-20261002.md)。当前界面沿用用户版左侧导航、分步骤工具与底部 2D 抽屉；默认推荐 `team-stable`（THY 完整方案）。下文发布和简版界面描述保留对应历史状态。

| 样例 | 已接入版本 |
|---|---|
| 004 / 005 / 006 | original（通用 YOLOv8s）、ebard、THY baseline / low / reid / optimized / team-stable |
| nba-lal-min-005 | original（THY 基线）、THY low / reid / optimized / team-stable、yolo（通用 YOLOv8s） |

合计 27 个样例 / 版本组合。THY 共享的 22 份 JSON 保持原字节；补跑的 10 组结果和 metadata 保存于 `tracks/integration-20261002/`，使用实际本机 GPU 推理、源视频哈希和原始 PTS 校验。页面读取这些预计算结果；切换版本后人工草稿分别保存。“推荐”依据本轮用户选择，所有模型建议仍需人工核对。

本地预览：`http://127.0.0.1:8890/`。取舍、接口与验收见[整合记录](../../../../engineering/docs/plans/2026-10-02-selected-integration.md)。原视频与 Git LFS 指针保持一致，没有新增视频素材。

## 2026-10-02 20:27：篮球候选共享发布

当前工作台源码和候选已发布至 `main`，GitHub API、ls-remote 与 fetch 核对远端为 [351292f](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/351292fba6c5e7accafea9f8780a81b93810caba)，见[最新交接](../../../../handoffs/thy-0629/2026-10-02-2027-workbench-identity-publish.md)。本次最新说明与交接随本次文档提交同步，具体提交以 Git 日志为准。`review-library.json` 的 11 条本机候选路径现改指向[原字节共享快照](tracks/basketball-20261002/README.md)：11 份检测结果与 11 份相邻 metadata，共 22 份、约 19.7 MB，覆盖四样例 / 17 版本。其他既有候选保留。与运行中原路径 API 的完整 clip payload 逐版一致，帧 / PTS、来源、指纹和草稿键不变；新目录的 `.gitattributes` 禁止 JSON 换行转换。

视频沿用既有 Git LFS 成片，没有新增视频上传。已有 Python / PyAV 环境可直接启动预计算工作台，不需要模型权重或 GPU 推理；重跑检测另需 CUDA / 权重，离线渲染另指定 `--ffmpeg`。原缓存、QA 草稿和本机测试成片不共享。当前默认简版与 team-stable 可用；下文的本机可选产物、旧默认版本和未提交文字是历史记录，本节说明最新共享范围。

采集与复核：2026-10-02，Asia/Shanghai。用户退回教学素材后，改为普通转播、正常速度、连续前场配合，并按无解说要求移除全部音轨。独立于两个赛季目录。

当前优先级是 **直播画面筛选 → 球员标定 → 轨迹补全**。界面按对阵 / 节次命名，动作标签仅是采集参考；战术分析放在轨迹提取之后，见[工作流程](../../../../research/vision/vision-player-refinement/data-extraction-workflow.md)。

2026-10-02 远端模型选择与本机分队版本已登记到同一个工作台：004–006 保留 original、共享 ebard 和可选 optimized / team-stable；LAL–MIN 保留本机各对照版本。当前本机默认 team-stable，缺少其可选产物时三个基础样例回退 ebard。后文按轮次保留此前默认版本描述；当前入口与代码分工见[工作台合并说明](../../../../engineering/tools/player-review/README.md)。

## 2026-10-02 补充：可选篮球模型对照入口

[review-library.json](review-library.json) 在原三段之外新增可选 sample `nba-lal-min-005`，复用赛季目录的 [LAL–MIN 第二节原转播片段](../../nba/2024-25/clips/005_LAL-MIN_Q2_catch-shoot_10.8s_720p.mp4)与[既有标签 / 来源](../../nba/2024-25/labels/005.json)。它是工作台的第四个可选入口，没有重用本目录的 SAS–MIA sample `005`，也没有增加本目录 manifest 的原三段素材条目。LAL–MIN 实测 10.68 秒、267 帧、1280×720、25 fps，源 SHA 为 `e76feffb09ede3e1b336c2e470370bcf1ee0937326bdf672e3e7e4bc5b661885`；首帧使用实际源 PTS 0.120 秒，保留原 AAC 音轨。本节后的原三段无声采集说明与历史验证记录保持。

该样例的 `original` 对应篮球模型 baseline，另有 `low`（低分续接）、可选 `reid`（外观续接）和 `optimized`（保留原生外观关联、队色复核标记与输出重复 / 完整框修正）。候选及相邻 `.meta.json` 位于被忽略的本机 `artifacts/player-tracking-workbench-20261002/`。旧 004–006 的通用人物 original 候选保持，并增加可选 optimized 入口；新产物齐备时默认选 optimized，否则保留原版本。缺少 LAL–MIN 视频或必需模型产物时跳过新样例，已下载的原三段仍可使用。

界面固定显示球员 1–10，存储仍使用 P1–P10，内部临时编号 T 可以超过十个。主动载入模型建议后，它作为未人工确认的 `modelBindings` 保存，可撤销且保留已有人工记录；确认当前建议后才按原有分段规则生效。模型数量、固定槽位与采用建议均不能证明十名真人身份或逐帧位置准确。元数据保留源视频 / 权重 SHA、模型、参数与 tracker 来源；服务读取预计算 JSON 并核对真实帧数 / PTS，不在页面请求中运行检测。

仓库根目录使用本轮已有环境启动：

```powershell
& tmp/player-identity-test/.venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

新样例测试地址为 `http://127.0.0.1:8876/?sample=nba-lal-min-005&variant=optimized&qa=1`。模型权重及 GPU 环境也在 Git 忽略的 `tmp/player-identity-test/`，不能把克隆代码视为已获得模型或新候选；本机推理命令、模型路径和各版本说明见[工作台本轮补充](../../../../engineering/tools/player-review/README.md)。本轮最终对照结果入口为[实测记录](../../../../research/vision/player-tracking-workbench-20261002.md)，这里不新增身份准确率结论。

**音轨边界**：LAL–MIN 未裁切版本保留源音轨，原 004–006 已按此前要求移除音轨。选择非整段区间并应用人工剪辑时，当前子视频只编码视频而无音轨，原片音轨保留。剪辑候选保存模型来源与根来源帧 / 时间，模型建议只在可见保留帧重映射并按切镜 / 缺口分段；用户原草稿中的人工身份与补点不自动转移到子片段。

## 三个替换样例

| ID | 采集参考动作 | 实测时长 / 帧数 / 画面 | 公开来源与裁切区间 |
|---|---|---|---|
| 004 | GSW–MEM，边线发球电梯门接球三分 | 8.76 秒 / 210 帧 / 1280×720，23.97 fps | [Warriors Nation](https://www.facebook.com/TheWarriorNation/videos/the-signature-elevator-doors-play-by-the-warriors/186346969187899/)，156.8–165.6 秒 |
| 005 | SAS–MIA，前场挡拆顺下、吊传内线终结 | 4.77 秒 / 143 帧 / 1920×1080，30 fps | [用过皮球](https://www.bilibili.com/video/BV1zqgd6DEPQ/)，0–4.7666 秒 |
| 006 | SAS–MIA，高位策应、转移球至弱侧底角三分 | 15.40 秒 / 462 帧 / 1920×1080，30 fps | [用过皮球](https://www.bilibili.com/video/BV1zqgd6DEPQ/)，373.8667–389.2666 秒 |

来源原视频是集锦，**只采用表中已复核的连续普通转播区间**。保留原画幅、比分牌和水印，不加箭头、教学字幕或配音，不改变速度；没有使用反应特写、低机位回放、停帧讲解或其他回合。

各片段保留发球前 / 前场组织、配合展开和投篮终结画面。004 是发球重新开始的完整配合，005 / 006 是连续前场配合。未包含此前取得原始球权的全部过程，所以 `full_possession=false`；不把完整局部配合冒充完整原始球权。日期 / 赛季未独立核实，保存 null。对阵、节次和时钟来自画面；006 起始为第二节 3:58。尺寸不证明原生拍摄分辨率或身份识别精度。

来源摘要见 [selection.json](sources/selection.json)，哈希、规格、范围和依据见 [manifest.json](manifest.json)。旧 001–003 已从当前清单 / 服务移除，编号不重用；原清单和来源摘要见[退回记录](sources/rejected-20261002.json)，旧视频及候选仅在被忽略的本机 `data/raw/tactics/rejected-acceptance-20261002/` 保留。

## 启动与操作

仓库根目录启动，需要现有 Python / PyAV 和逐帧候选：

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

打开 `http://127.0.0.1:8876/?sample=004`，顶部切换 004 / 005 / 006。旧的已移除编号自动回到 004。

1. 逐帧选直播区间，保留整段或多个区间，点“应用剪辑，进入球员标定”。实际剪辑和候选同步生成，保留段之间断开轨迹，缓存可重启恢复。
2. 把球员对应到 P1–P10，预览后明确关联，填写球队 / 号码 / 姓名；裁判可选。十人完成按钮检查人数及重复编号冲突，也可先测试单人的脚点 / 框。
3. 在同一个 P 下分别关联多个 T 的正确帧范围；逐帧补脚点、拖动脚点 / 框、缩放和撤销。手绘路径只拟补缺失帧，时间分配待核对，不能跨切镜。
4. 导出保留来源帧 / 时间、身份、人工 / 模型 / 估计来源、手绘待核对帧和缺口。`?qa=1` 使用独立测试草稿，禁止正式确认导出。

球场坐标是可选操作，不影响先提取像素轨迹；尚无自动直播分类、球衣 OCR、战术分析或讲解生成。详见[工作台说明](../../../../engineering/tools/player-review/README.md)。原视频与原草稿保留；旧 IND–OKC 实验可按工作台文档独立启动，当前验收库仅含新三段。

2026-10-02 新增：`review-library.json` 显式登记三个样例的场地和 RTMPose-s 脚部候选，文件位于 `research/vision/vision-player-refinement/`。球 / 篮筐可单独选择、补点和改框；脚部候选在 E-BARD 版本按所选 P/T 展示。球场标定页可“跳到参考帧”（004 为界面第71帧，005 / 006 为第1帧），核对后采用并查看2D轨迹。候选有失败区间，精度未经独立验收；实际裁切会同步重映射候选帧与时间，不直接套用源视频编号。

## 候选、验证与共享

`tracks/004.json`、`005.json`、`006.json` 是原有 YOLOv8s 通用人物候选 + ByteTrack 临时编号，使用 `--min-foot-y-ratio .3`。新增 `*-ebard.json` 是 E-BARD YOLOv8n 的球员 / 裁判分别跟踪结果，含逐帧篮球和篮筐候选，不套用该图像区域筛选或球衣条件。两类 `.meta.json` 均绑定视频哈希 / 帧数；新模型仍可能误分类、重复、遮挡遗漏或串号，不限制输出人数为十人。

顶部默认推荐 E-BARD，可切回通用模型；各自草稿隔离。实际裁剪同步保留两种版本，旧 T 编号不会自动迁移。新管线参数、耗时见[测量 JSON](../../../../research/vision/vision-player-refinement/ebard-tracking-probe.json)，操作与限制见[工作台说明](../../../../engineering/tools/player-review/README.md)。新增候选已随 `aa2ba4f` 推送；三个候选文件按仓库 LF 换行保存，提交字节与 metadata SHA-256 一致，不影响下方历史成片记录。

2026-10-02：三个实际成片的字节 / SHA-256、全片解码、候选帧数 / 时间戳及零音轨检查通过；连续帧与比赛时钟逐段复核。35 项 JavaScript、4 项 Python 裁切测试通过。浏览器验证了三步流程、P1 脚点 / 框编辑、两个 T 的分段归并、手绘待核对点、跨视频草稿恢复、三段播放和 720px 布局；接口的剪辑重启恢复及 Range 播放通过。测试编号只验证交互，不验证真人身份。

全库 `--metadata-only` 为 5 个批次 / 142 条记录通过，不代表其他赛季的 LFS 指针已下载或实际校验。成片在 `data/videos/` 并受 Git LFS 规则覆盖；原片、临时裁切和截图不入库。2026-10-02 本轮用户授权分类共享，LFS 暂存和独立远端下载结果见[同步交接](../../../../handoffs/Linzeyu912/2026-10-02-1109-organize-publish.md)；服务仍只在本机运行。新增素材遵循[管理规范](../../../../docs/video-data-management.md)。
