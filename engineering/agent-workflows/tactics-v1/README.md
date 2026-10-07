# Agent 工作流运行入口

本目录实现版本 `tactics-v1.0.0` 的持久编排入口；执行依据仍为 [Final v1 计划](../../docs/plans/2026-10-06-workbench-reliability-and-api-parallel-plan.md)、[默认流程](../../docs/agent-tactics-workflow.md)及[工具合同](../../docs/specs/agent-tactics-tools-v1.md)。不会修改现有工作台页面、源视频或用户草稿。

## 已有入口

- `workflow.json` 登记十个阶段、依赖和初始能力；`policy.json` 保存默认预算。实际模型、解码和编码能力由 `inspect_clip` 再核查。
- `schemas/` 包含十四个调用 envelope、统一响应、产物、来源和文档引用。运行时采用严格的标准库验证器，仅支持这些 schema 使用的关键词，遇到不支持的关键词拒绝；不是完整 JSON Schema 解释器。执行 `python engineering/scripts/agent_workflow_contract.py` 可从唯一维护入口重新生成机器文件，测试会核对同步。
- `agent_workflow_store.py` 使用 SQLite WAL、短事务、调用者作用域、幂等键、接收时 revision 检查、generation 和租约。独立操作完成时核对来源和依赖摘要，不以总 revision 更新拒绝另一合法操作。
- `agent_workflow_runner.py` 注入同一组生产工具。参与者覆盖和逐帧投影可并行；采用和保存串行。副作用采用事务保护，取消后的迟到输出不能登记。超时租约只在过期后恢复，不能抢走活动 worker。
- `agent_workflow_cli.py` 提供本机登记、submit/status/resume/cancel/run/recover/repair 与 `serve`；HTTP 使用同一个 runner。

所有运行入口应使用同一个 `--store` 目录，共享 GPU/API/渲染限额和资产授权。另建目录意味着独立调度域，不能拿多个目录绕过同一设备的预算。目录放在当前机器的本地磁盘，不把 WAL 数据库放入网络共享。源资产 ID 不可变；来源变化须登记新 ID，新任务中明确重建基线。

## 本机命令

在仓库根目录使用已核实、包含 PyAV 的 Python 和可用 Node。无需新建环境或安装依赖。资产登记会准确解码全部帧；已有 review/tracking 可通过本机 JSON metadata 指定 `reviewPath`、`trackingPath`、`trackingMetadataPath`、`baseDocumentPath`。这些本机路径不会成为 HTTP 请求参数。

只有原视频、没有 tracking 时，使用可信启动参数 `--detector-python <python>`、`--detector-weights <weights>`，或环境变量 `AGENT_TACTICS_DETECTOR_PYTHON`、`AGENT_TACTICS_DETECTOR_WEIGHTS`，指定已核实的本机推理环境和模型。它们是全局 CLI 参数，放在 `submit` 或 `serve` 前；CLI 和 HTTP 使用相同工具配置，外部请求不能指定执行程序或权重路径。

```powershell
python engineering/scripts/agent_workflow_cli.py --caller local register --asset-ref clip-a --video <local-video.mp4> --metadata <local-asset.json>
python engineering/scripts/agent_workflow_cli.py --caller local submit --request <canonical-submit.json>
python engineering/scripts/agent_workflow_cli.py --caller local status <run-id>
python engineering/scripts/agent_workflow_cli.py --caller local resume --request <canonical-resume.json>
python engineering/scripts/agent_workflow_cli.py --caller local cancel --request <canonical-cancel.json>
python engineering/scripts/agent_workflow_cli.py --caller local export <run-id> --output <new-delivery-directory>
```

`submit`/`resume` 默认运行到终态；`--enqueue-only` 只持久登记，随后显式 `run <run-id>`。重试同 key 返回相同任务，不重做已完成保存或编码；同 key 改业务请求返回冲突。`requestId` 与接收时的 `expectedRunRevision` 不参与幂等业务摘要。

`export` 对 `succeeded`／`partial` 任务按已接受产物 SHA 复制成平展目录，包括 `result.mp4`、球员证据、分析、`analysis-revision.json` 修订旁车、存在时的 `repair-feedback.json`、覆盖、投影、独立审查、预览 PNG、manifest、decode report、`run.json` 和 `delivery.json`。`document.json` 原样保留保存版本 envelope；`native-document.json` 从其中提取原生可编辑文档。`quality-report.json` 汇总各质量文件的 pass、candidate/source/analysis 绑定及 SHA，并索引预览；`delivery.json` 记录复制文件及派生文档摘要。只允许新建或空目录，不覆盖已有交付。它复用已接受产物，不触发模型或渲染；历史交付文件名不回写。

