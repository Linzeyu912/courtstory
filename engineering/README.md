# CourtStory 工程

本地工作台与云端部署共用本目录代码。

| 目录 | 用途 |
| --- | --- |
| `tools/player-review/` | 正式工作台、前端源码、已构建资源与测试 |
| `scripts/` | HTTP 服务、视频处理、身份、战术、解说、配音和渲染模块及测试 |
| `tools/tactical-overlay/`、`tools/agent-tactics/` | 图形渲染与 Agent 工具桥接 |
| `tools/commentary-preview/`、`tools/report-player/` | 成片与结果预览资源 |
| `tools/material-label-review/` | 视频素材标签工具 |
| `configs/`、`agent-workflows/` | 跟踪配置及 Agent 工作流契约 |
| `infra/ec2-workbench/` | EC2、AgentCore、CloudFront 工程与恢复工具 |
| `infra/sagemaker-vision/` | SageMaker GPU Notebook 环境与训练片验证工程 |
| `tests/` | 工程回归检查 |

从仓库根目录运行命令，见[本地启动](../docs/local-setup.md)和[云端说明](../docs/cloud-setup.md)。视频、球员资料和样例辅助数据位于根目录 `data/` 与 `2K Player Data/`。调研、赛事文档和旧交接留在原 Team Hub。

第一部分 Agent 的使用见[视频身份初稿](docs/video-identity-review.md)，本轮功能补齐范围见[同步记录](../docs/feature-sync-20261010.md)。
