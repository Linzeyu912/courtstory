# HoopTransformer、Hoop-MSSL、HoopEval：模型发布专项核查

核查日期：2026-10-05，Asia/Shanghai。用户口述的 Hope 对应论文名称 **Hoop**。本文优先回答“能否拿到训练好的模型、它吃什么数据、产出什么、放到我们哪一步”。这是本地研究结果，没有接入生产或完成本项目精度验收。

**本轮发现修正了前轮结论：HoopTransformer 作者在已关闭的 Issue 中分享过权重与 notebook；HoopEval 在旧提交中有可下载的训练 checkpoint，本机已严格加载并完成 CPU / GPU 前向。只检查当前目录和 Releases 会漏掉它们。Hoop-MSSL 仍未找到可确认的官方代码 / 权重发布。**

## 1. 三个模型到底公开到哪一步

| 项目 | 作者源码 | 训练权重 | 下游头 / 推理材料 | 现在能做到什么 |
| --- | --- | --- | --- | --- |
| **HoopTransformer** | 有，主仓库 MIT | **作者在 Issue 分享过 `Checkpoints_C.ckpt`**；本轮匿名下载跳到 Google 登录页，文件预览返回 401，未取得权重 | 作者 Colab notebook 可匿名下载；含 `create_batch_class` 与加载示例，但依赖本地数据 / 路径、未定义的对象与映射；未找到完整可用分类器包 | 已验证源码结构和 90,524 条现成向量检索；尚不能给我们新回合可靠分类 |
| **Hoop-MSSL** | 尚未找到可确认的官方发布；有明确自称复现的第三方代码 | 官方及该第三方仓库均未发现可下载 checkpoint | 第三方有自定义微调头，未证实对应论文训练参数；本机前向失败 | 能参考方法和任务设计，不能作为已取得的官方成品模型 |
| **HoopEval** | 有；当前 / 检查到的历史树未发现根 LICENSE | **旧提交有 17,359,176 字节 checkpoint，已下载并运行**；当前分支已删除 | 与旧版 `QTransformer.py` 严格匹配，含球 / 球员动作 Q 头及 qSQ 头；不是当前主分支结构 | 可做旧版离线研究实验；未确认与 2026 论文最终模型一致，不能直接作为正式评分器 |

“源码公开”“权重能下载”“有明确开源许可”“拿来即可推理”是四项不同事实。这里把作者公开的实验代码称为公开源码；HoopEval 缺少根许可证，不能仅凭 GitHub 可见就称其有明确的开源许可。HoopTransformer 的 MIT 在源码仓库内，外链权重的适用范围本轮未单独核实。

## 2. HoopTransformer：从整段进攻跑位得到战术候选

