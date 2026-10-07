# 交接：既有 EC2 安装 Codex CLI

- 日期 / 时区：2026-10-07 22:16，Asia/Singapore（UTC+8）。
- 成员：Linzeyu912。
- 任务 / Issue：本聊天用户要求先查官方材料，再本机下载 Codex CLI、传到既有云服务器安装并登录账号；远端开放 Issue 查询为空，无对应认领记录。
- 分支：main。
- 提交：本轮未提交、未推送。
- 状态：服务器安装完成；设备码登录已启动，待用户账号授权及最小调用验证。

## 本次完成

- 新增[环境记录](../../environment/aws/codex-cli-ec2-20261007.md)，更新[环境入口](../../environment/README.md)与[AWS 入口](../../environment/aws/README.md)。
- 读取官方 CLI / 认证文档；下载 Linux x64 standalone `0.160.1` 包到本机忽略目录，校验官方摘要后上传既有私有 S3 新版本路径。
- 通过现有 SSM 通道、实例角色下载并复核摘要，安装到 `ubuntu` 用户目录，准备 `~/codex-workspace/`。
- 以 `ubuntu` 发起设备码登录；一次性验证码只在当前聊天及忽略目录中，不写入仓库。

## 结论与依据

- [官方 CLI 文档](https://learn.chatgpt.com/docs/cli)支持 Linux；[认证文档](https://learn.chatgpt.com/docs/auth)支持 ChatGPT 账号和无头设备码登录，采集日期 2026-10-07。
- 安装包 160,785,122 字节，本机、官方发布清单与服务器 SHA-256 一致，详见环境记录。
- 这是服务器开发工具准备；未改变工作台模型 provider、赛事运行架构或已有服务配置。

## 验证

- AWS SSO 刷新成功，STS 身份为本队角色；SSM Online，Ubuntu 24.04 x86_64。
- S3 HEAD 校验大小与 AES256；服务器 `sha256sum -c` 成功。
- 普通用户 `codex --version` 返回 `codex-cli 0.160.1`，登录 shell PATH 已生效。
- 安装前后 `hks-workbench` 与 `hks-gateway` 均 active。
- 设备码登录成功生成入口；账号授权和真实推理仍待验证。

## 阻塞与待确认

- 等待用户在官方设备码页面授权 ChatGPT 账号。无账号令牌被复制、读取或写入共享资料。
- ChatGPT 首页探测返回 403，而认证发现接口返回 200；须用实际 CLI 调用确认推理链路，不能根据首页探测下结论。

## 下一步

- 用户授权后，以 `ubuntu` 执行 `codex login status`，再在空工作目录做无业务数据的最小调用并更新结果。
- 设备码如过期，重新执行 `codex login --device-auth`；不得复用旧码。

## 同步状态

- 已 fetch 远端：本机 `0d29df0f1adc1e64659d48b49b4e6c9dd880ffbd`，`origin/main` 为 `9e18beed87e30fdaa2c8c1081c1ed19b89ce0e55`，落后 2 个提交。
- 工作区已有多项其他任务未提交修改，且与远端变更交叠，未拉取覆盖、未 stash、未创建分支或 PR。保留原改动，本轮仅追加环境记录与独立交接；云端安装已实际完成，仓库文档仍在本地。
