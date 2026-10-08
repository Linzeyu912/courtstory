# 独立视频理解与解说 Agent

后续增量：[火山 TTS 与字幕成片工作流](commentary-narration-workflow.md)已在本机接通。下文最初“只输出文字”的描述保留首版范围；Agent 本身仍只负责理解和解说，新增 CLI 编排语音合成、时间对齐和渲染。

2026-10-07，America/New_York。本轮按用户确认的范围，在同步远端 `e1db1a0` 后增量实现。CLI 已能通过 Pi 调用视觉模型、主动回看视频并输出中文解说；尚未接入网页或云端。较早的[职责讨论](video-commentary-agent-discussion-20261007.md)包含绘图意图，本轮实现只输出事件与解说，不含绘图意图、图片渲染或语音合成。

## 输入与运行

复用已有 Pi 1.0.2、Qwen provider 和网络续接模块。Python 需要 PyAV、Pillow、python-dotenv；Node 版本及依赖见 `engineering/tools/player-review/agents/package.json`。本机验证环境为 PyAV 18.0.0、python-dotenv 1.2.2。

从仓库根目录执行：

```powershell
# 首次安装依赖时按现有工程 requirements-review.txt 准备 PyAV/Pillow，另需 python-dotenv
python -m pip install python-dotenv
npm ci --prefix engineering/tools/player-review/agents

.venv/Scripts/python.exe engineering/scripts/commentary_agent.py `
  --sample official-training-001 `
  --output artifacts/commentary/my-first-run `
  --provider token-plan
```

也可用 `--video <本地视频>` 代替 `--sample`，用 `--observations <跟踪JSON>` 附带已有 YOLO/跟踪候选。输出目录必须是新目录。`--prepare-only` 只抽帧、生成拼图，不调用模型。

2026-10-07 追加 OpenRouter Astra 对照入口：

两片实测、原始解说与局限见[Astra对照](../../research/agents/video-commentary-20261007/openrouter-astra.md)。本次还补了每轮剩余请求/工具/时间预算提示，避免模型反复回看直到被截断；未改变主任务提示或提供样片答案。追加后10项Python、4项Node定向检查通过。

```powershell
.venv/Scripts/python.exe engineering/scripts/commentary_agent.py `
  --sample official-training-002 `
  --output artifacts/commentary/astra-002 `
  --provider openrouter --model openai/gpt-6-astra
```

