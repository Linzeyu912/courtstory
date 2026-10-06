# 交接：云端交互说明与 ECS/Fargate、SQS、SageMaker 核验

- 日期 / 时区：2026-10-06 16:02，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户追问 EC2 与 ECS/Fargate 的选择、本地与云端区别、CloudFront 网页交互，并要求实读可用服务；开放 Issue 为空。
- 分支：main。
- 提交：未提交 / 未推送。
- 状态：解释、来源和只读核验完成；没有部署资源。

## 本次完成

- 新增 [服务可用性核验](../../environment/aws/compute-services-availability-20261006.md)，更新 AWS 环境入口。
- 补充 [赛事来源实读](../../requirements/aws-runtime-clarification-20261006.md)和 [架构解释](../../engineering/docs/aws-deployment-architecture-20261006.md)：ECS 可选 EC2 / Fargate；CloudFront 是用户入口，现有工作台继续提供交互；SQS / Worker 拆分是可选演进。
- 更新团队状态，保留其他会话修改。

## 结论与依据

- 本轮通过 Chrome 直接打开 Quick Start 第一、二、三、五、六节，以及服务示例中的 EC2、ECS、SQS、SageMaker、CloudFront 页面，确认实际列出上述服务和 Fargate 示例。原文 URL、日期和范围在环境报告。
- CLI 确认本队参赛角色；Fargate 两个计算提供方 ACTIVE，按需 / Spot 均 140 vCPU；CPU EC2 标准按需 256，G/VT 按需 0；G5 Endpoint 2、Notebook 1、Processing 0。
- ECS、SageMaker 列表可读且为空；SQS 显式查询没有队列 URL 或续页。读取 ParticipantGuardrails、PowerUserAccess 和应用权限边界，没有把列表可读解释成完整创建权限。
- 官方偏重托管服务是优先考虑 Fargate 的依据；EC2 CPU 仍是有效方案。交互始终在 CloudFront 下的网页，机器评分还涉及代码仓库重跑。

## 验证

- 官方页面直接阅读、服务 API / 配额读取、可见策略核对完成。
- 新增文档及新增入口相对链接、改动空白检查通过；没有产品代码修改，不运行无关业务测试。
- 没有执行 CloudFormation / CDK 部署、模型调用、GPU 开机、SQS 创建 / 消费或赛事提交。

## 阻塞与待确认

- 本轮问题无阻塞。实际部署仍需补应用适配、容器环境及端到端运行；未枚举 SCP 或实测创建。
- 用户提及 Uploader 未对应到确切代码入口；说明其若为上传组件无需 GPU，部署时再按实际职责接入。

## 下一步

- 优先把现有 CPU 应用打包并接 S3 / AgentCore，保持单一网页交互；用真实模型任务确定 SageMaker 接口。
- 不因服务可用而自动新建全部服务；按运行需求加入任务队列。

## 同步状态

- 本轮 fetch 成功，HEAD / origin/main 均为 be5c43d17c78f04b4df55eda38aa6f82fde8f803；工作区已有多会话未提交修改，均保留。
- 本轮文件仍在本地，没有提交、推送、分支或 PR；没有云端资源变更。
