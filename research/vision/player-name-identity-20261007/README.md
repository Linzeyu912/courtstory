# 球员姓名显示渲染 QA

当前最终成片和轻量覆盖记录的跨机器入口为[共享渲染演示](../../../data/videos/demos/player-name-v4-20261008/README.md)。代码和研究脚本随本轮main发布，模型原图／raw calls／冻结输入仍位于本机忽略目录；这里的脚本不意味着其他电脑已具备完整实验缓存。

最终v4全片回放在本机忽略目录 `artifacts/player-name-optimization-20261007/full-tracking-v4-final/official001-all-players-full.mp4`，逐人覆盖、同源v3对照和渲染核对分别见同目录 `coverage.json`、`comparison-summary.json`、`result.json`。十人均有唯一姓名，姓名位置覆盖91.39%，不是逐帧准确率；226帧同时显示十人的姓名。最终输入为 `artifacts/player-name-optimization-20261007/v4-final/`，重跑时使用新的输出目录，避免覆盖历史产物。完整方法与限制见[工程v4记录](../../../engineering/docs/player-name-optimization-20261007.md)。

新增 [保存证据恢复脚本](recover-review.py)：复用失败任务已保存的请求原图、完整源 session／clip 和真实证据元数据，不再次解码视频；每次逻辑请求最多一次连接重试。P9 初始恢复实际两次 HTTP 成功、8＋3 图、38.188 秒，但 T5 同人比较只有 0.85／0.85／0.8，未将 604–671 强绑。晚段独立两次 HTTP 成功、6 张保存的比较图、21.719 秒，新增 T66 690–912 的同人候选和 T8 1175–1290 的号码候选；T81 第二份比较未达到 0.9，保持未知。晚图仅包含原检测框裁图，完整原帧上下文缺失；T8 姓氏被模型误读为 BLAKE，姓名实际由 DAL 当场唯一 #32 名单得到，不能称 OCR 姓名准确或全片身份通过。结果分别保存在忽略目录 `artifacts/player-name-optimization-20261007/v4-p9-recovered/`、`v4-p9-late-recovered/`，既有 raw runs 和 calls 保持。

```powershell
python research/vision/player-name-identity-20261007/recover-review.py
python research/vision/player-name-identity-20261007/recover-review.py --late --source-label v4-p9-recovered --output-label v4-p9-late-recovered
```

恢复输出必须使用新目录。默认本机代理 `http://127.0.0.1:7897` 仅用于该脚本进程，不改全局代理；模型配置仍由显式 Token Plan factory 读取服务端环境。派生任务保留 v4 算法族，并以 `analysisVersion`／`componentRuns` 区分保存图恢复、晚段增证及先前成功候选；完整源输入、实际 HTTP 次数、选中 P9、原图缺少上下文的限制均写入结果。

最新全员优化见 [工程 v4 记录](../../../engineering/docs/player-name-optimization-20261007.md)。本样例清晰参照帧／错接窗口由AI原图复核选择，实际模型自行读号、与目标比较；诊断预设姓名不作为模型答案。`optimization-probe.py` 记录有限请求与传输重试；`recover-review.py` 复用已存模型证据重试及补看，避免重复解码；`merge-results.py` 保留同源旧有限正证据、在明确反证及保守边界处排除关联，再给派生分析新的任务标识。旧raw与正式视频／草稿不改。

本目录保留 2026-10-07 姓名识别的只读方法调研与本机短片渲染探针。这里的真实 Qwen 候选仍是未确认身份，不改正式草稿，也不把单段成片视为全片姓名准确率验收。

## v4 消费与覆盖复核

2026-10-07 22:29（America/New_York）后续消费层不再因某个有限段异常清空整个 P。姓名 profile 与当前位置关联分开：来源匹配、名单唯一且通过视觉证据的有限段可记 `nameStatus: machine_accepted`，但仍 `identityVerified: false`；明确同人比较支持的续接记 `positionBindingStatus: verified_continuation`。已有人工选择、位置及有效逐帧确认优先。profile 只汇总证据，不授权未知 T 或整片传播。

