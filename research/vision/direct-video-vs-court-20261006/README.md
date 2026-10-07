# 原视频像素标注与球场投影：独立三秒真实对照

2026-10-06，Asia/Shanghai。A、B 与同步左右对照均已正式编码并完整解码。当前战术布局、模块和生产代码不改，浏览器 / 服务正式或既有 QA 草稿不写。

同一 Pacers 导入片，9.50–12.50 秒，半开源帧 `[570,750)`，180 帧；和此前身份测试包含 750 的 181 帧区别。目标是白衣 00（此前独立 QA 的 P6 / T2→T39），模型自行核对实际短动作，不把既有 T 关联当真人真值。

仅一次真实 Codex 视觉调用，输出受限 JSON 的原图像素 Bezier 路线与暂停解释。A 用现有 `createManualAnnotation` 固定像素 + 源时间进度；B 以真实 calibrationAt 将同一组控制点从参考帧转 court_meters，再由各源帧映射投影。这是复用现有两种坐标流程的对照，不是两次模型竞赛，也非严格只隔离相机层：原 court 流程采样 Bezier，箭头 / 宽度按米制，A 按像素；四点转换不保证整个曲线 / ribbon 像素完全相同。解释文字保留在候选 / notes；不增加字幕模块。

Python 实例化独立 `TacticalWorkbench` / `TacticsRenderer`，走原版本 / 摘要校验、保存与正式 MP4 job；Node bridge 仅导入既有文档、标注、关键帧、校验与 production。所有生成稿 / 证据 / job 留 `artifacts/direct-video-vs-court-20261006/<新run目录>`。不会调用 8876 的保存 / 采用接口，不手写坐标冒充 Agent。

```powershell
python research/vision/direct-video-vs-court-20261006/probe.py prepare --run-dir artifacts/direct-video-vs-court-20261006/run-01
python research/vision/direct-video-vs-court-20261006/probe.py generate --run-dir artifacts/direct-video-vs-court-20261006/run-01
python research/vision/direct-video-vs-court-20261006/probe.py render --run-dir artifacts/direct-video-vs-court-20261006/run-01 --mode A
python research/vision/direct-video-vs-court-20261006/probe.py render --run-dir artifacts/direct-video-vs-court-20261006/run-01 --mode B --calibration artifacts/direct-video-vs-court-20261006/calibration/propagation.json --candidate-preview
python research/vision/direct-video-vs-court-20261006/compare.py --run-dir artifacts/direct-video-vs-court-20261006/run-01
```

依赖复用本机 Python 的 PyAV / Pillow、Node、Codex provider、Sharp 和 FFmpeg，不安装 TAPIR。服务 GET clip 不可用时可读取上一轮留存 clip.json，实际视频字节及每个证据帧 PTS 重新核对。新模型请求需新 run 目录；已有 proposal 禁止重复调用。

B 校准文件须声明同 videoSha256 / videoHash，包含现有 keyframes（或 calibration / courtCalibration 包装）。原始 needs_review 默认拒用；显式 `--candidate-preview` 仅在 B 的独立 session 调用现有 `acceptCourtCandidates`，得到 accepted_reference + reviewRequired，不直接覆盖原 status，不写 projectionReviewedAt / 人工确认。缺口或越界仍失败，不夹控制点、不伪造 H / approximate 相机。原 raw、原 / 派生 digest、adoption counts 留存；数值预览不证明米制精度。

记录 source SHA / frameMapping、模型 settings / prompt / schema / 原始响应 / usage / 耗时、参考及动作范围、文档版本 / digest、正式 job、完整解码与 artifact hashes。A 固定像素不随镜头贴地，B 必须经过实际映射和视觉检查；两者都不是全自动十人工作流验收。

## 首轮已确认结果

隔离运行目录：`artifacts/direct-video-vs-court-20261006/bridge-run-01/`。模型真实输出选择第 705 帧（11.75 秒）暂停 1.5 秒，跑位范围 `[705,750)`，四个控制点来自模型：`[425,601] / [404,600] / [359,591] / [320,579]`。程序验证、转换文档和正式 renderer 接收；没有手工补坐标。

