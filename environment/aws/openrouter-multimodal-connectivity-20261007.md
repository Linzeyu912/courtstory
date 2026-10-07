# 既有调研多模态模型的 AWS → OpenRouter 实测

日期：2026-10-07，Asia/Singapore（UTC+8），09:08 取得完整结果。用户要求以[此前多模态调研](../../research/agents/multimodal-basketball-20261006/README.md)中的候选为主，继续验证比赛云端能否通过自有 OpenRouter key 调用。

**九个候选模型的图片序列调用均通过；其中五个通过直接 MP4 视频调用，两个通过音频调用。共 16 项真实云端请求全部 HTTP 200、答案核对通过。** 这是合成样例的协议与基本感知验证，不是篮球转播理解或战术质量评测。

## 模型与结果

括号内是云端进程测得的单次 OpenRouter HTTP 请求耗时；不包含部署和 Runtime 冷启动。`—` 表示本轮目录没有列出该输入模态，因此没有发送该项请求，不代表图片序列方案不可用。

| 模型 | 本次实际 OpenRouter ID | 三张时序图片 | 直接 MP4 | 音频 |
| --- | --- | --- | --- | --- |
| Gemini 3.8 Flash | `google/gemini-3.8-flash` | 通过（3.330 秒） | 通过（3.469 秒） | 通过（2.850 秒） |
| Qwen3.8 Max | `qwen/qwen3.8-max-0902` | 通过（6.464 秒） | 通过（8.010 秒） | — |
| Qwen3.8 Omni Flash | `qwen/qwen3.8-omni-flash` | 通过（5.840 秒） | 通过（6.678 秒） | 通过（3.067 秒） |
| Qwen3.8 27B | `qwen/qwen3.8-27b` | 通过（6.452 秒） | 通过（11.373 秒） | — |
| GPT-6 Astra | `openai/gpt-6-astra` | 通过（2.320 秒） | — | — |
| GPT-6.1 Sol | `openai/gpt-6.1-sol` | 通过（2.484 秒） | — | — |
| Claude Opus 5.5 | `anthropic/claude-opus-5.5` | 通过（6.954 秒） | — | — |
| Claude Sonnet 5.5 | `anthropic/claude-sonnet-5.5` | 通过（2.074 秒） | — | — |
| Kimi K3 | `moonshotai/kimi-k3` | 通过（4.029 秒） | 通过（13.011 秒） | — |

所有返回模型 ID 均与请求一致。单次短样例和不同服务商路由不足以给出速度或质量排行榜；需要统一的真实篮球任务与人工参照后再比较。

## 输入与核对标准

只使用本轮自制样例，没有向第三方提交赛事训练原片、真实比赛帧、团队数据或个人材料。

- **图片序列**：三张 640×360 PNG，时间戳 0、2.5、5 秒。画面包含编号 `A17` / `B42`、数字 `7318` 和移动的小橙球。请求要求只输出 JSON，识别数字、初始最近编号、最终最近编号、移动方向；提示词未给出答案。九个模型均正确返回 `7318`、`A17`、`B42`、`left_to_right`。
- **直接视频**：同一示意过程的 6 秒、10 fps、640×360 H.264 MP4，完整解码 60 帧通过。通过 `video_url` 中的 base64 data URL 发送文件，并非由本机先抽帧冒充视频接口；五个模型均正确回答上述四项。服务内部是否抽帧及具体采样方式未实测。
- **音频**：AWS Polly Joanna / standard 合成英文短句，包含四位数字和从 Alpha 到 Bravo 的移动关系。通过 `input_audio` 发送 base64 MP3；Gemini / Qwen Omni 均正确识别数字、起点与终点，并返回对应转写。这不是音画同步测试。
- 每项单次请求，`max_tokens=1024`，没有统一强制关闭思考，没有打开搜索、工具或多模型回退。输出均可解析成 JSON，且全部完成上述内容核对；合法 JSON 本身不单独算通过。

输入文件大小 / SHA-256、完整文本回答、provider、tokens、费用、逐字段判定及目录快照见[去标识化 JSON](openrouter-multimodal-connectivity-20261007.json)。临时输入和脚本仅保存在被忽略的 `tmp/openrouter-multimodal-check-20261007/`；本轮不将合成 MP4 加入正式视频库。

## 云端链路与配置

