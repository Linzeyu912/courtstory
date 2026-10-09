# NBA UI 分类发布与主分支整合

- 日期 / 时区：2026-10-10，Asia/Singapore（UTC+8）。
- 范围：用户明确要求按类别分别 commit，先推送 `codex/courtstory-ui-broadcast`，再合并并推送 `main`；本轮不包含云端部署。
- 当前状态：代码分类与验证完成，资料归档和远端发布进行中。发布完成后在本文补记远端核对结果。
- 起始基线：远端 main `12c7413d897908c1b262025af153b096004c19bc`；原本地 UI `acdcdda7b026639225d6e2376c6cf6697cc28a91`。开工时两个工作区均干净，远端只有 main，没有已共享的 UI 分支；GitHub open Issues 为空。

## 分类提交

| 类别 | 提交 | 内容 |
| --- | --- | --- |
| 独立设计样稿 | [`75eea62`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/75eea62973ea67771622e7e236736347dc28bfe8) | 可交互 Broadcast Studio 样稿、组件、示例画面、样稿字体及许可证 |
| 视觉主题与交互表现 | [`60dc83b`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/60dc83b22c56a2ec755af45ea7780e2953c9dd31) | 正式工作台／回放主题、字体、篮球标记、放大的局部灰线、共享页签与底线组件 |
| 静态资源服务 | [`22f83e4`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/22f83e4363359d6e8c940914808e3a4cd2952a66) | 设计资源白名单路由、WOFF2 MIME 与服务回归断言 |
| 工作台流程适配 | [`4052e18`](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/4052e18d26964d3873a3877860e243264d2cd59d) | 双行顶栏、归档入口、解说先行页签、草稿保留、联合成片入口及相关回归 |
| 设计资料与验收证据 | 本文所在资料提交，发布后补记哈希 | 视觉规范、NBA 参考图、实际工作台审核截图、工程索引 |
| 协作与交接记录 | 分类记录提交，发布后补记哈希 | 当前授权边界、团队入口与状态、各轮历史交接及本轮交接 |

分类只调整尚未共享的本地提交组织。源代码、构建产物和设计资源与用户刚审核的 `acdcdda` 相同；仅更新文档以反映本轮发布授权。main 已有的解说、独立绘图、逐句接口和其他成员历史不重新提交、不改写。

## 验证

- 重新构建 `player-review` 成功，产物与审核快照一致。
- 前端定向回归：124 项全部通过，涵盖工作区、导航、战术／解说、视频库及集成。
- HTTP 服务回归：33 项全部通过，包含新增主题／字体资源和已有解说接口。
- 在主 checkout 运行 `scripts/validate_video_data.py --check-index`：10 个数据集、166 条视频、166 个本地文件摘要、166 个 Git LFS 索引全部通过。两个分支视频目录一致，本轮不改视频。
- 代码与资源相对审核快照无差异。前轮全量和浏览器验证分别见[同步验收](ui-main-sync-20261010.md)及[篮球顶栏交接](../../handoffs/Linzeyu912/2026-10-10-0153-basketball-header.md)，本轮没有将历史测试写成重新执行。
- 本轮文档链接、字体摘要和差异检查在发布前核对。原版 OFL 许可证中的行尾空格保留，不修改上游许可文本。

## 历史与恢复

- 原本地 UI 历史由本机 `refs/archive/courtstory-ui-before-publication-20261010-0154` 保留，并保存已验证的增量 bundle：`tmp/ui-publication-20261010/before-classification.bundle`。恢复需要仓库已有的 main 基线；该本地备份不作为团队运行依赖，不推送。
- 各轮历史交接中的旧哈希／未推送描述保留原时点，当前团队使用上表分类提交。
- 后续 UI 设计仍在原 UI 分支；本轮 Git 合并不代表云端服务已更新，不包含真实模型与 TTS 的新一轮质量验收。

## 远端核对

待完成 UI 分支推送、main 合并推送后补记实际结果。
