# NBA UI 分类发布与主分支整合

- 日期 / 时区：2026-10-10，Asia/Singapore（UTC+8）。
- 范围：用户明确要求按类别分别 commit，先推送 `codex/courtstory-ui-broadcast`，再合并并推送 `main`；本轮不包含云端部署。
- 当前状态：六类提交已推送远端 UI 分支，随后已合并并推送 main；合并提交为 [`2fc2f92`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/2fc2f9272940939414e9f4947efa5a53d5d8b754)。本记录作为后续独立文档提交同步到两条分支。
- 起始基线：远端 main `12c7413d897908c1b262025af153b096004c19bc`；原本地 UI `acdcdda7b026639225d6e2376c6cf6697cc28a91`。开工时两个工作区均干净，远端只有 main，没有已共享的 UI 分支；GitHub open Issues 为空。
- 推送前 main 新增 [`deb48da`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/deb48da55bfd769ec97ed472cfb1029ee8418a5a) 出手冻结与三色反馈。按流程仅重放本轮六个尚未推送的分类提交，保留该功能；只有工程入口和团队状态两份文档冲突，均保留双方内容。

## 分类提交

| 类别 | 提交 | 内容 |
| --- | --- | --- |
| 独立设计样稿 | [`6890b79`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/6890b792680597ea1d66d0313c9b1d6b0f991dab) | 可交互 Broadcast Studio 样稿、组件、示例画面、样稿字体及许可证 |
| 视觉主题与交互表现 | [`78b535a`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/78b535afb4217d4761ae6f061877634aaea12292) | 正式工作台／回放主题、字体、篮球标记、放大的局部灰线、共享页签与底线组件 |
| 静态资源服务 | [`e5a20af`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/e5a20af661a216dffd9aa3ef059f35efd5154aa2) | 设计资源白名单路由、WOFF2 MIME 与服务回归断言 |
| 工作台流程适配 | [`3517ebd`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/3517ebde4708341f00242d2210e1df72e7a41863) | 双行顶栏、归档入口、解说先行页签、草稿保留、联合成片入口及相关回归 |
| 设计资料与验收证据 | [`0934e30`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/0934e30b691bf760f2d29b7d58b387f77dcf335b) | 视觉规范、NBA 参考图、实际工作台审核截图、工程索引 |
| 协作与交接记录 | [`2254a6c`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/2254a6ceb02037f9564f32c36aa20df3bced4f0a) | 当前授权边界、团队入口与状态、各轮历史交接及本轮交接 |

分类只调整尚未共享的本地提交组织。首次分类后的代码、构建产物和设计资源与用户刚审核的 `acdcdda` 相同；随后完整吸收 main 的出手反馈功能。`git range-diff` 确认样稿、主题和 UI 流程改动保持，服务测试仅增加新 main 的相邻上下文；文档保留双方记录。main 已有的解说、独立绘图、逐句接口和其他成员历史不重新提交、不改写。

## 验证

- 重新构建 `player-review` 成功，产物与审核快照一致。
- 首次分类前端定向回归 124 项、HTTP 服务回归 33 项全部通过。
- 整合 main 新增功能后重新执行前端／Agent／战术共享渲染全量回归：853 项中 852 通过、1 项已有可选跳过、0 失败。
- 整合后执行 15 个 Python 模块的顺序回归：168 项全部通过，包括出手反馈、独立绘图、联合成片、字幕配音、姓名、HTTP 及渲染；使用本机已有 FFmpeg，没有新增真实模型调用。
- 在主 checkout 运行 `scripts/validate_video_data.py --check-index`：10 个数据集、166 条视频、166 个本地文件摘要、166 个 Git LFS 索引全部通过。两个分支视频目录一致，本轮不改视频。
- 视觉资源相对审核快照无差异，后端相对最新 main 只保留静态资源路由／MIME 及对应测试差异。前轮浏览器验证见[同步验收](ui-main-sync-20261010.md)及[篮球顶栏交接](../../handoffs/Linzeyu912/2026-10-10-0153-basketball-header.md)。
- 818 个相对文档链接和 10 个字体摘要／字节数核对通过。原版 OFL 许可证中的行尾空格保留，其余差异检查通过。

## 历史与恢复

- 原本地 UI 历史由本机 `refs/archive/courtstory-ui-before-publication-20261010-0154` 保留，并保存已验证的增量 bundle：`tmp/ui-publication-20261010/before-classification.bundle`。恢复需要仓库已有的 main 基线；该本地备份不作为团队运行依赖，不推送。
- 各轮历史交接中的旧哈希／未推送描述保留原时点，当前团队使用上表分类提交。
- 后续 UI 设计仍在原 UI 分支；本轮 Git 合并不代表云端服务已更新，不包含真实模型与 TTS 的新一轮质量验收。

## 远端核对

- UI 分支首次推送后实际远端为 `2254a6ceb02037f9564f32c36aa20df3bced4f0a`。
- main 先快进到 `deb48da`，再显式合并 UI；合并树与已验证 UI 树完全一致，完整视频与 LFS 索引再次通过。
- main 推送后 `git ls-remote --heads` 实际返回 `2fc2f9272940939414e9f4947efa5a53d5d8b754`；两个父提交分别为 `deb48da` 和 `2254a6c`。无 force push，无 PR，无云部署。
- 已把本地 UI 分支快进到已发布合并点，收尾文档提交随后同步两条分支；最终位置以远端分支引用为准，避免在文档内循环记录自身提交哈希。
- 本地旧 8900 预览进程未重启：新增 `shot-feedback.mjs` 在该旧进程仍返回 404；尝试停止并重启服务被自动审批以“策略拦截”拒绝，未给出更具体原因。Git 发布已完成，使用新版完整预览前需重启该本地服务；没有把运行中服务写成已更新。
