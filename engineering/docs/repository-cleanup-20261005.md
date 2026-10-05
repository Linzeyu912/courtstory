# 2026-10-05 仓库清理记录

更新：2026-10-05 10:14，Asia/Shanghai。按用户在代码审阅后确认的清单执行，基于已同步的 `main` 提交 [377c686](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/377c6860734272f7f3a262737d5eb916aefeb96f)。用户随后授权分类发布：代码清理 `e4654e5`、候选去重与兼容 `6774081`、历史归档 `9a0dc07` 已推送并核对；本说明与交接独立归入文档提交。分类明细见[发布交接](../../handoffs/Linzeyu912/2026-10-05-1014-cleanup-classified-publication.md)。

## 删除退出使用的代码

- 删除旧简版标注模块 `engineering/tools/player-review/simple-annotation.mjs` 及其 HTTP 静态路由。当前入口没有导入该模块；同名 `simple-annotation.test.mjs` 测试的是现用工作台，因此保留。
- 从 [tracking-display.mjs](../tools/player-review/tracking-display.mjs) 删除 `continuousTrail`、`personTrail`、`temporaryTrail` 三个旧像素尾迹函数。相关测试改为验证正在使用的 [court-trails.mjs](../tools/player-review/court-trails.mjs) 球场轨迹，包括断点、跨临时编号续接和米制速度约束。
- 从 [workbench-shell.mjs](../tools/player-review/workbench-shell.mjs) 删除成片区域内部不可能命中的战术分支，并重新构建前端 bundle。

## 修复默认库并合并重复候选

[默认库](../../data/videos/tactics/acceptance/review-library.json) 移除已被上一轮人工审核删除视频的 004 活动入口，默认改为 005；当前包含 005、006、nba-lal-min-005 共 3 个样例、20 个候选版本。004 的历史候选及回归依据仍保留。

004、005、006、nba-lal-min-005 的 `optimized.json` 与各自的 `team-stable.json` 原始候选逐字节相同，本次删除四份重复副本，共 **7,582,314 字节（7.23 MiB）**。这是当前检出文件的减少，不会缩减已有 Git 历史。

每个版本原有 `.meta.json` 保持不变。`optimized` 的 `tracks` 指向共用的 `team-stable.json`，同时通过可选 `metadata` 字段明确指定自己的 `optimized.meta.json`：

```json
{
  "tracks": "data/videos/tactics/acceptance/tracks/basketball-20261002/005-team-stable.json",
  "metadata": "data/videos/tactics/acceptance/tracks/basketball-20261002/005-optimized.meta.json"
}
```

省略 `metadata` 时仍读取候选文件旁的同名 `.meta.json`。显式配置无效、缺失或不属于当前视频时会拒绝加载；本机缓存也检查元数据路径边界。服务、裁剪恢复、球队叠加准备和可执行研究适配器均已适配。版本身份、来源指纹和身份建议继续由各自的元数据提供。

清理前后逐一比较当前 20 个版本的完整 API payload，SHA-256 全部一致；本机两份已有草稿 JSON 的 SHA-256 也一致。自动标注真实样例测试直接使用共享候选，缺文件不再悄悄跳过。

## 归档历史脚本

七个历史专用脚本移出当前 `engineering/scripts/`：

| 归档位置 | 文件 |
|---|---|
| [黄白球衣单片实验](../archive/vision-clip001/README.md) | `basketball_player_filter.py`、`jersey_tracker.py`、`prepare_player_review.py`、`diagnose_player_tracking.py`、`render_vision_tracking_demo.py` |
| [旧素材审核生成器](../archive/material-review-20261003/README.md) | `prepare_material_review.py`、`build_material_catalog.py` |

归档目录附有用途和运行前提；仓库根目录及通用辅助模块引用已适配新位置。历史报告、人工意见和原始快照保留原内容；历史文档只修复相关可点击链接。当前模型导入、球 / 篮筐参照及素材人工审核入口继续保留。

## 验证

| 检查 | 结果 |
|---|---|
| `engineering/tools/` 下全部 Node 测试 | 542 项，541 通过、1 环境跳过、0 失败 |
| `python -m unittest discover -s engineering/scripts -p "test_*.py"` | 305 项，303 通过、2 环境跳过、0 失败 |
| 工作台 `npm run build` | 通过，已更新构建产物 |
| `python scripts/validate_video_data.py --check-index` | 8 批、163 段视频的文件哈希和 LFS 索引通过，共 1,912,814,131 字节 |
| `python engineering/scripts/build_material_labels.py --check` | 163 段、每段 10 个显式场景字段通过 |
| 独立新服务 HTTP 烟测 | 默认 005；optimized 正确加载 143 帧；视频 Range 返回 206；旧模块路由返回 404 |
| 数据与草稿对照 | 20 个完整版本 payload、2 份已有草稿的前后 SHA-256 一致 |
| 归档脚本 | 7 个文件语法检查及 3 个视觉命令行入口 `--help` 通过 |
| 文档与补丁 | 16 份文档共 365 个相对链接，无新增失效链接；`git diff --check` 通过 |

Node 跳过项是本机 Windows 符号链接权限限制；Python 两项跳过是执行回归的系统 Python 未安装可选 Torch / Ultralytics。没有重新运行历史模型实验或新增精度结论。烟测使用独立端口和测试输出目录，完成后已停止；本轮没有重启已有工作台服务，也没有做浏览器界面验收。

链接检查另发现 `docs/status.md` 原有两处历史链接指向尚未入库的战术实验台说明及 2026-10-03 04:40 交接。已对照 HEAD 确认清理前就不存在目标文件；保留当时记录，不补造文件或改指其他资料。

本机验证日志在被忽略的 `artifacts/cleanup-20261005/`，不作为共享产物提交。后续启动工作台沿用[工程入口](../README.md)，以 005 作为默认验收样例；完整交接见[本轮记录](../../handoffs/Linzeyu912/2026-10-05-1005-repository-cleanup.md)。
