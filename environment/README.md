# 环境准备

这里回答“在这台电脑或赛事账号上，怎样把工具、依赖和权限准备好”。安装与账号可用不代表作品已部署。

| 环境 | 入口 | 内容 |
| --- | --- | --- |
| 本机开发与工作台 | [本机准备](local/README.md) | Python、Node、Git LFS、工作台启动与模型环境 |
| 本机视觉模型 | [模型运行环境](local/model-runtime.md) | 已记录的权重、依赖版本、CUDA 与复现准备 |
| 赛事 AWS 账号 | [AWS 准备](aws/README.md)、[19 项服务实测](aws/services-live-audit-20261006.md) | CLI、身份与 CDK；本队服务实际调用、模型白名单、CPU / GPU 配额及未验证范围 |

赛事硬性要求和指南来源在 [requirements](../requirements/README.md)；架构、CDK 应用代码和工作台功能在 [engineering](../engineering/README.md)；模型比较、性能实验与结果在 [research](../research/README.md)。

这里保存可共享的说明和核验结论。实际 `.aws/config`、凭据、API 密钥、虚拟环境、模型权重和缓存仍留本机，不复制进本目录。项目依赖清单随工程保存，使用说明链接到清单，避免维护两套版本。
