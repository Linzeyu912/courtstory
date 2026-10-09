# 视频理解、火山配音与字幕成片

2026-10-10 增量：[出手冻结与投篮反馈](shot-feedback-agent.md)沿下述两个独立 Agent 顺序执行。新解说任务会为确认出手保存评价节点；绘图读取同一保存版本生成出手者高亮及冻结反馈，绿／黄／红分别表示好／一般／不佳的机会和低／中度／高的防守压力，缺证据为灰色未知。旧稿不会自动补造分析，需要重新生成解说才能应用新规则。

2026-10-07，America/New_York。按用户要求，先把已有解说 Agent、Astra/Qwen 结果及无声预览推送到 `main`：[`888df0f`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/888df0f95c914faf0d0c82fa0e2f143045bb6d93)。随后增量接通火山配音和原画面字幕，并接入本机总工作台第三部分「战术制作」。云端运行服务尚未更新。

## 工作台入口

2026-10-09：每条解说现在有「保存本句」「恢复本句」及语言标记，可在采用润色后单独人工修改。保存本句不写其他句子的草稿；接口和未来UI接续见[逐句编辑与迁移](commentary-cue-editing-api.md)。

2026-10-10 更新（Asia/Shanghai，本地实现；未部署）：在当前视频的第三部分展开「解说与配音」：

1. 「生成解说稿」调用独立 Pi 解说 Agent，默认使用 OpenRouter `openai/gpt-6-astra`，以当前视频、检测数据和已保存人物/姓名快照为输入。沿用多页概览、按需回看原图/窗口/裁图，输出事件、文字、人物引用和实际看过的关键帧，不输出绘图坐标。
2. 对照原视频编辑文字和讲解时间，保存后产生新计划版本；关键节点按钮直接定位锚帧。人工确认和有效区间内已采用机器姓名可进入解说，保留来源，候选或冲突姓名不当成已确认身份。
3. 「按解说生成战术图形」启动另一独立绘图 Agent，按已保存解说节点局部取图、定位、绘制并审核，结果可采用和手工编辑。没有解说时先完成解说任务再调用绘图；已有旧解说缺少节点时，明确点击「重新分析并补齐关键节点」。旧版独立分析仅保留为显式兼容入口。
4. 绘图模型输入留空时继承本份解说实际使用的模型；填写完整 provider/model ID 可单独覆盖，清空恢复继承。全局模型改动不会改变旧解说计划的生产配置；服务端须能解析覆盖模型的能力，无法解析会明确报错。
5. 「配音并生成联合视频」使用保存的同一份 `cue.text` 生成 Seed TTS 2.0 配音与字幕，把当前战术图形、姓名和视频接入唯一输出时间轴。同一资产帧的讲解与图形共享停顿，实际语音时长参与编排；完成后播放 MP4、下载 MP4/SRT。有完整解说计划时顶部成片预览/导出也进入联合成片；旧稿显示「配音并生成字幕视频」，继续独立成片。

语音使用 Vivi 公版音色。两种服务的 Key 均从后端 `.env` 或进程环境读取；浏览器仅看到是否配置。解说保存在 `--tactics-folder/commentary-jobs/`，独立绘图任务保存在 `commentary-drawing-jobs/`，按视频、跟踪版本和 QA 空间隔离。采用图形后仍需保存原生草稿。旧版解说 CLI 与单独字幕成片保持可用。

后端 `commentary_jobs.py` 提供 `/api/commentary`、`/save`、`/jobs`、`/jobs/{id}/cancel` 和任务视频/字幕下载；`commentary_drawing_jobs.py` 提供 `/api/commentary-drawing/status` 及独立 jobs 的查询、取消、重试、采用。计划保存使用 revision/CAS；上游文字、节点或姓名变化时，旧候选不允许误采用，旧解说生成的活跃图形也不能混入新版联合成片。

新计划中每句解说恰好关联一个证据节点；多句可以共用同一节点，普通播放句不会因此强制冻结。绘图可在已保存事件、镜头边界及预算内请求一次窗口扩展，最多 6 秒／240 帧，并在新上下文中重新读取图像。明确的视觉审核驳回会带审核意见重画；审核网络失败只重试审核。上游变化时已被人工修改的图形保留并标为待核对，用户可明确选择「已核对，保留为人工图形」，原依据留在历史记录。

同一视频空间的成片任务共用 `audio-cache/`。缓存按文字和完整语音配置计算键，检查 WAV 哈希、格式与完整帧长度后复用；只改图形或姓名显示不重复合成，改单句只合成该句，损坏缓存重新生成。独立 CLI 可传 `--audio-cache PATH` 复用。

工作台服务须使用安装了 `engineering/requirements-review.txt` 的 Python；`--commentary-python` 指定子进程解释器，`--commentary-model-config PATH` 读取服务器可信的非密钥模型配置。模型配置必须包含与模型对应的能力，不复用其他模型的固定参数。Node 依赖、FFmpeg 和中文字体仍需按下文准备。后台任务刷新后可继续查看；服务重启将未完成任务标记为中断，保存文字保留。

本机 2026-10-10 未配置理解服务及语音服务凭据，因此本轮自动测试、测试音频和实际视频渲染验证不代表真实模型分析、绘图质量或真实 TTS 已验收。不得用 2026-10-07 旧实跑替代本轮验证；具体结果记录于[本轮实施交接](../../handoffs/thy-0629/2026-10-10-0033-commentary-led-tactics-implementation.md)。

## 运行

### 2026-10-09：解说润色与口吻选择