读取 `OPENROUTER_API_KEY` 或本仓库 `.env` 已有的 `OPEN_ROUTER_KEY`，只向 `https://openrouter.ai/api/v1` 传递所选 key。Astra 使用 medium 推理（本轮目录声明必须启用推理），既有 Qwen 使用 off；该差异须随对照结果说明，不能说成所有参数完全相同。目录核实来源：[OpenRouter 模型 API](https://openrouter.ai/api/v1/models)，2026-10-07。本轮没有改变任务提示词或视频工具的读取策略。

本轮是用户在交互式会话中主动发起的试验；默认选 `QWEN_TOKEN_PLAN_KEY`，从进程环境或被忽略的根 `.env` 读取，固定 Token Plan endpoint，默认模型 `qwen3.8-max`。缺少该 key 时直接报错，不自动切换其他付费 key。选择 `--provider qwen` 才使用普通 QWEN_KEY。密钥不写入结果。本次没有部署 Token Plan 后台服务；赛事部署仍需沿工程既有云模型入口另行对接。

## 实际循环

1. 用容器实际 PTS 索引帧。约 22 秒样片默认 2fps，44–46 帧，分页拼成 8 张六格图；长片概览自动降低密度，最多约 121 帧。
2. Pi 读取概览，自主选择窗口、采样密度、单帧大图或区域裁图。图片以真正的 image content 进入模型。
3. 工具返回帧号、片内时间与原始 PTS。需要时读取检测候选；模型不必等待完整场地标定或完整十人身份。
4. 保存事件和解说，检查时间范围、已读图像证据、引用关系及播放中文字长度。相同尺寸重读相同概览帧不能被算作新增细节；新帧、单帧大图或裁图可以。
5. 每次保存立即落盘草稿。模型决定完成，或预算结束后返回已有草稿/失败信息。

保留全片概览和最近两次细看图片，早期细看图折叠为文字记录，可再次调用工具读取。默认上限为 12 次模型请求、30 次工具调用、480 秒；这三个参数是上限，流程没有固定调用次数。短暂连接错误最多恢复两次，并计入原请求预算。

工具：`get_video_context`、`read_video_window`、`inspect_region`、`get_observations`、`save_commentary_plan`。`full` 每次最多 12 帧；`sheet` 每次最多 128 帧、每页六格。无 ID 的观测查询用于发现轨迹，最多 12 个采样时刻、每时刻 30 条候选；有 ID 时每实体最多 12 帧。trackId 只是候选编号，不能等同姓名或稳定 P 身份。来源 SHA、帧数或 PTS 明确不匹配时禁用观测；无来源验证时标记 unverified。

## 输出与协作接口

- `commentary.md`：可直接审阅的中文解说及建议出现区间。
- `result.json`：status、plan、模型使用量和读图记录；`completed` 只表示生成与结构校验完成，不表示事实准确率通过。
- `draft.json`：最后一次成功保存的方案，便于异常中断后复核。
- `tool-calls.json`：工具参数、实际回看区间和模型请求次数，不保存图像 base64 或模型思考文本。
- `worker-stderr.log`：有错误输出时记录脱敏的末尾诊断；worker 退出后不重复向已关闭管道发消息，结果附退出码。
- `context.json`、`overview.json`、`images/`：本机回看所用帧索引和图像。

`plan.events[]` 提供 `eventId/startTime/endTime/description/participants/evidenceFrames/uncertainties`；`plan.cues[]` 提供 `cueId/eventId/suggestedStartTime/suggestedEndTime/text/focus/delivery/evidenceFrames`。证据附有精确的 `time` 和 `sourceTime`。

所有计划时间按**输入视频片内 0 秒起算**；`sourceTime` 单独保留容器原始 PTS。`delivery=during_play` 表示播放中解说；`pause` 表示建议在此区间选点暂停讲解，区间不是语音时长。实际音频时长与暂停后的成片时间由后续呈现模块决定，本轮没有假装完成这部分对齐。

后续绘图模块可按 eventId 与片内时间读取同一个事件，当前接口无需让解说生成依赖渲染。真实姓名只使用外部确认的绑定；本轮未验证姓名链路。原视频音轨尚未参与理解。

## 验证与已知限制

2026-10-07 追加独立[解说效果预览](../tools/commentary-preview/README.md)：读取 Astra 两片原始计划，导出带文字的 MP4 和可点击解说跳转的本机页面。普通句按源视频时间显示，暂停句在建议区间中点附近的真实帧定格，按阅读速度估算停留时长；页面同时显示原片和预览时间。001/002 分别加入 8/10 秒定格，成片为 29.57/32.90 秒。当前是无音轨文字审阅，不含配音；预览的暂停时长不是模型输出，也不是实测语音时长。产物位于本机忽略目录 `artifacts/commentary-preview/astra-20261007-v1/`，尚未接入团队工作台或部署。

8 项 Python、3 项 Node 定向检查通过：VFR 与非零起始 PTS、拼图分页、裁图坐标、候选来源和采样、Token Plan 不回退、图像证据引用、草稿 checkpoint、播放语速和预算。真实试跑和内容错误见[实验记录](../../research/agents/video-commentary-20261007/README.md)。

当前可以主动读图并生成可审阅草稿，但不能把模型输出直接当成已确认的篮球事实。首次试跑出现得分后发球与篮板叙述混淆，以及两分误说三分。提示词增加前后证据核对、记分牌延迟、时限区分；工具补齐具体采样上限说明。仍需更多未见视频检验战术深度与泛化，现有两片不足以证明稳定准确。
