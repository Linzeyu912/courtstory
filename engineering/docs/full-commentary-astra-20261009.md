# Astra 全流程真实试跑（2026-10-09）

- 日期 / 时区：2026-10-09，America/New_York。
- 需求：同步仓库后，实际运行视频理解、解说、独立绘图、润色、TTS 和含投篮评价的完整成片；所有 LLM 使用 OpenRouter `openai/gpt-6-astra`。
- 本次结果：005 已完成真实解说、润色、四节点独立绘图 / 审核、TTS 与联合成片，输出 24.6333 秒、1920×1080、30 fps、H.264 / AAC 的 MP4。所有媒体及模型运行记录位于被忽略的本机 `artifacts/`，没有上传原片或中间文件。

## 查看产物

- 本机成片：`artifacts/full-commentary-005-20261009/commentary-final.mp4`（5,606,281 字节）。
- 本机预览：`artifacts/full-commentary-005-20261009/index.html`；使用现有 `serve_comparison_report.py` 在 `http://127.0.0.1:8895/` 提供播放和逐句跳转。
- 字幕：`artifacts/full-commentary-005-20261009/commentary.srt`。
- 投篮节点截图：`artifacts/full-commentary-005-20261009/c3.png`。
- 计划、采用文档和检查结果：同目录的 `saved-plan.json`、`adopted-document.json`、`draw-result.json`、`render-result.json`、`validation.json`。

四个节点全部通过真实独立视觉审核，采用 9 个原生图形。出手节点显示指定出手者 spotlight、绿色“投篮机会：好”和黄色“防守压力：中度”。底部字幕不遮挡该反馈框。

## 输入和实际调用

