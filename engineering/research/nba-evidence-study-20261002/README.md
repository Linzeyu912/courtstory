# NBA 解释与纠错层：本机实验阶段交接

研究基线为 `1839dcde5b5cc0aa362baa474e58e5b530e6c695`。本机只读研究于 2026-10-02 开始，本次按用户收尾指令归档至此目录。独立 main 工作副本用于选择性发布；原项目已有未提交工作完整保留。未修改检测器、工作台生产代码或总结生成模块。

本轮确实完成输入审计、数轮离线实验、少量真实画面双AI复核和已有稀疏参考复用，没有制作总结生成模块或重写 ByteTrack。所有推理模型输出均沿用本机已有快照；未调用付费外部视频模型、采购资源或读写凭证。实验代理显式指定 Astra / ultra；工具未暴露 service tier 设置，不能据此声称已改变该设置。

## 对核心问题的当前结论

已有坐标与球员ID应先整理成**有来源、作用时间和使用条件的证据与候选层**。坐标存在、T编号连续、姓名资料确认是三件不同的事。下游可以查询“某时间窗有哪些观测、哪些关系有支持、什么仍未知”，不能直接把每一行坐标解释成确定球员事实。

| 层 | 必要内容 | 当前输入能支持什么 |
|---|---|---|
| 原始来源 | 视频/结果SHA、JSON Pointer、模型/实现版本、原始字段 | 重放某条输出；保留raw而非覆盖 |
| 观测 | class、原始框/点、未校准score、source channel是否提供、缺失原因是否已知 | 图像中模型报告的候选；缺失不等于对象不存在 |
| 轨道 | clip+variant+T命名空间、观测列表、缺口/切镜、冲突证据 | 临时关联；不能自动认定同一真人 |
| 人工身份 | P槽、NBA身份、显式确认范围、审阅来源与修订 | 只在被验证区间支持姓名；2K名单匹配不验证轨道 |
| 几何/时间 | 像素/球场坐标分开，脚地接触、camera状态、标定版本、源PTS/经过时间/available_at | 投影或运动候选；未知接地和未验证H不产生真实米制速度 |
| 关系/事件候选 | 支持与反证、备选解释、依赖版本、决策、可用时间 | 图像邻近等低层关系；目前不能自动升级持球/传球/投篮 |

自动处理目前适合做来源、类别映射、时间轴与依赖一致性校验，生成可撤销的规范化视图，以及在修订后使相关派生失效。轨迹补线、ID接续、球框选择与标定采用应保留为建议/复核。存在观测等价或证据不足时弃权，但仍保留匿名原始候选；不能把一个全局“可靠”布尔值用于所有能力。

## 实际输入与主要发现

1. **四视频1,082帧、17版通过源哈希与时间核对，只有13份不同轨迹JSON。** 四组team-stable/optimized字节相同。默认四版共有9,937条track观测；这不是9,937条正确身份事实。004首帧PTS约0.040989秒，LAL为0.120秒，不能默认time从零起。见 [baseline](baseline/研究记录.md)。
2. **来源字段本身也需要审计。** 18段旧恢复结果的净增61是62新增（5 Qwen+57插值）减1旧插值；5个Qwen点均带observed=true。54,124个detector点中53,837个bbox已经不同于raw_bbox；另有26,909个点的角色参考帧位于未来。应读取raw_bbox作为检测几何，display bbox另列，Qwen仍归推断。详见 [恢复来源结果](recovery-provenance/audit.json) 与 [适配示例](recovery-provenance/adapter-examples.json)。
3. **检测高分不能验证身份。** LAL T21后段分数0.930但队色冲突；T12为0.872也冲突。21条已有稀疏actor参考可复现旧T25串人，却漏掉新版T12/T21残留。见 [身份诊断](identity/研究记录.md)。
4. **告警入口不等于修复整段。** 24次真实输入受控注入中，局部review都触发；五帧ID交换却每段只覆盖2/10错误身份槽。永久拒判覆盖合成错段，但四真实片策略放行量跌至32.0%/36.2%/10.3%/23.2%。分开位置、身份、时间和米制权限能保留有用信息。见 [故障三轮实验](faults/研究记录.md)。
5. **平滑与插值可能制造看似合理的错误。** 同样可见端点下，三帧缺口可是真直线，也可是隐藏转弯；后者线性补点RMSE20.41px。全轨平滑改动9,475个已有坐标、删除109个、补83个；这是信息扰动量，真实精度变化未知。
6. **球的时序支持可能沿着人体误检持续。** 三段ebard有359个球框、340/815帧覆盖、19帧多候选；其他版本常不提供对象通道。4个主动挑选压力例中，因果建议与双AI判断一致3个并弃权1个，双侧一致只接受1个；没有独立准确率结论。004 f104球心在T7框内却是飞行中的二维重叠，不能称T7持球。见 [球候选实验](objects/研究记录.md)。
7. **短窗速度尤其脆弱，镜像无法靠速度发现。** 实际候选同端点队列的3px扰动敏感性中位数，005在1/5/15帧窗口为4.617/0.855/0.267候选m/s，006为4.464/0.817/0.261；更长窗口也排除更多缺口。镜像保持两人距离、速度与一致变换后的重投影，却反转固定篮侧语义。全部是敏感性而非真实米制误差。见 [标定实验](calibration/研究记录.md)。

