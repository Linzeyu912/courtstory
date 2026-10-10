# 工作台接入 v4 全员姓名流程

- 日期 / 时区：2026-10-09，America/New_York。
- 用户要求：检查当前前端是否仍接旧版球员身份识别，并换成已验证的姓名流程。
- 依据：当前 `main` 源码、实际 8892 服务进程和浏览器，以及[官方 001 全流程记录](official-astra-names-and-reliability-20261009.md)。本次没有重新采集外部资料。

## 问题与修正

后端已配置 OpenRouter Astra，但顶部「球队 / 号码识别」仍展开旧单人 OCR 面板；v4 全员姓名面板藏在折叠区，且状态接口的模型信息未显示。旧面板挂载还会自动识别记分牌，造成用户进入了不同流程的印象。

现在顶部「球员姓名识别」展开 v4 面板；完整当前草稿、视频指纹、跟踪版本、赛季和两队信息通过 `player-name-client.mjs` 提交到 `/api/player-name-identity/jobs`，服务复用 `recognize_player_names`。Astra 读取号码 / 球衣证据并比较同人，名单匹配与有限区间采用继续由程序执行。新结果不会自动覆盖人工记录：用户点击「加入候选结果」后，当前帧有有效位置和身份依据的姓名才进入叠加层及导出。

服务默认姓名 provider 改为 `openrouter`，模型 `openai/gpt-6-astra`。无 Key 时服务仍可启动，状态明确说明缺少配置；发起识别仍会拒绝。页面展示真实状态并禁用未配置时的启动按钮，支持 `OPEN_ROUTER_KEY` / `OPENROUTER_API_KEY`。

工作台不再自动挂载旧的单人 OCR，原名单查询保留为「人工填写 / 修正球员身份」。既有单个球员参考续接工具仍独立保留；本次切换的是全员姓名主流程，没有声称替换全部历史 Agent 功能。

官方 001 的库记录新增可选 `nameContext`，值为 2025-26 / 0022500701 / A=HOU、B=DAL，依据已有官方样例与比赛名单记录。前端优先采用草稿已保存的信息；新输入未登记上下文时仍由用户填写，不把这场比赛套到其他视频。此字段是请求提示，不会确认人物归属或改动轨迹。

## 当前本机入口

验收中发现 8892 服务曾从 `tmp/ui-broadcast/engineering/scripts/serve_player_review.py` 启动。服务的静态目录随脚本位置确定，所以修改主目录不会更新该副本。已先通过界面保存浏览器草稿，再将 8892 改为从主目录 `engineering/scripts/serve_player_review.py` 启动，沿用 `tmp/ui-layout-20261009/` 的视频、裁剪、导入、战术和工作集合目录；独立 UI 工作区文件未改动。

另外，`workspace.mjs` 通过 `ui.bundle.mjs` 使用入口模块，更新入口源码后必须在 `engineering/tools/player-review/` 执行 `npm run build`。已重建实际 bundle 并用浏览器重新加载验证。

## 验证

- 51 项 Node 定向回归通过：包含实际 app 初始化不调用旧 OCR、状态展示、当前十人草稿提交到新接口、上下文预填、人工信息优先、未配置禁用以及有限区间姓名采用。
- 83 项 Python 姓名 / 任务 / HTTP 服务测试通过；实际 HTTP 测试覆盖默认 Astra 与 `nameContext` 透传。
- `npm run build` 成功，视频清单与 Git LFS 索引检查通过（166 条）。
- 真实 8892 返回 `available=true`、`provider=openrouter`、`model=openai/gpt-6-astra`，官方 001 的上下文正确；浏览器新入口、表单和服务状态可见，控制台无错误。
- 本轮验证前端接线与真实服务配置，没有再次发起付费全员姓名推理、没有生成新成片。真实 Astra 调用和成片结果见前一轮官方 001 记录。

本机截图及服务日志：`artifacts/name-workbench-20261009/`（忽略目录）。本轮未部署云端。
