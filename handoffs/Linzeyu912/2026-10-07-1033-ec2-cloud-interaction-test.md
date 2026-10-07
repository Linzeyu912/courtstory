# 交接：EC2 直接代码部署与 CloudFront 网页实测

- 日期 / 时区：2026-10-07 10:33，Asia/Singapore（UTC+8）
- 成员：Linzeyu912
- 任务 / Issue：本聊天用户要求；开始时开放 Issue 为空，没有代分配队友
- 分支：main
- 提交：本轮未提交 / 未推送；完成时再次核对本地 HEAD 与实际远端 main，均为 `043d257bc86c3c442075d653e6ba29e3d84b07d2`
- 状态：本轮部署与交互验收已完成；生产化与 GPU 未完成

## 本次完成

- [拆分与上传设计](../../engineering/docs/ec2-code-deployment-plan-20261007.md)：EC2、AgentCore ZIP、S3、CloudFront，暂不自建容器。
- [部署工程](../../engineering/infra/ec2-workbench/README.md)：两段 CDK 栈、打包清单、Ubuntu / systemd、认证网关及 S3 异步备份、AgentCore HTTP 入口。
- [云端执行适配器](../../engineering/scripts/cloud_tactics_agent.py)：既有战术 Agent 可选使用 EC2 实例角色调用 AgentCore，保留来源和 schema 校验。
- [真实网页验收](../../engineering/docs/ec2-cloud-interaction-acceptance-20261007.md)及结构化结果：从网页操作到 MP4 下载，再与 S3 回读核对。
- 更新工程目录入口和团队状态；保留 UI / UX、OpenRouter 等其他任务已有修改。

## 结论与依据

- CloudFront 已能打开当前工作台；005 视频可播放 / 上传、编辑 / 保存、调用 Agent、采用候选并导出。最终版本 3 有 3 图形 / 1 暂停点。
- 最终 MP4 为 1920×1080、218 帧、7.266667 秒、静音，浏览器下载与 S3 备份哈希一致。网页仍由 EC2 托管，S3 是资料、任务和异步备份层。
- AgentCore Python ZIP 路线及 VPC origin 官方来源在报告中列明，采集于 2026-10-07。模型为本队许可 Bedrock Qwen，不涉及本轮外部模型选型。
- 两个专属测试栈和 EC2 保持运行以供用户访问。具体资源定位、网址、访问码仅在本聊天和被忽略的 `tmp/ec2-workbench-20261007/`；不提交凭据。

## 验证

- 6 个网关、3 个适配器、18 个原战术 Agent 测试通过；Python 编译、CDK strict synth / diff、S3 发布包回读与隔离启动检查通过。
- 真实浏览器完成视频播放、上传去重、人工画布、保存 / 服务端重读、两次渲染下载、Agent 生成 / 预览 / 采用。
- S3 草稿与服务端文档相等；两个版本 MP4 下载回读哈希一致，218 帧完整解码通过。
- 完成时 `git diff --check` 通过，8 份本轮工程文档的相对文件链接检查无缺失；没有覆盖其他任务已有修改。
- 初始包依赖遗漏、Ubuntu awscli 安装及回源 / 重启过渡问题均记录在报告中，不隐去早期失败。

## 阻塞与待确认

- 今天指定的网页串联测试无未解决阻塞；GPU、模型质量、生产账号、换机恢复与正式评委展示页未验收。
- manual 素材缺少采用后的 2D 数据时，选区 Agent 按原规则拒绝；当前阶段模式已成功。不能放宽证据校验来使选区按钮通过。
- 原界面的本机措辞和 2 GB 上传文案待调整；本次网关请求上限为 220 MiB。
- 用户本轮未要求提交 / 推送；未触碰其他任务修改，未新建分支 / PR。

## 下一步

- 用户通过本聊天给出的 CloudFront 链接和本地访问码文件亲自验收。
- 根据用户安排完善云端文案 / 上传限制、评估模型输出、接 SageMaker GPU；不把这些计划写成完成。
- 若继续发布 Git，按用户明确授权选择性提交当前任务文件，直接推送 main；不要把 tmp、访问码、Cookie 或服务器资源定位加入索引。
- 若结束云端测试，核对专属栈和版本前缀后再清理；保留本队共用桶和官方素材。
