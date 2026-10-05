# 交接：官方训练片打标、入库与工作台接入

- 日期 / 时区：2026-10-05 23:18，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：用户在当前会话明确要求继续上传 `train_video.zip` 中两段官方训练片，沿用合作者标签标准，作为重点素材供工作台使用；开工核对 GitHub 无开放 Issue，未虚构负责人或队友共识。
- 分支：main
- 提交：[af41fce：素材、标签与候选](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/af41fce50af98068a19f1b164ffd048516079530)、[0ffb9fe：工作台默认可用](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/0ffb9fea1598e355fc91e44c7d79cf31cac95ab7)；入口与本交接随随后文档提交发布。
- 状态：数据与功能已完成、已推送，远端原片下载已核实。

## 本次完成

- [独立训练批次](../../data/videos/uploads/2026-10-05-official-training/README.md)：两段原 MP4、manifest、来源清单、两份 10 维场景标签及自动检测候选。批次 `broadcastcode-training-20261005`，`official_training` / `primary_regression`；当前素材库 9 批 165 段。
- [结构化分类](../../data/videos/classification/README.md)：刷新场景、动作和默认集合；保留此前 163 份标签原字节。当前 28 份真人复核、137 份 AI 标签，模型身份未明确时如实填 `codex-model-unspecified`，不冒用其他 Agent 名称。
- [工作台配置](../../data/videos/tactics/acceptance/review-library.json)：新增 `official-training-001` / `official-training-002`；首次遇到这两个样例时默认显示，之后保留用户主动归档的决定。默认 005 及原有草稿继续保留。
- 两片完整运行篮球 YOLOv8n + BoT-SORT 与 E-BARD 参照，发布 2662 帧候选。稳定显示与原始观测共用相同观测文件、使用独立元数据；公开副本只规范换行、相对路径与父级摘要，原始本地输出保留。见[候选发布记录](../../data/videos/uploads/2026-10-05-official-training/sources/tracking-provenance.json)。
- 更新根入口、视频规范、成果总览、工程运行说明及训练包历史核验的后续授权状态；ZIP、检查帧和运行中间文件仍在忽略目录。

## 结论与依据

- 采用仓库账号 chuali-zi 的[结构化标签流程](../chuali-zi/2026-10-04-0624-structured-video-scenarios.md)与[人工复核口径](../chuali-zi/2026-10-04-1359-human-review-final-zoom-recheck.md)。真人姓名与账号的对应未从团队表确认，不据用户的模糊称呼补全身份。
- 每 0.5 秒抽帧检查全片，对推拉、全场移动、画面模糊、特写、视角切换、仅半场、运动拖影、遮挡、出画、回放 / 教学分别记录 true / false / null、时间区间及依据；另记清晰度、动作、可用区间与审核来源。
- 本轮观察 44 + 46 张采样帧、8 张拼图并补看 3 张全尺寸帧。两段整体清晰，均有中线推进及运镜、推拉、切镜、遮挡 / 出画和局部模糊；001 开头切镜，002 约 21 秒切人物近景。场景区间为 2fps 近似定位；`human_reviewed=false`。
- 来源为用户给定本地 ZIP，并沿用此前 Portal 已核对的[官方包入口](https://comfile.csdnimg.cn/file/train_video.zip)，采集 / 核验日期 2026-10-05。本轮未重新下载 ZIP 比对；[原包和文件摘要](../../data/videos/uploads/2026-10-05-official-training/sources/archive-inventory.json)已共享。
- 001：21.548 秒 / 1291 帧 / 83,907,519 字节；002：22.895 秒 / 1371 帧 / 87,308,125 字节。均为原始 1920×1080、约 59.94 fps、AAC 音轨；不重编码，第二个文件扩展名前原有空格保留。

## 验证

- 两段从 ZIP 解压的 SHA-256 与原始成员一致；FFmpeg 严格音视频完整解码无错误，PyAV 实读 2662 视频帧，保持实际 PTS。
- `scripts/validate_video_data.py --check-index`：9 批、165 条、165 视频哈希和 LFS 索引通过，总视频 2,084,029,775 字节。
- `engineering/scripts/build_material_labels.py --refresh` 后 `--check` 通过；原 163 份标签哈希与任务开始时逐一一致，10 个公开候选副本哈希与发布记录一致。
- `test_workspace_collection.py` 7 项、`test_local_video_library.py` 23 项通过；覆盖既有工作集合新增官方片、未知 ID 配置拒绝、用户归档决定在重启后保留。
- 两片通过 `validated_clip` 服务加载，API 返回 `ready` / `available=true` / `archived=false`，均有原始、稳定、原始观测和 E-BARD 方案。
- 本机 `8890` 工作台实测两片切换和播放，视频 DOM 为 1920×1080 / readyState 4 / 无解码错误；001 实际时钟推进，002 播至片尾。截图在本机忽略目录 `artifacts/official-training-20261005/workbench-official-training.png`，未保存或改写用户人物关联 / 标定草稿。
- 推送后另设此前不存在的 `tmp/official-training-ingest-20261005/remote-lfs` 作为 `lfs.storage`，仅从 origin 的 `0ffb9fe` 下载本批两个对象，未复用工作区或既有 LFS 缓存。23:18 下载完成，合计 171,215,644 字节，重新计算 SHA-256：001 为 `9c3e4606d04e7f79e29a112952fcf069ebab202af207af500bfbc3338bc079ce`；002 为 `7ec745f5f1e75b0c6d6dd27d409875f67c2ac3ab76c73f7123794c96be5aee22`，全部与来源一致。本机证据：`artifacts/official-training-20261005/remote-lfs-check.json`。
- 文档链接与路径检查、`git diff --cached --check` 通过；旧不可变快照仍保留历史路径文字，不据此重写历史材料。

## 阻塞与待确认

- 入库与上传无阻塞。比赛年份、完整比赛 / 事件 ID、逐人身份、球场标定和官方指标尚未确认；自动候选不是真值。
- 新片与全库 SHA-256 不重复，但未进行全库逐帧内容去重，不能认定为独立比赛或完全独立评估来源。
- 两片按用户要求作为优先回归素材；最终未公布测试视频的实际规格仍以官方为准。

## 下一步

- 队友同步 main 后按批次 README 执行 Git LFS 拉取，在工作台顶部「当前视频」选择「官方训练 001 / 002」。
- 在原片上复核场景边界、人物持续身份与球场坐标，再推进战术标注和正式指标对齐；保留 AI 与人工来源区别。

## 同步状态

- 两个数据 / 功能提交已直接推送 main，23:17 通过 `git ls-remote` 确认远端为 `0ffb9fea1598e355fc91e44c7d79cf31cac95ab7`；23:18 两个远端 LFS 原片下载与摘要校验通过。
- 本交接、团队状态和三处导航 / 历史授权说明作为第三个文档提交独立发布，最终提交号从 main 历史读取。
- 未创建分支、PR 或云应用资源；本机输出、检查帧、模型与下载校验缓存不提交。
