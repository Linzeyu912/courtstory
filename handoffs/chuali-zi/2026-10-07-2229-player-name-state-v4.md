# 交接：姓名身份消费层与有限机器关联 v4

- 日期 / 时区：2026-10-07 22:29，America/New_York（UTC-04:00）
- 成员：chuali-zi
- 任务 / Issue：本聊天用户授权 GPT-6.1 Sol 子 agent 深入优化多人姓名与持续回放；具体范围由当前主 agent 协调，未创建或修改 Issue。
- 分支：main
- 提交：未提交／未推送。
- 状态：消费层、有限机器关联与定向测试完成；真实 v4 模型回放由主 agent 调用后接续核验。

## 本次完成

- `engineering/tools/player-review/player-name-identity.mjs` 保留清晰的局部姓名证据；其他段异常不再屏蔽整名球员。真正同帧的姓名／T／P 冲突只移除交叠帧，清晰两端保留。
- 新增来源绑定的 `machinePlayerProfile` 摘要和 `machineIdentityBindings` 有限关联。唯一姓名可作为机器已接受候选；多个姓名仍标 profile ambiguous，profile 本身不授权跨区间传播。
- `identity-timeline.mjs` 和 `trajectory.mjs` 使用完整视频／跟踪版本读取有限关联，仅取代旧 `origin: ai_visual_reference` 和模型回退。真正人工选人、区间、位置与有效逐帧确认优先；修正后的 T 仅在确切区间释放另一 P 的旧机器占用。
- 跨 T 姓名续接要求 producer 的真实 reference／target evidence IDs，且参照必须具有直接姓名证据。机器字段维持 `identityVerified: false`；姓名可靠性 `nameStatus` 与当前位置关联 `positionBindingStatus` 分开。
- 有限视觉证据可解除旧球队生命周期的 `identity_review_required` 显示阻挡；保留原始风险诊断，不解除真实裁判声明、角色冲突、重复框或人工角色排除。
- 姓名 UI 改为每人证据覆盖摘要；研究 full-tracking 脚本支持独立输入／输出目录，写每人的姓名／位置／续接覆盖，并删除重复框顶 P/T 文字。脚底标签布局由主 agent 另行修改。
- `court-preparation.mjs` 的几何依赖增加机器身份关联；姓名文字／profile 本身不使 2D 几何缓存失效。新增 `coverage-plot.py` 从实际覆盖 JSON 生成每人覆盖条形图，明确不是准确率。

## 结论与依据

- 2026-10-07 真实 v3 本地 `job.json`：P2 的 T6 前后分别读 10 与 7，P10 的旧 8 不在比赛名单。原消费层把 P2／P10 整体屏蔽，属于消费规则造成的覆盖损失；规则修复不等于原始 P/T 串人已修复。
- 主 agent 的 `artifacts/player-name-optimization-20261007/diagnosis/anchor-candidates.json` 为 AI 原图诊断参照，非人类真值。P2/P5、P1/P6、P6/P8、P7/P9 的可疑窗口只用于后续模型取证。
- 新 producer 的有限 name candidates 包含 `evidenceMethod`、`bindingCorrection`、`originalEntityId`、`continuity`；显式修正优先于同段旧机器姓名提案，普通冲突仍保持未知。
- 当前变化只在本地；没有重写原视频／原始跟踪框／正式草稿，没有提交、推送或云部署。

## 验证

- 姓名、客户端与真实 Python producer 到 JavaScript consumer 定向测试通过。新增测试覆盖局部冲突保留、有限 T 互换、跨 T anchor IDs、来源失效、明确人工资料优先、同帧重复身份、未命名人工 T 占用和后续机器任务不覆盖有效人工逐帧确认。
- 66 项既有 identity timeline、trajectory、role guard、track occurrence、continuation 检查通过；后续姓名和逐帧审核 33 项通过。实际完整调用命令与最终计数由主 agent 汇总。
- 保存同一真实 v3 的新消费基线至 `artifacts/player-name-optimization-20261007/v3-consumer-baseline/`，原 v3 目录不覆盖：10 条局部姓名记录、7 个名字，P2 profile 仍 ambiguous，旧 v3 没有升级为 machine accepted。覆盖数不是准确率。
- 实际首次 P1/P4 v4 job 经消费层读取：两次视觉调用都失败／超时，姓名覆盖仍为零；输出隔离在 `v4-first-two-consumer/`，未把调用失败解释成消费规则失败。其余八人的位置为空来自此探针主动去掉关联，不能解释为正式十人跟踪失败。
- 几何缓存与姓名测试 21 项通过；v3 基线的覆盖 PNG 实际生成并目检，修正了图脚注与坐标轴文字交叠。
- 统一整合检查 106 项通过；包含姓名实际 Python producer 到 JS consumer、client、timeline／trajectory／role guard／continuation／逐帧审核与 2D cache。后续来源缺失与跨视频人工姓名保护的19项定向检查通过。
- 关闭系统代理后的真实 P1/P4 三次调用成功两次；P4 Alperen Sengun 应用后 1077/1225 有位置帧（87.9%姓名覆盖，1077 machine accepted、四帧视觉续接），P1 调用失败保持未知。独立 consumer 和覆盖图在 `v4-first-two-direct-consumer/`。实际 draw_name_overlay 的源帧635／1048 PNG生成；1048目检白28脚底 P4 + 姓名正确，未知P1如实保留。
- Node 语法、Python 编译与 `git diff --check` 通过。机器身份新 lane 的完整前端／后端保存、逐帧确认兼容和真实 v4 回放由主 agent 继续整合验证。

