# 交接：同步远端、启动 Qwen 轨迹工作台并等待测试方向确认

- 日期 / 时区：2026-10-05 12:57，America/New_York（EDT，UTC−04:00）。
- 成员：chuali-zi。
- 任务 / Issue：用户指定只负责千问、多模态理解与 2D 球场映射；先同步、阅读和说明方向，确认后才开始测试。GitHub Issue 查询返回 HTTP 401，未核对负责人及讨论。
- 分支：main。
- 提交：本轮未提交、未推送；同步至 `1e26b63450cfd601b2d410f435807c05b1d981e8`。
- 状态：同步与启动准备完成，真实模型和效果测试待用户确认。

## 本次完成

- `git fetch` 后发现落后 27 个提交，执行 `git pull --ff-only origin main`，两个新增官方训练视频的 LFS 内容随拉取下载完成。
- 临时保存原有 `engineering/README.md`，拉取后恢复；冲突保留远端新目录说明与本地两个新增入口。原有未跟踪实验、文档和交接保留；临时 stash 已移除，文档保持未提交状态。
- 阅读当前 Qwen 实现指南、实施计划、实现交接，以及 worker、provider、Python 后台和 2D 准备接口。旧 player_recovery 是不同的历史图像补点实验，不作为当前测试主线。
- 安装 agents 的 lockfile 依赖；因全局 npm 缓存权限限制，改用忽略目录 `tmp/npm-cache`。
- 用现有 `.venv` 启动工作台 `http://127.0.0.1:8876/`，只载入 `nba-lal-min-005`（267 帧）。启动脚本和样例库在 `tmp/qwen-readiness/`；草稿、任务、日志、导入缓存在 `artifacts/qwen-readiness/`，与现有正式保存空间分开。
- 本机已有密钥从本地配置读取并在服务进程内适配为 `QWEN_KEY`；未打印或写入新文件。请求了打开 Codex 浏览器面板，工具返回 queued。

## 方向与依据

来源均为本次同步代码及文档：

- [实现指南](../../engineering/docs/qwen-ground-trajectory-agent.md)。
- [实施计划](../../engineering/docs/plans/2026-10-05-qwen-ground-trajectory-agent-v1.md)，尤其第 9 节同片对照。
- [实现交接](2026-10-05-0651-qwen-ground-trajectory-implementation.md)。

待用户确认的测试范围：真实图片 / Function Calling / 工具返回图片后继续读取；单人约 10.7 秒同片原始投影、现有平滑、Qwen 修正对照；起跳与水平移动、急停折返、遮挡、镜头移动；原图反投影及留出地面参考点；采用、撤销、保存、刷新、导出及战术坐标一致性；单人闭环后再试两人和新官方训练片。记录实际请求、token、耗时、失败与 partial，不以平滑或覆盖代替精度。

## 验证

- 本地 HEAD 与 fetch 后 origin/main 完整 SHA 一致；无未解决索引冲突，`git diff --check` 通过。
- 工作台首页 HTTP 200；服务启动记录视频 SHA 与计划样例一致，267 帧。
- 只读状态接口显示 available/configured/runtime/dependencies/decoding 均为 true，配置模型 `qwen3.8-max`。这只证明本机配置就绪，不证明账户支持该模型或真实推理成功。
- 没有发起模型请求，没有运行效果实验、测试套件或采用候选，没有修改产品算法。

## 阻塞与待确认

- 按用户明确要求等待测试方向确认。
- 真实模型的图片、工具调用兼容性，以及样例 P 身份和球场准备的可用性，确认后核查。已有计划说明此样例没有专属场地 / 脚部候选，不假定其标定已就绪。

## 下一步

- 用户确认后，先做少量真实协议烟测，再核对样例身份与标定，执行同片单人对照；若发现兼容问题或空间误差，记录具体失败再做必要修复。

## 同步状态

- 远端代码已拉取至上述 main SHA。本轮仅本地准备与交接，未提交或推送；预览服务和本机密钥不代表云端部署。
