# 深度赛场项目——学术方向调研综述

> 项目背景：NBA 火箭 vs 独行侠 2025-26 赛季比赛视频的球员追踪（YOLO pose + BoT-SORT + 球场单应性变换），以及"AI 辅助解说 + 战术可视化"系统。
> 调研日期：2026-10-02。信息来源以网络公开检索（官方主页、arXiv、期刊页、会议官网）为准。
> 标注约定：【已确认】= 有官方/一手页面佐证；【推断/存疑】= 由间接证据得出或未能打开原始页面；【未找到】= 多轮检索无果。

---

## 一、点名学者调查结果

### 1.1 张绍良（Shaoliang Zhang，清华大学）——【已确认】

**身份与单位**
- 清华大学体育部（Division of Sports Science and Physical Education）**助理教授、博士生导师**，清华大学"仲英青年学者"。
  - 出处：[清华体育部英文教师页](https://www.thsports.tsinghua.edu.cn/en/info/1142/1061.htm)
- 博士毕业于西班牙马德里理工大学体育科学学院（INEF）；曾任皇家马德里、西班牙青年篮球队、**中国女篮**及清华男女篮的表现分析师。
- 领导 **APDS Lab（Athletic Performance and Data Science Laboratory，运动表现与数据科学实验室）**，招收博后/博士生/暑期实习生，与皇马、巴萨、瓦伦西亚、NBA 马刺等机构有合作。
  - 出处：[个人主页 sportssuper.github.io/ZSL](https://sportssuper.github.io/ZSL)、[Lab 页](https://sportssuper.github.io/ZSL/lab/)

**研究方向**【已确认】
- 可穿戴设备 + 人工智能 + 大数据在体育科学中的融合；运动表现监测/评估/干预；体育数据可视化。
- 主页列出的在研项目明确包括：**篮球技战术诊断、体能测试、时空数据挖掘（spatiotemporal data mining）、运动损伤分析**——即"做篮球/体育时空数据分析"这一判断成立。
- Google Scholar 引用 1270+（[Scholar 页](https://scholar.google.com/citations?user=8gPmFskAAAAJ)）。

**同名甄别过程**
- ResearchGate 上存在多位 Shaoliang Zhang（命中 profile 编号为 "Shaoliang-Zhang-5"），说明同名学者不止一位。
- 本次检索中所有篮球/体育大数据相关成果（NBA/CBA/WCBA、HoopTransformer 等）全部指向清华体育部这一位；未发现其他同名学者从事篮球分析的证据。
- 注意区分：其团队里另有一位博士生 Ming Li、硕士生 Tianyi Chu 等（见 Lab 页），以及合作者王星（见下），不要与张本人混淆。

**代表论文/项目（按主题精选，完整列表见其主页 Publications 页）**

*AI × 时空数据（与本项目最相关）*【已确认，出自其主页论文列表】
| 论文 | 作者（张绍良为通讯） | 发表 |
|---|---|---|
| **HoopEval: Individual Player Action Evaluation via Deep Reinforcement Learning**（深度强化学习评估个人攻防动作价值） | Xing Wang, Yu Fu, Sheng Xu, K. Pelechrinis, M. Zhang, M.Á. Gómez 等 | **MIT Sloan SSAC 2026**（海报），[会议官方页](https://www.sloansportsconference.com/research-papers/hoopeval-individual-player-action-evaluation-via-deep-reinforcement-learning) |
| **HoopTransformer: Advancing NBA Offensive Play Recognition with Self-Supervised Learning from Player Trajectories**（球员轨迹自监督学习识别 NBA 进攻战术） | Xing Wang, Z. Tang, J. Shao, S. Robertson, M.Á. Gómez, S. Zhang | *Sports Medicine*, 2024，[PubMed 38814566](https://pubmed.ncbi.nlm.nih.gov/38814566)，开源代码 [GitHub: Mr81wx/HoopTransformer](https://github.com/Mr81wx/HoopTransformer) |
| **Hoop-MSSL**（篮球时空数据多任务自监督表征学习） | Shao, Wang 等 | Intelligent Sports and Health, 2025【主页列表所载；另有一说为 NeurIPS 2024 相关，存疑待核】 |
| 基于海量时空数据的 NBA 控球权结果分析 | Jiao, Gong, Cao 等 | Intelligent Sports and Health, 2025 |
| **Clustering offensive play types to reveal game styles**（进攻战术类型聚类识别比赛风格） | Dong, Chen, Zhang 等 | *J. of Sports Sciences*, 2025 |
| Positional evolution in the NBA（NBA 位置演化） | Durmuş, Sansone, Zhang | *Int. J. of Performance Analysis in Sport*, 2026 |

*比赛表现建模（宏观统计路线）*【已确认】
- Explainable machine learning for CBA key performance indicators（*BMC Sports Sci Med Rehabil*, 2026）；982 场 CBA 2023-24 常规赛 PCA 分析（[ResearchGate](https://www.researchgate.net/profile/Shaoliang-Zhang-5)）
- WCBA 球队制胜关键因素建模（*Frontiers in Psychology*, 2021）
- 2019 FIBA 世界杯制胜因素分位数回归（张绍良等，**《体育学刊》2020**——其少数中文核心成果）
- NBA 赛程拥挤与主场优势（*Chaos, Solitons & Fractals*, 2023；作者含 Wang, Zhang）
- 大量训练负荷监控论文（*Biology of Sport* 2026、IJSPP 2025 ESI 高被引等）

**对本项目的意义**：张绍良是国内极少数同时具备"篮球表现分析学术传统（西班牙学派）+ 时空轨迹深度学习"的团队，且 HoopTransformer 已开源、HoopEval 刚在 SSAC 2026 发表——是最直接可对标、可引用、可复现的国内学术锚点。

---

### 1.2 王星 / "王兴"（Xing Wang，上海体育大学）——【已确认研究对象，姓名用字存疑】

**核心结论**：用户所找的篮球数据分析学者"王兴"极可能实为 **王星（Xing Wang）**，任职**上海体育大学**（不是上海交通大学）。这是张绍良团队的核心合作者、HoopTransformer 一作。

**身份与履历**【已确认】
- 马德里理工大学（UPM）体育科学学院博士，2025 年 12 月答辩，博士论文《From statistical modeling to machine learning: advancing basketball performance analysis》，导师 Miguel Ángel Gómez Ruano（西班牙篮球表现分析学派代表学者）。
  - 出处：[UPM 论文存档 oa.upm.es/92222](https://oa.upm.es/92222/)——该页明确写"**Wang, Xing（王星）**"
- 现为上海体育大学助理教授，方向为篮球运动表现分析（[ResearchGate: Xing-Wang-126](https://www.researchgate.net/profile/Xing-Wang-126)、[AMiner](https://www.aminer.cn/profile/xing-wang/61c332b26750f87864f8e4a6)）。上体官网师资页未能直接打开确认汉字，【推断/存疑：官网用字】，但 UPM 存档 + 中文检索标注均作"王星"。
- 论文从"统计建模→机器学习"演进：聚类/分类树识别球员角色、层级贝叶斯、HoopTransformer（轨迹 SSL 识别战术）、HoopEval（RL 评估动作价值）——与本项目技术栈高度同构。

**代表成果**【已确认】
1. **HoopTransformer**（*Sports Medicine* 2024，一作；见上）
2. **HoopEval**（MIT SSAC 2026，一作；见上）
3. **Player position clustering and passing path visualization**（篮球战术分析：位置聚类 + 传球路径可视化的数据挖掘系统，ACM, 2025，[DOI 10.1145/3796028.3796052](https://dl.acm.org/doi/abs/10.1145/3796028.3796052)；ACM 页 403 未能核对作者全单，【推断/存疑】）
4. Monitoring game load across quarters in professional basketball（*Biology of Sport*, 2026，[termedia](https://www.termedia.pl/Monitoring-game-load-across-quarters-in-professional-basketball-r-npositional-differences-and-contextual-effects,78,57301,0,1.html)）
5. CBA 本土与外籍球员表现差异（*Frontiers in Psychology*, 2021，与张绍良合作）

**同名甄别过程（逐一排查）**
1. **上海体育大学王兴（1966 年生）**：教授、博导，体育教育学院**田径**教学团队学术带头人，研究体育锻炼/体医融合/青少年体质——与篮球数据分析无关。【已确认不符】出处：[百度百科](https://baike.baidu.com/item/%E7%8E%8B%E5%85%B4/2021093)、[上体体教学院论文列表](https://tjxy.sus.edu.cn/info/1106/2651.htm)
2. **上海交通大学"王兴"**：多轮检索未发现任何做篮球/体育分析的"王兴"学者；命中的均为美团 CEO 王兴（知名篮球爱好者，但非学术研究者）及无关同名者。【未找到】
3. **王星（UPM 博士 → 上海体育大学）**：研究方向、机构、与张绍良的合作网络全部吻合。【已确认为最匹配】

**对本项目的意义**：王星的工作（HoopTransformer/HoopEval/位置聚类+传球可视化）就是"追踪数据→战术识别→价值评估→可视化"完整链路的学术样板，且其博士论文结论（宏观数据适合传统统计、细粒度时空数据适合机器学习）可直接指导我们的技术选型。

---

## 二、国际研究地图（2020 前后至 2026）

### 2.1 NBA 追踪数据的战术分析（Second Spectrum 体系）

| 代表工作 | 核心思想（一句话） | 出处 |
|---|---|---|
| Maheswaran & Chang（USC ISI）创立 **Second Spectrum**；2012 SSAC 最佳论文（光学追踪解构篮板/底角三分价值） | 用机器学习把球员追踪坐标转化为"每次决策的价值"，2017 年起成为 NBA 官方追踪数据供应商 | [AIP 报道](https://www.aip.org/inside-science/artificial-intelligence-in-nba-basketball)、[Reddit AMA](https://www.reddit.com/r/nba/comments/58oy95/im_rajiv_maheswaran_ceo_of_second_spectrum_we) |
| **Quantifying Shot Quality in the NBA**（Chang, Maheswaran 等, SSAC 2014） | 用 5 万+投篮轨迹的防守距离、出手位置等建模期望命中率 qSQ | [Semantic Scholar](https://www.semanticscholar.org/paper/2ef041e6d5b83979d37cb0526b7bcc9f63c5b59e) |
| **Ghosting（数据驱动幽灵）**：Le, Carr, Yue, Lucey, "Data-Driven Ghosting using Deep Imitation Learning", **SSAC 2017** | 深度模仿学习预测"如果防守者换一种站位/选择，球员会怎么跑"——反事实轨迹叠加在真实画面上即 ghosting 可视化 | [Disney Research PDF](https://la.disneyresearch.com/wp-content/uploads/Data-Driven-Ghosting-using-Deep-Imitation-Learning-Paper1.pdf)、[Caltech 存档](https://authors.library.caltech.edu/records/74xh3-ysx85) |
| **挡拆/掩护识别**：McQueen, Wiens, Guttag, "Automatically Recognizing On-Ball Screens", SSAC 2014 | 用浅层 ML 分类器（轨迹几何特征：距离/速度/相对位置）自动识别有球掩护，14 场 21 节 NBA 数据 | [Sloan 官方页](https://www.sloansportsconference.com/research-papers/automatically-recognizing-on-ball-screens) |
| **防守策略识别**：Felsen 等, "Use of Machine Learning to Automate the Identification of Basketball Strategies Using Whole Team Player Tracking Data", *Applied Sciences* 2020 | 全队追踪数据自动识别针对挡拆的防守策略（换防/挤过/包夹） | [MDPI 2076-3417/10/1/24](https://www.mdpi.com/2076-3417/10/1/24) |
| **空间价值**：Cervone 等, "MULTIRESP: A multiresolution stochastic process model for basketball"（NESSIS 2015 提出 court space value） | 随机点过程建模持球-移动-站位联合分布，量化每一次"占据球场空间"的得分期望增量 | [arXiv:1408.0777](https://arxiv.org/html/1408.0777v3)、[NESSIS 2015 回顾](https://fansided.com/2015/09/30/guest-post-dispatches-from-nessis-2015) |
| Finishing Space Value（FSV）模型, *Sports* 2024 | 用球员占位对终结决策的价值进行建模，突破 xG 式模型的局限 | [MDPI 2075-4663/12/8/208](https://www.mdpi.com/2075-4663/12/8/208) |
| **GameSense**（BPTN 追踪网络 + BPAN 分析网络）, *Scientific Reports* 2025 | 端到端"视频→球员追踪→战术表现分析"分层时空 Transformer | [Nature](https://www.nature.com/articles/s41598-025-29586-y) |
| **TacticExpert: Spatial-Temporal Graph Language Model for Basketball Tactics**（arXiv 2025） | 时空图 Transformer + 战术专家混合（MoE）+ 图接地接入 LLM，支持零样本战术问答 | [arXiv:2503.10722](https://arxiv.org/abs/2503.10722) |
| Acceleration in the NBA: Towards an Algorithmic Taxonomy of Basketball Plays（SSAC） | 从追踪数据自动归纳战术动作的算法分类学 | [Sloan 过往会议归档](https://www.sloansportsconference.com/past-conferences) |

### 2.2 群体活动识别（Group Activity Recognition, GAR）

| 代表工作 | 核心思想 | 出处 |
|---|---|---|
| Volleyball 数据集 + Transformer 系列（如 "Hunting Group Clues with Transformers"） | 以球员个体动作 + 全队场景两级标签做 GAR，是标准基准 | [arXiv:2207.05254](https://arxiv.org/pdf/2207.05254)、[Kaggle 数据集](https://www.kaggle.com/datasets/sherif31/group-activity-recognition-volleyball) |
| **Group Activity Recognition in Basketball Tracking Data**（2022） | 直接用球员/球的坐标（非图像）识别篮球群体战术动作（挡拆等）——与我们的"追踪坐标"路线一致 | [arXiv:2209.00451](https://arxiv.org/html/2209.00451v1) |
| **LiGAR**（WACV 2025） | LiDAR 引导的分层 Transformer，在 Volleyball 与 **NBA 数据**上验证 | [WACV Open Access](https://openaccess.thecvf.com/content/WACV2025/html/Chappa_LiGAR_LiDAR-Guided_Hierarchical_Transformer_for_Multi-Modal_Group_Activity_Recognition_WACV_2025_paper.html) |
| "Pixels or Positions? Benchmarking Modalities in GAR"（2025） | 系统比较"像素 vs 坐标"两种模态对 GAR 的贡献 | [arXiv:2511.12606](https://arxiv.org/html/2511.12606v1) |
| Hierarchical query design transformer（*Sci. Reports* 2025） | 分层查询+分布式注意力建模球员交互 | [Nature](https://www.nature.com/articles/s41598-025-16752-5) |

**共识**：坐标/骨架模态在体育 GAR 上往往优于纯像素——对我们（已有 pose + 追踪坐标）是利好。

### 2.3 多智能体轨迹预测在球类运动的应用

| 代表工作 | 核心思想 | 出处 |
|---|---|---|
| Multi-Modal Trajectory Prediction of NBA Player Movement（WACV 2021） | CNN+LSTM 多模态预测 NBA 球员未来轨迹 | [PDF](https://djurikom.github.io/pdfs/hauri2021wacv.pdf) |
| Unified Uncertainty-Aware Diffusion for Multi-Agent Trajectory Prediction（**CVPR 2025**） | 扩散模型生成多模态不确定轨迹，在 Basketball-U/Football-U/Soccer-U（源自 NBA）验证 | [CVPR 海报](https://cvpr.thecvf.com/virtual/2025/poster/32755) |
| Sports-Traj: Unified Trajectory Generation Model | 统一的多智能体运动生成框架 | [OpenReview](https://openreview.net/forum?id=9aTZf71uiD) |
| Coherent Multi-Agent Trajectory Forecasting in Team Sports（arXiv 2025） | 保证多智能体轨迹的时序一致性联合预测 | [arXiv:2511.18248](https://www.alphaxiv.org/abs/2511.18248) |
| Ball Trajectory Inference from Multi-Agent Sports Contexts（**KDD 2023**） | 集合 Transformer 从球员上下文推断球的位置/轨迹 | [ACM](https://dl.acm.org/doi/10.1145/3580305.3599779) |
| Enhancing multi-agent trajectory prediction in competitive ball sports（*Neural Networks* 2026） | 竞技球类时空交互建模的综合增强 | [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0893608026002947) |
| 趋势小结 | 2023-2026 从 LSTM 迁移到 Transformer/扩散模型/等变图网络，强调不确定性、多模态与一致性 | — |

### 2.4 MIT Sloan Sports Analytics Conference 篮球代表作清单

1. Deconstructing the Rebound with Optical Tracking Data — Maheswaran 等，SSAC 2012 **最佳论文**（[回顾报道](https://www.aip.org/inside-science/sloan-sports-analytics-conference-research-paper-finalists)）
2. Quantifying Shot Quality in the NBA — Chang, Maheswaran 等，SSAC 2014（[Semantic Scholar](https://www.semanticscholar.org/paper/2ef041e6d5b83979d37cb0526b7bcc9f63c5b59e)）
3. Automatically Recognizing On-Ball Screens — McQueen, Wiens, Guttag，SSAC 2014（[Sloan](https://www.sloansportsconference.com/research-papers/automatically-recognizing-on-ball-screens)）
4. Data-Driven Ghosting using Deep Imitation Learning — Le, Carr, Yue, Lucey，SSAC 2017（[PDF](https://la.disneyresearch.com/wp-content/uploads/Data-Driven-Ghosting-using-Deep-Imitation-Learning-Paper1.pdf)）
5. Predicting NBA Talent from Enormous Amounts of College Basketball Tracking Data — SSAC 2021（[Sloan 竞赛页](https://www.sloansportsconference.com/research-paper-competition)）
6. The Effect of Basketball Analytics Investment on NBA Team Performance — SSAC 2025（[MIT News](https://news.mit.edu/2025/basketball-analytics-investment-nba-wins-and-other-successes-0325)）
7. Analyzing NBA Player Positions and Interactions with Density Functional Fluctuation Theory —（[Sloan](https://www.sloansportsconference.com/research-papers/analyzing-nba-player-positions-and-interactions-with-density-functional-fluctuation-theory)）
8. Effort vs. Concentration: The Asymmetric Impact of Pressure on NBA Performance —（[Sloan](https://www.sloansportsconference.com/research-papers/effort-vs-concentration)）
9. **HoopEval: Individual Player Action Evaluation via Deep RL** — Xing Wang 等，SSAC 2026（[Sloan](https://www.sloansportsconference.com/research-papers/hoopeval-individual-player-action-evaluation-via-deep-reinforcement-learning)）
10. Deep Reinforcement Learning for NBA Player Valuation: A Temporal Difference Approach with Shapley Attribution — SSAC 2026（2026 会议论文集）

> 归档入口：[Sloan Research Papers Room](https://www.sloansportsconference.com/room/research-papers-room)（历年论文可按年浏览）。

### 2.5 事件检测 / 解说生成

**足球领域最成体系，可整体迁移到篮球：**

| 代表工作 | 核心思想 | 出处 |
|---|---|---|
| **MatchTime**（EMNLP 2024） | 3.2 万条"视频片段-解说词"对齐数据集 + 自动解说生成系统（基于 SoccerNet） | [arXiv:2406.18530](https://arxiv.org/html/2406.18530v2)、[ACL Anthology](https://aclanthology.org/2024.emnlp-main.99) |
| **MatchVision**（CVPR 2025） | 1988 场比赛 3323 小时视频-语言预训练，统一动作定位/字幕/解说 | [项目页](https://jyrao.github.io/UniSoccer) |
| **SoccerComment**（WACV 2025） | 多模态 LLM + RAG 生成解说 | [PDF](https://openaccess.thecvf.com/content/WACV2025/papers/Li_Multi-Modal_Large_Language_Model_with_RAG_Strategies_in_Soccer_Commentary_WACV_2025_paper.pdf) |
| SoccerNet-Echoes（2024） | 多语言解说音频数据集 | [arXiv:2405.07354](https://www.alphaxiv.org/abs/2405.07354) |
| GameSight（2025） | 知识增强视觉推理的两阶段解说生成 | [arXiv:2604.00057](https://arxiv.org/html/2604.00057v1) |
| TimeSoccer（ACM MM） | 端到端联合预测时间戳与生成字幕的多模态 LLM | [ACM](https://dl.acm.org/doi/10.1145/3746027.3755077) |
| Deep Learning for Sports Video Event Detection（2025 综述） | 形式化体育视频三大事件任务：TAL（时间动作定位）/AS（动作定位）/PES | [arXiv:2505.03991](https://arxiv.org/html/2505.03991v3) |
| **Deep Learning-Based Automated Tactical Clip Extraction from Basketball Games**（*Applied Sciences* 2026） | 自动从篮球比赛视频裁剪进攻战术片段——与我们的"战术可视化"直接对口 | [MDPI](https://www.mdpi.com/2076-3417/16/11/5683) |
| MMDL 多模态高光检测（*Applied Intelligence*） | 字幕+骨架+视频三模态融合做高光检测 | [PDF](https://aiit.csie.tku.edu.tw/134.pdf) |
| Automated Detection of Sport Highlights from Audio and Video（2025） | 轻量音频+视频高光检测 | [arXiv:2501.16100](https://arxiv.org/abs/2501.16100) |

---

## 三、中文可见的篮球战术分析研究

**核心团队/人物**【已确认】
1. **沈燕飞**：北京体育大学体育工程学院**院长**、中国体育大数据中心主任。主持国自然面上项目"**时空数据驱动的团体运动表现分析与评价技术研究**"（No. 72071018，2021–2024，48 万，已结题；关键词：团体运动、数据挖掘、时空分析）。
   - 出处：[北体大 2020 国自然获批公告](https://www.bsu.edu.cn/kxyj/kyxm/b7d185c8b30d4510b7102cb2c3fd6019.htm)、[沈燕飞个人页](https://sse.bsu.edu.cn/szdw/ydgzjsjxtd/2de06edbeb3949e0aee74acf58eb5570.htm)、[体育工程学院院系概况](https://sse.bsu.edu.cn/yxgk/index.htm)
2. **崔一雄**：北体大副教授，UPM 博士（与张绍良、王星同出西班牙马德里理工体育科学学派），方向为运动表现分析、智能体育工程、体育大数据；与张绍良合著《运动表现分析的发展及展望》（体育学刊 2016）。
   - 出处：[院系概况页](https://sse.bsu.edu.cn/yxgk/index.htm)
3. **张绍良团队**（清华 APDS）：见第一部分；中文核心成果如《基于分位数回归的篮球制胜因素分析——以 2019 FIBA 世界杯为例》（体育学刊 2020）。
4. **综述文献**：《运动表现分析：过去、现在与未来》（易清、黎涌明、张铭鑫等，上海体育大学学报 2023，[DOI 页](https://shtyxyxb.xml-journal.net/article/doi/10.16099/j.sus.2022.05.23.0003)）；《运动表现分析与"三大球"竞训融合：国际经验及应用前瞻》。

**计算机视觉侧的中文工作**
- 《基于遮挡处理的篮球运动员检测算法》（计算机辅助设计与图形学学报 2021，[链接](https://www.sciengine.com/JCADC/doi/10.3724/SP.J.1089.2021.18707)）——针对篮球视频遮挡场景的球员检测，与我们的 YOLO+BoT-SORT 追踪前端同类。
- 改进 YOLOv5 篮球运动员跟踪（Machine Graphics & Vision，[链接](https://mgv.sggw.edu.pl/article/view/10069)）；BGS-YOLO 篮球检测（PLOS ONE 2025，[链接](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0326964)）。

**结论**【推断】
- 宏观表现分析（box-score 建模、制胜因素）在中文体育核心期刊较多（张绍良/崔一雄/刘鸿优等西班牙学派华人学者是主力）。
- "追踪数据级"的篮球战术识别在**中文核心期刊几乎空白**：以"篮球+YOLO+单应性球场映射+战术分析"四要素检索，未找到齐备的中文核心文献【未找到】；相关方法论多以英文期刊（张绍良团队）或工程实践/CSDN 博客形式存在。
- 硕博学位论文层面：体育院校（北体大、上体、武体）在"时空数据+团体球类"方向有国自然项目牵引，知网可直接以"篮球 + 时空数据/轨迹 + 技战术"检索（本次公开检索仅命中 CNKI 摘要入口，未能展开）【推断/存疑】。

---

## 四、对我们项目的可借鉴点（约束：单机位转播视频 + 官方 play-by-play）

我们已有：YOLO pose 检测 → BoT-SORT 多目标追踪 → 单应性变换到球场平面坐标 → 官方 PBP 事件流。按"投入产出比"排序：

### 4.1 可直接复现/简化复现的方法
1. **挡拆/掩护检测（最优先）**：走 McQueen 2014 的"浅层特征 + 分类器"路线——在球场坐标系中计算持球人与最近队友/防守人的距离、相对速度、站位夹角等几何特征序列，用小模型（甚至规则阈值）识别 on-ball screen / PnR。我们没法拿到 NBA 官方追踪数据训练大模型，但**单场比赛级规则+几何特征**完全够用，且 PBP 的 "screen/turnover/assist" 事件可做弱监督标签。
2. **空间价值/Spacing 指标（可视化主力）**：Cervone 路线的可解释简化版——在单应性变换后的平面坐标上计算：进攻方占用空间面积、防守人最近距离热图、stretch index、五人重心与 spread。这些指标不需要深度模型，实时性好，适合战术可视化面板。
3. **Ghosting 简化版**：不必做 Le 2017 的全量模仿学习；对每个球员训练一个轻量 LSTM/Transformer 短时轨迹预测器（我们自采的单场轨迹即可训练），将"预测轨迹 vs 实际轨迹"叠加渲染即成 ghosting 效果；HoopTransformer 开源代码（[GitHub](https://github.com/Mr81wx/HoopTransformer)）可作为轨迹编码器参考实现。
4. **群体战术标签（供解说调用）**：采用"坐标模态 GAR"路线（arXiv 2209.00451）：用追踪坐标 + 相对几何特征 + 小型 Transformer/时序模型，输出有限类别（挡拆、无球掩护、快攻、落位阵型）。排球 GAR 数据集的分层标注范式可借鉴设计标签体系。
5. **AI 解说生成**：MatchTime/SoccerComment 的"事件时间线 + LLM/RAG"范式可直接迁移为篮球版——PBP 文本 + 我们统计的追踪指标（跑动距离、速度峰值、阵型变化）+ 战术标签共同构成 prompt 上下文，由中文 LLM 生成解说词。TacticExpert 的"图结构接地 LLM"是进阶方向。
6. **高光检测**：轻量多模态即可落地：音频能量突变 + 比分跳变 + PBP 关键词（扣篮/三分/盖帽）+ 我们的追踪异常检测（快攻速度阈值），参考 arXiv 2501.16100 与 MMDL。
7. **战术片段自动剪辑**：直接对标 MDPI 2026 的篮球战术片段提取工作，把"检测到的战术事件 + 前后 10s 窗口"自动剪成集锦，是黑客松演示的天然亮点。

### 4.2 数据条件下的取舍
- **能做**：几何/规则类战术检测、空间指标、阵型聚类（Zhang 团队 play-type clustering 方法用汇总数据也能跑）、ghosting 简化、RAG 解说、高光剪辑。
- **难做（说明原因）**：HoopEval 式 RL 动作价值评估（需大规模标注/多场轨迹）；Cervone 完整随机过程模型（需海量 possession 数据）；端到端视频-语言预训练（MatchVision 级别需 3000+ 小时数据）。
- **对标引用策略**：国内可引张绍良/王星（HoopTransformer、HoopEval）与北体大沈燕飞团队；国际可引 Second Spectrum/Maheswaran、Ghosting（Le 2017）、On-Ball Screens（McQueen 2014）、Cervone 空间价值、MatchTime——构成"战术识别→价值评估→可视化→解说"完整文献链。

---

## 五、参考链接汇总

**点名学者**
- 张绍良主页：https://sportssuper.github.io/ZSL ｜ 论文页：https://sportssuper.github.io/ZSL/publications/ ｜ Lab：https://sportssuper.github.io/ZSL/lab/
- 清华体育部教师页：https://www.thsports.tsinghua.edu.cn/en/info/1142/1061.htm
- HoopTransformer：https://pubmed.ncbi.nlm.nih.gov/38814566 ｜ https://github.com/Mr81wx/HoopTransformer
- HoopEval（SSAC 2026）：https://www.sloansportsconference.com/research-papers/hoopeval-individual-player-action-evaluation-via-deep-reinforcement-learning
- 王星 UPM 博士论文：https://oa.upm.es/92222/ ｜ ResearchGate：https://www.researchgate.net/profile/Xing-Wang-126
- 上体"王兴"（同名，田径）：https://baike.baidu.com/item/王兴/2021093

**国际研究**
- Second Spectrum/NBA：https://www.aip.org/inside-science/artificial-intelligence-in-nba-basketball
- Quantifying Shot Quality：https://www.semanticscholar.org/paper/2ef041e6d5b83979d37cb0526b7bcc9f63c5b59e
- Ghosting：https://la.disneyresearch.com/wp-content/uploads/Data-Driven-Ghosting-using-Deep-Imitation-Learning-Paper1.pdf
- On-Ball Screens：https://www.sloansportsconference.com/research-papers/automatically-recognizing-on-ball-screens
- 防守策略识别（MDPI 2020）：https://www.mdpi.com/2076-3417/10/1/24
- Cervone MULTIRESP：https://arxiv.org/html/1408.0777v3
- FSV：https://www.mdpi.com/2075-4663/12/8/208
- GameSense：https://www.nature.com/articles/s41598-025-29586-y
- TacticExpert：https://arxiv.org/abs/2503.10722
- 篮球追踪 GAR：https://arxiv.org/html/2209.00451v1 ｜ LiGAR：https://openaccess.thecvf.com/content/WACV2025/html/Chappa_LiGAR_LiDAR-Guided_Hierarchical_Transformer_for_Multi-Modal_Group_Activity_Recognition_WACV_2025_paper.html
- CVPR 2025 扩散轨迹预测：https://cvpr.thecvf.com/virtual/2025/poster/32755 ｜ KDD 2023 球轨迹推断：https://dl.acm.org/doi/10.1145/3580305.3599779
- MatchTime：https://aclanthology.org/2024.emnlp-main.99 ｜ MatchVision：https://jyrao.github.io/UniSoccer ｜ SoccerComment：WACV 2025（见上）｜ SoccerNet-Echoes：https://www.alphaxiv.org/abs/2405.07354
- 事件检测综述：https://arxiv.org/html/2505.03991v3 ｜ 篮球战术片段提取：https://www.mdpi.com/2076-3417/16/11/5683
- Sloan 论文归档：https://www.sloansportsconference.com/room/research-papers-room

**中文研究**
- 沈燕飞/国自然 72071018：https://www.bsu.edu.cn/kxyj/kyxm/b7d185c8b30d4510b7102cb2c3fd6019.htm ｜ https://sse.bsu.edu.cn/szdw/ydgzjsjxtd/2de06edbeb3949e0aee74acf58eb5570.htm
- 北体大体育工程学院：https://sse.bsu.edu.cn/yxgk/index.htm
- 运动表现分析综述（上体学报 2023）：https://shtyxyxb.xml-journal.net/article/doi/10.16099/j.sus.2022.05.23.0003
- 篮球球员遮挡检测（CAD&CG 学报 2021）：https://www.sciengine.com/JCADC/doi/10.3724/SP.J.1089.2021.18707
