# 视频数据接手约定

先读 `catalog.json` 和 `classification/README.md`，再读 `classification/label-schema.json`、目标场景目录与对应原有 `labels/*.json`。全部 JSON 路径以仓库根目录为基准，片段 ID 沿用批次 ID + 三位编号。

- 当前场景标注使用每段标签的 `material_labels`。旧 `material_review`、采集时的战术标签和来源快照保留历史含义，不能当成本轮场景真值。
- `scenarios` 对每个字段显式写 true / false / null；false 表示本轮采样未见，null 表示无法判断。读取说明和时间段，不从文件名、分辨率或旧标签补猜。
- 这是用于真实场景覆盖与后续数据增强的初筛。镜头推拉、全场移动、模糊、特写打断、视角切换应保留为场景样本。质量等级与是否有增强价值分别判断。
- 默认使用 `classification/selections/default/index.json`。`all_usable` 包含重复备选；`excluded` 是无有效普通比赛过程等不适用素材。`by_scenario/` 会列出观察到的所有正例，包括明确标为 excluded 的参考，使用时必须检查 selection。
- `by_scenario/<类型>/<clip_id>.json` 是统一命名的场景样本记录，引用唯一原成片，不复制 MP4。记录片段内时间及可核实的来源时间。未知上传来源、原片起点和赛季维持 null。
- 每次使用先核对 `asset.sha256` 与当前 manifest。视频被替换后旧标注不得自动沿用；新片入库后补审，不能只把旧分类索引计数调大。
- `content_relations` 的 full_containment / partial_overlap 是画面内容关联，different 是已排除的候选。后续若切分训练和评估集，同画面或局部重叠样本应放在同一来源组，避免把重复帧当独立泛化结果。
- 时间段由 2fps 抽帧估计，采样间隔0.5秒，适合定位和初筛；边界误差尚未逐帧验证，精确裁剪需在附近补看逐帧画面。AI 审核不等于真人真值；不填造身份、意图、场地坐标或真实轨迹。
- 固定40段抽检已全部完成，人工保留28、删除12；此前库163段；2026-10-05 新增2段官方训练重点素材，当前165段。实际人工审核原记录见 `reviews/human-2026-10-04/index.json`，删除元数据见 `classification/discarded/index.json`，不可将已删路径当活动素材。人工意见应用记录见 `classification/human-review-updates.json`；已处理段的 `provenance.human_reviewed=true`，其余137段（含新增官方训练2段）保持false。AI全库推拉复核另记于 `provenance.camera_zoom_recheck`；人工审核说明记录原审核指纹，AI新增修改不冒充用户再次确认。修改正式标签后用 `engineering/scripts/build_material_labels.py --refresh` 更新目录，勿重放原AI结果覆盖人工修正。
- 官方训练重点样例见 `uploads/2026-10-05-official-training/README.md`；两段原文件、场景标签及可直接打开的工作台候选一起共享，优先用于回归。新增审核如无法确认精确模型 ID，应明确记为未知，不冒用历史审核模型名。
- 源视频仍按现有赛季 / 上传批次管理，保持 LFS 与原字节。HTML / CSV 属于历史阅读辅助，Agent 接手以结构化标签为准。

检查命令：`python scripts/validate_video_data.py --check-index` 与 `python engineering/scripts/build_material_labels.py --check`。后者需要 Python 的 `jsonschema`。
