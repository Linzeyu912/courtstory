# 官方训练 001 / 002：十个单人 Agent 与轨迹去噪

2026-10-07，America/New_York。本轮按用户要求，固定此前的球员身份、检测框、球场标定和原始映射，只优化从已有材料到 2D 轨迹的过程。当前使用 Token Plan 新 Key、qwen3.8-max 和两路独立任务；结果及准确性结论按下文最新记录更新。

## 当前实测状态

07:33两片测试调用已结束，原8876观察台已加载最终导出；没有failed片段或本轮终态API错误。partial主要保留模型未解决的遮挡、身份或定位问题，不能称全片精度通过。

| 样片 | 独立球员 | 有观测时间片 ready / partial / failed | 锚点 | 原始有效球员×帧 | Qwen候选 / 最终有效球员×帧 |
|---|---:|---:|---:|---:|---:|
| 001 | 10 | 12 / 35 / 0 | 306 | 10514 | 9837 / 9837 |
| 002 | 10 | 10 / 37 / 0 | 340 | 10799 | 9842 / 9842 |

源身份、框、标定和原始x/y变化均为0；去噪不补缺失，也不删有效点。Qwen保留的未知相比原始减少677/957个有效点，须与遮挡和身份冲突一起检查。P2@611附近有效短段已重新看图恢复，632原始缺口保留；002 P9@1045恢复Qwen修正，1092保留原始projected，P10@1157因框对应32号而非目标00号保持null。

独立原片AI参考经鞋归属和双脚/单脚口径重审，保留原估计与纠错依据。最新同帧配对结果如下；参考并非人工真值，不足以证明准确性提高。

| 样片 | 可见参考 / 同帧配对 | 参考不确定度中位 / p90 | 原始像素误差中位 / p90 | 去噪前像素误差中位 / p90 | 最终像素误差中位 / p90 |
|---|---:|---:|---:|---:|---:|
| 001 | 11 / 11 | 15 / 18px | 16.03 / 25.14px | 19.21 / 29.03px | 19.21 / 29.03px |
| 002 | 8 / 8 | 19 / 22px | 21.27 / 39.77px | 18.43 / 39.77px | 18.43 / 42.90px |

002 P5@900原片895/900/905定向复核发现旧参照367,557没有取双脚接地中点，已依据源图更正为约390,566、保留旧估计与纠错记录。误差由旧参考下约64/67px变为原始和去噪前39.77px、最终42.88px，仍超过22px参考不确定度。raw是框底中点421.36,590.45；此帧候选仍projected而非Qwen修正、没有锚点，列为明确待核样例。不能只靠加大滤波解决。最终配对报告位于本机忽略目录 `denoise-qa/001-final-after-p2-merge.json` 与 `002-final-independent-reference-p5-900-corrected.json`，均核对当前merged sourceDigest。原观察台实际全员、单人、三层、半场/全场、源帧/PTS同步和缺口显示已检查，后台页验证所用临时focus emulation已解除并保持暂停。

最新002补测审计实际峰值在途2；12个新任务有155次HTTP200与82次无HTTP响应的连接失败尝试，没有明确429或额度耗尽。5个任务发生应用层reconnecting，5次均记录恢复，完成候选；SDK内部重试另计。连接仍不完全稳定，不能把终态零失败解释为没有网络错误。

历史专属接入域名轮：001 ready 10 / partial 26 / failed 11，240锚点；002 ready 4 / partial 24 / failed 19，188锚点。以下旧计数仅用于记录网络补测起点。partial包括模型主动保留未解决问题，ready也只表示候选流程结束。每片均有十个独立所有者与完整时间轴，未知和原缺测保留缺口。

历史轮原始/候选有效坐标数：001为10514/10059，002为10799/10111。删去的点也须检查，不能只比较剩余点误差。当前显式去噪导出到 `artifacts/qwen-parallel-20261007/replay/` 并由原8876观察台播放（窗口0.08秒、常规位移上限0.25m、转向阈值0.6、少于7点短段保护）；去噪前后有效点数相同。默认仅显示最终层，可切原始与去噪前对照。

用户修改DIRECT规则后，本机Mihomo状态API已实测目标连接链为DIRECT。通过本机HTTP服务出网比当前Node默认fetch稳定，但仍会出现 `UND_ERR_SOCKET`、`ECONNRESET` 与约10.6秒的 `UND_ERR_CONNECT_TIMEOUT`，无对应HTTP响应。实际P9/P10任务已经发生并成功恢复应用层reconnecting；暂未收到明确429、鉴权失败或套餐额度耗尽。

