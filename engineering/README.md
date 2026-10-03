# 工程入口

更新：2026-10-02，Asia/Shanghai。这里集中软件、产品设计与技术实验；[赛事要求](../requirements/README.md)、[视频数据](../data/videos/README.md)和[团队协作](../docs/workflow.md)分别维护。

| 部分 | 位置 | 当前作用 |
|---|---|---|
| 人工复核工作台 | [tools/player-review/](tools/player-review/README.md) | 直播多区间裁剪、P1–P10 身份分界、轨迹补点与同步 2D 球场 |
| Python 服务及视觉工具 | [scripts/](scripts/README.md) | 本机 HTTP 服务、裁剪与候选处理；检测、跟踪与场地实验单独运行 |
| 产品设计 | [docs/agent-concept-review.md](docs/agent-concept-review.md) | 解说 Agent 讨论稿，技术选型及完整产品待验收 |
| 技术研究与测量 | [research/](research/README.md) | GPU 基线、身份、脚点和球场映射；保留单片段和推断边界 |

新增 [NBA解释与纠错层离线研究](research/nba-evidence-study-20261002/README.md)：四样例baseline、来源Schema、故障注入、投影/身份/球候选与事实放行比较。研究产物归档，独立准确率与真实延迟未建立；原检测器和总结模块未改动。

## 启动数据提取工作台

从仓库根目录执行。已有视频在 Git LFS；首次拉取至少下载验收样例：

```powershell
git lfs pull --include="data/videos/tactics/acceptance/clips/**" origin
python -m venv .venv
& .venv/Scripts/python.exe -m pip install -r engineering/requirements-review.txt
& .venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876
```

打开 `http://127.0.0.1:8876/?sample=004`。候选 JSON 与已构建的 React bundle 已入库，运行工作台不需要 GPU、下载模型或联网 CDN。草稿保存在当前浏览器；来源原片、模型、生成剪辑与缓存仍在根目录被忽略的 `data/raw/`、`tmp/`、`artifacts/` 中。

修改前端后，在 `engineering/tools/player-review/` 执行 `npm ci`、`npm run build` 和 `npm test`。Python 检查从根目录执行：

```powershell
& .venv/Scripts/python.exe -m unittest discover -s engineering/scripts -p "test_*.py"
```

Python 运行依赖见[requirements-review.txt](requirements-review.txt)，视觉模型实验的额外环境见[本机测量说明](research/vision-local-aws-deployment.md)。目前工作台是本机原型：未实现自动直播分类、球衣 OCR、完整战术讲解或云部署，检测身份与米制坐标仍需人工核对。字段是内部原型约定，不是赛事官方数据格式。
