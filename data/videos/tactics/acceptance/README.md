# 直播画面与数据提取验收样例

采集与复核：2026-10-02，Asia/Shanghai。用户退回教学素材后，改为普通转播、正常速度、连续前场配合，并按无解说要求移除全部音轨。独立于两个赛季目录。

当前优先级是 **直播画面筛选 → 球员标定 → 轨迹补全**。界面按对阵 / 节次命名，动作标签仅是采集参考；战术分析放在轨迹提取之后，见[工作流程](../../../../engineering/research/vision-player-refinement/data-extraction-workflow.md)。

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

## 候选、验证与共享

`tracks/004.json`、`005.json`、`006.json` 是原有 YOLOv8s 通用人物候选 + ByteTrack 临时编号，使用 `--min-foot-y-ratio .3`。新增 `*-ebard.json` 是 E-BARD YOLOv8n 的球员 / 裁判分别跟踪结果，含逐帧篮球和篮筐候选，不套用该图像区域筛选或球衣条件。两类 `.meta.json` 均绑定视频哈希 / 帧数；新模型仍可能误分类、重复、遮挡遗漏或串号，不限制输出人数为十人。

顶部默认推荐 E-BARD，可切回通用模型；各自草稿隔离。实际裁剪同步保留两种版本，旧 T 编号不会自动迁移。新管线参数、耗时见[测量 JSON](../../../../engineering/research/vision-player-refinement/ebard-tracking-probe.json)，操作与限制见[工作台说明](../../../../engineering/tools/player-review/README.md)。新增候选已随 `aa2ba4f` 推送；三个候选文件按仓库 LF 换行保存，提交字节与 metadata SHA-256 一致，不影响下方历史成片记录。

2026-10-02：三个实际成片的字节 / SHA-256、全片解码、候选帧数 / 时间戳及零音轨检查通过；连续帧与比赛时钟逐段复核。35 项 JavaScript、4 项 Python 裁切测试通过。浏览器验证了三步流程、P1 脚点 / 框编辑、两个 T 的分段归并、手绘待核对点、跨视频草稿恢复、三段播放和 720px 布局；接口的剪辑重启恢复及 Range 播放通过。测试编号只验证交互，不验证真人身份。

全库 `--metadata-only` 为 5 个批次 / 142 条记录通过，不代表其他赛季的 LFS 指针已下载或实际校验。成片在 `data/videos/` 并受 Git LFS 规则覆盖；原片、临时裁切和截图不入库。2026-10-02 本轮用户授权分类共享，LFS 暂存和独立远端下载结果见[同步交接](../../../../handoffs/Linzeyu912/2026-10-02-1109-organize-publish.md)；服务仍只在本机运行。新增素材遵循[管理规范](../../../../docs/video-data-management.md)。