论文：*HoopTransformer: Advancing NBA Offensive Play Recognition with Self-Supervised Learning from Player Trajectories*，Sports Medicine，2024。[论文](https://doi.org/10.1007/s40279-024-02030-3)、[作者源码](https://github.com/Mr81wx/HoopTransformer)。

### 功能与数据

它把一段进攻中的多人协作跑位变成可计算的表示。先用遮挡重建 / 预测学习跑位规律，再用人工标注训练战术分类头；也能通过向量相似度找历史回合。

- **输入：** 球 + 五名进攻球员，连续 x、y、速度，稳定身份、进攻方向、回合边界与有效帧 mask。公开实现使用英尺、5 Hz，整理为 `[6,121,3]`。不是一张 2D 路线截图，也不是只给一个球员的轨迹。
- **编码器输出：** `[6,121,256]` 的时空特征。池化后可得到 256 维回合向量，用于相似检索。
- **战术分类输出：** 只有再接训练好的分类头，才有十四类中的战术标签与分数。论文的 81.5% top-1 是作者数据上微调后的结果，不是未训练编码器自带的能力，也不是我们视频上的准确率。
- **项目位置：** 可信 2D 准备快照 → 回合整理 → 战术分类 / 相似回合检索 → 战术 Agent 的证据输入。它是“这套跑位像什么战术”的组件，不负责视频中的人物检测和球场标定。

详细训练与标签边界见[逐篇指南](PAPER_GUIDE.md#1-hooptransformer识别整套进攻战术寻找相似回合)。

### 新发现：权重在 Issue，而不在仓库文件里

[Issue #1](https://github.com/Mr81wx/HoopTransformer/issues/1)标题就是 model weights and inference，已关闭。作者 `Mr81wx` 在回复中给出：

1. [权重分享回复](https://github.com/Mr81wx/HoopTransformer/issues/1#issuecomment-2363531420)，指向 [Checkpoints_C.ckpt](https://drive.google.com/open?id=1qdcXb9CRJZgniNVaViiZaQXNiWxpiTnQ)。作者说明可按 PyTorch Lightning 参数格式加载，并提醒输入格式有严格要求。
2. [Colab 回复](https://github.com/Mr81wx/HoopTransformer/issues/1#issuecomment-2363714524)，指向 [加载示例 notebook](https://colab.research.google.com/drive/1YCGmMn5CBC0j8d5sj45Y53FcAvxvoJWE)。当时提问者确认链接可用。
3. 作者随后解释回合表示使用平均池化，并进一步给出沿前两个维度取均值的说明。但文字同时出现 `5*121`，而讨论的编码张量为 `[6,121,256]`；**球是否参与池化、有效帧是否排除 padding，仍不能仅凭这段回复确定**。[对应回复](https://github.com/Mr81wx/HoopTransformer/issues/1#issuecomment-2363914572)。

作者还提到扩展到防守球员的模型可交流获取，但没有在该回复给出下载文件。不能据此断言 Hoop-MSSL 正式模型已经公开。

### 本轮实际下载情况

- 权重匿名下载得到的是 Google 登录 HTML，不是 checkpoint；文件预览返回 401。本轮没有证明文件失效，也没有证明所有登录用户都无权读取，只能确认**当前未登录访问无法取得**。
- notebook 下载成功，16,838 字节，SHA-256 `8c940ea768dd4378c59fbde3adfa4ba09a21ee345b096d807fceaf57a31532b6`。按 JSON 读取源码，未执行 notebook。
- notebook 包含 9 个代码单元。可见 `create_batch_class`，过滤 `drag` / `wide_pindown`、合并两个 `21` 标签；但未给出完整十四类 `mapping_dict`，也未提供完整分类头。最后导入 `SceneTransformer` 却实例化 `Scene(...)`，依赖作者 Drive 中的模块与数据，不能直接一键运行。

**我们仍缺：** 可取得的匹配权重及配置、完整战术分类头 / 标签映射、与已发布向量库完全一致的池化规则。仅做检索也需要匹配编码器；现成向量不能直接编码新回合。

## 3. Hoop-MSSL：把轨迹理解扩展到配合动作与参与者

论文：2024 年 NeurIPS 自监督学习 **Workshop** 版本；2025 年 *Intelligent Sports and Health* 期刊版。[官方 Workshop 条目](https://neurips.cc/virtual/2024/104552)、[期刊 DOI](https://doi.org/10.1016/j.ish.2025.11.001)。不是 NeurIPS 主会论文。不同年份版本的作者名单与排序有变化。

### 功能与数据

它同时用轨迹重建、攻守角色识别、对比学习训练一个轨迹编码器。相比 HoopTransformer 的进攻六主体输入，这项研究把防守方也纳入。

| 环节 | 输入 | 输出 | 在本项目里的位置 |
| --- | --- | --- | --- |
| 预训练表示 | 十人 + 球的 x、y、速度，5 Hz、121 步，`[11,121,3]`，身份 / 队伍 / 朝向与 mask | 时空表示、球员表示、回合表示 | 可供多个篮球任务共用的编码层 |
| 回合分类 | 表示 + 已训练的回合分类头 | 十四类进攻战术，如 Elevator、Floppy、Horns | 自动战术候选 |
| 动作分类 | 对应动作片段的表示 + 动作头 | 挡拆、无球掩护、手递手等 | 配合事件的类别证据 |
| 球员角色分类 | 挡拆片段及角色头 | 持球人、掩护人、两人的防守者 | 把动作连接到具体球员，供圈人、箭头与讲解使用 |

预训练中的攻 / 守角色任务与下游挡拆四人角色任务不同；也不等于识别人名。动作分类不自动证明它能在任意长视频中输出准确事件起止，事件切分仍需配套处理。正文列三种主要动作而结果说明有四个标签，第四类完整定义仍未核实。

### 官方模型是否开源

本轮搜索论文全名、Hoop-MSSL / HoopMSSL、代码 / 权重 / availability；查询 GitHub 名称、描述和 README，并检查论文作者 / 相关账号的公开仓库目录。

- GitHub `"Hoop-MSSL" in:name,description,readme` 返回 **1 个仓库：`ytrqua3/Hoop-MSSL`**；`HoopMSSL` 返回 0。检索状态以采集日期为准，不等于证明所有其他名字下均不存在实现。
- [这个仓库](https://github.com/ytrqua3/Hoop-MSSL)描述明确说是按论文复现，加入自定义微调头；README 说明小部分数据实验、未完成全量训练。没有依据认定其是原作者交付。
- 检查该仓库 20 个可达历史提交 / 20 个树、公开分支、标签与 Releases，未发现常见扩展名权重文件，也未发现根 LICENSE。前轮运行输入 `[1,121,11,3]` 时，重建头因 `2122x64` 与 `256x3` 矩阵维度冲突失败。[实测证据](evidence/mssl-third-party.json)。
- Workshop 项目入口指向 OpenReview。直接读取论坛、PDF、API 时遭遇验证限制；此前已通过检索索引读取官方 PDF 相关方法 / 附录段落。期刊正文直接访问受限，不能声称完整检查了期刊全部补充材料。
- 合作者 [Pelechrinis 的学校主页](https://sites.pitt.edu/~kpele/)列出论文及 GitHub 入口；其当前 65 个公开仓库的名称 / 描述中没有确认到本论文发布包。此处只做目录级扩查，未宣称审查全部仓库源码。

**判定：方法明确、功能吻合，但尚未取得官方可运行模型。** 如希望实现“十人轨迹 → 配合类别 + 谁参与”，它值得保留为训练路线；现阶段不能作为省去训练与标注的现成组件。

## 4. HoopEval：给有球决策和移动方向估计价值

论文：*HoopEval: Individual Player Action Evaluation via Deep Reinforcement Learning*，MIT Sloan 2026。[官方论文及 PDF](https://www.sloansportsconference.com/research-papers/hoopeval-individual-player-action-evaluation-via-deep-reinforcement-learning)、[合作者 UCF 论文登记](https://www.cs.ucf.edu/diidlab/publications/hoopeval-individual-player-action-evaluation-via-deep-reinforcement-learning/)。

### 功能与数据

它问的是“当前状态下，这个传球、持球选择或移动方向的价值怎样”，而不是“这套战术叫什么”。原论文以离线强化学习和 qSQ 奖励建模动作价值。

- **原始数据：** 球与十人的场地坐标、稳定球员 ID、攻守顺序、篮筐、球权 / 传球状态、时间、回合与出手边界；训练另需与轨迹对齐的 qSQ / 奖励。
- **旧版权重真正接受的输入：** 十人 + 球 + 篮筐共 12 个节点，坐标先转为六边形格点 ID；`states=[12,80,1]`，六个动作主体的 `actions=[6,80]`，图边属性 `[1,80,132,1]`。球员和球的动作需依照训练版本编码，不能直接送任意画面像素。
- **旧版实际输出：** 球的 6 类动作 Q 值 `[80,1,6]`；五名进攻人的 19 类动作 Q 值 `[80,5,19]`；qSQ 头 `[1,5,80,1]`。双 Q 头还提供各自值、平均值和较小值。
- **项目位置：** 可信轨迹 / 已确认事件 → 动作编码 → 价值评价 → Agent 的候选解释与 2D 价值可视化。Q 是模型奖励定义下的预期回报，不能直接标作命中概率或必然增加的得分。

球动作六分类的每个序号、19 种移动的映射、格点坐标字典及新球员身份编码必须与训练前处理核对；本轮验证的是核心张量兼容，没有完成这条业务数据转换链。

### 新发现：旧提交中的 checkpoint 仍可读取

- 仓库：[Mr81wx/HoopEval](https://github.com/Mr81wx/HoopEval)。当前默认提交 `62cf695a9dfae0891ea3d5e091ccb73bf4d0e98b` 没有权重。
- 历史提交：[3a75cad8f024e457be1b76f90ea176cb59037104](https://github.com/Mr81wx/HoopEval/tree/3a75cad8f024e457be1b76f90ea176cb59037104)，日期 2025-11-03；其中有 [1030_soft_onlyball/version_13.ckpt](https://github.com/Mr81wx/HoopEval/blob/3a75cad8f024e457be1b76f90ea176cb59037104/1030_soft_onlyball/version_13.ckpt)。
- 该文件在 2025-11-19 的 `4007cdb06bd8fd8eef157eb77167a740dc15e1ec` 提交中删除；本轮仍可从固定旧提交匿名下载。
- 实际大小 **17,359,176 字节**；SHA-256 **`80b3a25b08cdc81ab5a68b09ab37baa73d8ea81f0a834d1967aa1fc81920cb90`**。
- `torch.load(..., weights_only=True)` 成功；记录包含 `epoch=24`、`global_step=6750`、Lightning 2.2.1、优化器与模型状态。属于带训练记录的 checkpoint，不是仅有随机网络定义。

### 本地验证与重要限制

使用同一提交的 `Model/QTransformer.py`、`utils.py` 与配置，抽取 `model.` 前缀：**132 项状态严格加载成功，无 missing / unexpected keys，1,087,427 个参数**。CPU 与 RTX 5070 Laptop GPU 都完成合成合法 token 前向，所有输出有限。[CPU 证据](evidence/hoopeval-historical-cpu.json)、[GPU 证据](evidence/hoopeval-historical-cuda.json)。两次使用各设备的随机输入，仅为兼容测试，不做 CPU / GPU 数值一致性结论，也不据首次前向计时作性能排名。

但它还不能成为我们的正式评价组件：

1. **不是已确认的论文最终模型。** 路径标为 `soft_onlyball`，时间早于 2026 论文；实际权重键匹配旧 `QTransformer.py` 的双 Q 头，而不是同一提交中带 `sqar_head` 的 soft 文件。目录名不够证明训练配方与论文一致。
2. **EMA 副本未初始化。** checkpoint 明确记录 `ema_model.initted=False`、`ema_model.step=0`。虽然该副本也能严格加载和前向，但不能把它当已更新的训练后 EMA 模型。后续实验应先核实并使用 `model.` 状态。
3. **旧版与当前源码不兼容。** 当前版本吃连续 `(x,y,vx,vy)`、边特征 2 维、球员动作头 36 维；旧权重用格点 ID、边特征 1 维、19 维球员头。不能把旧权重塞进当前 main 后靠 `strict=False` 假装解决差异。
4. **数值能出不代表球员价值正确。** 合成输入上旧模型球员 Q 接近 -3、球 Q 与 qSQ 头分布不同；这里没有真实战术标签 / 专家结论作对照，不能给出准确率或宣称无球贡献已复现。
5. **发布配套不完整。** 未发现根许可证和正式 Release，也未建立旧 checkpoint 与全部训练数据、动作字典、球员映射、qSQ 生成器的一致性证明。

作者的 [HoopEval_vis_2](https://github.com/Mr81wx/HoopEval_vis_2)使用预计算 JSON 展示 Q 值。前轮页面构建 / 播放已验证，但那不等于页面能在线给我们新视频运行这个 checkpoint。

## 5. 对我们项目的具体判断

| 用户目标 | 优先对应 | 当前缺口 | 可以先产出的组件 |
| --- | --- | --- | --- |
| 看 2D 跑位判断整套战术 | HoopTransformer；Hoop-MSSL 也评估此任务 | 匹配权重、完整分类头 / 标签和可信回合输入 | 独立回合数据适配与人工标注规范；拿到匹配权重后验证候选标签 / 检索 |
| 判断谁给谁掩护、是哪种配合 | Hoop-MSSL | 官方模型与任务头、事件切分、十人及球轨迹 | 动作 / 参与者数据契约与训练方案，不能承诺现成自动识别 |
| 比较一次传球或跑动是否有价值 | HoopEval | 历史版身份、前处理与奖励映射、许可、独立精度 | 固定历史版本的离线研究探针；验证后再设计价值面板 |

这些都是可靠 2D 轨迹之后的下游组件。当前工作台可提供准备快照，但素材数量不等于完整训练样本；需要稳定十人身份、球的场地坐标、攻向、时间和质量 mask。不要把缺失位置补成观察事实。

HoopPad 另有已运行的防守生成与 qSQ 权重，但它的目标是“给定进攻路线，生成另一种防守”，不能拿那些文件充当这三篇论文的正式权重。用户的战术识别目标优先于哪一个项目恰好更容易跑通。

## 6. 核查范围与复现

- 对三个核心仓库检查所有公开 branch / tag tip 可达历史：HoopTransformer **26 个提交 / 24 个树**，HoopEval **12 / 12**，第三方 MSSL **20 / 20**；检查全部公开 Issues / 评论及 Releases。三个仓库均只有一个公开分支，无 tag / Release；没有树截断。
- 扩查 5 个相关仓库的公开分支 / 标签当前树；清点 Mr81wx、Cesar-Shao、wxmr81、kpelechrinis 公开仓库目录。`EPVDemo` 是 `dcervone/EPVDemo` 的 fork，不能冒认为 HoopEval；其他名称相近的标注 / tHoops 项目也没有确认到三篇对应权重。
- 元数据扫描包括常见权重扩展名及大文件 / 权重相关文件名；结合 README、配置、加载代码、Issue 外链判断。没有访问私有仓库，也没有证明已经穷尽任意名称、任意格式的所有互联网文件。
- 五次 Exa 检索请求合计 30 条，实际返回 25 条 URL 记录，见[检索索引](evidence/release-search-index.json)；搜索只作线索，关键判断来自作者评论、GitHub 固定文件和本地加载。
- [审计脚本](audit_model_releases.py)、[元数据证据](evidence/model-release-audit.json)、[下载证据](evidence/release-downloads.json)、[扩查证据](evidence/release-discovery.json)、[历史源码哈希](evidence/historical-source-manifest.json)、[权重探针](probe_historical_hoopeval.py)、[运行步骤](REPRODUCE.md)。共享证据只保留需要的评论链接与公开资产 URL，不复制邮件地址、邮件线程或通知退订参数。

此前只查默认目录的 `public-assets.json` 与前轮 CPU / GPU 结果保留为历史证据；**本文件是模型发布状态的更新结论**。没有重新训练模型，没有对外询问作者，没有修改项目生产流程；研究文件当前仅本地，未提交 / 未推送。
