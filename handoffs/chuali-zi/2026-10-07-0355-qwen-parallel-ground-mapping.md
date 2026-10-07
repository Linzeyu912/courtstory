# 交接：十个单人 Qwen Agent、2D 映射去噪与接入诊断

- 日期 / 时区：2026-10-07 03:55，America/New_York
- 成员：chuali-zi
- 任务 / Issue：用户要求官方 001 / 002 每名球员独立 Agent，并在原观察台叠加；去噪必须核对真实原片。开始时远端未有匹配的开放 Issue。
- 分支：main
- 提交：本轮未提交／未推送，保留其他任务修改
- 状态：进行中，两片本轮调用已结束并保存 partial；用户正在改TUN代理DIRECT，直连补测与准确性验收待接续

## 本次完成

- 工程协调器 `engineering/scripts/ground_trajectory_parallel.py`、共享解码缓存、现有后台多 job 与 FIFO 请求许可。十个单人上下文只写自己 P 的独立文件，最后由协调器合并，冻结源摘要和所有原始坐标保持。
- `engineering/scripts/ground_trajectory_denoise.py`，按真实时间局部稳健拟合，不填 null、不跨切镜和绑定切换、不移动人工锁点；去噪参数反复抽查中。
- 原 `/trajectory-replay` 支持全员/一人、原始/Qwen去噪前/最终三层，沿用原布局。
- `research/agents/qwen-parallel-20261007/` 复跑、导出和独立参照诊断。49 个 AI 视频参考含27个可见接地点和22个不确定情况，非人工真值。
- 用户提供的北京业务空间专属 API Host 已用现有 Key 通过文本、图像、Function Calling、工具图片续读；账号信息仅留本地实验，不写共享文档。

## 结论与依据

- 旧域名十个同时在途请求出现大量连接错误/超时，四在途重试有所产出但仍 partial；专属端点完整两片也出现错误，不宣称已解决。
- 已记录底层 `UND_ERR_SOCKET`、约10.6秒的 `UND_ERR_CONNECT_TIMEOUT`，发生在 HTTP 响应之前；一个失败请求体约2.28MB。尚无明确429或额度不足。只读DNS/TLS检查中IPv4和IPv6都曾成功，不能认定固定IPv6故障。
- [阿里云接入域名](https://help.aliyun.com/zh/model-studio/regions)、[模型限额](https://help.aliyun.com/zh/model-studio/quota-management)、[限流最佳实践](https://help.aliyun.com/zh/model-studio/rate-limiting-best-practices)（2026-10-07）：主账号同模型共享限额，业务空间专属域名不绕过TPM；突发等待头只用于突发排队，提高动态限额须按控制台当前值及商务渠道处理。
- 001 的绑定切换曾造成约14.7m/帧的原始跳变；固定前置输入的本轮只加 downstream breakBefore，不修改原绑定或把该跳变滤成真实移动。
- 去噪一处困难转向参考恶化，已推动更保守窗口及边界处理复核；小样本像素误差差异多低于10px AI参考不确定性，不能声称准确度改善。

## 验证

- 最新定向 Python 20 项通过：请求许可、并发、恢复、脱敏、十人所有权、边界、去噪与7点短段保护；Node 原工具7项与回放8项通过。各新增脚本编译/语法检查通过。
- 两片冻结原始坐标变化均为0。本轮两片已保存：001 ready10/partial26/failed11，002 ready4/partial24/failed19，每片47个有观测时间片；240/188个锚点。全片质量与最终浏览器验收尚未完成。
- 保守候选已导出 `artifacts/qwen-parallel-20261007/profiles/conservative-guarded/`，参数窗口0.08秒/上限0.25m/转向阈值0.6。原始/候选可用点分别10514/10059、10799/10111；去噪不再删除或填补点。
- 实验产物均在被忽略的 `artifacts/qwen-parallel-20261007/`，参见研究README复跑命令。

## 阻塞与待确认

- 网络存在间歇连接失败；不能要求用户靠充值或新建Key解决尚未证实的限流。
- 原身份/框/标定未有人工真值，且明确有绑定切换跳变。视觉参考不足以验收全部轨迹米制准确度。

## 下一步

- 用户确认DIRECT规则生效后，用新worker连接验证专属端点，再补失败片段并核对真实错误；以最终结果复跑三档去噪、配对像素参照与转向/缺口检查。
- 将选定结果导入原观察台，实际核查逐帧/慢放、单人/全员、三层与断点，更新此记录和结果文档。

## 同步状态

- 开始时本机 HEAD、origin/main、实际远端为 `0d29df0f1adc1e64659d48b49b4e6c9dd880ffbd`。本轮无提交／推送，也未创建分支、PR或云资源。
