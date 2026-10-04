# 真实转播场景分类与正式标签

本目录服务后续 Agent 的素材选择与数据增强准备。用户转述的负责人原话要求覆盖镜头推拉、全场移动、画面模糊、特写打断、视角切换等真实情况，按类型标来源、时间戳并统一命名。本轮完成场景初筛与标注；尚未生成增强视频或训练模型。

当前163段保留素材的数量、人工去杂依据和推拉复核见[结果](review-summary.md)。人工抽检40段，保留28、删除12；默认集合163段，包含清晰及困难场景，不按模糊标签自动剔除。

## 读取入口

1. [index.json](index.json)：全库片段、正式标签路径、SHA-256、筛选状态及分类入口。
2. [label-schema.json](label-schema.json)：每段既有标签中 `material_labels` 的结构；[taxonomy.json](taxonomy.json)提供字段名、中文类型及动作分组词。
3. [selections/default/index.json](selections/default/index.json)：去掉无效素材与已确认包含重复后的默认使用集合。
4. [selections/all_usable/index.json](selections/all_usable/index.json)：全部可用源片段，包含重复备选。清晰度与真实场景类型分别存储，模糊场景有价值时照常保留。

```text
data/videos/
  catalog.json                         # 原有8批资产登记入口
  nba/<season>/clips/                  # 原成片，沿用已有命名和LFS
  nba/<season>/labels/<id>.json         # 新增material_labels，保留旧字段
  uploads/<date>/clips/, labels/       # 未核实赛季的上传素材
  classification/
    index.json, label-schema.json, taxonomy.json
    selections/
      default/index.json               # 去杂后的默认素材
      all_usable/index.json            # 全部可用，包含重复备选
      clear/index.json                 # 画面清楚，不表示没有困难场景
      challenge/index.json             # 偏软/模糊但有真实场景价值
      redundant/index.json             # 已确认包含的同画面备选
      excluded/index.json              # 不适用于当前普通转播场景
      needs_review/index.json          # 本轮无法确定的条目
    by_scenario/
      camera_zoom/                     # 镜头推拉
      full_court_movement/             # 连续跟随动作跨中线/在两半场间移动
      image_blur/                      # 发虚、压缩模糊或运动拖影
      closeup_insertion/               # 特写插入、比赛宽景被打断
      view_switch/                     # 可见机位/视角切换
      half_court_only/                 # 有效动作只覆盖一个进攻半场
      motion_blur/, occlusion/, players_out_of_frame/
      replay_or_teaching/
        index.json                     # 该类型全部正例及使用状态
        <clip_id>.json                 # 一段视频在该类型下的样本记录
    by_action/<action>/index.json      # 对可见动作标签分组
    content-relations.json             # 经画面核对的跨批次内容关系
```

同一片段可以属于多个场景。类别文件统一按稳定 `clip_id` 命名，`sample_id` 为 `<clip_id>__<scenario>`。视频保持唯一原路径；分类文件夹提供可机器读取的引用，避免多标签复制视频，也避免改名破坏工作台、manifest 与来源引用。

## 每段标签的含义

`material_labels` 分为 `asset`、`source`、`quality`、`scenarios`、`content`、`selection`、`content_relations`、`provenance`。每个场景都写 `value`、`intervals` 和中文 `note`，含否定和无法判断的情况。场景正例的记录附片段内时间段、原来源、来源时间段以及当前筛选状态。

`quality.clarity` 记录 clear / soft / poor / uncertain。模糊是需覆盖的输入情况，不能仅凭低分辨率剔除。`content.usable_intervals` 指可做普通比赛动作分析的区间，特写等打断可能落在区间外，但仍作为增强场景保留在 `scenarios` 中。模糊片段也不自动等于核心动作不可辨。

`half_court_only` 不等于回合不完整；横向追拍不自动等于推拉；`view_switch` 需有切换画面依据。`image_blur` 是总类，`motion_blur` 是可见运动拖影子类。同类难点、同一种动作不证明内容重复。本轮仅将实际画面已确认被另一段包含的短段从默认集合转为备选，其余真实场景继续保留。

`clip_intervals_seconds` 从当前成片 0 秒起算。来源有原片起点时，`source_intervals_seconds` 按起点加片段偏移估算；未知来源保持 null。2fps 采样间隔0.5秒，区间为近似定位，边界误差尚未逐帧验证，尤其是短暂特写与切镜，精确裁剪前需补看附近画面。比赛日期 / 赛季以既有已核实信息为准，本次上传候选不提升为正式赛季标签。

## 审核与更新

[40段分层抽检](review-sample-40.md)已全部完成，人工保留28段、删除12段；原库175段缩为163段。真实人工逐项评价共享在 [human-2026-10-04](../reviews/human-2026-10-04/README.md)，应用回执见 [human-review-updates.json](human-review-updates.json)。保留的28段为 `provenance.human_reviewed=true`，未抽的135段维持false。12段已删除的原标签、清单和决定仅以元数据归档在 [discarded/index.json](discarded/index.json)，不再作为可播放或可训练素材。

全库163段的镜头推拉由用户指定的 GPT-6.1 Sol 子Agent进行两轮独立视觉复核。结果及前后值见 [camera-zoom-recheck.json](camera-zoom-recheck.json)。固定篮架、禁区、场地字样和远侧背景的整体尺度变化是判断依据；水平跟拍、人物跑近和切机位另行区分。无法排除横摇透视的细微变化写null，列在 `index.json.unresolved_scenarios`，不放进推拉正例目录。采样间隔0.5秒不能证明边界误差最多0.5秒。

`provenance.human_review` 保存实际人工审核时间、版本、原标签指纹及记录路径；`provenance.camera_zoom_recheck` 单独保存AI复核依据。人工审核后由AI改过的字段列在 `post_review_ai_modified_fields`，尚未获得新一轮人工确认。不要把全部163段标为人工真值。

[人工标签审核页](../../../engineering/tools/material-label-review/README.md)可看当前保留素材及已处理意见，默认显示原40段抽检中的28条保留段，并显示12条已删除的完成结果。再次审核的评价保存到本机 `artifacts/material-label-human-review/records/`；其他机器可从共享的原人工记录恢复显示，汇总导出包含已删12条的原意见。

本轮统计以 [index.json](index.json) 为准。旧 [2026-10-03阅读目录](../reviews/2026-10-03/README.md)覆盖当时157段，仅保留历史结果，旧视频链接可能已因人工去杂失效；当前使用从活动索引读取。

在仓库根目录运行：

```sh
python scripts/validate_video_data.py --check-index
python engineering/scripts/build_material_labels.py --check
python engineering/scripts/build_material_labels.py --refresh  # 正式标签修改后重建分类
```

分类生成器 `engineering/scripts/build_material_labels.py --results <本机审核目录>` 只接收已逐段审核的完整结果，保留原标签和清单字段，写入正式 namespace 与分类索引。运行前须按仓库流程同步；不要使用历史 HTML 生成器覆盖新标签。

准备抽帧需要系统FFmpeg与Pillow，结构检查需要jsonschema；Python依赖见 `engineering/requirements-material-labels.txt`。生成器的完整本轮输入在本机忽略目录；其他Agent日常消费和执行 `--check` 不依赖该目录。