若反馈修复增加了原视频证据帧，导出同时保留原字节 `repair-source-frames.json`，并把已登记 JPEG 复制到 `repair-source-frames/asset-XXXXXX.jpg`。`delivery.json` 的文件清单记录相对位置、SHA、asset/source 帧号与准确 PTS/time base，使离线审计不依赖原 manifest 中的本机路径。清单与照片必须属于同一生产 operation 且摘要匹配；导出不会按 manifest 中的任意路径读取文件。

同一 `export` 命令也可导出 `needs_attention`／`failed`／`cancelled` 的异常包。`manifest.json`、`delivery.json` 与每个文件明确 `accepted=false`，不生成最终 `document.json` 或 `result.mp4`。证据按 operation 存在 `history/`，包括旧 generation 的已登记分析、清单、未接受候选、质量报告、失败复核、预览与修复证据；`failure-history.json` 保留各次操作的状态、有效性、错误和产物索引。`quality-report.json` 按 generation 索引已登记报告的原结论与摘要，不把历史 pass 合成为最终通过。缺失、摘要不符或 producer 不匹配的文件只记入 `omittedArtifacts`，不会复制；即使没有可复制证据，也会输出 `run.json`、`error.json`、空质量索引、历史索引与交付清单。只读取授权运行中已登记的产物，不读取 manifest 中的路径，不导出原始模型提示。导出成功返回退出码 0，但包内仍保留原运行的失败状态；不恢复、重试或消耗模型调用。

provider 未形成有效结果文件时，已完整记录的事件可由可信本机诊断 adapter 提取为 `provider_diagnostic` 与可选的 `independent_review_diagnostic`。这些报告明确 `diagnosticOnly=true`、`executionAccepted=false`、`pass=false`；其中保留的原始 `verdict` 即使为 pass 也不能触发采用或保存。新异常可直接登记，历史运行使用下列入口，仅定位数据库中当前 generation 的 failed preview attempt，校验来源、候选、分析版本、producer 与预览摘要后登记：

```powershell
python engineering/scripts/agent_workflow_cli.py --store <same-store> --caller local import-diagnostics <run-id>
python engineering/scripts/agent_workflow_cli.py --store <same-store> --caller local export <run-id> --output <new-failure-directory>
```

诊断导入不接受路径参数，不改变失败状态、generation、截止时间和已耗预算，不执行 resume 或模型；相同失败 attempt 已登记时幂等返回。取消或新 generation 会拒绝迟到登记。未登记的 attempt 原始文件不会被异常包按路径自行抓取。

canonical submit 完整示例在 [测试夹具](../../tests/fixtures/agent-workflow/canonical-submit.json)。控制命令同样保留 envelope，例如：

```json
{
  "schemaVersion": "1.0",
  "requestId": "resume-request-001",
  "idempotencyKey": "resume-render-001",
  "runId": "run-from-submit",
  "expectedRunRevision": 18,
  "args": {"reason": "编码器恢复后只重试渲染", "retryStages": ["render_projected_video"]}
}
```

恢复会检查原视频、基线文件与可复用产物摘要，失效阶段及下游重新执行。仍有效上游的未完成需求会保留，不能通过只重编码把 `partial` 洗成 `succeeded`。成功任务不通过 resume 重跑模型；重新分析用新的提交与幂等键。

重分析在领取 operation 租约时持久预留新的 `analysisRevision`，包括旧数据库中已发表的分析和已崩溃 attempt 占用的版本；旧冻结清单保留原文件与摘要，新版本另存。上下文同时记录修订原因、上一分析及清单引用。显式 resume 开启新的 generation 与墙钟窗口；已消耗模型调用、检测调用和金额预算不重置，上一 generation 的耗时写入恢复审计。

## 有界反馈恢复

覆盖、投影和独立复核的失败结果会登记诊断报告与预览，operation 保持 `failed`，绝不能作为成功依赖。公开错误的 `evidenceRefs` 指向可查询的产物 ID；成功图形、已冻结清单、失败报告均不删除。

