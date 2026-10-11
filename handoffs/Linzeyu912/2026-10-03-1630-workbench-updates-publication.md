# 交接：分类发布工作台更新，保留本机人工核验数据

- 日期 / 时区：2026-10-03 16:30 开始，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户明确要求整理所有已有更新，分类推送远程主分支，同时保留本机工作台数据继续人工核验。当天 GitHub 开放 Issue 列表为空，以本轮用户授权为范围。
- 分支：main；开始基线为 `bbf69ae`，fetch 核对无远端新提交。
- 提交：下表三条功能提交已正常推送；本交接、入口和历次交接随第四类文档提交同步。
- 状态：功能发布及验证完成；用户继续本机人工核验，程序通过不代表身份、脚点、球场或战术精度已验收。

## 本次完成

| 分类 | 提交与范围 |
|---|---|
| 视频库和模型组合 | [2eeca0e](https://github.com/Linzeyu912/courtstory/commit/2eeca0e9f056da606a56d64d651289eb395bebd1)：本机导入、共享视频入口、串行处理与缓存、独立 YOLO / 跟踪器目录、四种组合、参数和来源元数据；只共享本地目录 README |
| 战术审核和数据入口 | [ee65937](https://github.com/Linzeyu912/courtstory/commit/ee65937449017ae5fcb5a25c1ba9386bce9f1943)：阶段 / 动作编辑、人工审核、IndexedDB 与本机文件保存、精确冻结帧和 HTML 报告；既有 005 候选以 100% 相同内容归位到 `data/tactics/` |
| 工作台界面与服务整合 | [74967ed](https://github.com/Linzeyu912/courtstory/commit/74967ed576698db9972fee2b9997eb9d6b4b9d1a)：服务路由、战术 / 导出入口、两个模型选择框、左侧说明与更大视频、右侧操作保留、红蓝 T 对应、移除橙紫无 T 候选和补帧；同步构建产物、测试与操作说明 |
| 文档与交接 | 本次文档提交：根 README、`docs/status.md`、目录说明、本交接，以及 10:13 至 15:45 的八份历史交接。历史文件保留当时的状态，不改写成当时已经发布 |

入口：[工作台](../../engineering/tools/player-review/README.md)、[视频库](../../engineering/docs/local-video-library.md)、[模型与布局](../../engineering/docs/model-selection-layout.md)、[战术整合](../../engineering/docs/workbench-integration.md)。

发布检查时补齐三处测试服务的独立数据目录参数。测试使用临时视频、导入缓存和战术目录，避免读取或写入正式本机库。产品运行参数和正在使用的服务没有改变。

## 数据保留

- 本轮没有移动、删除、重新处理或上传本机视频、剪辑、推理缓存、人物 / 球场 / 战术审核数据；没有打开、刷新或修改用户浏览器草稿，没有重启 8890 服务。
- 只读记录 `data/`、`artifacts/player-review-clips/`、`artifacts/player-review-imports/` 的文件 SHA-256，排除目录 README 与运行日志。发布前后共 594 个文件、1,546,502,211 字节完全一致，无新增、删除或内容变化。
- `data/local-videos/`、`data/local-workbench/` 仅 README 入库；媒体、实际审核 JSON、`artifacts/`、`tmp/`、模型权重与依赖继续忽略。人物 / 球场浏览器草稿仍在原浏览器；战术即时草稿在 IndexedDB，显式保存文件在本机数据目录。
- `data/videos/` 的共享媒体、清单、标签和现有本地 LFS 状态没有更改。上述候选路径归位是此前已完成的未提交改动，本轮只将该既有迁移记录入 Git。

## 结论与依据

- 来源：用户本轮发布授权（2026-10-03）、本地差异、上述三个提交、[此前整合交接](2026-10-03-1507-workbench-tactics-integration.md)和[模型布局交接](2026-10-03-1545-model-selection-layout.md)。
- 2026-10-03 从 GitHub 读取开放 Issue 为空；两次 fetch 均确认远端没有并发新增提交。功能 push 后 `git ls-remote origin refs/heads/main` 与本地功能 HEAD 均为 `74967ed576698db9972fee2b9997eb9d6b4b9d1a`。
- 本轮整理的是工程软件和协作记录，没有改变赛事要求、宣布团队选型或新增模型精度结论。

## 验证

- 前端：`node --test engineering/tools/player-review/*.test.mjs engineering/tools/tactical-overlay/*.test.mjs`，315 项中 314 通过、1 项 Windows 符号链接权限跳过、0 失败。
- 后端：服务 Python 环境运行 `-m unittest discover -s engineering/scripts -p 'test_*.py'`，199 项全部通过。
- 用已有 esbuild 在独立 artifacts 目录重建 bundle，SHA-256 与当前 `ui.bundle.mjs` 一致，未覆盖正在提供的前端文件。
- `git diff --check` 和各分类暂存差异检查通过；暂存路径按明确清单核对，没有包含本机数据或凭据。
- `python scripts/validate_video_data.py --check-index` 实际执行，在历史素材 `nba-2025-26-batch030-001` 仍是未下载 LFS 指针处停止。为遵守本轮保留本地数据的要求，没有额外下载或替换该文件。
- `python scripts/validate_video_data.py --metadata-only --check-index` 通过：7 批、157 条、157 个索引 LFS 指针。此结果不代表所有视频字节都在本机完成校验。
- 真实 GPU 143 / 494 帧和内置浏览器验证沿用上述交接中的证据，本轮没有重新处理用户视频或代做人工确认。
- 本机证据在被忽略的 `artifacts/workbench-publication-20261003/`：前后端日志、独立构建、分类文件清单与数据哈希对照。
- 只读检查正式 `/api/library` 返回 200，原服务 PID 42496 自 15:46:35 持续运行，用户人工剪辑仍在视频库；没有重启或刷新页面。47 个已存在的本机缓存 / 审核数据文件全部命中 Git 忽略规则，23 份涉及文档的相对链接均可定位。

## 阻塞与待确认

- 无代码发布阻塞。全库视频字节校验的历史 LFS 下载限制如上，本轮未新增共享视频。
- 用户的真实球员、脚点、投影与战术内容继续人工核验；冻结报告仍不包含实时播放叠加、视频烧录、配音或字幕合成。

## 下一步

- 直接在原 Codex 内置浏览器页面继续人工核验，服务与草稿保持原样。
- 队友拉取 main 后按工程说明准备各自运行环境；本机核验草稿没有被共享，不能把本次代码发布当成已共享审核结论。

## 同步状态

- 三条功能提交已正常推送 main，远端哈希已核对；未创建分支或 PR，未使用强制推送。
- 本交接和入口文档随第四类提交补齐，最终文档提交哈希以 Git 日志及本轮发布后的远端核对为准。
