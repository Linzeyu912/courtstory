# 交接：OpenCode / Codex 多模态视频理解源码研究

2026-10-05（America/New_York）后续发布更新：用户明确授权先提交并 push 现有成果，本专题、索引、状态及交接选择性纳入本次 main 文档提交。46 段源码及许可证重新逐字节核验通过；未追加不存在的视频模块。最终提交 SHA 与推送后远端核对在完成报告提供；下方未提交文字保留最初交接时状态。用户下一轮的核心目标是模型直接读视频、球员轨迹与 2D 球场映射。

- 日期 / 时区：2026-10-05 04:10，Etc/UTC
- 成员：本次执行 Agent；交接归档沿用环境既有 chuali-zi 目录
- 任务 / Issue：用户要求先同步远端，拉取 opencode / codex，拆解研究视频多模态理解；本轮开放 GitHub Issue 查询为空
- 分支：main
- 提交：无；研究文件及索引更新未提交、未推送
- 状态：源码获取、拆解与研究完成；真实模型实验未进行

## 本次完成

- 当前仓库从 `76ce1ad` 快进同步到 `42a1d60999b711dc09acc06db7edfdcf4c396b09`，包含队友最新 2D 优先工作台计划。执行环境起初只有 `work` 分支，工作区干净；将其重命名为 `main` 后按仓库协作流程拉取，没有新建任务分支。
- 独立浅克隆 `anomalyco/opencode` 的 dev、`openai/codex` 的 main；未编辑上游源码，完整克隆和 npm 依赖位于共享仓库之外的本机研究目录。
- [研究入口](../../research/agents/agent-video-understanding-20261005/README.md)、[中文报告](../../research/agents/agent-video-understanding-20261005/REPORT.md)：两个 Agent 的入口 / 类型 / 消息转换 / 模型请求 / 工具结果，以及本工作台已有抽帧能力和后续复用边界。
- [来源清单](../../research/agents/agent-video-understanding-20261005/sources.json)：46 段原样代码，锁定提交、行号、原文件及摘录 SHA-256、永久链接；附许可证和 Codex NOTICE。
- [抽取核验脚本](../../research/agents/agent-video-understanding-20261005/extract_sources.py)、[离线协议探针](../../research/agents/agent-video-understanding-20261005/probe_boundaries.mjs)及[真实运行记录](../../research/agents/agent-video-understanding-20261005/offline-probe.json)。
- 更新[研究索引](../../research/README.md)和[团队状态](../../docs/status.md)，明确本轮仍本地未提交 / 未推送。

## 结论与依据

- OpenCode 固定于 `907b3bc518fa48e90e8ec24dd327d13eee71c36c`，Codex 固定于 `7f892275e31002f0422477c6219189284560e689`；采集于 2026-10-05。
- OpenCode 的默认附件界面和 read 工具不构成完整的视频入口；Google SDK 3.0.73 与新原生 Gemini 路由有视频封装能力，需分别核实实际入口、provider 和模型。
- Codex 当前 UserInput / ContentItem / InputModality 没有视频类型。现有工作台以 PyAV 抽帧、参考人物裁剪 / 拼图、时间与轨迹证据，再通过 CLI 图片参数请求多模态模型。
- 两个公开 Agent 没有可直接拆出运行的视频理解模型权重；视觉语义由外部模型执行。本轮没有宣布团队模型选型，也没有实现新的 Gemini provider。

## 验证

- Git fetch / pull 成功，开始研究时 HEAD 与 origin/main 均为 `42a1d60`。
- 46 个代码片段、来源清单和许可证逐字节核验通过；包含原文件 / 摘录哈希。
- Node 24.19.0、FFmpeg 合成一秒 MP4；直接运行上游附件检测函数，三个 MP4 MIME 情形拒绝、JPEG MIME 接纳、误报 video/mp2t 的 TypeScript 文本识别为文本。
- 固定 Google SDK 的真实 doGenerate 请求转换在内存 fetch 中运行：视频 MIME 正确、base64 字节往返一致、URL 转 fileData 正确；共 10 项断言通过。响应固定，无网络请求和模型推理。
- 新研究文件相对链接及 Git 差异空白检查通过。未重跑工作台回归、上游完整构建或 Rust 测试，因为没有改产品功能；不声称视频语义准确率或延迟已验证。

## 阻塞与待确认

- 无阻塞源码研究的事项。真实模型实验需要后续确定 provider、可用模型、服务配置与同片验收任务；本轮没有调用收费模型。

## 下一步

- 阅读报告第 5 节，优先复用现有解码 / 时间映射 / 裁剪与证据包，再决定是否比较原生视频 provider。
- 用同一篮球样片、同一任务和人工标注比较图片序列与原生视频；分别测量身份、时序事实、几何及成本，不把接口封装通过当成视频识别成功。
- 复现获取与探针命令见研究入口。第三方源码、node_modules 和生成视频不要纳入共享 Git。

## 同步状态

- 本轮按用户要求完成拉取远端。研究文件、研究索引、团队状态及此交接未提交、未推送；没有修改远端、建立 PR、改变视频或用户草稿。
- 后续同步成果时仅选择本任务文件，按仓库 main 协作流程同步并核对远端。
