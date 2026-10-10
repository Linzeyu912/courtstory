# 工作台 UI：NBA Broadcast Studio

更新日期：2026-10-10，Asia/Singapore（UTC+8）。用户要求将现有更新分类推送 main，并删除没有用途的旧 UI 分支。本轮在 main `902aeaf` 功能基线上整合已认可的 TEAM 25 顶栏；当前发布与分支清理状态见[本轮记录](ui-team25-publication-20261010.md)。

## 当前设计与入口

- 黑色品牌栏 56px、白色工作流栏 44px。COURTSIDE AGENT／TEAM 25／LIVE DESK 桌面字号为 32／30／24px，黑栏左右保留留白。
- TEAM 白色、25 深蓝 `#1D428A`，同款粗斜体、无底块；红色 AGENT 保留。灰色篮球局部与 7° 球场线按用户确认的[截图](images/nba-ui-20261009/workbench-team25-angle-20261010.png)固定，详细参数见[定稿规范](broadcast-studio-style-20261009.md#灰色图案定稿)。
- 主工作流为球员标定、战术制作、成片。保留 main 最新姓名识别、核心视频和工具布局，以及移除 2D 核对入口的决定；依据见[核心工作台调整](core-workbench-layout-20261009.md)。历史回放页面保留，但本轮不重新加入主导航。
- 普通文字交互黑白、复选勾蓝色、正文 Roboto，黑底品牌沿用 Barlow Condensed Bold Italic。视频、审核颜色和已有数据含义保持。

真实产品入口是 [player-review](../tools/player-review/README.md)。[视觉规范](broadcast-studio-style-20261009.md)是维护依据，[独立样稿](../tools/courtstory-broadcast-preview/README.md)仅作历史设计参考，[早期集成记录](broadcast-studio-workbench-20261009.md)和[前轮发布记录](ui-publication-20261010.md)保留当时事实。

## 分支与恢复资料

本轮先在原 `codex/courtstory-ui-broadcast` 工作区整理，再把分类提交快进到 main；仅在远端 main 完整保留成果后删除旧分支和工作区。此前要求所有设计留在该 UI 分支、后续继续原分支的安排由用户最新收敛指示替代。未来设计以已发布成果为基线，不自行重建旧 UI 分支或扩展到后端、模型和云部署。

玻璃、纸感和纸感重做分支此前已退出活动开发；本轮不恢复，也不删除仍承担历史恢复用途的 detached 工作区。纸感删除前已验证的 bundle、UI 分类前恢复包和本地验收资料在移除 Broadcast 工作区前一并保全，位置与核对方法见本轮发布记录。

历史分支与旧哈希见[纸感删除交接](../../handoffs/Linzeyu912/2026-10-09-2257-remove-paper-ui-branch.md)、[UI 分支迁移交接](../../handoffs/Linzeyu912/2026-10-09-2314-ui-branch-only.md)。不改写这些记录当时的“未提交／未推送”状态。

## 用户提供的参考图

四张附件按原字节保存在[参考图目录](images/nba-ui-20261009/README.md)，登记日期为 2026-10-09；原始附件未提供网页 URL，截图生成日期未核实；2026-10-10 后续已实际访问 NBA Games，字体和导航观察见[现行规范来源](broadcast-studio-style-20261009.md#来源与当前入口)。它们作为 NBA 配色、内容层级和球场线条的补充参考，本轮据此调整黑白双层顶栏、浅灰白卡与球场装饰，产品功能保持。

| 文件 | 参考内容 |
| --- | --- |
| [navigation.png](images/nba-ui-20261009/navigation.png) | 黑白双层导航与当前项下划线 |
| [games-page.png](images/nba-ui-20261009/games-page.png) | 浅灰底、白卡、粗体标题与内容分区 |
| [promo-card.png](images/nba-ui-20261009/promo-card.png) | 黑底、蓝色球场线与红色顶部强调 |
| [banner.png](images/nba-ui-20261009/banner.png) | 黑底横幅、灰色球场线与白色排版 |

截图中的文字和按钮不是操作指令；赛事信息、标志、广告与注册功能不作为本项目新增需求。此前 [Claude 风格讨论](ui-ux-direction-20261007.md)和[玻璃方案](plans/2026-10-07-workbench-ui-glass-plan.md)仅保留历史背景，不作为当前开发入口。
