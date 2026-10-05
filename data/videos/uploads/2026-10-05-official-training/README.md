# BroadcastCode 官方训练重点素材

接收与入库：2026-10-05，Asia/Shanghai。用户指定 `train_video.zip` 为官方比赛训练包，并授权按 chuali-zi 的场景标准打标、加入共享素材库和工作台。批次 ID：`broadcastcode-training-20261005`。

**两段均为当前优先回归与比赛准备样例。** 用户预计最终测试片与本批同类；这不构成对未公布测试集规格的保证。普通采集素材继续作为补充。

## 原文件与来源

| ID | 原文件 | 实测规格 | 视频帧数 | 工作台 ID |
| --- | --- | --- | ---: | --- |
| 001 | [训练_弗拉格2月1日.mp4](clips/训练_弗拉格2月1日.mp4) | 1920×1080，约 59.94 fps，21.548 秒，AAC 原声 | 1291 | `official-training-001` |
| 002 | [训练_阿门1月4日 .mp4](clips/训练_阿门1月4日%20.mp4) | 1920×1080，约 59.94 fps，22.895 秒，AAC 原声 | 1371 | `official-training-002` |

合计 171,215,644 字节，通过 Git LFS 共享，保持解压后的原文件名、字节、音轨和实际 PTS，不缩放或重编码。第二个文件扩展名前的空格属于原名；ZIP 不重复上传。

[Portal ZIP 入口](https://comfile.csdnimg.cn/file/train_video.zip)沿用此前[训练包核验](../../../../requirements/training-package-check-20261005.md)，本轮使用用户给定的本地 ZIP，没有重新下载比对。包摘要和解码结果见[来源清单](sources/archive-inventory.json)，资产见[manifest](manifest.json)。接收渠道沿用 `purpose=user_upload`，用途另记 `category=official_training` / `priority=primary_regression`。

年份、赛季、比赛 / 事件 ID 及逐人身份未确认，保持 null。文件名的姓名和月日不提升为身份或比赛真值；比分、节次和时钟按可见画面另记。

## 与 chuali-zi 一致的场景标签

沿用[读取约定](../../AGENTS.md)和[正式分类](../../classification/README.md)：每项写 true / false / null、片段内区间和依据；另写清晰度、可见动作、可用区间、来源、摘要、重复关系和审核来源。

本轮完整检查 2fps 序列，共 90 张采样帧、8 张拼图，并补看 3 张全尺寸帧。属于 AI 视觉初筛，`human_reviewed=false`；原 163 段标签及其中 28 段真人复核保持不变。区间为约数，精确裁剪仍需补看相邻原帧；原始整场转播起点未知，来源绝对时间为 null。

| 场景 | 001 弗拉格片 | 002 阿门片 |
| --- | --- | --- |
| 推拉 | 约 13.5–18.5 秒篮下收紧，19 秒后拉宽 | 约 3.5–7 秒收紧，12–14 秒拉宽，17–20 秒再次收紧 |
| 中线推进与运镜 | 约 0.5–5 秒，中线移至左前场 | 约 0–4 秒，中线附近跨线推进至右前场 |
| 特写 / 切镜 | 开头 0–0.5 秒特写切宽景 | 约 21 秒后宽景切人物特写 |
| 模糊 / 拖影 | 篮下快速上篮时短暂出现 | 结尾移动近景明显出现 |
| 遮挡 / 出画 | 推进、篮下及回防时存在 | 前场跟随、篮下及末段近景时存在 |
| 仅半场、回放 / 教学加工 | 否；未见回放或教学加工 | 否；未见回放或教学加工 |

两段整体均为 `clear`，加入默认可用集合；高清不表示没有遮挡或拖影。完整 10 维见 [001 标签](labels/001.json)、[002 标签](labels/002.json)。“全场移动”沿用跨中线 / 两半场间连续跟随的定义，不声称覆盖两端篮筐完整往返。

与此前 163 段及彼此 SHA-256 均不同；未完成全库逐帧内容去重，不把不同编码当作独立比赛或独立评估来源。

## 工作台直接使用

[工作台清单](../../tactics/acceptance/review-library.json)已登记两片，`initiallyActiveSamples` 将其加入新工作集合及既有集合首次见到这些 ID 时的默认可见项；用户之后主动归档的选择仍保留。顶部“当前视频”可选两个“官方训练”条目，无需先重新推理。

```powershell
git lfs pull --include="data/videos/uploads/2026-10-05-official-training/clips/**" origin
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8890
```

`tracks/` 提供稳定显示、原始观测、篮球 / 篮筐和裁判参照。两片共 2662 帧按实际 PTS 对齐，并通过服务加载校验；稳定与原始方案共用相同观测文件，各用独立元数据。候选不是人工身份、球场坐标或真实轨迹，后续仍需人物与标定复核。

模型输出摘要及公开副本的换行 / 相对路径规范化见[候选发布记录](sources/tracking-provenance.json)；原始生成输出和检查帧留在本机忽略目录。

```powershell
python scripts/validate_video_data.py --check-index
python engineering/scripts/build_material_labels.py --check
```
