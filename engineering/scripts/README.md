# 工程脚本

从仓库根目录运行，脚本之间按同目录导入。独立测量与模型探针已迁至[视觉研究脚本](../../research/vision/scripts/README.md)；本目录保留服务、功能工具和被生产流程复用的公共算法。默认研究文件已指向 `research/vision/`；生成物写入根目录 `artifacts/` 或 `tmp/`，不写入赛事资料目录。

| 类型 | 脚本 | 说明 |
|---|---|---|
| 工作台服务与裁剪 | `serve_player_review.py`、`review_video_trim.py` | 使用明确登记的视频与候选，只监听本机回环地址 |
| 人工制作浏览器验收 | `smoke_manual_tactics.py` | 只准备基础视频/PTS/可选映射，从空白通过真实 UI 完成多个对象、暂停、校正、保存、失败重试及 MP4 下载；[结果与限制](../docs/manual-tactics-workbench-acceptance.md) |
| 通用候选和匹配 | `build_review_tracks.py`、`player_proposals.py` | 模型候选不等于真实球员；生成新文件，不覆盖已确认身份 |
| 篮球专用检测对照 | `benchmark_ebard.py` | E-BARD YOLOv8n 与通用 YOLOv8s 的同素材离线对照；不修改正式候选或草稿 |
| 篮球专用候选生成 | `build_ebard_review_tracks.py`、`render_ebard_tracking_demo.py` | 已完成的新模型样例生成与人工指定区间演示；保留原候选，已有输出拒绝覆盖，复跑需指定新输出路径。ByteTrack 后续由另一合作者接手 |
| 镜头跟随候选 | `court_propagation.py`、`build_court_review_candidates.py`、`scene_profiles.py` | 从具名地面种子做 SIFT / LK 跟随，严格验证帧、哈希与来源，失败留空；工作台显式采用 |
| 篮筐约束的自动初始化 | `court_orientation.py`、`court_calibration.py` | 用已有篮筐检测核对场地朝向，只以地面交点计算透视；通过新增 HTTP 接口或省略 `--seed` 的候选生成命令调用，见[后端说明](../docs/court-calibration-backend.md) |
| 全场联合离线求解 | `court_fullcourt.py`、`benchmark_fullcourt.py`、`audit_fullcourt_motion.py` | 两端 / 中线 / 地板运动共用全场坐标，保留缺失和终止状态；未接入默认标定后端，见[依赖及运行](../docs/court-fullcourt-calibration.md) |
| 泛化压力与球场报告 | `benchmark_court_generalization.py`、`report_court_generalization.py`、`report_fullcourt.py`、`validate_fullcourt_benchmark.py` | 同片增强、可见场线抽查与逐帧来源核验；覆盖和增强一致性不是准确率 |
| 姿态、OCR 和篮球对照 | `compare_ground_models.py`、`compare_ball_models.py`、`identity_ocr.py`、`render_model_comparisons.py` | 保留原 YOLOv8n，候选须对齐视频 / 跟踪指纹；见[接口与对照](../docs/ground-mapping-ocr-comparison.md) |
| 四项功能审计及播放 | `audit_workbench_pipeline.mjs`、`render_function_audit.py`、`serve_comparison_report.py` | 区分篮球观测、P 身份、矩阵和场内点；Canvas 报告播放器及 Range 服务，见[复检报告](../docs/function-audit-20261004.md) |
| 导入与检查点加载 | `process_local_video.py`、`yolo_checkpoint.py` | 同视频球 / 筐参照单独保留，作用域内允许已知模型架构并恢复进程设置 |
| 回归检查 | `test_player_proposals.py`、`test_review_video_trim.py`、`test_review_variants.py`、`test_ebard_review_tracks.py` | 候选匹配、实际裁切、多模型帧同步与角色 / 对象隔离 |
| 场地 / 脚点接口检查 | `test_court_propagation.py`、`test_scene_profiles.py` | 已知运动、切镜停止、坏候选拒绝、实际裁切后的时间和版本绑定 |

启动方法见[工程入口](../README.md)，实验参数见[技术研究](../../research/README.md)。根目录 `scripts/validate_video_data.py` 仍负责全仓视频登记 / LFS 检查，`scripts/requirements/` 只负责历史手册生成；这两类仓库维护工具不混进工作台服务。

本轮分类成果与待解决事项见[共享报告](../docs/progress-and-open-issues-20261004.md)。研究脚本依赖的权重和 `artifacts/` 输入缓存不随 Git 分发；请按对应文档准备新输出目录，勿覆盖他人的验收产物。部分视频报告渲染当前使用 Windows 微软雅黑字体，其他平台需配置字体后另行验证。

2026-10-05：黄白球衣单片实验、旧检测演示和 2026-10-03 素材目录生成器已迁至 [工程归档](../archive/README.md)，不再作为当前工作台入口。默认共享样例为 005；004 的视频已按人工复核删除，其剩余候选仅供历史及回归使用。
