# 视觉研究脚本

这里保存独立的模型测量、错误诊断与场地 / 脚点对照脚本。从仓库根目录调用，不在本目录运行工作台服务。

| 脚本 | 用途 |
| --- | --- |
| `benchmark_vision_baseline.py` | 检测跟踪基线与耗时 |
| `evaluate_identity_cases.py`、`evaluate_vision_problem_cases.py` | 已记录身份 / 漏检案例检查 |
| `analyze_court_geometry.py`、`benchmark_ground_anchors.py` | 球场几何与地面锚点比较 |
| `probe_kalicalib.py`、`probe_court_models_v2.py` | 场地模型离线探针 |
| `probe_feet_models.py` | 脚部候选对照 |

先查[视觉研究入口](../README.md)及[环境准备](../../../environment/local/README.md)。例如 `python research/vision/scripts/analyze_court_geometry.py --help` 可查看参数；模型脚本需要专题注明的额外依赖，不代表基础 Python 环境即可运行。

工作台或候选生成器正在复用的公共算法仍保留在 `engineering/scripts/`。例如 `benchmark_ebard.py` 的检测辅助函数被正式候选生成器调用，不能按文件名含有 benchmark 就随意移走。研究复现可以调用这些工具，实验结论与结果存于研究目录。
