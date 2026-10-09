# 视频理解、火山配音与字幕成片

2026-10-07，America/New_York。按用户要求，先把已有解说 Agent、Astra/Qwen 结果及无声预览推送到 `main`：[`888df0f`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/888df0f95c914faf0d0c82fa0e2f143045bb6d93)。随后增量接通火山配音和原画面字幕，并接入本机总工作台第三部分「战术制作」。云端运行服务尚未更新。

## 工作台入口

2026-10-09：每条解说现在有「保存本句」「恢复本句」及语言标记，可在采用润色后单独人工修改。保存本句不写其他句子的草稿；接口和未来UI接续见[逐句编辑与迁移](commentary-cue-editing-api.md)。

在当前视频的第三部分展开「解说与配音」：

1. 「生成解说稿」调用 Pi 解说 Agent，固定使用 OpenRouter `openai/gpt-6-astra`，以当前原视频和当前跟踪版本的检测数据为输入。沿用多页概览、按需回看原图/窗口/裁图的循环。
2. 对照原视频，编辑每句文字、源视频开始/结束秒数和「播放中讲解 / 暂停讲解」，点击「保存解说稿」。事件与证据字段保留；来源画面按钮跳至该句的开始时间。
3. 「配音并生成字幕视频」把当前稿件交给 Seed TTS 2.0，再按实际语音长度混音、烧录字幕。完成后可直接播放，下载 MP4 和 SRT。暂停句延长成片，下载字幕使用成片时间。

语音使用 Vivi 公版音色。两种服务的 Key 均从后端 `.env` 读取；浏览器仅看到是否配置。保存和任务按视频 SHA、跟踪指纹、版本及 QA 空间隔离，位于 `--tactics-folder/commentary-jobs/`，不写入现有战术绘图稿。当前成片合成的是原视频、解说与字幕；战术箭头等图形与解说的联合成片尚未接通。

后端入口为 `commentary_jobs.py`，提供 `/api/commentary` 状态、`/save` 保存、`/jobs` 生成和对应任务的 `/video`、`/subtitles` 下载。工作台服务须使用安装了 `engineering/requirements-review.txt` 的 Python；可用 `--commentary-python` 指定解说子进程解释器。Node 依赖、FFmpeg 和中文字体仍需按下文准备。后台任务可在页面刷新后继续查看；服务重启会将未完成任务标记为中断，已保存的文字保留。

## 运行

### 2026-10-09：解说润色与口吻选择

已有稿件可直接点击「润色解说」，将当前整段稿件送到OpenRouter `openai/gpt-6-astra`，无需重新理解视频。代码明确加载[表达材料](../tools/player-review/agents/commentary-style/README.md)：指南、8组原创例子、24条带语境的篮球文化与表达卡片。正常一次请求，结构或时长无效时最多修正一次；失败保留原稿。

候选区逐句对照，点击「采用润色稿」后成为可编辑草稿，再保存；可「撤回本次润色」。请求中手动改过稿时禁止直接采用旧候选，避免覆盖新编辑。事件、证据、时间窗、delivery不由润色模型修改。事实正确性仍需读稿核对，结构校验不能证明没有语义变化。

配音可选「自然有趣」或「原专业口吻」，音色仍为Vivi。页面默认自然口吻，CLI及未指定voiceStyle的API沿用原口吻。中英文都纳入播放时长粗估；暂停句也限制扩写，最终按实际TTS时长走现有渲染。普通句被转换成定格时，页面显示提醒。配音口吻或文字改变后不复用旧音频。

独立润色命令（输出目录必须为新目录）：

```powershell
python engineering/scripts/commentary_polish.py --plan path/to/result.json --output tmp/my-polish
```

`--without-memes`用于只含指南和例子的对照，`--feedback`用于独立试验中的定向修改。Key复用根目录`.env`的`OPENROUTER_API_KEY`或`OPEN_ROUTER_KEY`。生成的`result.json`可传给既有`commentary_workflow.py --plan`。实际样片、失败记录、速度和试听说明见[研究结果](../../research/agents/commentary-personality-20261009/README.md)。

依赖沿用 PyAV、Pillow、NumPy、python-dotenv，以及可在 PATH 找到的 FFmpeg。默认字体为 Windows 微软雅黑，其他平台使用 `--font` 指定中文字体。Node/Pi 依赖见[理解 Agent](video-commentary-agent.md)。

