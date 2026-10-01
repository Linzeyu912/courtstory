# 交接：视频数据管理规范与100段成片LFS共享

- 日期 / 时区：2026-10-01 08:48，Asia/Shanghai（UTC+08:00）。
- 成员：Linzeyu912。
- 任务 / Issue：用户明确要求核对THY上传的数据、将本机已有视频通过LFS上传，并建立视频数据管理规范；只读Issue查询返回空列表。
- 分支：main。
- 提交：本记录与素材一起提交；实际提交以文件Git历史为准，远端核验结果在下文补记。
- 状态：规范、100段成片及标签已推送main，远端对象独立下载校验通过；30段成片仍待上传。

## 本次完成

- 新增[管理规范](../../docs/video-data-management.md)、[视频入口](../../data/videos/README.md)、[总目录](../../data/videos/catalog.json)和[校验脚本](../../scripts/validate_video_data.py)。统一编号、来源、比赛信息、标签状态、画质、完整回合、重复关系、版本及LFS同步方式。
- 将本机100段成片及标签复制至 `data/videos/nba/2024-25/library100/`，合计 **647,393,804字节**，100个独立视频；首批3段已包含，不重复保存视频或上传同一批ZIP。
- 根 `.gitattributes` 仅为 `data/videos/` 中的视频设置LFS，`.gitignore` 仅在该共享目录放行视频；原片、候选、缓存和ZIP继续留在本机忽略目录。
- 新增统一资产清单；`annotations.json` 和各段 `labels.json` 保留原采集内容，播放页与文字索引可定位全部100段。
- 2025–26的30段在 `data/videos/nba/2025-26/batch030/` 登记为 `awaiting_upload`；路径、字节数、哈希和实测规格为空，原记录规格单独保存，30份标签仍是草案。
- 更新README、协作流程、Agent指引、决策D005、团队状态和调研入口；同步此前已完成的100段说明与30段标签复核文档。保留原视频采集目录、组员30段原清单和THY数据包。

## 结论与依据

- 开工fetch后本地与远端均为 `a640fdf93996d44691379cd9432c653e7bc3c567`，没有新提交。
- THY（`thy-0629`）已上传 [NBA 2K数据包](../../2K%20Player%20Data/manifest.json)，数据提交为 [0584778](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/0584778933bb555d42f1985a8c56009d8316b718)，后续补记为020819f。本轮重新核对清单9个文件的字节数和SHA-256，9/9匹配；该包未修改。
- 100段的来源、比赛和已看片标签沿用此前采集记录；3段1080p、97段720p，14段完整球权、86段局部片段。同类动作分16组，不能称为100种战术。
- 30段原链接仍受登录验证或地区限制，成片未取得；旧8段与单段清单作为历史入口保留，不能在未核对关系时相加为新增独立素材。
- LFS行为依据[GitHub说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)及[LFS按路径拉取说明](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-pull.adoc)，读取于2026-10-01；本轮用户已授权私有仓库内上传。

## 验证

- 本地校验：2批次、130条登记、100个成片、30条待上传记录；100个文件大小和SHA-256全部匹配；100个暂存视频均为规范LFS指针，指针哈希和大小与清单一致。
- 原100段整批采集清单与新 `annotations.json` 内容一致；100份独立标签内容一致；播放页内嵌100条记录与原清单一致。
- 检查287个Markdown本地链接目标全部存在，`git diff --cached --check` 通过；THY包和30段原始清单没有Git差异。
- 此次未重新编码视频，未把此前画面检查记为本轮新检查。08:52完成远端独立下载核验：100/100对象、647,393,804字节，大小与SHA-256全部匹配；独立缓存的 `git lfs fsck --objects --pointers` 通过。

## 阻塞与待确认

- 2025–26的30段仍需采集者提供成片包或逐段文件，才能上传和完成独立画质、完整性及最终标签复核。

## 下一步

- 队友按视频入口使用LFS拉取100段，再运行校验脚本。采集新素材时按管理规范登记并检查跨批次重复。
- 取得30段成片后，沿用已有编号，补实际文件和测量、解码、视觉结论；复核20/21号2秒源重叠及15/18号相关上下文。

## 同步状态

- 准备阶段：全部任务文件已选择性暂存；此前独立的 `2026-10-01-0805-remote-data-check.md` 留在本机未提交，不顺带纳入本次视频上传。
- 仅操作main；未新建分支、PR或Issue，未发消息给组员，未使用force push。最终推送和独立缓存下载结果将在本节追加。
- 实际素材与规范提交：[ef840fb1a0d73b13363e64becccb08d1770f6db4](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/ef840fb1a0d73b13363e64becccb08d1770f6db4)。正常推送main成功，LFS报告100/100对象、647 MB上传完成。
- 素材提交核验：本地HEAD、origin/main、GitHub `commits/main` 和 `git ls-remote` 四处SHA均为上述提交。
- 随后用原本不存在的独立LFS存储目录，从GitHub拉取该固定提交；实际读取100个下载对象，逐个核对字节数与SHA-256，100/100通过。原本机LFS缓存未用于此下载检查，原视频与标签未改写。
- 完整本机核验记录在被忽略的 `artifacts/video-lfs/local-validation.json` 与 `artifacts/video-lfs/remote-verification.json`；共享结论和逐段预期哈希已分别保存在本交接及资产清单。本次补记仅更新交接与团队状态，随后正常推送，提交标识以文件Git历史为准。
