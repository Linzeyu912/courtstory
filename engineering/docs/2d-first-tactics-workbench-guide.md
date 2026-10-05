# 2D 主画布战术工作流：操作、运行与本地验收

本轮按用户明确授权实现 [T0–T8 计划](plans/2026-10-05-2d-first-tactics-workbench-plan.md)。代码与合成素材流程已落地；真实 005、新导入 Warriors、移动镜头 / 身份断段素材及真实模型成功验收仍需在本地执行。不要把下面的合成浏览器 / MP4 检查当成真实篮球识别或球场精度结论。

## 1. 从球员标定到成片

### ① 球员标定

先筛选直播画面、核对球场标定，再选定一个稳定的球员槽位。步骤切换沿用该槽位；P 编号不是球衣号码。没有可靠号码时保留「身份待确认」，仍可人工关联可见人物，不能据号码相同认定全片为同一人。

身份页增加全片时间条，区分已关联待核对、人工确认、位置缺口、身份冲突与出画。点击一段定位到起点。出画保留身份并保持空坐标，不计待补点。

保存清晰参考身份后，「让 Agent 续接此球员」建立全片队列。窗口按真实时间戳切为约 4 秒，重叠约 1 秒，在切镜处分开；当前算法参数是首版设计选择。点击「执行下一窗 / 重试」，核对候选后采用或「保留未知，跳过这窗」，再执行下一窗。扫描成功、候选采用与人工逐帧确认分别记录；不会自动把整个视频涂成已确认。

队列按视频、模型、球员与参考身份保存到浏览器。暂停不会补点；参考身份或来源改变后需要重建队列。既有局部区间关联、释放他人冲突、位置修正与出画工具继续可用。

### ② 2D 轨迹准备

在「2D 轨迹准备」点击「建立 / 更新 2D 准备」。原图人工位置、身份关联和球场标定仍是上游来源；未映射、缺位置和出画的帧保持空值。

1. 选中要处理的球员，填写开始与结束秒数。
2. 选择关闭 / 轻度 / 标准，点击「预览所选球员平滑」。显示改变点数、最大位移和未补缺口。
3. 勾选原始 / 平滑叠加，检查脚点与转向，满意后点击「采用这段平滑」。预览不会改变正式准备结果。
4. 点击「保存准备版本」，再进入战术制作。未保存的准备快照不能进入服务端战术保存、Agent 或成片任务。

原始点独立保留。默认轻度为 0.09 秒窗口、0.35 混合权重；标准为 0.16 秒、0.55。算法 `conservative-time-median-v1` 保留人工脚点 / 球场点、区间端点、身份断点、切镜、明显折返与停顿，不填空洞，不跨段平滑，单点位移上限 0.25 米。这些参数没有真实视频调参或精度保证。

准备结果单独存入 IndexedDB 和本机服务快照，避免把整段点列塞进 localStorage。服务保存时使用相同 JS 算法重新投影并重放平滑，拒绝任意改写的原始 / 采用点。

身份、标定、切镜、帧映射、地面候选或准备参数变化会使准备失效。目前保守地将整段标为需重算，不自动猜测最小受影响区间。姓名等展示信息不改变准备依赖。重新建立 / 保存后，已有战术保留，需要检查其来源和重新定位；不要以旧准备掩盖来源变化。

### ③ 战术制作：只在 3–5 秒画路线

1. 在主画布上方填写新建图形区间 `3`、`5`；两侧滑块也可调边界。
2. 点击「定位选区起点」。填写区间与定位是分别的动作，避免输入框失焦时取消接下来的绘图点击。
3. 点击「画路线」，在 2D 球场点击起点与终点，自动建立四点三次曲线。拖动起点、出发手柄、到达手柄、终点修形；这些点修改战术图形，不改真实轨迹。
4. 虚线箭头与黄色圆点传球线只需两点；掩护标记可移动、旋转；脚圈按所选球员当前有效 2D 脚点跟随，没有位置时隐藏。独立示意可不关联球员。
5. 选中图形后，上方显示独立对象时间条。新建区间变化不改变已有图形；对象区间默认同时调整动作进度和显示范围，也可只改其中一种。
6. 图形或关联讲解点超出新区间时，勾选「将越界讲解点移到新区间起点」后应用，否则会拒绝修改。范围跨切镜时先拆段。
7. 侧栏可选择完整 / 剩余路线。播放时剩余路线按实际源帧时间推进，编辑时便于核对完整几何。
8. 保存、撤销、重做；刷新后重新打开战术制作，确认范围、曲线与讲解点恢复。

