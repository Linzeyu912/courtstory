# 仓库目录与内容边界

更新：2026-10-13，Asia/Singapore（UTC+8）。本页依据主仓库实际跟踪的文件整理，配合[根 README](../README.md)回答资料在哪里、目录之间如何协作，以及新增内容应放哪里。产品说明统一从 [engineering/README.md](../engineering/README.md)进入。

## 当前目录职责

| 类别 | 目录与入口 | 应保存的内容 | 与其他目录的边界 |
| --- | --- | --- | --- |
| 调研 | [research/](../research/README.md) | 来源、论文、模型比较、独立实验脚本及结果 | 已被产品复用的运行算法保留在工程中，研究结果不直接等于产品能力 |
| 需求 | [requirements/](../requirements/README.md) | 官方规则、评分、交付要求及有日期的来源 | 团队建议与产品实现另存，不改写原始来源 |
| 环境 | [environment/](../environment/README.md) | 本机依赖、模型环境、AWS 账号与工具准备 | 安装和权限说明留此；产品部署代码与操作说明随工程 |
| 产品 | [engineering/](../engineering/README.md) | 前端、服务、Agent、算法、配置、测试、基础设施和产品文档 | 完整产品介绍在本目录 README；仓库总览不重复维护产品正文 |
| 数据 | [data/](../data/README.md) | 视频输入、标签、轨迹、比赛名单与历史辅助数据 | 原始数据、机器候选和人工确认分别记录 |
| 参考数据 | [2K Player Data/](../2K%20Player%20Data/README.md) | 球员能力、球队赛季名单与来源索引 | 保留独立数据包契约；游戏评分不能替代真实比赛统计 |
| 成果 | [deliverables/](../deliverables/README.md) | 已选定的最终成片及字幕 | 产品输出；输入和处理中间产物不能混称最终成果 |
| 决策与协作 | [docs/](README.md) | 采用的决定、状态、流程、成员和仓库索引 | 决策在 [decisions.md](decisions.md)，状态在 [status.md](status.md)，产品设计在工程文档 |
| 过程 | [handoffs/](../handoffs/README.md) | 每轮任务的修改、验证、来源、阻塞与下一步 | 保留当时事实，当前结论通过状态和决策文档引用 |
| 维护 | 根 `scripts/`、`config/`、`.githooks/`、`.github/` | 视频/LFS 检查、Git 署名规则、CI 与 Issue 模板 | 与 `engineering/scripts/` 产品逻辑、`engineering/configs/` 产品配置区分 |

## 产品、调研与决定如何衔接

需求说明约束，调研提供证据；已确认采用的选择写入 `docs/decisions.md`，产品设计和实现进入 `engineering/`。验证结果随产品或研究专题保存，每次工作用 `handoffs/` 记录范围和入口，`docs/status.md` 汇总当前进展。

待讨论的方案不能写成已采用决定，实验跑通不能写成产品已上线，安装完成不能写成部署完成。混合资料应拆分正文并互相链接：模型比较进研究，账号准备进环境，产品接入进工程。

## 产品内部结构

```text
engineering/
  README.md          产品介绍、Single 样例、架构与使用入口
  tools/             工作台前端、审核、图形和预览工具
  scripts/           服务、视频处理、身份、解说与复用算法
  configs/           运行配置
  agent-workflows/   Agent 工作流契约
  infra/             EC2 / AgentCore / CloudFront / SageMaker 工程
  deploy/            本地与 AWS 部署指导、独立依赖入口
  tests/             回归检查和固定样例
  docs/              产品设计、操作、接口、计划与验收说明
```

产品[本地部署](../engineering/deploy/local/README.md)与[AWS 部署](../engineering/deploy/aws/README.md)分别保存在 `engineering/deploy/`；原 `engineering/docs/local-setup.md`、`cloud-setup.md` 保留导航。[既有运维记录](../engineering/docs/aws-live-deployment.md)和功能说明仍在 `engineering/docs/`。`infra/` 保存实际基础设施代码；部署指导不复制产品实现，部署状态以对应日期的验证记录为准。

脚本按实际调用关系分类：生产流程复用的算法保留在 `engineering/scripts/`，独立研究探针放 `research/` 对应专题。文件名中出现 benchmark 不足以判断应归哪一类。

## 数据与成果的关系

