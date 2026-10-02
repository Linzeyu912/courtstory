# 交接：取消球员误关联与红蓝队槽位交换

- 日期 / 时区：2026-10-02 20:46，Asia/Shanghai（UTC+08:00）
- 成员：Linzeyu912
- 任务 / Issue：本聊天用户要求前后端增加取消错误识别、红蓝两行拖动交换；以会话要求为范围，未取得远端 Issue 最新状态。
- 分支：main
- 提交：未提交；基线 HEAD 为 `72c74e041fd673de81488ebdf48cb97d39427bda`
- 状态：已完成本地实现与验证

## 本次完成

- `engineering/tools/player-review/identity-ui.jsx` / `pipeline.css`：红队 P1–P5、蓝队 P6–P10、裁判单列；Pointer Events 拖动交换，点击 / 键盘替代，攻防角色选择，区间取消和整段清空。重新构建 `ui.bundle.mjs`。
- `app.mjs`：接入本机编辑 API；请求期间草稿变化会拒收过时响应；自动保存沿用视频 / 检测版本草稿键。撤销同时恢复人物数据和选中槽位，全部取消的人不再计入已对应人数。
- `identity-timeline.mjs` / `trajectory.mjs` / `court.mjs` / `manual-path.mjs` / `workspace.mjs`：取消区间优先于旧模型、人工点和球场点，禁止插值和手绘填回；重新确认后可继续跟踪。旧草稿归一红蓝槽位，导出团队与取消来源信息。
- `engineering/scripts/review_session.py` 与 `test_review_session.py`：增加验证和副本运算；`serve_player_review.py` 新增 `/api/review-edit` 路由。
- 更新 [工作台说明](../../engineering/tools/player-review/README.md)。截图在本机忽略目录 `artifacts/roster-review-qa/roster-interactions.jpg`、`release-identity.jpg`。

## 结论与依据

- 来源：2026-10-02 本聊天用户明确要求“机器选错也能取消”“第一行红队、第二行蓝队，拖动交换”“前后端都做，保存在本地，不要推送”。这些是内部产品行为，不是赛事要求。
- `release_identity` 从当前帧起到下一次身份确认 / 关联区间开始 / 切镜之前停止关联，保留之前和之后的确认。后端追加 `kind: unassigned` 区间；输出空点带 `reviewExcluded: true`、`identitySource: human_unassigned`。保留旧记录便于撤销和审查，但不把它们继续用于位置计算。
- `clear_player` 清空此槽位的锚点、身份时间点、关联区间、球场点及事件；姓名、球队描述、号码保留。
- `swap_players` 交换完整人物记录，固定槽位编号及颜色不移动；真实姓名 / 球衣资料、所有轨迹与修正随人移动。攻防描述当前片段，默认未指定，手动设置，不自动推断球权。
- 请求 `{sample,variant,qa,session,operation}` 返回 `{session,message,affectedRange?}`。仅新接口支持最大 16 MiB 草稿；验证视频哈希、版本、唯一槽位、帧范围及数值。服务不写草稿、不修改检测输入；前端仍负责 localStorage。
- 草稿 version 1、导出 schema 2 继续兼容。新增 `teamRoles` 与实体 `teamSide`；固定 P1–P5 red、P6–P10 blue。取消、清空、交换均使整队身份确认失效，需再检查。

## 验证

- JavaScript：`node --test --test-isolation=none *.test.mjs`，在 `engineering/tools/player-review` 执行，73/73 通过。新增 8 项：取消阻断原图 / 2D 旧点与插值、切镜和后续确认边界、再次确认、手绘跳过、旧草稿 / 导出红蓝归一。普通 Node 子进程隔离受 Windows 沙箱 EPERM 限制，使用同进程模式完成。
- Python：16 项新增单测和真实 loopback HTTP 检查通过；完整 `engineering/scripts/test_*.py` 回归 76/76 通过。覆盖不可变输入、错误请求、完整人物交换、下一边界、同帧优先、旧草稿、来源切镜、请求大小及不写磁盘。HTTP 临时目录测试经自动审批在本机完成。
- `npm.cmd run build`、JavaScript 语法、Python 编译和 `git diff --check` 通过。
- 浏览器：8879 独立服务、样例 005、`qa=1` 草稿。实际拖动 P1→P6，核对姓名与 T1/T2 交换；键盘替代和撤销恢复所选对象；红攻蓝守联动；第 1 帧整段取消后计数减少、10 人确认受阻，刷新后仍取消；后帧取消保留之前的关联，撤销和重新关联恢复；整段清空保留姓名；采用既有标定候选后取消使所选球员可用 2D 位置降为 0；无浏览器脚本错误。
- 1280×720、1440×900 / 1000、390×844 检查；窄屏红蓝各 5 槽，无整页横向溢出。视口覆盖已重置。
- 已核对原 PID 命令并重启正式 8876 服务，当前进程写入既有 `artifacts/vision-player-refinement/review-server.json`；使用纯请求草稿验证新 API HTTP 200。正式 004 页只读加载成功，保留用户已有 3 个球员草稿，未代操作正式标注。

## 阻塞与待确认

- 无功能阻塞。模型识别质量、球场米制精度和真实攻防归属不属于本轮验证结论。
- 工作区包含其他会话的球场初始化代码与文档。此次仅在同一 server 文件增加独立路由，保留该会话已有实现；重启服务同时加载了它们。其模型精度及接口验证见独立 [球场后端交接](2026-10-02-2010-hoop-court-backend.md)。

## 下一步

- 用户刷新 8876 页面，在当前正式草稿按实际人物检查红蓝队归属和取消范围；已有历史数据不自动推断攻防。
- 如将来获准提交，只选择对应任务文件；前一轮抽屉 UI 和本轮有重叠文件，需一起核对已有 diff。

## 同步状态

- 全部修改留在本机 main；本轮没有提交、推送、建分支或 PR。
- 远端读取受当前代理连接失败影响，未重新同步，不声称 GitHub 已可用。