## 可检查的交付

- [证据契约研究](evidence/contract/研究记录.md)、[Schema](evidence/contract/contract.schema.json)、[真实来源样例](evidence/contract/source_grounded_examples.json)、[修订历史](evidence/contract/revision_history_example.json)：8条真实观测、4类候选；raw不覆盖、依赖修订后过期。22/22反例按预期阻断，其中20例格式合法但语义不成立。
- [故障实验JSON](faults/fault_results.json)、[分能力消融](faults/capability_results.json)、[验证](faults/validation.json)：14个解析场景、24次真实输入注入、6个分项门控场景。
- 本机原始画面索引 `visual/review_input.json`、多球压力图与球穿过人物框的序列（原始视频画面未随此研究包上传；可用脚本和已入库验收视频重建）。
- [7项空白人工复核任务](human-review-queue.json)：明确未完成，不是标注。新生成的球压力例标签为 [临时AI标签](objects/visual_labels.provisional.json)，需要真实人类仲裁。
- [一手文献与实现](literature.md)：8组实际访问的一手来源及可证伪假设。

各子目录研究记录含完整复现命令。根目录补充脚本按以下方式运行，无需下载依赖：

```powershell
$python = (Resolve-Path '.venv/Scripts/python.exe').Path
$repo = (Get-Location).Path
Set-Location engineering/research/nba-evidence-study-20261002
& $python -X utf8 object_probe.py --repo $repo --out objects
& $python -X utf8 ball_selection_probe.py --repo $repo --out objects
& $python -X utf8 evaluate_ball_challenges.py
& $python -X utf8 sparse_identity_probe.py --repo $repo --out identity
& $python -X utf8 -m unittest test_object_probes.py -v
```

## 验证范围与继续研究的边界

已有6项baseline口径测试、8项标定测试、5项对象测试；故障主实验10项核验及分项消融5项核验；契约22项反例。子代理独立复核修正了版本号续命、数值伪造、类别错映射、未来证据等待以及指标分母等问题。它们验证程序与口径，不证明视频事实正确。

真正的独立人类密集身份、球框/球权、脚地接触、球场米制标签仍缺失。旧56个目视参考明确由Agent绘制且来自18段批次排除的三段，不能用于证明61个净增点正确。真实误报率、漏报率、误修率和事实准确率在无法识别时保持null；合成真值指标单独报告。

本研究阶段按用户收尾指令暂停。恢复时应优先利用空白队列取得独立标签，或测试更多来源语义/依赖失效反例；不重复无标签参数扫描、不扩大付费视频调用、不把候选直接接成确定解说。


## 最后一轮：来源适配与事实放行

