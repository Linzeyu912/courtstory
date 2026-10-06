# 交接：19 项 AWS 服务真实可用性测试

- 日期 / 时区：2026-10-06 20:32，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：用户要求实测所列 19 项 AWS 服务哪些可以用、哪些受限；开工查询仓库开放 Issue 列表为空，未新增分工。
- 分支：main
- 提交：未提交、未推送
- 状态：功能测试与临时资源清理完成

## 本次完成

- [逐项报告](../../environment/aws/services-live-audit-20261006.md)：18 项基本功能通过，MediaLive 输入创建通过、开播未测。
- [去标识化证据](../../environment/aws/services-live-audit-20261006.json)：真实返回结果、关键配额、日志标记及清理状态。
- 更新 [AWS 入口](../../environment/aws/README.md)和[团队状态](../../docs/status.md)。没有修改作品代码或持久部署工程。
- 19 项只读 API、IAM 策略和关键配额已复查；随后以 CDK 创建 6 个独立临时栈，所有新角色均带指定边界，未 bootstrap。
- 实际完成 AgentCore 回显、Qwen 推理、Rekognition OCR、Polly → S3 → Transcribe、Translate、Lambda、ECS / Batch 短任务、EC2 启动脚本、MediaConvert 转码、CloudFront HTTPS 访问、DynamoDB 读写删除及三条消息路径、Step Functions 执行。
- 私有脚本、原始 API 输出和模板仅在被忽略的 `tmp/aws-services-audit-20261006/`，不入共享资料。

## 结论与依据

- 没有发现整项服务被禁用的证据；不能把列表可读或配额非零等同于任意业务能运行。
- Bedrock 白名单仅含 Qwen3-VL-235B-A22B 和指定 Sonnet 4.6；Qwen 成功，Sonnet agreement 仍 `NOT_AVAILABLE`，未接受协议或实际调用。
- EC2 CPU 标准按需 256 vCPU，G/VT 和 P 按需 GPU 配额为 0；与 SageMaker GPU 配额分开理解。
- AgentCore 既有 Runtime 数量为 0 与“配额为 0”不同；本轮 Total Agents 配额 500，并实际创建调用成功。
- EC2 首次失败是 us-east-1e 不支持 t3.micro；通过机型提供 API 选择 us-east-1b 后成功，没有把配置问题判为服务禁用。
- 采集日 2026-10-06；来源包括本队真实 API、[CDK 通知](../../requirements/cdk-deployment-notice-20261006.md)和报告中列出的 AWS 官方文档。

## 验证

- 临时 CDK 工程 synth / diff 通过，新 IAM 角色无缺失权限边界；实际部署和各项结果见报告。
- ECS、Batch 均退出码 0 且日志有 `SERVICE_OK`；转码输出本机完整解码退出码 0；CloudFront 返回 HTTP 200 且内容匹配；EC2 控制台有启动脚本标记。
- 六个临时栈已删除；另查 EC2 terminated、AgentCore / CloudFront 不存在、六个新 IAM 角色不存在、MediaLive 输入为 DELETED。S3 合成数据与版本、七份独有 CDK 模板、Transcribe 作业及测试日志已清理；服务执行历史按 AWS 机制保留。
- 报告链接、证据数量和脱敏扫描通过，`git diff --check` 无空白错误；没有为文档运行无关作品测试。

## 阻塞与待确认

- MediaLive 尚未启动直播频道，不能宣称开播链路已接通。
- Sonnet 4.6 的协议需由账号管理员确认；不自动开通第三方协议。
- AWS Core 插件连接失效；现有本机 SSO SDK 登录可用，本轮使用后者完成。没有重新配置凭据。

## 下一步

- 作品工程按实际需求选择已验证服务，避免把全部服务列为必须使用。
- 如确实需要直播，再单独验证 MediaLive 频道与输出；如需 Sonnet，先确认协议状态。
- 比赛提交网页和完整应用仍需独立实现、部署和验收；临时 CloudFront 探针不是可提交作品。

## 同步状态

- 开工已 fetch，HEAD 与 origin/main 均为 `be5c43d17c78f04b4df55eda38aa6f82fde8f803`。已有大量其他任务未提交文件，保留原样，没有切分支、重置或混合提交。
- 本轮报告与入口更新仅在本地，未提交、未推送；不声称云端仓库已包含这些结论。
