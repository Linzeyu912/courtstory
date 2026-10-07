# EC2 工作台直接代码部署

本轮采用 EC2 + AgentCore ZIP + S3 + CloudFront VPC origin，见[拆分与验收方案](../../docs/ec2-code-deployment-plan-20261007.md)。不需要 Docker、ECR 或 ECS。SageMaker GPU 尚未接入。

**账号全量重置后的恢复请从 [10 月 8 日重新部署计划](../../docs/plans/2026-10-08-cloud-reset-redeployment.md)开始。** 当前新增的 `prepare_rebuild.py` 完整携带三素材，不能用早期 `prepare.py` 的“官方 S3 素材已存在”假设重建。状态快照、路径迁移和首次启动恢复已经经过实际 Linux 换目录 / 重新成片演练；当前线上未应用这些恢复改动。

| 文件 | 用途 |
| --- | --- |
| `prepare.py` | 明确枚举发布文件、三个已登记测试视频，生成清单和两个 ZIP；`--upload` 上传到本次新 S3 前缀 |
| `app.py` / `cdk.json` | 原生 EC2 / AgentCore 栈与 CloudFront 分发栈，新角色使用比赛权限边界 |
| `bootstrap.sh` | Ubuntu 安装 Python / Node / FFmpeg / Sharp / 字体、校验视频、启动 systemd |
| `gateway.py` | 临时测试登录、Host / Origin 检查、回环代理、S3 异步备份与状态 |
| `agent_main.py` | AgentCore HTTP 入口，读取任务证据、调用 Bedrock Qwen、写回 JSON 候选 |
| `test_gateway.py` | 登录会话和可信来源检查 |

从仓库根目录执行准备，使用带 boto3、aws-cdk-lib 的 Python 环境和已登录 `nba` profile。发布输出必须位于被忽略的 `tmp/`，其中含临时访问码与私有资源定位：

```powershell
python engineering/infra/ec2-workbench/prepare.py --output tmp/<new-release> --upload
```

设置 `HKS_DEPLOY_CONFIG` 指向生成的 `config.json`，在本目录执行 `cdk synth WorkbenchCore --strict --profile nba`、`cdk diff WorkbenchCore --profile nba`，检查后部署。EC2 完成后，将实际 `instanceId` / `privateDns` 写入本地配置，再检查并部署 `WorkbenchDelivery`。通过 Systems Manager 将实际 CloudFront origin 写入实例 `/etc/hks/gateway.json`。不要将这些具体资源 ID、访问码、Cookie 或凭据提交仓库。

CDK 不负责注册新域名；使用 AWS 提供的 CloudFront HTTPS 地址。临时访问码从当前发布输出的 `access-code.txt` 交给本聊天用户。工作台服务仅监听回环地址，网关仅接受本次 CloudFront 的来源；安全组回源规则须实查。

实际部署后还需将 CloudFront 创建的服务管理安全组 ID 写入本地配置 `cloudfrontSecurityGroup`，重新 diff / deploy `WorkbenchCore`，把初始 VPC CIDR 入站缩小到该安全组。修订代码包应上传新的对象名，再通过 `workbenchKey` 指定；本轮最终为 `workbench-v2.zip`，不覆盖原发布对象。更新 EC2 UserData 可能导致实例重启，工作台预读三段视频约需一分钟，待后端实际响应再登录验收。

首轮结果见[真实网页验收](../../docs/ec2-cloud-interaction-acceptance-20261007.md)。Gateway 当前请求体上限为 220 MiB，上传 multipart 的有效文件大小应略低于此；原界面仍保留本机 2 GB 文案，不能据其承诺云端上传上限。测试入口使用临时共享访问码，不是生产多用户账号系统。

当前线上首轮部署的备份是单机 EBS 保存后异步复制 S3，尚未启用换机恢复工具、多用户隔离、分布式队列或 GPU 推理；后续新增并演练的恢复工具见下节，真实验收结果以对应工程报告为准。直接运行清理命令前须核对资源确属该次发布，不能删除共用桶和官方素材。

## 更新已运行的工作台

`update_release.py --config tmp/<existing>/config.json --output tmp/<fresh-release> [--upload]` 复用既有部署的三样例和私有前缀，生成当前工程完整包与每文件 SHA 清单，不修改原配置 / 访问码、不重建 Agent；上传用新对象键、条件写入和完整回读。`test_update_release.py` 验证闭包与上传保护。

工具只负责打包和上传；应用时须先备份原代码和用户目录。本轮原位更新、保留样例库与 current 链接，详见[当前版本复验](../../docs/cloud-current-version-20261007.md)。部署包与远端备份证据留在忽略目录。

AgentCore ZIP 可以通过配置中的可选 `agentKey` 指向新不可变对象，保留默认旧路径兼容。`agent_main.py` 先绑定 HTTP 健康检查，首次有效任务再初始化 SDK；`test_agent_main.py` 验证无 SDK 导入时健康检查仍可响应。更新 Runtime 前仍须 strict synth / diff，确认资源变更范围，再部署并验证真实调用。

## 全量重建与状态恢复工具

| 文件 | 用途 |
| --- | --- |
| `prepare_rebuild.py` / `test_prepare_rebuild.py` | `build` 离线完整包、`discover` 只读重找基础环境、`upload` 条件上传及完整回读，重试只复用相同对象 |
| `state_archive.py` / `test_state_archive.py` | 唯一可变状态白名单、并发变化检测、SHA 核验、空目录恢复；网关异步备份共用此范围 |
| `relocate_state.py` / `test_relocate_state.py` | 在纯状态暂存目录迁移已知绝对路径字段，保持 metadata / 来源指纹与内容 |
| `restore_bootstrap.py` | 仅向刚解包的新 release 安装状态；拒绝既有状态冲突和链接目标，在启动前迁移 |

`app.py` 对重建配置检查 discovery 与一小时时效。`HKS_ALLOW_UNVERIFIED_CONFIG=1` 只允许专用离线 synth 演练，真实 deploy 必须移除。恢复包可选配置 `stateKey/stateSha256`，工作台包配置 `workbenchSha256`；bootstrap 在使用前校验，再恢复、chown、启动并核对实际样例库。默认网关 origin 仍为空，创建新 CloudFront 后须按计划绑定新域名并收紧安全组。

新网关备份纳入素材库配置及状态摘要；`artifacts/cloud-state.json` 是启动时写入的 PID / URL 摘要，活动 / 归档状态实际位于 `artifacts/cloud-imports/workspace.json`。异步备份不是一致性快照，账号重置前仍须完整快照并下载到本机。