`3–5` 表示源素材 `[3,5)`，不是加入暂停之后的成片时钟。低于 5 秒的素材无法选择结束于 5 秒；005 只有约 4.77 秒，请用可用的内部区间（例如 1–3 秒）测同样操作。严格 3–5 秒需至少 5 秒的新视频或合成验收片。

2D 画布无需当前帧球场映射。右侧小视频用于同步核对；「实拍投影预览」使用同一组米制几何和当前帧映射。缺映射时保持 2D 可编辑，不制造像素落点。

### 讲解关键帧

选中图形，在其有效范围内定位源帧，再点击「＋ 讲解关键帧」。卡片显示秒数、精确解码的源视频缩略图、关联对象数量、暂停开关和停留秒数；时间输入或滑块可移动讲解帧，前 / 后按钮可导航。

默认暂停 2.5 秒。多个关键帧处于同一源帧时合并暂停，合并引用并取最大停留时间，避免重复冻结。删除讲解点不删除图形；删除图形会清理该引用和空讲解点。暂停绘制只展开本次引用的完整路线，之前的路线保留当时进度。

### Agent 初稿与人工修订

新 V2 稿默认使用所选秒级区间，生成 V3 候选。Agent 接收已采用、服务验证过的 2D 轨迹、准备摘要、源帧证据、缺口和已有人工图形，不读取展示层临时平滑。它只能在指定范围 / 已有阶段追加米制图形、进度、样式和关键帧。

核对侧栏候选说明及 2D 预览，勾选需要的图形后采用，再继续拖点、调范围、删改或手工补充。V3 校验范围、准备摘要、对象 / 球员引用、证据、坐标和曲线；未选图形不会写入草稿。候选失败最多自动修正一次，不自动保存或替换人工内容。

Agent 服务显示可用只证明找到了 CLI / Node，不证明登录、额度或实际视觉调用成功。当前托管环境实际调用失败于 Codex 运行目录只读；本地必须用可写的正常登录环境重新验收。失败后人工制作仍能进行。

### ④ 成片

保存后生成 MP4，完成后的预览与下载使用同一份文件。服务逐帧投影同一战术文档，不使用一套独立的像素路线。当前成片为静音。

完整导出会列出图形覆盖范围内的映射缺口并拒绝生成。回到第二步修复标定，或者明确缩小图形显示范围；缺口不影响保存 2D 图形。不要把少画几帧或临时示意相机当成完整投影验收。

新稿不会因「阶段默认暂停」自动插入冻结，只有显式讲解关键帧 / 编排 cue 增加成片时长。源素材片尾由 PyAV 最后一帧展示时长或有效流时长确定；未知片尾拒绝 V2 范围功能，不用前两帧间隔猜片尾。输出 FPS 只控制编码，不用于解释源帧位置或动作进度。

## 2. 旧稿与版本冲突

V1 战术文档和 V1 / V2 Agent 候选仍可读取，旧稿不会静默改成新时间语义。显式迁移保留 `before-v2` 浏览器副本，并标记 `legacyTiming:true`，沿用旧稿阶段 / 图形暂停和片尾编译语义。新建 V2 稿使用上面的新语义；旧数据未被批量改写。

2D 快照、战术草稿各自使用 `expectedVersion`。另一页面先保存后，旧版本保存会被拒绝；先导出 / 保留当前草稿，再读取服务的新版本。不要覆盖版本号重试。采用 Agent 时还核验生成时的草稿摘要与客户端修订。

本机默认准备路径为 `data/local-workbench/tactics/court-preparations/`，使用来源命名的 `.json` 当前头及不可变 `.vN.json` 历史；战术草稿位于同根的 `drafts/` 或 `qa/`；渲染任务在 `render-jobs/`，Agent 证据在 `agent-jobs/`。这些目录被 Git 忽略，应自行备份，不随本轮推送传给另一电脑。

## 3. 本地启动

在仓库根目录执行，保持终端运行。已有模型环境优先复用；以下最小环境用于工作台 / 保存 / 渲染，不安装人物或球场模型权重。

```bash
git switch main
git pull --ff-only origin main
git lfs pull
python -m venv .venv
```

Linux / macOS：

```bash
.venv/bin/python -m pip install -r engineering/requirements-review.txt
npm ci --prefix engineering/tools/player-review
npm --prefix engineering/tools/player-review run build
npm install --prefix tmp/tactics-render-runtime --no-save sharp
export TACTICS_SHARP_MODULE="$PWD/tmp/tactics-render-runtime/node_modules/sharp"
.venv/bin/python engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

Windows PowerShell：

```powershell
& .venv/Scripts/python.exe -m pip install -r engineering/requirements-review.txt
npm ci --prefix engineering/tools/player-review
npm --prefix engineering/tools/player-review run build
npm install --prefix tmp/tactics-render-runtime --no-save sharp
$env:TACTICS_SHARP_MODULE = (Resolve-Path 'tmp/tactics-render-runtime/node_modules/sharp').Path
& .venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

