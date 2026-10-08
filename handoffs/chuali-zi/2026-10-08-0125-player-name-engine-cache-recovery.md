# 交接：身份引擎取证与 P9 保存图恢复

- 日期 / 时区：2026-10-08 01:25，America/New_York（UTC-04:00）。
- 成员：沿用本机 chuali-zi 交接入口；身份引擎子 agent 执行，本子任务未重新认证 GitHub 登录。
- 任务 / Issue：本聊天明确授权的多人身份优化与真实 Qwen 复测；本子任务未读取最新 GitHub Issue。
- 分支：main；未新建分支。
- 提交：本子任务未提交、未推送。
- 状态：核心指定修改、保存图恢复和实际模型调用已完成；最终整合与全片验收由主 agent 接续。

## 本次完成

- [姓名入口与 Token Plan 适配器](../../engineering/scripts/player_name_identity.py)：原帧上下文＋目标图、同尺寸且不增大字节的 JPEG85、安全错误分类、完整 session 的 `selected_entities` 过滤。
- [有限证据与续接核心](../../engineering/scripts/player_name_evidence.py)：实际像素质量选帧、目标归属、0／00、比赛名单、局部串人拆分、参考图续接、指定修正帧与优先补看、纯 `apply_reference_slot_identities` 后处理。重复观察按 frame／T 去重，修正窗外的普通 QA 参考优先保留。
- 仅来源为历史颜色冲突的 sticky review 允许进入视觉取证；独立角色风险仍禁止。实际缺失观察不补造位置，也未添加全 T 跨缺口姓名传播。
- [轻量恢复脚本](../../research/vision/player-name-identity-20261007/recover-review.py)与[研究入口说明](../../research/vision/player-name-identity-20261007/README.md)：复用已保存图和证据元数据，不重新解码视频，不修改原始 runs／calls。

## 结论与依据

- P9 初始恢复实际 2 次 HTTP 成功，8＋3 图、38.188 秒；输出本机忽略目录 `artifacts/player-name-optimization-20261007/v4-p9-recovered/`。保留先前成功 P9 有限证据；T5 的三份同人比较仅 0.85／0.85／0.8，未达到要求的 0.9，没有强绑 604–671。
- 晚段独立 2 次 HTTP 成功，6 张保存比较图、21.719 秒；输出 `v4-p9-late-recovered/`。T66 的 F737 明确读出 MAVS／32，同人比较 F737／F850 为 0.98／0.95，支持 690–912；T8 的 F1209／F1290 两张目标归属明确的 32 号读数支持 1175–1290。
- T81 的 F950／F960 同人比较为 0.9／0.85，没有第二份达到条件，保持未知。没有降低阈值，也没有借诊断文档的姓名作为模型答案。
- 晚段图来自已保存的完整检测框裁图，缺少完整原帧上下文。模型将 T8 姓氏误读为 BLAKE；姓名仍取 DAL 当场唯一 32 号名单，不能将此结果写成 OCR 姓名准确或全片身份准确性通过。
- 来源是原 Qwen calls、source-compatible session／clip，以及 `diagnosis/p9-late-evidence/manifest.json`；均为 AI 候选，未经人类确认。赛事规则没有在此任务修改。

## 验证

- 既有核心与姓名任务检查在前一阶段 44 项通过。
- sticky-color／独立角色风险／两张修正比较图优先的 3 项必要检查通过；frame／T 去重并保留外部 QA 参考的独立检查 1 项通过。
- 新恢复脚本 Python 语法检查通过，并完成上述实际模型运行。未重复解码源视频；原始试验保持，完整输入复制到独立输出。
- 派生任务保留 v4 算法族，以 `analysisVersion`、`analysisStages`、`componentRuns` 标记保存图恢复与晚段增证，记录 `actualHttpAttempts`／`selectedPlayers`。不是抹掉新解析步骤的版本差异。

## 阻塞与待确认

- T5／T81 的证据置信度未达条件；人物姓名覆盖不能冒充逐帧位置或全片身份准确率。
- 旧 T10 的宽区间已有串人风险；主 agent 的整合应沿既定 boundary review 限制旧 P9 T10 到 594，不能再次把早期 338／425 号锚点扩过交换窗口。
- 本机取帧及 shell 一度显著变慢，故恢复只复用现成图。未结束其他任务，也未修改全局代理。

## 下一步

- 主 agent 可直接消费 `v4-p9-late-recovered/job.json`，与其他 source-compatible 组件整合后渲染；保留其缺少完整原帧上下文和 OCR 错字说明。
- 如继续补 T5／T81，优先复用真正清晰的保存目标图，增加实际同人／号码证据；不要把 unknown 简单改成姓名。

## 同步状态

- 修改仍在本地共享工作区；本子任务没有提交／推送，也未自行同步远端或覆盖队友修改。主 agent 同期报告另一会话同步 main，本记录不将其当作本子任务成果已共享的证据。
