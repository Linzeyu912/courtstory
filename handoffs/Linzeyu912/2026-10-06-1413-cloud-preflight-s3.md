# 交接：云端运行预检与官方训练片上传

- 日期 / 时区：2026-10-06 14:13，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户要求按官方要求部署 Agent、上传数据到 S3 并运行；开放 Issue 为空。
- 分支：main。
- 提交：本轮未提交 / 未推送。
- 状态：素材上传与预检完成；应用部署 / 运行待完成，已向用户询问具体 Agent 范围。

## 本次完成

- [赛事要求复核](../../requirements/aws-runtime-clarification-20261006.md)：实读 Quick Start，澄清 AgentCore 强制、EC2 可选和 SageMaker GPU 申请路径。
- [工程记录](../../engineering/docs/aws-cloud-preflight-20261006.md)：保留账号、云资源、模型可用性与代码适配点，以及数据对象相对键。
- [上传脚本](../../engineering/scripts/upload_official_training.py)：本地 manifest / 哈希预检、团队身份及桶检查、条件写入、远端完整 SHA-256 核验。
- 两段原训练片共 171,215,644 字节及 1,096 字节 manifest 已实际上传本队私有桶，均校验通过。完整云端响应保存在忽略路径 `tmp/aws-training-upload-20261006/report.json`。
- 更新 requirements、engineering 及工程文档 / 脚本入口；团队状态补充本轮记录。保留其他会话修改。

## 结论与依据

- 来源为 2026-10-06 浏览器实读 [Quick Start](https://csdn.feishu.cn/docx/Y21TdJqrHopofmx2w21cmqHLnLb)、[终极指南](https://csdn.feishu.cn/wiki/B3NSwj16GiSCR7kcM5vc9RjMnQb)与本队 CLI 实测。
- `nba-sso` 是共享入口；`nba` 才是本队 ParticipantRole。部署要使用 `nba` / us-east-1。
- 当前无 EC2、Runtime 或 CloudFront 应用。已上传素材不等于已经运行 Agent；本轮无模型推理、计算实例创建或赛事提交。
- 另一会话同时新增[CDK 补充通知](../../requirements/cdk-deployment-notice-20261006.md)，已阅读，不修改其原文。后续不运行 bootstrap，CDK 必须带官方权限边界。

## 验证

- 两段源文件长度 / SHA-256 与原 manifest 一致。
- S3 PutObject 校验和 + HeadObject 长度 / SHA-256 / 元数据全部通过，AES256，加版本 ID。
- Python 编译检查通过；165 段视频 / LFS 索引检查通过。
- 第二次运行复用全部三个对象，`created=false`，版本 ID 保持一致，无覆盖或新增版本。
- 新增文档 / 入口链接及差异空白检查通过；status 中两条失效链接已在 HEAD 存在，保留并在工程记录说明。没有重跑与本次无关的 Agent / 渲染业务测试。

## 阻塞与待确认

- 已询问部署对象：整个工作台、战术 Agent 或 Qwen 地面轨迹 Agent；本记录时尚未收到答复。现有入口的依赖和运行方式不同，需要明确后执行相应适配及创建计算资源。
- 官方指标、赛事统一输入输出完整契约仍未补齐。Docker Linux 引擎未运行，当前 Python 缺少 AgentCore / boto3 依赖；尚未选择或安装构建路线。

## 下一步

1. 确认部署对象后，做对应 AgentCore / Bedrock 适配和 CDK 工程；EC2 如采用，仅承担选定的视频处理 / 后端职责。
2. 引用本轮 S3 manifest 和预置桶，配置官方 IAM 权限边界，synth / diff 检查后部署。
3. 用一段官方片实际调用 Agent，核对云端输出与 CloudFront 访问；不依赖本机服务，不把固定视频展示当任务成功。

## 同步状态

开工 fetch 后本地 HEAD 与 origin/main 均为 `be5c43d17c78f04b4df55eda38aa6f82fde8f803`。既有研究 / 状态改动和同时新增 CDK 文档保持原状；本轮无 Git 提交或推送。S3 三个对象已在本队云端，其余新脚本及文档仍在本地。
