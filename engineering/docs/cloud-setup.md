# 云端工程

AWS 部署指导已统一到 [CourtStory AWS 云端部署](../deploy/aws/README.md)，包含服务架构、新视频到 EC2 / S3 的数据流、配置与赛事环境限制、发布更新顺序、备份恢复与验收。

现有工程复用 EC2、SageMaker GPU worker、S3、Bedrock AgentCore 与 CloudFront；在线模型与配音分别依赖 OpenRouter 和 Qwen Audio。该工程仍有赛事环境前置条件，不能当作任意 AWS 账号的一键部署。

2026-10-10 上线与后续修复事实继续保存在 [AWS 工作台运行与维护](aws-live-deployment.md)，按各阶段时间阅读。本页保留为原链接的兼容入口，不再单独维护第二份部署说明；产品共用能力见[产品 README](../README.md)，本机运行见[本地部署](../deploy/local/README.md)。
