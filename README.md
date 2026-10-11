# CourtStory

**By viewers. For viewers.**

**由观众打造，为观众打造。**

CourtStory 是一个由篮球观众打造、面向篮球观众的 AI 篮球解读项目。我们从观看比赛时的真实疑问出发，希望让场上的配合与变化更容易理解，让每个回合都看得懂。

## 两个部署版本

本仓库后续将提供同一项目的两个部署版本。

### 本地部署版本

用于在个人电脑上部署和运行，提供对应代码，以及本地环境配置、安装和启动说明。

### 云端部署版本

用于在服务器上部署和运行，提供对应代码，以及服务器环境配置、部署和运行说明。这个版本将用于本次比赛的云端运行与作品展示。

当前成品工程已从 Team Hub 以文件快照迁入，本地与云端共用工作台实现；代码尚未拆分为两个独立发行包。

- [本地安装与启动](docs/local-setup.md)
- [云端工程说明](docs/cloud-setup.md)
- [工程目录](engineering/README.md)
- [视频素材库](data/videos/README.md)
- [迁移范围与验证](docs/product-import.md)

代码包含球员标定、战术制作、解说、配音与成片流程。模型、API 凭据和云资源需自行配置；源码迁移不表示这些外部服务已部署或全部验收。

## 合作者首次配置

本仓库按所有者要求统一提交署名：作者和提交者均为 **ZeYu.Lin `<Linzeyu912@gmail.com>`**，GitHub 对应账号为 `Linzeyu912`。每台电脑克隆后，在仓库目录运行一次：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-git-identity.ps1
```

macOS、Linux 或 Git Bash 使用 `sh scripts/setup-git-identity.sh`。配置会启用提交和推送前的身份检查；各成员继续使用自己的 GitHub 登录凭据。安装、验证和远端检查的范围见[协作署名说明](docs/git-identity.md)。
