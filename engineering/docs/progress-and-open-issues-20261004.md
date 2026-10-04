# 工作台成果、问题与调研汇总

整理日期：2026-10-04，Asia/Shanghai。用途：共享当前工程成果和接续依据；不是赛事官方要求，也不是模型准确率验收报告。用户已授权整理现有工作、分类提交并同步 `main`。最终发布核对见[本轮交接](../../handoffs/Linzeyu912/2026-10-04-2200-classified-publication.md)。

## 当前结论

现有工作已按导入、数据与身份、界面、球场实验、报告播放、协作兼容、调研分别整理。继续保留 **E-BARD YOLOv8n + BoT-SORT** 人物组合、已有球 / 篮筐检测、用户认可的 005 半场线优化，以及人工标注。人物视频尾迹已改用球场坐标作为参照。

**全场摇摄下的标定和完整人物 2D 联合功能尚未通过验收。** 两个独立问题需要接着解决：全场联合求解目前只是离线候选，工作台默认流程尚未接入；有检测框也未必有连续、正确的 P 身份。高矩阵覆盖、界面有点和位置准确是三种不同结果。

本轮工作是整理、兼容修复和回归验证；下文真实视频数字引用当日已有实验，没有重跑全套模型或新增精度结论。

## 1. 已有成果与代码入口

| 分类 | 已实现内容 | 文档 / 实现 |
|---|---|---|
| 导入与运行 | 修复球场模型加载设置被人物子进程继承后导致 YOLO 检查点加载失败；保留原权重。中文路径的用户全场片在此前修复轮次已处理 1,080 帧 | [运行修复交接](../../handoffs/Linzeyu912/2026-10-04-2101-import-checkpoint-loading.md)、[加载器](../scripts/yolo_checkpoint.py) |
| 篮球 / 篮筐观测 | 篮球模型导入时另存四类别参照；只给没有对象字段的人物版本补同视频对象来源，校验哈希 / 帧数 / 时间，显式空观测继续为空 | [逐项复检](function-audit-20261004.md)、[导入脚本](../scripts/process_local_video.py) |
| 地面位置与轨迹 | 人工位置优先；明确选择的姿态候选按来源采用；默认有可靠双踝时取中点，否则取框底中点。每帧用各自矩阵转入固定球场，视频尾迹再投回当前镜头 | [坐标关系与回退规则](court-relative-trajectories.md)、[轨迹模块](../tools/player-review/court-trails.mjs) |
| 身份与资料 | P 绑定、区间修正、镜头外 / 遮挡状态、OCR 号码和队伍证据可保存并复核；兼容 THY 的身份参考、Agent 续接与战术功能 | [OCR 与脚点](ground-mapping-ocr-comparison.md)、[画面状态](player-visibility.md)、[整合说明](thy-sync-20261004.md) |
| 工作台交互 | 只保留左侧主导航；模型和跟踪器选项恢复常驻；推荐黄标放在展开后的选项内；人工标定面板蓝底修复 | [模型选择](model-selection-layout.md)、[工作台使用](../tools/player-review/README.md) |
| 球场标定 | 保留半场点线细化，改进短期地板运动恢复；新增两端 / 中线 / 地板运动共同约束的离线全场求解及逐帧核验 | [默认后端](court-calibration-backend.md)、[全场实现](court-fullcourt-calibration.md)、[研究记录](../research/court-fullcourt-20261004.md) |
| 报告和可复查证据 | 对比视频改用 Canvas 显示解码帧，支持播放、暂停和跳转；补齐 HTTP Range、报告播放器和逐项检查脚本 | [播放修复与复检报告](function-audit-20261004.md)、[播放器](../tools/report-player/player.mjs) |

原始检测、脚点观测、派生球场坐标与显示平滑分别保存。缺标定不冻结上一帧矩阵；断档不靠匿名点、插值或平滑伪装成已跟住的 P。篮球图像轨迹独立处理，持球代理也不等于球的真实地面坐标。

## 2. 问题清单与接续条件

