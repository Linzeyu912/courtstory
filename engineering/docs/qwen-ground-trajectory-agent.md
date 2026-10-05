# Qwen 地面轨迹 Agent 首版

2026-10-05，Etc/UTC。按用户授权完成代码实现；真实 Qwen 调用、视频效果及浏览器验收留给本地。本指南对应[详细计划](plans/2026-10-05-qwen-ground-trajectory-agent-v1.md)，扩展现有工作台和 courtPreparation。

## 已实现的路线

Python 现有工作台负责精确源帧解码、视觉工具、任务和存储；Node 使用固定 Pi SDK `1.0.2` 调用阿里云 Qwen Chat Completions。视频通过带帧号、真实时间的拼图、原帧和球员／脚部裁图送入模型。模型选择证据、提出米制地面锚点和未知区间，程序按真实时间作保形 Hermite 拟合，随后将 2D 对照和原帧反投影回传给模型继续查看、补帧或修改。

七个工具为 `get_context`、`inspect_frames`、`inspect_trajectory`、`set_ground_anchors`、`set_unknown_ranges`、`fit_and_render`、`finish_candidate`。修改先经过共享核心校验；最新绘图保留在后续模型请求里，工具不能在尚未读取最新反馈时正常结束候选。达到预算或中途失败时，可保留最近成功绘制的 partial 候选供人查看；partial 不等于完成复核。

前端在已有“2D 轨迹准备”中加入球员选择、任务进度、取消、候选预览、证据帧定位、采用及撤销。图像轨迹、标定、身份和人工锁点保持原始来源；采用只修改准备层的有效地面坐标。2D、导出、持球关联和战术读取同一份 preparedByPlayer，保存时由后台按原来源和有序操作重放。

## 本地安装和启动

在仓库根目录执行，Node 至少 `22.19.0`，使用当前工作台的 Python 环境：

```bash
npm ci --prefix engineering/tools/player-review
npm ci --prefix engineering/tools/player-review/agents
npm run build --prefix engineering/tools/player-review
python -m pip install -r engineering/requirements-review.txt
```

Python 要能导入 PyAV、Pillow 和 numpy。GPU 检测环境仍按已有工作台说明配置；Qwen worker 不另下载视觉模型权重。视频文件需要真实 Git LFS 内容，而不能只是指针，参见[素材入口](../../data/videos/README.md)。已有本地草稿、检测缓存和人工标定不随代码推送。

将 `QWEN_KEY` 设置在**启动 Python 工作台的同一个进程环境**中，随后重启现有服务。前端不填写 key。可沿用原启动命令；库模式示例：

```bash
python engineering/scripts/serve_player_review.py \
  --library data/videos/tactics/acceptance/review-library.json \
  --port 8876
```

Windows 使用现有虚拟环境的 `python.exe`，并在启动它的 PowerShell 中设置环境变量；不要把 key 写入仓库配置或运行日志。打开 `http://127.0.0.1:8876/`；沿用已有实例时使用其原端口。服务状态接口 `/api/ground-trajectory-agent/status` 会指出缺少密钥、Node 或图片依赖等问题，仅禁用这个功能。

| 环境变量 | 默认值／作用 |
|---|---|
| `QWEN_KEY` | 必需；阿里云 API key，仅后端读取 |
| `QWEN_MODEL` | `qwen3.8-max`；不自动降级或替换模型 |
| `QWEN_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1`；只允许阿里云官方 HTTPS 域名 |
| `QWEN_GROUND_TIMEOUT` | 300 秒，允许 10–600 |
| `QWEN_GROUND_MAX_TURNS` | 最多 12 次模型请求，允许 2–24 |
| `QWEN_GROUND_MAX_FRAMES` | 最多 64 个独立源帧，允许 12–128 |

其他固定预算：最多 96 次工具执行，单次结果最多 8 张图片；读取原帧一次最多 12 帧，反投影一次最多 7 帧。裁图／拼图可合并多帧。使用真实 PTS／time，不按 frame/fps 推算。费用未估算，报告中的 `costEstimate` 为 `null`。

