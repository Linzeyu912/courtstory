# 黄白球衣单片实验归档

归档日期：2026-10-05，Asia/Shanghai。依据本轮用户同意清理旧入口；保留旧算法和来源，不重新运行模型。

| 脚本 | 历史用途 |
|---|---|
| [basketball_player_filter.py](basketball_player_filter.py) | 按原样例的区域及服装特征筛选候选 |
| [jersey_tracker.py](jersey_tracker.py) | 黄白球衣约束 ByteTrack；不是通用球员 ReID |
| [prepare_player_review.py](prepare_player_review.py) | 生成旧球衣复核候选 |
| [diagnose_player_tracking.py](diagnose_player_tracking.py) | 对该实验的跟踪结果做诊断 |
| [render_vision_tracking_demo.py](render_vision_tracking_demo.py) | 生成旧检测跟踪演示 |

`prepare_player_review.py`、`diagnose_player_tracking.py` 和 `render_vision_tracking_demo.py` 是命令行入口，可从仓库根目录运行 `python engineering/archive/vision-clip001/<脚本>.py --help` 查看原参数；另两个文件是内部依赖。仍需原实验的模型、GPU 环境、来源视频和配置；这些本机输入没有随本次归档新增共享。三个命令行入口继续使用当前 `engineering/scripts/player_proposals.py` 通用候选辅助函数。

当前导入使用 `process_local_video.py` → `basketball_run.py`，篮球 / 篮筐参照继续使用 `build_ebard_review_tracks.py`。归档脚本不参与这条链路。既有研究及交接保留当时路径文字，可点击链接已更新。
