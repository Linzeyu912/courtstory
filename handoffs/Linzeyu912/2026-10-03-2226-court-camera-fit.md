# 交接：镜头运动下的球场点线联合标定

- 日期 / 时区：2026-10-03 22:26，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户要求先同步协作者云端更新，再按三步优化球场标定；GitHub Issues 查询返回空列表。
- 分支：main。
- 提交：未提交；按用户本轮及此前要求，所有新修改留在本地，不推送。
- 状态：实现完成；样片精度与实际工作台运行效果尚未验证。

## 同步基线

- `main` 已快进至 `fb67533c28f41fce76f756bb5e2f0f4a81d2d4ab`（`origin/main`，2026-10-03）；同步包含协作者的 10 个提交，涉及战术画布 / 路线编辑。
- 云端修改未覆盖本地未提交调研文件。此前的边线调研仍保留在 `engineering/research/README.md`、`engineering/research/vision-player-refinement/court-line-registration-survey-20261003.md` 与 `handoffs/Linzeyu912/2026-10-03-2148-court-line-registration-survey.md`。
- 现已在调研文档里追加本轮实现状态与尚待验收项，区分 21:48 采集时的代码基线与当前本机的 Canny 点线修正。
- 按 `AGENTS.md` 查询全部 GitHub Issues，命令成功但列表为空，因此本次没有可匹配的负责人 / 讨论。

## 本次修改

- `engineering/scripts/court_propagation.py`：沿用 SIFT 锚点 / LK 回退；启用时每秒用现有 48 点模型和已登记篮筐证据重估同一锁定篮侧，失效帧仍留空。增加 NBA 线采样、Canny 距离统计及局部 RANSAC 点线修正；只有至少 3 个受支持线组、控制点偏移受限且边缘距离改善时才采用修正。
- `engineering/scripts/court_calibration.py`：初始自动候选也尝试点线联合修正，记录回投影线质量与原始模型点；重估沿用现有模型，不下载新权重。
- `engineering/scripts/serve_player_review.py`：人工标定的镜头跟随接口可复用本机 48 点模型；权重 / 依赖不可用时记录原因并回退原 SIFT / LK。
- `engineering/tools/player-review/workspace.mjs`：工作台候选与当前帧标定信息显示线组支持、边缘距离、模板线可见范围和线缘证据不足提示。NBA 标准线的原图叠加沿用现有绘制流程。
- `engineering/docs/court-calibration-backend.md`、`engineering/tools/player-review/README.md`、`engineering/research/README.md`：记录方法、字段与限制。

## 质量解释与限制

- 线缘使用 OpenCV Canny / 距离变换，并非新训练的语义球场线模型。球员、广告、纹理都可能产生假匹配；`uncertaintyHint` 明确标出线组不足或“无法从边缘量化”。显示分数不是定位误差概率或米制准确率。
- 重估按约 1 秒间隔，而不是逐帧运行 48 点模型。锁篮侧冲突、缺少可靠篮筐或重估无效时，才使用通过既有门限的图像运动候选；切镜边界继续保持隔离。
- 镜头畸变、滚动快门、非平面场地和剧烈视角切换仍需要人工新标定；需要用实际样片核对自动点线修正有无贴错广告边或木地板边。

## 验证

- `python -m py_compile` 对三个修改的 Python 文件通过。
- `node --check workspace.mjs` 通过；`npm run build` 成功。工作台源码不属于 `identity-ui.jsx` bundle 的依赖，bundle 文件内容哈希与 `HEAD` 一致，已恢复为干净状态。
- `git diff --check` 通过。
- 按上层指令未新增或运行测试；未运行模型、样片精度验证或浏览器 QA。

## 下一步

- 在本机模型环境启动工作台，用不同推拉 / 旋转速度的短镜头查看每秒重估是否跟得上，并确认线缘修正没有贴合广告 / 地板纹理。
- 对线缘门槛、重估间隔和处理时长做样片对照；确认后再由协作者推送并同步。

## 同步状态

- 远端拉取已完成；本交接与上述代码 / 文档修改均只在本地工作区，未提交、未推送。`main` 暂时领先基线仅源于快进到远端；本地未提交修改保持待后续协作者处理。
