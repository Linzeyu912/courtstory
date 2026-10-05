# 篮球专用模型与固定十人工作台

日期：2026-10-02，Asia/Shanghai。实施依据为用户批准上一轮遮挡与断轨修复思路，并要求继续在现有工作台使用固定球员 1–10。范围为本地检测、跟踪、候选复核；球衣 OCR、真实姓名 / 2K 对应、持球判断、战术箭头及讲解 Agent 尚不在本轮。

## 工作台变化

- 显示固定球员 1–10，内部继续存储 P1–P10。模型的临时 T 轨迹可以超过十个；十个槽位不等于自动确认十名不同真人。
- 新增篮球模型版本、来源和设备展示。原跟踪及原草稿保留，不把旧 T 编号直接套到新结果。
- 用户可主动“载入十人建议（待确认）”。建议单独保存为 `modelBindings`，人工关联、姓名 / 球队 / 号码、脚点和改框优先。重复采用建议、刷新和切换版本保留人工修正。
- 模型建议不计入人工确认。新草稿默认不自动补位置；遮挡或没有检测时保留固定身份槽位并等待续接，不凭空画十个位置。切镜打断关联。
- 默认画面显示固定球员编号；所有候选与临时 T 编号可在复核时打开。模型建议带问号，估计位置与人工确认有独立来源。
- 服务校验视频 SHA、实际解码帧数 / PTS 和候选格式。剪辑保留跟踪版本与模型来源，并按来源帧重映射建议；剪辑后的建议仍未人工验证。

## 本地模型与素材

篮球模型为作者发布的 [E-BARD detection models](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models) 中 `BODD_yolov8n_0001.pt`；仓库修订 `3f4789c4431aa73269f60107a4ba0a5f86b7af8b`。权重 SHA-256 为 `dfe3534d51bb21024d1a400c37f0c1fbf0c8b96ea9a56a5f3cb5454813bfd641`。模型类别包含 basketball、hoop、player、referee；执行器通过 `model.names` 确认 player 类，而非假设通用模型的 person 类编号。

本机环境：RTX 5060 Laptop 8 GB、Python 3.13、PyTorch 2.14.1+cu130、Ultralytics 8.4.171、PyAV 17.0.1。运行记录检查实际参数设备为 `cuda:0`，并确认 ReID 版本收到检测器原生特征。量化请求及实际参数类型分别记录，不据请求参数声称全模型实际使用 FP16。

主对照片段为 LAL–MIN 第二节底线发球至底角三分。原视频 1280×720、25 fps、267 帧，视频 PTS 为 0.120–10.760 秒，保留源 AAC 音轨；视频流时长 10.68 秒，容器时长 10.80 秒。视频 SHA-256 为 `e76feffb09ede3e1b336c2e470370bcf1ee0937326bdf672e3e7e4bc5b661885`。标签文件只用于描述片段，没有作为球员识别答案输入模型。

另为工作台既有 004 GSW–MEM、005 SAS–MIA、006 SAS–MIA 生成同一最终配置的篮球候选，保持原视频和通用候选。LAL 对照片段使用独立样例 ID `nba-lal-min-005`，不占用已有 SAS 的 005。

## 对照与验收方法

同一 LAL 视频、同一篮球权重、同一 704 推理尺寸、同一 0.5 NMS 进行四组对照：

| 版本 | 检测下限 | 外观续接 | 篮球约束 |
|---|---:|---|---|
| original / baseline | 0.25 | 关闭 | 原配置 |
| low | 0.10 | 关闭 | 只开放低分续接 |
| reid | 0.10 | 检测器原生特征 | 无额外球队 / 去重规则 |
| optimized | 0.10 | 保留 reid 的关联核心 | 输出重复框 / 完整框修正、队色复核及分段建议 |

四组均保留相机补偿。原配置已经开启相机补偿，本轮不将它冒充新增修复。低分检测用于续接，不直接成为已人工确认的球员。

最终默认保留上游 ReID 的关联和外观模板更新方式。额外硬队色限制及遮挡模板过滤曾导致稳定轨迹拆分，未作为默认配置；模板保护代码的回归通过不表示它在默认版本生效。最终默认只对分段建议的外观快照做质量筛选，并将队色冲突标记为待复核；重复 / 完整框修正作用于已观测输出。深蓝和暗色按相容的外观处理，避免同队球衣随光照变化被当成对手。这一取舍不保证同队遮挡后的身份正确。

