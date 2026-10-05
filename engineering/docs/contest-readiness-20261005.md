# 从本机工作台到赛事交付：10 月 5 日接续清单

日期：2026-10-05，Asia/Shanghai。依据本轮 Team25 Portal 与正式指南实读、仓库/远端核对及已有工程交接。官方事实见[Portal 核验记录](../../requirements/portal-access-20261005.md)；本文的优先级、架构和排期是建议，不是团队已确认分工。

22:33 接续：本队 S3 临时文本写入、下载摘要核对与清理成功；Bedrock Qwen 单次文本调用返回 CLOUD_OK。该结果只覆盖当前参赛身份和文本请求，图片、工具调用、应用执行角色与部署仍待验证。见[接通交接](../../handoffs/Linzeyu912/2026-10-05-2233-s3-bedrock-connectivity.md)。

22:03 接续：CDK CLI 2.1144.0 已安装并验证；用户指定的桌面训练包包含两段 1080p 视频，21.55 / 22.89 秒，完整视频解码通过，包内没有独立指标文件。现有正式成片代码已使用 CPU 编码，自动检测仍有 CUDA 前置检查。具体分工和迁移点见[工作台上云说明](aws-workbench-deployment-guide.md)，素材证据见[训练包核验](../../requirements/training-package-check-20261005.md)。未修改生产代码或创建云资源。

21:48 接续：AWS CLI 2.37.9、双 profile 和 SSO / STS 实际身份检查均已完成；Portal 已显示现有仓库绑定。本队桶与 CDKToolkit 已预置，Runtime 和 CloudFront 列表为空；本机 Node/npm 可用，尚未安装 CDK。见[最新只读盘点](../../handoffs/Linzeyu912/2026-10-05-2148-aws-readiness-inventory.md)、[安装交接](../../handoffs/Linzeyu912/2026-10-05-2135-aws-cli-v2-install.md)与[配置交接](../../handoffs/Linzeyu912/2026-10-05-2140-aws-cli-profiles.md)。

## 1. 需要调整的优先级

建议立即把主线集中到：**官方指标和比赛画面对齐 → 有依据的可视化叠加 → AgentCore 处理 → CloudFront 交互页面与成片**。

正式指南现在明确 AgentCore、CloudFront/Web、CDK、赛事账号 us-east-1 四项要求，GPU 配额为 0，并说明官方数据仅有出手瞬间点位、不含逐帧轨迹，赛题不做跑动轨迹复原。此前继续深挖完整轨迹和新模型不是当前交付的前置条件。

现有身份/球场/2D/战术编辑可以继续作为内部辅助，帮助做出准确的箭头、球员标记与讲解。完整十人轨迹、通用动作识别、新论文模型适配应作为可选研究保留，不阻塞一段官方片的交付。语音是赛事可选项，可在可视化闭环后补齐。

## 2. 已有成果与真实缺口

| 部分 | 已有证据 | 下一步 |
| --- | --- | --- |
| 私有仓库 | GitHub 为私有、默认 main；21:40 Portal 已显示绑定；远端两条资料提交 13923fd / 82a8257 已拉取整合 | 四类目录与跨成员成果入口见[成果总览](../../docs/work-index.md)；发布与核对情况由最新交接记录，旧交接保留当时状态 |
| 数据与素材 | 活动库 163 段；另已核实用户桌面两段官方训练片，包内无独立指标文件 | 复用已有训练片，补齐官方指标及事件到视频时间的对应 |
| Agent 成片 | 旧 V2 已有真实 Codex 候选采用、32.83 秒静音 MP4 成功记录 | 把实际运行的 Agent 接到 AgentCore；本地 CLI 成功不能代替赛事部署 |
| 新版工作流 | 2D 准备、最新 V3 候选与 Qwen 修正已有代码 | 这些新路径仍需对应真实验收；优先选能支持当前官方片的最小路径 |
| 呈现 | 可编辑曲线、关键帧暂停、原画面投影与 MP4 | 加入官方指标/身份，核对时间同步；配音/字幕属可选增强 |
| 云端 | 本队桶与 CDKToolkit 已存在；S3 临时文本读写和 Bedrock Qwen 单次文本请求成功；尚无 AgentCore Runtime / CloudFront，仓库无 CDK 工程 | 新建应用部署工程，先核对预置资源与 bootstrap 兼容性，采用 CPU + Bedrock |
| 环境 | CLI 2.37.9、双 profile、STS 身份通过；Node 24.14.1 / npm 11.11.0、CDK CLI 2.1144.0 可用 | 准备可复现运行包、CDK 工程及最小应用 |