| 问题 | 已定位原因 / 当前边界 | 下一步应交付什么 |
|---|---|---|
| 跨中场标定不稳定 | 默认入口仍是 `court_calibration.py` / `court_propagation.py`，不是离线 `court_fullcourt.py`；局部禁区贴合不足以约束整个球场，纹理传播可能漂移 | 为全场候选建立可复核入口，严格对齐原片 / 导入片哈希、PTS、尺寸、裁剪和切镜；保护人工参照 |
| 全场精度仍有盲区 | 弱光版本无可靠中线观测；7/8 次优化触及迭代上限；本片中圈被队徽遮挡，真实圆弧语义提取未完成 | 增加篮球语义场线、真实可见圆弧和短窗口相机约束；保留 005 半场回归与失效留空 |
| 画面有框、2D 没有 P | T 片段与固定 P 的关联、身份冲突或失配可能中断，不能全部归因于矩阵 | 独立标注身份续接与遮挡真值，检查 THY 续接候选的实际采用效果；不要以匿名框填充身份覆盖 |
| 双踝不等于真实站位 | 当前导入不会自动运行姿态；旧脚部缓存也可能是脚趾 / 脚跟。跳起、跨步、遮挡会使双踝中点离开真实地面 | 在同视频 / 同版本上比较脚踝与框底，单独标注接地状态和定位误差，再决定默认来源 |
| 篮球 2D 放置 | 单个图像球心无法由地面单应矩阵唯一恢复空中球的地面投影 | 分清持球、空中、落地和未知；持球可显示球员站位代理，不能导出为实测球速或球距 |
| OCR 与自动身份 | 小号码、遮挡、号码重复和队伍证据不足可能造成误认 | OCR 先保存证据到 P，人工采用后再绑定资料；不要用单次识别静默覆盖已确认身份 |
| 历史缓存与模型资源 | 没有球 / 筐参照的旧导入需要重新处理；姿态缓存必须匹配视频及跟踪指纹；模型和大缓存不在 Git | 接手者配置本机运行环境并生成自己视频的缓存；不能仅按 T 编号或文件名复用 |
| 真实 Agent 与泛化 | 本轮回归隔离真实外部调用；单片及增强不代表跨比赛泛化，完整云端流程未验收 | 另做真实调用成功 / 失败记录、多比赛多机位留出验证及部署验收 |

## 3. 已有测量：覆盖率不能替代准确率

### 球场离线实验

输入为已登记的 DAL–HOU 36 秒 / 1,080 帧视频，登记见[004 标签](../../data/videos/uploads/2026-10-04/labels/004.json)。三个增强版本都来自这一条视频，不是三场新比赛。

| 条件 | 有效矩阵候选 / 全帧 | 覆盖率 | 最长缺失 |
|---|---:|---:|---:|
| 原片 | 1,071 / 1,080 | 99.17% | 0.30 秒 |
| 模糊压缩 | 1,078 / 1,080 | 99.81% | 0.067 秒 |
| 缩放平移 | 1,045 / 1,080 | 96.76% | 0.90 秒 |
| 降亮度 | 1,068 / 1,080 | 98.89% | 0.367 秒 |

6 个非拟合关键帧的目视中线参考距离中位数为 96.45 → 4.08 像素；参考点由 Agent 读取，约 ±5 像素不确定性，未经用户复核。降亮度版本对应中位距离约 15 像素。该结果只能支持“这个片段中线贴合有改善”，不能宣布 4 像素真实精度。证据和失败区间见[原实验](../research/court-fullcourt-20261004.md)及[参考点](../research/court-fullcourt-20261004-line-checks.json)。

### 人物与球场联合复检

此前对 004 / 005 / 006 和全场视频共 1,895 帧的检查中，全场自动 P + 现有候选只有 **786/1,080（72.78%）** 帧至少出现一个场内 P。保持同样身份，仅替换离线全场矩阵后是 **921/1,080（85.28%）**。这两个数字都不代表十人完整或身份正确。

原全场结果中，150 帧有框但无可显示 P，29 帧有 P 但无有效矩阵，115 帧身份和矩阵都有但绑定点全落场外。详见[互斥原因和逐项复检](function-audit-20261004.md)。因此端到端的 >90% 要求仍未达成，不能用离线矩阵的 99.17% 代替。

## 4. 开源调研与推荐顺序

来源于 2026-10-04 的[工具调研](../research/fullcourt-tools-and-camera-tracking-20261004.md)，以下是工程建议，尚无新模型在本视频中胜出的结论。

