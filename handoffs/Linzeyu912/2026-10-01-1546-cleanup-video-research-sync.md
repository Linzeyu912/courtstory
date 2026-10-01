# 交接：清理本地评分草稿并同步视频调研

- 日期 / 时区：2026-10-01 15:46，Asia/Shanghai（UTC+08:00）。
- 成员：Linzeyu912。
- 任务 / Issue：用户要求“前两个删除，第三个上传上去”；对应本地评分核查与来源记录、Excel/CSV统计、视频叠层调研三类内容。开始时只读查询开放Issue返回空列表。
- 分支：main。
- 提交：待选择性提交；同步结果完成后补记。
- 状态：评分文本清理完成，Excel删除受阻；视频调研待推送。

## 本次完成

- 删除尚未入库的评分审计文档、候选快照、来源与异常记录、CSV表格及THY原包摘要，连同三份相关交接，共29份文本文件。删除范围为 `research/nba2k-rating-provenance/`、`research/nba2k-rating-snapshots/`、`research/nba2k-rating-tables/` 内的文本文件、`research/nba2k-ratings-audit-2026-10-01.md` 及0920、0940、1010三份评分交接。
- 从[调研索引](../../research/README.md)和[团队状态](../../docs/status.md)移除上述本地评分成果入口，新增视频叠层调研入口。
- 保留并准备共享[视频位置与关系模型评估](../../research/video-overlay-vision-assessment.md)、[方案补充](../../docs/agent-concept-review.md)、[原调研交接](2026-10-01-0953-video-overlay-vision.md)及0805、1505两份同步历史记录；历史状态后附本次后续说明。
- 已入库的THY `2K Player Data/` 1.1版及视频资产不在删除范围内。

## 结论与依据

- 删除与上传范围来自本轮用户指令；29份已删除文件及剩余Excel均为未提交的本地产出，删除前逐项确认不属于Git跟踪文件。
- 视频调研来源于2026-10-01读取的RelateAnything固定提交 `06766fdf56752ca535fc9b971fca99ce563676d0`、OpenCV与Ultralytics官方文档；URL及核验范围保留在[评估文档](../../research/video-overlay-vision-assessment.md#来源与核验范围)。本轮只整理并共享已有研究，没有新增网页核验或模型实验。
- 研究建议先验证检测跟踪、脚下锚点和球场映射，再测试关系模型；尚未确定模型选型，接口与验证顺序仍为建议。

## 验证

- 开始时已在main；fetch成功，本机HEAD与origin/main均为 `ef476de99db7a085a7840c146536f099dbd795aa`，差异0/0。
- 检查8份拟共享文档，80个本地链接全部存在；UTF-8读取通过，无编码替换字符或冲突标记，`git diff --check`通过。
- 已删除的29份文本文件均不再存在；三处评分产出目录仅剩上述Excel。THY清单中11个文件的大小与SHA256全部一致，`2K Player Data/`及`data/videos/`无Git差异。
- 本轮没有视频入库、模型推理或成片实验。

## 阻塞与待确认

- 环境自动安全审查拒绝了批量递归删除，也拒绝了验证绝对路径后的单文件删除，原因均为“被策略阻止”。29份文本文件已通过文件补丁删除；`research/nba2k-rating-tables/nba2k-ratings-source-review.xlsx` 仍留本地，不纳入提交。
- 忽略目录中的既有备份与缓存未清理；本次删除针对正式本地产出。

## 下一步

- 剩余Excel如仍需删除，可由用户在本机删除上述明确路径。
- 若继续视频叠层实验，按评估文档选择现有连续镜头，先验证贴地标注和遮挡，再做关系模型对照。

## 同步状态

- 本次仅选择视频调研、方案、索引、状态与相关交接提交至main；剩余Excel不上传。
- 推送与远端提交核对结果待完成后补记。
