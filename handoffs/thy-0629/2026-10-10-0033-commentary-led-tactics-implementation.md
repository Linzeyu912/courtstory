# 交接：解说先行、独立绘图与姓名联合成片

- 日期 / 时区：2026-10-10 00:33，Asia/Shanghai
- 成员：thy-0629
- 任务 / Issue：用户批准的[设计](../../engineering/docs/specs/2026-10-09-commentary-led-tactics-design.md)，按[实施计划](../../engineering/docs/plans/2026-10-10-commentary-led-tactics-implementation.md)执行；未新建 Issue
- 分支：main
- 提交：本轮未提交；基线为 `1a14be3bb239001c5ec8cc1300a5d071186714c5`
- 状态：本地实现与独立代码复核完成；真实模型与真实 TTS 内容验收待服务凭据

## 本次完成

- 解说 Agent 沿原有 Pi 视频理解通道输入当前视频、检测资料、已保存姓名快照，输出文字、人物引用、证据和关键节点。独立绘图 Agent 在解说保存后启动，只按这些节点局部取图和绘制，不再通过旧 Codex 执行器重新理解整段视频。
- `commentary_plan.py` 保存计划 ID、revision、摘要、来源、姓名快照、实际模型、已读证据与节点。每句恰好归属一个节点，多句可共享节点；普通播放句有锚点但不因此强制冻结。并发保存及迟到结果不能覆盖新稿。
- `commentary_drawing.py`、`commentary_drawing_jobs.py` 与独立 Node worker 接通原生候选、视觉复核、预览、采用、编辑、取消和恢复。模型默认继承所选解说计划的生产快照，可单独覆盖，清空恢复继承。刷新保留节点范围、实际覆盖值及任务绑定。
- 绘图证据只统计实际返回图片，裁图坐标映回原图。局部取证最多补扩一次，在保存的事件、切镜及 6 秒／240 帧限制内完成。内容审核驳回后带意见重画，网络失败只重审；上游冲突保留待核对状态。
- 已有人名按有效区间进入解说；候选、冲突或位置未可靠绑定的姓名不当作确认身份。姓名展示复用已有消费链，没有新增身份识别模型。
- `commentary_joint.py`、`commentary_joint_render.py` 把字幕、实际音长、图形、姓名和视频放到唯一输出时间轴。同帧多句共享一次停顿，保留资产 PTS、片内时间、review 时间及父原片映射各自含义。最终 MP4 接入音轨，保存编排、文档和音频摘要快照。
- TTS 按文字与完整语音配置缓存，复用前验证 WAV 哈希、格式和完整帧长度。只改图形或姓名显示不重复合成；改单句只更新该句；损坏缓存重新生成。
- 旧解说仍可编辑、保存和独立配音成片；没有节点时不补造证据。旧 Codex 绘图入口明确作为兼容模式保留。上游改变后的人工修改图形保留，允许明确核对后独立保留，原来源记入历史。
- 界面和 HTTP 路由接通顺序流程；不支持的旧版区间在启动解说之前报明原因。出手冻结、出手前一秒防守、2K 评价规则仍未实施。

## 结论与依据

- 用户选择 1A／2A，并于本轮授权实施。两个 Agent 的上下文、写入工具和失败边界分离，共用一份保存的分析计划。
- 第一轮独立审查指出 7 项问题：裁剪父来源重建、旧稿兼容、cue 节点覆盖、刷新重试字段、扩窗消费、内容驳回重画、跨任务 TTS 复用。全部修复后第二轮独立审查通过；最后两处界面修正又经单独复核。
- 生产配置取实际保存的解说模型；覆盖模型能力来自服务端可信配置或 [OpenRouter 官方模型目录接口](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)，2026-10-10 实施时核查，不把其他模型的能力常量套用过来。

## 验证

主线程实际执行：

| 检查 | 结果 | 本机日志 |
| --- | --- | --- |
| 12 个 Python 模块：理解、作业、计划、视频、绘图、联合渲染、字幕、TTS、服务等 | 110／110 通过 | `tmp/commentary-final-python.log` |
| 工作台与 Agent Node 全量 | 762／762 通过 | `tmp/commentary-final-node.log` |
| 最后 UI 修正后完整重跑工作台 UI 文件，包含新加的区间误调用测试 | 81／81 通过 | `tmp/commentary-final-ui.log` |
| tactical-overlay 相关 Node | 60 通过、1 个已有可选项跳过、0 失败 | `tmp/commentary-final-overlay.log` |
| 独立复核 | Python 61／61；Node 108／108；最后界面增量 2／2 | 复核线程只读检查并回报，无代码自审批 |
| `git diff --check` | 通过 | Windows CRLF 转换提示不属于差异错误 |

主要复跑命令：

```powershell
# 仓库根目录
node --test engineering/tools/player-review/*.test.mjs engineering/tools/player-review/agents/*.test.mjs
node --test engineering/tools/tactical-overlay/*.test.mjs
# engineering/scripts 目录
python -m unittest test_commentary_agent test_commentary_jobs test_commentary_plan test_commentary_video test_commentary_drawing test_commentary_drawing_jobs test_commentary_joint test_commentary_narration test_commentary_preview test_commentary_tts test_tactics_render test_player_review_server
```

真实视频 I/O 验证使用 `official-training-001`、`official-training-002` 的短段。最新完整来源契约下，各生成 144 帧／4.8 秒 H.264 + AAC 成片，FFmpeg 严格完整解码无错；同帧两句只停顿一次，440／660 Hz 测试音及时间域核对通过。产物：

- `artifacts/commentary-joint-20261010/{sample}/render-review-p1/commentary-final.mp4`
- 同目录 `composition.json`、`timeline.json`、`commentary.srt`
- `artifacts/commentary-joint-20261010/verification-review-p1.json`：媒体哈希、时长、音轨与映射检查
- `artifacts/commentary-joint-20261010/run-local-check.py`：本机复跑脚本

这些测试使用**合成测试音、测试文字、图形和姓名标签**，验证媒体链路，不代表模型篮球事实或真实身份准确率。旧 `render/`、`verification.json` 保留为修复前证据，不能替代最新 `render-review-p1/`。

本机浏览器使用独立 QA 存储检查默认独立绘图入口、模型清空继承、顺序触发和中文错误提示；未配置凭据时在解说阶段明确停止，没有下游模型调用，浏览器未记录脚本错误。测试原生草稿只写入 `artifacts/commentary-implementation-20261010/`，未覆盖正式工作台资料。

## 阻塞与待确认

- 本机进程环境及仓库 `.env` 没有可用的 OpenRouter 理解凭据和 `VOLCENGINE_TTS_API_KEY`。因此真实解说→绘图→TTS 联调，以及两段实际篮球内容／人名／画图质量验收仍未执行。没有用历史实跑冒充本轮结果。
- 本轮未操作云端、账号、密钥、发布服务或远端 Git；代码和测试成功不代表运行中的团队工作台已更新。

## 下一步

在后端配置既有服务凭据后，按[工作流](../../engineering/docs/commentary-narration-workflow.md)对两个不同回合运行真实解说、独立绘图及联合配音。重点人工核对节点选择、真实人物名与画面位置、路线依据和听感，再决定发布；不用重新实现本轮代码。

## 同步状态

开始时 HEAD、origin/main 和远端 main 核对一致，为 `1a14be3bb239001c5ec8cc1300a5d071186714c5`；结束时本地 HEAD、origin/main 未变。本轮所有修改仍在本地 main；没有提交、推送、创建 PR 或部署。此前两份研究／设计交接及研究文档完整保留。生成物与测试日志位于忽略目录，不会自动共享。
