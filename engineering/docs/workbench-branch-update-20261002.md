# 独立分支工作台更新：2026-10-02

更新时间：2026-10-02 23:30，Asia/Shanghai。发布分支：[codex/local-workbench-20261002](https://github.com/Linzeyu912/broadcastcode-team-hub/tree/codex/local-workbench-20261002)。

## 发布范围

本轮按用户明确要求，将两版取舍后的整合结果提交到用户已有的独立分支。五个功能提交已推送，23:30 核对远端为 `537a88da8ca3c661db052eb43e3d3e3eca372335`；本文、来源归档和交接作为随后单独的文档提交保存。未向 main 推送、未合入 main、未创建 PR。远端 main 核对仍为 `1839dcde5b5cc0aa362baa474e58e5b530e6c695`。

- 用户版基线：[fffb6ea](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/fffb6ea7513b161dba0d0959ee4b822ae0469cf0)。
- THY 来源：[1839dcd](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/1839dcde5b5cc0aa362baa474e58e5b530e6c695)。采用其模型 / 候选数据和资料查询能力，保留原研究与历史交接作为依据。
- 本次是按功能选择整合代码，未将 main 分支整体合并过来。默认主分支协作规则不因此改变；本轮按用户明确指定的分支例外执行。

## 分类提交

| 提交 | 内容 | 文件数 |
|---|---|---:|
| [50f9737](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/50f97373e35d2060ee9bb77d1fdbdea19fc20bba) | feat(tracking): 接入 THY 跟踪方案与多版本候选数据 | 65 |
| [dfad783](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/dfad783c781420c525db36b9d02da0320e7f2ea9) | feat(identity): 增加球员资料与 2K 能力查询模块 | 3 |
| [1006486](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/10064864a8539f078b1a70627497b484e673e8ce) | feat(api): 整合模型版本、2K 查询与裁切来源保留 | 11 |
| [c00023a](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/c00023addde1e001f7bff2c6be56d1fb598b2b7c) | fix(video): 按实际呈现帧通知工作台更新 | 2 |
| [537a88d](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/537a88da8ca3c661db052eb43e3d3e3eca372335) | feat(review): 整合整段编号审核与红蓝分队工作台 | 27 |

共享文件有明确依赖：模型与查询模块先提交，服务和裁切随后接入，最后统一接上页面与生成的 bundle。视频回调模块单列提交，完整同步的 app 接线在工作台提交中。提交正文列出范围，不把源码模块的准备阶段写成已完成整套交互。来源文档、研究归档和本次交接单独提交。

## 当前行为与取舍

| 类别 | 本分支采用的实现 |
|---|---|
| 页面布局 | 用户版左侧导航、分步骤操作和底部 2D 数据抽屉。 |
| 分队 | 上排红队、下排蓝队，仅区分队伍；不默认指定攻守。旧草稿、编辑响应和导出清除 `teamRoles`，保留颜色及真人资料。 |
| 检测与跟踪 | 默认推荐 THY team-stable，保留原 YOLO、E-BARD 与其他跟踪配置可选；四样例共 27 个组合，模型版本各自保存草稿。 |
| 整段 T 归并 | 在任意出现帧选择某个 T，将它全部实际观测（含此前）累计归到固定球员。不同 T 分别确认，同帧冲突保持可见，明确人工纠错优先。 |
| 审核与诊断 | 时间轴显示位置覆盖，模型位置仍待核对。区分单帧检测与跟踪证据，编号改变不能单独归因于 YOLO；保留从当前帧向后纠错。 |
| 球员资料与 2K | 按赛季、球队、文字号码查找，人工确认后显示能力与逐字段来源。游戏评分不证明视频身份正确。 |
| 脚点与球场 | 保留用户版脚点、框编辑、球场标定、初始化及 2D 投影；未确认的位置和精度继续明确标记。 |
| 视频与裁切 | 保留黑屏恢复、重载和结束重播；按实际解码帧同步标记，修复微秒量化造成的逐帧倒退。裁切保留模型版本、原片 PTS 与场地来源。 |

详细记录：[整合取舍](plans/2026-10-02-selected-integration.md)、[编号归并与审核接口](track-identity-review.md)、[运行与模型准备](model-deployment.md)、[工作台操作](../tools/player-review/README.md)。

## 数据与可复现范围

- 保留 THY 22 份原字节 JSON；新增 10 组、2712 帧对照候选及元数据，两个目录的 `.gitattributes` 保护字节及草稿指纹。共享 JSON 总量约 40 MB。
- 视频继续使用既有 Git LFS 文件。本轮四个预览视频与 HEAD 的 LFS SHA / 大小逐个一致，未增加或修改视频内容。
- 权重、虚拟环境、模型缓存、截图及 QA 草稿留在忽略目录；源码和部署说明提供模型来源、哈希及准备步骤。
- FFmpeg 支持显式路径、系统 PATH 或仓库 `tmp/tactics-ffmpeg.exe`，已移除作者电脑绝对路径。
- THY 历史研究中的本机 artifacts 链接只表示当时证据；本轮未伪造或补传缺失的本机产物。旧交接中的“未提交”描述保留当时状态，本次共享范围以本文为准。

## 验证与限制

- 在实际待推送的分支目录重新构建 bundle，200 项 JavaScript 与 207 项 Python 测试全部通过，0 跳过；覆盖模型、渲染、资料查询、裁切、人物审核和球场。
- Git 补丁检查、分类暂存与逐次提交文件核对通过；未夹带密钥、模型权重或本机环境。
- `validate_video_data.py --metadata-only --check-index` 通过：5 个数据集、142 条、142 个暂存 LFS 指针。完整 `--check-index` 运行因本机尚未下载 `nba-2025-26-batch030-001` 等 LFS 视频而停止；本次不把它记为全视频逐字节验收。实际涉及的四个视频另已核对字节一致。
- 沿用本次实现阶段的浏览器 QA：模型 / 草稿隔离、2K 查询、整段归并前后帧、重叠冲突与撤销、切镜与逐帧导航、纯红蓝分队和底部 2D 抽屉均检查；正式草稿未代操作。
- 本机测试日志：`artifacts/branch-publication-frontend-tests.log`、`artifacts/branch-publication-backend-tests.log`；它们是本地忽略证据，不是仓库共享产物。
- 模型推荐来自当前样例与用户取舍；真实身份、脚点接地和米制位置精度仍需人工逐帧验收。尚未部署云资源或接入完整战术解读流程。

## 下一步

在此独立分支继续校对人物、T 编号、脚点与球场投影。是否合入 main 由用户后续明确决定；本轮没有执行该操作。
