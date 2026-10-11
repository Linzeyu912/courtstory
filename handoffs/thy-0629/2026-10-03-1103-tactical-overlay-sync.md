# 交接：多人战术轨迹首版同步与兼容核验

- 日期 / 时区：2026-10-03 11:03，Asia/Shanghai
- 成员：thy-0629
- 任务 / Issue：用户授权同步独立战术轨迹首版；无新增 Issue
- 分支：main
- 提交：[21d24df](https://github.com/Linzeyu912/courtstory/commit/21d24dffb06284858669af9b66e14bab8a820dc2)（功能已推送；本交接与当前状态说明归属随后文档提交，文档提交哈希见 Git 日志）
- 状态：功能发布与独立兼容复核完成；本交接记录同步结果和后续验收边界

## 本次完成

- 将 23 个选定功能文件同步到 main，包括独立引擎、报告消费器、测试、规格 / 计划及既有交接；入口见[工具说明](../../engineering/tools/tactical-overlay/README.md)。
- 原起点为 1839dcde5b5cc0aa362baa474e58e5b530e6c695，接收 17 个可达远端提交，以 c0d2dcfc62f163a67741a2bea0225c4f78752958 为基线完成整合。
- 仅 docs/status.md 的两处文字冲突需要合并，保留远端研究 / 工作台发布记录及本地战术段落和表格；没有代码冲突，未修改共享前端或正式草稿。
- 7 个原本无关的未跟踪文件逐项字节保持；旧设计 / 引擎交接和历史“当时未发布”表述保留。本轮无新分支、PR、强推或模型 / 速度设置变更。

## 结论与依据

- 11:03:12 网络核验：本地 HEAD、origin/main、远端 main 均为 21d24dffb06284858669af9b66e14bab8a820dc2；功能发布已确认。
- 独立兼容复核结论为 Approved、无发现；核对选定范围、上游目录、原文件保护、测试与复现证据，未将代码兼容等同于真实战术准确率。
- 以下本机证据均位于 D:\HKS\broadcastcode-team-hub\artifacts\tactical-overlay-sync-20261003\，受忽略规则保护，不随代码发布：
  pre-sync.json、feature-publication.json、preservation-proof.json、compatibility-review.md、reproduction-proof.json、build-proof.json，以及下表日志。

## 验证

| 检查 | 本轮实际结果 | 本机日志 |
|---|---|---|
| 战术模块整合 | 59 项：58 通过、0 失败、1 项 Windows 文件符号链接 EPERM 已知跳过 | integrated-tactical-tests.txt |
| 工作台 | 241 项全部通过 | integrated-workbench-tests.txt |
| Python | discover 175 项 + render 6 项 = 181 项执行通过；不是旧轮次的 216 项 | integrated-backend-tests.txt、integrated-render-tests.txt |
| 可选跟踪套件 | 本环境未安装 ultralytics，本轮未运行 | 不计入上述 181 项 |
| 隔离构建 | esbuild 成功；bundle 仅 10 处 CRLF/LF 差异，归一化相等；license 字节相等，原构建文件未重写 | build-proof.json |
| 视频目录 | 5 批、142 条元数据及 142 个 LFS 索引指针通过；仅元数据 / 索引检查，未做完整视频字节验证 | video-index-tests.txt |

- 原保存输入重导出：真实 3 阶段和合成 2 阶段的 5 份 manifest 深度相等；两份 HTML 仅嵌入渲染器各 179 处 CRLF/LF 差异，整份文本归一化后相等。
- 新生成的 005 候选在全部 3 阶段的几何、问题、状态与名单保持一致，仍为 partial、6 人；冻结帧为 15 / 40 / 90。
- metadata 与 annotation 的 LF 字节变化影响来源绑定，因此 review / play 成对重生至 regenerated-input/，新导出在 regenerated-real/；旧输入与原预览保留，不混用不同绑定版本。

## 阻塞与待确认

- 发布无阻塞；真实人物身份、真实接地 / 米制位置与战术精度尚未验收，独立模块尚未接入实时前端播放器。
- 本机预览、冻结帧图片、QA、备份与新复现产物没有上传；此同步不新增可选跟踪运行或完整视频下载 / 字节验证。

## 下一步

1. 其他电脑拉取 main 后，按工具 README 复现独立报告；检查功能与文档所在提交，避免把保留的历史状态当作当前发布状态。
2. 需要继续功能验证时，先读[实现交接](2026-10-03-0055-tactical-overlay-engine.md)及本机 RECOVERY.md，沿用原输入和证据边界；先确认服务状态再操作。
3. 真实精度验收与播放器接入作为后续工作单独安排，不因本次发布升级候选可信度。

## 同步状态

- 已发布：上述 23 个选定文件及功能提交 21d24df；已独立核对本地、跟踪分支和网络远端一致。
- 文档：本交接与当前状态更新归属本文件所在的文档提交；最终提交哈希查 Git 日志，本机最终远端核验保存在 final-sync.json。本文中的 11:03:12 核验对应功能提交，不冒充随后文档提交的网络核验。
- 本地保留：artifacts/tactical-overlay-preview/（原预览及 QA）、artifacts/tactical-overlay-20261002/frozen-source/（冻结帧）、artifacts/tactical-overlay-sync-20261003/（备份、整合证据、成对新输入和复现导出）。
- 本机服务核验快照：8890 原预览进程 PID 29972 存活；8876 未监听。本轮未启动、停止或替换这些服务。
