# 球场数据工作台

更新：2026-10-02（Asia/Shanghai）。当前按用户要求优先做好数据提取，入口 `http://127.0.0.1:8876/?sample=004`。三个[普通转播样例](../../../data/videos/tactics/acceptance/README.md)已替换教学素材，按对阵 / 节次命名。具体优先级与边界见[工作流程](../../research/vision-player-refinement/data-extraction-workflow.md)。

目录整理与分类共享状态见[最新同步交接](../../../handoffs/Linzeyu912/2026-10-02-1109-organize-publish.md)。下文按日期保留各轮验证记录中的当时状态；启动和测试命令已使用新工程路径。

## 界面层级

- **第一步：直播画面筛选**。先逐帧选择能看清整体站位的直播区间，排除特写、回放、采访、停帧和慢放。可保留整段或多个区间；应用后生成实际 MP4 和匹配的候选帧。删除段不进入输出，保留段之间设置切镜边界。当前是人工筛选，尚无自动画面分类。
- **第二步：球员标定**。十个固定身份槽位 P1–P10，React 面板用于候选预览、明确关联、姓名 / 球队 / 号码及坐标修改。候选人数不保证十人，需排除观众 / 裁判并补漏；裁判 R1–R3 可选。十人完成按钮要求全选且无重复编号冲突；可以先检查一个球员的轨迹。
- **第三步：轨迹补全**。原视频下方直接显示同步的 2D 球场，保留滑动半场 / 全场、跟随球员及点击轨迹定位。保持同一个 P，把前后多个 T 编号按正确区间归并，处理串号 / 出画，再补原图脚点、改框或手绘拟补路径；也可直接在球场补当前帧并撤销。没有有效标定时提示校准，人工球场点单独保存。新草稿默认关闭自动补点，旧草稿保留设置。
- **数据导出**。保留身份、来源帧 / 时间、轨迹、人工 / 模型 / 估计来源、手绘待核对帧及缺口。不把十人选择或手绘路径当成逐帧位置已验证。
- **可选球场标定**。从第三步的“校准球场”或独立页签进入，核对地面参照点，再返回轨迹补全。先提取像素数据不要求完成米制映射；原有场地实验与草稿保留。

战术不在开始时预设。先得到轨迹，再分析防守、进攻站位和场上关系，之后才做讲解。现有动作标签仅作为采集参考。自动球衣识别、环境 / 战术分析、Agent 接入和讲解生成尚未实现。

## 球场映射与补点

当前只提供 NBA 模板：全长 28.6512 米、宽 15.24 米；原点为平面图左侧底线与远侧边线交点，X 向右、Y 向近侧。尺寸依据 [NBA 官方规则球场图，第 8 页](https://cdn.nba.com/manage/2026/01/Official-2025-26-NBA-Playing-Rules.pdf)，2026-10-01 读取。这只是球场模板依据，不是 BroadcastCode 新增要求。

1. 直播筛选确认后进入球员标定；按需打开“可选·球场标定”，或在第三步 2D 球场中点“校准球场”。选择左 / 右球篮，暂停并核对禁区、三分线、边线和中线。A–D 为禁区四角，E–H 为底线 / 中线与边线交点，I–J 为底线与三分直线交点；选择地面对应点。新样例没有预置标定。
2. 从下拉框选择一个参照点，再点击“在原视频重选这个点”并点选原图。其他点保留。可以停用、删除、撤销，也可重做整组禁区四角。至少需要 4 个不共线点；尽量增加分布更广的参照。点不足或布局退化时停止映射。
3. 多点拟合球场到图像的单应矩阵，再求逆得到图像到球场映射。原图显示整套反投影场地线，点列表显示拟合残差。额外的点可切换为“仅作核验”：不参与拟合，单独显示原图像素偏差与还原后的球场距离。核验需要至少 4 个其他有效标定点；不足时停止映射。方法依据 [OpenCV 单应教程](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)，2026-10-01 读取；前端实现不加载 OpenCV。拟合残差不代表独立精度，核验点也必须正确识别和点选。
4. 相邻同侧标定关键帧间隔不超过 1.2 秒时，按视频时间线性估计四个图像参照点，再解当帧矩阵。**这是处理移动镜头的近似方案**；无端点、间隔过大、切镜或两侧球篮不一致时不生成映射。
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

旧单视频实验提供“原跟踪”和“球衣约束实验”两个版本；当前三段验收库使用通用人物候选。原跟踪保持已有 ID、坐标和草稿；实验版拥有独立草稿，不把旧 ID 直接套用到新跟踪结果。实验版只局部改善串号，仍需复核，见[原因及对照](../../research/vision-player-refinement/README.md#后续诊断编号中断与纠正)。

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

原图坐标单位为像素。点击候选框时用框底部中心作为脚下参考点，再通过当前帧标定另算球场坐标。**人工选人不等于人工确认了地面脚点**；页面已区分这两种操作。YOLOv8s-pose 已做离线抽样实验，尚未接入正式轨迹，也尚无在线相机运动估计。旧 IND–OKC 候选筛选针对黄、白球衣；新战术样例使用通用人物候选，不套用球衣条件。可添加 R1–R3，仍没有专用裁判跟踪器。

主视图右侧显示所选球员当前帧的原图坐标 → 球场坐标、脚点来源，以及是否位于标定点包围范围内。插值帧要求位置同时在两端控制点范围内才显示“内”。范围外仍保留投影结果并提示补附近参照，范围内也不能保证准确。脚点偏 5 px 的示例使用局部雅可比矩阵计算最敏感方向的近似米数；它不包含标定误差，不是实测误差或置信区间。

## 本地启动

仓库根目录运行。依赖和模型准备见[本机环境记录](../../research/vision-local-aws-deployment.md)，候选数据生成见[改进实验](../../research/vision-player-refinement/README.md)。当前多视频入口：

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

库内显式登记每段视频、对应逐帧候选、哈希和切镜；服务启动时实际解码验证匹配。当前库仅含新三段，候选随数据目录保存；成片下载需 Git LFS，见样例说明。

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
