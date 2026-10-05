# 交接：场地结构校准、配色与移动镜头调研

- 日期 / 时区：2026-10-01 22:46，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：用户要求修正疑似禁区被当成整场的问题、改善配色、增加人工校准并调研非 YOLO 场地识别；开工查询远端开放 Issue 列表为空，未新建 Issue。
- 分支：main
- 提交：未提交、未推送；延续本机视觉原型开发。
- 状态：本轮界面、人工校准及离线诊断完成；自动语义识别与空间精度未验收。

## 本次完成

- [工作台说明](../../engineering/tools/player-review/README.md)：浅枫木色球场、灰蓝禁区；默认进入球场标定；明确 ABCD 只是禁区。
- [几何模块](../../engineering/tools/player-review/court-geometry.mjs)提供 A–J 语义点、全场线模板、多点单应矩阵和求逆。[计算](../../engineering/tools/player-review/court.mjs)支持新旧标定格式及不同控制点集合之间的关键帧估计。
- [界面](../../engineering/tools/player-review/workspace.mjs)支持单点新增、重选、停用、删除、撤销；不足四点时停止映射；原视频显示禁区、三分线、边线、底线、中线的投影，显示用于拟合的点残差。
- [扩展参考](../../research/vision/vision-player-refinement/clip001-court-expanded.json)新增远侧边界交点，首帧 6 点，其余 8 帧各 5 点；旧四角原始快照保持原值。重载参考保留手工编辑过的整帧，球员锚点另存。
- [离线诊断脚本](../../research/vision/scripts/analyze_court_geometry.py)、[研究结论](../../research/vision/vision-player-refinement/court-calibration-research.md)、[实测摘要](../../research/vision/vision-player-refinement/court-geometry-audit.json)。更新团队状态及调研索引。
- 本机服务增加新模块路由并使用扩展参考；`http://127.0.0.1:8876/` 已打开新版。进程记录在 `artifacts/vision-player-refinement/review-server.json`，图像和逐帧中间数据在 `artifacts/court-calibration-audit/`，均为被忽略的本机产物。

## 结论与依据

- 原代码把 ABCD 映射到 5.79 × 4.88 米禁区，尺寸未误当整场；但局部四角外推误差明显。首帧中线与远侧边线交点旧投影距目视参考约 86 px。此点加入新拟合后不能再作为独立验收点。
- 地面脚点转换可以先求逐帧平面单应矩阵，不必先输出物理相机夹角；唯一可信角度还需内参或额外约束。[OpenCV 官方教程](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)，2026-10-01 读取。
- 调研篮球专用 [KaliCalib](https://github.com/CEA-LIST/KaliCalib)、足球的 SoccerNet / PnLCalib / TVCalib；来源、能力边界及配置在研究文档中。仅查阅，未安装这些模型。
- NBA 几何依据[官方规则](https://official.nba.com/rule-no-1-court-dimensions-equipment/)，2026-10-01 读取。研究建议不代表团队或赛事结论。

## 验证

- `node --test tools/player-review/trajectory.test.mjs tools/player-review/court.test.mjs`：25 / 25 通过，其中新增 4 项多点及兼容测试。
- `node --check`：app.mjs、workspace.mjs 通过；两个 Python 文件 `py_compile` 通过。`git diff --check` 通过。
- 243 帧扩展参考映射数值可逆；没有独立物理精度真值，不能据此计算速度或距离。
- 浏览器 QA：单点 E 重选只改该点；停用至 3 点后映射为空且产生待标定区间；删除、撤销和重载参考保留人工帧均正常。测试数据修改已全部撤销。
- 正式草稿保留 P1 的 3 个原图人工锚点、121 个可用球场位置和 4 段待处理区间。没有替用户选人、合并编号或正式确认导出。
- 正式页面新版截图：`artifacts/court-calibration-audit/workspace-updated.jpg`。
- 浏览器控制台无 error / warn；全场切换正常，完成后恢复滑动半场。新文档的本地链接与 JSON 解析检查通过。
- CPU 4 线程、960 × 540 处理尺寸：001 片段 8.1 秒 / 243 帧，LSD 及光流 / RANSAC 全流程单次约 2.49 秒；首帧 40 个无语义直线候选。未重跑 YOLO，但使用已缓存人物框做遮挡掩膜，首帧由目视参考初始化。
- 242 次相邻帧估计均过实验门槛，末帧与目视参考点中位差仍约 39.9 px，预览存在漂移。质量门槛不等于正确率，纯传播不足以验收。

## 阻塞与待确认

- 无本地运行阻塞。线段候选没有自动语义标签；完整场地识别、三分弧匹配、独立点验收和跨片段泛化尚未完成。
- 前端仍用相邻手工 / 参考关键帧近似估计，没有接入离线光流。相机内参、物理夹角、镜头畸变与自动切镜尚未求解。
- AWS 配置、部署及完整成片十分钟目标未验证。

## 下一步

- 讨论并对照 KaliCalib 与传统点线模板匹配，先建立多片段独立核验点，避免拟合点同时用于验收。
- 镜头内用光流更新，周期性由真实场地线重校；切镜重建映射，失败区间留空。误差阈值和重校频率要由实验决定。
- 后续渲染继续将地面箭头贴回原视频；2D 球场是操作者的数据整理界面。

## 同步状态

- 开工 fetch 成功，本地 HEAD 与 origin/main 均为 `f0d0aa9a19f0c52f157be313ef0c85a58ec26ec7`。已有本地开发增量保留；没有覆盖其他任务文件。
- 本轮未提交、推送、创建 PR、修改 Issue 或创建云资源。不要把本机页面和截图说成云端可用。
