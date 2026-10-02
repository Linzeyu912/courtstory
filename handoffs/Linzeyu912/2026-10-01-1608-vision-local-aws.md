# 交接：视觉系统本机实测与 AWS 部署评估

- 日期 / 时区：2026-10-01 16:08，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：本会话用户要求评估 YOLO、跟踪器及其他视觉系统的训练需求、本地与 AWS 部署可行性；补充最多等待 10 分钟，暂按本机配置。开工及收尾查询 GitHub open Issues 均为空，没有可关联的已认领 Issue。
- 分支：main。
- 提交：本轮未提交；当前 HEAD 与核对的 origin/main 均为 `3c69767018bd8e29ae6fb6e6247165b85affadc8`。
- 状态：本轮调研与局部基线测量已完成；完整产品与云部署待开展。

## 本次完成

- 新增 [部署评估](../../engineering/research/vision-local-aws-deployment.md)：硬件、真实耗时、训练要求、替代系统、Agent 调用方式、AWS 官方资源与赛事信息边界、升级条件。
- 新增 [基线测量脚本](../../engineering/scripts/benchmark_vision_baseline.py)，以已有视频和本地权重运行人物检测跟踪，输出结构化测量记录。
- 新增 [测量目录](../../engineering/research/vision-deployment-benchmark/README.md)：10 份原始 JSON、1 份汇总 JSON 和说明。仅一个样片；重复测量不代表多场景覆盖。
- 更新 [方案总结](../../engineering/docs/agent-concept-review.md)、[团队状态](../../docs/status.md)、[调研索引](../../engineering/research/README.md)，并为[首轮研究](../../engineering/research/video-overlay-vision-assessment.md)补充后续实测链接。
- 本地创建被忽略的 `tmp/vision-deploy-bench-venv/`，复用系统 CUDA PyTorch；安装固定版本 Ultralytics 和 lap。官方权重、设置及缓存位于 `tmp/`，诊断图位于 `artifacts/vision-deployment-benchmark/`，均未入库。

## 结论与依据

- 本机是 Ryzen 9 9955HX、约 32 GB 内存、RTX 5070 Laptop 约 8 GB 显存，CUDA 实际运算通过。
- 8.1081 秒 / 243 帧片段，YOLOv8s + ByteTrack / 640 耗时中位数 2.66 秒；同检测器 + BoT-SORT 无 ReID 为 6.53 秒。高分辨率 1280 的 ByteTrack 单次为 3.74 秒。只包含已预热的人物检测、跟踪、解码与诊断图，不含成片流程。
- 可先用预训练模型，不需从零训练。抽查仍有漏检和非球员人物混入；先验证球场筛选、身份与脚下锚点，再判断微调和硬件升级需求。
- 官方文档采集日期均为 2026-10-01：[YOLOv8](https://docs.ultralytics.com/models/yolov8/)、[跟踪器](https://docs.ultralytics.com/modes/track/)、[ECS GPU](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-gpu.html)、[G5](https://aws.amazon.com/ec2/instance-types/g5/)、[G6](https://aws.amazon.com/ec2/instance-types/g6/)。完整来源见评估文末。
- 重新读取[赛事官网](https://builderx.csdn.net/bcast-code?from=yaofoundation#eligibility)及[培训纪要](https://csdn.feishu.cn/docx/FS05dToF1oUmTGxaEjdckPD1nwe)。纪要提到 EC2、容器与消费上限，没有具体 GPU 型号 / 配额 / 预算金额；这是纪要转写信息，不等于正式实例分配。
- 建议以 YOLOv8s + ByteTrack 继续做贴图原型，以 YOLOX-S + ByteTrack 作为替代对照。选型、接口和升级条件是本轮建议，未记为团队决策。

## 验证

- CUDA GPU 矩阵运算通过，10 次视频运行均正常结束并处理全部 243 帧。
- 人工查看 n/640、s/640、s/1280 三张诊断图；尚未量化准确率或 ID 切换。
- `python -m py_compile scripts/benchmark_vision_baseline.py` 通过。
- 核验原始 JSON 的帧数、输入哈希、FP16、配置与汇总中位数 / 范围；相对文件链接和 Markdown 引用检查通过；`git diff --check` 通过。
- 未新增或修改视频资产；本轮没有视频入库或 Git LFS 提交。
- Docker 服务本次不可连接，Linux 容器及 AWS 均未测试。未训练模型，未运行球检测、球场映射、分割、姿态、RelateAnything 或完整成片。

## 阻塞与待确认

- 输入视频最长时长、并发及 10 分钟目标的起止点尚未约定；不能将短片段子阶段耗时推成所有任务的保证。
- 赛事账号的 GPU 权限、指定区域资源、配额、消费额度和 Agent 服务名称待正式来源或账号确认。
- 替代模型尚未实测；许可需按最终选用的代码、权重及依赖逐项核对。

## 下一步

1. 选取已有素材中的多机位、遮挡、快速平移和较长片段，补标球员、轨迹与脚下点，建立质量对照。
2. 实现球场区域筛选、脚下锚点和平滑、镜头切换处理，输出原视频叠加样片并计时。
3. 以相同视频、分辨率及计时边界比较替代检测器；用 ID 连续性决定是否启用 BoT-SORT / ReID。
4. 取得赛事资源信息后验证 Linux GPU 容器与 AWS，再测从任务提交到成片可用的全流程耗时。

## 同步状态

- 开工基线为 `ef476de`；期间另一会话已提交和推送旧研究，当前基线推进到 `3c69767`。本轮没有回退或覆盖其工作。
- 本轮文件仍为本地未提交修改，未推送；本会话尚未收到当前研究的提交同步指令。
- 保留原有无关目录 `research/nba2k-rating-tables/`，未读取、修改或提交其中素材。