官方北京兼容端点依据：[阿里云 Chat Completions 文档](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)。如 key 属于其他地域或专属业务空间，按其官方地址设置 `QWEN_BASE_URL`；模型是否在该空间开放、是否支持图片与工具图片续读，需要本地真实请求确认。此版没有完成这项真实兼容验收。

## 操作顺序

1. 打开当前样例，核对 P 身份、球场标定和原始地面位置。所选区间至少要有可用米制观测；全缺测区间应先完成这些准备。
2. 在当前“2D 轨迹准备”点击“建立 / 更新 2D 准备”，设置开始／结束秒数。首轮建议一名球员、约 10 秒；随后再扩为两名有相对运动的球员。
3. “Qwen 修正地面轨迹”默认处理当前 P，也可取消默认选项后勾选多 P。可写“核对起跳造成的向上漂移，保留真实水平运动”等目标，点击运行。
4. 任务结束后，在同一张 2D 球场查看候选虚线与原始灰线，点击证据帧核对视频；partial 和未知区间必须单独查看。候选预览不会覆盖当前坐标。
5. 点击“采用候选区间”，然后点击现有“保存准备版本”。采用是一项可撤销操作；专用撤销只针对刚刚采用且此后未编辑的版本，其他情况使用全局撤销。
6. 进入现有战术制作／导出。模型点标为 `qwen_refined`、带版本、依据和证据帧，并保持待复核；不会变成人工确认真值。

草稿、身份、标定、视频或准备版本变化会阻止旧候选迟返覆盖当前结果。重新建立准备会替换派生结果；先保存／备份需要保留的版本。取消不会采用任何候选。服务重启会把运行任务标为中断并保留任务记录；首版 UI 不提供重启任务续跑或历史任务列表。

## 保存和接续调试

默认本地目录（均在已有被忽略的 local-workbench 内）：

- `data/local-workbench/tactics/ground-trajectory-jobs/<jobId>/job.json`：来源、范围、状态、候选、用量、工具审计和证据索引。
- 同目录 `assets/`：真实读图、拼图和渲染 JPEG；`worker.stderr.log`：脱敏错误。
- `data/local-workbench/tactics/court-preparations/ground-candidates/<jobId>/<revision>.json`：后台候选及采用登记。
- 原 court-preparations 的版本快照继续存完整准备，Qwen 与平滑按操作顺序重放。

保留任务目录及准备快照一起迁移，后者引用后台候选记录。只有下载的轨迹 JSON 不能冒充已经由另一台服务采用并保存的可信准备。

## 首版边界与本地待验收

首版不会桥接原始缺失观测，不跨切镜、身份分界和未知段连线，不修改人工锁点。只采用创建任务时选定的完整候选范围；想缩小范围应重新创建任务。空中脚点不会被当成确认接地点；模型只能估计水平地面位置。跳跃／投篮等动作事件的自动识别与统计留给后续。

建议本地按以下顺序验收，当前均未实测：

1. 确认当前模型／地域的文本、图像、Function Calling，以及“工具返回图片后模型继续读取”兼容性，确认任务能正常结束。
2. 同一段、同一 P 比较原始投影、现有程序平滑和 Qwen 候选。用视频中的已知相对位置和移动方向判断正确性，不能仅凭曲线更平滑判断成功。
3. 查看起跳、遮挡、急停／折返、镜头移动区间，再检查未知段、人工点、范围边界、采用／撤销、刷新恢复和保存后战术坐标一致。
4. 单人确认后再试两人。用任务审计确认存在真实多轮取证及读绘图过程，记录耗时和实际 token；不要把一次局部试跑扩写为全场精度结论。

本轮仅完成 JS／Python 语法、依赖离线导入、静态接口审查和前端构建；没有真实 API、视频解码、浏览器流程、完整回归或定位精度测试。
