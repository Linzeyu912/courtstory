# 交接：赛事资料与工程分目录、分类提交共享

- 日期 / 时区：2026-10-02 11:09，Asia/Shanghai；六类提交与独立远端下载核对于 11:26 完成，收尾记录单独提交。
- 成员：Linzeyu912。
- 任务 / Issue：本聊天用户明确授权整理全部改动、按类别 commit 推送 main，并把赛事要求与工程软件分开。开工开放 Issue 列表为空，未创建 Issue 或分配负责人。
- 分支：main。
- 提交：开工基线 `1c09caeed4d52f12a3b0d97b82c1c6cf5b2cfddb`；六类归档提交截至 `67179b8e465fd8b4f2dcdd8fd80aa150ca15c2ca`，详见同步状态。
- 状态：目录重整、本机验证、六类提交推送和独立 LFS 下载核验完成；此收尾验证记录另作文档提交。

## 本次完成

- `requirements/`：集中最新培训整理、旧官网 / 报名资料、NBA 指标参考与两版历史手册；官方快照和手册原字节保留。手册生成器归入 `scripts/requirements/`，修复源文路径，不重新生成 Word。
- `engineering/`：集中工作台前端、Python 服务 / 视觉脚本、产品设计、技术评估及测量。同步前几轮本机积累的直播筛选、多区间裁剪、身份向后生效、框 / 脚点编辑、轨迹补全、2D 球场及校准。
- `data/videos/tactics/acceptance/`：共享 004–006 三个普通转播成片、标签、来源和候选；原始球权未完整取得，不标完整球权，不把模型候选当人工真实十人身份。
- `data/reference/nba2k/drafts/`：原有来源复核辅助 XLSX 单独归档，不修改正式球员数据包或既有评分。
- 更新 README、Agent 目录约定、目录说明、状态和 D008；当前命令 / 默认路径改为新目录，历史交接仅修复链接，保留历史正文与“未推送”的当时状态。
- 修改前的可共享增量与迁移清单备份到本机忽略目录 `artifacts/repository-organize-20261002/`。原有本机缓存、模型、依赖、个人材料、来源原片和 QA 文件继续排除。

## 结论与依据

- 用户本轮明确授权同步此前所有积累成果，更新此前暂不发布开发增量的范围；已完成的目录归档不等于完整产品、模型准确率或云部署完成。
- 来源与采集日期：2026-10-02，本机仓库状态、用户本轮要求、既有交接和数据清单；仓库 URL：https://github.com/Linzeyu912/broadcastcode-team-hub 。本轮不重新采集或解释外部规则。
- 分类与迁移表见[仓库目录](../../docs/repository-map.md)；软件运行见[工程入口](../../engineering/README.md)，赛事资料见[要求索引](../../requirements/README.md)。

## 验证

- 搬迁后 46 项 JavaScript、6 项 Python 回归及 React bundle 构建通过；20 个 Python 源文件 AST 检查通过。54 个受保护的原始快照 / 视频 / 手册 / 辅助表字节保持，203 个 JSON 可解析；六类提交后的 609 个相对链接核查无缺失，暂存改动通过 `git diff --cached --check`。
- 软件和资料只在相应类别暂存。视频提交前执行 `python scripts/validate_video_data.py --metadata-only --check-index`：5 组、142 条登记、142 个暂存 LFS 指针通过；旧库部分文件在本机为指针，本轮没有重新下载解码全部旧视频。新三段实际字节 / SHA-256 / 全片解码 / 候选时间序列独立通过，共 23,949,185 字节，分别 210 / 143 / 462 帧，无音轨。
- XLSX ZIP / XML 可读、八张工作表及无 VBA 检查通过；没有重新验收候选评分、公式或排版。
- 搬迁后的本机 HTTP 服务启动和 `/api/library` 200 通过。独立浏览器 QA 验证：P1 前 70 帧保持、P4 错配重叠区释放且后续正确确认保留、身份 / 位置分离、撤销 / 删除 / 刷新、旧草稿原样备份、2D 与 720px 页面，以及实际两区间裁切 100 帧、切口 50、来源帧 49→100；无浏览器错误，QA 导出停用。
- 推送上传 3/3 新 LFS 对象成功；以独立空 LFS storage 从 origin/main 重新下载验收成片，三段大小与 SHA-256 全部一致，共 23,949,185 字节，远端 Git 指针中的 SHA / size 与清单一致。没有用已有本地对象冒充远端下载。

## 阻塞与待确认

- 无目录或实现阻塞；模型身份、旧草稿推断分界、米制坐标和完整 Agent 流程仍按原实验边界待验收。
- 清理旧本机空研究目录的工具调用被自动策略拒绝，因此保留空目录；Git 不记录空目录，不影响远端目录分离。

## 下一步

- 其他机器拉取 main，按 `engineering/README.md` 下载 LFS 验收样例并启动工作台；不要依赖本机忽略目录的模型 / 缓存。
- 真实使用时继续逐段核对身份与场地；赛事要求变更写入 `requirements/`，工程变化写入 `engineering/`。

## 同步状态

- 开工 fetch 成功，HEAD 与 origin/main 为上述基线；六类提交后工作区干净，`git pull --rebase origin main` 无新增远端改动，普通推送 main 成功。不创建分支 / PR、不 force push。

| 分类 | 提交 |
|---|---|
| 赛事要求与历史来源 | [5f63730](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/5f63730b501dcf37ce68a41d39f6015a2669c9d8) |
| 工程设计、视觉实验和测量 | [e1d2b1a](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/e1d2b1add205290835292e3ff6827c47bb7bbc19) |
| 复核软件与身份向后生效 | [486e8b9](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/486e8b99c07c7b76212799b8e81de1bd4f6f8032) |
| 验收视频、候选和 LFS 校验 | [4149d58](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/4149d58415662a7a3479ebb9ff6fe37098b2e17d) |
| 评分来源复核辅助表 | [bf77bf8](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/bf77bf868bb5d9de632aec88a4ea8a98b865cfd7) |
| 目录约定、运行入口和协作状态 | [67179b8](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/67179b8e465fd8b4f2dcdd8fd80aa150ca15c2ca) |

- 推送后再次 fetch：HEAD 与 origin/main 同为 `67179b8e465fd8b4f2dcdd8fd80aa150ca15c2ca`，工作区干净。独立下载核验报告保存在本机忽略目录，主要结果已在本交接公开；此验证记录另用收尾文档提交保存，最终提交可由文件历史查看。
