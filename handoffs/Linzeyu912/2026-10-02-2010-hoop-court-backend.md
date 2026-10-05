# 交接：篮筐方向约束的球场标定后端

- 日期 / 时区：2026-10-02 20:10 起整理，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户要求把已讨论的“先找篮筐判断方向，再约束场地点，最后计算地面位置”改入后端；本轮读取开放 Issue 为空。
- 分支：main。
- 提交：未提交。本轮开工 fetch 后 HEAD / origin/main 同为 `72c74e041fd673de81488ebdf48cb97d39427bda`。
- 状态：后端实现、回归与本机接口验证完成；仍为待人工复核的位置候选。

## 本次完成

- 新增 [court_orientation.py](../../engineering/scripts/court_orientation.py)：分别检查两组48点候选，用篮筐、禁区轴和远近边关系约束方向；保留原槽位并允许有依据的左右语义重解释。拒绝无可靠篮筐、多筐、点不足、三点共线退化、异常透视和冲突几何。
- 新增 [court_calibration.py](../../engineering/scripts/court_calibration.py)：懒加载已核验的本地权重，核对视频哈希、画面尺寸及对象检测时间，生成具名地面参照与双向单应矩阵；可继续调用现有镜头传播。
- [工作台服务](../../engineering/scripts/serve_player_review.py)新增 `POST /api/court-calibrate`。复用E-BARD篮筐检测，在通用人物检测版本下也能读取同一视频登记的E-BARD对象。响应只返回候选，未自动改写服务缓存或浏览器草稿。
- [命令行入口](../../engineering/scripts/build_court_review_candidates.py)支持省略 `--seed` 自动初始化，增加 `--frame` / `--initial-only` / 模型路径和尺寸选项。人工种子入口保留，已有输出文件拒绝覆盖。
- [裁切模块](../../engineering/scripts/review_video_trim.py)同步映射初始化帧与未解决帧；初始化参考被删后标 `source_removed`，保留根来源记录，二次裁切不恢复已删除参照。
- 新增三组测试、[后端说明](../../engineering/docs/court-calibration-backend.md)，更新[脚本入口](../../engineering/scripts/README.md)。原研究快照、共享脚点 / 球场候选及视频字节保持不变。

## 结论与依据

- 旧模型对照以两组场地点的分数总和选左右侧，没有独立篮筐证据；新自动入口按篮筐与地面几何一致性筛选，不能只改一个 `side` 字符串。模型幻觉出的镜像点与真实篮筐不符时保留失败。
- 篮筐只用于方向检查，绝不进入地面单应拟合；有效候选继续标记 `needs_review`、`reviewRequired=true`、`metricAccuracyValidated=false`。
- 本次采用既有 E-BARD 检测和本地48点模型组合，没有新增外部多模态服务。方向约束和拒绝门槛属于工程实现，尚未用独立标注集验收。
- 方向按同侧主转播画面解释；本次传播使用同一个初始方向。HTTP接口不持久保存跨请求的方向锁，也没有自动识别跨机位物理球篮身份、球队进攻端或未登记的切镜。
- 原始来源于2026-10-02复核：[E-BARD模型卡](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models)、[48点模型卡](https://huggingface.co/koppolusameer/yolo11n-basketball-court-keypoints)、[OpenCV平面单应教程](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)。模型哈希和调用命令见后端说明；既有点序证据见[模型比较](../../research/vision/vision-player-refinement/court-model-comparison.md)。

## 验证

- 后端 `test_*.py` 全部 **60项通过**：包含16项方向几何、8项视频初始化、3项新增裁切测试，以及原有33项。首次沙箱执行因PyAV临时目录权限失败，获自动审批后在本机权限下重跑通过；不是略过测试断言。
- 原前端球场 / 标定契约 **23项通过**。使用 `node --test --test-isolation=none` 避免沙箱禁止测试子进程；没有更改测试语义。
- 真实HTTP **9项通过**：通用检测版本复用E-BARD篮筐、自动初始化、带切镜的传播、004不确定时不输出映射、非法帧 / 切镜 / 布尔值 / 样例拒绝、跨来源拒绝和缺权重503。两个独立QA服务均由测试进程关闭，没有重启用户正式服务。
- 命令行真实运行：005第0帧自动初始化为右侧；继续传播得到 **139/143帧**候选。现有 `acceptCourtCandidates` 接受139帧、保留4帧失效，首帧能进入 `calibrationAt`。纯初始化一次含冷启动耗时约6.54秒；初始化加全片传播约15.51秒，两次独立进程，不能相减当纯模型耗时。
- 旧12帧的两种输入输出共24条缓存对照：640保留4帧、拒绝8帧；960保留7帧、拒绝5帧。006第308帧640输出从旧right纠正为left；004前段仍因错误镜像几何而拒绝。此项复用旧关键点和已有篮筐，没有重新推理；独立于上面的真实HTTP / CLI模型运行。[共享验证JSON](../../research/vision/vision-player-refinement/hoop-constrained-calibration.json)保存输入哈希、逐帧结果、拒绝原因及接口验证。目视核对006/308和004/0前后投影图，改善与拒绝行为符合记录，未据此声称米制精度。
- 独立代码复核发现并修正无E-BARD且默认非original时的CLI检测指纹来源问题；复核未发现剩余阻止交付的问题。
- Python编译、改动空白检查和新增文档相对链接核验；本机QA响应、日志和运行脚本在忽略目录 `artifacts/court-orientation-backend-qa/`。

## 阻塞与待确认

- 本次后端工作无阻塞。方向候选仍可能失败，真实脚地接触、独立米制精度和通用自动标定未验收。
- 前端新按钮接线不在本轮修改内；HTTP响应须由调用方明确采用，或命令行输出经复核后登记到视频库。
- 当前已有前端界面会话修改及其交接记录，全部保留；本轮未操作浏览器正式草稿、人物身份或ByteTrack。

## 下一步

- 前端调用新接口并沿用现有候选复核 / 采用流程。失败时展示 `initialization.reason`，引导更换清晰帧或人工标定。
- 使用独立场地点真值验证方向与位置误差，再决定是否放宽覆盖或增加多模态辅助；不要把“输出矩阵”当位置准确。

## 同步状态

- 本轮完成开工远端读取与基线核对，未执行覆盖其他改动的pull。
- 所有本轮代码和文档保留在本地main，未提交、未推送。用户正式服务仍需在合适时机重启才能加载新接口；本轮只启动并关闭独立QA服务。
