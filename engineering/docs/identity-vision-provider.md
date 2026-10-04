# 球员身份识别 provider 接口

身份续接独立于战术建议。前端始终调用本机 `/api/identity-agent/` 作业接口，不持有模型密钥或远端 API 地址。

## 当前可用实现

本机评审环境使用 `pip install -r engineering/requirements-review.txt`，其中 Pillow 用于参考人物裁剪与证据拼图。模型推理环境仍沿用现有配置。

`engineering/scripts/vision_provider.py` 的 `VisionProvider` 契约包含：

```python
def status(self) -> dict: ...
def generate(self, *, job: dict, directory: Path, schema: Path,
             result: Path, images: list[Path], prompt: str) -> dict: ...
```

默认 `--identity-agent-provider codex` 使用已有的受限 Codex CLI 调用。复用 `--tactics-agent-cli`、`--tactics-agent-timeout`、`--tactics-agent-reasoning-effort`。模型只接收明确抽取的图片、提示与 JSON schema，禁止额外工具调用。`status.available` 仅表示配置就绪，不保证登录、额度、网络或单次识别成功。

`--identity-agent-provider multimodal-api` 是预留的未配置适配器，会明确返回不可用。**目前没有接通第三方多模态 API**，也不接受浏览器传入密钥或任意 endpoint。

## 后续接 API 时的边界

新增服务端 adapter 实现同一契约，在 `create_provider` 注册，不必改球员页操作流程。endpoint、模型名、密钥由可信服务端配置提供。适配器负责把明确传入的图像与 schema 转换为所选供应商格式；仅返回 JSON 对象，业务校验仍由 `IdentityAgent` 执行。必须遵守 `job['cancel']` 与超时，不在日志、错误或前端状态中回传密钥。

## 作业与采用

- `GET /api/identity-agent/status`：provider 就绪状态。
- `POST /api/identity-agent/jobs`：`sample, variant, qa, session, clientRevision, entityId, purpose, reference, range`。`purpose` 为 `reference` 或 `continuation`；range 为零起点且含结束帧。
- `GET /api/identity-agent/jobs/:id?sample=...&variant=...&qa=1`：状态、候选与裁剪证据图。
- `POST .../:id/cancel`：同一来源上下文取消。
- `POST .../:id/adopt`：上下文、完整当前 session、clientRevision、entityId、selectedIds。服务器复核原始快照，返回所选候选；浏览器保护人工记录后，以一个可撤销操作写入草稿。

候选段：`{id,trackId,start,end,confidence,reason,evidenceFrames}`。置信度是模型估计，不是校准后的正确率。只有提供给模型的检测观测才可作为依据；区间受已检查窗口、缺测、切镜与身份风险边界限制。界面可在候选内进一步缩小范围，不允许扩大。

参考身份：`{version:1,videoHash,trackingFingerprint,frame,trackId,box,team,jersey}`，保存在对应 `entity.identityReference`。来源和 bbox 必须与原始帧的唯一观测一致。球队描述最多 40 字符，号码为 1–3 位数字（保留前导零）；识别前允许留空，续接前须人工确认保存。

抽样匹配与逐帧跟踪是不同证据。该接口不会修改检测器原始输出、保证全片身份正确，或把候选全部标成人工审核完成。
