# 本机开发与工作台环境

更新：2026-10-13，Asia/Singapore。本页说明本机环境与资料存放边界；当前安装、启动和功能依赖统一见[本地安装与启动](../../engineering/docs/local-setup.md)。本次只整理文档入口，没有重新安装软件或运行模型。

## 使用已有工作台

先按[本地安装与启动](../../engineering/docs/local-setup.md)准备 Python、Node.js、FFmpeg 和 Git LFS，再从仓库根目录执行其中命令。当前[视频入口](../../data/videos/README.md)只提供 Single 考试输入，默认样例为 `exam-001`；[展示成片](../../deliverables/README.md)单独保存在 `deliverables/`。

直接人工制作与自动识别的依赖不同；模型权重、推理环境与 CUDA 等准备见[模型环境](model-runtime.md)，其中实测版本和验证范围按各自记录日期理解。打开页面不代表所有模型功能均已准备好。

## 修改与测试工程

- 前端：在 `engineering/tools/player-review/` 执行 `npm ci`、`npm run build`、`npm test`。
- Python：从根目录执行 `python -m unittest discover -s engineering/scripts -p "test_*.py"`，使用已装好工程依赖的解释器。
- 视频处理：依赖 PyAV；成片另外需要 Node、Sharp、FFmpeg 和字体，实际接口见[成片指南](../../engineering/docs/tactics-authored-production-guide.md)。
- 依赖以[工作台 Python 清单](../../engineering/requirements-review.txt)、[前端 package.json](../../engineering/tools/player-review/package.json)及具体功能说明为准。

历史说明：2026-10-05（Asia/Shanghai）整理时沿用 005 默认验收样例与部分 004 候选；同日 22:03 已有交接记录 Node `24.14.1`、npm `11.11.0` 可用。上述样例和依赖结果属于当时的工作区，当前启动不再使用 005 地址或旧成片目录。视觉环境的 Python / PyTorch / CUDA 版本见[模型运行记录](model-runtime.md)，不代表团队所有电脑都已安装。

## 文件位置

| 内容 | 位置 |
| --- | --- |
| 共享代码、项目依赖清单 | `engineering/` |
| 输入素材、名单、标签与候选 | [data/](../../data/README.md) |
| 球员赛季与第三方评分资料 | [2K Player Data/](../../2K%20Player%20Data/README.md) |
| Single 展示成片与字幕 | [deliverables/](../../deliverables/README.md) |
| 模型、第三方源码、专用虚拟环境 | 被忽略的 `tmp/` |
| 新实验结果、预览与检查中间文件 | 被忽略的 `artifacts/` |
| 用户导入原片与草稿 | `data/local-videos/`、`data/local-workbench/` 的本机内容 |

研究专用环境在相应专题的复现说明中维护，例如 [Hoop 模型复现](../../research/basketball-models/mentor-components-20261005/REPRODUCE.md)。工作台功能操作集中在[工程入口](../../engineering/README.md)。
