# 本机开发与工作台环境

整理日期：2026-10-05，Asia/Shanghai。以下沿用现有工程与交接记录；本次目录整理没有重新安装软件或运行模型。

## 使用已有工作台

从仓库根目录执行；先按 [视频入口](../../data/videos/README.md)取得需要的 Git LFS 成片。默认验收样例为 005，004 只保留部分历史候选。

```powershell
git lfs pull --include="data/videos/tactics/acceptance/clips/**" origin
python -m venv .venv
& .venv/Scripts/python.exe -m pip install -r engineering/requirements-review.txt
& .venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

打开 `http://127.0.0.1:8876/?sample=005`。浏览已有候选不需要 CUDA 或模型权重；导入新视频的自动检测有额外依赖，见[模型环境](model-runtime.md)。不要把“网页能打开”当作所有模型功能已准备好。

## 修改与测试工程

- 前端：在 `engineering/tools/player-review/` 执行 `npm ci`、`npm run build`、`npm test`。
- Python：从根目录执行 `python -m unittest discover -s engineering/scripts -p "test_*.py"`，使用已装好工程依赖的解释器。
- 视频处理：依赖 PyAV；成片另外需要 Node、Sharp、FFmpeg 和字体，实际接口见[成片指南](../../engineering/docs/tactics-authored-production-guide.md)。
- 依赖以[工作台 Python 清单](../../engineering/requirements-review.txt)、[前端 package.json](../../engineering/tools/player-review/package.json)及具体功能说明为准。

22:03 已有交接记录 Node `24.14.1`、npm `11.11.0` 可用；视觉环境的 Python / PyTorch / CUDA 版本见[模型运行记录](model-runtime.md)。这些是对应机器的实测版本，不代表团队所有电脑都已安装。

## 文件位置

| 内容 | 位置 |
| --- | --- |
| 共享代码、项目依赖清单 | `engineering/` |
| 共享成片、标签与候选 | `data/` |
| 模型、第三方源码、专用虚拟环境 | 被忽略的 `tmp/` |
| 新实验结果、预览与检查中间文件 | 被忽略的 `artifacts/` |
| 用户导入原片与草稿 | `data/local-videos/`、`data/local-workbench/` 的本机内容 |

研究专用环境在相应专题的复现说明中维护，例如 [Hoop 模型复现](../../research/basketball-models/mentor-components-20261005/REPRODUCE.md)。工作台功能操作集中在[工程入口](../../engineering/README.md)。