最小适配器 [adapter/normalize.py](adapter/normalize.py) 从真实源读取10条样例，保留原payload、raw_bbox/render_bbox、T命名空间、来源种类、未知版本/半场/相机、名义帧率与容器PTS之别，以及分组件依赖下界。14/14字段故障反例通过；路径越界、调用方伪verified、重复variant和旧contract篡改时轴/间接来源也有检查。详见 [Schema](adapter/observation.schema.json)、[样例](adapter/real-examples.json) 和 [适配说明](adapter/README.md)。Schema通过只证明格式，source校验通过只证明忠实解释已记录输出。

[事实门控](fact-gate/README.md) 比较三个规则，返回 certain / qualified / silent，不生成解说、不改原值。30条合成候选含24条世界事实和6条来源报告，解析场景真值对门控隐藏。

| 合成世界事实口径 | 仅分数 | 仅来源完整 | 能力和依赖 |
|---|---:|---:|---:|
| 11个假值候选获任意放行，qualified也算 | 11/11 | 11/11 | 5/11 |
| 其中以certain放行 | 10/11 | 10/11 | 5/11 |
| 11个真值且模拟时序可用候选保留 | 10/11 | 11/11 | 8/11 |
| 2个模拟尚未可用候选泄漏 | 2/2 | 2/2 | 0/2 |

能力门控仍错误放行伪verified身份、相机、尺度、镜像和跨源时钟。7对完整可见输入逐字相同、世界真值相反：单凭这些输入无法保证正确。表中比例是主动构造反例的表现，不能估计比赛视频总体误报率；将qualified假值计入错误，避免借措辞掩盖事实错误。

真实源桥接含14个语义挑战（10条规范化样例）和8个双AI球框诊断候选。T25四个已有稀疏参考中，仅分数/来源均放行2个矛盾；能力门控均拒绝，但也拒绝2个一致参考，证明降低误放行有信息损失。稀疏人工自述和AI标签都未独立重验，不计入合成准确率。

误修比较保留失败条件：单个几何尖峰可正确修复1/1；隐藏曲线插值3/3错误，正常相机平移朴素修复12/12错误，换镜复用ID的插值6/6错误。门控没有执行数值修订，自动修复分母为0，误修率为null；不能报告为0%。实际处理延迟、真实米制误差和真实完整准确率同样未知。

## 跨机器复现与恢复点

在仓库根目录设置 `$repo=(Get-Location).Path`、`$python=(Resolve-Path '.venv/Scripts/python.exe').Path`，再进入本研究目录。需要现有Python环境中的 numpy/scipy/PyAV/OpenCV/jsonschema/matplotlib；原JS投影复现另需Node。无需模型下载或付费调用。

```powershell
& $python -B -X utf8 fact-gate/fact_gate_experiment.py
& $python -B -X utf8 -m unittest discover -s baseline -p 'test_*.py'
& $python -B -X utf8 -m unittest discover -s calibration -p 'test_*.py'
& $python -B -X utf8 -m unittest test_object_probes.py
& $python -B -X utf8 evidence/contract/contract_probe.py --repo $repo
& $python -B -X utf8 adapter/normalize.py --repo $repo
& $python -B -X utf8 fact-gate/adapter_gate_bridge.py --repo $repo
```

合成门控和单元检查可以独立运行；契约、baseline、投影需对应验收结果及视频。adapter/恢复审计还需要原本被忽略的 `artifacts/player-recovery/` 与既有 `engineering/experiments/player_recovery/annotations.json`，这些输入不在本次上传范围，缺少时应明确报缺失，不自动下载或补造真值。旧契约大量反例压缩为 `evidence/contract/counterexamples.json.gz`，运行契约脚本可重建未压缩JSON。

研究脚本、轻量结果和图表已经归档；原始截图、模型权重、原视频缓存和重复复跑结果保留本机。发布整理只替换绝对本机路径为 `{repo}` / `{study}`；输入来源SHA不变。结果内原脚本SHA对应原研究脚本，发布脚本另见 `artifact-manifest.json`，两者不可混用。

恢复顺序：先完成7项独立人类复核；再检查verified证据如何绑定审阅者、原始来源、有效区间和修订；最后评估新标签上的误放行/漏报/误修及实际可用时刻。此前继续扩大无真值扫描不会产生可信准确率。当前研究阶段结束，未把实验门控宣称为生产可用解说器。
