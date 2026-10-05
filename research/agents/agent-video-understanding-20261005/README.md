# OpenCode / Codex 视频理解源码拆解

采集：2026-10-05，Etc/UTC。类型：工程研究；本轮未改动工作台功能或接通模型服务。

用户后续明确：核心目标是研究模型直接读取视频后，如何提取球员轨迹并映射到 2D 球场；没有独立模块时不要硬拆。本专题保留已完成的 Agent 输入协议核查及历史源码摘录，后续研究转向视频模型、时序定位 / 跟踪和球场映射，不继续扩展不存在的 Agent 视频模块。

**结论：两个仓库公开的是 Agent 的输入处理、消息协议、工具和模型调用代码。视频语义识别由外部多模态模型完成，仓库内没有可直接拆出的自带权重的视频理解模型。OpenCode 存在向 Gemini 发送原生视频的底层路径；Codex 当前协议没有视频类型，适合接收外部抽取的图片序列。**

- [完整中文研究报告](REPORT.md)：入口限制、调用链、源码位置、与现有篮球工作台的关系及可复用模块。
- [源码来源清单](sources.json)：46 段原样源码，固定提交、行范围、原文件及片段 SHA-256、永久来源链接。
- [OpenCode 片段](excerpts/opencode)、[Codex 片段](excerpts/codex)、[Google SDK 片段](excerpts/sdk-google)、[当前工作台片段](excerpts/hub)：按职责拆分，供阅读对照；**不是可独立编译或调用的模块**。
- [抽取及核验脚本](extract_sources.py)：从固定 Git 提交重新抽取，防止版本变化影响结论。
- [离线协议探针](probe_boundaries.mjs)、[实际结果](offline-probe.json)：调用真实 OpenCode 附件检测函数和 Google SDK 请求序列化；合成 MP4 被界面检测拒绝，但 SDK 可封装视频字节。10 项断言通过，没有真实模型推理。
- [许可证与声明](licenses)：OpenCode MIT；Codex Apache-2.0 和 NOTICE；Google SDK Apache-2.0。摘录未修改原代码；解释及探针是本次研究产物。

| 来源 | 本次固定版本 | 获取方式 |
|---|---|---|
| [anomalyco/opencode](https://github.com/anomalyco/opencode) | `dev@907b3bc518fa48e90e8ec24dd327d13eee71c36c` | 默认开发分支浅克隆 |
| [openai/codex](https://github.com/openai/codex) | `main@7f892275e31002f0422477c6219189284560e689` | 默认分支浅克隆 |
| `@ai-sdk/google` | `3.0.73` | 与 OpenCode package.json 一致的 npm 源码包；压缩包哈希在来源清单 |
| 本仓库 | `main@42a1d60999b711dc09acc06db7edfdcf4c396b09` | 先同步远端，再读取工程代码 |

完整上游仓库保持独立，本仓库只保存轻量摘录和研究文件。复现时把第三方仓库放进根目录已忽略的 `tmp/`，不要把上游 `.git`、依赖或视频提交进共享仓库。

## 复现

从本仓库根目录执行。需要 Git、Python 3、Node 24+、npm 和 FFmpeg。网络只用于下载公开源码与 npm 依赖；探针运行阶段不需要网络或模型密钥。

```sh
mkdir -p tmp/agent-video-study/upstream/sdk-google
git clone --depth 1 --branch dev https://github.com/anomalyco/opencode.git tmp/agent-video-study/upstream/opencode
git -C tmp/agent-video-study/upstream/opencode fetch --depth 1 origin 907b3bc518fa48e90e8ec24dd327d13eee71c36c
git -C tmp/agent-video-study/upstream/opencode checkout --detach 907b3bc518fa48e90e8ec24dd327d13eee71c36c
git clone --depth 1 --branch main https://github.com/openai/codex.git tmp/agent-video-study/upstream/codex
git -C tmp/agent-video-study/upstream/codex fetch --depth 1 origin 7f892275e31002f0422477c6219189284560e689
git -C tmp/agent-video-study/upstream/codex checkout --detach 7f892275e31002f0422477c6219189284560e689
npm pack @ai-sdk/google@3.0.73 --ignore-scripts --pack-destination tmp/agent-video-study/upstream/sdk-google
tar -xzf tmp/agent-video-study/upstream/sdk-google/ai-sdk-google-3.0.73.tgz -C tmp/agent-video-study/upstream/sdk-google
python research/agents/agent-video-understanding-20261005/extract_sources.py --upstream-root tmp/agent-video-study/upstream --hub-root . --verify
npm install --prefix tmp/agent-video-study/runtime @ai-sdk/google@3.0.73 --ignore-scripts --no-audit --no-fund
node research/agents/agent-video-understanding-20261005/probe_boundaries.mjs --opencode-root tmp/agent-video-study/upstream/opencode --sdk-root tmp/agent-video-study/runtime --output tmp/agent-video-study/probe.json
```

探针的 JPEG 用例只验证 MIME 接纳；MP4 为 FFmpeg 实际生成的一秒视频。SDK 响应由探针固定返回，验证的是请求封装，不代表 Gemini 理解结果。上游完整构建和 Rust 测试未运行，视频理解准确率、时延、费用未测量。

抽取器读取 Git 对象中的固定版本，因此本仓库后续有提交也不影响基线复现。`--verify` 逐字节核对片段、许可证及来源清单；去掉该参数会重新生成研究摘录。
