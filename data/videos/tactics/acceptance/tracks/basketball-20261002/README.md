# 已共享篮球候选快照

2026-10-05 去重：四组 `optimized.json` 与 `team-stable.json` 原始观测字节完全一致，现只保留后者，共减少 7,582,314 字节。两套 `.meta.json` 保持原字节；当前 `review-library.json` 中的 optimized 版本通过显式 `metadata` 路径读取自己的侧车文件，版本、身份建议、接口输出与旧草稿指纹不变。下表的 optimized 原文件名和哈希保留历史含义，链接指向共用观测文件。004 视频已从活动库删除，其剩余候选用于既有回归与历史追溯，不再列为可播放样例。

发布记录：2026-10-02（Asia/Shanghai）。本目录只读复制此前已验证的检测和跟踪候选及相邻来源元数据，用于当前工作台的四个样例、17个模型版本。它们仍需人工核对，不证明十名真人或连续身份已锁定。

原始视频沿用既有 Git LFS 成片；原始本机候选、模型权重、推理环境和QA草稿保留。本次不重新推理，不修改来源帧、PTS、模型建议、脚点或2K数据。

`review-library.json` 指向本目录的共享副本。元数据中原生成路径是历史来源记录，服务不依赖这些历史路径。`.gitattributes` 禁止本目录JSON换行转换，以保持候选SHA与原草稿指纹。

| 共享文件 | SHA256 | 原本机来源 |
| --- | --- | --- |
| [004-team-stable.json](004-team-stable.json) | `aaca9d5ea06d3e2a503b5b15453ca3f06ec73bcd8d83c36cee75a106af07c593` | `artifacts/player-team-overlay-20261002/r3/004-team-stable.json` |
| [004-team-stable.meta.json](004-team-stable.meta.json) | `976579c9578bce870b99d9bbc55b89998d7988a69502ae6a770dccd6dd1664e1` | `artifacts/player-team-overlay-20261002/r3/004-team-stable.meta.json` |
| [004-optimized.json](004-team-stable.json) | `aaca9d5ea06d3e2a503b5b15453ca3f06ec73bcd8d83c36cee75a106af07c593` | `artifacts/player-tracking-workbench-20261002/004_optimized.json` |
| [004-optimized.meta.json](004-optimized.meta.json) | `0ecacd3befaf7e868caae33ed9554addd3d59cb6216f468f9f361b4c0a018944` | `artifacts/player-tracking-workbench-20261002/004_optimized.meta.json` |
| [005-team-stable.json](005-team-stable.json) | `c8153625651880b27852b9b9951024936da605402af63f99bcab4a58b5a09d17` | `artifacts/player-team-overlay-20261002/r3/005-team-stable.json` |
| [005-team-stable.meta.json](005-team-stable.meta.json) | `59a59e2c0843b051f81f425a09f1ea5ab2122ce7f06ee85cd4eae60a200460c0` | `artifacts/player-team-overlay-20261002/r3/005-team-stable.meta.json` |
| [005-optimized.json](005-team-stable.json) | `c8153625651880b27852b9b9951024936da605402af63f99bcab4a58b5a09d17` | `artifacts/player-tracking-workbench-20261002/005_optimized.json` |
| [005-optimized.meta.json](005-optimized.meta.json) | `19fbb5155f08dd9912886d0b2ade7008da5125ac8544d3022d1cd0bd44b6bab0` | `artifacts/player-tracking-workbench-20261002/005_optimized.meta.json` |
| [006-team-stable.json](006-team-stable.json) | `a8ce872d737fd3eeb8f18cc30f8138f5d3a7098b40241d7cf6ba553e63aedbf0` | `artifacts/player-team-overlay-20261002/r3/006-team-stable.json` |
| [006-team-stable.meta.json](006-team-stable.meta.json) | `2741ff051c4b7d8815906772022252f1cef98658efe7f2c57d0e29224db12c2b` | `artifacts/player-team-overlay-20261002/r3/006-team-stable.meta.json` |
| [006-optimized.json](006-team-stable.json) | `a8ce872d737fd3eeb8f18cc30f8138f5d3a7098b40241d7cf6ba553e63aedbf0` | `artifacts/player-tracking-workbench-20261002/006_optimized.json` |
| [006-optimized.meta.json](006-optimized.meta.json) | `30cb50a1b976b9ef64feca9613af1522e7be4a3531ad0b7f0be4b7d18104fb72` | `artifacts/player-tracking-workbench-20261002/006_optimized.meta.json` |
| [nba-lal-min-005-original.json](nba-lal-min-005-original.json) | `83e2167ef9f28b83a7731102abdd1feff42767cb2cba0d7796fdad8f67ac5b0b` | `artifacts/player-tracking-workbench-20261002/baseline.json` |
| [nba-lal-min-005-original.meta.json](nba-lal-min-005-original.meta.json) | `b3215068c2ae9af5e703f0f16a3b8cf9f9a18987d99dbe935282ccce3baf853f` | `artifacts/player-tracking-workbench-20261002/baseline.meta.json` |
| [nba-lal-min-005-team-stable.json](nba-lal-min-005-team-stable.json) | `87395ce9653d083aadc35bb59d8b81ddbaa3afa92e97992f3ab17e08f946eee1` | `artifacts/player-team-overlay-20261002/r3/nba-lal-min-005-team-stable.json` |
| [nba-lal-min-005-team-stable.meta.json](nba-lal-min-005-team-stable.meta.json) | `4ad9a1d4b3e18d466f8d2850f66f1d18934c15b78ea30685b418eff94feb66d9` | `artifacts/player-team-overlay-20261002/r3/nba-lal-min-005-team-stable.meta.json` |
| [nba-lal-min-005-low.json](nba-lal-min-005-low.json) | `d2aa7f1cbbe418ca2106cf8de14d68897c5675d4dbf00c9334dd9503f9b155fd` | `artifacts/player-tracking-workbench-20261002/low.json` |
| [nba-lal-min-005-low.meta.json](nba-lal-min-005-low.meta.json) | `cef701a0d001fc98fdc36ceb6bf3011fc7fec5e26f5e8860820bcf1658c42c5c` | `artifacts/player-tracking-workbench-20261002/low.meta.json` |
| [nba-lal-min-005-reid.json](nba-lal-min-005-reid.json) | `ced609ecb4081e23390efaca024301b80a13fea49f9b673f8916a19150635e3f` | `artifacts/player-tracking-workbench-20261002/reid.json` |
| [nba-lal-min-005-reid.meta.json](nba-lal-min-005-reid.meta.json) | `bd35f9132d64dfaa460feecdcae834624d4dd7092cfe875743f33270903d2d79` | `artifacts/player-tracking-workbench-20261002/reid.meta.json` |
| [nba-lal-min-005-optimized.json](nba-lal-min-005-team-stable.json) | `87395ce9653d083aadc35bb59d8b81ddbaa3afa92e97992f3ab17e08f946eee1` | `artifacts/player-tracking-workbench-20261002/optimized.json` |
| [nba-lal-min-005-optimized.meta.json](nba-lal-min-005-optimized.meta.json) | `edc7fbdf2522e3700d95d2a44bc1ba8f5187717edfaeb881ad84ec127b2822cb` | `artifacts/player-tracking-workbench-20261002/optimized.meta.json` |

操作与限制见[工作台](../../../../../../engineering/tools/player-review/README.md)。
