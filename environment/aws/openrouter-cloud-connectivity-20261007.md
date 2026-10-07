# AWS 云端调用自有 OpenRouter API 实测

同日后续：用户要求重点测试此前调研的多模态模型，已补齐[九模型图片、视频与音频实测](openrouter-multimodal-connectivity-20261007.md)。本页保留第一阶段的纯文本结果与费用小计；完整任务费用见后续报告。

采集日期：2026-10-07 09:00，Asia/Singapore（UTC+8）。范围：用户授权使用临时 OpenRouter key，验证本队比赛 AWS 账号能否调用外部大语言模型；不涉及作品模型替换或赛事提交。

**已实测通过：本队 `us-east-1` 的临时 Bedrock AgentCore Runtime 能通过 HTTPS 调用 OpenRouter，Gemini 3.8 Flash、GPT-6.1 Sol、Claude Opus 5.5 均返回 HTTP 200 和预期文本。**

## 测试方式

- 开工前 `main` 工作区干净，已执行 `git pull --ff-only origin main`，与远端一致；开放 Issue 列表为空，任务范围来自本聊天用户。
- AWS SSO 最初过期；用户重新登录后，以既有 `nba` profile 验证本队参赛身份。重新查询 AgentCore Runtime 与运行中 / 停止中 EC2 实例列表均为空，不能把之前的临时探针当作常驻作品服务器。
- 先在本机调用三个模型作认证对照，再通过 CDK 创建独立临时 Runtime 和执行角色；新角色保留 `NBAHackathonParticipantBoundary`，只授予读取本次 S3 代码包的权限。没有修改参赛角色、Bedrock 白名单、预置角色或网络策略。
- 使用 Python 3.12 直接代码部署、HTTP 协议、`PUBLIC` 网络模式、IAM 签名调用；Runtime 和默认 endpoint 均为 `READY`。空闲超时 60 秒，最长会话 300 秒。
- 云端先解析 `openrouter.ai` 并读取模型目录：DNS 成功，目录 HTTP 200。随后由云端 Python 进程直接向 `https://openrouter.ai/api/v1/chat/completions` 发请求。
- 三次云端请求分别指定具体模型，`max_tokens=128`，仅要求回复 `OPENROUTER_CLOUD_OK`；未传比赛视频、个人数据或业务材料。
- key 不在代码包、CDK 模板、环境配置或共享文件中。临时本地副本使用 Windows 用户加密；云端生成会话公钥，key 加密后经 IAM 调用传入同一会话，在进程内解密并用于 OpenRouter 认证；探针不输出密钥。该机制仅用于本次短时测试，不作为正式作品的凭据管理方案。

## 云端真实结果

| 请求模型 | HTTP | 返回标记 | 云端 HTTP 请求耗时 | 输入 / 输出 tokens | OpenRouter 报告费用（USD） |
| --- | --- | --- | --- | --- | --- |
| `google/gemini-3.8-flash` | 200 | 完全匹配 | 2.004 秒 | 10 / 112 | 0.00042750 |
| `openai/gpt-6.1-sol` | 200 | 完全匹配 | 1.621 秒 | 16 / 11 | 0.00014200 |
| `anthropic/claude-opus-5.5` | 200 | 完全匹配 | 1.945 秒 | 31 / 18 | 0.00048400 |

三个返回模型 ID 均与请求一致，结束原因为 `stop`。Gemini 的输出计数包含 105 个 reasoning tokens。耗时是云端进程测得的单次 HTTP 请求时间，不含部署、Runtime 冷启动或本机到 AWS 的往返，不用于推断复杂任务性能。

Anthropic 请求的 OpenRouter provider 返回 `Claude Platform on AWS`；这仍是使用用户的 OpenRouter 认证和计费通道，不是本队角色直接调用 Bedrock 获得了新的模型权限。

## 费用与本机对照

- 本机三个成功请求合计 **0.00075275 USD**。
- 云端三个成功请求合计 **0.00105350 USD**。
- 六个成功请求合计 **0.00180625 USD**；key 的 `usage` 从 0 变为 0.00180625，`limit_remaining` 从 50 变为 49.99819375，与请求费用之和一致。
- 用户口头预算为 50 新加坡元；OpenRouter 返回的 key `limit=50` 按官方 API 定义是 **USD**。本轮没有修改额度，实际用量远低于用户预算。AWS 短时计算和存储费用没有查询账单，未包含在上述 OpenRouter 费用中。
- 本机第一次 Gemini 请求携带 `reasoning.enabled=false` 时返回 HTTP 400；去掉该参数后成功。未保存该次上游错误正文，不进一步断言拒绝原因；之后云端使用成功的基本参数形式。

## 结论的适用范围

1. 当前账号的这条实际链路可用：**AgentCore → OpenRouter → 指定外部模型**。作品接入时可在后端使用 OpenRouter base URL、key 和模型 ID，不需要把模型权重部署到本队 GPU。
2. Bedrock 原有两项模型白名单与外部 OpenRouter HTTPS 调用是两条不同路径。本轮没有改变 Bedrock 权限，也没有把目录中所有模型视为已测试。
3. 本轮只验证三个模型的短文本认证、网络和推理响应；未验证视频 / 图像理解、工具调用、长上下文、并发、持续稳定性或篮球分析质量。
4. 仅证实本次 `PUBLIC` Runtime 配置。未来改用 VPC 或其他服务器，仍需按其出网设置复验。AWS 官方说明，VPC 模式接入公有子网本身不会带来公网访问，需要相应 NAT 等出网配置。
5. 技术可调用不替代赛事对外部模型或外部付费服务的允许口径；本轮没有取得新的主办方确认，也没有更改官方要求整理。
6. 完整工作台尚未接入 OpenRouter或完成云端部署；本次临时探针不是可提交作品。

## 清理与证据

模型请求完成后，停止 Runtime 会话返回 HTTP 200。本次栈、Runtime、角色、专属 S3 代码包、CDK 模板资产和临时密钥副本的最终清理状态见[去标识化结果](openrouter-cloud-connectivity-20261007.json)。AWS 可能保留 CloudFormation / 审计历史，不代表测试进程仍在运行。

本机探针脚本、原始模型目录、私有部署元数据保存在被忽略的 `tmp/openrouter-cloud-check-20261007/`。共享结果仅含模型结果、用量及清理事实，不含 key、账号 ID、桶名或角色 ARN。

## 来源

以下官方资料均于 2026-10-07 查阅；账号可用性以本轮实际 API 返回为依据。

- [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart)：统一调用地址、Bearer 认证和 model 参数。
- [OpenRouter API Reference](https://openrouter.ai/docs/api_reference/overview)：响应格式与 usage 字段。
- [OpenRouter API key 额度定义](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)：`limit` 使用 USD。
- [AgentCore Python 直接代码部署](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-python.html)。
- [AgentCore 网络连接模式](https://aws.amazon.com/blogs/networking-and-content-delivery/network-connectivity-patterns-for-agents-deployed-on-amazon-bedrock-agentcore-runtime/)。
- [AgentCore VPC 出网说明](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-vpc.html)。
- [既有 Bedrock 权限实查](bedrock-model-access-20261006.md)、[赛事 CDK 通知](../../requirements/cdk-deployment-notice-20261006.md)。
