# 交接：Agent 战术工作流程、封装工具与多球员标注最终计划

- 日期 / 时区：2026-10-06 18:54，Asia/Shanghai
- 成员：thy-0629
- 任务 / Issue：本聊天用户要求合并历史讨论、实测和方案，形成以 Agent 工作流程／tool 为主、增加球员标注的最终执行计划；未指定 Issue。
- 分支：main
- 提交：本轮未提交、未推送；起始 HEAD 与实际 origin/main 均为 be5c43d17c78f04b4df55eda38aa6f82fde8f803。
- 状态：规划已落盘并通过独立文档复核；新增生产功能待实施。

## 本次完成

- 更新[最终执行计划](../../engineering/docs/plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)：明确 T00–T11 依赖、M0–M4 出口、六段小样本验收及首批执行任务。
- 新增[Agent 工作流程](../../engineering/docs/agent-tactics-workflow.md)：一次提交流程、工具调用顺序、默认预算、多人标注规则、局部修复和失败处理。
- 新增[工具合同](../../engineering/docs/specs/agent-tactics-tools-v1.md)：十个业务工具、四个运行控制工具、输入输出、版本、持久状态、幂等、取消、恢复与第三方 API 边界。
- 原模型主导稿完整复制至[归档](../../engineering/docs/plans/archive/2026-10-06-workbench-v2-model-first-before-final.md)，SHA256 为 DD9B4C26DCB193E2F9DFC3C9C5F13267F9CA47C3CC114CB19DF6C2902064EE60；新增归档入口，不删除历史讨论。
- 更新工程及文档 README、团队状态。未修改生产代码、工作台布局、用户草稿、源视频或实验结果；既有未提交改动保留。

## 结论与依据

- 主要交付是统一 runner 和封装工具，先完成自动多人标注成片，再增强 TAPIR 连续性、十人覆盖、按需地面投影与外部 API。人工是异常兜底，不是常规输入坐标步骤。
- 原生能力通过当前本地 tactical_workbench.py、tactics_agent.py、tactics_render.py、vision_provider.py 与图形／投影模块核查。原生 route/screen/spotlight 可复用，视频文字与任意 TAPIR 点跟随不属于当前能力；adopt 后需 save，正式 MP4 与 HTML export 分开。
- 更多球员标注落实为冻结的阶段参与者清单及实际渲染覆盖矩阵，包括有证据的无球人和防守人；静态人用位置提示，不编造路线。
- [直接视频与球场实测](../../research/vision/direct-video-vs-court-20261006/README.md)、[TAPIR 实测](../../research/vision/tapir-direct-video-20261006/README.md)与[身份延续试验](../../research/vision/player-identity-continuation-20261006/README.md)只支持各自有限样本结论，未写成十人全流程验收。

## 验证

- 两个独立只读 reviewer 均确认文档可交付。审查中已修复首个闭环对独立审查／基础 prepare_players 的依赖倒置、初始空 tracking 的原生边界、submit 示例合同、资产帧与原始来源标签混淆、逐阶段覆盖及 unavailable 示例矛盾。
- 8 份文档共检查 317 个相对链接；相对 HEAD 新增或未跟踪文件中的 58 个链接没有失效。团队状态中两处历史链接原已失效，未在本轮扩大修订：engineering/experiments/tactical_analysis/README.md、handoffs/chuali-zi/2026-10-03-0440-tactical-analysis-lab.md。
- 三个 JSON 示例均成功解析，canonical submit 字段与整阶段 coverage 示例一致性检查通过；本轮涉及的已跟踪文档 git diff --check 通过，8 份文档未发现行尾空白。
- 主计划已请求在 Codex 文件面板打开，工具返回 queued；未将其声称为已经可见。
- 本轮为文档交付，没有重新运行模型／视频实验，也不以此前实验替代待实现功能的测试。

## 阻塞与待确认

- 规划交付无外部阻塞。新增工具、持久 runner、API、TAPIR 原生绑定和完整十人质量仍待实施，不能按文档名称直接宣称已可调用。
- 第一版视频不新增姓名／角色文字层；当前渲染器静音，音频硬要求需返回能力缺口。

## 下一步

执行 Agent 按最终计划 T00–T03 建立基线、schema、runner 和现有工具 wrapper，再推进 T04–T05 的一次提交多人闭环。执行前保留当前所有未提交工作，不新建分支／PR，不绕过来源、版本或原生 schema。

## 同步状态

本轮只读核对 HEAD、本地 origin/main 与实际 git ls-remote 的 main 均为 be5c43d17c78f04b4df55eda38aa6f82fde8f803；只说明核对时三者一致。本轮及此前尚未提交成果仍在本机，未提交／推送，不宣称其他成员已得到新计划或本地视频。
