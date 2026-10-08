# 交接：OpenRouter Astra 解说对照

- 日期 / 时区：2026-10-07 22:19，America/New_York
- 成员：chuali-zi
- 任务 / Issue：当前聊天用户要求换成OpenRouter Astra测试，确认key在.env并要求继续；未另行确认GitHub Issue分工。
- 分支：main
- 提交：本地未提交／未推送，HEAD `e1db1a08e52de06bc20f60c2f5b6514618af9895`
- 状态：两片成功试跑、原稿保存与AI辅助核验完成；不是全量准确率验收

## 本次完成

- 新增 `engineering/tools/player-review/agents/commentary-provider.mjs` 及定向测试，独立选择OpenRouter Astra，保持原Qwen provider不动。
- CLI新增 `--provider openrouter --model openai/gpt-6-astra`；从OPENROUTER_API_KEY或本机已有OPEN_ROUTER_KEY读取key，缺key不回退其他provider，不打印或保存key。
- Astra medium（模型要求启用推理），既有Qwen off；最终试跑还增加每轮剩余预算提醒，不称为严格单变量实验。
- 修补worker退出后的BrokenPipe/OSError处理，保留退出码和脱敏stderr，增加实际子进程提前退出的回归检查；没有把根因未明的早期进程中断声称已定位。
- [对照报告](../../research/agents/video-commentary-20261007/openrouter-astra.md)、[001原稿](../../research/agents/video-commentary-20261007/astra-official-training-001.md)、[002原稿](../../research/agents/video-commentary-20261007/astra-official-training-002.md)以及对应轻量JSON已保存。

## 结论与依据

- 001：10次请求/11次工具，48个不同帧，约221秒Agent阶段（CLI总约225秒）。3次局部裁图，文本辨认掩护后被跟随、退回外线、再次突破、得分后发球的顺序。
- 002：10次请求/11次工具，55个不同帧，约252秒Agent阶段（CLI总约253秒）。正确描述约18秒中距离两分、约21秒记分牌60–63变62–63、底线发球；比Qwen新版三分与时机提前明显改善。
- 本轮主线程直接用view_image看了两片关键时间段的拼图。001/002均有画面支持主要过程；仍为AI辅助核验，未由人工专家建立真值。002前次复核所称20.5秒比分刷新不准确，20.504秒仍60–63，21.004秒已62–63，已在报告修正。
- 两次成功轮没有调用get_observations，不能归因于YOLO。重复读图很多，返回单图80/82张但不同帧仅48/55；保持这两个数字区分。
- [模型目录](https://openrouter.ai/api/v1/models)于2026-10-07核对，快照在忽略的本机artifacts目录；训练视频来源沿原manifest。

## 验证

- 10项Python定向检查通过，含退出管道异常及provider不混key。
- 4项Node定向检查通过，worker语法与git diff空白检查通过。
- 001成功目录：`artifacts/commentary-20261007/openrouter-astra/official-training-001-v2/`。
- 002成功目录：`artifacts/commentary-20261007/openrouter-astra/official-training-002-v4/`。
- 失败保留：001-v1/002-v1进程中断无最终方案，002-v2执行环境中断，002-v3达到12轮仍只读图无方案。v3轻量失败结果已随研究记录保存；这些不计入成功次数。

## 阻塞与待确认

- 无阻塞这次对照试验的条件；早期进程中断根因未定位，后续成功轮未复现。
- 只有两段熟悉样片，不能推断普遍准确率；重复回看及费用仍有优化空间，未核定API总账单。
- 原视频音轨、姓名确认、渲染、网页、云端默认模型均未改动。

## 下一步

- 用户查看两份原稿，确认文风和重点选取是否符合需求；在更多未见片段复测后再决定模型默认值和循环优化。

## 同步状态

- 本轮新增provider、CLI与worker修改、测试、原稿及文档都留本地，未提交/推送。
- 其他任务的工作台、姓名、轨迹修改保留；未重新合并远端或改动队友文件。
