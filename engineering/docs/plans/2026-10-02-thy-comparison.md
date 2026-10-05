# 本地版本与 THY 版本：隔离和比较方案

记录：2026-10-02 22:03 起，Asia/Shanghai。依据本聊天用户要求：先下载并分开放置，再读取、比较和决定取舍；用户随后再次明确“先不要合并，先对比一下他们有哪些区别”。本轮仅做隔离和比较。

## 1. 目录与版本

以下目录以当前仓库的父目录为参照；同事在其他机器上可以使用自己的父目录。

| 位置 | 用途 | 当前状态 |
|---|---|---|
| `HKS/`（现有目录） | 用户当前工作台及原本机依赖、缓存 | 保留在 `codex/local-workbench-20261002`，固定比较版本 `fffb6ea` |
| `HKS-thy-20261002/`（同级新目录） | 查看 THY 已发布版本的原貌 | 已建立 Git worktree，固定在 `1839dcd`，detached HEAD |
| `HKS-integration/`（建议名称） | 后续按选定功能整合、测试 | 尚未创建；等取舍明确后再准备 |

Git worktree 是同一仓库的独立文件目录，两边共享 Git 历史，但源文件和暂存区独立。THY 目录固定在具体提交，远端以后更新时不会自动改变这份比较样本。不要在参考目录里直接拉取或修改源码。

共同基线是 `72c74e041fd673de81488ebdf48cb97d39427bda`。比较必须分别看“基线 → 用户版”和“基线 → THY 版”，才能分清每边做了什么。