独立 provider 复核明确指出旧分析唯一阶段中的人、原因及已审查帧时，可自动使用一次反馈修正。旧阶段必须完整覆盖请求范围，按准确解码 PTS 与 `mediaEndTime` 计算不超过 `maxRepairSeconds`（默认及硬上限 8 秒）；不使用名义帧率换算。多阶段、未定位问题、错人身份重绑、来源变化和机器检查失败不触发整段重新分析。反馈逐条保留，新分析必须保留原参与者清单并处理遗漏，允许在这一旧阶段内重新分期；尚未实现保留其他阶段不动的多阶段局部修复。

修复保留 inspect/prepare，原分析及其下游仅标记失效，另建 generation 和单调递增 analysisRevision；新 attempt 接收绑定旧 source/candidate/revision 的 SHA 反馈引用。持久 `repairPasses` 最多 1，必须还剩至少两次模型调用。自动修复延续同一运行的 6 次调用和 600 秒总截止时间，第二次失败即 `needs_attention`；取消与旧 generation 的迟到错误不能终结新一轮。所有质量门槛仍重新执行，通过前不保存或渲染。

早期运行若只留下失败 attempt 文件，可在可信本机显式恢复诊断并继续同一运行：

```powershell
python engineering/scripts/agent_workflow_cli.py --store <same-store> --caller local repair <run-id> --recover-diagnostics
```

入口只从数据库记录的失败 attempt 读取固定文件，核验 provider 响应、报告、预览、来源、候选和旧分析绑定；不会把历史失败改成成功。`--enqueue-only` 仅登记恢复，不调用模型。历史终态恢复累计已记录墙钟耗时，只分配 `600 - 已耗秒数` 的剩余时间，保留已耗模型调用与修复计数，审计另记终态停留时间。它属于历史中断续跑，不能称作原始一次 submit 成功；普通 `resume` 与此专用反馈入口的墙钟规则不同。

## HTTP 边界

本机可信配置通过环境变量 `BROADCAST_WORKFLOW_TOKENS` 提供令牌到 caller ID 的 JSON 映射。运行 `serve --host 127.0.0.1 --port 8896`；默认仅本机，未部署云服务。HTTP 必须 Bearer 鉴权，无 Cookie 授权和开放 CORS，拒绝浏览器 Origin；JSON 上限 1 MiB。TLS、公网入口、凭据轮换、上传及 MCP 尚未实现，不把本机演示称为生产公网服务。

- `POST /v1/workflows` 提交 canonical envelope 并后台运行。
- `GET /v1/workflows/{runId}` 获取结构化状态。
- `POST /v1/workflows/{runId}/resume`、`/cancel` 使用同一控制 envelope。
- `GET /v1/workflows/{runId}/artifacts` 返回授权后的产物元数据；`/artifacts/{artifactId}` 可下载已通过登记的交付及质量产物。内部快照、provider诊断等只在本机审计目录读取。
- `POST /v1/tools/{toolName}:call` 是高级调用入口，仍检查来源、依赖、版本及预算。

状态响应只给 opaque 产物 ID、摘要、大小等，不返回内部文件路径或模型思考文本。HTTP 与 CLI 不接受任意工具名、任意 URL、任意路径，也不能通过 caller 字段伪装其他调用者。

## 验证和实现范围

```powershell
python -m unittest discover -s engineering/scripts -p 'test_agent_workflow_*.py' -v
```

运行器测试使用明确的合成 handler，覆盖规范示例／未知字段、JS 原生浮点映射摘要、同键冲突与调用者隔离、独立 operation 并发、过期 worker 恢复、取消迟到、预算、失败可见性、禁止未授权 partial，以及恢复保留未完成需求。这些测试不是视觉精度或真实模型成功证据；实际视频、provider、原生图形与 MP4 完整解码须另行验收。

有界修复只覆盖上文的单阶段短片反馈场景。TAPIR、完整十人身份、按需几何生产 adapter、新视觉 API provider、六段样本与并发 1/2/3 对照各自仍需对应实现和验收，不能因本目录入口可运行便称全计划完成。

SQLite 行为参考 [Python sqlite3](https://docs.python.org/3/library/sqlite3.html) 与 [SQLite WAL](https://www.sqlite.org/wal.html)；schema 使用 [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core)。