| 候选 | 适合借用的部分 | 不能直接当成已解决的部分 |
|---|---|---|
| [Court48 / YOLO11n](https://huggingface.co/koppolusameer/yolo11n-basketball-court-keypoints) | 当前半场初始化、已认可的 005 回归基线 | 关键点模型本身不提供连续全场坐标一致性 |
| [DeepSportRadar](https://github.com/DeepSportRadar/camera-calibration-challenge) | 篮球语义线分割、交点与相机估计 | FIBA / Keemotion 到 NBA 广播画面的差异；权重可下载性与本片效果未实测 |
| [KaliCalib](https://github.com/CEA-LIST/KaliCalib) | 篮球专用配准候选和初始化 | 不能据上游结果宣布长序列稳定；需检查场地模板与 CeCILL 2.1 使用条件 |
| [Accurate Sports Field Registration](https://github.com/InfiniZero/sports_field_registration) | NBA 分割、初始 H 与迭代距离场细化 | 外链权重和当前环境尚未复现，不把它与其他论文混为同一方案 |
| [BroadTrack](https://github.com/evs-broadcast/BroadTrack) | 广播镜头运动、相机 / 三脚架及时序约束 | 足球实现需要篮球适配；数字裁切和机位切换不能一律套固定 PTZ |
| [TVCalib](https://github.com/MM4SPA/tvcalib) | 语义线重投影损失、质量检查及相机估计 | 足球模型和模板需替换，不能直接部署成篮球全场跟踪 |

建议先接通已有全场候选的复核入口，同时小规模比较篮球语义线方案；再把短时地板运动与绝对场线联合约束。始终使用同一个物理全场坐标系，队伍攻守方向另存；硬切镜重启估计，低质量时留空。

验收应同时报告：有效帧比例及最长断档、留出线 / 交点的投影误差、固定地面点随镜头移动的坐标漂移、逐球员身份连续性和脚点误差。先验收球场，再分别验收人物与脚点，最后联合到 2D；显示平滑继续放在后面。

## 5. THY 同步与分类提交

本轮开始时 `main` 已包含 THY 最新战术参考帧提交 [bedad2c](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/bedad2c2613e1b573db8f80cc020729b50184a77)。当次 fetch 和远端分支核对没有发现更新版本；其身份参考 / 续接、区间人工修正、战术 Agent、虚线箭头 / 点状传球以及参考帧展示均保留。推送前再次核对的结果记录在[交接](../../handoffs/Linzeyu912/2026-10-04-2200-classified-publication.md)。

| 分类 | 提交 | 内容 |
|---|---|---|
| 模型运行 | [9865891](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/9865891) | YOLO 加载与导入错误诊断 |
| 篮球数据通路 | [eb64f68](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/eb64f68) | 球 / 篮筐同视频观测和来源保留 |
| 数据、地面轨迹、身份 | [5de801f](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/5de801f) | 球场相对轨迹、脚点、OCR、画面状态与复核 |
| 界面 | [7f5e8e9](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/7f5e8e9) | 单一导航、模型选项与展开推荐标记 |
| 球场算法与实验 | [1ca29d1](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/1ca29d1) | 全场联合求解、镜头传播及压力测试 |
| 报告与复检 | [43a13f5](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/43a13f5) | 视频播放器及篮球 / 人物 / 球场 / 2D 审计 |
| 同步兼容与测试 | [dd34088](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/dd34088) | PATH 查找 Node、测试取消清理、隔离共享素材库 |
| 外部方案调研 | [67d3e2a](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/67d3e2a) | 全场开源工具对照及研究索引 |
| 共享入口与进度 | 本报告所在文档提交 | README 摘要、问题清单、复现入口和发布交接 |

这些提交整理的是本聊天已授权的积累工作。早期记录中的“未提交 / 未推送”保留当时事实，后续以本轮发布交接为准；没有创建任务分支或 PR。

## 6. 本轮验证与接手运行

- 前端构建通过。工作台、战术叠加、报告播放器合计 509 项测试：**508 通过、1 跳过、0 失败**；跳过为 Windows 文件符号链接创建返回 EPERM 的既有环境检查。
- Python 最终全量 **285 项通过**。本轮发现并修复两个测试隔离问题：PyTorch 允许列表无序导致比较误报；HTTP 测试误扫描真实共享视频库导致启动超时。未为此改变生产数据流程。
- 全库 **8 个数据集、175 个视频**的哈希与 Git LFS 索引检查通过。本轮没有新增视频或修改视频字节。
- 回归包括 THY 与本地功能组合；本轮未请求真实外部 Agent、未新增浏览器实操、未重跑外部候选模型。真实播放与模型测量来自各自带日期的历史验收记录。

从仓库根目录运行，Python 指向装好[工作台依赖](../requirements-review.txt)的环境；完整模型测试还需对应视觉依赖，Node 在 PATH 中：

```powershell
npm --prefix engineering/tools/player-review ci
npm --prefix engineering/tools/player-review run build
node --test engineering/tools/player-review/*.test.mjs engineering/tools/tactical-overlay/*.test.mjs engineering/tools/report-player/*.test.mjs
python -X utf8 -m unittest discover -s engineering/scripts -p "test_*.py"
python scripts/validate_video_data.py --check-index
```

基础预览见[工程入口](../README.md)，全场实验另需[可选依赖](../requirements-court-fullcourt.txt)和[已说明的输入缓存](court-fullcourt-calibration.md#运行与输出)。部分研究视频渲染脚本当前依赖 Windows 微软雅黑字体，跨平台复跑需配置可用字体；本轮未做 Linux 渲染验收。

本次共享源码、构建 bundle、测试、文档和小型参考标注；`artifacts/` 中的对比 MP4 / 大型 JSON、`tmp/` 中的权重与环境、浏览器草稿仍在各自本机，拉取 Git 不会自动获得这些文件。用户授权共享的源视频已有独立 Git LFS 入口，见[视频资料](../../data/videos/README.md)。不要把他人本机 localhost 报告地址当成团队共享网址。