## 实现和复跑

后续先按用户要求串行，再按最新要求恢复2路并行；每路始终只有一名球员的独立上下文。`run.py --workers 2` 为当前测试默认，`--workers 1`仍可串行。后台回放不自动触发测试。

2026-10-07 05:38（America/New_York）已切换当前交互测试到 Token Plan：官方北京地址 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，读取本机 `QWEN_TOKEN_PLAN_KEY`，仍指定 `qwen3.8-max`；不自动回退到按量 Key。新 Key 的文本、图像、Function Calling、工具图片续读均HTTP200，随后002 P1两段完成并保存，628/650的原有效短段不再误删，654原缺标定仍为空。001 P2也已保存候选；其他球员逐人接续，不能将当前快照当成全片准确性验收。

```bash
python research/agents/qwen-parallel-20261007/run.py 002 --token-plan --workers 1 --players P1
```

当前两路受控测试可增加 `--workers 2 --local-http-proxy http://127.0.0.1:7897`。该参数只为测试子进程启用Node内置环境代理，通过本机HTTP服务按用户已核实的DIRECT规则出网，不改系统代理/DNS，也不表示经海外节点；[Node环境代理文档](https://nodejs.org/api/cli.html#node_use_env_proxy1)。本机状态API已看到两个HTTPS连接均DIRECT。新进程四项模型探针通过，但仍须依据真实POST审计判断连接质量。

网络错误经过SDK有限重试后，worker会保留同一个Agent对话、锚点、版本、已读帧/图像和最近候选，进入 `reconnecting` 并短退避续接，最多两次应用层重连；不重开一份空任务。鉴权/欠费/明确Credits耗尽不重连，临时限流可退避。重连仍服从原请求/帧/工具/时限和取消条件；等待/恢复事件与checkpointRevision持久化。若最终仍失败，只保存当前片段及证据，其他人继续；已完成片段不重跑。

官方[Token Plan个人版](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview)支持qwen3.8-max视觉能力，并限定编程/智能体工具内交互式使用，限制自动化脚本、定制应用后端及非交互式批量调用。[端点说明](https://help.aliyun.com/zh/model-studio/base-url)要求套餐Key与套餐URL配套。以上入口仅用于人在Codex交互中发起并检查单人Agent实验，不是将套餐当作常驻后端计费替代；原观察台已清除旧Key并仅播放结果。未来部署、无人值守任务和通用后台须使用适用的按量方案。实际Credits以订阅控制台为准，API探针不等于已读取订阅账单。

`engineering/scripts/ground_trajectory_parallel.py` 为十名球员各分配一个独立上下文、工具状态和输出目录。同一人的时间片顺序处理，不跨切镜；每片约300源帧，每个时间片独立取证。所有人读取同一份冻结材料，模型任务只能写所负责的P，主协调器最后汇总。共享图片缓存只缩短解码，模型上下文仍独立。十个逻辑任务与API同时在途数分开：当前002实测最多两个在途请求、请求开始至少间隔两秒；001定向复核占用单独一路，总数不超过用户授权的三路。

```bash
python research/agents/qwen-parallel-20261007/run.py 001 --base-url https://YOUR_WORKSPACE.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
python research/agents/qwen-parallel-20261007/run.py 002 --base-url https://YOUR_WORKSPACE.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
python research/agents/qwen-parallel-20261007/export_replay.py --profile conservative
```

Key 仅从当前环境或被忽略的 `.env` 读取。`--prepare-only` 不调用模型；`--players P1 P2` 可仅补测指定人物。冻结阶段重新建立当前准备契约，并检查每个原始 x/y 均未改变。已有 ready/partial 候选保留，failed 时间片重试并保留失败文件；本轮汇总前不覆盖原观察台旧结果。

本地结果在被忽略的 `artifacts/qwen-parallel-20261007/`：`single-player-v1/official-training-00{1,2}/` 保存冻结输入、每人每段结果、合并结果和调用审计；`replay/` 保存轻量回放，`denoise-qa/` 保存参数对照。回放沿用原 `/trajectory-replay`，支持全员叠加或仅一人，以及原始、Qwen 去噪前、最终三层对照。

## 已共享的当前回放

用户授权推送后，本专题 `replay/` 保存上述最终001/002的轻量schema3回放：源PTS、逐人框、原始/候选/去噪坐标、反投影矩阵、缺口和复核状态；不含视频、图片、Key、模型对话或请求日志。该快照仅用于展示和复核，不覆盖球员/标定草稿，也不证明候选准确。原视频沿用已授权的Git LFS素材。

拉取后使用既有依赖和视频启动原观察台，无需Qwen Key或模型调用：

```powershell
.venv/Scripts/python.exe engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --trajectory-replay-root research/agents/qwen-parallel-20261007/replay --port 8876
```

打开 `/trajectory-replay?sample=official-training-001` 或 `official-training-002`。已有8876实例需使用相同replay-root后重启或沿用本机已经配置的新结果实例；不要同时启动同端口。完整模型复跑仍需要本机冻结材料和合法适用的凭据，不能将轻量回放当作完整Agent断点快照。

## 去噪与准确性检查

算法见[工程说明](../../../engineering/docs/ground-trajectory-denoise.md)。按真实时间做稳健局部拟合，保留缺测、切镜和锁点；宏观方向变化缩短窗口。先比较 conservative / balanced / strong，不以路径更短、二阶差分更小推断更准确。

`visual_reference.json` 保存独立 AI 看原视频得到的参照，并在身份/接触口径复核后保留原估计与更正依据。当前数量以该JSON为准：重叠鞋误认和双脚中点口径问题已被发现，不能使用旧错误参照评价模型。参照并非人工真值，像素不确定性至少10px；不清楚的条目排除位置误差统计。`evaluate_reference.py` 将轨迹反投影到同一源帧，分别报告可用点、缺失点、配对误差和明显大偏差；避免删掉难点后平均误差变小的假象。

```bash
python research/agents/qwen-parallel-20261007/evaluate_reference.py --replay official-training-001=artifacts/qwen-parallel-20261007/replay/official-training-001.json --replay official-training-002=artifacts/qwen-parallel-20261007/replay/official-training-002.json
```

仍需核查真转向、停止、起跳/落地和时间片连接处；不存在可用于证明全轨迹米制准确度的人工真值。本轮不修正前置身份、框或标定，因此其原有误差也保留。

## 阿里云接入诊断

官方资料采集于 2026-10-07：

- [地域与专属接入域名](https://help.aliyun.com/zh/model-studio/regions)：业务空间 API Host 可从业务空间管理读取，用相同地域 Key 将兼容 URL 的 hostname 替换，路径保留 `/compatible-mode/v1`。专属域名提供更高并发容量；不据此保证轨迹任务无超时。
- [模型限流](https://help.aliyun.com/zh/model-studio/rate-limit)、[限额管理](https://help.aliyun.com/zh/model-studio/quota-management)：账户同模型限额跨 Key、RAM 用户和空间共享。北京 qwen3.8-max 使用动态限额；实际值以当前控制台“模型限额”为准，提高账户限额需联系商务经理。另查业务空间是否设置较低自定义限额。
- [限流最佳实践](https://help.aliyun.com/zh/model-studio/rate-limiting-best-practices)：请求速率、Token 速率和突发均可能受限。可选 `X-DashScope-Wait-Timeout: 30` 只缓解突发排队，不突破账户 RPM/TPM；请求超时180秒，早期最多重试一次，当前串行阶段改为最多3次SDK退避重试。即使任务有partial候选，额度错误也须报告并停止后续新模型请求。
- [错误码](https://help.aliyun.com/zh/model-studio/error-code/)：需要根据真实响应区分限流和连接/超时。本轮旧域名出现连接错误及超时，尚未观察到明确额度不足或 429，不能确认原因是账户限额。

用户提供的北京业务空间专属域名已用现有 Key 通过文本、图像、Function Calling、工具图片续读四项探针；完整十人任务仍有连接失败。真实账号的 API Host 和 Key 不写入共享文档。

复核指定运行或当前最新 001/002 manifest 中登记的新任务网络日志，可运行 `python research/agents/qwen-parallel-20261007/network_audit.py [run.json]`。脚本优先按 `requestedPlayerIds` 选本轮任务；旧 manifest 没有该字段时，仅纳入 `job.createdAt >= manifest.createdAt` 的任务，并列出排除数，避免把未选球员或旧缓存统计进来。汇总 JSON 写入被忽略的本地 `artifacts/`；成功请求的 `elapsedMs` 是收到响应头的时间，连接失败耗时单列为失败尝试总时间。