最终选用视频库的 `005`（SAS–MIA 第四节），原片 `data/videos/tactics/acceptance/clips/005_SAS_pick_roll.mp4`，4.7667 秒、143 帧、1920×1080、30 fps，无原音轨。来源采用仓库清单已经登记的 [Bilibili 转播素材](https://www.bilibili.com/video/BV1zqgd6DEPQ/)，本次没有重新采集或另作授权判断。

试跑目录：`artifacts/full-commentary-005-20261009/`。原有 `team-stable` 轨迹复用；本样片没有已确认姓名 / 2K 记录，模型使用匿名人物，不猜测姓名或能力值。

理解、润色、绘图和独立视觉审核都使用 OpenRouter `openai/gpt-6-astra`，样片 005 使用 `reasoning=low`。TTS 沿用现有火山 Seed TTS 2.0、Vivi 音色、自然聊天口吻；TTS 不是 Astra 文本模型调用。凭据读取本机 `.env`，不写入共享文档。

实际通过 `CommentaryJobs`、`CommentaryDrawingJobs`、`TacticalWorkbench` 和现有联合成片脚本调用工作台同一套后端。先保存润色后的 revision 2，再绘图、审核与采用，以免润色改变计划版本后使图形过期。

## 过程中发现并修复的问题

1. **绘图工具图片元数据不可见**：宿主把 `assetId`、原尺寸、裁图坐标变换放在 tool `details`，模型只能看到图片，无法填写必需的图片绑定。现在将同一份实际图片元数据同步到文本 tool content，保留宿主取证记录与坐标校验，不生成假资产。
2. **非投篮事件占位字段冲突**：真实 Astra 候选对 `kind=other` 填写 `shotStatus=uncertain`，保存端因此拒绝。现在保存前去掉该冗余占位及空可选字段；`shot/confirmed` 保留，冲突的 `other/confirmed` 仍拒绝。
3. **2K 来源上下文重复**：001 的多段姓名记录反复携带相同字段来源。发送给模型时把重复来源提取为引用表，值与来源可还原，宿主保存的原始 rating context 不变。这减少上下文重复，并不代表 001 已跑通。
4. **失败定位**：增加工具失败日志和脱敏的拒绝候选文件；拒绝候选不自动视作已保存计划。
5. **多节点原生采用**：四个节点共记录 45 个局部人物观察项，直接拼接超过单个原生阶段的 40 人上限。合并时仅把有图形的匿名主体和已绑定实体放入原生参与者表；每个节点的完整人物分类继续保存在 `nodeParticipantCoverage`，不把背景观察丢弃或当作同一身份。
6. **匿名动作引用**：一个已通过视觉检查的路线动作把匿名 `subjectId` 用作原生 `actions.entityId`，原生采用因此拒绝。模型保存工具和宿主现在提前拒绝此类引用，要求匿名运动通过有实际前后帧依据的 annotation 路线表达。仅该节点重新交给 Astra 绘制并独立审核，其他节点保留。
7. **Windows 音频缓存临时路径**：深层任务目录中，WAV 哈希文件名再追加 UUID 后超过传统路径长度。复制临时文件改用同目录短 UUID 文件名，保留校验和原子替换；原四段音频正常复用。

005 的理解任务最初也触发字段冲突。此次从真实模型生成的 `rejected-plan.json` 恢复原候选，执行同一字段规范化后，使用原任务实际发送的图片记录重新通过 JS 校验和 Python `finalize_plan(require_contract=True)`，保存 revision 1；随后真实 Astra 润色并保存 revision 2。没有人工编写解说、虚构图像证据或改写投篮评价。恢复过程记录在 `candidate-revalidation.json`、`recovered-plan.json`、`revalidate.mjs` 和 `finalize_recovery.py`。因此本次属于修复后继续完成的真实试跑，不是一次无错误的无人值守运行。

## 解说与投篮节点

| 节点 | 原片锚帧 | 已保存的润色文本 |
| --- | ---: | --- |
| 组织 | 33 | 大个子先把球交给迎上来的外线队友，配合从这儿起。 |
| 推进回传 | 72 | 往中路推进，举球却不投——回传右侧跟进的大个子！ |
| 确认出手 | 104 | 近筐起跳出手，位置是好位置，可防守还贴着，没给免打扰。 |
| 落筐结果 | 142 | 球在篮圈附近还卖了个关子——落进去了！ |

四句均由模型选为暂停讲解。出手节点 `n3` 使用 `shot_release`，确认投篮事件 `e3`；出手者 `local_white_big`、防守者 `local_black_near`。前一秒取证窗口为帧 74–104，覆盖完整。模型给出投篮机会 `good`、防守压力 `medium`；这两项是模型基于原图的评价，不是比赛官方统计。

四句真实 TTS 分别为 4.62、4.61、5.20、3.39 秒，音频清单在 `audio/audio-manifest.json`，后续成片通过同一音频缓存复用。当前定格较密集，适合检查各环节效果，不能据此宣称长片节奏已优化。

## 验证和边界

- Node：`commentary-tools.test.mjs`、`shot-feedback.test.mjs`、`drawing-tools.test.mjs` 共 18 项通过。
- Python：`test_commentary_agent.py` 4 项、`test_commentary_drawing.py` 5 项、`test_shot_feedback.py` 11 项、`test_commentary_drawing_jobs.py` 15 项、`test_commentary_tts.py` 7 项，共 42 项通过。
- 完整解码 739 帧视频与全部 AAC 音轨成功；48 kHz 双声道音频非静音，四段 WAV 均通过现有缓存校验。真实内容共经过理解、润色、节点绘图、独立检查四类 Astra 调用。
- 从最终 MP4 抽取四个解说节点截图，检查组织路线、出手者高亮 / 反馈与落筐标记、字幕；本机浏览器完整播放至 24.633333 秒，`ended=true`、`readyState=4`、媒体错误为空。
- 修复原生采用后，使用 `finalize_drawing.py` 从原任务保存的已审核节点继续；匿名动作问题节点经过新的 Astra 生成和新的独立视觉审核。失败任务和被替换候选仍保留，不计为成功任务。
- 先尝试的 `official-training-001`（21.5382 秒，带已保存姓名和 2K 背景）未完成：经历中断、连接错误和保存超时。失败记录留在 `artifacts/full-commentary-20261009/`。本次不能把 005 的结果算作 001 或姓名 / 2K 长片全链路验收。
- 本机实跑不代表云服务已部署更新。

## 本机复现入口

本次编排脚本在 `artifacts/full-commentary-005-20261009/run.py`，实际调用现有后端的 `understand`、`polish`、`draw`、`render`；每轮保留任务状态与产物，不覆盖原有失败记录。团队复现应使用各自输入、凭据和新输出目录，而不是依赖此机器的绝对路径。
