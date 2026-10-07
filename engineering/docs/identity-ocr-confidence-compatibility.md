# 本地 OCR 置信度、记分牌区域与队标视觉候选

核验日期：2026-10-06，Asia/Shanghai。

## 故障与已核实的库契约

`identity_ocr.py` 在筛选候选前直接比较 `score < 0.55`。本机安装的
`rapidocr_onnxruntime 1.2.3` 在 `rapid_ocr_api.py` 的 `RapidOCR.__call__`
中使用 `[[dt.tolist(), rec[0], str(rec[1])], ...]` 返回识别结果，因此置信度为字符串。
真实视频的记分牌读取可复现字符串与浮点数比较引发的 `TypeError`。

修复只归一化置信度：接受数值或可解析的数值字符串，再验证为有限值且处于
`[0, 1]`。布尔值、非数值、NaN、无穷与越界值不进入候选；保留 `0.55` 门槛。
原始 OCR 文本与识别多边形不作纠错，球队别名与号码的既有规则不变。
输出仍是待审核证据，`identityConfirmed=false`、`reviewRequired=true`。

## 记分牌区域与其他球队信息的区分

旧版文字 OCR 裁取画面底部 36% 的全宽区域。真实第 0 帧中，
`KInGS` 的识别位置为 `x=953–978, y=667–674`；经查看原帧，
它位于右侧 `D. FOX` 球员排行信息中的国王小队标，不属于本场左下对阵比分卡。
仅收紧纵向无法排除它。

`scoreboard` 与 `scoreboard_vision` 共用可验证的 `scoreboardRegion`：
可提供 `[左, 上, 右, 下]` 原图像素坐标，须位于画面内、至少 6×6 像素。
默认读取左下主比分卡，即左侧 55% 宽与底部 12% 高。
不同广播版式可传显式区域；此默认区域不保证覆盖所有记分牌版式。
输出回传实际区域，避免把未读到文字解释为不存在球队。

## 队标视觉候选接口

沿用 `POST /api/identity-ocr`，`mode="scoreboard_vision"`，
`observations=[{"frame":0}]`；队标模式一次仅分析当前一帧。
其余来源字段与现有 OCR 请求相同，文字 OCR 仍支持 1–24 帧。

服务将已配置的 `identity_agent.provider` 注入 `IdentityOCR`。
模型、推理强度、CLI 路径、超时和访问方式均来自服务端已有可信配置；
浏览器不能提供模型、网址、密钥或替换提示词。
视觉调用仍走受限 Codex CLI，不新增开放工具或网络接口。

输入为全帧与同帧主比分卡裁图。全帧只作定位上下文，提示明确排除广告、
排行榜和球场标志；裁图没有主比分卡或看不清时允许返回未知。
仅接收最多两个不重复的标准 NBA 球队代码和有限的 `[0,1]` 置信度。
输出沿用 `candidates`，标记 `engine="codex-vision"`；
`scoreMeaning="model_estimate_not_accuracy"` 表示置信度为模型自报估计。
候选证据记录帧、时间、裁剪区域与可见特征理由。
这一步不判断球衣归属、不自动绑定红蓝队或 P1–P10。

输入图片、摘要、提示词、schema、原始结果与响应保存于服务配置的
战术目录下 `team-identification-jobs/<jobId>/`，供人工核验来源。
该调用同步等待现有 provider 返回，前端应显示分析中状态，错误时保留原草稿。

## 验证

- `python -B -m unittest discover -s engineering/scripts -p test_identity_ocr.py -v`：
  11 项通过，包括真实字符串返回契约、无效置信度拒绝、原始文本与几何保留、
  `00` 与 `0` 的精确号码、阈值边界、ROI 校验、视觉候选审核语义、
  未知返回、输出代码/分数约束与浏览器配置拒绝。
- `test_vision_provider.py`：2 项通过。视觉候选测试注入假 provider，
  使用真实队标实验的返回结构与值，不产生额外模型调用。
- `test_player_review_server.py`：33 项通过，包括实际 HTTP 素材读取、
  静态资源与多版本裁剪回归，服务初始化调整未破坏已有路径。
- 使用实际视频 SHA-256
  `17c36f8d3b3e294f13f7119f23b82ec7f3fbe96d5564db9cbe7d61f49ebbbd7d`
  的 `team-stable` 轨迹，经 `IdentityOCR.recognize()` 直接读取第 0 帧：
  置信度兼容修复后的旧宽区域返回待审核 `SAC` 候选，原文 `KInGS`、
  置信度约 `0.6214`；收紧后的默认区域 `[0,633,704,720]` 返回
  `no_reading`，排除了排行小队标。显式传回旧宽区域可重现该诊断证据；
  第 0 帧的 `T1` 躯干返回待审核号码 `45`、置信度约 `0.6362`。
- 上述调用均返回有效结果；测试不证明候选文字、球队或球员身份准确，仍需人工核对。
- `git diff --check` 通过。

随后主任务已重新加载本机 `8876` 服务并完成独立 HTTP 与实际浏览器核验：
第 0 帧文字 OCR 返回 `no_reading`；实际页面的「Agent 识别队标 / 球队」
返回 `IND / BKN`，引擎 `codex-vision`、实际推理强度 `low`，仍为待审核候选。
作业 `aee873f45362431b93992763bfeb007d` 的输入与响应留在忽略目录
`data/local-workbench/tactics/team-identification-jobs/`，轻量响应见
[生产调用记录](../../research/vision/player-identity-continuation-20261006/production-team-response.json)。
测试副本的手工红蓝队绑定已实际带入参考字段；正式草稿未写入。
真实参考、续接及边界见[实验报告](../../research/vision/player-identity-continuation-20261006/README.md)。
本轮修改尚未提交或推送。
