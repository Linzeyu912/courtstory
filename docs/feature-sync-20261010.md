# 成品功能同步（2026-10-10）

日期 / 时区：2026-10-10，America/New_York。源仓库远端 main 为 `56e6466057c0560701d3163d2dbd1384e59249d2`，CourtStory 本轮开始为 `0981c80`。初次成品导入基线为 `53b1fc8`；本轮只补齐其后功能文件，以新提交记录，不合并旧仓库历史。

## 同步结论

第一部分 Agent 优化来自 Team Hub [`7cd78d6`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/7cd78d6f65f3bcaf69fcba5ca0a3a1a646833634)，此前未进入 CourtStory，本轮已经补齐。

| 模块 | 本轮变化 |
| --- | --- |
| 视频身份初稿 | 复用第三部分总览、视频窗口和局部读图工具，准备检测观察并生成有限人物关联候选 |
| 姓名与比赛上下文 | 首次任务接收已保存上下文；加入三个有来源的比赛名单；姓名候选可直接显示和随草稿重载 |
| 人工保护与下游衔接 | 保留人工修改、区间、撤销、来源及版本检查；保存稿供第三部分读取 |
| 环境与绘图 | 身份、姓名、解说、Polly 共用显式配置文件；独立绘图继承代理设置 |
| 云端打包 | 首次与更新打包包含比赛名单，避免本地可用而部署漏数据 |
| SageMaker | 迁入 GPU Notebook 工程，探针改用官方训练 001；尚未接通工作台远程 GPU 调度 |

对最新源快照逐文件核对 `engineering/scripts/`、`engineering/tools/player-review/`、`engineering/configs/`、`engineering/agent-workflows/` 与 `data/player-rosters/` 的代码/数据文件，无缺失。运行代码差异仅为 CourtStory 的球场辅助数据和 replay 路径；五个前端测试文件保留此前迁移后的夹具路径。说明文档按成品用途整理，不要求与旧仓库历史文档相同。

## 保留范围

视频仍只有弗拉格、阿门两段官方训练片，使用 Git LFS。没有复制其他视频、研究目录、赛事答辩资料、旧交接、机器环境报告、模型、凭据或运行缓存。TEAM 25 界面与冻结背景保留。

三个比赛名单是小型运行数据，不附带对应比赛视频。SageMaker 权重仍需单独准备，当前并无真实 GPU 运行或部署结论。

## 本轮验证

- 前端 bundle 构建通过，805 项前端测试全部通过。
- Agent 工具 41 项通过；补装新工作区已有锁文件声明的 Agent 依赖。
- 身份、视频读取、服务接口、配置和球员数据 103 项 Python 回归通过。
- 解说任务、Polly、绘图与独立姓名 81 项 Python 回归通过；使用测试替身，无付费服务请求。
- 云端打包/恢复 11 项测试通过，新增名单进入 ZIP 的覆盖。
- 迁入的 SageMaker 工程严格本地合成通过，未运行 bootstrap / deploy。

上述检查证明代码及接口衔接，不代表真实模型识别准确率、新成片或云部署已验收。使用见[身份初稿](../engineering/docs/video-identity-review.md)、[本地启动](local-setup.md)与[云端工程](cloud-setup.md)。