在本机 `.env` 配置 `VOLCENGINE_TTS_API_KEY`，来自[豆包语音 API Key 管理](https://console.volcengine.com/speech/new/setting/apikeys)。本次用户起初给出的 `ARK_API_KEY` 调用语音接口返回 HTTP 401、`Invalid X-Api-Key`；用户补充语音 Key 后成功。代码不把方舟 Key 自动当作语音 Key，不将凭据写入结果或 Git。

复用已有 Astra 文字结果（本次两片采用此方式，无需重复付费理解视频）：

```powershell
.venv/Scripts/python.exe engineering/scripts/commentary_workflow.py `
  --sample official-training-001 `
  --plan research/agents/video-commentary-20261007/astra-official-training-001.json `
  --output artifacts/commentary-narration/my-run
```

从新视频开始执行整条工作流：

```powershell
.venv/Scripts/python.exe engineering/scripts/commentary_workflow.py `
  --video path/to/video.mp4 `
  --provider openrouter --model openai/gpt-6-astra `
  --output artifacts/commentary-narration/new-video
```

可用 `--observations` 传入已有检测候选。省略 `--plan` 时调用已有 Pi 理解入口；提供 `--plan` 时直接进入语音阶段。理解 Agent 的多轮读取行为未改。

同一个语音或渲染任务中断后可带原参数追加 `--resume`，已保存的同音色、同文本语音会复用；渲染失败文件保留并使用新渲染子目录。理解阶段失败仍保留原始诊断，重新理解请用新输出目录。

完成后从输出目录启动既有本机服务：

```powershell
.venv/Scripts/python.exe engineering/scripts/serve_comparison_report.py `
  --directory artifacts/commentary-narration/my-run --port 8886
```

## 模型与呈现

- 采用当前官方文档支持的豆包语音合成大模型 2.0，资源 ID `seed-tts-2.0`，V3 HTTP 单向流式接口。公版音色为 `zh_female_vv_uranus_bigtts`（Vivi），支持 `--speaker` 更换。这里选择当前主推模型，不把“最好”当作经过全音色盲测的结论。
- 使用中文篮球解说风格指令；每句独立合成，同片共用 section ID 保持上下文。返回24kHz单声道PCM后保存WAV，保留API返回的字幕时间信息与用量；最终MP4为AAC 48kHz立体声。
- 配音不改变 Astra 原稿。普通句使用原计划开始时间，字幕显示区间和完整语音时长一致。本次8句普通解说均按原速，未做变速。
- 暂停句在建议区间中点附近取真实 PTS 帧，定格时长为实际配音长度加首尾各0.25秒。后续源时间统一映射，避免暂停后画面和旁白错位。
- 通用处理：普通句超窗时最多加速至1.2倍；仍放不下则整句转定格，并在时间轴记录 `convertedToHold`。本次两片未触发此分支。
- 原画面保持1920×1080，输出30fps。字幕烧录在顶部半透明带，避开两片底部记分牌。原声按0.12混入；定格段原声静音，语音持续。字幕是整句显示，未做逐字变色。

## 产物与本次结果

本机目录：`artifacts/commentary-narration/astra-volcengine-v1/`。根目录为两片合并预览；每片包含 `audio/`、`render/` 和可单独打开的预览页。

| 样片 | 合成句数 | 暂停句音长 | 定格时长 | MP4时长 |
|---|---:|---:|---:|---:|
| official-training-001 | 5 | 4.80秒 | 5.30秒 | 26.87秒 |
| official-training-002 | 5 | 6.39秒 | 6.89秒 | 29.77秒 |

主要文件：`render/commentary-final.mp4`、`render/commentary.srt`、`render/timeline.json`；`audio/audio-manifest.json` 保存每句原文、声音配置、实测音长、字幕时间和用量；`workflow.json` 保存执行阶段。生成物留在忽略目录，不自动上传或覆盖源视频。

## 验证与限制

- 2026-10-08 总工作台实测：在第三部分发起样例 005 的 Astra 理解，9 次请求 / 9 次工具调用，查看 42 个独立帧，约 220.61 秒生成 3 句。浏览器编辑保存第一句后真实合成火山语音，生成 22.93 秒 1080p H.264 / AAC 成片；播放、原片 1.4 秒定位、刷新恢复、MP4 Range 和 SRT 下载通过。23 项 Python 与 4 项 Node 定向检查通过，后续任务修正重跑 4 项通过。

- 10次真实火山语音合成完成，均收到成功结束包；WAV解码成功、包含非静音信号，无采样峰值削波。返回文本与输入解说对应。
- 19项Python定向检查通过，包括原有理解/取帧、TTS流截断与错误处理、配音时间轴、无原音轨、非零PTS原音裁剪。非零PTS用前后不同频率的测试音检查最终选中的频率，未把合成测试音当成TTS产物。
- 两个实际MP4包含1080p H.264视频和AAC音轨；字幕长句截图检查完整，浏览器切片、播放、音量未静音和时间轴定位实查。
- 两片音视频完整解码无错误；成片暂停句与原始TTS波形交叉相关比对，相关系数0.9913/0.9921，落点偏差约5.38/4.92毫秒。
- 本次复用已生成的Astra计划，没有重新运行理解模型。未做人工听感评分或篮球专家准确率验收；配音闭环成功不代表解说事实已完全正确。未接入队友绘图流程。

## 官方来源

2026-10-07 核实：[单向流式语音合成 HTTP](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)、[V3 模型、音色及语音指令说明](https://docs.volcengine.com/docs/DoubaoVoice/WebSocketBidirectionalStreaming-V3?lang=zh)、[音色列表](https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1?lang=zh)、[方舟API Key说明](https://docs.volcengine.com/docs/ark/api-key?lang=zh)。接口字段与流式错误处理另参考[火山官方 AgentKit 样例](https://github.com/bytedance/agentkit-samples/blob/main/skills/byted-text-to-speech/scripts/text_to_speech.py)，本地脚本独立实现。
