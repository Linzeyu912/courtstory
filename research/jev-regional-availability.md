# TypeSafe Jev：珠海与澳门调用可用性调研

- 核查日期：2026-09-28（Asia/Shanghai）
- 对象：TypeSafe AI 的 Jev，官方域名为 `typesafe.ai`。
- 结论状态：公开资料核查完成；已于 2026-09-28 发邮件向厂商确认，等待答复；地区资格、实际网络和账号调用仍待确认。

## 1. 能否在珠海、澳门调用？

**目前无法根据官方公开资料确认两地均受支持；也没有查到专门禁止珠海或澳门的说明。** 本次查看的模型文档、API 文档、客户协议、隐私政策及使用政策，没有给出中国内地、澳门的明确服务地区清单。不能把“没有写禁止”当作“官方保证可用”。

| 使用地点 | 地区政策 | 网络及账号可用性 | 当前判断 |
|---|---|---|---|
| 珠海（中国内地） | 未找到明确支持承诺或针对该地区的禁用说明 | 未在珠海实际网络进行带有效 Key 的请求 | 待厂商确认和实测 |
| 澳门 | 未找到明确支持承诺或针对该地区的禁用说明 | 未在澳门实际网络进行带有效 Key 的请求 | 待厂商确认和实测，不能直接套用珠海结果 |
| 比赛 AWS 后端 | 实际 AWS 区域及厂商对此使用方式的确认尚缺 | 未部署或调用 | 单独验证；服务器所在地不能替代用户资格确认 |

本次没有进行付费推理或创建 API Key。公开资料调研完成后，已按用户要求[发邮件联系厂商](jev-support-email-2026-09-28.md)。搜索工具能够读取官网，只能证明资料可读取，不能证明两地的账号、支付和推理服务可用。

## 2. 官方资料能确认什么？

| 已确认事实 | 来源与边界 |
|---|---|
| 客户协议包含通用出口与受限制主体条款 | [MCA §16.12](https://typesafe.ai/legal/mca)，页面更新于 2026-09-23；没有据此推导中国内地或澳门已获准使用 |
| 隐私政策写明服务托管在美国 | [Privacy Policy / International Visitors](https://typesafe.ai/legal/privacy-policy)，页面更新于 2025-11-19；托管位置不是支持地区清单，也不是两地的网络质量承诺 |
| 官方调用入口是 `POST https://api.typesafe.ai/v1/systemone`，使用 Bearer API Key | [API reference](https://docs.typesafe.ai/api)；[Quick start](https://docs.typesafe.ai/introduction/quickstart) 指引从官方控制台取得 Key |
| 核查时版本为 `jev-1.13.0`，`jev-latest` 指向该版本 | [Models](https://docs.typesafe.ai/models)；别名以后可能变化 |
| Jev 接收文本或结构化文本数据，不接收图片、音频、视频 | [Models](https://docs.typesafe.ai/models)；英文效果最佳，中文等 CJK 内容需要自行评测 |
| 输出以选择、评分、是非概率等结构化判断为主，不生成自由文本 | [Introduction](https://docs.typesafe.ai/introduction) |

## 3. 对我们比赛项目的建议

以下是工程建议，尚未形成团队技术选型决定。

1. **先作为可替换的辅助模块评估。** 可用来选择讲解主题、评价已解析事件的解说价值，或检查文字说明与已有数据是否相符。先在我们自己的篮球样例上验证准确率。
2. **视频解析和解说生成仍需各自的能力。** Jev 不能直接观看比赛视频，也不能独立生成解说文案；它返回的概率不能未经校准就当作真实投篮命中率、比赛胜率或官方指标。
3. 若厂商确认允许该团队及目标地区使用，可由比赛规定的 AWS 后端调用 Jev，网页访问我们自己的后端。Key 保存在后端环境配置中。AWS 区域、赛事是否允许外部模型仍需按正式要求核实。
4. 在地区政策及实际调用验证完成前，演示主流程应能在 Jev 请求超时或不可用时继续运行，例如回退到明确的规则或其他已验证的模块。

## 4. 把“待确认”变成可执行的验证

### 厂商确认

官方支持入口为 **support@typesafe.ai**，见 [MCA §3](https://typesafe.ai/legal/mca)。已于 2026-09-28 22:06（Asia/Shanghai）发送询问信，补充三人团队、比赛时间、篮球分析用途及拟采用的 AWS 后端背景；[已发送正文与记录](jev-support-email-2026-09-28.md)。目前等待厂商答复，地区可用性结论尚未改变。

### 实际调用验证

分别记录珠海现场网络、澳门现场网络和最终 AWS 运行环境的结果；无需把完整 IP 或密钥写入仓库。

| 验证项 | 记录内容 | 如何理解结果 |
|---|---|---|
| 官网和控制台 | 日期、地点、网络类型、登录/Key 获取结果 | 页面打开不代表推理成功 |
| `GET /v1/models` | 使用有效 Key，记录状态码和可用模型名 | 验证认证和模型目录，不替代推理验证 |
| `POST /v1/systemone` | 发送一个简短的非敏感样例，记录状态码、返回模型、答案和耗时 | 成功仅证明该次请求在该环境可用 |
| 比赛端到端流程 | 网页 → AWS 后端 → Jev，重复少量请求观察成功率和延迟 | 据实际耗时设置超时、回退和演示方案 |

排查时保留脱敏错误摘要：认证错误先检查 Key；访问拒绝需要结合响应和厂商说明；超时先定位 DNS、TLS 和网络；限流按 API 文档处理。单次 403 或超时不能直接认定为地区封禁。

## 5. 来源与调查范围

以下官方页面均于 2026-09-28 查阅；可变文档未标发布日期时，以本次查阅日期为准。

- [官方文档索引](https://docs.typesafe.ai/llms.txt)：定位模型、API 和入门页面；未发现专门的地区支持页面。
- [Models](https://docs.typesafe.ai/models)：版本、输入、语言支持及模型目录请求。
- [API reference](https://docs.typesafe.ai/api)：请求地址、认证、请求和响应结构。
- [Quick start](https://docs.typesafe.ai/introduction/quickstart)：控制台及 Key 获取入口。
- [Introduction](https://docs.typesafe.ai/introduction)：模型输出能力。
- [Master Customer Agreement](https://typesafe.ai/legal/mca)：支持渠道及相关条款。
- [Privacy Policy](https://typesafe.ai/legal/privacy-policy)：服务托管位置。
- [Acceptable Use Policy](https://typesafe.ai/legal/acceptable-use-policy)：未找到地区支持清单。

另进行了面向 `typesafe.ai` 和 `docs.typesafe.ai` 的 China、Macau/Macao、countries、regions、availability 等公开检索。搜索未命中不证明不存在未公开限制。第三方同名站点和介绍文章不作为厂商地区政策的依据。