显式机器修正写入 `machineIdentityBindings`，仅在支持的有限帧／T／视频与跟踪版本覆盖旧 `ai_visual_reference` 关联，并释放另一 P 的同段旧机器占用。真实同帧竞争保持未知；没有证据的切换边界不补姓名。改变机器关联会使旧 2D 几何缓存失效；仅改姓名文字不会改变几何缓存。

新版完整回放脚本接受独立输入和输出目录，重新通过工程消费函数读取实际 `job.json`，不把诊断参照直接当识别结果。`coverage.json` 分别记录每人的可显示位置帧、姓名帧、机器接受帧、续接帧及需复核关联帧，覆盖比例不等于准确率。

```powershell
node research/vision/player-name-identity-20261007/full-tracking.mjs artifacts/player-name-optimization-20261007/v4 artifacts/player-name-optimization-20261007/full-tracking
python research/vision/player-name-identity-20261007/full-tracking.py --folder artifacts/player-name-optimization-20261007/full-tracking
python research/vision/player-name-identity-20261007/coverage-plot.py --folder artifacts/player-name-optimization-20261007/full-tracking
```

复用真实 v3 的消费基线另存 `artifacts/player-name-optimization-20261007/v3-consumer-baseline/`，原 v3 不覆盖，P2 仍为多姓名的 ambiguous profile。首轮 P1/P4 v4 请求失败；关闭系统代理后的实际三次调用成功两次，P4 的 Alperen Sengun 经工程消费层得到 1077/1225 有位置帧的姓名（87.9%覆盖，含四帧视觉续接），P1 调用失败仍未知。独立应用和源帧 635／1048 脚底标签 PNG 存在 `v4-first-two-direct-consumer/`；此探针主动只保留两人的绑定，不能当作十人全片结果。完整十人真实 v4 与成片情况由后续收尾记录补充。

## 全员识别试验

功能、启动参数及完整限制见[工程说明](../../../engineering/docs/player-name-identification-20261007.md)，方法见[调研](../player-name-identification-20261007.md)。本轮为用户主动发起的 Qwen Token Plan 测试，无收费 Key 自动回退。使用已有十人 P→T 区间的官方001副本，并显式选择[官方比赛名单](../../../data/player-rosters/README.md)，没有将文件名直接当身份真值。

| 轮次 | 实际调用 | 实际结果 |
| --- | --- | --- |
| v1 | 思考模式／每人十二图首轮 | 有成功读数，也有90秒超时；中止并保留 calls.json，未称完整完成 |
| v2 | 10/10 成功，93.766 秒 | 两段 Cooper Flagg 候选，其他段未知；用于下方短片渲染 |
| v3 | 20/20 成功，314.750 秒；每人最多首轮8＋补看4图 | 64段：10候选／54未知；P2、P10 有身份冲突。消费层拒绝4条，采用6条有限姓名区间，五名候选显示，未验证全片准确率 |

v3 应用后候选为 Kevin Durant、Max Christie、Daniel Gafford、Klay Thompson、Cooper Flagg。P2 的 Jabari Smith Jr.／Kevin Durant 和 P10 的号码冲突保留待修，不能把名字改变解释为稳定身份。所有候选仍带待核对标记；源 session／clip 未改。

```powershell
python research/vision/player-name-identity-20261007/probe.py --label all-players-v3 --max-images 8
node research/vision/player-name-identity-20261007/evaluate.mjs all-players-v3
```

`probe.py` 调用真实模型，`evaluate.mjs` 使用产品的应用／轨迹／姓名读取函数，将结果写入独立本机副本。输入、裁图、调用记录、job.json、application-summary.json 和 name-overlay.json 位于忽略目录 `artifacts/player-name-identity-20261007/<label>/`。不要用已经存在的相同 label 覆盖需保留的对照；新试验用新 label。耗时包含取帧／裁图和并行测试造成的本机负载，不是纯模型延迟。未知数量、名字数量和有位置帧数不是准确率。

