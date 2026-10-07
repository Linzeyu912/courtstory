# 交接：Token Plan 新Key与串行单人映射接续

- 日期 / 时区：2026-10-07 05:38，America/New_York
- 成员：chuali-zi
- 任务 / Issue：用户要求将正在进行的001/002单人映射测试切到Token Plan，读取 `QWEN_TOKEN_PLAN_KEY`，继续用 `qwen3.8-max`；前置标定、身份、检测框及原观察台布局保持。
- 分支：main
- 提交：本地未提交／未推送
- 状态：进行中，新Key已验证并完成若干实际单人任务，剩余任务和最终准确性检查待接续

## 本次完成

- 官方Token Plan北京兼容地址 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` 已通过新Key文本、图像、Function Calling、工具返回图片续读，四项均HTTP200。密钥只读本机环境或被忽略的 `.env`，不写JSON、日志和共享文件。
- `research/agents/qwen-parallel-20261007/run.py --token-plan --workers 1 --players P1` 显式使用套餐Key和套餐域名，无旧按量Key回退；模型固定qwen3.8-max。
- 旧002串行按量进程树已限定范围停止，run标为interrupted；已完成文件、私有候选及证据保留。协调器恢复时优先取同一原材料上的最新已完成单人快照，避免只恢复旧总合并而漏掉中断前完成的人。
- 新Key002 P1的600–900、900–1200完成并保存。628/650原有效短段恢复模型坐标，654原缺标定保持null；随后001 P2/P7与002 P3也已保存候选。这是实际视觉循环，不是只做API探针。
- 原观察台仍为8876同一页面和布局，加载 `artifacts/qwen-parallel-20261007/replay/`，仅播放结果。其服务进程已清除旧Qwen凭据，状态接口configured=false；Token Plan Key未写入常驻服务。

## 结论与依据

- 官方来源采集2026-10-07：[Token Plan个人版](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview)、[Base URL](https://help.aliyun.com/zh/model-studio/base-url)。支持qwen3.8-max视觉能力；套餐Key与套餐端点配套。官方限定AI编程/智能体工具内交互式使用，限制自动化脚本、自定义应用后端和非交互式批量调用。因此本次入口限定为人在Codex当前交互中逐人发起、检查的Agent实验，不能将其作为未来无人值守服务的通用计费方案。API通过不表示已读取订阅Credits账单。
- 此前Mihomo运行配置只读核对：rule模式、TUN开启、专属域名DIRECT规则在index0启用且127次命中，当前目标连接链DIRECT。直连规则确已生效，但旧端点仍有socket/连接超时，无明确429或额度不足。没有更改用户代理/DNS配置。
- get_context已补每人原始有效投影短段及建议证据帧，避免12个均匀采样点的缺失被泛化成整段未知；结构化目标身份和提示要求核对号码/队色/鞋归属，冲突时未知，不改跟其他人。
- 原AI像素参考有误认相邻人鞋与双脚/单脚口径问题，已按原片重审并保留原估计、更正依据；当前数量以visual_reference.json为准。不得沿用旧错误参考结论评价Qwen或去噪，均非人工真值。

## 验证

- 20项Python定向测试、16项Node测试通过；新增原始有效短段及只暴露当前人身份断言通过，原始数据不变。合成partial额度耗尽检查确认停止后续模型调用并保留十人的结果。
- 两片冻结原始坐标变化始终为0。新Key实际P1两段ready，001 P2/P7有绘制与视觉反馈后的partial候选，无终态API/额度错误；partial不等于所有位置已确认。
- 浏览器实际单人筛选、三层切换、1155源帧/19.269秒同步通过。后台隐藏页的视频预加载需临时focus emulation；最终结束应解除该页临时模拟并保持暂停。全员/播放与最终数据完整验收尚待完成。

## 阻塞与待确认

- 当前仍有其他人旧失败片段待逐人补测；各段是否ready/partial及模型不确定性需要区分。模型图像估计、现有身份绑定和既有标定没有全片人工米制真值。
- 002 P10@1157原框对应32号而非冻结00号等身份疑点只列为不确定；本轮不改前置材料，映射必须避开假连续路线。

## 下一步

- 所有新请求显式 `--token-plan --workers 1 --players Pn`，逐人继续原任务，切勿重新启用旧常驻Key或自动退回按量方案。
- 002 P1/P9误删提示在本地 `artifacts/qwen-parallel-20261007/review-notes-002.json`；可用 `--redo P9:900:1200 --review-notes ...` 保留前版后定向复核。P10身份冲突也需看原片，不能硬补坐标。
- 导出参数当前为conservative＋window0.08秒/maxDisplacement0.25m/turnCosine0.6，minSmoothingPoints7。最终用修正后的参考重跑误差、缺口和真转向/停止复核，不以曲线平滑证明准确。

## 同步状态

- 本轮仍在本机main，无提交／推送，无PR、云部署或订阅管理操作。原未提交工作完整保留；远端同步基线见前轮交接。