- `data/videos/`：当前活动输入由 [catalog.json](../data/videos/catalog.json) 和 [review-library.json](../data/videos/tactics/acceptance/review-library.json)定义；本次核对只包含 Single 考试视频及其标签、轨迹和来源。
- `data/player-rosters/`：明确比赛的球员名单，用作身份候选依据；不能将其他比赛名单自动套用到 Single。
- `data/workbench/`：保留的历史标定和脚点辅助 JSON，按样例与日期使用。
- `2K Player Data/`：参考能力数据包，独立保留原索引与来源契约。
- `deliverables/`：Single 最终成片与 SRT；与输入片段分别管理。

这些路径已被工作台和部署打包代码引用，本次保留物理位置，统一由[数据总览](../data/README.md)导航。共享视频遵守 [Git LFS 规范](video-data-management.md)，本地原片、草稿和处理中间文件保留在被忽略的目录。

## 2026-10-13 文档整理

| 原入口 | 当前入口 | 调整方式 |
| --- | --- | --- |
| 根 README 的产品介绍 | [engineering/README.md](../engineering/README.md) | 产品正文迁入产品目录，根 README 改为仓库导览 |
| `docs/local-setup.md` | [engineering/docs/local-setup.md](../engineering/docs/local-setup.md) | 产品安装说明随工程保存 |
| `docs/cloud-setup.md` | [engineering/docs/cloud-setup.md](../engineering/docs/cloud-setup.md) | 产品云端说明随工程保存 |
| `docs/aws-live-deployment.md` | [engineering/docs/aws-live-deployment.md](../engineering/docs/aws-live-deployment.md) | 保留原有运维事实与时间，迁入产品文档 |
| 缺少数据、决定与协作总览 | [data/README.md](../data/README.md)、[docs/README.md](README.md) | 补齐分类入口 |

[本轮迁移清单](repository-migrations/2026-10-13-readme-layout.json)记录文件与内容的对应关系。目录整理只改变文档组织与导航，不搬运行代码、媒体或模型，不代表新的云端部署。

## 2026-10-05 历史迁移记录

以下记录保留当时的迁移对应；部分旧样例和归档目录后来已从当前文件树移除，需要结合 Git 历史查看。当前目录以本页上半部分为准。


逐文件查询见[243 条迁移映射](repository-migrations/2026-10-05-layout.json)。

| 旧位置 | 新位置 |
| --- | --- |
| `engineering/research/vision-player-refinement/` | `research/vision/vision-player-refinement/` |
| 原研究根目录中的 `player-*`、模型整合、全场 / 泛化 / 叠加调研 | `research/vision/` 中同名文件 |
| 原研究中的 `agent-video-understanding-*`、`video-model-to-court-*`、`qwen-video-trajectory-agent-*` | `research/agents/` 下同名专题 / 文件 |
| `engineering/research/mentor-components-20261005/` | `research/basketball-models/mentor-components-20261005/` |
| `engineering/research/nba-evidence-study-20261002/` | `research/evidence/nba-evidence-study-20261002/` |
| 原研究中的 `vision-deployment-benchmark/`、`vision-local-aws-deployment.md`、`jev-*` | `research/runtime/` 下同名专题 / 文件 |
| `engineering/research/README.md` | 新入口 `research/README.md`；原索引保存在 `research/catalog-20261005.md` |
| `engineering/scripts/` 中八个独立视觉探针 | [research/vision/scripts](../research/vision/scripts/README.md)，文件名不变 |
| `engineering/docs/model-deployment.md` 的环境准备 | [模型环境](../environment/local/model-runtime.md) |
| 上述说明中的生成与历史验证 | [模型整合实验](../research/vision/model-integration-20261002.md) |
| 产品接续清单中的账号准备 | [AWS 环境](../environment/aws/README.md)，原清单保留作品计划 |
| `docs/superpowers/specs/2026-10-02-player-identity-demo-design.md` | `engineering/docs/specs/2026-10-02-player-identity-demo-design.md` |
| 根 README 的历次工作台更新 | [工程历史摘要](../engineering/docs/workbench-history-20261005.md) |

原始 JSON、来源快照、源码摘录、视频和历史手册不改字节；里面的旧路径是采集时记录，按本表映射。当前候选清单和代码读取路径随迁移更新，历史交接只修复链接。


## 本地目录与共享内容

`tmp/`、`artifacts/`、本机输出、原片、草稿、虚拟环境、模型权重和凭据继续按忽略规则管理。它们可能出现在某台电脑的目录列表中，不代表已入库或在其他电脑可用。

原始 JSON、来源快照、源码摘录、视频和历史手册保留原貌。历史交接保留当时路径文字，修复可点击链接；不为修复索引重新引入已移除的大文件。初次拆分见[2026-10-02 交接](../handoffs/Linzeyu912/2026-10-02-1109-organize-publish.md)。
