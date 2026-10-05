# 仓库目录与内容边界

更新：2026-10-05，Asia/Shanghai。按用户要求，调研、赛事任务、环境准备和作品工程分目录保存。此次整理只调整存放与引用，不代表新功能、模型效果或云端部署完成。

跨成员成果如何衔接，见[成果与接续总览](work-index.md)。新增的 THY 导入视频诊断归视觉研究，005 V2 制作基准和原始制作资料归作品工程，原交接保留在个人目录。

## 四个主目录

```text
research/                         # 调研、实验脚本、来源与结果
  vision/                         # 篮球跟踪、身份 / 脚点绑定、球场与 2D
    scripts/                      # 独立视觉研究探针
    vision-player-refinement/     # 原专题及结果配套
  agents/                         # Agent、视频理解与源码研究
  basketball-models/              # 篮球论文、模型与权重验证
  evidence/                       # 数据证据、纠错与故障实验
  runtime/                        # 历史性能和服务可行性调查
requirements/                     # 官方任务、规则、评分、交付与来源
  references/                     # 指标参考
  archive/                        # 历史培训、报名和手册
environment/                      # 电脑、依赖、账号与工具准备
  local/                          # 本机开发、模型与依赖
  aws/                            # CLI / CDK、profile、登录及资源核验
engineering/                      # 作品和工作台
  tools/                          # 前端、战术渲染及审核工具
  scripts/                        # 后端、候选处理及复用算法
  configs/                        # 产品运行配置
  docs/                           # 设计、接口、操作、计划与验收
  archive/                        # 历史产品工具与实现
```

实际 CDK 应用代码属于作品工程，后续可建 `engineering/infra/`；当前尚无可部署工程，环境就绪不能写成部署成功。

## 内容该放哪里

| 内容 | 主入口 | 边界 |
| --- | --- | --- |
| 跟踪、脚环 / 身份绑定、脚点与球场研究 | [视觉研究](../research/vision/README.md) | 报告、独立实验脚本和结果成套保存 |
| 论文、Agent、证据与性能调查 | [research](../research/README.md) | 保留来源、日期、输入输出与限制 |
| 比赛做什么、怎么评分、何时交付 | [requirements](../requirements/README.md) | 官方要求和来源；工程建议另存 |
| 安装工具、模型依赖、账号与权限 | [environment](../environment/README.md) | 可共享说明与状态，不保存实际凭据 |
| 工作台、Agent、成片与云端应用 | [engineering](../engineering/README.md)、[产品文档](../engineering/docs/README.md) | 代码、功能说明、测试及部署代码随作品保存 |
| 视频、标签和候选 | [视频入口](../data/videos/README.md)、[规范](video-data-management.md) | 视频唯一入口；共享成片用 LFS |
| 球员数据包 | [manifest](../2K%20Player%20Data/manifest.json)、[约定](../2K%20Player%20Data/AGENTS.md) | 保留原目录与契约 |
| 团队协作、进度与决定 | [流程](workflow.md)、[状态](status.md)、[决策](decisions.md) | 协作与索引，不放研究正文或产品设计 |
| 每轮过程与验证 | [handoffs](../handoffs/README.md) | 保留当时事实与路径文字，只更新可点击链接 |

混合文档应拆开：安装 / 账号步骤放环境，比较和测量放研究，产品接入放工程，彼此链接。项目依赖清单仍在代码旁，环境说明引用清单，不维护两套版本。

按实际调用关系分类脚本。生产候选生成器正在复用的公共算法留在 `engineering/scripts/`；八个独立视觉探针迁到 `research/vision/scripts/`。文件名含 benchmark 不必然代表独立研究。

## 本轮迁移表

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

## 其他固定入口

`data/`、`2K Player Data/`、`docs/`、`handoffs/`、根 `scripts/` 分别保留数据、球员包、协作、历史过程及仓库维护工具。根 `scripts/validate_video_data.py` 负责视频 / LFS 检查，`scripts/requirements/` 保存历史手册生成器。

活动素材入口为 [data/videos/classification](../data/videos/classification/README.md)，当前 163 段；人工抽检与删除依据留在原数据入口。本轮不搬视频、改标签或合并草稿。

`tmp/`、`artifacts/`、`data/raw/`、本机视频 / 草稿、虚拟环境与模型继续忽略。新建研究目录不会把下载的源码或权重自动入库。当前仅本地整理，提交推送状态以最新交接为准。2026-10-02 的初次拆分见[历史交接](../handoffs/Linzeyu912/2026-10-02-1109-organize-publish.md)。
