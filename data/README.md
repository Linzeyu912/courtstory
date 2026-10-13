# 运行数据与来源

这里保存 CourtStory 工作台读取的视频素材、比赛名单、标签、轨迹与辅助 JSON。产品代码和使用说明在 [engineering/](../engineering/README.md)；研究过程、模型比较和实验报告在 [research/](../research/README.md)。

## 目录与用途

| 目录 | 保存什么 | 如何使用 |
| --- | --- | --- |
| [videos/](videos/README.md) | 视频原文件、来源清单、场景标签、候选轨迹与素材索引 | 当前共享输入只有用户提供的 Single 考试视频；从 [catalog.json](videos/catalog.json) 找数据集，从 [review-library.json](videos/tactics/acceptance/review-library.json) 找工作台样例 |
| [player-rosters/](player-rosters/README.md) | 按 NBA game ID 保存的三场明确比赛名单及官方来源 | 在比赛上下文相符时供姓名候选查询；比赛名单不等于已经识别出画面中的球员 |
| [workbench/](workbench/README.md) | 早期样例迁入的球场、脚点辅助 JSON | 保留现有工程读取路径与来源；这些历史候选不能当作当前 Single 的识别或标定结果 |

当前默认样例为 `exam-001`，输入文件是 [single.mp4](videos/uploads/2026-10-10-exam/clips/single.mp4)：约 21.97 秒、1920 × 1080、59.94 fps。共享轨迹保存真实解码帧时间与空候选，场景和身份字段仍待审核；最终成片的存在不表示输入样例的候选已被重新识别或人工确认。

## 与球员资料、产品和成片的关系

| 位置 | 与本目录的关系 |
| --- | --- |
| [2K Player Data/](../2K%20Player%20Data/README.md) | 独立的球员赛季与第三方能力评分参考包。保留来源、缺项和数据契约；不代替比赛名单，也不作为视频中的真实比赛技术统计 |
| [engineering/](../engineering/README.md) | 读取视频、明确比赛名单与辅助资料，提供身份审核、解说、战术绘图和成片制作 |
| [deliverables/](../deliverables/README.md) | 保存已经制作完成的 Single 展示成片和字幕。这里的 68.3 秒 MP4 是产品输出，与 `data/videos/` 中约 21.97 秒的输入视频不同 |

数据流为：**输入素材与参考资料 → 工作台制作与人工审核 → 成片与字幕**。研究实验的报告和结果仍随各自研究专题保存，避免把实验结果直接当作运行数据。

## 共享与本机数据

- 当前共享输入视频和 Single 展示成片均由 Git LFS 保存；克隆后运行 `git lfs pull` 下载。
- 视频来源、摘要、编号和未知字段按 [视频数据规范](../docs/video-data-management.md)维护；从仓库根目录运行 `python scripts/validate_video_data.py --check-index` 校验视频素材与 LFS 索引。
- `data/local-videos/`、`data/local-workbench/` 保存本机导入素材、草稿与运行结果，`data/raw/` 保存本机原始资料；这些内容由 Git 忽略规则排除，不表示已随仓库共享。
- `data/`、`2K Player Data/`、`deliverables/` 的现有路径由服务、索引和打包脚本引用，新增数据按上述职责放置，避免仅为目录美观移动已有文件。
