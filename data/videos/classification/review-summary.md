# 2026-10-04 素材人工审核、去杂与推拉复核结果

日期 / 时区：2026-10-04，America/New_York。依据是用户完成的40段逐项人工审核，以及随后要求“丢掉的全部丢掉、镜头推拉重新检查、多Agent辅助、完成后提交远端”。负责人原话将模糊、推拉、全场移动、特写与视角切换作为真实场景覆盖，为后续数据增强和泛化准备。本轮产出标签与素材目录，未生成增强视频或训练模型。

## 2026-10-05 官方训练补充

新增2段官方训练视频按同一10维标准完成AI初筛。当前9批 / 165段，清晰146、困难19、默认165、真人复核28；原163段标签未重写。具体区间和工作台入口见[批次说明](../uploads/2026-10-05-official-training/README.md)。下文保留10月4日审核时的统计。

## 当时素材

原库175段，人工抽检40段全部完成：28段保留、12段丢弃。已按用户授权移除12个MP4和活动标签，从manifest、分类目录、同动作相似引用与跨批次内容关系中清理。来源原始快照和历史收集记录保留，编号不重排；删除前标签、来源与明确去留原因仅作元数据归档。

当前8个登记批次、163个活动视频：24–25赛季98、25–26赛季36、THY补充14、本次上传13、独立验收2。正式标签清晰可用144、困难场景19，默认保留集合163。用户保留的教学加工片段已保留，普通连续球权测试需按教学标签筛除，不能把它当原始直播真值。

[人工原记录](../reviews/human-2026-10-04/index.json)40条按原样共享；[应用回执](human-review-updates.json)记录12条素材、16项incorrect字段的处理，包括8项推拉及动作、出画、清晰度。两条未写原因的丢弃不编造原因，帧数低等理由保留人工意见，未误写成重新测量结论。163条保留标签中仅实际人工审核的28条 `human_reviewed=true`，未抽的135条维持AI来源；12条已删归档也保存人工审核身份。

## 全库镜头推拉

3名用户指定的GPT-6.1 Sol子Agent分三批查看全部163段2fps接触表，再由不同Agent对每段作独立交叉复核。主Agent核对人工动作意见与代表性原图、合并结果。初24条独审发现7条尺度变化证据不足，随后把交叉复核扩展到全163段，没有只检查抽样正例。

最终推拉125条true、7条false、31条null。相对原标签66条判断值改变，区间和观察说明逐条更新。横向跟拍、人物跑近、机位切换单独区分；只有固定篮架、禁区/场地文字与远侧背景等多处整体尺度变化有依据才确认推拉。无法排除横摇透视的细微变化记录null，不进入推拉正例目录，列在 `index.json.unresolved_scenarios`。

原值、第一轮、独审结果、信心和观察理由见 [camera-zoom-recheck.json](camera-zoom-recheck.json)。每条正式标签的 `provenance.camera_zoom_recheck` 保存复核来源；人工后发生的AI修改另记于 `human_review.post_review_ai_modified_fields`。原人工完成状态不意味着用户再次确认了这些AI区间。

## 场景覆盖

同一素材可属于多个场景，以下数量不能相加当独立素材数。

| 类型 | 正例素材数 | 分类入口 |
|---|---:|---|
| 镜头推拉 | 125 | [camera_zoom](by_scenario/camera_zoom/index.json) |
| 全场移动 | 71 | [full_court_movement](by_scenario/full_court_movement/index.json) |
| 画面模糊 | 39 | [image_blur](by_scenario/image_blur/index.json) |
| 特写打断 | 26 | [closeup_insertion](by_scenario/closeup_insertion/index.json) |
| 视角切换 | 27 | [view_switch](by_scenario/view_switch/index.json) |
| 仅半场画面 | 91 | [half_court_only](by_scenario/half_court_only/index.json) |
| 运动拖影 | 32 | [motion_blur](by_scenario/motion_blur/index.json) |
| 遮挡 | 159 | [occlusion](by_scenario/occlusion/index.json) |
| 球员出画 | 116 | [players_out_of_frame](by_scenario/players_out_of_frame/index.json) |
| 回放或教学加工 | 1 | [replay_or_teaching](by_scenario/replay_or_teaching/index.json) |

## 读取与边界

活动使用读取 [index.json](index.json)、[selections/default](selections/default/index.json)及已有标签的 `material_labels`；真实人工意见从 [human-2026-10-04](../reviews/human-2026-10-04/README.md)读取，已删除素材仅查 [discarded](discarded/index.json)。旧157段HTML/CSV与历史字段保留当时结论，部分旧媒体路径已删除，不再作为当前使用索引。

来源、赛季、原片起点未确认的上传维持null，不将NBA候选比赛信息提升为确认。2fps采样间隔0.5秒，区间为近似定位，尚未验证逐帧边界误差；精确裁剪应补看附近画面，不能把采样间隔说成误差上限。

验证命令：`python engineering/scripts/build_material_labels.py --check`、`python scripts/validate_video_data.py --check-index`、人工审核服务Python测试及JS模型测试。共享标签可直接读取，不依赖本机忽略的抽帧图。
