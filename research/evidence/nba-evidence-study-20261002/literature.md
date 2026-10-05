# 一手依据与本机可检验假设

访问日期：2026-10-02。由并行文献代理实际访问正文与作者实现；本机实验另行列出，不把论文成绩移植到本库。没有文献工具阻塞。

| 一手来源 | 已核实约束 | 对本研究的作用 |
|---|---|---|
| [BoT-SORT 论文](https://arxiv.org/html/2206.14651v2)、[官方 GMC 实现](https://raw.githubusercontent.com/NirAharon/BoT-SORT/main/tracker/gmc.py) | 某些估计失败、首帧与静止情形都可能给出单位仿射矩阵；矩阵本身不含成功证明。官方 sparseOptFlow 代码没有与 ORB/SIFT 相同的 detection mask。 | 必须单独记录 camera estimation status、残差和有效支持；图像运动补偿不是球场标定。此结论是官方代码快照，未冒充本机预计算时使用的同版本实现。 |
| [OC-SORT 论文](https://arxiv.org/html/2203.14360v3)、[作者使用说明](https://github.com/noahcao/OC_SORT/blob/master/docs/GET_STARTED.md) | 遮挡重更新可用前后观测构造虚拟轨迹。 | 区分 observed/inferred；用未来端点的补线有可用时间与延迟。短缺口也不能自证真实轨迹。 |
| [SportsMOT](https://arxiv.org/html/2304.05170v2)、[官方项目](https://github.com/MCG-NJU/SportsMOT) | 数据片段经过无突变视角筛选，单片 ID 唯一不代表实名身份。 | 跨镜头、同队交换、队色和真人身份分别评价，不能把单镜头 MOT 成绩外推。 |
| [TVCalib](https://arxiv.org/html/2207.11709v2)、[官方评估](https://raw.githubusercontent.com/MM4SPA/tvcalib/main/evaluation/eval_projection.py) | 官方几何评估同时评原标签与 mirror_labels 后取较高分。 | 几何分数可能掩盖半场方向错误；方向标签和欧氏距离/重投影误差需分开。本任务用实际候选作镜像等价与扰动试验。 |
| [HOTA 作者说明](https://autonomousvision.github.io/hota-metrics/)、[TrackEval 实现](https://raw.githubusercontent.com/JonathonLuiten/TrackEval/master/trackeval/metrics/hota.py) | 检测与关联有分项，完整指标需 GT 匹配。 | 原始数量、显示覆盖率、检测精度、身份连续性不能互换。现有21条稀疏身份参考不足以计算完整 HOTA。 |
| [SelectiveNet 正式论文](https://proceedings.mlr.press/v97/geifman19a/geifman19a.pdf) | 接受率与接受后的风险应分别统计。 | 拒绝全部样本虽无获接受错误，也无信息价值；本研究同时报告误拒与事实可用性。没有训练或声称采用该模型。 |
| [Conformal Risk Control](https://arxiv.org/html/2208.02814v4)、[官方实现](https://raw.githubusercontent.com/aangelopoulos/conformal-risk/main/core/get_lhat.py) | 基本保证依赖交换性、有界且随阈值单调的损失；不是逐条候选正确保证。 | 连续帧不能冒充独立样本；误修率等比例损失不能直接套保证。当前小样本不宣称校准风险或概率。 |
| [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) | 原始实体、派生、修订、来源与失效分开。alternateOf不是互斥假设。 | raw 不覆盖；修订追加；互斥候选另用 hypothesis group；修订只使相关派生过期，来源齐全不证明世界事实为真。 |

研究字段建议属于本任务推论：source SHA/JSON Pointer、variant命名空间、观察时间和 available_at、坐标系、镜头/身份/标定版本、候选状态、互斥解释、决策和修订原因。它们不是任何单篇论文提供的统一标准。

本机额外核对：用于本轮 CPU 研究的项目 `.venv` 装有 Ultralytics 8.4.63；共享预计算 metadata 记载 8.4.171。没有用当前环境重跑或声称复现原检测器；本轮复现对象是已冻结JSON以上的解释/纠错实验。