旧 V2 的真实样例成功与新 V3/Qwen 待验收应分别记录。Qwen3.8-Max 的阿里云接口与赛事提供的 Bedrock Qwen3-VL 235B 是不同路径，不能只替换字符串就声称迁移完成。

## 3. 建议的最小工程结构

这是待实现架构，具体计算服务应在官方片 CPU 耗时及本队配额确认后选择。

```text
CloudFront 作品网页
  → 应用后端 / 任务接口
  → Bedrock AgentCore（实际 Agent 调度、取证和生成）
      → Bedrock（帧图理解、指标解释、标注计划）
      → CPU 处理任务（现有图形逻辑 + Python / Node / FFmpeg）
      → 官方指标适配与校验
  → S3（输入、结构化证据、成片）
  → CloudFront 播放 / 下载 / 展示分析依据
```

全部由 CDK 管理所需基础设施；主办方预置 S3 桶先核对，再引用，避免把已存在的桶误当成自己新建。按用途选任务编排/状态服务，不为服务数量堆组件。指南说明托管服务技术评分权重更高，不建议仅把整个本机工具搬到 EC2 作为最终方案。

可先用 CPU 测现有 YOLO 小模型和渲染器；若完整检测过慢，优先采用关键帧、Bedrock 图像理解及人工校核，不把缺失轨迹补成已知事实。模型分析、图形计划和像素落点仍须核对；Bedrock 能调用不等于定位已准确。

## 4. 操作顺序与完成标准

### P0-A：确认环境前置条件

安装、profile、登录和已预置资源统一查[AWS 环境准备](../../environment/aws/README.md)，本机模型依赖查[本机准备](../../environment/local/README.md)。截至 22:33，CLI、CDK、仓库绑定、身份验证、S3 临时文本读写与 Qwen 单次文本请求已有完成记录；图片 / 工具调用、应用权限和部署仍需验收。本清单从这些环境条件继续设计作品，不重复维护账号配置步骤。

### P0-B：最小 CDK / AgentCore / Web 闭环

