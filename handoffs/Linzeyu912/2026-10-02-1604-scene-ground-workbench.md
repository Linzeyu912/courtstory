# 交接：对象选择、脚部候选及2D场地映射接入

- 日期 / 时区：2026-10-02 16:04起整理，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户本轮要求；开工时远端没有开放 Issue，不代为分配其他成员职责。
- 分支：main。
- 功能提交：[b434660](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/b43466090f2ea392caa226a63ed6bf9eb71396be)。
- 状态：功能已在本机运行并完成验证；同步状态见文末。

## 本次完成

- [工作台](../../engineering/tools/player-review/README.md)新增篮球 / 篮筐对象列表、选中高亮、点 / 框修改、补点、排除 / 恢复和独立导出；不占P槽，也没有新增球的跨帧跟踪。
- E-BARD 的P/T所选球员可查看RTMPose-s左右脚候选并明确采用；保留脚趾 / 脚跟、模型分数和接地未知标记，不能自动覆盖人工点。原球员选取流程保留，本轮没有继续开发ByteTrack。
- 场地标定提供具名交点示意、逐点点选、左右篮侧修正、原视频投影线核对和2D预览。004可直接跳到界面第71帧参考，005 / 006参考为第1帧。
- 新增 [court_propagation.py](../../engineering/scripts/court_propagation.py) 与 [构建入口](../../engineering/scripts/build_court_review_candidates.py)，从地面参考做SIFT锚点匹配，短段LK回退；屏蔽人物框与底部25%，在同镜头、参考帧前后各20秒内生成待复核候选，失败留空。
- 三个共享脚部缓存、场地种子和逐帧场地候选在 `engineering/research/vision-player-refinement/`；由 [review-library.json](../../data/videos/tactics/acceptance/review-library.json)显式登记。模型权重、第三方代码与截图继续保留在被忽略的本机目录。
- 候选严格验证视频哈希、检测文件指纹、帧序号、时间、有效T编号和有限坐标；裁切同步映射候选时间、来源帧和相机依赖位置。用户补切镜、修改或删除参考几何后，依赖旧参考的传播停止生效；旧候选不能恢复失效映射。独立人工帧保留，新确认的当前帧可成为独立参照。

## 结论与依据

- [脚部对照](../../engineering/research/vision-player-refinement/feet-model-comparison.md)：实际下载OpenMMLab RTMPose-s Halpe26，与YOLOv8s-pose和框底中心比较；815帧 / 7,417个球员框CPU循环共37.19秒，不含前置人物检测、加载、写盘和人工修正。字幕与遮挡会产生高分错脚，保留人工采用。
- [场地模型对照](../../engineering/research/vision-player-refinement/court-model-comparison.md)：下载HF YOLO11n 48点权重，640 / 960各测同12帧，推理中位8.35 / 10.44ms，两组均7/12半场误认；KaliCalib保留原生FIBA模板，LSD只能提供无语义线段。因此没有把任一模型设为全自动精确标定。
- [传播核查](../../engineering/research/vision-player-refinement/propagation-validation.md)：首版006被固定ESPN字幕锁住；扩大遮罩后，第154 / 308帧B/E与目视粗参考的差异由几十至数百像素降至2.7–11.2px，第461帧停止输出。这不是独立米制真值。
- 共享场地候选004 / 005 / 006分别有102/210、139/143、300/462帧可生成映射；耗时11.84 / 8.27 / 26.46秒。004使用经抽查的60帧LK回退，其他样例及实时接口保持12帧；全为待复核候选，不把覆盖率当准确率。
- 004种子来自AI目视四角，D有遮挡，E作留出核验；005 / 006种子来自方向经目视筛选的模型首帧。单应矩阵可直接把地面图像点转换到2D；真实相机姿态还需内参等条件，本轮不输出猜测角度。方法来源：[OpenCV官方教程](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)，2026-10-02查阅。

## 验证

- 三个视频真实模型推理、完整脚部缓存及场地传播运行；记录种子、权重哈希、输入尺寸、计时范围和失败例子。
- 浏览器独立QA：005篮球 / 篮筐候选选择，改点、排除和恢复；关联P1并采用右脚；采用场地候选后2D轨迹出现；实时镜头跟随按钮实际返回139/143帧候选，浏览器无错误日志。
- 正式004页面保留已有两个P选择，跳到第71帧并载入待复核映射，显示102个可用球场点与4个缺口区间；没有改写原人物框或人工脚点。候选采用可撤销，状态仍为参考映射。
- JavaScript 测试65项通过，React bundle构建通过；Python测试33项通过。覆盖真实005候选的参考几何修改、旧候选重载、独立人工帧保留及嵌套裁切。浏览器另验证改篮侧后可用轨迹归零，并定位到143帧待标定区间。
- 独立QA的HTTP实际裁切005第0–2与5–7帧：两个检测版本均输出6帧，切镜位置为3；脚部指纹和全部时间对齐，相机依赖点映射到对应保留区间。代码编译、Markdown相对链接和`git diff --check`通过。
- `scripts/validate_video_data.py --metadata-only --check-index`通过：5个数据集、142条记录及142个暂存LFS指针。
- `scripts/validate_video_data.py --check-index` 已执行；因其他批次 `nba-2025-26-batch030-001` 的LFS视频未在本机下载而停止，不能声称整仓视频实体校验通过。本轮不改视频字节。
- 截图保留在本机 `artifacts/vision-player-refinement/scene-court-workbench-20261002.jpg`、`scene-court-004-preview-20261002.jpg`；实验对照图在 `artifacts/court-models-v2/`、`artifacts/court-propagation-qa/`、`artifacts/feet-models-v2/`。

## 阻塞与待确认

- 尚无独立像素 / 米制位置真值，也未确认脚地接触。模型左右混淆、遮挡、字幕和长段漂移仍需人工核查；失败帧不会靠旧矩阵填满。
- 当前接受已有三个样例和显式登记的候选；任意上传视频全自动处理、自动直播分类、相机内参估计、完整Agent和AWS部署不在已完成范围。
- 界面草稿保存在本机浏览器；Git同步不包含用户浏览器草稿。原视频成片共享方式不变。

## 下一步

- 从工作台缺口按钮定位004后段 / 006后段，在可见地面交点补独立标定，再生成局部候选；继续核对投影线和脚下真实接触位置。
- 建立带可见性标签的独立场地点 / 脚点核验集，再比较米制误差；不要用拟合残差选“准确率最好”的模型。
- 后续合作者处理ByteTrack身份持续性时，保留帧、T编号与检测指纹契约；换跟踪结果后重新生成脚部缓存。

## 同步状态

- 开工与收尾前fetch成功；本轮基线本地 / origin/main均为 `68c7776150ff682a206b5b1563428d873eb59279`。
- 功能提交 `b43466090f2ea392caa226a63ed6bf9eb71396be` 已直接推送main；推送后fetch核对本地HEAD与origin/main一致，工作区干净。本条同步记录另随文档提交保存。
- 功能运行在本机 `http://127.0.0.1:8876/`；GitHub同步的是代码、候选数据、实验记录与交接，不代表已部署云服务。独立QA服务已关闭，正式004页面保留第71帧参考映射供验收。