本次模型输入是 8 张原视频抽帧，不是连续视频逐帧定位。它生成短动作的讲解示意，未恢复此前遮挡处的 25 帧缺测，也未重新运行十人检测 / 身份跟踪。先前跟踪快照仅提供来源与时间等上下文，不能把复用结果的时间当成新导入全流程耗时。

| 项目 | 实际值 |
| --- | --- |
| 共享一次 VLM | `gpt-6.1-sol / low`，86.80 秒，input 22303 / output 378 / reasoning 55 tokens；费用未知 |
| A build / render | 1.03 / 9.37 秒；render 阶段总计 12.58 秒 |
| A 输出 | 1280×720，30 fps，135 帧 / 4.5 秒，3 秒源片 + 1.5 秒暂停 |
| A 保存 / 编码 | 独立 Store 版本 1、`authored-svg-1`、正式 job，全片 PyAV 解码通过 |
| A MP4 SHA-256 | `58b7028e2e73fda1a3c30ea6b2dea98b0f36220398a17456b42ef13f219755a4` |
| B 自动标定 / 传播 | 三帧初始化 4.53 / 1.25 / 1.35 秒；180 帧传播 17.95 秒；诊断检查另记，均不含共享 VLM |
| B build / render | 1.17 / 9.79 秒；render 阶段总计 13.39 秒，不包含另一阶段的校准耗时 |
| B 输出 | 同钟 135 帧 / 4.5 秒，独立 Store 版本 1、正式 job、完整解码 |
| B MP4 SHA-256 | `549d287b114b00a3b8e51fc4bc9d3ab03a820f8d3c350bf3b940922bd7deb5e2` |
| B 校准与预览状态 | 180 原始 needs_review 候选保持，隔离采用180 / invalid0，派生关键帧仍 reviewRequired=true；渲染记录 humanReview=false / metricAccuracyValidated=false |
| 左右对照 | 1280×396，30 fps，135帧 / 4.5秒；NVENC 0.96秒，2,777,377字节 |
| 对照 SHA-256 | `b4466676fc91368449d112bef973f50ec93e6fa7d4592187f880bb06413d36c7` |

A 在暂停帧有可见蓝色短跑位箭头。脚点 / 米制 / 真人身份精度未由本实验认证，固定像素路线不能称连续 ground。JSON 的 `origin.kind='agent'` 记录模型来源；既有函数的 `timingMode='manual'` 是作者动作时间语义，不表示本实验人工绘制。

B 使用另一独立实验的真实篮球场关键点模型 + 180帧传播，参考705、动作705–749无数值映射缺口，四个转换点都在NBA范围内。原 / 派生校准摘要分别为 `d1194d...038e340b` / `8c861c...e46f67c7`。已有独立线回投检查见 `calibration/heldout-line-checks.json`；三分弧有偏差，未通过独立米制真值验收，因此输出与对照顶部明确 CANDIDATE。

`comparison.mp4` 为 A 左 / B 右同源时钟，程序逐项比较 sourceFrame / sourceTime / state / reveal 一致后合成，完整解码验证。A 原片 2,368,155 字节，B 原片 2,369,775 字节；两片均保留。完整 FFmpeg 调用及硬件 / CPU尝试记录在 `comparison-commands.json`，结果 / 时长 / hashes 在 `comparison-result.json`。这只是研究产物，不是新增产品布局。

最终独立核验通过：三片完整解码、135 项时钟 / 状态一致、45 暂停帧对应源 705，实际视频摘要与同一候选 / 来源 / 七个核心模块摘要一致。两箭头均在白衣 00 脚边朝左，B 标签明确 CANDIDATE。证据见本机专题 `final-verification.json`。派生校准文件本身没有独立的米制精度通过字段；原始候选 / 渲染记录的 false 与缺少人工确认都保持，不能将字段缺失视为精度通过。

MP4、抽帧、完整文档 / plan / raw model 输出和运行日志在本机忽略目录。独立 renderer 返回的标准 `videoUrl` 并未注册到 8876 HTTP 服务；查看本地 `A/direct-video-fixed.mp4`，不能把该 URL 说成服务可播放结果。
