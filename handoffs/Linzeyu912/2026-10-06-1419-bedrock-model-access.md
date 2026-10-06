# 交接：实查 Bedrock 模型目录、参赛白名单与调用状态

- 日期 / 时区：2026-10-06 14:19，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户要求检查本队能调用哪些 Bedrock 模型，后澄清重点为 GPT 系列、Claude Opus、Claude Sonnet；当前 GitHub 开放 Issue 列表为空。
- 分支：main。
- 提交：本轮未提交 / 未推送。
- 状态：权限核验与资料保存完成；Sonnet 开通及实际调用仍待确认。

## 本次完成

- [模型核验报告](../../environment/aws/bedrock-model-access-20261006.md)及[去标识化 JSON 快照](../../environment/aws/bedrock-model-access-20261006.json)。
- 更新[AWS 环境入口](../../environment/aws/README.md)与[团队状态](../../docs/status.md)，保留前轮 CDK 通知和其他研究内容。

## 结论与依据

- 本次 SSO 身份链仍有效，STS 角色匹配；查询 `us-east-1` 的 121 个基础模型及系统推理 profile。
- 参赛角色内联 `ParticipantGuardrails` 和应用角色要求使用的 `NBAHackathonParticipantBoundary` 均包含 `DenyUnapprovedBedrockModels`：仅对 Sonnet 4.6 指定 profile / 基础模型和 Qwen3-VL-235B-A22B 例外。
- GPT / Opus / 其他 Sonnet 版本受显式拒绝。平台目录中存在这些模型不代表比赛账号能用。
- [AWS 访问文档](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)与[IAM 求值说明](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)于 2026-10-06 查阅；其余出处见报告。

## 验证

- 服务 metadata 检查：70 个四项就绪、50 个协议未就绪、1 个区域不可用；全部 121 个查询成功。四项就绪不等于参赛 IAM 放行。
- Qwen 真实 Converse 返回 `BEDROCK_OK`，16 / 5 tokens；gpt-oss-120b 真实 Converse 返回身份策略 explicit deny。未调用其他模型，未传比赛视频或个人资料。
- Sonnet 4.6 在模型拒绝白名单的例外集合中，但协议为 `NOT_AVAILABLE`；未发起首次调用，以免触发协议 / 订阅变更。无 IAM 修改、资源创建或部署。
- 共享快照检查：121 个唯一模型、2 个白名单例外、两份策略相关字段一致；账号 ID 去标识化，新增文档相对链接及 diff 空白检查。

## 阻塞与待确认

- 核验任务无阻塞。Sonnet 4.6 需由赛事管理员确认协议开通状态；GPT / Opus 若要使用，还需管理员改变明确的模型限制。没有发送组外消息或修改策略。
- 本轮没有验证图像、多轮工具、性能或成片效果；未查询自定义 / 导入模型或 Mantle 独立目录。

## 下一步

- 现阶段工程优先使用已实测的 Qwen；Sonnet 就绪后只使用已列白名单的 `global.anthropic.claude-sonnet-4-6`，从 `us-east-1` 接入并做最小调用验证。
- 如主办方更新策略，重新检查真实策略及运行结果，不直接用目录或 `AUTHORIZED` 字段宣布模型可用。

## 同步状态

- 开始时 fetch 成功，本地 HEAD 与 origin/main 同为 `be5c43d17c78f04b4df55eda38aa6f82fde8f803`，没有远端新提交需要拉取。
- 本轮仅本地文档 / JSON 保存，未提交、推送、创建分支或 PR；其他会话已有改动保留。原始查询和临时脚本在忽略目录，未共享完整角色 ARN、账号 ID 或凭据。
