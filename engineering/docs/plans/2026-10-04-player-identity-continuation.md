# 球员身份与跨片段续接

用户已批准：建立球员身份，按球衣号码和外观寻找其他片段，人工确认后续接；预留多模态 API。沿用 main，不改检测器，不覆盖用户的现有草稿。

## 操作流程

在球员页选固定球员槽位 → 停在清楚的画面 → 选画面中的临时 T → 填球队/球衣描述和号码（也可让 Agent 识别）→ 保存参考身份 → Agent 查找所选时间段 → 看候选片段和证据 → 勾选采用 → 可一次撤销。

固定身份沿用 P 编号；球衣参考属于本视频，不依赖 NBA 名单。参考只确认当前帧，不把整个 T 当作同一个人。候选是有限时间段，缺测/切镜分开，同一 T 后续换人不可直接延伸。人工区间与已有人工位置需保护，冲突清楚显示。Agent 不直接保存修改，不把全部候选帧标为已人工审核。

## 数据与接口

- `entity.identityReference`: `{version:1, videoHash, trackingFingerprint, frame, trackId, box:[x1,y1,x2,y2], team, jersey}`。球队与号码经人确认后保存；一个有效参考先满足首版需求，可重新设置、撤销。
- `/api/identity-agent/status`、`/api/identity-agent/jobs`、`/api/identity-agent/jobs/:id`、`.../cancel`、`.../adopt`。请求绑定服务器登记的视频/跟踪版本、qa 空间、完整 session 与 clientRevision。
- 作业 `purpose: reference | continuation`。reference 只建议球队/号码，不自动确认；continuation 用保存的身份参考和 `{start,end}`（零起点、含结束帧）检索。响应包含有限候选 `{id,trackId,start,end,confidence,reason,evidenceFrames}` 与参考图/证据图。
- 采用前重新核对 session 与修订，旧任务不可覆盖新编辑；取消、失败、未配置 provider 均明确显示。
- provider 统一接收图片、提示、JSON schema，返回结构化 JSON。首版接现有受限 Codex CLI；`multimodal-api` 仅保留未配置适配器和契约，不读取前端密钥、不虚构 API 地址，不声称已经接通远端模型。

## 实施和验证

1. 后端：身份作业、证据抽取、严格结果校验、provider seam；新增单元测试。
2. 前端：参考身份与候选采用的纯函数、清楚的操作面板；保护区间外记录和人工冲突，测试撤销前状态不变。
3. 集成：app 状态/撤销、服务路由、session 校验、静态资源与使用说明。
4. 独立代码复核、Node/Python 回归、隔离服务上真实 Agent 和浏览器验证，再更新 8893 服务。

验收重点：Warriors 视频第 380 帧紫队 10 号为 T2，第 853 帧同一人是 T62，而 T2 已是白队 21 号。结果只能作为候选；不得跨越已知换人片段自动整轨绑定。抽样证据不等于逐帧身份保证，UI 必须允许缩小区间和人工纠正。
