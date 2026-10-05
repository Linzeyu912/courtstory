# 最小来源语义适配实验

本目录为本机离线研究，不改生产代码，不调用模型，不生成解说文本。原项目全部只读。

运行：

```powershell
& $python -X utf8 '.\adapter\normalize.py' --repo $repo
```

可导入的接口为 `normalize_source(repo, relative_path, json_pointer, context=None)`、`validate_record(record, repo)` 和 `schema()`。`context` 中任何 verified/human_reviewed 标志都不作为事实证据。入口只接受仓库内明确白名单的研究JSON，以及实际支持的track/object/recovery/annotation行；拒绝路径穿越、任意JSON和不支持的结构。

`real-examples.json` 顶层含 `schema_version`、`example_ids`（便于下游索引）、`records`。十个真实例子包括005球和球员框、Qwen锚点、插值、平滑检测、未来角色引用、两种来源不同的标注，以及同字节两variant。

| 字段 | 含义 |
|---|---|
| `source`、`raw_payload` | 源相对路径、文件SHA、JSON Pointer、原值SHA；原row深复制且不改值 |
| `evidence.kind` | detector_observation / model_inferred_location / interpolated_location / manual_annotation_claim / agent_annotation_claim |
| `evidence.source_observed_flag` | 原始observed原值；不是本适配层的真实性判断 |
| `geometry.raw_bbox` | 源raw_bbox或明确原始检测框；Qwen／插值时是平滑前估计，不是检测实测 |
| `geometry.render_bbox` | 源bbox展示几何；与raw分开，不能反向覆盖raw；缺raw时保留null不拿render补 |
| `association` | T的局部编号、命名空间及producer版本状态；未知版本留null；person_identity=null、identity_verified=false |
| `timing` | 原frame/time及明确time_basis；恢复数据是nominal_frame_index_over_fps、容器PTS为空 |
| `availability.components` | raw_location / role / display各自的已知来源时间下界；不等于处理完成时刻 |
| `availability.available_at_source_lower_bound` | 组合记录已知依赖下界；部分依赖未记录，因此不是精确可用时刻 |
| `availability.wall_clock_available_at` | 全部null；没有从文件mtime、缓存elapsed_seconds或视频时间猜墙钟时间 |
| `role` | 角色标签、参考帧、推断属性、是否引用未来帧 |
| `court` | 半场、进攻方向、相机状态显式unknown，metric_position=null |
| `evidence_correlation_group` | `hash(源文件SHA, JSON Pointer)`，识别相同源观察的重复副本 |
| `contract_bridge` | 只对能逐源定位的已有记录引用旧contract observation ID；先运行原contract语义验证，再信任时轴 |

三个关键例子：

- `qwen_observed_true`：s24-007帧78、T8，原 `source=qwen, observed=true` 原样保留，规范kind为 `model_inferred_location`。raw_bbox `[837,202,896,415]` 与render_bbox约 `[836.743,202.079,895.743,415.079]` 分开。time=3.12属于名义帧率时轴；递归遍历插值／Qwen锚点和角色参考，已知依赖下界为帧125、5秒，仍不知完整全片选择和平滑依赖及墙钟可用时刻。
- `future_role`：s24-033帧0、T9，raw_location下界仍是帧0／0秒，role下界为帧100／4秒。展示几何的已知下界是帧0，但 `smoothing_future_window_incomplete` 明确其未来窗口缺失。因此不能把“role引用未来”说成“原检测框用了未来图像”，也不能把display当实时可用。
- `manual_claim_21` 与 `agent_annotation_56` 严格区分。前者只保存文件自述Human visual checks，review_status为source_claimed_human_unverified，未核实审阅者、几何真值或整个T轨道。后者原文明确Agent作图且非人工逐帧真值，review_status为agent_drawn_unverified。二者都不自动升级姓名或身份绑定。

005 team-stable与optimized的同一源row文件SHA和correlation group相等，去重支持数为1。不同SHA也不意味着独立模型证据；这只是低成本重复副本识别，不是完整依赖独立性证明。

当前验证：14/14字段故障反例通过，另有3个拒绝路径测试、调用方真实性标志忽略测试、相同内容去重测试，以及“保持sourceSHA不变但篡改旧contract时轴”的bridge拒绝测试。原payload改值后重哈希仍无法伪装真实源值。结果见 `validation-results.json`，完整故障输入见 `counterexamples.json` 与 `bridge-tamper-example.json`。

`input_manifest` 记录所有读取项目文件的运行前后SHA；均未改变。与 `recovery-provenance/input-manifest.json` 的重叠源哈希全部一致，Qwen raw框和125帧下界也与独立审计一致。Schema负责结构，语义validator重新从真实源归一化并比较受保护字段；通过意味着忠实解释已记录数据，不意味着位置、角色或身份是真实世界真值。

范围限制：这是少量结构的最小研究适配器，未接工作台/API；未恢复真实可用时间、全部平滑窗口、人工审阅身份或球场方向。当前没有某个“manual”字符串即可确认真值的入口。已有contract版本尚不能表达恢复推断来源，相关记录的bridge明确标为not_representable_without_additional_context，避免把推断伪装成检测观察。