| 版本 | 完整提交 | 来源 |
|---|---|---|
| 用户版 | `fffb6ea7513b161dba0d0959ee4b822ae0469cf0` | [已推送工作分支](https://github.com/Linzeyu912/broadcastcode-team-hub/tree/codex/local-workbench-20261002) |
| THY 版 | `1839dcde5b5cc0aa362baa474e58e5b530e6c695` | [远端 main 固定提交](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/1839dcde5b5cc0aa362baa474e58e5b530e6c695) |

远端相对共同基线有两次 THY 提交：`351292f` 为功能 / 数据，`1839dcd` 为发布记录。当前 GitHub 全部状态 Issue 列表为空，范围按用户指令和这些提交核对。

## 2. 两边的主要内容

| 用户版 | THY 版 |
|---|---|
| 左侧导航、步骤面板、底部数据抽屉 | 默认简版标注、固定显示编号 1–10、高级工具入口 |
| 固定 P1–P5 红队、P6–P10 蓝队，拖动交换、攻防角色 | 人物分队 A/B、队色与脚下编号、显示稳定化 |
| 区间取消、整段清空，阻止旧点及插值补回 | 模型建议编号绑定、未匹配灰框，仍需人工确认 |
| 视频 Canvas 呈现、黑屏恢复和结束重播 | 视频实际呈现帧同步、模型与显示数据分离 |
| 篮筐方向约束的球场初始化后端 | 姓名 / 球队 / 号码人工确认、13 项 2K 原值与来源 |
| 球场初始化、未解决帧和二次裁切追溯 | 多检测版本、模型来源追溯、22 份共享候选 / metadata |

这些是代码与既有交接的初步核对，不代表两套功能可以直接兼容，也不把候选编号当作已锁定真人。两侧各自历史测试通过，不能代替未来整合测试。

### 共同已有的能力

两边都继承共同基线中的视频筛选与裁切、固定 P 身份与人工修正、原图 / 2D 球场、E-BARD / ByteTrack 候选、RTMPose-s 脚部候选、具名地面点标定和 SIFT / LK 镜头跟随。这些不能全部算成某一边独有的新功能。

仓库的 `2K Player Data` 数据包也是两边共有；THY 这次新增的是按赛季 / 球队 / 球衣号码查询、人工确认真人资料，以及工作台中的能力卡和导出字段，没有新采一份 2K 数据库。用户版原有姓名 / 球队 / 号码文本编辑继续存在，但没有这套查询和能力卡。

### 跟踪和显示的具体差别

- 用户版默认仍是三个样例的 E-BARD / ByteTrack 预计算结果，可切换通用 YOLOv8s / ByteTrack；本次晚间更新集中在人工取消、清空、交换、界面和球场初始化。
- THY 在已有 E-BARD 篮球检测模型基础上增加 BoT-SORT / ReID 对照、低分观测续接配置、完整框修正、重复框处理和分队复核标记。样例库增加 LAL–MIN 可选片段，四样例共 17 个版本可读取共享预计算候选，优先 `team-stable`。
- THY 的“稳定显示”处理展示用的框，轨迹导出和球场投影继续使用原始 / 人工坐标；看起来平滑不能当作真实轨迹精度提升。
- THY 的冻结实测记录记载四段 optimized 接受的自动片段连接均为 **0**，仍有跨队串号与待人工归并的片段；因此只能确认增加了候选与复核机制，不能据此说已经解决断轨或整体更准确。该数字来自其历史实测，本轮未重跑模型。
- 本轮另读取这四份 `optimized.meta.json`，均有 `identity_verified: false`、建议 `verified: false`、连接 `links: []`；三版本 `2K Player Data` 的 Git tree 哈希也完全一致，均为 `df0b130faf712852801026fa122655c1221490c3`。
- 用户版新增的是依靠篮筐方向约束初始化球场的后端接口；前端新按钮接线仍未完成。THY 保留共同基线的人工 / 候选标定与镜头传播，本次没有用户版的这套新初始化接口。

以上跟踪结论对应 THY 固定提交中的 `research/vision/player-tracking-workbench-20261002.md`、`engineering/tools/player-review/README.md` 及新增脚本。两边均未新增球衣号码 OCR 或全自动准确恢复整段十人轨迹的验收结果。

## 3. 改动规模和重叠位置

相对共同基线，用户版改动 **39** 个文件，THY 版改动 **92** 个文件；用户独有改动 **26** 个，THY 独有改动 **79** 个，双方都修改 **13** 个。这里“双方都修改”不是 Git 冲突检测结果；本轮没有执行合并。

| 双方修改的文件 | 后续重点 |
|---|---|
| `engineering/scripts/serve_player_review.py` | 用户版标定 / 编辑 POST 接口，与 THY 身份 GET 接口、静态模块、数据校验共同保留和核对 |
| `engineering/scripts/review_video_trim.py` | 多模型 / 身份建议裁切与球场初始化 / 未解决帧裁切的组合 |
| `engineering/tools/player-review/identity-timeline.mjs` | 人工确认、取消和模型建议的优先级 |
| `engineering/tools/player-review/trajectory.mjs` | 人物资料、队伍字段、草稿迁移和导出 |
| `engineering/tools/player-review/trajectory.test.mjs` | 把两侧行为要求纳入组合测试 |
| `engineering/tools/player-review/app.mjs` | 操作、撤销、帧同步与草稿保存 |
| `engineering/tools/player-review/identity-ui.jsx` | 人物编辑和 2K 资料的交互入口 |
| `engineering/tools/player-review/index.html` | 简版 / 步骤 / 抽屉的页面结构 |
| `engineering/tools/player-review/pipeline.css` | 队色和布局 |
| `engineering/tools/player-review/workspace.mjs` | 工作区、球场和身份状态联动 |
| `engineering/tools/player-review/ui.bundle.mjs` | 源码确定后重新构建，不手工拼压缩产物 |
| `engineering/tools/player-review/README.md` | 按实际采用的功能重写使用说明 |
| `docs/status.md` | 保留两侧事实，更新最终集成状态 |

只有一边新增的文件也可能依赖共同修改的入口，不能因没有文本冲突就直接判定可独立采用。

本机完整文件清单保存在仓库相对路径 `artifacts/thy-comparison-20261002/comparison.json`，属于忽略的本地辅助产物；本页固定 SHA 足以在其他机器重新生成差异。

## 4. 先讨论的取舍

所有项目目前均为“待比较、待决定”，不是已经批准采用。

| 比较组 | 要决定什么 | 组合风险或依赖 |
|---|---|---|
| 界面 | 以当前抽屉工作台还是 THY 简版为默认；另一套能力放在哪 | 先分别看原貌，再确定交互，避免两套入口互相覆盖 |
| 人物与队伍 | 固定红蓝槽位和独立 A/B 分组如何对应，未知队伍如何表示 | 影响模型建议、人工分队、交换、攻守和颜色 |
| 取消 / 清空 / 撤销 | 取消是否覆盖模型建议；清空时哪些资料应保留 | 本地清空列表不含 THY 的 `modelBindings`，直接拼接可能出现清空后候选又回来的情况；这是源码推断，尚未组合实测 |
| 姓名与 2K | 是否采用查询和 13 项能力面板；资料何时算确认 | `playerProfile`、`ratingReference` 应随真人交换，不能把资料确认当轨迹确认；号码 `0` / `00`、缺值和赛季来源要保留 |
| 跟踪与数据 | 采用哪些预计算版本，哪个作为默认 | 核对 `review-library.json`、metadata / 原始检测指纹和旧草稿，避免格式化候选 JSON 改变哈希 |
| 球场与裁切 | 组合保留标定初始化、多版本候选、脚点及二次裁切来源 | 需验证“多版本 + 球场初始化 + 脚点候选 + 二次裁切”整条流程 |
| 视频与显示 | 组合 Canvas 恢复、实际呈现帧同步与平滑展示 | 视频、叠加框和编辑使用的原坐标必须对应同一帧 |

后续顺序：查看两份原貌 → 明确每组采用 / 部分采用 / 暂缓及理由 → 在第三目录实施 → 按组合流程验证 → 再决定提交到哪里。

建议组合验收包括：自动编号 → 人工确认身份 → 跨队交换 → 取消 / 清空 → 撤销 → 刷新 → 导出，以及裁切后的标定 / 脚点复核。测试数量不预先当作完成标准。

## 5. 后续运行时的隔离

- 两份工作台使用不同端口或独立浏览器配置，避免相同视频 / 检测指纹共用同一 origin 下的 localStorage 草稿。默认都用 `8876` 会产生混淆；启动 THY 版时另选空闲端口，并先用 QA 草稿。
- 新目录不复制用户正式浏览器草稿、`artifacts/`、模型权重、依赖目录和登录配置。后续若需要看画面，再准备该目录的 LFS 成片和必要依赖。
- 本轮检出跳过 LFS 自动下载；新目录视频目前保留指针。源码、普通 Git 数据和 22 份共享候选已取得，因此可以完整阅读代码和资料，但尚未证明可直接启动播放。
- 查看预计算结果不必重跑模型；重跑跟踪才涉及模型权重 / CUDA 等环境。THY 历史本机模型和 FFmpeg 路径不能直接当作此机器的可用路径。

## 6. 本轮已验证与边界

- 已执行 `git fetch origin`，仅更新远端跟踪引用，未对当前分支执行 pull、merge、rebase 或 cherry-pick。
- THY 目录 HEAD 为 `1839dcd`；用户目录 HEAD 仍为 `fffb6ea`。创建后两边已跟踪文件均干净；本轮随后只在用户目录新增此方案和交接记录。
- THY 共享目录的 22 份候选 / metadata 共 **19,683,694** 字节，与其 README 公布的 SHA256 逐项一致。
- THY 目录运行 `python scripts/validate_video_data.py --metadata-only --check-index` 通过：5 个数据集、142 条记录、142 个 LFS 指针。没有声称完成视频字节验证。
- 未启动第二套工作台、未修改正式草稿、未运行模型、未执行功能整合或发布。本页及本轮交接仅保存在本地，未提交推送。

## 来源

- [THY 发布交接](https://github.com/Linzeyu912/broadcastcode-team-hub/blob/1839dcde5b5cc0aa362baa474e58e5b530e6c695/handoffs/thy-0629/2026-10-02-2027-workbench-identity-publish.md)：2026-10-02 本轮从 Git 对象读取，并核对源码。
- [用户版同步交接](../../../handoffs/Linzeyu912/2026-10-02-2144-local-workbench-branch-push.md)：用户版基线与已完成验证。
- [本轮隔离交接](../../../handoffs/Linzeyu912/2026-10-02-2203-thy-isolated-comparison.md)：目录准备与检查记录。