1. 阅读有效 [Quick Start](https://csdn.feishu.cn/docx/Y21TdJqrHopofmx2w21cmqHLnLb) 与 [AWS 服务指南](https://du5imhgxabl0d.cloudfront.net/services) 的 CDK / AgentCore 示例。
2. 在已通过的 Qwen 文本请求基础上验证图片与工具调用，再让真实 Agent 运行在 AgentCore，并从 Web 调用。官方示例给出 `global.anthropic.claude-sonnet-4-6` 与 `qwen.qwen3-vl-235b-a22b`；前者及后续应用执行角色的权限 / 调用仍需实测。
3. 在 engineering 下建立 CDK 工程，写清启动、部署、输入输出、产物位置和评测复现方法。已有本机任务接口不等于官方统一接口，需要拿到正式契约后适配。
4. 在工程目录执行 `cdk synth --profile nba` 与 `cdk diff --profile nba`，检查目标账号/us-east-1及资源/权限变化；核对是否已有 bootstrap。准备完成并获得部署范围授权后再部署。
5. 第一轮只用一段练习片叠一行真实文字，传回 S3，经 CloudFront 页面播放；之后再接现有战术渲染。静态页面烟测只证明前端发布，不算最终 Agent 完成。

完成标准：浏览器发起任务 → AgentCore 实际处理 → S3 产物 → CloudFront 可交互、可播放。保存真实任务结果和耗时，不以固定展示视频冒充处理链。

### P0-C：官方数据与一段作品

1. 已从用户指定的本机训练 ZIP 检查两段素材，记录文件名、时长、源帧时间与哈希，见[核验](../../requirements/training-package-check-20261005.md)。原片和检查帧保存在被忽略的本地目录，直接复用，不必重复下载 [Portal 训练 ZIP](https://comfile.csdnimg.cn/file/train_video.zip)。
2. 从官方深度赛场入口获取匹配的球员/投篮/指标，补齐字段名、单位、关联键及时间字典。官方数据没有逐帧轨迹，缺失数据不推测补值。
3. 用现有工作台导入和识别，核对所需球员与标注位置。若使用 2D 投影，按[操作指南](2d-first-tactics-workbench-guide.md)保存可信准备；只做当前片段需要的范围，不把全场重建当交付门槛。
4. 围绕一两个解释点编排：谁在何处出手、官方指标说明什么、可见防守/空间如何支持这次选择。模型提出标注计划后，人核对人物、时机和依据，再使用现有图形工具与 MP4 渲染。
5. 检查名字跟对人、指标不张冠李戴、箭头不遮挡重点、数据与画面时间一致。输出“可播放成片 + 简明解释 + 来源/处理状态”的网页。

2K 属性不能替代官方预期命中率或引力，HoopEval 等研究分数也不能冒充官方数据。新论文组件先保留为后续增强。

### P1：语音、字幕与体验

正式指南把解说列为可选项。现有 MP4 为静音；若加入配音，可使用指南推荐的 Polly 或其他符合赛事规则的方案，并对 AI 解说明确声明。字幕/音频应按加入冻结后的成片时间同步，而不是直接使用源视频秒数。

优先完成能看懂的图形和准确数据，再补声画体验。保留任务进度、错误原因、重试与播放下载；真实案例的人工评分拆为准确性 30 分、UX/UI/体验 25 分，两者都应验收。

## 5. 赛前和比赛日建议

建议 10 月 6 日先通账号/绑定/最小栈，10 月 7–8 日完成一段官方练习片与端到端云运行，10 月 9 日冻结可靠演示版本并预演“换一段新视频”。这是本轮建议排期，没有给队友分配职责。

正式指南为 10 月 10 日 18:00 发布考试视频，19:45–20:00 提交，20:00 北京时间截止。工作顺序：确认指定素材 → 用已验证管线处理和人工核对 → 生成完整作品 → 部署并外部访问 → push main → Portal 提交本队 CloudFront URL并检查成功回执。两次 URL 提交至少间隔 1 分钟，最后一次有效提交覆盖之前结果。

交付包括 Agent、私有代码/CDK、说明文档、演示视频及可交互 CloudFront 页面。链接要覆盖 20:00–22:20 评审期；不能在 20:00 一到就关资源。作品 URL 是本队部署地址，不是主办方 Portal 地址。

## 6. 尚待实际完成

- CDK 安装与本地工程；本队资源读写/创建权限和预算核验（绑定、CLI、身份已完成）。
- 复用已检查的两段官方训练片，补齐匹配的深度指标数据；核对统一 Agent 输入/输出/产物契约。
- CDK 部署工程、AgentCore 适配、CPU 性能及官方片效果验收。
- 本队 CloudFront 成品链接与正式提交回执。

当前 GitHub 全状态 Issues 查询为空，无负责人/最新讨论可核对。本轮没有创建 Issue、分配成员、绑定仓库、配置 AWS、创建云资源或提交作品。

## 来源与验证边界

- [Portal 与正式指南核验](../../requirements/portal-access-20261005.md)：2026-10-05 实读，包含事实来源、页面状态和未核实事项。
- [旧 V2 真实成片交接](../../handoffs/thy-0629/2026-10-04-2315-authored-tactics-production.md)：旧路径真实成功，不外推到新 V3。
- [新 V3 / 2D 工作流交接](../../handoffs/chuali-zi/2026-10-05-0127-2d-first-tactics-workbench.md)、[Qwen 首版交接](../../handoffs/chuali-zi/2026-10-05-0651-qwen-ground-trajectory-implementation.md)：新路径真实验收边界。
- [新模型发布核查](../../research/basketball-models/mentor-components-20261005/OPEN_SOURCE_AUDIT.md)：当前仍有本地未提交研究，未直接接入生产。
- [AWS CLI SSO](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)、[CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/cli.html)：本轮查阅；本队具体登录应以 Portal 双 profile 为准。
- 本轮仅资料核查和文档修改，没有重跑历史业务测试、调用模型或证明上述待实现架构已经可用。
