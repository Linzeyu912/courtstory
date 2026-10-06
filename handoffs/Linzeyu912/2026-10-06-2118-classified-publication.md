# 交接：AWS 可用性报告与当前更新分类发布

- 日期 / 时区：2026-10-06 21:18，Asia/Singapore（UTC+8）。此前记录的时区按采集原文保留。
- 成员：Linzeyu912。
- 任务 / Issue：用户要求共享 AWS 服务可用性报告，并将当前更新按类别分别提交、同步。开工读取 GitHub open Issues 返回空列表，没有可核对的现有负责人或任务讨论。
- 分支：main。
- 提交：开工 `be5c43d17c78f04b4df55eda38aa6f82fde8f803`；六组主题发布至 `0336ac965bcdb7d6fb7f4631ec8ef0d0759c1198`，完整清单如下。本文件所在的最后一条提交用于协作索引和发布记录。
- 状态：分类整理与六组主题发布完成；本交接随最后一条协作提交同步。

## 本次完成

- 将开工已有的 49 份未提交更新逐项核对，按三个调研专题、赛事要求、环境核验和工程准备提交，保留原始证据及历史交接。
- 将 [19 项 AWS 服务实测报告](../../environment/aws/services-live-audit-20261006.md)和[去标识化 JSON](../../environment/aws/services-live-audit-20261006.json)作为本队账号可用性主入口；模型白名单、SageMaker GPU、只读配额和服务入门资料归 `environment/aws/`。
- CloudFront 交付、私有仓库重跑、截止时间及 CDK 通知归 `requirements/`；上传脚本、预检和部署建议归 `engineering/`；模型比较、论文与独立 TAPNext++ 实验归 `research/`。
- 更新根 README、环境总入口、各专题 README 和[接续总览](../../docs/work-index.md)。在早期部署建议和只读核验报告中补充晚间实测入口，避免旧的“尚未运行”被当成最新状态；没有改写原始 JSON 或历史交接中的当时结论。
- 53 份文件构成本次发布范围；忽略目录中的原始云端响应、探针临时资源文件、凭据、缓存和依赖未纳入 Git。

## 分类提交

| 类别 | 提交 | 文件数 | 内容 |
| --- | --- | --- | --- |
| 多模态模型调研 | [627ff30](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/627ff30430adfa04e5bab59ae5140392cd00c4f8) | 6 | 篮球多模态比较、Qwen3-VL 规格、来源与交接 |
| 点跟踪调研 | [b5f3da6](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/b5f3da63f0829aac4acfb7d463cc08899f99ad23) | 7 | TAPNext++ 报告、随机参数运行探针、成功与失败证据 |
| 篮球论文核查 | [82b5438](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/82b543802abe770a364748ccf40bb63d53ca5556) | 3 | 遮挡球员热图论文及代码 / 权重公开状态 |
| 赛事要求 | [864710b](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/864710bb0a9cb8697073bfe99c26a3c41a259c13) | 7 | AgentCore / GPU 要求、CDK 边界、两条评审路径和截止时间 |
| AWS 环境与实测 | [9684bf3](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/9684bf3e5d7cf6237837d741411e89165b3ae24b) | 15 | 19 项服务、模型访问、CPU / GPU 配额、服务入门及证据 |
| 工程部署准备 | [0336ac9](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/0336ac965bcdb7d6fb7f4631ec8ef0d0759c1198) | 10 | S3 条件上传脚本、实际上传记录、部署预检与架构建议 |
| 协作索引与发布 | 本文件所在提交 | 5 | 根入口、团队状态、接续总览、早间合作者审阅和本交接 |

## 结论与依据