测试从本队 AWS `us-east-1` 的 **Bedrock AgentCore Runtime** 发出，路径为 `AgentCore → https://openrouter.ai/api/v1/chat/completions → 模型服务商`。此前[三模型纯文本验证](openrouter-cloud-connectivity-20261007.md)及其临时资源已先完成清理。

本轮通过 CDK 创建第二个独立临时栈，只有 Runtime 与执行角色；Python 3.12 直接代码部署，HTTP 协议，`PUBLIC` 网络，IAM 签名调用，空闲超时 60 秒、会话最长 900 秒。synth / diff、角色权限边界检查、Runtime / endpoint `READY` 和云端模型目录 HTTP 200 均通过。没有更改现有 Bedrock 模型白名单、预置角色或网络策略。

key 不放在代码、CDK 模板或云端环境配置中。沿用首轮的会话内加密传递，仅在执行过程中用于认证；临时本地加密副本在调用结束后删除。该短时测试机制不代表正式作品的凭据管理已实现。

## 费用

| 范围 | OpenRouter API 报告费用（USD） |
| --- | ---: |
| 本轮 16 项多模态请求 | 0.05835209 |
| 之前本机 / 云端六项纯文本请求 | 0.00180625 |
| 当前任务合计 | **0.06015834** |

最后 key 查询 `usage=0.06015834`、`limit_remaining=49.93984166`，与成功请求费用之和一致。OpenRouter 的 `limit=50` 按官方接口定义是美元，并非新加坡元；未修改用户额度，实际支出远低于用户给出的 50 新加坡元预算。上述数值不含 AWS 短时 Runtime、S3 和 Polly 的账单费用，未把未查账单的部分标为免费。

## 对调研结论的补充

1. 本轮 OpenRouter 目录未找到无日期的 `qwen/qwen3.8-max`，使用实际存在的 `qwen/qwen3.8-max-0902`。这与阿里原生 API 的别名规则分开记录，不要求工程直接照抄其他平台 ID。
2. 昨日调研中 Qwen3.8-27B 模型卡的托管可用性待确认；**今天的 OpenRouter 路由已实际通过图像与视频测试**。该结论仅适用于本次具体端点，不等于阿里所有原生服务或自部署环境已验证。
3. GPT / Claude 在本轮目录中有图片输入，但未列直接视频 / 音频；现阶段可以采用带时间戳的帧序列路径。没有尝试给这些端点提交未声明支持的 MP4 / 音频。
4. GLM-5V-Turbo 属于此前的补充候选，本轮未测；Gemini 4 Argon 的定向测试资格也未验证。不能把九个候选的结果扩大到所有 OpenRouter 模型。
5. 真实篮球中的球员身份、持球、遮挡、传球、掩护、战术解释、长视频、并发和音画同步均仍待验证。16 项合成测试不能说明哪个模型最适合最终作品。
6. 完整工作台尚未接入这些模型；本轮也没有取得新的赛事外部模型使用口径。技术可调用、产品已接入和赛事允许分别判断。

## 清理与来源

测试结束的 `stop_runtime_session` 返回 HTTP 200。栈、Runtime、临时角色、专属 S3 代码包 / 版本、CDK 模板资产与本地加密 key 副本的最终清理复查见结果 JSON。CloudFormation 等平台历史记录可能继续保留。

以下官方页面于 2026-10-07 查阅，真实可用性以本轮返回为依据：

- [OpenRouter 模型目录 API](https://openrouter.ai/api/v1/models)：实际模型 ID 与输入模态，运行时快照保存在结果 JSON。
- [OpenRouter 视频输入](https://openrouter.ai/docs/guides/overview/multimodal/videos)：`video_url`、base64 MP4 与服务商差异。
- [OpenRouter 音频输入](https://openrouter.ai/docs/guides/overview/multimodal/audio)：`input_audio`、base64 与格式字段。
- [OpenRouter API](https://openrouter.ai/docs/api_reference/overview)、[key 额度单位](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)。
- [AgentCore Python 直接代码部署](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-python.html)。
- 本地来源：[既有多模态调研](../../research/agents/multimodal-basketball-20261006/README.md)、[首轮连通性记录](openrouter-cloud-connectivity-20261007.md)、[CDK 通知](../../requirements/cdk-deployment-notice-20261006.md)。