抽查帧 0、53、100、106、159、212、266。人工观察记录在 [spotchecks](player-tracking-spotchecks-20261002.json)：球衣号码由人眼读取，仅用于事后核查，不是自动 OCR 输出。参考框来自原检测，用于定位人物，没有逐帧独立标注完整真值，因此不能报告识别准确率、IDF1、MOTA 或全片 ID-switch 总数。临时编号数量、候选人数和低分续接次数也不等于准确率。

白衣 7 号在帧 159 的原结果已有较短 T2 框，同时有一个未编号完整框。原预览重叠标签遮住了 T2，先前“完全丢失身份”的描述已更正；这里检验的是完整框恢复及重复处理。

## 复现入口

仓库根目录执行，权重和 GPU 环境位于忽略目录；仅拉取 Git 代码不会自动带上模型和生成视频。

```powershell
& tmp/player-identity-test/.venv/Scripts/python.exe engineering/scripts/basketball_run.py --video data/videos/nba/2024-25/clips/005_LAL-MIN_Q2_catch-shoot_10.8s_720p.mp4 --weights tmp/player-identity-test/models/BODD_yolov8n_0001.pt --variant optimized --imgsz 704 --output artifacts/player-tracking-workbench-20261002/optimized.json --evidence-frames 0 53 100 106 159 212 266

& tmp/player-identity-test/.venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876 --state-file artifacts/player-tracking-workbench-20261002/server.json
```

界面：`http://127.0.0.1:8876/?sample=nba-lal-min-005&variant=optimized`。测试使用额外 `&qa=1` 的独立草稿；未代用户确认正式十人数据。

当前执行方式是本地离线生成候选，再由现有工作台切换、核对和修正。服务不会在导入视频时自动启动模型。模型版本缺少可选产物时，已有三段仍可使用原候选；已存在但与视频不匹配的结果会拒绝加载。

源样例及交付预览保留原音轨；工作台现有人工多区间剪辑输出目前只有视频，描述和元数据明确说明无音轨，源片音轨保留。

## 最终实测记录

以下对应冻结配置 SHA `5f54774e39a0de41d9e292199e10d3009b5b32bdeb294c46c85754fd80c653a7`。本机服务于本轮重启，四段实际载入；LAL optimized 工作台指纹为 `a74f1c77f4838b5354b000dcb347c728714ffc292c24e5f3c33869530fe5d35e`。

| LAL 同片版本 | 临时轨迹 ID 数 | 未编号检测次数 | 低于 0.25 的有编号观测 | 抑制原框次数 |
|---|---:|---:|---:|---:|
| baseline | 17 | 43 | 0 | 0 |
| low | 17 | 103 | 33 | 0 |
| reid | 20 | 94 | 33 | 0 |
| optimized | 19 | 83 | 37 | 13 |

“次数”是全片逐帧累积，不是人物数量。最终并非将所有临时 ID 强制压成十个；原生 ReID 仍可能产生更多片段。四段 optimized 实际接受的自动片段连接均为 **0**，未匹配轨迹保留为待关联。不会把未成功的自动重识别描述成已恢复身份。

具体画面与数据结果：

- 帧 100：重复的弱复合框被抑制，白衣 17 号与相邻深蓝球员仍各有独立观测。新增同队邻居没有旧 ID 时，也不会仅凭分数与重叠被去掉。
- 帧 159：白衣 7 号沿用 T2，导出完整原始检测框，实际置信度 **0.403564**。原生残缺框置信度 0.689453，二者分别保存，不把高分移到完整框上。原来已有 T2，因此这是完整框修正，不是重新找回身份。
- 完整框修正共 7 处：帧 159、213、215、216、217、219、239；保持 T2，全部使用该帧实际原检测框和分数，没有生成遮挡位置。
- 白衣 7 / 17 在所选观察帧保持 T2 / T7，与未修改的 ReID 对照一致。蓝衣 10 原基线 T3→T25，T25 之前属于白衣 28；ReID / optimized 改为 T3→T17，后段选定帧保持 T17，早期断轨仍需人工归并。
- **原生跨队串号仍在**：T21 在帧 159 是深蓝球员、212 / 266 是白衣球员；T12 在 159 / 212 是白衣 23、266 是深蓝球员。两条均未分配固定球员建议，后段带复核标记并显示灰色候选。这是排除不安全建议，不是消除原生串号。队色误判也会给本来连续的球员造成保守的建议缺口。