## 本次结果

输入来自 `artifacts/player-name-identity-20261007/all-players-v2/` 的 `input-session.json`、`input-clip.json` 和 `job.json`。探针通过产品的 `applyPlayerNameIdentities`、`buildTrajectories` 与 `nameIdentityAt` 生成显示快照，再调用 `TacticsRenderer.create/_render` 生成 MP4。只选了 P9/T10 中段的 Cooper Flagg 候选；身份保持 `identityVerified: false`，标签显示 `Cooper Flagg? / #32`。

| 项目 | 实测 |
| --- | --- |
| 源视频 | 官方样例 `official-training-001`；SHA-256 `9c3e4606d04e7f79e29a112952fcf069ebab202af207af500bfbc3338bc079ce` |
| 跟踪版本 | `team-stable`，T10 → P9 |
| 短片窗口 | 源帧 413–591，源时间 6.890–9.860 秒 |
| 成片 | 1920×1080，30 fps，90 帧，3.0 秒 |
| 显示开关 | 全局关闭与原始帧逐像素相同；关闭姓名后只留 `#32`；关闭号码后只留 `Cooper Flagg?` |
| 位置检查 | 第 502 源帧标签与脚环位于画面右侧持球球员脚下 |
| 浏览器寻帧 | 暂停 seek 时隐藏旧姓名层；只有目标解码帧发布后才重新显示，定向 harness 测试通过 |

OpenCV Hershey 字体不支持中点 `·`，所以 MP4 烙字把浏览器的分隔符转换为 ASCII `/`；姓名、候选问号和号码与浏览器显示数据相同。浏览器不受该字体限制，仍使用中点分隔符。

此小片只验证当前候选段的输入、脚底位置、生产 MP4 管线和开关行为；不评估姓名识别精度、不代表其余球员已识别，也不代表整个比赛的脚点准确率。短片与 PNG 保存在被忽略的本机目录 `artifacts/player-name-identity-20261007/render/`，没有加入视频数据或 Git LFS。

## 复跑

### 全员完整时间轴回放

2026-10-07 13:06（America/New_York），按用户要求展示官方001全片的十名球员追踪。复用 v3 的有限姓名结果与既有 P→T 轨迹，不重新调用模型、不修改原片或正式草稿。

```powershell
node research/vision/player-name-identity-20261007/full-tracking.mjs
python research/vision/player-name-identity-20261007/full-tracking.py
```

产物位于本机忽略目录 `artifacts/player-name-identity-20261007/full-tracking/official001-all-players-full.mp4`：1920×1080、1291帧、约59.94fps、21.538秒，十名球员均有实际轨迹观测。510帧同时有十个可显示位置；其他帧按真实可用记录显示，缺口不填补。有位置的记录全部为 `tracked`，仅展示平滑，不新造位置。红／蓝框显示固定P与临时T，脚环／短尾迹跟随，姓名只在已采用候选区间出现；P2／P10身份冲突仍待修。

解码帧数、尺寸、每帧源PTS与原片一致；原声AAC包和时间信息核对一致。`result.json` 保存实际回放参数，`frame-300.png`、`frame-502.png`、`frame-900.png` 为抽查图。回放显示当前结果，不代表全片姓名／轨迹正确；多人标签在拥挤或画面边缘仍可能重叠／裁切。成片未上传、未入Git LFS。

```powershell
node research/vision/player-name-identity-20261007/render-probe.mjs
$env:TEMP = 'engineering/tmp'
$env:TMP = $env:TEMP
python research/vision/player-name-identity-20261007/render-probe.py --timeout 420
```

主要产物：`production-cooper-flagg-3s.mp4`、`production-frame.png`、`source-frame.png`、`global-off-frame.png`、`name-off-frame.png`、`jersey-off-frame.png` 和 `render-result.json`。结果 JSON 留有实际帧率、时长、帧范围、来源哈希和开关检查。
