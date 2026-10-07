# 交接：服务拆分与部署位置说明

- 日期 / 时区：2026-10-07 09:41，Asia/Singapore（UTC+8）
- 成员：Linzeyu912
- 任务 / Issue：用户询问服务是否需要拆分并上传到对应位置；本轮开放 Issue 列表为空
- 分支：main
- 提交：未提交 / 未推送
- 状态：解释完成；未实施服务拆分或云端部署

## 本次完成

- 核对既有架构、工作台上云说明和相关交接，说明逻辑模块与实际部署位置的关系；本文件保存本轮结论。

## 结论与依据

- 延续现有工程建议：网页静态资源放私有 S3，经 CloudFront 提供入口；业务后端与 CPU 视频渲染首版可共用一个 ECS/Fargate 应用；Agent 代码部署到 AgentCore；素材、草稿和成片存 S3。
- 大模型通过接口调用；必要 GPU 检测可后续独立接入 SageMaker。后端运行位置和是否增加独立 Worker 仍是工程选择，不宣称团队已确认。
- 源代码可以继续保存在同一个 GitHub 仓库，部署时按组件打包。上传文件、推送代码、启动云端程序和连接接口是不同动作；用户使用时仍可只访问一个网页。
- 项目依据：[部署架构](../../engineering/docs/aws-deployment-architecture-20261006.md)、[工作台上云说明](../../engineering/docs/aws-workbench-deployment-guide.md)、[运行要求核验](../../requirements/aws-runtime-clarification-20261006.md)。赛事口径沿用 2026-10-06 的仓库记录，本轮未重新打开赛事原文。
- 2026-10-07 核对 AWS 官方文档：[S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)、[AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)、[ECS/Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)、[CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html)。

## 验证

- 已读仓库入口、状态、成员、决策、协作流程和相关交接；核对服务职责与原架构一致。
- HEAD、origin/main 和实际远端 main 均为 `043d257bc86c3c442075d653e6ba29e3d84b07d2`，无远端新提交需整合；保留现有未提交文件。
- 本轮仅新增说明交接；检查相对路径和空白，无代码变更，无需业务测试。未查询实时 AWS 资源，应用部署状态依据仓库记录。

## 阻塞与待确认

- 问答无阻塞。完整应用仍需打包、接口和存储适配及部署验收；独立服务测试不代表应用已上线。

## 下一步

- 后续实际部署任务可从 CPU 应用与 S3 适配开始，接通 AgentCore 和网页入口，再按真实需要增加 GPU 或队列。

## 同步状态

- 本交接仅在本地，未提交 / 推送；没有修改应用、创建云资源或提交赛事作品。
