# 交接：脚部小模型本机对照与逐帧候选

- 日期 / 时区：2026-10-02 15:41，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户授权下载并实测脚部 / 场地小模型；本子任务负责脚部，工作台与场地由并行任务处理。
- 分支：main。
- 提交：本子任务未提交，保留给根任务选择性整理。
- 状态：实测、文档与候选缓存完成；真实接地精度尚未验收。

## 本次完成

- [脚本](../../engineering/scripts/probe_feet_models.py)：复用 E-BARD 框运行 RTMPose-s Halpe26，抽样对照 YOLOv8s-pose / 框底中心；`--cache-only` 生成全部 815 帧候选。
- [对照结论](../../engineering/research/vision-player-refinement/feet-model-comparison.md)、[抽样数值](../../engineering/research/vision-player-refinement/feet-model-comparison.json)、[全量运行](../../engineering/research/vision-player-refinement/feet-model-full-run.json)。
- `engineering/research/vision-player-refinement/feet-candidates-{004,005,006}.json`：独立候选缓存，绑定视频和原 E-BARD 文件 SHA-256，不修改正式人物位置。
- 本机看图页 `artifacts/feet-models-v2/index.html`，原图叠加与逐人鞋部放大图；模型 / 依赖只在被忽略的 `tmp/`。

## 结论与依据

- 来源为 [OpenMMLab 官方 Halpe26 模型](https://github.com/open-mmlab/mmpose/blob/main/configs/body_2d_keypoint/rtmpose/body8/rtmpose_body8-halpe26.md)与 [rtmlib](https://github.com/Tau-J/rtmlib)，采集日期同本记录。
- 清晰鞋上的脚趾 / 脚跟可以作为人工点选参考；字幕、遮挡和人物交叠仍会导致高分错点。不能把关键点置信分数当接地证据。
- 每脚至少两个图内点过 0.3 才提出参考，选该脚最高分原始 toe / heel，并保留原始点。左右独立为空；无双脚平均，统一 `groundPoint=false` / `contactState=unknown`。

## 验证

- 12 帧 / 106 个 E-BARD 球员框真实对照：RTMPose 有 96 个至少一脚候选；YOLO 有 91 个匹配对象至少一只脚踝过阈值。此为候选覆盖，不是准确率。
- CPU 4 线程全 815 帧 / 7,417 个框，解码 + 裁框 + 姿态 + 收集共 37.19 秒；纯姿态 34.89 秒。未含前置检测、写盘、渲染或人工修正。
- 六张鞋部放大图目视核查；全部候选缓存通过源文件哈希、815 帧索引和时间、球员编号、分数及来源一致性检查。缺失点 / 两点支持 / 边界 / 最高分点选择检查通过，脚本编译通过。

## 阻塞与待确认

- 无运行阻塞；尚无独立脚地接触 / 像素 / 米制标注真值，不作精度排名。
- 工作台只适合人工采用这些候选，不应自动覆盖已确认脚点。裁切或重新跟踪后需重映射并更新哈希，不能强行套用旧候选。

## 下一步

- 根任务按绑定哈希加载候选，向操作者提供左右脚参照与人工采用；与当前帧场地标定一起解释米制转换。
- 收集少量独立脚点与接触状态标注，考察人工修正量及遮挡失败，再决定是否增加接触模型。

## 同步状态

- 本子任务所有新增内容仅本地，未提交或推送；未修改 ByteTrack、正式跟踪缓存、server 或 UI。其他并行任务的改动保持原样，最终同步由根任务核对。

## 补充：候选接口审查与修复

根任务随后委托本子任务审查场地 / 脚部候选的后端接口，并明确将以下两文件的修改权交给本子任务。因此，上节“未修改 server”仅描述脚部实验完成时的范围。

- 新增 [scene_profiles.py](../../engineering/scripts/scene_profiles.py)：校验场地模板、唯一帧、具名有限点、状态与失效列表，以及脚部候选的视频 / 检测版本 / 帧时间 / 当帧编号 / 有限图内点 / 未确认接地标志。
- 修改 `serve_player_review.py` 调用验证并拒绝 NaN 序列化。修改 `review_video_trim.py` 修正脚点时间重映射、保留来源时间、单版本裁切回退及二次裁切的原始参照帧；不改变用户已有人工位置。
- 新增 [10 项候选接口测试](../../engineering/scripts/test_scene_profiles.py)，包含真实双区间裁切及再次裁切、错误哈希 / 时间 / 点 / 编号 / 状态拒绝；全部通过。既有 8 项 `test_review_*` 通过，三个真实视频全部 815 帧与筛选后的 0 / 2 / 3 组场地候选通过新验证。
- 发现的问题均已在授权文件范围内修复；`court_propagation.py` 的输入校验由根任务修改，本子任务没有编辑它。未提交或推送，最终同步仍由根任务负责。
- 后续复核补上每个场地关键帧 `quality.referenceFrame` 的裁切重映射与 `sourceReferenceFrame` 根帧追溯。新增 `cameraSupportFrame` 仅作连续保留区间的切镜保护锚，取本段中最靠近原参考的位置，不冒充实际参考帧。原参考已删除的多次裁切继续沿用上次保护锚，继承的 `sourceCuts` 仍分段；元数据越界时拒绝加载。
- 候选接口测试现为 **12 项通过**，包括三次实际裁切、原参考在片段前 / 后、旧接缝与脚点时间的同步核验。前端如何使用保护锚由并行 UI 任务处理，本子任务未修改前端。
