# 18 段恢复实验：来源、修订与未来证据审计

2026-10-02。本轮仅在本机只读检查既有实验，产物写入独立 workspace；没有修改 `{repo}`，没有运行检测器、调用 Qwen、读取凭证、提交或推送。开始和结束 `git status --short` 相同：两份既有修改文档及两个未跟踪目录保留。

结论：净增 61 条记录可以重现，但它不是 61 条独立新观测，也未经过这批视频的独立位置真值验证。字段足以恢复部分来源链；仅用最终 CSV、`observed` 或 `bbox` 会丢失重要语义。现有数据是离线结果，不能把 `time` 解释为实时可用时刻。

## 复现实测

[audit_recovery.py](audit_recovery.py) 读取 18 段每段的 baseline、short、players-short、recovered、工作/最终 qwen-events、roles、excluded-role-points，加 batch-results 与 annotations，共 146 份 JSON；输入字节数和 SHA-256 保存在 [input-manifest.json](input-manifest.json)。本次读取结束前检查文件修改时间，未发现输入并发变化。脚本不导出外观向量或 embedding。

| 实测项 | 数量 | 正确解释 |
|---|---:|---|
| 视频 / 帧 | 18 / 6,177 | 既有本地输入 |
| baseline detector 候选 | 55,670 | 模型检测候选，不是人工观测真值 |
| B：短缺口处理后 | 56,233 | 已含推断及显示处理 |
| C：角色筛选后 | 54,628 | 角色模型筛选，不是身份认证 |
| D：最终恢复后 | 54,689 | 相对 C 净增 61 |
| 按 `(frame, track_id)` 真正新增 | 62 | 5 Qwen + 57 插值 |
| C 中存在、D 中撤销 | 1 | s24-053 / f138 / T14 旧插值 |
| D 最终 source | 54,124 detector + 560 interpolated + 5 qwen | 三种来源能区分，不能合算检测命中 |
| 排除记录 | 1,605 | 既有说明的非球员 1,067 + unknown 538 |
| Qwen 定位事件 | 52 | 5 accepted_geometry、26 rejected、21 not_visible_or_uncertain |
| detector `bbox != raw_bbox` | 53,837 / 54,124 | 显示处理影响了几何值，不是新检测 |
| role 参考帧晚于当前帧 | 26,909 / 54,689 | 至少存在未来来源图像依赖 |

完整逐段数字在 [audit.json](audit.json)；62 条真正新增记录在 [added-points.csv](added-points.csv)，每条有来源路径和 JSON pointer；撤销点在 [removed-points.json](removed-points.json)。所有 case 的 published source counts 与本轮读出的 C/D 一致；未发现同阶段重复 `(frame,track_id)`。54,124 个最终 detector 点的 `raw_bbox` 均能在同帧 baseline 中唯一精确匹配；这证明来源对应关系，不证明框、类别或身份正确。

## 三个具体“推断当观测”风险

**Qwen `observed=true`。** s24-007 / f78 / T8 的 `source=qwen`、`observed=true`、`qwen_anchor=true`、confidence=0.85。`raw_bbox=[837,202,896,415]` 是 Qwen 输出的平滑前框，不是 detector 框；最终显示框约为 `[836.7431,202.0786,895.7431,415.0786]`。5 个 Qwen 点全部如此。`raw_*` 只能解释为相应阶段的“处理前值”，不能独立解释为真实观测。5 点都能联接最终 accepted_geometry 事件，但这只说明通过既有实验检查。

**detector `bbox` 已变。** s25-03 / f435 / T5 的原框是 `[647.72,420.39,726.95,769.54]`，显示框约 `[644.5218,412.0513,723.7518,761.2013]`；中心相差 8.9310 px，是本批最大 detector 中心变化，仍标 `source=detector, observed=true, smoothed=true`。机制来自 `tracking.py::_smooth_run`：覆盖中心/脚点并平移显示框，保留 raw 坐标。全批 detector 中心变化中位数 0.3459 px、P95 1.3527 px；这些是处理幅度，不是精度误差。

