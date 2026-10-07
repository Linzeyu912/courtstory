# CloudFront 工作台网页实测：EC2、AgentCore 与 S3

日期：2026-10-07 10:33，Asia/Singapore（UTC+8）。范围来自本聊天用户：通过 CloudFront 打开已有前端并操作，验证拆分后的云服务已经串联；不用自建容器。本记录是作品工作台的真实交互验收，不是服务独立探针，也不是正式赛事提交。

## 1. 结论与部署边界

本轮通过：HTTPS 登录与现有前端加载、005 视频播放、网页上传入口、人工画布编辑、服务端保存 / 重读、CPU 成片播放 / 下载、网页调用 AgentCore 并采用候选，以及最终草稿 / MP4 的 S3 备份校验。

实际拆分为 **CloudFront → EC2 登录网关 → EC2 工作台 / CPU 渲染**，战术分析走 **EC2 → S3 → AgentCore → Bedrock Qwen → S3 → EC2 → 网页**。网页和 API 仍在同一个 EC2 发布包；没有将静态前端独立托管到 S3。详细职责、图示和上传目录见[拆分方案](ec2-code-deployment-plan-20261007.md)，代码见[部署工程](../infra/ec2-workbench/README.md)。

- us-east-1 原生 Ubuntu 24.04 EC2：t3.large、40 GiB 加密 gp3，systemd 管理工作台和网关；Python / Node / Sharp / FFmpeg，无 Docker / ECS / ECR。
- AgentCore：Python 3.12 ZIP Runtime 与 DEFAULT 端点 READY，EC2 实例角色签名调用；模型 `qwen.qwen3-vl-235b-a22b`。
- CloudFront：分发与 VPC origin 均 Deployed，统一 HTTPS，转发 Cookie / 查询参数 / Range，请求使用禁用缓存策略。
- S3：沿用本队私有桶，本次独立版本前缀。工作台先写 EBS，再按 10 秒扫描异步备份；不是 S3 原生存储后端。
- SageMaker GPU 未启动。OCR、身份 Agent、地面轨迹 Agent 的其他 provider 未因本轮战术 Agent 适配而迁移。

两个 CloudFormation 栈分别完成 CREATE_COMPLETE、后续核心栈 UPDATE_COMPLETE。临时测试资源继续运行以供本聊天用户访问；EC2 / EBS / CloudFront / S3 与模型调用产生实际使用量，本轮没有给出未经账单核验的费用估计。

## 2. 实际浏览器操作与证据

所有图形、暂停点、Agent 生成 / 采用、保存和渲染请求均从 CloudFront 网页的真实控件发起；没有通过接口注入验收草稿。

| 操作 | 实际结果 |
| --- | --- |
| 未登录打开工作台 | 重定向临时访问码登录页；登录后加载现有“球场数据工作台” |
| 前端 / 素材 | 三段登记样例出现在选择器；实际播放 005，浏览器媒体 readyState 4、宽 1920、时长 4.766667 秒。未将另外两片列为逐项浏览器播放通过 |
| 网页上传 | 用“打开视频，人工制作”上传 005，4,316,630 字节；服务端报告与已有内容相同并去重，然后建立 manual 入口。验证了上传请求与导入流程，不是不同素材或大文件压力测试 |
| 人工编辑 | 建立空画布，在 0.500 秒新增额外停留 2.5 秒的讲解暂停点；设置 0.500–3.000 秒区间，通过两次实际画面点击绘制一条路线 |
| 保存 / 重读 | 保存版本 1；刷新后恢复，再用“重新读取已保存版本”读取。独立只读 API 证实服务端有 1 图形 / 1 暂停点，避免只以浏览器缓存作为保存证据 |
| 人工成片 | “成片效果预览”自动保存版本 2，真实生成、播放、下载 1920×1080 / 218 帧 / 7.266667 秒静音 MP4 |
| Agent 选区前置检查 | manual 素材未采用 2D 准备版本，选区模式正确拒绝并提示；没有放宽校验以绕过要求 |
| Agent 当前阶段 | 从页面选择“当前阶段，追加初稿”，输入目标并生成；真实调用云端模型，候选通过既有帧范围、坐标、来源绑定校验，显示预览和采用按钮 |
| 候选采用 | 仅在本次验收草稿采用 2 个建议图形，原人工路线保留，共 3 图形、1 暂停点；不等于人工确认了篮球解释和坐标准确性 |
| 最终成片 | 再次通过页面生成，自动保存版本 3；最终 MP4 同为 1920×1080 / 218 帧 / 7.266667 秒，浏览器播放与下载成功 |
| S3 备份 | 最终草稿与 API 返回 document 深度比较一致；S3 下载的最终 MP4 与浏览器下载逐字节 SHA-256 一致，完整解码通过 |
| 浏览器错误 | 最终页面控制台 error 查询为空；早期部署故障及修复另记于下节，不把整轮过程写成从未失败 |

