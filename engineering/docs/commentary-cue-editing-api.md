# 解说逐句人工编辑接口与UI迁移

2026-10-09，America/New_York。已接入工作台第三部分「解说与配音」，适用于初稿以及采用润色后的稿件。五条解说对应五个独立编辑入口，以`cueId`定位，不以数组下标作为持久身份。

## 用户操作

每条卡片可编辑文字、源视频开始/结束秒数、播放中/暂停讲法、语言标记，并有「保存本句」「恢复本句」。保存本句只更新这一条；其他卡片未保存的编辑留在本机草稿中。恢复本句只把当前卡片恢复到上次保存内容，不写服务端、不影响其他条目。保存后页面显示“本句已人工保存”。刷新会恢复已保存稿件，以及与该基线匹配的本机未保存草稿。

「保存解说稿」仍用于主动保存全部编辑；润色候选采用后可逐句修改/保存，无需先把整个候选全部保存。人工保存不调用模型、不生成音频；确认后使用现有「配音并生成字幕视频」更新成片。

已有字段是text、cueId、suggestedStartTime、suggestedEndTime与delivery，原稿没有独立语言字段。本次新增可选language：`zh-CN`中文（旧稿缺省）、`mul`中英混说、`en-US`英文。它是内容标记，不自动翻译或切换音色；现有Seed音色和口吻选择仍独立。

## HTTP接口

读取：`GET /api/commentary?sample=...&variant=...&qa=0`，沿用`{plan,job,status}`返回。每条cue保留全部事件、focus、证据及其他原字段。

单句保存：`POST /api/commentary/cues/{cueId}`，`Content-Type: application/json`。

```json
{
  "sample": "official-training-001",
  "variant": "original",
  "qa": false,
  "patch": {
    "text": "右侧一挡，防守还贴着呢。",
    "language": "zh-CN"
  },
  "expectedCue": {
    "cueId": "C2",
    "text": "右侧挡了一下，防守还挂在身边。",
    "suggestedStartTime": 6,
    "suggestedEndTime": 10.5,
    "delivery": "during_play"
  }
}
```

示例expectedCue仅展示一个简化cue；真实调用必须使用最近读取/保存返回的**完整原始cue对象**，包含已有证据等字段，不能手工删减。patch可传部分字段，只允许text、language、suggestedStartTime、suggestedEndTime、delivery。cueId、事件和证据不可通过此接口修改。

成功返回`200 {cue, plan}`。cue是保存后的条目，附`editedBy: "human"`与UTC `editedAt`；plan是保存后的完整当前稿件，供前端更新基线。服务端在锁内读取、比较目标cue、合并并原子写入原`plan.json`，保留其他句子的最新服务端版本。

- `400`：无稿件/无此cue、非法字段、空文本、越界时间或语言标记无效，不写入。
- `409`：expectedCue与服务端该句不一致，不覆盖，前端保留人工草稿供核对。另一句改变不会造成当前句冲突。
- 原有本机同源/请求格式限制保持。上下文隔离仍由视频SHA、跟踪指纹、variant和qa决定。

整份保存仍走`POST /api/commentary/save`，属于主动保存全部稿件；上述逐句冲突检查只适用于新接口。未改成通用版本管理或多人实时协作系统。

## 更换UI时复用什么

前端通用客户端：[commentary-client.mjs](../tools/player-review/commentary-client.mjs)。没有DOM、React或组件依赖，支持注入fetch，提供getState、savePlan、saveCue、startJob、getJob。旧工作台已通过同一客户端调用，避免新旧UI分别拼接协议。

```javascript
const api = createCommentaryClient({ sample, variant, qa });
const { plan } = await api.getState();
const original = plan.cues.find(cue => cue.cueId === selectedCueId);
const result = await api.saveCue(original.cueId, { text: editedText }, original);
```

迁移时保留这几个行为：

1. 使用cueId作key，保留读取的原始cue作为expectedCue；不要重排后按索引保存。
2. 区分服务端基线和本机草稿。保存一条后，只把该条替换为响应cue；其他未保存条目继续保留。完整响应plan更新服务端基线。
3. 字段默认值只用于显示，不要因打开旧稿就视为用户修改。旧稿language缺省显示中文。
4. 失败/409不丢弃输入；同一时间只保存一个请求。更换视频或卸载组件后不把旧响应填入新页面。
5. 配音成片对应生成时的稿件；文字改变后提示重新生成，不把旧成片标为已更新。

后端业务位于[commentary_jobs.py](../scripts/commentary_jobs.py)的`save_cue`，HTTP路由位于[serve_player_review.py](../scripts/serve_player_review.py)。稿件仍存原`commentary-jobs/<context>/plan.json`，更换UI无需迁移存储格式或重跑理解Agent。新UI部署时需包含通用客户端模块。

## 验证

23项Python、83项Node定向回归通过（含现有战术工作台）。覆盖逐句保存、其他句子不变、同句过期冲突、证据保留、无效请求不落盘、采用润色后人工编辑、保留其他本机草稿及恢复本句。

实际HTTP返回200/409且静态客户端模块可读取；浏览器用真实五句Astra稿进行逐句保存与草稿恢复验证。本次人工编辑验证不需要新增模型调用。
