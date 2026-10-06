# 遮挡篮球运动员自适应热图论文：模型可用性核查

核查日期：2026-10-06，Asia/Shanghai。对象为任媛、雒江涛、梁旭鹏的《基于自适应关键点热图的遮挡篮球运动员检测算法》，2021，33(9):1450–1456，DOI `10.3724/SP.J.1089.2021.18707`。

## 结论

**论文有实际训练和实验，不是只有构想；但本次没有找到能确认属于这篇论文的公开源码和训练完成权重，因此不能按现成模型直接接入。** “未找到”限定于下述公开入口和本次检索，不能证明作者从未分享或不会提供。

| 对象 | 本次核实状态 | 对项目的含义 |
| --- | --- | --- |
| 论文方法及实验 | 全文包含网络、损失、推理和训练设置 | 有复现依据 |
| 论文专属代码 / 权重 | 未确认公开下载入口 | 无法直接验证论文模型 |
| BasketballPlayer 原训练数据 | 全文称自行构建；未确认对应数据下载入口 | 原样复现实验仍缺数据与划分 |
| CenterNet 基础项目 | 作者仓库提供代码及 COCO / VOC 等模型下载入口 | 可作为复现起点，不能冒充本论文篮球专用权重；本轮未下载或运行 |
| 同一作者的 einiBasketball | 有另一项球员 Re-ID 工作的说明和数据 Release | 不能据此认定本篇检测模型已开源 |

## 全文直接支持的事实

- 方法预测球员目标的中心点、宽高与偏移，得到图像中的检测框。第 1.1 节讨论 DLA、Hourglass、ResNet 骨干，第 1.2 / 1.3 节分别描述损失与推理。
- 第 2.1 节：BasketballPlayer 原标注 5,141 张，增强后 7,958 张；训练 / 验证 / 测试分别为 5,049 / 1,552 / 1,357 张。
- 第 2.2 节：采用 PyTorch、Adam，在 Tesla V100 32 GB 环境训练，总周期 270 epochs。
- 表 2 的 DLA-34 版本报告 AP 53.7%、26 FPS；Hourglass-104 版本报告 AP 58.2%、10.3 FPS。不能把最快速度和最高 AP 合并为同一个版本，也不能将 AP 当作本项目的识别成功率。
- 这里的“关键点”是检测框中心，并不是人体姿态模型中的脚踝 / 脚底点。论文输出本身不提供跨帧身份、球场标定、地面坐标或战术理解；这些仍须额外模块和验证。

## 公开发布检查范围

1. 用户提供的 Science China 平台链接本轮无法直接读取，改从期刊官网和通讯作者主页读取同 DOI 论文；作者主页的该条目仅链接 PDF。
2. 读取作者托管的 7 页 PDF，核对方法、训练和结果；未发现代码、权重或数据下载地址，全文文本检索 `http`、`开源` 无匹配。
3. 检索中文 / 英文完整题名、DOI、BasketballPlayer 与 code / github / weights 等组合；GitHub 仓库搜索没有确认匹配本论文的发布。
4. GitHub API 枚举通讯作者 `jiangtaoluo` 的公开仓库，并检查可能相关仓库的说明 / 根目录。`anchor` 是密码相关文件，`tcRe-Id` 是车辆重识别，`tktr` 仅 README，`video_sim_detect` 未提供本篇论文对应说明。
5. `einiBasketball` 当前主分支树仅 README；其 README 指向另一项 Sliding Window and Weighting-Scoring 球员 Re-ID 工作，并列出 HRNet / ResNet 预训练文件。Release `Datasets` 的资产为 `BPReID-Datasets.zip`。未取得依据证明该数据等同于本文 BasketballPlayer，也未将这些预训练文件认作本文检测权重。
6. CenterNet 官方 Model Zoo 列出 DLA / Hourglass / ResNet 检测权重及训练数据。它们是相关基础方法的模型，本轮只核实发布说明，没有验证下载可达性、依赖兼容性或篮球实测效果。

## 实际复用路径

- 优先向论文通讯作者询问是否能提供匹配的训练权重、推理代码、标签规范及数据划分；公开联系方式见作者主页。本轮没有联系作者或向组外发送资料。
- 如果无法获得原模型，可基于 CenterNet 实现论文的自适应热图训练目标，再用篮球标注数据训练 / 微调。这是新的复现实验，不能通过只修改现成模型的推理参数来等同获得论文效果。
- 对当前工作台，可将本文留作遮挡检测的研究参考；本轮没有更换现有检测器、运行模型或建立精度结论。

## 来源

均于 2026-10-06 核查；网络检索的无结果不构成不存在的证明。

- [用户提供的论文入口](https://www.sciengine.com/JCADC/doi/10.3724/SP.J.1089.2021.18707)
- [期刊官网同 DOI 页面](https://www.jcad.cn/article/doi/10.3724/SP.J.1089.2021.18707)
- [通讯作者主页](https://jiangtaoluo.github.io/HomePage/)
- [作者托管的全文 PDF](https://jiangtaoluo.github.io/HomePage/data/journal/2021-Heatmap-JCADCG.pdf)，重点为正文 1452–1455 页。
- [通讯作者公开仓库](https://github.com/jiangtaoluo?tab=repositories)
- [einiBasketball](https://github.com/jiangtaoluo/einiBasketball) 与 [数据 Release](https://github.com/jiangtaoluo/einiBasketball/releases/tag/Datasets)
- [CenterNet 官方模型目录](https://github.com/xingyizhou/CenterNet/blob/master/readme/MODEL_ZOO.md)

## 同步状态

本次研究留在本地 main，未提交 / 未推送。开工核对 HEAD、origin/main 和实际远端 main 均为 `be5c43d17c78f04b4df55eda38aa6f82fde8f803`；已有其他未提交研究保持原状，无须拉取新提交。开放 Issue 列表为空，本轮范围以用户的问题为准，没有分配成员职责或更新 Issue。
