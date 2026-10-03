# 交接：多人分阶段战术轨迹与冻结帧叠加

- 日期 / 时区：2026-10-03，Asia/Shanghai（00:55 建立，按最终进度更新）
- 成员：thy-0629
- 任务 / Issue：本会话用户批准的轨迹战术标注方案；开始时查询无对应 Issue，未新建
- 分支：main
- 提交：本轮未提交、未推送；开始基线 1839dcde5b5cc0aa362baa474e58e5b530e6c695
- 状态：本轮第一版完成；功能、浏览器验证及最终独立复核通过。真实精度人工验收与播放器接入仍待后续完成

## 本次完成

- [独立工具与接入说明](../../engineering/tools/tactical-overlay/README.md)：纯逻辑引擎、绑定来源的数据清单、SVG 消费器、命令行导出与自包含 HTML。现有前端、服务与正式草稿未改。
- [已批准规格](../../engineering/docs/specs/2026-10-02-tactical-trajectory-overlay-design.md)及[实施计划](../../engineering/docs/plans/2026-10-02-tactical-overlay.md)：当前动作完整实线，后续实际观测虚线，已完成淡化；保留全部参与者并按阶段展示。
- 本地中间产物：`artifacts/tactical-overlay-preview/`；其中 `RECOVERY.md` 是恢复入口，`qa/browser-qa.md` 是浏览器记录。它们被 Git 忽略，尚未共享到其他电脑。
- 本地逐帧观察和精确冻结图：`artifacts/tactical-overlay-20261002/observations/`、`frozen-source/`。顺序解码帧 15/40/90，PTS 为 0.5 / 1.3333333333333333 / 3.0 秒，JPEG 与视频摘要另存。

## 最终文件入口

- [真实视频三阶段预览](../../artifacts/tactical-overlay-preview/real/index.html)：SAS–MIA，6 名候选参与者，精确冻结图和分阶段路线。
- [合成规则演示](../../artifacts/tactical-overlay-preview/synthetic/index.html)：两阶段多人跑位、实虚线转换和有朝向掩护横杠。
- [最终真实截图](../../artifacts/tactical-overlay-preview/qa/final-real-stage2-1280.jpg)、[窄侧栏截图](../../artifacts/tactical-overlay-preview/qa/final-real-stage2-476-scroll.jpg)、[合成截图](../../artifacts/tactical-overlay-preview/qa/final-synthetic-stage1-1280.jpg)。
- [浏览器核对](../../artifacts/tactical-overlay-preview/qa/browser-qa.md)、[最后显示修正的测试日志](../../artifacts/tactical-overlay-preview/qa/route-visibility-tests.txt)、[此前全套测试](../../artifacts/tactical-overlay-preview/qa/final-fix-tests.txt)、[最终输入与导出核对](../../artifacts/tactical-overlay-preview/qa/route-visibility-audit.json)、[恢复入口](../../artifacts/tactical-overlay-preview/RECOVERY.md)。

以上产物位于本机被忽略的 artifacts 目录；交接中的链接只在本机完整工作目录中可用。自包含 HTML 可直接打开，或在预览服务运行时访问 `http://127.0.0.1:8890/real/` 与 `/synthetic/`。

## 结论与依据

- 真实对象是 `data/videos/tactics/acceptance/clips/005_SAS_pick_roll.mp4`，SAS–MIA；不是另一个名含 005 的 LAL–MIN 样例。视频 SHA256 为 `1f7bd135ad8cde5ab877612e596f93200281b6902aac8084fad19a544d20b85d`。
- 独立观察本轮查看了 60 个采样帧并核对 143 个 PTS；候选保留 5 名进攻球员和 1 名直接相关防守者、3 个阶段、14 个动作。采样观察不是逐帧人工真值，实际身份、接地、标定和掩护关系仍待复核。
- 原始标定包含 139 个 needs_review 和帧 108–111 的 4 个 invalid；预览只在独立快照中采用待复核参考，不更改原始状态。
- 实现裁定：同一来源与参考链中的逐帧相机矩阵更新，不单独当作换标定来源断开；真正来源/参考变化仍断开。如果上游错误地把不连续参考链标成同一链，可能误连，因此仍保留缺口、切镜和跳点保护，真实结果不升级为已复核。
- 完成范围裁定：独立增量复核发现新标签遮住箭头，按用户要求追加仅此残余问题的修正和证据复核，没有以流程轮数为由交付遮挡箭头的版本。代价是额外验证时间，保守避让可能需要更宽的可滚动画布；真实轨迹和参与者没有为此改动。

## 验证

