# 交接：工作台主入口切换 v4 Astra 全员姓名识别

- 日期 / 时区：2026-10-09 22:48，America/New_York。
- 成员：chuali-zi。
- 任务 / Issue：用户要求检查并替换旧版前端姓名接线；开工时远端没有开放 Issue。
- 分支：main。
- 提交：本记录随 `fix: connect workbench to Astra player names` 提交；实际提交号以 Git 历史为准。
- 状态：实现与本机验收完成。

## 本次完成

- 顶部「球员姓名识别」直接进入 v4 面板；旧单人 OCR 不再自动挂载，保留人工名单修正。
- 客户端展示实际姓名 provider / model，未配置时禁用启动；服务默认 OpenRouter Astra，无 Key 时可打开工作台并查看原因。
- 官方 001 的库记录带入赛季、比赛编号与 A/B 实际球队；已有草稿信息优先，不改动人物绑定。
- 重建 `ui.bundle.mjs`，整理表单字段排列。完整说明见[接线记录](../../engineering/docs/player-name-workbench-integration-20261009.md)。

## 结论与依据

- 旧顶部按钮仍指向单人 OCR，新的全员姓名面板原先隐藏；状态接口虽已配置 Astra，前端未显示。
- 实际 8892 服务一度运行于 `tmp/ui-broadcast/`，主目录修改不会更新该副本。已先在浏览器保存草稿，改为从主目录启动相同端口，保留 `tmp/ui-layout-20261009/` 工作数据，未改动独立 UI 工作区文件。
- `workbench-shell.mjs` 通过 bundle 使用，改源码后必须执行 `npm run build`。
- 依据为当日本地代码、进程、API、浏览器和[前轮官方视频验收](../../engineering/docs/official-astra-names-and-reliability-20261009.md)，未新增外部资料。

## 验证

- Node 定向 51 项通过；Python 姓名、任务、HTTP 服务 83 项通过。
- 实际应用初始化不调用旧 OCR，完整十人草稿通过新接口提交；采用姓名仍需显式点击，人工身份与有限区间约束保留。
- bundle 构建成功，`validate_video_data.py --check-index` 通过 166 条，`git diff --check` 通过。
- 真实 8892 状态为 OpenRouter / `openai/gpt-6-astra` / available=true；官方 001 表单正确，主按钮定位新面板，浏览器控制台无错误。
- 本轮没有重新调用付费姓名推理或生成新成片。截图与启动日志留在 `artifacts/name-workbench-20261009/`。

## 阻塞与待确认

- 无本次接线阻塞；其他电脑需自己的 OpenRouter 凭据和官方原片。未部署云端。
- 单个球员的历史参考续接工具仍单独保留；本次不是将所有历史 Agent 改为 Astra。

## 下一步

- 在当前工作台点「球员姓名识别 → 识别全员姓名」，核对完成后的候选，再「加入候选结果」；有效区间的姓名即可供画面叠加与成片使用。
- 若另一个本地 UI 工作区接管 8892，须同步本次提交并重建 bundle，避免重新服务旧入口。

## 同步状态

- 开工与提交前均 fetch 核对 `57e8ecc`；本轮仅选择相关代码、清单、说明和交接提交并推送 main，推送后由聊天报告远端核对结果。
- 工作区其他未跟踪研究资料与历史交接未纳入本次提交；本机媒体与日志不入库。