- AWS 主报告依据 2026-10-06 20:00–20:25 的实际测试及 20:36 的清理证据：19 项中 18 项基础功能通过；MediaLive 仅创建输入，未验证开播。没有把查询成功等同于业务功能通过。
- Qwen 指定模型的文本请求通过；Sonnet 4.6 未实际调用，协议状态待处理；白名单之外的模型存在显式拒绝。EC2 G/VT、P 按需 GPU 配额为 0，SageMaker 的非零配额没有启动验收。具体能力不能由服务名称整体推断。
- 实测 JSON 中六个临时栈均已删除，十条资源复查均确认回收，测试 S3 前缀对象数为 0。独立探针通过不能代替完整工作台部署。
- [赛事评审说明](../../requirements/judging-operation-clarification-20261006.md)记录已实读的官方来源、采集时间和未明事项。考试视频在 18:00 发布，19:45 结束调优，20:00 提交截止；已读规则不支持“只冻结代码、截止后仍可继续加工最终评分成片”的解释。
- 本轮整理依据现有报告和证据，没有重复创建云资源、调用模型、运行 GPU 探针或提交赛事作品；未形成新的团队选型、职责分配或功能验收结论。

## 验证

- 开工阅读仓库协作文件并 fetch；本地 HEAD 与 origin/main 均为 `be5c43d`，暂存区为空。按明确路径暂存，每组提交前核对文件摘要未被其他任务改动，暂存路径与分类清单完全一致。
- 7 份新增 JSON 均解析成功；实测快照与报告的 19 / 18 / 1 数量、六个删除栈、十条资源清理复查及空测试前缀一致。
- 两份 Python 脚本 AST 语法检查通过；TAPNext++ 探针 `--help` 正常。本轮没有重跑随机参数推理，也没有将其描述为正式权重精度测试。
- 上传脚本默认计划模式成功核对两段训练片，文件总计 171,215,644 字节，大小与 SHA-256 均匹配；未传入 `--upload`，没有再次写入 S3。
- `scripts/validate_video_data.py --check-index` 通过：9 个数据集、165 条记录、165 个文件摘要、165 个暂存索引 LFS 指针，总计 2,084,029,775 字节。本轮没有改动视频文件或视频登记。
- 本批新增 / 调整的相对链接目标存在，JSON 与 Markdown 中未检出常见凭据格式、签名 URL 或 AWS 账号编号；`git diff --check` 和六组提交的累计差异检查通过。凭据模式扫描并不是对所有秘密格式的穷尽证明，同时人工核对共享证据范围。
- `docs/status.md` 内两处 10 月 3 日旧链接在开工 HEAD 中已缺失：`engineering/experiments/tactical_analysis/README.md` 和 `handoffs/chuali-zi/2026-10-03-0440-tactical-analysis-lab.md`。没有找到可确认的新位置，保留历史记录，不虚构补齐；本轮未新增这两处问题。

## 阻塞与待确认

- 本次分类发布无阻塞。完整 AWS 应用部署、MediaLive 开播、Sonnet 首次调用及 SageMaker GPU 运行仍不在已完成范围。
- 机器评测完整接口、跨截止渲染 / 替换成片口径、真实比赛画面的模型精度验收，继续按对应报告跟进。

## 下一步

- 队友拉取 `main` 后，从根 README 的 AWS 实测入口和接续总览进入；不要只凭早期交接里的“未推送”判断当前共享状态。
- 下一步工程工作可依据已确认的服务能力完成 S3、AgentCore、CPU 应用与 CloudFront 的最小完整链路；按正式接口和交付要求另行验收。

## 同步状态

- 六组主题提交已直接推送 `main`，未创建分支或 PR。推送后 HEAD、origin/main 和 `git ls-remote origin refs/heads/main` 均为 `0336ac965bcdb7d6fb7f4631ec8ef0d0759c1198`。
- 本交接、根入口、团队状态、接续总览和早间合作者审阅作为最后一条协作提交同步。最终提交 SHA 可从本文件 Git 历史取得；最终远端核对结果在本次完成消息报告。
- 历史交接中的“未提交 / 未推送”保留其采集时点事实；本次分类发布覆盖表中全部文件。临时私有证据与本机依赖仍留忽略目录。