全部 2,389 个最终有编号导出观测对照保存的 ReID 结果：除 7 处完整原框替换外，未改变对应观测的原生 ID / 框 / 分数 / 类别。抑制特定重复框不等于已经解决通用同队遮挡。人工抽查只支持上述具体结果。

本机最终 LAL 解码 / 推理 / 候选与证据保存循环 **10.377 秒**，初始化另计 1.540 秒；渲染、人工复核和 Agent 流程不包含在此时间内。实际参数 dtype 为 `torch.float32`。三个既有样例均用相同冻结配置在 GPU 跑完：004 为 210 帧、005 为 143 帧、006 为 462 帧；其真人识别准确性尚未独立标注验收。

## 集成与验证结果

- **127 项回归全部通过**：60 项 JavaScript，29 项服务 / 适配 / 剪辑 Python，38 项跟踪 / 渲染 Python。独立代码复核 PASS；曾发现并修复旧 jersey 草稿指纹改变、剪辑丢失模型来源、同队新邻居被误删、低分完整框续接失败、连续重复框恢复失效及输出覆盖输入路径等边界。
- 四段真实 HTTP 加载及 Range 播放响应通过；默认使用 optimized，保留 original 字节指纹和源帧时间。旧候选小数舍入与新候选 PTS 最大差小于 5×10⁻¹⁰ 秒，未改写旧候选。真实 117 / 37 帧多区间及二次裁切的来源、切镜、建议重映射和视频无音轨声明独立复核通过。
- 浏览器使用最终指纹的独立 QA 草稿：载入建议为人工确认 **0 / 10**、待确认 10；只测试球员 8 在帧 159 的人工确认后为 **1 / 10**、待确认 9。重复采用、刷新及版本切换保留测试姓名 / 队色 / 号码和身份分界；original 测试草稿仍为 0。正式确认 / 导出被 QA 模式阻止，浏览器错误 / 警告记录为空。没有代用户确认正式十人数据。
- 两份成片独立完整解码均为 **267 帧**，每帧 PTS 与原片精确一致；原 AAC 的 **508 个包**（含负 PTS 预滚）的内容、PTS、DTS、duration、time base 全部一致。源 SHA 不变。固定编号预览 1280×720；左右诊断对照 2560×720，均为 H.264 + 原 AAC。

本机证据（忽略目录，不随 Git 上传）：

| 产物 | 路径 / 验证 |
|---|---|
| 固定球员建议预览 | [optimized-preview.mp4](../../artifacts/player-tracking-workbench-20261002/optimized-preview.mp4)，SHA `61eb4d56c0bfce6dc5af86bf6963544441e90dd091f5d284b0b84c85a5f01935` |
| 左右同片诊断对照 | [comparison.mp4](../../artifacts/player-tracking-workbench-20261002/comparison.mp4)，左原配置、右最终配置，保留内部 T 用于诊断；SHA `42b95e4621ce20a37827e0de121490f2d84c5f3b99f6e9d0e94573807b5f1eab` |
| 真实工作台截图 | [模型及 GPU](../../artifacts/player-tracking-workbench-20261002/workbench-final.jpg)、[原图与固定槽位](../../artifacts/player-tracking-workbench-20261002/workbench-identities.jpg)，只包含测试草稿 |
| 运行 / 媒体验证 | [HTTP](../../artifacts/player-tracking-workbench-20261002/http-verification.json)、[浏览器](../../artifacts/player-tracking-workbench-20261002/browser-verification.json)、[媒体](../../artifacts/player-tracking-workbench-20261002/media-verification.json) |

回归命令：

```powershell
node --test engineering/tools/player-review/*.test.mjs
& tmp/player-identity-test/.venv/Scripts/python.exe -m unittest discover -s engineering/scripts -p 'test_*.py' -v
& tmp/player-identity-test/.venv/Scripts/python.exe -m unittest discover -s engineering/scripts -p 'basketball_*_tests.py' -v
```

源码、配置、文档留在 main 工作区；本轮没有提交 / 推送或部署云服务。当前成果是可复核的候选提取与固定身份修正工作流，仍需要人确认不同真人、错误起点及遮挡后续接，再用于号码 / 姓名 / 2K 或战术分析。
