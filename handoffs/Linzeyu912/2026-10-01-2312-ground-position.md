# 交接：脚下点、球场坐标与独立核验

- 日期 / 时区：2026-10-01 23:12，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：用户要求研究并尝试可靠的球员地面位置还原；读取远端未发现开放 Issue，未擅自创建任务或分配负责人。
- 分支：main
- 提交：未提交；本轮及此前工作台开发增量保留本地。
- 状态：本轮功能与抽样实验完成；轨迹物理精度尚未验收。

## 本次完成

- `tools/player-review/trajectory.mjs`：区分人工选框与人工地面点的来源；人工选择不再被描述为确认脚点。
- `tools/player-review/court.mjs`：新增不参与拟合的核验点、控制点凸包范围与局部投影敏感度；保留待复核标记。
- `tools/player-review/workspace.mjs`、`app.mjs`、`index.html`、`style.css`：显示原图像素到球场米数、来源及范围提示；参照点可切换为核验角色。
- `scripts/benchmark_ground_anchors.py`：9 帧 YOLOv8s-pose 与已有框底中心的离线对照；摘要 `research/vision-player-refinement/ground-anchor-probe.json`。
- `scripts/probe_kalicalib.py`：作者网络两份权重各 3 帧平面拟合实验；摘要 `research/vision-player-refinement/kalicalib-probe.json`。
- 更新 `research/vision-player-refinement/court-calibration-research.md`、工作台 README、研究索引和团队状态。模型、作者源码、预览与中间数据留在被忽略的 `tmp/`、`artifacts/`。

## 结论与依据

- 准确的已知地面对应点可直接求单应矩阵；球员位置使用其逆映射，不必先测出唯一相机夹角。镜头变化必须更新映射。依据 [OpenCV 教程](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)，2026-10-01。
- [YOLOv8 官方模型](https://docs.ultralytics.com/models/yolov8/)预训练姿态权重可直接推理；75 次已有跟踪观测中 63 次有较高分双脚踝，单次 predict 中位约 13.7 ms。未独立验证身份和关键点准确率；脚踝高度、遮挡和起跳仍未解决。
- [KaliCalib 作者实现](https://github.com/CEA-LIST/KaliCalib)的 challenge 权重能给出近似场形，test 权重首帧明显失效。只跑作者网络与地面 RANSAC，未跑完整作者相机优化；28 × 15 米模板也未完成 NBA 适配。网络预热后约 6.9–8.8 ms，不能当完整管线耗时。来源与具体数字见专项记录，采集于 2026-10-01。
- 建议自动候选、人工确认分散交点、留出点验收并用逐帧几何更新处理镜头。当前没有达到可直接计算战术距离与速度的精度验收。

## 验证

- 28 项 JavaScript 测试通过，包含留出点不改变拟合、敏感度与控制点范围、人工脚点来源区分。
- `node --check` 检查 app/workspace；两个新 Python 脚本通过编译检查并已实跑。
- 浏览器独立 QA：A–D 拟合 0.0 px，E/F 留出点差 19.1 / 86.3 px，对应 0.58 / 1.50 米。均为目视参考差异，不是真值精度。截图 `artifacts/ground-anchor-audit/heldout-check.jpg`。
- QA 修改全部撤销；正式工作台重载后仍为 P1、3 次人工操作、121 帧球场位置、4 段待处理；未点击正式确认导出。界面更新截图 `artifacts/ground-anchor-audit/workspace-accuracy.jpg`。
- 两个模型仅抽样实验；没有全片姿态 / 场地网络吞吐测量、独立人工真值或云端测量。
- 5 份本轮相关文档的相对文件链接均存在，`git diff --check` 通过。

## 阻塞与待确认

- 待确认第一阶段精度目标；0.5 米只是已提出的建议，未收到用户确认。
- 需要独立场地核验点、地面接触参考与多片段样本。当前无法宣称绝对米制精度或十分钟成片目标达成。

## 下一步

- 用已记录的脚本复现，检查模型候选失败案例；先适配场地模板并制定几何拒绝条件。
- 增加人工脚底接触参考；比较脚趾 / 脚跟模型与接触状态，避免仅凭脚踝分数替代地面点。
- 将标定更新与漂移检测接入逐帧过程，再研究在球场坐标中填补短缺口；继续保留身份、场地点、脚点和关键帧人工入口。

## 同步状态

- 本轮 `git fetch origin` 成功；当时本地与远端 main 均为 `f0d0aa9a19f0c52f157be313ef0c85a58ec26ec7`。已有未提交 / 未跟踪修改保留，未创建分支或 PR。
- 未提交、未推送、未创建 AWS 资源；最新原型仅本机 `http://127.0.0.1:8876/` 可用。
