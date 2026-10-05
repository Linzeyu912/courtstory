# 工程入口

更新：2026-10-05，Asia/Shanghai。这里集中软件、产品设计与技术实验；[赛事要求](../requirements/README.md)、[视频数据](../data/videos/README.md)和[团队协作](../docs/workflow.md)分别维护。

本轮[仓库清理](docs/repository-cleanup-20261005.md)已完成并分类推送：旧入口与像素尾迹删除、候选去重、七个历史脚本归档；默认验收样例改为 005。三条实现提交及后续文档同步见[发布交接](../handoffs/Linzeyu912/2026-10-05-1014-cleanup-classified-publication.md)，既有功能进展仍见下方汇总。

优先阅读[当前成果、问题与调研汇总](docs/progress-and-open-issues-20261004.md)：包含分类提交、THY 整合、已知失败、最新回归与接续建议。离线全场标定尚未接入工作台默认后端，矩阵覆盖和人物联合准确性分别记录。

| 部分 | 位置 | 当前作用 |
|---|---|---|
| 素材标签人工审核 | [tools/material-label-review/](tools/material-label-review/README.md) | 逐项评价、去留决定与落盘；当前标签及人工来源见结构化素材目录 |
| 人工复核工作台 | [tools/player-review/](tools/player-review/README.md) | 直播多区间裁剪、P1–P10 身份分界、轨迹补点与同步 2D 球场 |
| Python 服务及视觉工具 | [scripts/](scripts/README.md) | 本机 HTTP 服务、裁剪与候选处理；检测、跟踪与场地实验单独运行 |
| 历史专用脚本 | [archive/](archive/README.md) | 旧单片球衣实验和旧素材审核生成器；不作为当前工作台入口 |
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

打开 `http://127.0.0.1:8876/?sample=005`。候选 JSON 与已构建的 React bundle 已入库，运行工作台不需要 GPU、下载模型或联网 CDN。草稿保存在当前浏览器；来源原片、模型、生成剪辑与缓存仍在根目录被忽略的 `data/raw/`、`tmp/`、`artifacts/` 中。

修改前端后，在 `engineering/tools/player-review/` 执行 `npm ci`、`npm run build` 和 `npm test`。Python 检查从根目录执行：

```powershell
& .venv/Scripts/python.exe -m unittest discover -s engineering/scripts -p "test_*.py"
```

Python 运行依赖见[requirements-review.txt](requirements-review.txt)，视觉模型实验的额外环境见[本机测量说明](research/vision-local-aws-deployment.md)，离线全场求解另见[可选依赖](requirements-court-fullcourt.txt)。目前工作台已支持 OCR 候选证据、身份续接候选、战术 Agent 生成 / 预览 / 采用和人工图形编辑，但真实调用成功、身份与米制精度仍需逐项核对。自动直播分类、完整战术讲解和云部署尚未完成；当前导入不会自动运行姿态模型。字段是内部原型约定，不是赛事官方数据格式。