**role 用未来图像。** s24-033 / f0 / T9 的保存时间是 0.0 秒，`role_reference_frame=100`，该帧保存时间是 4.0 秒。active_player 判定至少依赖 4.0 秒以后的源图像。此下界直接用 JSON 中的两个 `time` 相减得到，不是 API 延迟。角色样本选择还依赖完整轨迹，页面请求混合多轨、多时刻；缺少实际完成时刻，故 `evidence_available_at=null`。

适配示例已保存 [adapter-examples.json](adapter-examples.json)：detector 原几何与 display_geometry 分离；Qwen 映射为 model_inferred_location，原 observed 标签保留仅供追溯；角色保留已知源帧时间，未知可用时刻不补猜测。

## 净增 61 的修订与因果边界

s24-053 的 C/D 差分是新增 6 点、删除 1 点，净增 5。其他四个有锚点片段分别新增 7、11、7、31 点。原说明“5 锚点 + 56 插值”在总数层面是净增组成；真正新增集合是 5 + 57，另撤销 1。

删除链已按代码与真实数据核对：T14 的角色样本 f106=bench、f168=active_player。f137 到两端等距，被最近样本逻辑分到先出现的 bench，因而端点删除；f138 更接近 active 样本，旧插值被保留。C 的对应 gap 同时留有 `filled_frames=[138]`、`recovery_eligible=true` 和 `role_rejected=true`。最终恢复函数无条件移除旧插值，再以剩余 observed 点重建；T14 的首个剩余 observed 点是 f139，因此 f138 无法重建。

[probe_offline_dependencies.py](probe_offline_dependencies.py) 已用真实 C 调用 `apply_qwen_anchors(C, [])`：**不给任何新 Qwen 锚点，也恰好只删除 f138/T14，新增 0 点，接受锚点 0 个**。这是离线数学函数的有界机制复现，没有调用模型。因此 C→D 不只是新增 Qwen 证据，还包含全局插值重建带来的撤销，比较时应同时报告 added/removed/revised。

工作阶段和最终 `qwen-events.json` 还存在两条状态修订：s24-007 / T1 的 f71、f77 在工作事件中是 accepted_geometry，最终事件中因 overlaps_other_track 变为 rejected。单看工作事件会误认最终接受。现有文件保留两种状态但没有统一 revision ID、时序及 supersedes 关系，适配时应固定文件哈希与处理阶段。

既有 QA 中 s24-049 / f199 / T4 的“理由称蓝衣 #22、框落到红衣”以及 s25-03 / f421 / T10 的重复半身框，本轮只核对了其**最终拒绝状态**和响应自述：分别为 reference_appearance_conflict 与 partial_box_overlaps_existing_player，均未进入 D。画面判读来自既有 batch-role-qa，本轮没有重做视觉真值审核，不能把这两例当成独立新人工标签。

## 时间可重建到什么程度

当前 `time` 在 `detect.py:78` 由 `round(frame_index/fps,6)` 生成；没有保存原始容器 PTS。应标记 `clock=nominal_frame_index/fps`。它不是请求完成时间、结果发布时刻，也不是球场比赛时钟。

本轮脚本从已保存的插值 anchors、Qwen event 双端参考、role_reference_frame 递归计算**部分已知源帧依赖下界**。27,202 点有正前瞻，下界最大 4.0 秒；这不等于完整依赖、最小可实现延迟或实测延迟。全片选择、角色批处理和两次平滑的遗漏依赖可能更晚，所以示例仍把 available_at 设为 null。

代码审计定位：

