# 赛事要求与来源资料

2026-10-10 决赛准备：已重新直接读取终极指南（页面更新 10 月 9 日）与 Quick Start（10 月 6 日），新增[决赛答辩要求与交付核对表](finals-defense-requirements-20261010.md)。明确 5 分钟讲解、18/18/15/9/40 评分、10 月 11 日 09:00 前交材料；初赛同分规则不套用决赛。配套[技术路线与 7 页答辩母稿](../engineering/docs/finals-defense-technical-route-20261010.md)区分现有成果和待补证据，下方历史记录保持原时点。

更新：2026-10-05，Asia/Shanghai。此目录保存官方要求的整理、来源快照和有日期的历史准备资料；软件实现与技术建议在[工程目录](../engineering/README.md)。优先读取本次 Portal 与正式指南核验，旧培训纪要的未知项和赛程以较新来源补充。

| 内容 | 入口 | 使用口径 |
|---|---|---|
| 10 月 6 日运行位置与 GPU 复核 | [AgentCore / EC2 / S3 澄清](aws-runtime-clarification-20261006.md) | 重新实读官方：AgentCore 为强制承载，EC2 为可选计算；GPU 0 特指 EC2，SageMaker 可申请但不保证 |
| 10 月 6 日收到的 CDK 补充通知 | [通知与解释](cdk-deployment-notice-20261006.md) | 用户转发：不执行 bootstrap，新增角色使用指定权限边界；限定 us-east-1 和 SSO，原发布 URL 未提供 |
| 部署、机器重跑、人工评审与截止时间 | [10 月 6 日评审路径澄清](judging-operation-clarification-20261006.md) | CloudFront 看成片、私有仓库供机器重跑；20:44 复核两小时窗口在截止前，19:45 结束调优，20:00 硬截止。没有确认“只冻代码、截止后可继续加工”的例外；具体接口契约仍缺 |
| 10 月 5 日已有训练 ZIP 实测 | [训练包核验](training-package-check-20261005.md) | 两段 1080p 视频完整解码；包内无独立指标表，年份与官方事件关联待核对 |
| 10 月 5 日 Team25 Portal 与正式指南 | [Portal 记录](portal-access-20261005.md) | 已实读：AgentCore / CloudFront / CDK、us-east-1、GPU 0、双 profile、一次性绑定、题目边界与提交；后续资源与接通实测见 [AWS 环境记录](../environment/aws/README.md) |
| 培训要求、评分与交付清单 | [赛事资料整理](BroadcastCode赛事资料整理.md) | 9 月 28 日纪要为基础，10 月 5 日正式指南补充/修正已标明；原始历史资料不改写 |
| 9 月 17 日官网与报名资料 | [赛事与报名资料](archive/broadcast-code-12/赛事与报名资料.md)、[报名准备指南](archive/broadcast-code-12/报名准备指南.md) | 历史资料，不替代后续要求，不含个人报名材料 |
| 报名渠道核验及旧手册更正 | [渠道核验](archive/broadcast-code-12/expanded/报名渠道核验与更正.md) | 区分普通报名与其他推荐通道 |
| NBA 指标及其他赛事案例 | [扩展资料](archive/broadcast-code-12/expanded/扩展调研与团队讨论资料.md)、[NBA 图表核验](references/nba-china-xfg-chart.md) | 参考资料；其他赛事规则不能替代本届要求 |
| 原始来源 | [官网快照](archive/broadcast-code-12/official-page.md)、[来源索引](archive/broadcast-code-12/expanded/source-index.json) | 保留采集时原貌、URL 与日期 |
| 早期阅读手册 | [阅读版](archive/broadcast-code-12/Broadcast%20Code%2012%20黑客松赛事阅读手册.docx)、[讨论版](archive/broadcast-code-12/Broadcast%20Code%2012%20赛事理解与报名准备手册.docx) | 两个历史版本保留原字节，本轮未重新生成 |

Word 生成工具已移到 `scripts/requirements/`，依赖 `python-docx`。它们会写入本目录的对应手册，运行前应确认输出目的；本轮只修复路径和检查语法，没有运行生成器。渲染中间文件、个人报名材料及凭据继续排除。团队状态和仓库协作方式见[团队文档](../docs/status.md)。
