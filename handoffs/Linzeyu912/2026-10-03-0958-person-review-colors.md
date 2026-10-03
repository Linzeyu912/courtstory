# 交接：统一人物标定与跟踪的审核颜色

- 日期 / 时区：2026-10-03 09:58，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：用户本轮要求人物跟踪、人物标定与球场标定统一蓝绿审核颜色；远端开放 Issue 检索返回空列表，未绑定新 Issue
- 分支：codex/local-workbench-20261002（用户明确要求在现有非主分支先完成本地改进）
- 提交：未提交、未暂存、未推送
- 状态：本地实现与验证完成

## 本次完成

- [tracking-display.mjs](../../engineering/tools/player-review/tracking-display.mjs) 新增尾迹分段状态：机器结果蓝色，明确确认的当前帧轨迹点绿色；连接线仅在相邻两帧均确认时变绿，保留缺口与冲突断点。
- [app.mjs](../../engineering/tools/player-review/app.mjs) 将原视频临时 T 尾迹改为机器蓝色，所选人物尾迹按帧绘制审核颜色，并给球员槽位传入当前帧状态。
- [identity-ui.jsx](../../engineering/tools/player-review/identity-ui.jsx)、[pipeline.css](../../engineering/tools/player-review/pipeline.css) 为“球员标定”和“轨迹补全”共用的槽位标签、身份状态与确认按钮统一蓝绿提示；红蓝球队分组保持原含义。
- [index.html](../../engineering/tools/player-review/index.html) 补充视频轨迹颜色图例；重建 `ui.bundle.mjs`。
- [review-status.test.mjs](../../engineering/tools/player-review/review-status.test.mjs) 新增 2 项回归测试，覆盖单帧确认不扩散、相邻确认连接线、缺口、冲突与待确认修改。
- 更新[工程 README](../../engineering/tools/player-review/README.md)。本轮前的本地备份和截图在被忽略的 `artifacts/person-review-colors-20261003/`。

## 结论与依据

- 依据：2026-10-03 用户明确要求“蓝色是机器做好的跟踪，绿色是人工确认正确的地方”，并要求人物步骤也统一；这是产品约定，非赛事官方要求。
- 延续[上一轮审核颜色记录](2026-10-03-0950-review-status-colors.md)：单帧人物确认与球场投影确认分别保存，不从批量归并或机器传播推断人工确认。
- 绿色人物点表示本帧人物身份已确认；脚点和球场位置仍需各自核对。轨迹渲染没有改动确认数据或坐标计算。
- 保留工作区已有 [P8 冲突纠正改动](2026-10-03-0953-p8-conflict-correction.md)，本轮仅叠加审核显示，不计为本轮功能。

## 验证

- `node --test --experimental-test-isolation=none --test-reporter=dot *.test.mjs`：241 项通过。使用进程内测试模式规避本机子进程启动限制。
- 使用已安装的 Windows esbuild 直接构建 JSX：成功。
- 浏览器在 `http://127.0.0.1:8890/?sample=005&variant=ebard&qa=1` 测试草稿验证：初始槽位、身份标签和时间轴均为机器蓝色；确认第 1 帧后三处变绿，第 2 帧仍蓝；切换“轨迹补全”沿用状态；第 20 帧确认及返回“球员标定”一致；两次撤销恢复测试前人物确认状态。
- 浏览器控制台无错误。截图 `artifacts/person-review-colors-20261003/person-review.jpg` 已检查；正式草稿未操作。
- `git diff --check` 通过；README 与本交接的本地链接检查通过。

## 阻塞与待确认

- 无本地实现阻塞。尚未提交或发布，等待用户本地验收。

## 下一步

- 用户在正常草稿刷新工作台后验收蓝绿状态；需要同步时再按明确授权选择性整理当前任务文件。工作区混有其他本地任务改动，不能全部打包提交。

## 同步状态

- 本轮全部留在本地工作分支。未切换 main，未修改远端。前轮 Git 远端访问受本机代理限制，本轮未执行同步；本地资料不代表远端最新状态。