Node.js 22+、PATH 内 FFmpeg 必需；也可给服务增加 `--tactics-ffmpeg <本机可执行文件>`。浏览器访问 `http://127.0.0.1:8876/`；本轮云环境的 localhost 不对本地电脑开放。若端口占用，改一个未占用端口，不关闭其他人的服务。

重新识别 / 自动标定还需要原先的模型环境和本地权重，可保留既有 `--inference-python`、`--models`、`--court-model` 参数。新增战术代码没有更换默认检测器、跟踪器或下载新模型。Codex CLI 可通过 `--tactics-agent-cli` 指定；保留正常本机登录与可写配置，不把云环境绝对路径或登录文件复制进仓库。

## 4. 可重复的无真实视频验收

[合成验收脚本](../scripts/smoke_2d_workbench.py)创建独立视频、来源库、QA 草稿、准备版本和临时 HTTP 服务。它检查建立 / 平滑 / 保存准备、3–5 秒绘图、关键帧、撤销 / 重做、保存重载、模块请求以及实际 MP4 编码 / 完整解码。它不调用模型，不修改正式视频库，退出后关闭自己的服务。

先安装 Playwright，指定本机已有 Chromium / Chrome，或者在允许下载的本地使用 Playwright 的浏览器安装：

```bash
.venv/bin/python -m pip install playwright
.venv/bin/python -m playwright install chromium
.venv/bin/python engineering/scripts/smoke_2d_workbench.py --output-dir artifacts/2d-workbench-smoke
```

Windows 将 Python 路径换为 `.venv/Scripts/python.exe`。已有浏览器可用 `--chromium <可执行文件>`。输出目录必须全新，避免旧快照影响验证。成功输出 `passed:true,synthetic:true`；`report.json`、`saved.json`、`court.png`、`cue.png`、`result.mp4`、`server.log` 都在输出目录。预期 61 源帧 / 6.1 秒、区间 `[30,50)`、一处 2.5 秒暂停、258 成片帧 / 8.6 秒。

## 5. 真实视频接续验收与排障

本地先确认 005 MP4 已由 Git LFS 下载。预期 SHA-256 为 `1f7bd135ad8cde5ab877612e596f93200281b6902aac8084fad19a544d20b85d`，路径 `data/videos/tactics/acceptance/clips/005_SAS_pick_roll.mp4`。如果文件只有百余字节且开头是 `version https://git-lfs.github.com/spec/v1`，它仍是指针，不能解码；用有仓库 LFS 权限的登录环境下载。

然后分别使用 005、原先本机导入的 Warriors 素材，以及一段有移动镜头 / 身份断段的真实视频。后两者本机路径、视频哈希和模型指纹应由运行者记录，不能复制本轮合成路径冒充。

每段至少核对：固定球员全片续接与冲突；出画 / 未知不填点；人工脚点、折返及切镜前后平滑；准备保存 / 刷新 / 来源失效；选区外图形隐藏；同帧暂停合并；缺映射拒绝完整导出；真实 Agent 生成实线、虚线、点线，选择采用、手改并导出同一 MP4。真实调用必须保存 `agent-jobs/<jobId>/input.json`、`candidate.json` 及完成结果；失败 / 空候选不能当成模型战术成功。

| 提示 | 处理 |
| --- | --- |
| 片尾未确认 | 用能解码实际源片尾的 PyAV 环境重新加载素材；不要手填时长 |
| 准备来源变化 / 先保存准备版本 | 回第二步重建、核对、保存，重新绑定已有战术 |
| 新版本 / 摘要变化 | 先备份当前草稿，读取最新版本后重新生成或保存 |
| 实拍投影缺口 | 对照报出的对象和半开帧范围，修复标定或缩小显示范围 |
| Sharp / FFmpeg 找不到 | 检查实际安装路径和服务继承的环境；错误日志在渲染任务目录 |
| Codex 只读 / 登录失败 | 使用正常本机 CLI 登录环境；检查任务日志，不回填伪候选 |
| 视频加载失败 / 静止 | 检查原 MP4、HTTP Range、逐帧映射和浏览器控制台；重新加载保持原草稿备份 |

详细代码位置、验证统计、真实环境阻塞和提交同步记录见 [本轮交接](../../handoffs/chuali-zi/2026-10-05-0127-2d-first-tactics-workbench.md)。
