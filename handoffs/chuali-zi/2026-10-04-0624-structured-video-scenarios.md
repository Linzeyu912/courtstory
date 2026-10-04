# 交接：175段真实转播场景标签与结构化目录

- 日期 / 时区：2026-10-04 06:24，America/New_York
- 成员：chuali-zi
- 任务 / Issue：用户本聊天授权；GitHub Issue查询未返回现有任务。按用户提供的负责人原话，为增强/泛化初筛推拉、全场移动、模糊、特写打断、视角切换等真实情况。
- 分支：main
- 提交：本轮产出未提交；同步基线为 `142e733e8b58b55bd70315518582e9ca0c43cdd7`
- 状态：本轮AI初筛与标注完成，待用户最终审核

## 本次完成

- 两次同步远端：先接入新18段至092c633，再快进工程更新至142e733。8批175段成片均已在本机；第二次同步不新增视频。
- 175份现有标签新增正式 `material_labels`，每段10项显式场景值、异常区间、可用区间、可见动作、来源、SHA-256及AI方法。8份manifest追加轻量引用/状态，总catalog增加classification索引引用。未覆盖原有字段。
- 新增 `data/videos/classification/`：JSON Schema、taxonomy、全库index、7种selection、10种真实场景文件夹及10种动作分类；每个场景样本以稳定clip ID命名，引用原视频，不复制MP4。
- 新增 `data/videos/AGENTS.md`接手契约、`engineering/scripts/build_material_labels.py`生成/校验脚本及轻量依赖表。更新视频入口、管理规范、repository-map及status；原HTML/CSV保留为157段历史阅读辅助。
- 三组GPT-6.1 Sol子Agent逐段审核175段，第四名独立抽查8段。382张完整contact sheets / 4,617采样帧，另44张唯一原尺寸帧；复查纠正平移误判，补出末段推近及特写发虚。结果/证据放本机忽略目录 `artifacts/material-labels-20261003/` 与 `artifacts/material-review-20261003/`。
- 默认173段，全部可用174段：清晰可用157、偏软可用17、教学加工排除1；确认被较完整段包含的短段转重复备选1。详见 `data/videos/classification/review-summary.md`。

## 结论与依据

- 范围以本聊天用户提供的负责人原话为准：困难场景本身要保留为增强样本，不能只以清晰度删掉。
- 新007仅1.33秒但有实际跨中线推进，因此保留partial_action；教学011不是普通原始转播过程，排除但保留分类参考和源片。
- 新001实际包含旧008-006的连续动作，短段仅移出默认集合；新012/旧sample001部分重叠，旧段独有特写，继续保留。另4对同对阵/时钟相近片段经画面核对是不同内容，不误删。没有把动作相似当内容重复。
- 去杂补核后共22对确认关系：1完整包含、2局部重叠、19不同画面。030-020末23–25秒与030-021初0–2秒确为边界重叠，正式 `clip_overlap_intervals_seconds` 保存约数；两段独立动作都保留。验收样例与两批上传、历史8段与030的实际同钟候选按画面排除误匹配。未声称完成全库所有片段两两去重。
- 来源沿用各batch manifest及sources。上传来源/原片时间/赛季未知时保留null，不提升候选比赛为正式标签。标签时间戳是2fps近似定位，未保证逐帧边界误差。
- 四位子Agent按用户指定使用gpt-6.1-sol，AI观察不冒充人类真值，human_reviewed=false。

## 验证

- `python engineering/scripts/build_material_labels.py --results artifacts/material-labels-20261003`：生成并检查175条、10显式维度/段，Schema、所有分类成员、正式标签/manifest/index状态、来源时间换算及陈旧分类文件检查通过。
- 原字段保护：对本轮写入前备份比较175份label + 8份manifest，除新增namespace/summary外语义一致。
- `python scripts/validate_video_data.py --check-index`：175视频、2,137,647,743字节、175哈希和LFS指针检查。
- Python语法、Git diff whitespace及8份本轮文档217个相对链接检查通过；同步恢复后无未解决Git冲突。
- 未训练模型，未生成增强视频，未测增强后泛化收益，未运行工作台功能验收；远端工程功能仅同步，非本轮更改。

## 阻塞与待确认

- 用户最终审核尚未执行；034开头0–0.5秒叠化是否更换机位无法确认，明确null。教学011半场范围同样null，不影响普通场景使用集合。
- 上传原网页和原片起点缺失，无法提供其绝对来源时间，片段内时间可用。
- stash恢复的docs/status冲突已结合两侧目的解决，保留全部原记录；同步备份stash继续保留，不清理其他历史stash。

## 下一步

- 从 `data/videos/classification/selections/default/index.json`选增强输入；按目标场景读 `by_scenario/<type>/<clip_id>.json`再到原标签material_labels取时间/来源，不能从历史HTML推断当前状态。
- 用户最终复核可直接修改正式material_labels并补依据；精确裁剪先逐帧核对区间边缘。新增/替换视频后按新SHA重审并更新分类。
- 按用户授权选择性提交/推送本轮文件，保留其他实验、未提交交接和工程修改。不能git add整个工作区。

## 同步状态

- main与origin/main均已核对为142e733；本轮标签/分类/文档仍留在本机，未声称已在云端。未建分支或PR，未删除源视频。
