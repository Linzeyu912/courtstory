# 交接：修复对比视频中后段 2D 映射缺口

- 日期 / 时区：2026-10-04 16:10，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：本聊天用户要求修复图像到 2D 的转换，每段超过 90% 帧可见并尽量准确；本轮 GitHub 开放 Issue 查询为空，没有代分配职责。
- 分支：main
- 提交：未提交；开工时 HEAD / origin/main 同为 `0dec1e33a5fd6805ea61375d654e60d2a9f3b13c`
- 状态：本地实现、三样本验收及报告更新完成；真实米制精度仍待独立真值核验

## 本次完成

- [court_propagation.py](../../engineering/scripts/court_propagation.py) 增加同镜头近期地面参照、短时直接光流恢复、与相邻运动的一致性检查；原人工控制点、门限、模型重估、点线优化和切镜保护保留。
- [test_court_motion_recovery.py](../../engineering/scripts/test_court_motion_recovery.py) 覆盖原参照移出画面、黑帧恢复及切镜停止。
- [export_comparison_maps.mjs](../../engineering/scripts/export_comparison_maps.mjs) 增加显式候选目录，使用真实前端采用与矩阵消费函数导出；[audit_comparison_mapping.py](../../engineering/scripts/audit_comparison_mapping.py) 核验矩阵及两类实际投影点的逐帧覆盖。
- [render_model_comparisons.py](../../engineering/scripts/render_model_comparisons.py) 使用空心黄圈、实心青点及深色描边，显示映射点数量；保持原始帧、检测、脚部候选和不平滑的对比。修正 004 慢放倍率说明。
- 新候选和验证在忽略目录 `artifacts/court-mapping-repair-20261004/`，最终版本为 `verified/`、`maps-verified.json`、`acceptance.json`、`render-verification.json`、`source-verification.json`。`local-anchors-*` 是中间实验，不作交付。
- 本聊天原会话 `outputs/` 中九段 MP4、海报、HTML 报告、矩阵、ZIP 和验证文件已更新；旧版备份在会话 `work/report-before-mapping-repair/`。沿用原本机报告 `http://127.0.0.1:8898/`，视频缓存版本 `mapping-repair-3`。
- 工程结论写入[球场后端说明](../../engineering/docs/court-calibration-backend.md)和[模型 / 地面映射对比说明](../../engineering/docs/ground-mapping-ocr-comparison.md)。

## 结论与依据

- 2026-10-04 逐帧审计确认，004 / 006 旧报告取较早的固定参照缓存。镜头移动后固定 SIFT 不足，相邻 LK 用尽上限便停止输出矩阵。006 原缺口为第 198–236、318–384、407–462 帧（从 1 开始）；原图能识别人不能代替当帧球场矩阵。
- 修复后：004 为 210/210（100%），005 为 143/143（100%），006 为 461/462（99.78%）。六种姿态候选各自同时显示黄圈与青点的帧比例均达到对应样本的上述值；只代表每帧至少各一类标记，不代表十人完整。
- 006 第 418 帧仍无可靠矩阵，保留缺失。恢复依赖新图像证据，没有冻结矩阵、补造脚点或靠显示平滑凑覆盖率。
- 005 点线联合校正被采用；004 线证据不足、006 联合解几何超限的修正未被采用。006 有可见场线偏差，数值互逆与内部线拟合都不能当真实米制精度。
- 来源：本地已登记 004 / 005 / 006 原视频、既有 E-BARD 检测、前轮六模型完整输出，以及本轮代码和实验文件；采集 / 复核日期 2026-10-04。此次没有新增外部模型、改变原权重或重新推理人物检测。

## 验证

- Python 球场相关共 43 项通过：`test_court_motion_recovery`、`test_court_propagation`、`test_court_calibration`、`test_court_orientation`、`test_court_line_refinement`、`test_court_initialization_trim`。来源帧字段调整后，新增三个运动测试再次通过。
- 合成长平移测试所有输出控制点相对已知真值在 2 px 容差内；黑帧仍无效，恢复不跨切镜。真实 815 帧重算后，814 帧可映射；矩阵互逆最大误差约 `5.33e-15`。
- 18 组原始姿态数据与新映射逐帧核对，两类有效球场标记均超过 90%；源视频哈希及检测指纹一致。
- 最终九段 MP4 全部完整解码（各样本三段分别 210 / 143 / 462 帧），播放索引前置；最终加深描边后再次全量解码与哈希记录。原报告地址九段文件的真实 Range 请求均返回正确 206 和对应字节。
- 浏览器验证新报告 006 播放至末帧，能看到后段 2D 标记，`readyState=4`，无控制台错误；当前截图保存在交付目录 `mapping-repair-playback.jpg`。004 / 005 / 006 的旧新球场线反投影截图同时留存。
- 独立 8899 工作台 QA 载入 006 并采用新矩阵，461 帧有效、末帧矩阵可用；正式草稿未覆盖。QA 晚段部分新 T 未关联 P，因此工作台固定身份显示不作为本次报告覆盖率依据。
- Python 语法、导出脚本 `node --check`、文档链接与 `git diff --check` 检查；未重新运行全套前端回归。前轮 320/322 及其基线失败为历史结果。

## 阻塞与待确认

- 无阻碍此次三段样本覆盖验收的阻塞。真实地面定位精度、起跳时脚点含义、遮挡和跨镜头通用性仍需独立人工标注；本次不称 99.78% 准确率。
- 原报告的 `playback-fix-verification.json`、`report-range-verification.json`、`2d-marker-diagnostics.json` 是前轮证据。当前以 `video-verification.json`、`mapping-repair-range-verification.json`、`mapping-repair-acceptance.json` 为准。
- 共享候选登记仍保留原文件。修复已用于对比报告和独立预览；其他工作台旧草稿需要显式重新生成 / 采用候选，不能宣称所有历史草稿自动更新。

## 下一步

- 人工检查报告中的场线反投影，优先 006；标注少量独立地面参照，量化米制误差与漂移。继续保留用户的 YOLOv8n 和原始观测。
- 需要迁移正式工作台时，在同源样本生成并核对新候选后显式采用，保留已确认的人工参照；不要自动清空身份或球场草稿。

## 同步状态

- 本轮仅本地修改，未提交、未推送、未建分支或 PR。开工 `git fetch origin` 成功，HEAD 与 origin/main 一致；这不意味着未提交的本次修复已在远端。
- 工作区另有人物可见性、跟踪显示、身份编辑等未提交改动；全部保留，不纳入本次完成范围。`docs/status.md` 仅追加本轮条目，不覆盖其他会话记录。
- 未修改共享 `data/videos/` 或 Git LFS 索引；成片和中间数据留在本机忽略目录，没有组外分享或云部署。
