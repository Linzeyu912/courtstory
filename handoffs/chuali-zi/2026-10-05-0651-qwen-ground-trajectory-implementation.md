# 交接：Qwen 地面轨迹 Agent 首版实现与同步

- 日期 / 时区：2026-10-05 06:51，Etc/UTC。
- 成员：chuali-zi。
- 任务 / Issue：本轮聊天明确授权代码实现、多子 Agent 协作；未创建新的 Issue。
- 分支：main。
- 实现提交：[0dd6687d3636f0544d547277865553f0749655eb](https://github.com/Linzeyu912/courtstory/commit/0dd6687d3636f0544d547277865553f0749655eb)。
- 状态：首版代码已实现并推送；真实 API、视频效果、浏览器与完整回归按用户要求留给本地。

## 本次完成

- 以已同步的 `0efd66a` 为实现基线，复用现有 2D-first courtPreparation，不新增工作台。四个实现子 Agent 分别负责共享拟合核心、Pi／Qwen worker、Python 后台及现有 UI；第五个子 Agent 只读审查，主 Agent 集成消费者、文档和发布。
- 新增 `ground-trajectory-fit.mjs`／`ground-trajectory.mjs`：真实时间保形 Hermite、模型候选来源、人工锁点、断段／未知保护、候选采用和有序重放。已有平滑稿保留原重放语义。
- `engineering/tools/player-review/agents/` 固定 Pi SDK `1.0.2` 和 lockfile，支持取帧、局部放大、锚点修改、未知范围、拟合绘图和后续读图循环；限制调用、帧数、图片、工具和时间预算，保留最近成功绘图的 partial 候选。仅使用后端环境 `QWEN_KEY`，费用估计不伪造。
- `ground_trajectory_agent.py`／`ground_trajectory_images.py`、已有 server／准备 store：隔离任务来源，真实帧和拼图证据、反投影与 2D 对照，JSONL RPC、取消、候选登记、采用和保存验证；依赖不足只禁用该功能。图片 helper 延迟导入。
- 现有 2D 准备新增当前 P／多 P、秒级范围、目标、任务状态、候选预览、证据帧、采用和撤销。采用沿用全局 history／IndexedDB；保存继续由服务端重放而不是信任任意客户端点列。
- 导出、持球关联、2D 和战术读取有效准备；模型来源带版本／依据／证据且待复核。修正坐标检查的来源说明，按新坐标重算界外状态。
- 更新[实施计划](../../engineering/docs/plans/2026-10-05-qwen-ground-trajectory-agent-v1.md)、工作台 README，新增[安装、操作与本地接续指南](../../engineering/docs/qwen-ground-trajectory-agent.md)。

## 结论与依据

- 遵循用户共识：现有多模态 API 加主动多轮视觉工具；模型负责空间／时序取证，程序产出可重放曲线。不将平滑等同于准确，不把空中脚点当确认地面观测，动作识别仍属后续任务。
- 来源沿用[研究与固定源码记录](../../research/agents/qwen-video-trajectory-agent-20261005.md)；Aliyun 默认北京兼容端点和 model `qwen3.8-max` 由后端配置。实际账户是否支持图片与工具图片续读未调用确认，不自动替换模型或地域。
- 首版不桥接原始缺失地面观测，不缩小候选范围采用，不提供任务跨服务重启续跑。未知段保留空值，人工点保持约束。

## 验证

- 18 个改动／新增 `.mjs` 的 `node --check` 通过；独立 agents `npm run check` 通过。
- 4 个 Python 文件 `py_compile` 通过；后台离线导入确认未加载图片 helper，JS 核心／客户端／战术模块离线导入通过。
- 安装 lockfile 对应 Node 依赖；现有 `npm run build` 成功并更新受版本控制的 UI bundle；主 app 以临时输出打包成功，临时文件不提交。
- 静态审查发现并修复最新绘图被上下文裁剪、前后台帧数 schema 不一致和坐标来源说明问题。检查候选、采用、准备重放、可信保存和消费者接口一致。
- 新指南相对链接、`git diff --check`／staged diff 检查通过。没有改视频／LFS 清单，未提交 key、node_modules、缓存或取帧资产。
- **没有**真实 Qwen 请求、视频解码／下载／效果试跑、浏览器交互或完整回归测试。当前环境无 PyAV，不能以基本构建代替视觉链路验收。

## 阻塞与待确认

- 代码实现没有剩余阻塞。真实模型／工具图片接口兼容性、定位正确性及边界交互仍待本地验收。
- 本地需要 Node >=22.19、独立 agents 的 npm 依赖、工作台 Python 依赖、真实 LFS 视频和当前身份／球场准备。QWEN_KEY 应在启动现有 Python 服务的进程环境中设置并重启服务。

## 下一步

按实现指南先确认真实 API 多模态工具循环，再用约 10 秒一人区间对照原始投影／现有平滑／Qwen 候选，核对跳跃、真实水平移动、急停与镜头变化；验证采用撤销、保存刷新和战术读取后，再扩大到两人。用户自行拉取到本地测试，本轮不消费模型调用。

## 同步状态

- 06:46 及提交前同步远端，远端实现基线仍为 `0efd66a`，没有新增远端改动需要整合。
- 28 个实现／运行指南文件组成 `0dd6687`，已直接推送 main；2026-10-05 06:51:52 UTC，HEAD、origin/main、`git ls-remote origin refs/heads/main` 均为完整 SHA `0dd6687d3636f0544d547277865553f0749655eb`。
- 本交接及团队状态在核实上述推送后写入，作为后续独立文档提交同步。最终文档提交 SHA 以本轮完成消息和远端 refs/heads/main 为准。
