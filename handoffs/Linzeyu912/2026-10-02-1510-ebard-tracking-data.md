# 交接：E-BARD 分角色持续跟踪数据与人工身份演示

- 日期 / 时区：2026-10-02 15:10，Asia/Shanghai。
- 成员：Linzeyu912；当前聊天并行数据处理子任务。
- 任务 / Issue：用户要求把 E-BARD 与原模型并列接入工作台，展示 ByteTrack 和人工身份关联；本记录只覆盖离线数据和演示，服务 / UI 接入由同一任务其他工作完成。
- 分支：main。
- 提交：未提交、未推送。
- 状态：离线数据、测量、契约验证与演示完成；身份 / 脚点精度尚未验收。

## 本次完成

- 新增 `engineering/scripts/build_ebard_review_tracks.py`、`test_ebard_review_tracks.py` 和 `render_ebard_tracking_demo.py`。
- 新增 `data/videos/tactics/acceptance/tracks/004-ebard.json` 至 `006-ebard.json` 及对应 `.meta.json`，保留原通用模型数据；没有修改视频。
- 新增实测摘要 `engineering/research/vision-player-refinement/ebard-tracking-probe.json`，含每个 T 的可见帧区间、参数、哈希、计时及演示标注。
- 本机演示 `artifacts/ebard-tracking-probe/004-identity-demo.mp4`：P1 人工指定 T2 的 0–46 帧与 T23 的 100–136 帧；P2 指定 T1 的 0–209 帧。脚点取框底中心，短尾迹遇缺口 / ID 变化断开，不做插值、不改正式草稿。演示和截图是忽略的本机 QA 产物。

## 结论与依据

- 来源采集于 2026-10-02：[作者权重](https://huggingface.co/GabrieleGiudici/E-BARD-detection-models)。继续使用已核对 SHA 的 YOLOv8n 权重、已有视觉环境及 `benchmark_ebard.load_detector` 的受限加载。
- 四类明确分离：球员 2、裁判 3 各自进入一个 ByteTrack；篮球 0、篮筐 1 仅保留逐帧检测。球 / 筐不进入人物 T，不当作地面点，也不声称已形成球轨迹。
- `tracks` 保持七列 `[x1,y1,x2,y2,id,score,class]`；增加 `track_roles` 字典。输出 ID 对 `(role, internal ID)` 做全片唯一映射；按帧附 `role_conflicts`，保留跨类别 IoU≥0.75 的冲突双方，没有固定十人限制、球衣或画面区域过滤。
- 检测 704、conf 0.07、IoU 0.5、GPU FP16。跟踪 high/new=0.2、low=0.07、buffer=30 帧、match=0.8、fuse_score=true。球 / 筐输出阈值 0.25。
- 815 帧实测：004 3.570 秒、005 2.964 秒、006 9.295 秒，总计 **15.829 秒**。包含解码、检测、跟踪及结果采集；不含加载预热、绘图、JSON 写盘、人工操作或成片。
- 输出 T 数量（球员 / 裁判）：004 为 31 / 9、005 为 14 / 2、006 为 30 / 12；最长连续球员 T 为 210、143、328 帧。这些是轨迹碎片统计，不是真实人数或身份准确率。
- 目视 004 多个关键帧，存在持续 ID 串到其他人的情况。T18 后段已对应白衣人物，不能将整个 T18 归入蓝衣 30 号。演示仅使用指定区间，P1 实际有观测 81 / 210 帧，其余保留缺失 / 未指定。

## 验证

- 逐一验证三视频 SHA；815 个输出帧的顺序、时间、七列契约、角色稳定、ID 唯一及对象分离通过；三份数据 SHA 与 metadata / report 一致。
- 四项 Python 契约测试通过，三份新脚本编译检查通过。`git diff --check` 无空白错误；其他任务文件仅有换行提示。
- 演示重新完整解码：H.264、1280×830、23.97 fps、210 帧、8.760951 秒、5,630,088 字节；SHA `925e5f673c4e983eb2ed0e27dd7456fcb4406c40ae0253ffc7427758e6537c19`。实际查看第 60 帧 P1 缺失、第 110 帧 P1 接到 T23，字幕完整可读。
- 未标注完整身份真值，不报告 IDF1 / 召回率；未做云端测量、场地变换或脚点误差验收。

## 复现

实际执行（默认输出存在时脚本会拒绝覆盖，重跑须换输出路径）：

```powershell
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/build_ebard_review_tracks.py
& tmp/vision-deploy-bench-venv/Scripts/python.exe -m unittest discover -s engineering/scripts -p test_ebard_review_tracks.py -v
& tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/render_ebard_tracking_demo.py --video data/videos/tactics/acceptance/clips/004_GSW_elevator.mp4 --tracks data/videos/tactics/acceptance/tracks/004-ebard.json --assignments artifacts/ebard-tracking-probe/demo-assignments.json --output artifacts/ebard-tracking-probe/004-identity-demo.mp4
```

`demo-assignments.json` 使用研究摘要中 `manualReview.demoAssignments` 的内容，不代表完整真值标注。

## 阻塞与待确认

- 无离线生成阻塞。长轨迹仍可能串号，框底中心也不等于准确地面接触点。
- 本记录不代表服务/UI已验收；由主任务完成多模型切换、版本隔离、草稿保护及实际浏览器操作。

## 下一步

- 在独立 QA 草稿里示范 P1 在不同帧重选 T2 / T23，展示中段仍需人工补齐；可用 T1 的白衣 15 号作为持续轨迹对照。
- 后续用人工身份真值评价 ID 切换、覆盖和修正成本，不能用 T 数越少判断模型越好。

## 同步状态

- 全部是本地新增文件，未提交推送。既有原视频、通用模型跟踪和正式人工草稿未改；共享状态由主任务最后核实。
