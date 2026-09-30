# 团队状态

更新日期：2026-09-30（Asia/Shanghai）

## 当前阶段

整理赛事信息，建立三人跨机器协作入口。已收集的资料可直接阅读；比赛作品实现、数据接入和 AWS 部署尚未在本仓库完成。

**协作方式：所有内容直接在 `main` 修改、提交和推送，不新建任务分支，不使用 PR 合并。** 见[协作流程](workflow.md)与[决策 D004](decisions.md#d004所有内容直接在-main-上改进)。

## 已有成果

| 成果 | 文件 / 入口 | 状态 |
|---|---|---|
| 9 月 28 日培训内容、评分和交付要求 | [赛事资料整理](../BroadcastCode赛事资料整理.md) | 已整理，转写疑点有单独标注 |
| 腾讯体育「深度赛场」官方参考片段 | 同上第 8 节 | G1–G4 链接已核验；日期为 2026 年 6 月 |
| 官网与报名渠道核验、扩展调研、Word 手册 | [调研索引](../research/README.md) | 已归档；主要采集于 9 月 17 日 |
| 共享文档结构、Agent 指引与交接模板 | [协作流程](workflow.md)、[交接目录](../handoffs/README.md) | 已准备 |
| GitHub 私有仓库与首次同步 | [broadcastcode-team-hub](https://github.com/Linzeyu912/broadcastcode-team-hub) | 已创建并推送，已核对私有状态及本地与远端提交一致 |
| TypeSafe Jev 珠海与澳门可用性调研 | [调研结论与验证步骤](../research/jev-regional-availability.md) | 已发邮件向厂商确认，等待答复；未实测，尚未决定采用 |
| 解说 Agent 方案总结与直播纪要核对 | [方案讨论稿](agent-concept-review.md) | 已同步至 main（8bb3611）；按数据采集、数据处理、内容呈现整理；重点为战术意图、行为动因与声画同步；球员引力待验证，另两项核心指标后续再议 |

## 待认领任务

下面是任务候选清单。开始时从 [GitHub 新建任务](https://github.com/Linzeyu912/broadcastcode-team-hub/issues/new?template=task.yml)，填写负责人和完成标准，并把 Issue 链接补入最后一列。创建 Issue 后，以 Issue 里的状态和负责人为准。

| 优先级 | 任务 | 完成标准 | 负责人 / Issue |
|---|---|---|---|
| 后续 | 队友接入（按用户要求暂缓） | 两位队友接受邀请、完成克隆并能按协作流程同步 main | 等待后续安排 |
| P0 | 核实技术硬性要求 | 指定区域、Agent 服务名称、模型 ID 有正式来源 | 待认领 |
| P0 | 核实素材发放与数据结构 | 记录下载入口、权限、格式、字段、单位、视频时间对齐方式 | 待认领 |
| P1 | 拆解官方参考视频 | 记录预期命中率、球员引力、胜率影响力的呈现方式及可借鉴点 | 待认领 |
| P1 | 确定最小演示范围和三人接口 | 明确输入、输出、模块边界、负责人和验收样例 | 待认领 |
| P1 | 验证部署流程 | 在允许使用的环境中验证 CDK、Agent 服务与 CloudFront 页面 | 待认领 |

## 关键时间

- 10 月 9 日：珠海签到。
- 10 月 10 日 08:00：考试视频抽签。
- 10 月 10 日 18:00：考试视频发布。
- **10 月 10 日 20:00：代码与作品 URL 提交截止。**
- 10 月 11 日：澳门决赛路演。

以上来自培训纪要；后续正式通知有变化时更新出处及日期。

## 交接记录

- [2026-09-28：建立团队资料仓库](../handoffs/Linzeyu912/2026-09-28-repository-setup.md)
- [2026-09-28：Jev 地区可用性调研](../handoffs/Linzeyu912/2026-09-28-2159-jev-regional-availability.md)
- [2026-09-28：向 TypeSafe 发送地区支持询问信](../handoffs/Linzeyu912/2026-09-28-2206-jev-support-email.md)
- [2026-09-29：改为直接在 main 协作](../handoffs/Linzeyu912/2026-09-29-1428-main-only-workflow.md)
- [2026-09-29：三部分思路总结与纪要核对](../handoffs/Linzeyu912/2026-09-29-2115-agent-concept-review.md)
- [2026-09-29：收敛战术解读与声画表达](../handoffs/Linzeyu912/2026-09-29-2140-tactical-storytelling.md)
- [2026-09-29：方案总结结构与文风调整](../handoffs/Linzeyu912/2026-09-29-2147-summary-format.md)
- [2026-09-30：方案总结远端同步核验](../handoffs/Linzeyu912/2026-09-30-1038-agent-summary-sync.md)

日常任务过程放在各自交接文件中；只在团队阶段、任务入口或关键依赖变化时修改本页，减少多人同时编辑冲突。