- `tracking.py:251–288` 双向滤波反向遍历连续段；未来图像可影响较早显示框。合成探针保持前三帧原检测完全一致，只增加四帧后缀，前三帧显示框分别变化 0.02938、0.06431、0.14077 px。结果保存在 [offline-dependency-probes.json](offline-dependency-probes.json)。此探针验证非因果机制，不度量真实定位精度。
- `pipeline.py:44–70` 的 gap 选择依赖整片 observed 持久度、全片 gap 排序与请求预算。仅取得右端参考帧还不足以代表当前批处理的实际可用时刻。
- `role_filter.py:47–67` 在完整轨迹 observed 观测序号的 25%/75% 抽样；`116–140` 用最近参考向整段回填。角色 active 不证明其间是同一个球员。
- `tracking.py:681–690` 接受 Qwen 时重建字段，丢掉调用方的 gap_anchors 等信息；需外联 qwen-events。已有 observed 点不重新平滑，新锚点/插值再平滑，因此最终连续段不能完整反推出第一轮 detector 显示框的依赖，需要保留 short.json。
- 5 个接受事件的 `cached=true`，本轮保存的 `elapsed_seconds` 为 0.071–0.160 秒；它们是缓存相关阶段耗时，不能当原始 Qwen 服务延迟。

## 56 个标签能够与不能够证明的内容

`annotations.json.review_method` 明确写：Agent 直接查看原始解码帧绘制独立目视参考，未经人类逐帧验收，不是 ground truth。共 3 段、6 帧、56 框，字段是 bbox/foot/team，没有逐人身份与连续轨迹真值。3 个源视频与这批 18 段的路径交集为 **0**。

它们可用于这 6 帧相对独立目视参考的框匹配、像素位置差和未匹配候选诊断。已有文档的 34/56 匹配只适用于那些旧样例，本轮未重跑该指标。标签非穷举，因此未匹配候选不等于确定误检，未匹配参考也不自动证明 detector 漏掉一个独立个体。它们不能证明这批 5 锚点/57 新插值的正确率、角色筛选准确率、ID 连续性、实名身份、球权/事件、真实接地、球场米制坐标或实时延迟。

## 最小适配边界

只建议研究层样例，不修改现有实验：

1. `source_kind` 至少拆 detector_observation、model_inferred_location、interpolated_estimate、display_transform、role_inference；不能以 observed=true 一个布尔量决定事实可用性。
2. detector raw 几何回指 baseline 文件哈希与 detection JSON pointer；轨道关联 ID 另存，未验证实名保持 null。图像坐标、近似脚点与球场坐标分开。
3. 插值同时保留两端引用、各端来源、全链依赖及人工审核状态。Qwen 锚点的上下文判断不能沿插值扩增成多个独立证据。
4. 过滤和拒绝也生成派生记录。`excluded-role-points` 当前只保留 frame/track/role/bbox，缺失 source/observed/confidence，适配时外联 short。CSV 没有 raw_bbox、anchors、smoothed、clipped 标签，不宜单独作为可信事实输入。
5. `event_time` 与 `available_at` 分离。已知依赖可填 evidence_max_source_time；依赖窗口、处理代次、原始请求/发布时刻缺失则 availability 保持 null，并声明 offline/full_clip。nominal_frame_time 不冒充 PTS。
6. 版本采用输入 SHA-256、处理阶段、规则版本及 supersedes；保留工作阶段接受后最终拒绝的两条历史。detector/Qwen/interpolation 的 confidence 语义不同，均未校准为事实正确概率。

## 复现命令与执行边界

```powershell
& $python -B -X utf8 '.\audit_recovery.py'
& $python -B -X utf8 '.\probe_offline_dependencies.py'
```

在本目录执行；首个脚本也支持 `--repo`、`--output`，并拒绝把输出放进源仓库。结构审计成功，现存 source counts 均一致；两个机制探针的断言通过。没有执行阻塞。可信准确率仍受独立、完整、逐帧人工标签缺失限制；实际 available_at 无法从现有元数据还原。下轮若继续，应先人工审核这 5 个锚点及各端点/代表插值帧，而不是重复跑模型或把 61 个净增位置当收益真值。