最终成片 3,907,340 字节，SHA-256：`f7c647bcd963f0debf866128563b74dc11f09427aaf4a7cec29cdd2e1b8f6ca6`。解码 218 帧、无音轨；4.766667 秒原片加 2.5 秒暂停得到 7.266667 秒，符合本次制作设置。原人工版本 2 成片也已独立验证，其 SHA-256 为 `c820f20fcc2b7deffc3e612706a284d804124789962e6466a21b24ba5091d11e`。

本机原始证据位于被忽略的 `tmp/ec2-workbench-20261007/`：`cloud-acceptance-evidence.json`、`output-verification.json`、`mp4-final-decode.json`、`saved-cloud-draft.json`、`browser-final-result.jpg`、CDK 输出和日志。访问网址、资源定位、临时访问码和 Cookie 不写入共享文档。去标识化摘要见[结构化结果](ec2-cloud-interaction-acceptance-20261007.json)。

## 3. 发布闭包、修复与访问边界

初次启动遇到 Ubuntu apt 没有 `awscli` 安装候选，改用 boto3 下载发布包。随后发现打包清单漏掉跟踪 `.meta.json` 配套文件和 `engineering/configs/`，补齐并修正 `prepare.py`。本轮 EC2 先应用两次小补丁，最终完整包发布为新的 `workbench-v2.zip`，UserData 也更新为该对象，保留原始包。

完整包含 323 个源文件，4,691,061 字节，SHA-256 `5e843e5f0d30231ace011032845b64866118d3280a29d7aab1e695d0af0d2299`，S3 下载回读一致。隔离解包的工作台启动检查通过。Agent ZIP、005 素材及原有两段官方素材也完成对应上传或源 SHA 校验；没有上传开发机虚拟环境和凭据。

CloudFront 首次页面访问出现 504。在将 8080 入站从初始 VPC CIDR 收紧到 CloudFront 服务管理安全组、完成 EC2 UserData 更新及重启后，入口恢复。后端预读视频期间短暂返回 ConnectionRefusedError；约一分钟后实际工作台就绪，再执行上述完整验收。记录的是观察到的恢复过程，不把 504 唯一归因于某个未经抓包证实的因素。

实际安全组最终只允许 CloudFront 管理安全组访问 TCP 8080，没有公网 CIDR 入站或 SSH；工作台本身仍仅监听 `127.0.0.1:8876`。网关先校验准确 Host / Origin 和 Secure / HttpOnly / SameSite 会话 Cookie，再向回环工作台转发。只读实测：未登录访问 API 重定向登录页；已登录请求带错误 Origin 返回 403。这里是规则核验，未宣称做过全面渗透测试。

本地验证：6 个网关来源 / 会话测试、3 个云端适配器测试、18 个原战术 Agent 测试全部通过；Python 编译检查、核心 / 分发 CDK strict synth 与部署前 diff 完成。保留赛事 IAM 权限边界，复用已有 bootstrap，没有创建任务分支或 PR。

## 4. 尚未通过或未覆盖

- 篮球理解、球员身份、精确路线和示意镜头未做人工质量验收；模型输出 2 个建议图形并不证明内容无重复或完全正确。
- GPU 检测 / 跟踪、OCR、身份 Agent、地面轨迹 Agent、完整赛事评测接口和正式评委展示页不在本次通过范围。
- 测试入口使用临时共享访问码，无多用户隔离；保存仍依赖单台 EC2 的 EBS，备份异步，无换机自动恢复或分布式任务恢复。
- 原前端仍有“本地”“保存到本机”等本机版措辞和服务器目录展示。云端上传网关限制为请求体 220 MiB，实际文件须略小；原界面 2 GB 文案不适用于本次网关。
- 所有资源经 EC2 回源且关闭 CDN 缓存，是首轮验证配置；静态资源独立 S3 回源、缓存策略、性能 / 并发 / 大文件和零停机发布尚未验收。
- 代码、报告和交接目前只在本地 `main` 工作区，未提交 / 推送。云端已经部署与 Git 已同步是两个不同状态。

## 5. 来源与后续

AWS 文档采集日期 2026-10-07：[AgentCore Python 直接代码部署](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-python.html)、[HTTP 契约](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html)、[CloudFront VPC origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)。服务行为以本轮实际部署和 API / 浏览器记录补充验证；赛事要求仍按[既有来源整理](../../requirements/aws-runtime-clarification-20261006.md)，没有从本次测试推导新的官方要求。

下一步优先让用户从 CloudFront 入口亲自操作，再根据实际需求分别处理云端文案 / 上传限制、模型质量和 GPU 作业；是否继续常驻、修改规模或清理本轮资源，应按用户后续安排执行。清理须核对两个专属栈及前缀，不能删除共用 S3 桶、bootstrap 或原有官方素材。
