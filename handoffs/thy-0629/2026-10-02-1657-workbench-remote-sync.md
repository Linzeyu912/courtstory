# 交接：同步最新工作台并保留本机篮球跟踪改动

- 日期 / 时区：2026-10-02 16:57，Asia/Shanghai
- 成员：thy-0629 / Codex
- 任务 / Issue：用户要求同步 GitHub 新推送，并在预留工作台继续修改；无新 Issue
- 分支：main
- 提交：远端基线 `72c74e041fd673de81488ebdf48cb97d39427bda`；本次兼容整合尚未提交 / 推送
- 状态：已完成同步、兼容合并与独立核验；本机整合未提交推送

## 本次完成

从 `6b3d7f7` 分两轮快进同步四个远端提交：`aa2ba4f` 的 E-BARD 模型选择与角色 / 尾迹 / 对象；`68c7776` 的脚点和球场调研；`b434660` 的场景对象编辑、RTMPose-s 脚部候选、标定向导及逐帧镜头映射；`72c74e0` 的实测和交接。同步前分别保存外部逐文件哈希备份与 Git stash，没有覆盖既有未提交工作或模型产物。

[工作台](../../engineering/tools/player-review/README.md#2026-10-02远端新增入口与本机版本合并)继续作为后续入口：[版本登记](../../data/videos/tactics/acceptance/review-library.json)、`app.mjs`、`identity-ui.jsx` / `identity-timeline.mjs`、`team-overlay.mjs`、`tracking-display.mjs`、`scene-objects.mjs` / `scene-objects-ui.mjs`、`feet-candidates.mjs`、`calibration-guide.mjs` / `court.mjs` 和 `workspace.mjs`。服务及多版本裁切入口在 `engineering/scripts/`。

四段本机默认仍为 `team-stable`，004–006 无本地可选产物时回退共享 `ebard`。固定 P1–P10、两组五人分队、人工字段与精确坐标、原始 / 稳定展示、版本隔离草稿和来源切镜保留。远端 RTMPose 缓存只适用于三个对应的 E-BARD 检测，不套用本机 BoT-SORT 的同号 T；同视频的场地候选可共用。

## 兼容修正

- 新增 API `tracking_raw_fingerprint` 供脚部缓存绑定实际检测文件字节；原 `tracking_fingerprint` 的草稿规则保持。多版本和嵌套裁切同步重映射脚部 / 场地来源，legacy jersey 继续写入 `alternativeTracks`。
- 场景对象点选优先于人物手绘路径，独立导出人工对象；对象操作不写 P 身份 / 位置。步骤切换保持稳定显示，明确的人物位置编辑切到原始几何。
- 删除或重选场地参考后依赖映射失效；旧候选重新载入不会绕过删除意图，独立人工标定、已人工核对并自锚定的投影帧与撤销保留。球场传播请求拒绝非有限 JSON 数值与错误 cuts 类型。

## 验证

- 独立全套：105 项 JavaScript、78 项 Python 全部通过。此次 10 项前端整合回归属于全套子集；reviewer 独立重放原 P2 反例及 33 项相关回归，最终 Approve，没有未解决的 Important / Critical finding。bundle 字节与构建参数一致，最后只改三个相关源码 / 测试文件，其余冻结 SHA 保持。
- 实际四段 / 17 个版本 API 与静态资源：195 项通过；14 个旧草稿命名空间与3个共享E-BARD原始指纹保持，3个脚点缓存仅附正确E-BARD版本，14个不兼容版本返回空。同视频的场地候选跨12个检测版本共用；21个资源和四段视频 Range 响应核对。
- 原数据保护：478 项通过；两套逐文件备份、全部原 dirty 路径、原视频、r3与旧对照产物、25份远端候选字节及历史证据保持。代码的有意合并改动不作为数据字节不变来表述。
- 六个真实隔离 HTTP 剪辑场景 / 782 项通过，覆盖多版本、legacy jersey、两次或三次裁切、裁掉原参考后的独立支持帧及缓存重启。子帧 / PTS / sourceCuts / 元数据 / 脚点原始哈希 / 根来源保持，测试进程已退出；正式裁切缓存前后全文件 SHA 一致。
- 真实浏览器 QA：旧 P3 的姓名、球队、27号及6个精确小数坐标 / step=any 保留；不匹配模型脚部采用按钮禁用。E-BARD P1/T1 左右脚展示、显式采用及撤销、篮筐选择 / 排除 / 恢复均正常，人物身份不受对象操作影响。004 场地候选采用后102帧可预览、108帧保持空，均仍待复核；步骤切换保持稳定显示，最终控制台无 error / warn。全部操作使用 `qa=1` 独立浏览器草稿。

独立完整证据位于 ignored `artifacts/github-sync-round2-20261002/final-acceptance.json` 与对应数据 / API / isolated-trim JSON；执行、review 和日志在 `tmp/player-identity-test/github-sync-round2-*`。当前服务状态、浏览器记录与两张实际截图在 `artifacts/github-sync-20261002/round2/`，最终预览为 `workbench-synced.jpg`。第一轮报告与冻结证据没有覆盖。

## 限制与下一步

本轮是远端同步及必要兼容合并，没有重新推理 / 渲染视频、上传模型、部署 AWS 或实现 pending 编号解耦。十个槽位不等于十名真人已自动识别；RTMPose 点和场地覆盖不证明真实接地或米制准确率。

用户后续方向是在此工作台把已识别球员的固定 P 身份与分队待确认状态分开，遮挡 / 断轨后仍沿用同一个 P，位置缺失保持空，无法确定的 T 关联由人工确认。需要另行实现并用同片复核串号；不要把每个新 T 自动当成新球员或强制凑十个观测框。

## 同步状态

本机 `main` / `origin/main` 均为 `72c74e041fd673de81488ebdf48cb97d39427bda`，最后一次 `git fetch origin` 成功且无新提交。四个远端新增提交已快进到本机，没有新增本机 commit；所有冲突已解决，index恢复同步前的空暂存状态，`git diff --check`通过。本机兼容整合、旧篮球实验代码和交接文档仍是未提交 / 未推送改动，未创建分支 / worktree / PR。

两轮外部备份和 Git stash 均保留作恢复依据。两份备份清单分别为 `../.sync-backups/broadcastcode-team-hub/20261002-161244/manifest.json` 与 `../.sync-backups/broadcastcode-team-hub/20261002-163116/manifest.json`（相对仓库根目录）；ignored `tmp/player-identity-test/github-sync-snapshot.json` 仅指向第二轮。stash 对象为 `04282287fe64e3959354eb8d957658632bfe51f0` 与 `130d7c4cb5f9b822e1e8a43295dc635bdd165290`；没有删除或 drop。原片、标注视频、formal 标注与模型产物未改。

已启动新服务，入口 `http://127.0.0.1:8876/?sample=nba-lal-min-005&variant=team-stable`；加 `&qa=1` 使用独立测试草稿。服务使用本机既有 PyAV / OpenCV 环境读取预计算结果；这次同步不等于在新机器上自动下载权重或部署推理。
