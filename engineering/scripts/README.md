# 工程脚本

从仓库根目录运行，脚本之间按同目录导入。默认研究文件已指向 `engineering/research/`；生成物写入根目录 `artifacts/` 或 `tmp/`，不写入赛事资料目录。

| 类型 | 脚本 | 说明 |
|---|---|---|
| 工作台服务与裁剪 | `serve_player_review.py`、`review_video_trim.py` | 使用明确登记的视频与候选，只监听本机回环地址 |
| 通用候选和匹配 | `build_review_tracks.py`、`player_proposals.py` | 模型候选不等于真实球员；生成新文件，不覆盖已确认身份 |
| 原片段候选实验 | `basketball_player_filter.py`、`jersey_tracker.py`、`prepare_player_review.py`、`render_vision_tracking_demo.py` | 黄白球衣等条件只适用于已记录的旧样本，不套用其他视频 |
| 测量与诊断 | `benchmark_vision_baseline.py`、`diagnose_player_tracking.py`、`evaluate_identity_cases.py`、`evaluate_vision_problem_cases.py` | 比较耗时、漏检与串号，不把单片段测量当准确率结论 |
| 篮球专用检测对照 | `benchmark_ebard.py` | E-BARD YOLOv8n 与通用 YOLOv8s 的同素材离线对照；不修改正式候选或草稿 |
| 篮球专用候选生成 | `build_ebard_review_tracks.py`、`render_ebard_tracking_demo.py` | 已完成的新模型样例生成与人工指定区间演示；保留原候选，已有输出拒绝覆盖，复跑需指定新输出路径。ByteTrack 后续由另一合作者接手 |
| 球場与脚点实验 | `analyze_court_geometry.py`、`benchmark_ground_anchors.py`、`probe_kalicalib.py` | 姿态与场地模型仍为离线实验，米制位置待独立验收 |
| 场地 / 脚部模型对照 | `probe_court_models_v2.py`、`probe_feet_models.py` | YOLO11n 48 点 / KaliCalib / LSD 与 RTMPose-s / YOLOv8s-pose 的真实本机比较；输出提议，不能直接当真值 |
| 镜头跟随候选 | `court_propagation.py`、`build_court_review_candidates.py`、`scene_profiles.py` | 从具名地面种子做 SIFT / LK 跟随，严格验证帧、哈希与来源，失败留空；工作台显式采用 |
| 回归检查 | `test_player_proposals.py`、`test_review_video_trim.py`、`test_review_variants.py`、`test_ebard_review_tracks.py` | 候选匹配、实际裁切、多模型帧同步与角色 / 对象隔离 |
| 场地 / 脚点接口检查 | `test_court_propagation.py`、`test_scene_profiles.py` | 已知运动、切镜停止、坏候选拒绝、实际裁切后的时间和版本绑定 |

启动方法见[工程入口](../README.md)，实验参数见[技术研究](../research/README.md)。根目录 `scripts/validate_video_data.py` 仍负责全仓视频登记 / LFS 检查，`scripts/requirements/` 只负责历史手册生成；这两类仓库维护工具不混进工作台服务。
