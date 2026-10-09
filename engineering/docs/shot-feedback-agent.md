# 出手冻结与投篮反馈 Agent

本功能承接用户于 2026-10-10 确认的视频样稿。分析在后端完成，不在工作台新增评分设置或 2K 数据面板。这里的投篮机会指比赛中的机会选择，不是游戏操作的按键释放时机，也不输出真实命中率。

## 顺序和分工

1. 解说 Agent 使用现有视频理解入口，回看候选出手及此前一秒，记录确认的出手事件、实际离手帧、人物引用、投篮机会、防守压力、理由和图像证据。已有姓名及同赛季 2K 资料作为只读背景；不输出绘图坐标。
2. 宿主验证并保存解说计划。独立绘图 Agent 只读取保存版本的节点和局部真实画面，定位出手者，生成已有类型的 `spotlight`。刚完成出手的球员允许在球离手后继续高亮；该例外不放宽其他节点的持球人规则。
3. 通过独立图形审核的候选进入原生战术文档。宿主复制上游评价，关联对应重点圈和出手帧，并设置至少 2.5 秒的冻结关键帧。
4. 共享渲染器绘制白色高亮和两行反馈框；现有姓名、字幕和配音进入联合成片。同一帧只暂停一次，较长配音可以延长该次暂停。

绘图模型继续默认继承生成该保存解说计划时的实际模型，可沿现有接口单独覆盖。绘图不会重新分析全片、改写解说或自行改变评价。

## 三色反馈

| 色彩 | 投篮机会 | 防守压力 |
| --- | --- | --- |
| 绿 `#75d9a4` | 好 | 低 |
| 黄 `#ffe052` | 一般 | 中度 |
| 红 `#f0837e` | 不佳 | 高 |
| 灰 `#a9b6c0` | 未知 | 未知 |

两项分别决定等级和颜色，不强制同色。框在视频宽度的 34%、高度的 5% 处；1600 像素宽视频对应约 302.4 × 103.2 像素，文字及色条按同一比例缩放。这是用户确认并再次放大 20% 后的版本。只在关联出手的冻结展示中显示，不增加新的图形标注类型。

## 数据约束

- 确认出手使用 `event.kind=shot`、`shotStatus=confirmed`，对应一个 `node.kind=shot_release`；`anchorAssetFrame` 是当前视频资产中的实际证据帧。
- 节点 `shotFeedback` 保存 `shooterRef`、`defenderRefs`、独立的 `opportunity` / `pressure` 等级和理由、`evidenceFrames`、`defenseWindow` 与 `ratingsRefs`。人物可匿名，但必须有明确引用，不凭外貌猜姓名。
- 出手前一秒按实际解码时间计算，尊重视频开头和切镜边界。没有完整可用证据时不能把未知当空位或低压；保留原因。
- 2K 背景由宿主从仓库数据包读取，保留赛季、游戏版、球员身份、逐字段来源与缺失值。模型只能引用提供的记录，不能填造评分、跨版补值或把静态能力当本球结论。
- `document.shotFeedback` 绑定原生重点圈、出手帧和 `commentaryPlanRef`。解说被修改后须重新生成相应绘图，不能把旧图形或旧评价混入新成片。
- 老解说计划没有出手字段时保持原流程；不会凭旧文字补造已验证的出手分析。

设计来源：[已确认解说先行分工](specs/2026-10-09-commentary-led-tactics-design.md)、[2K 参考及数据边界](../../research/agents/shot-feedback-2k-20261009.md)、[本地 2K 数据读取约定](../../2K%20Player%20Data/AGENTS.md)。自动模型判断质量、语音效果和部署状态须以具体实跑记录为准。

## 预览、编辑与成片

- 出手候选预览、暂停在对应离手帧的工作台画面、正式导出使用同一反馈框渲染器；正常播放经过该帧时不额外闪出反馈框。
- 原有重点圈仍能选择、移动、缩放和保存。删除重点圈、更改出手帧或把圈改绑到其他球员后，旧反馈失效，导出要求重新生成相应节点；不能让旧评价出现在另一个球员身上。
- 含出手反馈的联合成片将字幕放在底部紧凑字幕带，避免挡住顶部反馈框；不含新反馈的旧稿保留既有字幕布局。
- 新出手稿通过旧 CLI 渲染时也必须传入已采用图形的 `--document`；语音合成前拒绝未传 `--document` 的新出手稿，渲染时进一步核对出手者高亮与反馈绑定，避免静默产出无反馈的成片。

## 验证入口

在仓库根目录执行共享渲染与 Agent 测试：

```powershell
node --test engineering/tools/player-review/*.test.mjs engineering/tools/player-review/agents/*.test.mjs engineering/tools/tactical-overlay/*.test.mjs
python scripts/validate_video_data.py --check-index
```

在 `engineering/scripts/` 执行后端回归：

```powershell
python -m unittest test_commentary_agent test_commentary_drawing test_commentary_drawing_jobs test_commentary_jobs test_commentary_joint test_commentary_narration test_commentary_plan test_commentary_polish test_commentary_preview test_commentary_tts test_commentary_video test_shot_feedback test_player_identity_data test_player_review_server test_tactics_render
```

原生绘图测试会启动 Node 子进程；测试等待器采用 15 秒有界等待且完成即返回，超时输出最新状态。真实模型及 TTS 需在已有授权环境另行实跑。此次实现与验证明细见[实施交接](../../handoffs/thy-0629/2026-10-10-0156-shot-feedback-agent.md)。
