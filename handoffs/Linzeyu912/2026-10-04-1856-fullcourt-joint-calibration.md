# 交接：先完成跨中场球场标定的联合约束与复验

- 日期 / 时区：2026-10-04 18:56，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：本聊天用户要求先解决跨中场标定，再分别验收人物轨迹和脚下点，最后做 2D 联合；开工 GitHub open Issues 返回空列表。
- 分支：main
- 提交：未提交、未推送
- 状态：本轮离线修复与视频复验完成；独立人工精度验收、工作台默认后端接入仍待后续

## 本次完成

- 新增全场联合标定、四条件基准、运动异常独立核验、报告和验收脚本：`engineering/scripts/court_fullcourt.py`、`benchmark_fullcourt.py`、`audit_fullcourt_motion.py`、`report_fullcourt.py`、`validate_fullcourt_benchmark.py`、`test_court_fullcourt.py`。
- 新增独立可选依赖 `engineering/requirements-court-fullcourt.txt`；没有安装或替换任何现有环境。
- 工程说明：[court-fullcourt-calibration.md](../../engineering/docs/court-fullcourt-calibration.md)。结果与边界：[研究记录](../../research/vision/court-fullcourt-20261004.md)。仅报告使用的[目视中线参考](../../research/vision/court-fullcourt-20261004-line-checks.json)。
- 本机成片：`artifacts/court-fullcourt-20261004/court-before-after.mp4`、`court-augmentations.mp4`，均完整 36 秒 / 1080 帧，只有球场叠加，没有联合投影人物或球。
- 报告：`artifacts/court-fullcourt-20261004/index.html`，本地服务 `http://127.0.0.1:8902/`。服务通过隐藏进程启动，父 PID 56412；原有 8890/8896/8897/8898/8899/8901 服务未重启。

## 结论与依据

- 原来各自正确的半场参照无法保证中场一致。新增两端禁区语义点线 + 可见中线 + 地板相机关系图，共用一套全场坐标。
- 中圈半径与可见圆弧残差接口已加入，但本片被队徽遮挡，没有真实圆弧观测，不能声称已经完成中圈自动识别验收。
- 原片 / 模糊 / 缩放 / 降亮度的有效标定帧分别为 **1071 / 1078 / 1045 / 1068（各 1080 帧）**，覆盖率 **99.17% / 99.81% / 96.76% / 98.89%**。指标仅指球场标定，不是球员 2D 标记覆盖或精度。
- 两次经过中场各 3 个非求解关键帧的目视中线参考，原片偏差中位数 96.45 → 4.08 像素。参考由 Agent 读取，约 ±5 像素、未经人工复核，不等于米制真值。
- 全帧连续性复查发现局部纹理匹配可在匹配区域内一致，却使远处场线单帧跳动。新增前后联合关键帧的独立 LK 测量，必须两侧吻合才修复，共修正 23 帧（5/1/8/9）；没有补缺失帧。检查前候选保留在 `before-motion-audit/`，有原字节哈希。
- 来源视频 SHA-256：`994c43388a2c31a44fcc8259bba1d4d71abab0dd439aed46da09c22e14012b23`。既有 E-BARD 检测、身份、轨迹、脚下点和篮球数据未改动；旧报告目录完整保留。
- 2026-10-04 复核来源：[NBA 球场规则](https://official.nba.com/rule-no-1-court-dimensions-equipment/)、[现用 Court48 模型卡](https://huggingface.co/koppolusameer/yolo11n-basketball-court-keypoints)。模型输出像素点，地面几何为下游工作。

## 验证

- 8 项测试通过，包括已知几何中场留出点、断连、切镜、整体尺度、反转、空白图、中圈残差及真实合成地板光流纠正 50 像素异常。
- 4320 个帧记录时间、所有有效矩阵、原视频 / 增强文件与 16 个输入缓存哈希通过；原候选运动审计备份哈希通过。
- 两段视频全部解码，分辨率 1920×640 / 1920×1280，30 FPS、36 秒、faststart；HTTP Range 返回 206；真实 IAB 浏览器两段播放器均 readyState 4，无解码错误，播放和中场跳转通过。
- 验收记录在本机 `validation.json`、`summary.json`、`http-verification.json`、`browser-verification.jpg`。共享文档相对路径检查，Python 语法与 `git diff --check` 检查通过。

## 阻塞与待确认

- 没有独立人工全场真值。7/8 次联合优化达到 100 次迭代上限；所有输出仍 `needs_review`，精度未验收。
- 降亮度未找到满足门槛的中线，中场目视偏差约 15 像素；后续可以改进亮度归一化与语义线支持。模糊增强与原片的地面一致性 P95 约 0.85 米，也需继续关注。
- 该视频已用于本轮开发，不是独立测试集；增强不等于新比赛。当前限定同侧机位连续镜头，物理篮端、跨场馆、切镜和可见圆弧识别仍需新样本验收。
- 没有改工作台默认后端或前端，也没有做人物 / 球的 2D 联合量化和轨迹平滑。

## 下一步

- 用户先看球场专用前后对比，重点核对两次穿过中场与两端禁区；有偏差时针对球场几何继续校正。
- 球场验收后，分别验收人物轨迹和脚下地面点，再做 2D 联合。
- 工程接入时保持人工点保护、镜头边界和新的质量信息，不把本轮候选强制覆盖既有草稿。

## 同步状态

- 所有本轮代码 / 文档仅在本机 main 工作区。模型、大 JSON、视频保留忽略目录，未加入 Git。
- 开工 fetch 看到远端新增 3 个提交；18:55 复查为 `origin/main=290b80d`，本地落后 4 个提交、没有领先提交。远端修改与当前其他会话未提交文件重叠，因此未执行 pull、stash 或覆盖。没有创建分支 / PR、提交或推送，也未把本地结果称为云端可用。
