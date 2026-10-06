# 比赛账号 Bedrock 模型权限核验

核验时间：2026-10-06 14:19，Asia/Shanghai。使用现有 `nba` profile、`us-east-1`，STS 已确认参赛角色。用户最终澄清要核对 GPT 系列、Claude Opus 和 Claude Sonnet；不把最初语音中的 GPT-3 / Sora / Claude Code 作为最终需求。

## 当前结论

**比赛参赛角色的模型白名单只有 Claude Sonnet 4.6 和 Qwen3-VL-235B-A22B。** 本轮同时读取了 `ParticipantGuardrails` 内联策略和应用角色要求使用的 `NBAHackathonParticipantBoundary`，两者均有相同的 `DenyUnapprovedBedrockModels` 限制。后续部署的应用也不能仅靠更换模型名称使用其他模型。

| 模型 | 当前参赛策略 | 本轮实际验证 |
| --- | --- | --- |
| Qwen3-VL-235B-A22B | 在模型白名单内 | **Converse 成功**，返回 `BEDROCK_OK`；输入 16 / 输出 5 tokens，服务报告 347 ms |
| Claude Sonnet 4.6 | 在模型白名单内；指定 profile 为 `global.anthropic.claude-sonnet-4-6` | 基础模型协议状态 `NOT_AVAILABLE`，未做首次调用或协议变更；不能标为已经接通 |
| 其他 Claude Sonnet 版本，包括 5 / 5.5 | 白名单外，显式拒绝 | 依据真实策略；没有逐一调用 |
| Claude Opus 各版本 | 白名单外，显式拒绝 | 依据真实策略；没有逐一调用 |
| OpenAI GPT-6 / GPT-5.x 系列 | 白名单外，显式拒绝 | 目录存在相关模型，但不在比赛角色允许范围；没有逐一调用 |
| OpenAI gpt-oss 系列 | 白名单外，显式拒绝 | `openai.gpt-oss-120b-1:0` 实际 Converse 返回 `AccessDeniedException`，明示 identity-based policy 的 explicit deny |
| 其他目录模型 | 白名单外，显式拒绝 | 本次列出的其他基础模型均不在这条拒绝策略的例外集合 |

上述“在白名单内”仅表示没有被这条模型拒绝规则挡住，不等于全部协议、IAM、配额或运行条件均已满足。Qwen 的文本探针也不表示图像理解、工具调用或视频效果已验收。

## 为什么目录和访问状态容易误导

`ListFoundationModels` 返回了 18 家提供方、121 个条目。逐个 `GetFoundationModelAvailability` 查询中：70 个四项服务状态均就绪；50 个协议状态 `NOT_AVAILABLE`；另 1 个区域不可用。**这些数量不是本队可调用模型数量。**

尤其是 gpt-oss-120b：服务状态包含 `authorizationStatus=AUTHORIZED`，其他三项也为 `AVAILABLE`，但实际 Converse 仍因参赛角色的显式拒绝而失败。应结合身份策略和真实调用判断，不能把服务层 metadata 当成有效 IAM 权限模拟。

模型目录确实包括 GPT-6.1 Sol、GPT-6 Astra / Sol / Luna、Claude Opus 5.5、Claude Sonnet 5.5 等；这里的阻碍是比赛角色限制，不是 Bedrock 平台没有这些模型。

## Sonnet 4.6 的接续事项

- 白名单中的推理 profile 是 `global.anthropic.claude-sonnet-4-6`，从 `us-east-1` 发起；不能机械替换成 `us.` profile 或另一版本。
- AWS 可用性查询对基础模型 `anthropic.claude-sonnet-4-6` 返回：授权、entitlement、区域就绪，但协议为 `NOT_AVAILABLE`。AWS 文档把此协议状态解释为访问协议尚不存在。
- [10 月 5 日赛事 Quick Start 记录](../../requirements/portal-access-20261005.md)称此 ID 已实测可用，是主办方示例口径；不能替代本队当前查询。本轮尚未实际调用该 Sonnet profile，不能断言一次请求必然失败或长期可用。
- AWS 文档说明，首次调用第三方模型可能自动发起订阅并接受相应协议；因此本轮没有为 Sonnet、GPT 或 Opus执行首次开通操作。需要由赛事账号管理员确认 Sonnet 4.6 的开通状态；要用 GPT / Opus，还需管理员调整明确的模型限制。没有尝试变更或规避这些策略。

## 证据、来源与复查范围

- [去标识化核验快照](bedrock-model-access-20261006.json)：121 个模型服务状态、参赛策略判定、两份 IAM 策略相关片段、两次调用结果；账号 ID 已替换为占位符，没有登录凭据。
- AWS CLI 2.37.9：实际执行 `sts get-caller-identity`、`bedrock list-foundation-models`、`bedrock list-inference-profiles --type-equals SYSTEM_DEFINED`、逐模型 `bedrock get-foundation-model-availability`，以及 IAM 策略只读查询。系统推理 profile 已发现上述 Sonnet ID。
- 两次 Converse：Qwen 输出上限 32 tokens、gpt-oss 输出上限 128 tokens。只有 Qwen 成功响应；GPT 请求被拒绝。
- [AWS 模型访问说明](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)：协议状态及首次访问机制。
- [GetFoundationModelAvailability](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetFoundationModelAvailability.html)：查询字段。
- [AWS IAM 策略求值](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)：显式拒绝优先于允许。
- [AWS Bedrock OpenAI 模型目录](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)：平台支持的 OpenAI 模型与本队授权分别判断。

公开文档均于 2026-10-06 查阅。目录范围为本次 `ListFoundationModels` 返回的基础模型，不声称穷举自定义、导入、Marketplace 部署端点或 Mantle 独立目录。未另测 Mantle；所读策略同时禁止 Bedrock / Mantle 的 bearer-token authentication。

没有修改 IAM、开通模型协议、创建资源或部署应用。完整原始策略及脚本仅在被忽略的 `tmp/bedrock-access-20261006/`，不纳入共享快照。