已有稿件可直接点击「润色解说」，将当前整段稿件送到服务端配置的 OpenRouter 模型（默认 `openai/gpt-6-astra`），无需重新理解视频。代码明确加载[表达材料](../tools/player-review/agents/commentary-style/README.md)：指南、8组原创例子、24条带语境的篮球文化与表达卡片。正常一次请求，结构或时长无效时最多修正一次；失败保留原稿。

候选区逐句对照，点击「采用润色稿」后成为可编辑草稿，再保存；可「撤回本次润色」。请求中手动改过稿时禁止直接采用旧候选，避免覆盖新编辑。事件、证据、时间窗、delivery不由润色模型修改。事实正确性仍需读稿核对，结构校验不能证明没有语义变化。

2026-10-10 整合后，润色任务分别锁定保存的基线与请求时草稿，保留姓名引用和节点；候选不直接改写保存稿。采用、撤回和逐句保存都保留最新版本信息。采用后保存出新版本，旧绘图依据失效，随后按当前计划独立绘图。原视频理解模型的生产快照不被文字润色模型覆盖，绘图仍默认跟随原分析配置。

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

## 2026-10-07 独立字幕成片的模型与呈现

- 采用当前官方文档支持的豆包语音合成大模型 2.0，资源 ID `seed-tts-2.0`，V3 HTTP 单向流式接口。公版音色为 `zh_female_vv_uranus_bigtts`（Vivi），支持 `--speaker` 更换。这里选择当前主推模型，不把“最好”当作经过全音色盲测的结论。
- 使用中文篮球解说风格指令；每句独立合成，同片共用 section ID 保持上下文。返回24kHz单声道PCM后保存WAV，保留API返回的字幕时间信息与用量；最终MP4为AAC 48kHz立体声。
- 配音不改变 Astra 原稿。普通句使用原计划开始时间，字幕显示区间和完整语音时长一致。本次8句普通解说均按原速，未做变速。
- 暂停句在建议区间中点附近取真实 PTS 帧，定格时长为实际配音长度加首尾各0.25秒。后续源时间统一映射，避免暂停后画面和旁白错位。
- 通用处理：普通句超窗时最多加速至1.2倍；仍放不下则整句转定格，并在时间轴记录 `convertedToHold`。本次两片未触发此分支。
- 原画面保持1920×1080，输出30fps。字幕烧录在顶部半透明带，避开两片底部记分牌。原声按0.12混入；定格段原声静音，语音持续。字幕是整句显示，未做逐字变色。

## 2026-10-07–08 历史产物与结果

本机目录：`artifacts/commentary-narration/astra-volcengine-v1/`。根目录为两片合并预览；每片包含 `audio/`、`render/` 和可单独打开的预览页。

| 样片 | 合成句数 | 暂停句音长 | 定格时长 | MP4时长 |
|---|---:|---:|---:|---:|
| official-training-001 | 5 | 4.80秒 | 5.30秒 | 26.87秒 |
| official-training-002 | 5 | 6.39秒 | 6.89秒 | 29.77秒 |

主要文件：`render/commentary-final.mp4`、`render/commentary.srt`、`render/timeline.json`；`audio/audio-manifest.json` 保存每句原文、声音配置、实测音长、字幕时间和用量；`workflow.json` 保存执行阶段。生成物留在忽略目录，不自动上传或覆盖源视频。

## 2026-10-07–08 历史验证与限制

- 2026-10-08 总工作台实测：在第三部分发起样例 005 的 Astra 理解，9 次请求 / 9 次工具调用，查看 42 个独立帧，约 220.61 秒生成 3 句。浏览器编辑保存第一句后真实合成火山语音，生成 22.93 秒 1080p H.264 / AAC 成片；播放、原片 1.4 秒定位、刷新恢复、MP4 Range 和 SRT 下载通过。23 项 Python 与 4 项 Node 定向检查通过，后续任务修正重跑 4 项通过。

- 10次真实火山语音合成完成，均收到成功结束包；WAV解码成功、包含非静音信号，无采样峰值削波。返回文本与输入解说对应。
- 19项Python定向检查通过，包括原有理解/取帧、TTS流截断与错误处理、配音时间轴、无原音轨、非零PTS原音裁剪。非零PTS用前后不同频率的测试音检查最终选中的频率，未把合成测试音当成TTS产物。
- 两个实际MP4包含1080p H.264视频和AAC音轨；字幕长句截图检查完整，浏览器切片、播放、音量未静音和时间轴定位实查。
- 两片音视频完整解码无错误；成片暂停句与原始TTS波形交叉相关比对，相关系数0.9913/0.9921，落点偏差约5.38/4.92毫秒。
- 本次复用已生成的Astra计划，没有重新运行理解模型。未做人工听感评分或篮球专家准确率验收；配音闭环成功不代表解说事实已完全正确。未接入队友绘图流程。

## 官方来源

2026-10-07 核实：[单向流式语音合成 HTTP](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)、[V3 模型、音色及语音指令说明](https://docs.volcengine.com/docs/DoubaoVoice/WebSocketBidirectionalStreaming-V3?lang=zh)、[音色列表](https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1?lang=zh)、[方舟API Key说明](https://docs.volcengine.com/docs/ark/api-key?lang=zh)。接口字段与流式错误处理另参考[火山官方 AgentKit 样例](https://github.com/bytedance/agentkit-samples/blob/main/skills/byted-text-to-speech/scripts/text_to_speech.py)，本地脚本独立实现。