## 阻塞与待确认

- 真实 v4 模型调用和全片回放仍在主 agent 执行；不能把本消费基线称为十人姓名已准确识别。
- 原图 AI 参照没有独立人类标注；切换边界、遮挡框与脚底接地点仍需逐窗口检查。

## 下一步

- 真实 job 写入 `artifacts/player-name-optimization-20261007/v4/` 后运行 `node research/vision/player-name-identity-20261007/full-tracking.mjs artifacts/player-name-optimization-20261007/v4 artifacts/player-name-optimization-20261007/full-tracking`。
- 运行 `python research/vision/player-name-identity-20261007/full-tracking.py --folder artifacts/player-name-optimization-20261007/full-tracking`，核对源 PTS／音轨以及 60、147、270、600、650、1048 帧等真实边界画面，并补实际结果。
- 运行 `python research/vision/player-name-identity-20261007/coverage-plot.py --folder artifacts/player-name-optimization-20261007/full-tracking` 生成实际覆盖图。
- 后端人物记录移动／逐帧确认 scope 的机器字段兼容由主 agent 负责，避免独立消费层与正式保存链路不同步。

## 同步状态

- 保留共享工作区此前全部改动；main 上本地修改，没有创建分支、PR、提交、推送或云资源。本轮远端／Issue 状态由主 agent 统一核对。
- 真实模型中间文件、基线快照和视频 QA 位于忽略 artifacts；本交接不包含 key、Cookie 或来源原片。

## 2026-10-08 接续核验（America/New_York）

- 主 agent 继续真实十人补测；消费层补齐 canonical `playerProfiles`、有限 `association_conflict` 释放、历史 derived machine claim 的有限替换和 source／target slot reference 溯源。可靠参照能建立已知姓名，即使当前位置没有证据；没有位置绑定时不在未知 T 上显示姓名。
- `app.mjs` 仅在姓名面板 `getState` 加 `trajectories`。采用后的 UI 分子／分母来自实际轨迹和 `nameIdentityAt`，不再拿原始候选区间当已采用位置。姓名相关、client、team label、实际 app harness 67 项通过；后续没有坐标／角色被阻挡的观测不得返回姓名，22 项姓名与真实 Python producer 合同检查通过。
- 实际 `v4-p1-direct-retry` 得到 Amen Thompson 1049/1134 有位置帧（92.5%）；所有 T32 观察没有 Amen 名字。F149 的左边缘标签生成并目检完整未裁字。原 v3 和真实 calls 保留。
- 原始全员 `v4` 曾在 P9/T10 的 600 后错误延续 Cooper 名字，已反馈并未编码为最终成片。主 agent 后续真实 P7/T10 corrected candidate 会在其支持区间裁掉旧普通 P9/T10 名字，不能把“固定 P 只有一个名字”当作同人判断已经正确。
- `v4-ten-names` 的十个 canonical profile 现在各有单一姓名，但位置覆盖仍另行核验，尤其 P5/P9。独立原图复核指出白队136–141与蓝队594–599为合框，需要有限未知而非强盖姓名；600–609蓝21姓名续接成立时位置仍可能受白17前景合框影响。
- 预最终 `v4-before-p9-consumer` 的 P1新增13个姓名帧实际来自 T26 149–192，不是263附近 T39；260–272仍是旧T32且姓名为空，273才显示 Amen/T39。P5 147–168位置／姓名为空源于合并最新长窗任务时丢掉此前已成功 T6 correction，而非消费层冲突规则。已反馈主 agent 按有限scope保留同source既有明确正证据，不能把新长窗未取证当作反证。
- 主 agent 要求边界／长窗任务期间不提前全片编码，以免本机取帧竞争。当前只有轻量原图、数据与定向代码核验；最终合并与完整回放仍由主 agent 确定输入后继续。
