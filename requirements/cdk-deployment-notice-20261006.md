# CDK 部署补充通知与解释

采集日期：2026-10-06，Asia/Shanghai。赛事来源为用户在本次聊天转发、标为官方的通知；原通知发布日期、发布渠道 URL 未提供，本轮未独立访问主办方原帖。以下赛事约束按该转发记录，AWS 通用机制另列官方文档来源。

## 转发通知原文

```text
关于CDK（云开发工具包），给参赛队的说明：

为更便于参赛队使用cdk来进行自动化部署，主办方已提前完成 CDK bootstrap（us-east-1）。
请不要执行 cdk bootstrap，执行会失败，也不需要。直接用 cdk deploy 部署即可。

唯一的要求：
在项目的 cdk.json 里加上下面这段配置。CDK 会自动给你的 Lambda、ECS 等创建的 IAM 角色加上权限边界，不加的话，凡是创建 IAM 角色的部署都会失败（报 iam:CreateRole AccessDenied）。

{
  "context": {
    "@aws-cdk/core:permissionsBoundary": { "name": "NBAHackathonParticipantBoundary" }
  }
}

其他注意事项：
- 资源只能部署在 us-east-1。
- 用 SSO 登录拿到的凭证执行 CDK。
- 如果不是很理解，可以把上面的描述交给你的ai coding agent。
```

原文按用户提供的文字转录，仅整理空行、缩进。通知所说的“唯一的要求”指这里的 CDK 配置补充，不替代其他赛事交付要求。

## 对我们意味着什么

| 通知内容 | 解释与操作含义 |
| --- | --- |
| CDK | 用代码描述所需云资源，再经 CloudFormation 创建或更新。需要先有可部署的应用和 CDK 工程。 |
| 已完成 bootstrap | 主办方已准备部署所需的基础资源；不是已替本队部署工作台。本队不执行 `cdk bootstrap`，包括通用教程或报错提示中的重做步骤。 |
| IAM 角色 | 云端程序使用的身份，例如让渲染程序读取视频、保存成片或写日志。Lambda / ECS 是通知举例，不表示必须同时使用它们。 |
| 权限边界 | 主办方指定的权限上限。该配置引用名为 `NBAHackathonParticipantBoundary` 的策略，供 CDK 新建角色时使用；它本身不授予应用访问 S3 / Bedrock 等业务权限。 |
| 缺少边界会失败 | 按通知，创建角色必须附带指定边界。即使没有手写角色，CDK 服务构件也可能自动新建角色，从而触发 `iam:CreateRole AccessDenied`。这不是所有 AccessDenied 的唯一原因。 |
| us-east-1 + SSO | 应用部署到赛事指定区域，使用赛事 SSO 身份链取得的临时凭证。仓库既有配置为 `nba-sso` 登录、`nba` 执行；SSO 自身的 `us-west-2` 与资源区域用途不同。 |

把通知里的配置**合并到实际 CDK 工程的 `cdk.json`**：已有 `context` 时只增加其中的键，保留原有 `app` 和其他设置，不能整份覆盖、重复添加 `context`，也不要放进 `package.json` 或用户级 AWS config。

## 后续工程接续建议

以下为工程建议，不是本轮已经执行的部署：

1. 先完成应用打包、云端接口适配及 CDK 工程。当前仓库未找到 `cdk.json`，不能只新增上述片段就称为部署就绪。
2. 在 CDK Stack 的目标环境设置 `us-east-1`，加入上述边界配置。使用 `aws sso login --profile nba-sso` 登录，再用 `aws sts get-caller-identity --profile nba --region us-east-1` 核对本队角色。
3. 在实际 CDK 工程目录运行 `cdk synth --profile nba` 和 `cdk diff --profile nba`；检查生成模板中的 `AWS::IAM::Role` 是否带有指向指定策略的 `PermissionsBoundary`，特别留意低层构件、第三方构件及自定义资源。
4. 核对模板、区域与变更后，在实际部署任务授权范围内运行 `cdk deploy --profile nba`。本轮仅解释通知，没有运行这些 AWS / CDK 命令。

新增配置只满足指定的角色创建条件，不保证所有服务、配额、业务权限或打包步骤都已就绪。通知没有给出该边界策略的完整允许清单，本轮也没有读取云端策略正文。

## 依据与已有记录

以下 AWS 网页均于 2026-10-06 查阅，说明通用机制，不能独立证明赛事账号当前配置：

- [AWS CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)：初始化准备部署用的 S3、ECR 和 IAM 等资源。
- [CDK IAM 库：Bootstrap Permissions Boundary](https://docs.aws.amazon.com/cdk/api/v2/python/aws_cdk.aws_iam/README.html#bootstrap-permissions-boundary)：核对 `cdk.json` 中的确切配置键及应用级边界机制。
- [IAM permissions boundaries](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)：边界限制基于身份策略可授予的权限，自身不授权。
- [10 月 5 日只读盘点](../handoffs/Linzeyu912/2026-10-05-2148-aws-readiness-inventory.md)：此前已确认 CDKToolkit 和资产桶存在；此为历史实测，本轮未再次查询云资源。
- 当前接续入口：[AWS 环境](../environment/aws/README.md)、[工作台上云说明](../engineering/docs/aws-workbench-deployment-guide.md)。