- 原 player-review 基线 144/144 通过；本轮未改其代码，不重复无关全量测试。
- 集中修正后的全套为 57 项、56 通过、0 失败、1 项文件符号链接测试因 Windows EPERM 跳过（约 6.87 秒）。最后追加路线避让后只重跑受影响的消费器：27 项、26 通过、0 失败、同一权限项跳过（约 8.02 秒）；新增两项回归先失败后通过。没有把此前全套冒充最后修正后重跑全套。三项硬链接源文件保护测试实际通过；运行时 Node v24.15.0，Node 22 未实测，真实 CSS 单独通过浏览器核对。
- 任务 1/2 均完成独立代码复核。已修正标定参考链误断、关系证据匹配、无效配置校验、失败导出入口更新、输出文件别名保护，以及后续起点误像当前位置的问题。
- 最终残余问题验证 `route-visibility-verification-report.md`：F2-R1 已解决，SPEC Compliant / QUALITY Approved，无开放问题或新增破坏。此前 F1/F3 与窄画布恢复已经独立确认。
- 浏览器实际核对真实三阶段 / 合成两阶段、全六人名单、JPEG 解码 1920×1080、完整 active 与 completed 淡化、后续起点空心虚线与帧号。最终真实 13 组与合成 7 组标签均未重叠或越界；1280/640/476 窗口的 8 个场景中，标签与路线描边、箭头、掩护横杠相交均为 0，主线 6 px、箭头头部约 18 px、描边 2 px。
- 掩护执行者、受掩护者和相关防守者分别显示，自己的同时动作保留；静态角色显示“当前 / 后续 / 已完成”，冻结锚点与未来真实起点不混同。
- 476 窄侧栏使用明确提示的内部滚动画布，页面不横向溢出，实际键盘可横移 208.67 / 209 px；箭头维持 18 px，阶段切换保持冻结图与清单同步。路线避让后，真实第二阶段在 640 窗口也使用 640 宽内部画布；1280 时是 933 宽自然画布。此前失败探测和最终通过截图都保留。
- 可复现提取脚本实际重跑 143 帧，全部 PTS 及三张 JPEG SHA 与原本轮资产一致。最终核对 12 个受保护输入未变、13 个导出资产摘要匹配；路线修正前后 5 阶段完整 manifest 与 96 个路线/关系/标记 SVG 组不变。更早修正只改变预期名单语义，坐标、动作、质量和缺口未改变。旧共享代码/候选无差异。
- [最终文件检查](../../artifacts/tactical-overlay-preview/qa/final-file-checks.json)：22 个本轮文本文件无行尾空白或缺失本地链接，12 个输入摘要一致，交付源码与独立复核版本、两份 HTML 摘要一致，旧工作台/数据目录无差异，Git 差异检查通过。

## 阻塞与待确认

- 无实施阻塞。原候选存在遮挡、短缺口和疑似跳点；没有足够证据的位置不连线。
- 真实掩护脚部被遮挡，方向为 null，不伪造横杠；方向符号由明确标记的合成演示验证。
- 尚未接入队友正在修改的播放器前端；本轮提供独立接口与冻结帧报告。播放器接入必须验证实际呈现帧后再显示叠加。

## 下一步 / 中断恢复

1. 先读 `artifacts/tactical-overlay-preview/RECOVERY.md` 和 `.superpowers/sdd/2026-10-02-tactical-overlay/progress.md` 最新条目；实现报告为 `task-3-report.md`、`final-fix-report.md`、`route-visibility-fix-report.md`，最终残余问题验证为 `route-visibility-verification-report.md`。`final-fix-review-report.md` 是修复路线遮挡前的报告，不应当作最终状态。不要从头重写已复核引擎/消费器；旧 pending_init 消费器执行者已被替代。
2. 优先直接打开已保存的 HTML；只有源代码或输入改变时再按工具 README 重导出。若冻结 JPEG 缺失，使用 `fixtures/005-candidate/extract_frames.py` 按说明重建并验证摘要；不以近似时间截图替代。原素材和正式草稿保持只读。
3. 服务退出时，在仓库根检查 8890 是否空闲，再运行 `python -m http.server 8890 --bind 127.0.0.1 --directory artifacts/tactical-overlay-preview`。当前服务 PID 29972；不要占用原工作台 8876。
4. 最终验证报告已保存；本轮无需重做实现或审查。后续应从真实身份/位置人工复核和队友播放器接口接入继续；保留中间记录，没有用户提交授权时只保存在本地。

## 同步状态

本轮代码、设计、文档和验证产物均为本地工作。没有创建分支、工作树或 PR，没有提交、推送或云部署；历史交接中的发布记录不代表本轮已同步。
