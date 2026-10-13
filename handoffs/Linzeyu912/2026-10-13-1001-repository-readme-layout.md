# 交接：主仓库导览与产品 README 分工

- 日期 / 时区：2026-10-13 10:01 起，Asia/Singapore（UTC+8）。
- 成员：Linzeyu912。
- 任务 / Issue：用户要求重新检查持续开发的主仓库，明确调研、数据、决定与产品目录的关系；根 README 介绍仓库，产品 README 介绍产品。本轮读取 GitHub 未发现开放 Issue。
- 分支：main。
- 提交：本记录随本轮文档整理提交；具体哈希见本文件的 Git 历史。
- 状态：已完成文档整理与提交前验证。

## 本次完成

- [根 README](../../README.md)改为仓库导览，包含分类表、目录关系图、产品内部结构和维护约定。
- [engineering/README.md](../../engineering/README.md)作为独立产品介绍，保留完整的 Single 最终成片入口、产品概览、架构、五步制作流程及实现导航。
- 新增[数据总览](../../data/README.md)与[决策和协作文档入口](../../docs/README.md)，区分运行输入、2K 参考数据、选定输出、团队决定、状态和任务交接。
- 三份产品文档从根 `docs/` 迁入 `engineering/docs/`：`local-setup.md`、`cloud-setup.md`、`aws-live-deployment.md`；同步所有 Markdown 入口，安装说明按现有默认配置更正为 Qwen Audio。
- 更新[目录规范](../../docs/repository-map.md)、[迁移清单](../../docs/repository-migrations/2026-10-13-readme-layout.json)、[决定 D017](../../docs/decisions.md)、[团队状态](../../docs/status.md)和 [AGENTS.md](../../AGENTS.md)。修正本机环境、比赛名单入口中的过时样例说明。
- 为[工程文档](../../engineering/docs/README.md)和[历史成果索引](../../docs/work-index.md)补充当前导航，明确历史验收与部署状态的时间边界；连同状态文档，共 23 处已移除或改写的样例/流程入口改为已核对的 Git 历史版本。

## 结论与依据

- 主仓库是 `Linzeyu912/courtstory`，产品目录为 `engineering/`。起始 main 与 origin/main 均为 `52d6a02240fc05f37ae4d1a961ec70055207892a`，工作区干净；任务开始已 fetch 并确认可快进同步。
- 分类依据为实际跟踪文件及读取关系：工作台服务、身份查询与部署打包代码使用 `data/`、`2K Player Data/` 和 `deliverables/` 的现有路径。因此保留代码与数据位置，通过索引说明关系；物理迁移仅限三份产品说明文档。
- 当前数据索引仅包含 Single 考试输入，最终展示 MP4 单独位于 `deliverables/`。输入约 21.97 秒，最终成片约 68.3 秒；目录入口已明确区分。
- 历史链接使用 Team Hub 基线 `56e6466057c0560701d3163d2dbd1384e59249d2` 中实际存在的文件，保留旧记录内容，不为修复导航重新引入媒体或旧流程。
- 来源：2026-10-13 本地主仓库文件、Git 状态与远端核对，以及用户本轮明确要求。比赛快照仓库未修改；本轮没有新增模型推理、媒体生成或云部署。

## 验证

- 独立复核：根 README、产品 README 与目录规范的 163 个相对链接、5 个本页锚点全部有效；产品介绍完整保留，仓库与产品说明分工符合本轮要求。
- 本轮 24 份 Markdown 中 842 个相对链接、23 个 Markdown 锚点全部通过；23 个历史链接均通过 Git 对象与对应锚点核对。迁移 JSON 可正常解析。
- `python scripts/validate_video_data.py --check-index` 通过：1 个数据集、1 条输入、85,310,217 字节及 1 个暂存区 LFS 指针；本次没有改动视频或元数据。
- `git diff --check` 通过；变更范围仅 Markdown 和迁移 JSON。作者与提交者均为 `ZeYu.Lin <Linzeyu912@gmail.com>`。文档调整未运行产品功能测试、付费模型或新部署。

## 阻塞与待确认

无。旧部署记录按原日期保留，本次未重新验证在线服务或播放浏览器中的视频。

## 下一步

后续产品介绍更新 `engineering/README.md`，仓库分类更新根 README 和目录规范；新研究、数据与决定分别进入对应入口。

## 同步状态

本轮只修改主仓库文档，直接在 `main` 选择性提交和推送。同步起点已核对为上述 `52d6a02`；本记录随整理提交，具体哈希见 Git 历史。提交后的身份检查、推送与最终远端 HEAD 核对结果在本轮完成回复中报告。
