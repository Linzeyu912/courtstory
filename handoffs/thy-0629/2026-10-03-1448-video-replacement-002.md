# 交接：第二批视频按序号替换 002

- 日期 / 时区：2026-10-03 14:48，Asia/Shanghai。
- 成员：thy-0629。
- 任务 / Issue：用户要求查找截图所列四个文件，存在时替换刚上传批次的对应编号；未修改 Issue。
- 分支：main；本轮基线 `1e3c79a979befbbe625992676b91bd3e3da9d1a9`。
- 数据提交：[0850e289298a271636f58323e2030db4aa89eefc](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/0850e289298a271636f58323e2030db4aa89eefc)，已正常推送 main；本收尾文档的后续提交以 Git 历史为准。
- 状态：002 已完成替换、推送及远端独立下载核验；005、006、010 替换源未找到，原视频保留。

## 本次完成

- 在 `data/videos/uploads/2026-10-03-batch02/clips/` 将 002 替换为 `02_Warriors_20240316_Q3_4m17_team_motion_1080class_silent.mp4`；固定编号和全局片段 ID 保留，其余十段成片、清单条目和标签不变。
- 更新该批 manifest、002 标签、README 和视频入口及 catalog 更新时间；新增 `sources/replacement-002-20261003.json`，保存替换前后来源、规格和 SHA-256。原 `sources/uploaded-files.json` 及历史交接保留原貌。
- 当前批次仍为 11 段，共 85,029,112 字节；002 实测 1920×1078、30 fps、15.3 秒、459 帧、H.264，无音频流。005、006、010 仍低于 720p。

## 结论与依据

- 用户截图指定的 HKS 下“新视频”目录在本机不存在。002 的完整同名文件在本机 Codex 文件预览缓存中找到，按原字节复制；没有把来源写成原截图目录或旧 Spurs 上传。
- 005 `05_Pacers_20250106_Q2_0m44_team_motion_720p_silent.mp4`、006 `06_Grizzlies_20251202_Q1_6m33_screens_handoffs_native708_silent.mp4`、010 `10_Celtics_20231201_Q4_1m01_multi_action_720p_silent.mp4` 在本轮检查的 D 盘与用户目录 / 缓存中未找到。
- 文件名不作为已确认的比赛、赛季、时钟或战术依据；相应空值及待复核状态保留。

## 验证

- 002 的 ffprobe 测量成功；FFmpeg `-xerror -err_detect explode` 对完整文件全部流解码退出 0、错误输出为空。未转码。
- 新文件复制前后大小均为 8,962,802 字节，SHA-256 均为 `2435960f79e85859e31650204e110a25c79d6bc6cede0ea29c25af2881215df0`；与其余 156 条 catalog 资产哈希无重复。
- 旧 002 已备份至本机忽略目录 `artifacts/video-replacement-20261003-002/backup/`，备份哈希与原清单的 `b97ec97396a300e142a416c65aa44cf5feeae2dc96a46d20a80a3a5f287c262e` 一致；核验后才从当前 clips 目录移除。
- `python scripts/validate_video_data.py --check-index` 通过：7 批 / 157 条、157 个成片实际大小与哈希、157 个暂存 LFS 指针匹配，合计 1,728,528,722 字节；`git diff --cached --check` 通过。独立复核确认仅 002 替换，其余十段媒体、标签及清单条目保持基线。
- 其余十条 manifest / 标签和原接收记录保持；原有八项无关未跟踪入口保留。解码、探测、复制及元数据检查证据在本机忽略目录 `artifacts/video-replacement-20261003-002/`。
- 未做画面、速度、普通直播、完整球权或战术验收。
- 2026-10-03T14:54:08.7938702+08:00，从 origin 使用唯一、初始不存在的独立 `lfs.storage` 缓存实际下载新 002，8,962,802 字节及 SHA-256 均与替换输入一致；没有复用原本地 LFS 缓存。证据为本机忽略目录中的 `remote-download-proof.json`。

## 阻塞与待确认

- 005、006、010 的替换源尚未找到，继续使用原视频。

## 下一步

- 获得 005、006、010 的实际新文件后，按相同编号替换并完成技术校验；当前继续使用原视频。

## 同步状态

- 9 项相关变更已选择性提交并正常推送 main；LFS 上传 1/1、约 9 MB。`git ls-remote` 确认远端 main 与数据提交一致，独立空缓存下载核验通过；没有新建分支、PR 或使用 force push。原有八项无关未跟踪入口保留。
