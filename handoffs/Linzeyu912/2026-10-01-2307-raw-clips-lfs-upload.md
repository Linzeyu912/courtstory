# 交接：data/raw 全部视频按规范入库 Git LFS 并推送 main

- 日期 / 时区：2026-10-01 23:10，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：用户直接要求（把 data/raw 里的所有视频推送到 GitHub 远端）
- 分支：main
- 提交：bce03c7（data: share 39 NBA 2025-26 raw clips via Git LFS）
- 状态：已完成

## 本次完成

- 按[视频数据管理规范](../../docs/video-data-management.md)，将 `data/raw/` 下全部 39 个 MP4（871.2 MiB）复制（非移动，原片保留在本地忽略目录）到 `data/videos/nba/2025-26/clips/`，保持原文件名：
  - `nba-2025-26-30/` 30 段 → 对应 batch030 已有 30 条登记；
  - `nba-batch-008/` 8 段 → 新建数据集 `nba-2025-26-batch-008`（`manifest-batch-008.json`、`labels-batch-008/`）；
  - `nba-sample/` 1 段 → 新建数据集 `nba-2025-26-sample-001`（`manifest-sample-001.json`、`labels-sample-001/`）。
- 更新 `data/videos/nba/2025-26/manifest.json` 30 条目的 `asset`（路径、字节、SHA-256、git-lfs、included）与 `video`（ffprobe 实测时长/宽高/帧率，measured）；`review` 维持 unverified。
- 30 份标签 `labels/001–030.json` 补 `sha256`、`size_bytes`、`asset_path`、`measured_video`，`video_available_here` 置 true。
- 新建 9 份历史批次标签，字段沿用 2025–26 标签风格，标签状态均为 `provisional_from_collector_notes`。
- 更新 `data/videos/catalog.json`（batch030 计数改为 30/30/0，登记两个新数据集）、`data/videos/README.md`、`data/videos/nba/2025-26/README.md`、`review.md`、`docs/video-data-management.md` 第 7 节、`docs/status.md`。
- 迁移脚本留在本地忽略目录 `tmp/migrate_raw_videos.py`，可重跑（幂等）。

## 结论与依据

- 30 段成片字节数与原采集记录（`sources/batch-030.json` / 标签中 `reported_video.file_size_bytes`）逐一相符，确认本地原片即采集者成片。
- 39 个文件 SHA-256 互不相同，无逐字节重复。
- 历史 8 段与单段沿用原批次身份独立登记，与 batch030 三十段的逐段对应关系仍未确认，文档中明确不相加计数。

## 验证

- `python tmp/migrate_raw_videos.py`：39/39 复制成功，脚本内断言（文件存在、字节一致、无重复哈希）全部通过。
- ffprobe 实测 39 个文件均可读出视频流（时长/宽高/帧率已写入清单）。
- `python scripts/validate_video_data.py`（全量，含字节与哈希复核）与 `--check-index` 结果见下方“同步状态”。

## 阻塞与待确认

- GitHub 免费 LFS 配额约 1GB；仓库已有 2024–25 约 647MB，本次再增 871MB，推送可能因配额被拒。被拒时需要清理旧 LFS 对象或调整共享方式。
- 画面复核未做：普通直播、正常速度、完整球权、清晰度仍为 unverified，标签未定稿。

## 下一步

- 推送后由队友 `git lfs pull` 实际下载并核对哈希（`python scripts/validate_video_data.py`）。
- 安排看片复核，将标签从草案升级为 `reviewed_visible_actions`。

## 同步状态

- 已直接提交并推送 main：`f0d0aa9..bce03c7`，`git ls-remote origin main` 核对一致（bce03c7bfa86ac3ad281cc953e0cd3477bc55f80）。
- 推送前校验：`python scripts/validate_video_data.py` 全量通过（4 数据集 / 139 条目 / 139 文件哈希全部相符，共 1,560,866,428 字节）；`--check-index` 通过（139 个暂存视频均为符合清单哈希的 LFS 指针）；`git diff --cached --check` 无空白错误。
- 推送后远端验证：`git lfs fetch` 实际从服务端取回 2 个抽样对象（batch030-001 与 sample-001），SHA-256 与清单一致，远端可下载。本次 LFS 推送约 871MB 未被配额拒绝。
