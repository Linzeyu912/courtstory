# 云端运行准备与官方训练片 S3 上传

日期：2026-10-06 14:13，Asia/Shanghai。用户提出按官方要求部署 Agent、把数据上传到 S3 并运行。**本轮完成账号与代码预检、两段官方训练片上传；应用部署与真实 Agent 运行尚未完成。** 部署对象待用户明确是整个工作台、战术 Agent 还是 Qwen 地面轨迹 Agent；已在聊天中提出范围问题。

## 已实测完成

- 使用 `nba-sso` 登录后，`nba` 通过角色链进入本队 `NBAHackathonParticipantRole`。前者属于共享 SSO 入口，部署使用后者；不能仅凭 `nba-sso` 身份查询成功就把它当作应用部署账号。
- 本队预置 S3 桶位于 us-east-1，上传前对象数为 0，四项阻止公开访问设置均为 true，默认 AES256 加密。本轮没有改桶策略、ACL 或公开性。
- 两段 [官方训练片](../../data/videos/uploads/2026-10-05-official-training/README.md)共 171,215,644 字节，上传前核对源 manifest 的大小与 SHA-256。上传使用带 SHA-256 的单次 PutObject，并设置 `If-None-Match: *` 拒绝覆盖。
- 两段视频和一份云端 manifest 均通过 HeadObject 的长度、服务端 SHA-256 和元数据校验；均为 AES256 加密且有对象版本 ID。没有调用模型，也没有把标签或自动跟踪候选冒充官方指标上传。
- 当前区域未发现 EC2 实例、AgentCore Runtime 或 CloudFront 分发。CDKToolkit 为 UPDATE_COMPLETE，bootstrap 版本 32；本轮未重新 bootstrap。
- EC2 标准按需实例配额查询为 256 vCPU；这是上限查询，不表示已经创建、某种实例必有容量或允许运行 GPU。Bedrock Qwen3-VL 可用性接口返回四项 AVAILABLE / AUTHORIZED；本轮没有发出模型推理请求。

完整桶名、版本 ID、检查时间保存在被忽略的 `tmp/aws-training-upload-20261006/report.json`，不放入共享文档。数据对象已在云端，本轮代码和文档尚未提交或推送。

## 云端对象与复跑

对象位于本队桶的 `workbench/datasets/broadcastcode-training-20261005/` 前缀，路径为：

| 对象 | 相对该前缀的对象键 | 字节 |
| --- | --- | ---: |
| 官方训练 001 | `001/9c3e4606d04e7f79e29a112952fcf069ebab202af207af500bfbc3338bc079ce/video.mp4` | 83,907,519 |
| 官方训练 002 | `002/7ec745f5f1e75b0c6d6dd27d409875f67c2ac3ab76c73f7123794c96be5aee22/video.mp4` | 87,308,125 |
| 清单 | `manifests/8fb35608fd5c1cce69b9e19eca43acba9f003925404efdc700fde3c152472b62.json` | 1,096 |

清单保存片段 ID、仓库相对路径、源 URL、对象键、大小和 SHA-256；不含凭据、绝对本机路径或账号 ID。视频保留原字节和原音轨。

新增 [上传脚本](../scripts/upload_official_training.py)从原 manifest 读取这两片。先校验全部本地文件，再执行云端操作；只允许当前参赛角色账号下的 Team25 专属桶和 us-east-1，检查桶仍阻止公开访问。已存在对象必须校验一致才复用，不覆盖、不删除、不开公共访问。

从仓库根目录运行（将桶名替换为本队 Portal / CLI 核实的实际值）：

```powershell
python -X utf8 engineering/scripts/upload_official_training.py --bucket <team-bucket>
python -X utf8 engineering/scripts/upload_official_training.py --bucket <team-bucket> --upload
```

首条命令只输出本地校验及上传计划；第二条使用既有 `nba` profile 上传和核验，默认报告在被忽略的 `tmp/aws-training-upload/report.json`。脚本只使用 AWS CLI 的身份链，不读取或复制凭据文件。

## 部署仍需完成的工作

依据 [官方要求复核](../../requirements/aws-runtime-clarification-20261006.md)，拟议运行职责如下；这是待实现工程，不是已上线架构：

- S3 保存输入和结果；AgentCore 承载实际 Agent 逻辑，调用赛事允许的模型及处理工具。
- 用户若保留 EC2 路线，可让 CPU EC2 承担应用后端、取帧和 FFmpeg 等视频任务。仅复制 Agent 到 EC2 不能代替 AgentCore。
- CloudFront 提供 Web 交互和结果入口；所有新建资源通过 CDK 管理，引用预置桶和官方权限边界，不执行 bootstrap。

已核实的代码适配点：

1. `engineering/scripts/tactics_agent.py` 依赖本机 Codex CLI；`agents/qwen-provider.mjs` 使用阿里云端点及 QWEN_KEY。必须先选定实际部署入口，再适配云端模型/工具调用；不能只更改模型名。
2. 工作台服务监听 127.0.0.1，多个写接口校验本机 Host / Origin。公开发布需要正式反向代理和访问控制，不能直接删除这些保护。
3. 自动检测路径仍依赖 CUDA；CPU 渲染与 GPU 模型推理是两回事。SageMaker GPU 申请路径存在但尚未实测，不预设可用。
4. 当前 Python 环境未安装 boto3 / bedrock-agentcore，Docker CLI 存在但 Linux 引擎未启动。采用容器路线时需准备相应构建环境；本轮上传脚本不依赖这些工具。
5. 训练 ZIP 只有视频，没有独立官方指标表。输入输出契约和视频事件对应数据仍需补齐，不生成虚构官方指标。

## 验证与同步

- 上传脚本 Python 语法检查、两片源哈希与远端对象校验通过。
- 第二次执行上传脚本只核验并复用三个对象，`created=false`，版本 ID 与首轮一致，没有覆盖或新增版本；记录在 `tmp/aws-training-upload-20261006/recheck.json`。
- `python scripts/validate_video_data.py --check-index` 通过：9 批、165 段、165 个文件哈希及 165 个 LFS 索引。
- 新增文档及新增入口的相对链接、`git diff --check` 通过。全量检查 `docs/status.md` 时发现两条 HEAD 已有的历史失效链接（战术分析实验台及其 10 月 3 日交接），本轮保留，未据此声称全仓链接检查通过。
- 开工时 fetch 成功，HEAD 与 origin/main 均为 `be5c43d17c78f04b4df55eda38aa6f82fde8f803`；GitHub 开放 Issue 为空，未分配负责人。
- 保留既有未提交研究，以及工作期间另一会话新增的 CDK 边界通知和文档修改。本任务未提交、未推送、未创建分支或 PR、未提交赛事作品。

API 行为参考：[AWS CLI PutObject](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3api/put-object.html)，2026-10-06 查阅；赛事要求以上述赛事来源为准。
