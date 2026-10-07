# 交接：AWS 云端调用自有 OpenRouter 多模态模型

- 日期 / 时区：2026-10-07 09:12，Asia/Singapore（UTC+8）。
- 成员：Linzeyu912。
- 任务 / Issue：用户授权以临时 key 和 50 新加坡元预算测试比赛云端调用 OpenRouter，并补充以此前调研的多模态模型为主；开放 Issue 列表为空。
- 分支：main。
- 提交：未提交、未推送。
- 状态：云端调用及清理复查完成；真实篮球质量和作品接入不在本轮完成范围。

## 本次完成

- [九模型多模态报告](../../environment/aws/openrouter-multimodal-connectivity-20261007.md)及[去标识化结果](../../environment/aws/openrouter-multimodal-connectivity-20261007.json)：9 项图片序列、5 项直接 MP4、2 项音频，共 16 项真实云端测试通过。
- [首轮纯文本报告](../../environment/aws/openrouter-cloud-connectivity-20261007.md)及[结果](../../environment/aws/openrouter-cloud-connectivity-20261007.json)：三个模型分别从本机和 AWS 调用通过，保留阶段费用小计。
- 更新 AWS 入口、Agent 研究入口、昨日多模态报告的后续实测链接及团队状态；没有修改作品代码、团队选型或赛事要求。
- AWS SSO 最初过期，用户完成重新登录后继续。通过 CDK 先后创建两个独立临时 AgentCore Runtime / IAM 角色，保持比赛指定权限边界；测试后停止会话、删除栈并逐项复查。

## 结论与依据

- 当前本队 `us-east-1` 的 AgentCore `PUBLIC` Runtime 可以调用自有 OpenRouter key；不需要修改 Bedrock 模型白名单。
- Gemini 3.8 Flash、Qwen3.8 Max-0902 / Omni Flash / 27B、GPT-6 Astra / 6.1 Sol、Claude Opus / Sonnet 5.5、Kimi K3 的图片序列测试均通过。五个声明视频输入的端点直接 MP4 调用通过；Gemini / Qwen Omni 的 MP3 音频输入通过。
- Qwen Max 使用实际目录中的日期版 ID；Qwen3.8-27B 的 OpenRouter 图像与视频路由已实测可用，补充昨日模型卡“托管待确认”的历史范围。
- 样例由本轮生成，可核对数字、编号与运动方向；没有传输真实比赛、赛事原片或个人材料，不把此结果写成篮球质量验收。
- 采集日 2026-10-07；官方来源 URL、模型 / provider / tokens / 耗时、逐项回答见报告和 JSON。

## 验证

- 两轮 CDK synth / diff、IAM 权限边界与无 key 模板检查通过；Runtime、endpoint 均 READY。
- 16 项多模态请求均 HTTP 200、请求 / 返回模型一致、finish_reason 为 stop、JSON 可解析且内容核对通过；两个会话停止请求均返回 HTTP 200。
- OpenRouter 总用量 **0.06015834 USD**，与六次文本及十六次多模态成功请求费用之和一致；其中多模态 0.05835209 USD。key `limit=50` 的官方单位为 USD，用户口头预算为 SGD，未改额度。AWS Runtime / S3 / Polly 账单费用未单独查询。
- 两个栈已删除，两个 Runtime 与临时角色查无；两个代码包和两个仅属于本轮的 CDK 模板资产 / 版本已清理，各测试前缀对象数为 0；没有产生需保留的探针日志。两份本地加密 key 副本均已删除。原 OpenRouter key 的注销由用户自行处理，未代操作。
- 临时探针语法检查与 6 秒合成 MP4 的 60 帧完整解码通过；共享资料已做新链接、JSON、敏感模式和 Git 空白检查。未运行无关作品 / 视频库测试。

## 阻塞与待确认

- API / 云端连通性测试无阻塞。
- 尚未验证真实篮球理解、遮挡身份、战术质量、长视频、并发、音画同步和作品完整链路；也没有取得新的赛事外部模型允许口径。

## 下一步

- 如继续做质量比较，按昨日研究方案确定可用于第三方评测的篮球样本和人工参照，统一帧输入与问题，再评价参与者、时间、事实和战术解释。
- 如接入作品，将 provider / base URL / model ID 放到后端配置，并单独完成凭据管理、视频抽帧与错误处理；本轮临时探针不是生产实现。

## 同步状态

- 开工前 main 工作区干净，`git pull --ff-only origin main` 后与远端一致；开工及完成时实际远端均为 `043d257bc86c3c442075d653e6ba29e3d84b07d2`。
- 本轮共享文件留在本地 main，未收到单独的提交 / 发布要求，未提交或推送；没有创建任务分支或 PR。
- 私有元数据、临时脚本与输入仅在被忽略的 `tmp/openrouter-cloud-check-20261007/`、`tmp/openrouter-multimodal-check-20261007/`。密钥正文没有进入代码、模板或共享报告。
