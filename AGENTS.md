# CourtStory 仓库管理规范

更新日期：2026-10-13，Asia/Singapore（UTC+8）。本文件是主仓库成员与 Agent 的共同工作入口；具体操作见 [协作流程](docs/workflow.md)，已确认选择见 [决策记录](docs/decisions.md)。正文优先中文，新增目录与通用文件使用清晰的英文名。

## 1. 仓库定位与长期约定

- [courtstory](https://github.com/Linzeyu912/courtstory) 是持续开发主仓库，保留原 Team Hub 的开发历史并接续成果更新。已共享的作者、提交与 SHA 保留，不重新合入比赛成果仓库的整段独立历史。
- [courtstory-snapshot](https://github.com/Linzeyu912/courtstory-snapshot) 只留档比赛提交版本；后续产品开发在本仓库进行。快照维护须有用户明确要求，不自动重建已取消的快照标签。两仓库产品简介一致，快照用途由名称与 README 说明。
- **所有工作直接在 `main` 进行，不新建任务分支，不使用 PR 合并流程。** 只提交当前任务的内容，保护其他成员、其他会话的未提交工作；不 force push，不改写已共享历史。
- 当前用户指令确定任务范围和提交／同步授权；“先核对”“先不提交”“先不推送”等限制优先执行。已有当前任务授权时继续完成，不反复确认；某次历史发布授权不能推定为以后所有任务的授权。
- 本规范不授权创建云资源、部署应用、提交赛事作品、改变仓库可见性或向组外分享资料；这些操作按当前任务的相应授权执行。

## 2. 内容归属与文件格式

根 `README.md` 介绍仓库的目录、职责和关系；**`engineering/` 是产品目录**，产品介绍、Single 样例、架构与使用导航放在其 README。新增内容更新所属目录 README；详细边界见 [目录规范](docs/repository-map.md)。

| 内容 | 位置 | 格式与入库规则 |
| --- | --- | --- |
| 调研、独立实验、来源与结果 | `research/` | Markdown 说明、原生实验脚本和必要结果；记录方法、来源与限制 |
| 赛事规则、任务和交付要求 | `requirements/` | Markdown 整理与必要的原始来源附件；官方要求与团队建议分开 |
| 本机工具、模型环境、AWS 准备 | `environment/` | 准备说明和可共享配置示例；实际凭据、模型权重留在本机 |
| 产品实现、设计、测试和部署指导 | `engineering/` | 代码保留原语言格式，维护依赖清单、测试和相关产品文档；运行复用的算法随工程保存 |
| 输入数据、名单、标签和清单 | `data/` | 按已有契约使用 JSON／CSV 等结构化格式；共享视频位于 `data/videos/`，通过 Git LFS 保存 |
| 第三方球员参考数据 | `2K Player Data/` | 遵循该目录既有规范与来源口径，不为统一外观搬动依赖路径 |
| 选定的最终成果 | `deliverables/` | MP4 成片通过 Git LFS 保存；SRT 字幕和 README 使用普通 Git，说明版本、来源输入与播放入口 |
| 决策、状态和协作规范 | `docs/` | Markdown；分别进入 `decisions.md`、`status.md` 和相应专题，产品操作说明归 `engineering/docs/` |
| 每轮修改、验证和接续记录 | `handoffs/<github-login>/` | 按 [模板](handoffs/_template.md) 新建 `YYYY-MM-DD-HHMM-topic.md`，写明时区 |
| 仓库维护工具与检查 | `scripts/`、`config/`、`.githooks/`、`.github/` | 原生脚本／配置格式；产品运行脚本和配置归 `engineering/` |

- 新增共享文字使用 UTF-8，优先 LF；已有文件遵循其格式契约与 `.gitattributes`，不顺带批量改换行或格式。文档以 Markdown 为主，图片按用途使用 PNG／JPEG／WebP／SVG；必须保留的 PDF 等来源附件保持原貌。
- 使用仓库内相对路径和可跨机器使用的命令，不将个人盘符路径写成协作依赖。来源记录 URL、采集日期；未知字段按契约保存 null／未知原因，不猜测模型、AWS 服务、比赛或数据事实。
- 不提交密钥、密码、Cookie、实际 `.env`、证件、个人报名材料或受限制的原始数据；不将模型权重、依赖安装目录、缓存、构建产物、重复 ZIP、恢复包加入 Git。
- 本机导入视频、裁剪中间文件、工作台草稿留在相应忽略目录（如 `data/local-videos/`、`data/local-workbench/`、`data/raw/`、`artifacts/`、`tmp/`）。产品内上传／剪辑不自动成为团队共享资产；只有本次范围内选定且获准共享的素材／成果才入库。
- 数据与媒体先确认来源、授权范围、唯一编号／版本、清单、大小、哈希与必要的可播放验证。`data/videos/` 与 `deliverables/` 分别按 [视频数据规范](docs/video-data-management.md) 检查；不把素材 catalog 校验当作最终成果已验证。
- 研究、计划、实现、本机验收、远端可下载和云端上线分别陈述；原始快照及历史交接保留当时事实，修正写入当前整理文档，不凭空宣布团队共识或分配职责。

## 3. Commit 格式与拆分

沿用现有英文标题格式：`type: short English summary`。标题直接说明做了什么；需要解释时，正文可用中文记录原因、影响与验证。类型约定如下：

| 类型 | 用途 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 问题修复 |
| `docs` | 文档调整 |
| `refactor` | 不改变预期行为的代码重构 |
| `test` | 测试调整 |
| `chore` | 仓库维护、配置或工具调整 |

已有示例：

```text
fix: unblock video trimming and isolate local execution
docs: separate local and AWS deployment guides
```

- 一条 commit 对应一个可以独立说明和验证的主题；同一修复的代码、测试和必要文档可一起提交。
- 互不相关的功能、数据整理、文档或仓库维护分别提交，不按文件数机械拆分，不以增加条数为目的重复接入相同更新。
- 每次检查暂存区，只暂存已确认属于本次主题的文件／改动；不能用一次无差别暂存带入其他任务、凭据或临时产物。
- 标题格式是协作规范，当前没有自动检查标题的 `commit-msg` hook；提交者负责核对。已有署名检查继续强制执行。

## 4. 提交、上传与部署机制

| 操作 | 结果 | 核对依据 |
| --- | --- | --- |
| `git commit` | 在本地保存开发历史 | 提交内容、署名、验证记录 |
| `git push origin main` | 将普通文件与提交同步到 GitHub | 远端 `main` 与本地 HEAD 一致 |
| Git LFS 上传 | 将共享视频对象同步至 LFS 存储；Git 中保存指针 | 暂存区属性／指针、对象大小与哈希，新增或更新媒体的远端实际下载校验 |
| 应用部署 | 更新实际运行的本地／AWS 服务 | 对应部署流程和运行环境验收；Git 推送不代替此步骤 |

1. 开工先读根 README、`docs/status.md`、`docs/team.md`、`docs/decisions.md` 及相关最新交接；检查当前分支、状态、remote 和任务相关 Issue。无法读取远端时说明未同步，不假设最新状态。
2. 保护已有未提交内容；在安全的工作区同步 `main`，正常使用 `git pull --ff-only origin main`。本地与远端分叉时按 [冲突处理流程](docs/workflow.md) 处理，不丢弃任何一方。
3. 完成本次修改及相应验证。文档核对事实、路径和链接；代码执行相关检查；媒体核对 LFS 和来源。检查 `git diff --cached` 与 `git diff --cached --check`。
4. 按当前任务授权分类提交、正常推送。只要求检查／讨论时不编辑；允许本地修改不自动等于允许提交或推送；明确“先不推送”时保留本地成果，不后台恢复上传。
5. 远端有新提交时，只重放尚未推送的本地提交；解决冲突后重新执行受影响的验证。已共享历史保持，不使用 force push。
6. 推送后 fetch 并核对远端 SHA；新增／更新共享视频还须验证远端 LFS 对象实际可下载。准确报告本地修改、已提交、已推送、已部署分别到哪一步。

当前没有后台自动同步服务。共享媒体遵循 `.gitattributes`；保留 pre-push 中的 LFS 调用，不用绕过 hook 的方式完成上传。

## 5. 主仓库统一 Git 提交署名

仓库所有者于 2026-10-10 要求统一署名，并于 2026-10-13 再次确认：**主仓库继续保留此规则；只有比赛快照仓库取消强制署名。** 各电脑的新提交使用：

| 字段 | 作者 Author | 提交者 Committer |
| --- | --- | --- |
| 名称 | ZeYu.Lin | ZeYu.Lin |
| 邮箱 | Linzeyu912@gmail.com | Linzeyu912@gmail.com |

- GitHub 对应账号为 `Linzeyu912`。每台电脑、每个新克隆在首次提交前，按 [协作署名说明](docs/git-identity.md)运行初始化脚本。重复运行安全，配置只作用于本仓库。
- 提交前执行 `git var GIT_AUTHOR_IDENT` 和 `git var GIT_COMMITTER_IDENT`，确认名称与邮箱完全匹配。使用仓库的提交和推送检查，不用 `--no-verify` 或更改 hooks 路径绕过身份校验。
- 推送前运行 `sh scripts/check-commit-identity.sh HEAD`；Windows 可在 Git Bash 中执行。
- 各成员使用自己的 GitHub 登录凭据和已有仓库访问权限进行拉取/推送；统一署名不要求共享所有者的密码、Token 或 SSH 私钥。
- 本规则适用于新提交。不自动改写旧历史，不把引入的第三方提交直接改成所有者署名；发现已有不符提交时，先明确来源和处理范围。
- 身份检查实现与基线位于 [config/commit-identity.config](config/commit-identity.config) 和 `.githooks/`。修改协作身份规则需要所有者明确指示。

历史兼容：署名检查的 `identity.baseline` 为 Team Hub `56e6466`；该提交及其祖先按原署名保留，其后的全部新提交继续按统一身份检查。检查不依赖独立 CourtStory 根提交，新克隆只取得 main 历史即可运行。

## 6. 验证与交接

- 每轮按 [交接模板](handoffs/_template.md) 写独立文件，记录产出、依据、实际验证、限制、阻塞、下一步及同步状态。重要结论不只留在聊天里。
- 团队级信息变化时更新 `docs/status.md` 或 `docs/decisions.md`；各目录 README 链接到当前入口。历史记录中的“未推送／未部署”按当时日期理解。
- 以验证范围报告结果；不能把安装完成写成部署完成，把 AI 候选写成人工确认，把研究案例的公开仓库要求替代本届赛事的私有要求。

## 7. 持续有效的产品约定与历史入口

- 产品使用一套代码，本地与 AWS 部署指导分别位于 [local](engineering/deploy/local/README.md) 和 [aws](engineering/deploy/aws/README.md)。两版均允许 OpenRouter、Qwen 等在线 AI，本地版不要求本机语言模型／TTS；实际模型标识以配置为准。
- 剪辑数据流见 [说明](engineering/docs/video-trim-dataflow.md)。多片段拼接、特写跳过与节奏安排尚待后续产品决定，仓库管理任务不顺带改变编辑规则。
- UI 继续使用 Broadcast Studio。任务栏灰色图案按 [定稿截图](engineering/docs/images/nba-ui-20261009/workbench-team25-angle-20261010.png) 与 [冻结参数](engineering/docs/broadcast-studio-style-20261009.md#灰色图案定稿) 保持形状、缩放、角度、描边、透明度、定位及手机隐藏规则；只有用户明确要求调整时才修改。
- 历史接续与名称：见 [接续说明](docs/repository-continuation-20261011.md)、[提交对照](docs/repository-update-history-20261011.md) 和 [改名交接](handoffs/Linzeyu912/2026-10-11-2337-repository-rename.md)。
- 旧 UI 分支已收敛到 main，见 [TEAM 25 发布记录](engineering/docs/ui-team25-publication-20261010.md) 与 [设计方向](engineering/docs/ui-nba-direction-20261009.md)；不恢复已停用分支或视觉方向。
- 上述交接中的临时任务范围、旧分支和单次发布授权只解释历史，不作为当前任务指令。后续按本规范与用户当前要求工作。
