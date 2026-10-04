# 新视频到战术制作实施计划

> 用户已确认设计并要求直接推进。执行 OMC 分工，所有改动留在 main；不新建分支、工作树或 PR。

**Goal:** 用户可导入新视频，机器识别球员，选择时间段纠正身份与位置，运行真实 Agent 生成可编辑战术，并让重点圈跟随合法脚点。

**Architecture:** 复用本机 HTTP 服务、检测队列、review session 与战术画布。增加服务专属工作集合、区间操作和受限 Codex CLI 任务适配器；候选与人工草稿分离，采用时复核来源与版本。

**Tech stack:** Python / PyAV / Ultralytics / Torch，原生 ES modules / React，Node test / Python unittest，Codex CLI。

**Spec:** [已确认设计](2026-10-04-video-to-tactics-workflow-design.md)。

**约束:** 保留既有未提交修改；只归档工作台素材条目，不删除共享原片、缓存和旧草稿。后台状态不能以旧版本冒充新任务成功。人工区间修正不自动完成审核。新圈零偏移，旧圈保留偏移。Agent 固定参数、只读沙箱、专用输入目录、ephemeral，不继承用户危险权限，不执行输出指令。

## 分工与接口

主代理负责共享服务路由、主导航、集成、真实 GPU/浏览器验收、构建和交接。三个执行通道分别拥有下面文件，不交叉写入；所有通道不提交、不重启用户服务、不构建 bundle。

### A. 导入与工作集合

- 文件：`local_video_library.py`、其测试、`video-library.mjs`、其测试；新增工作集合或运行检查辅助模块。
- [x] 测试先证明只展示保留示例、去重导入重新激活、队列状态不被旧结果覆盖，以及缺失权重明确禁用。
- [x] 实现工作集合 manifest / 备份 / 归档恢复；提供主服务可调用的活动条目过滤函数。
- [x] 实现「导入并识别」→ team-stable 队列 → 完成打开；轮询、失败与重试保持真实状态。
- [x] 返回所选模型实际可用性；机器 worker 错误给出安全摘要。
- [x] 定向测试、独立复核。

### B. 区间身份与位置

- 文件：`identity-ui.jsx`、`app.mjs`、`trajectory.mjs`、`identity-timeline.mjs`、`image-edit.mjs`、`review_session.py` 及相关消费者和测试。与 C 协商 app 的唯一集成点：snapshot 允许空人工画布。
- [x] 红测试：明确覆盖整段、结束后恢复、区间外审核不变、冲突与缺测跳过。
- [x] 实现 `replaceIdentityRange`，只迁移同帧完全不变的审核引用。
- [x] 实现 `correctImageRange` 相对关键帧传播、manual_range 来源、保护已有人工位置、预览数量与一次撤销。
- [x] 区间时间输入、起止滑块、当前画面设起点/终点、关键帧编辑、应用/撤销集中在球员主面板。
- [x] 更新导出、脚点、投影、质量与审核消费者；空画布 snapshot 与严格轨迹导出分开。
- [x] 定向测试、独立复核。

### C. Agent、脚圈与最新位置

- 文件：`tactics-ui.mjs`、`tactics-document.mjs`、`tactics-annotations.mjs`、战术校验/CLI/测试、新 Python Agent 适配器与测试；保留当前 seekCanvas 修复。
- [x] 红测试：点击圈吸附与跟随、换人吸附、旧偏移兼容；同源快照更新新增参与者、保留人工图形和可恢复孤立对象。
- [x] 实现 player_foot / manual_offset 锚定、上下文归属文案和同步。
- [x] 实现真实 Agent jobs/status/cancel/adopt 合约及严格 schema。统一零基 startFrame/freezeFrame/endFrameExclusive，服务生成 IDs 和来源绑定。
- [x] 固定 read-only CLI；输入是素材数据，输出是候选数据；失败显示原因。
- [x] UI 任务入口、候选预览/采用、保存版本与浏览器 revision/digest 守卫、jobId 幂等。
- [x] 定向测试、独立复核。

### D. 串联与真实验收

- 文件：`serve_player_review.py`、`index.html`、`workspace.mjs`、`pipeline.css`、文档与交接。
- [x] 接入 A/C 路由及工作集合过滤，不掩盖新任务状态；主入口和四步导航一致。
- [x] 隔离 QA 服务配置真实推理 Python、现有篮球权重及 CLI。
- [x] 新文件实际 GPU 识别，核对 tracks / PTS / 帧数与打开；真实受限视觉 Agent smoke，核对无仓库/用户文件副作用。
- [x] 浏览器导入→识别→区间修改→战术圈/Agent候选→采用→手改/删除→保存恢复。
- [x] 运行相关全量检查与 bundle 构建，分工交叉复核，修复阻断后再验。
- [x] 更新 8893 服务并展示主入口；更新准确操作说明与交接。仅报告实际验证结果。

## Review focus

范围外身份/审核完全保留；manual_range 不能伪造检测或审核；缺测/切镜不会跟错人；最新位置同步不丢人工内容；Agent 无权限扩张与假成功；迟到响应、版本冲突、重复采用均不能覆盖或重复追加；共享素材不被删除。

## 已执行验收

2026-10-04：主功能 Node 409 项（408 通过、1 项条件跳过）和 Python 115 项全部通过；真实 GPU 142 帧导入、21 帧区间纠正、真实 12 图视觉 Agent 候选采用、保存/刷新恢复、挡拆旋转/删除/撤销均实际执行。追加顶部模型折叠通过 31 项关联测试及独立复核，8893 主服务已更新并展示。详见[交接](../../../handoffs/thy-0629/2026-10-04-1420-video-workflow.md)和[操作说明](../tactics-canvas.md)。
