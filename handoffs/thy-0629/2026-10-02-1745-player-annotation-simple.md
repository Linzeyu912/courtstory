# 2026-10-02：简化球员标注并恢复被隐藏的检测

负责人：thy-0629 / Codex。按用户要求先处理球员框、固定编号和简版前端，轨迹优化后续安排。继续在已有 `main` 工作台修改，没有另建分支、PR、工作台或模型部署。

## 当前入口与改动

入口为 `http://127.0.0.1:8876/?sample=004`；本轮浏览器验证使用同一入口的 `&qa=1` 独立测试草稿。默认首屏是视频、播放 / 逐帧 / 进度、十个数字和“纠正编号”。原模型选择、直播筛选、球场、脚部、对象、轨迹与导出仍在“高级工具”，往返不修改草稿。

保留当前 NBA 专用模型与原检测，不重新推理。打开视频自动补齐可用模型编号，队色未知仍保留灰色数字；没有固定编号但当前检出的球员显示灰框。普通点击只查看，明确纠正才写人工续接，可以撤销。已知模型身份 / 角色冲突显示灰框，显式人工身份优先；独立位置编辑不会升级身份确认。无观测的帧不补坐标。

004 原 r3 分队筛选把十个建议缩为五个，旧前端又默认隐藏没有固定身份关联的检测；这两个环节造成“换成专用模型后反而少框”的显示退化。四段同源未分组建议共恢复636条实际编号观测，004恢复288条。004界面第1 / 71 / 178帧现在分别显示10 / 6 / 3个编号框，另有0 / 4 / 3个未匹配灰框；第178帧三个被隐藏的可见球员重新显示。

源码范围：

- 前端 `engineering/tools/player-review/app.mjs`、`index.html`、`pipeline.css`；新增 `simple-annotation.mjs` / `.test.mjs`。
- 自动编号 `automatic-annotations.mjs` / `.test.mjs`，不改原身份算法、检测生成器和原分队产物。
- `engineering/scripts/serve_player_review.py` 新增只读 `identitySupplement`，以及 `test_player_review_server.py`、`test_review_variants.py`。
- [设计与验收](../../engineering/docs/plans/2026-10-02-player-annotation-simple.md)、[实测报告](../../research/vision/player-annotation-simple-20261002.md)、[操作说明](../../engineering/tools/player-review/README.md)、研究索引和团队状态。

`identitySupplement` 只读取同视频 SHA、同原始检测 SHA、同精确帧 / PTS / 根来源与断点的已校验版本；不改变原检测、元数据、模型 / 原始指纹及浏览器草稿键。剪辑子版本重新计算补充，不套用父帧号。旧人工姓名、队色、身份、脚点、出画记录和已有模型绑定优先保留。手动重新检查自动编号同样只补空位。

## 验证与证据

最终作者完整回归为127项JavaScript、80项Python通过，bundle构建通过且字节保持；15项自动编号和7项真实app交互有RED→GREEN反例。独立审查发现并复现队色修改成功后遗留纠正目标会误写身份的P2，已修复：成功结束纠正并清除目标，失败可重试且不产生虚假撤销项。独立原复现GREEN、22项相关回归及冻结14项SHA检查通过；代码审查无剩余重要问题。

原数据与17版本API的261项保护检查通过；独立最终验收PASS，完成255项GET检查、357项文件 / 备份保留检查、19273项实际帧 / 数据不变量检查、最终7项真实app交互、38项最后源码 / 静态资产核对，以及2项同源补充 / 多切镜与嵌套剪辑回归。最后前端小修只复核变化的源码与交互，保留未变的后端 / 逐帧证据；检查方法不将新 `identitySupplement` 当成原数据改写，不重复推理，不写正式身份 / 剪辑缓存。最终独立代码审查Approve，没有剩余重要问题。

实际浏览器已验证：默认首屏、首帧十个编号、第178帧六个可见框、普通选人不确认、灰框明确续接与撤销、播放暂停与源PTS、高级工具往返，以及灰框候选→普通选P3→改队色→普通选P10不会误绑定。只有队色保存产生一次撤销项，撤销后禁用；临时人工续接及队色测试均已撤销，人工确认回到0。再次刷新直接进入简版第1帧、编号1–10和已保存建议，无警告 / 错误日志；正式草稿与剪辑缓存未操作。

本轮证据使用新目录，不覆盖旧同步、r3或成片记录：

- `artifacts/annotation-simple-20261002/before-preservation.json`、`after-preservation.json`、`browser-final-qa.json` 与最终 `workbench-simple-final.jpg`。浏览器原生截图字节为JPEG，交付文件使用正确扩展名；早先以 `.png` 命名的相同字节及QA引用原样保留，没有覆盖历史证据。
- `artifacts/annotation-simple-20261002/independent-acceptance.json` 与对应独立验收报告。
- `tmp/player-identity-test/simple-annotation-actual-counts.json`、作者前后端报告、最终SHA清单与测试日志。
- `tmp/player-identity-test/annotation-simple-code-review.md`、队色纠正状态独立RED / GREEN证据。
- `tmp/player-identity-test/annotation-simple-independent-verifier-report.md`，包含初次验收与最后前端修复后的增量核对。

## 保存、运行与共享状态

当前主分支基线与 `origin/main` 都是 `72c74e041fd673de81488ebdf48cb97d39427bda`。本轮只做本机修改，没有提交或推送。原同步以来的其他未提交代码和实验继续保留，不将整个脏工作区当成本轮改动。

编辑前备份 `D:\HKS\.sync-backups\broadcastcode-team-hub\20261002-171502\` 已核验60个展开的脏文件和保护数据。旧161244 / 163116备份，以及stash `04282287fe64e3959354eb8d957658632bfe51f0`、`130d7c4cb5f9b822e1e8a43295dc635bdd165290`仍保留。当前备份指针为 `tmp/player-identity-test/github-sync-snapshot.json`，没有stash清理、reset或原数据覆盖。

已核对旧服务PID后在原8876端口加载新服务，实际PID36728，启动器PID8920；状态 / 日志在 `artifacts/annotation-simple-20261002/`。服务源码SHA为 `4a4dd1a01a4633e32bce547bfc143bb1c67dfdaf5b9f2570d2b6b9d523b3881b`。最终app SHA为 `f2cd8ddf83c86427c204ae93cdeb289e900136b2f91a75bfb73e0dd05183ab91`，自动编号核心SHA为 `e8cc5ee357fa92d6d93755dcd66b3f4db2bea9208fafcc7654171d2889dea2ce`；冻结清单在 `tmp/player-identity-test/simple-annotation-frontend-team-fix-checks.json`。前端静态源码使用no-store，后续前端修正刷新即可，不必重启服务。

本机权重、虚拟环境、预计算产物与验证证据仍位于ignored目录，克隆仓库不会自动提供；保留原配置的降级路径。服务读取预计算结果，不具备任意视频上传即推理能力。

## 尚未解决的识别问题

首帧十个框不等于十名不同真人。原检测仍有重复框；004 T29跨队串人已有标记，T9同队串人尚无标记。自动编号只是待复核模型建议，不声称整段锁准十个人。灰框续接需要人工确认正确编号，不对004写特例。真实脚地接触、米制精度、遮挡续接、姓名 / 球衣识别、2K能力对应、战术和慢放仍是后续任务。

本轮修复显示门槛和交互，保持身份数据可追溯。详细操作和原历史流程见工作台说明，后续仍在同一工作台开发。
