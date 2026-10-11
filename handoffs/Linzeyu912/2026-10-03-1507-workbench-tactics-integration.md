# 交接：工作台视频库与 THY 战术审核整合

- 日期 / 时区：2026-10-03 15:07，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：用户要求拉取 THY 更新，与本机视频导入、模型选择及候选移除整合，完成前后端流程，留给用户人工审核；GitHub Issue 列表本轮读取为空。
- 分支：main
- 提交：基线 `1e3c79a979befbbe625992676b91bd3e3da9d1a9`；本轮改动未提交、未推送。
- 状态：本地实现与功能验证完成，待用户审核。

## 本次完成

- 共享 / 本地视频库统一展示，增加搜索及来源筛选；未下载的 LFS 视频禁用处理，已有结果直接打开。保留本机导入、推荐模型、不同模型草稿隔离及橙紫无 T 候选移除。
- 左侧「战术分析与讲解」接入 THY 引擎：当前轨迹快照、独立 005 三阶段候选、分段合并、冻结帧、动作和掩护关系编辑、人工审核 / 撤回、撤销、讲解意见。
- 前后端精确帧接口验证视频哈希、帧时间及尺寸；切阶段清除旧图，过期结果不覆盖新图。缺少球场投影时明确降级为 2D。
- 浏览器即时草稿使用 IndexedDB，旧 localStorage 战术草稿在迁移成功后再移除。视频 / 模型切换等待写入结束，清除旧示例导航参数。磁盘保存有版本检查，QA 与正式空间分离。
- 战术 JSON 与自包含 HTML 报告导出；左栏「导出与交付」集中当前视频、轨迹和战术报告入口。
- 候选注释原字节移到 `data/tactics/005-candidate/annotation.json`，功能留在 `engineering/`；正式 / QA 本机战术文件分别在被忽略的 `data/local-workbench/tactics/drafts/`、`qa/`。
- 主要入口：[整合说明](../../engineering/docs/workbench-integration.md)、[前端](../../engineering/tools/player-review/tactics-ui.mjs)、[领域与验证](../../engineering/tools/player-review/tactics-document.mjs)、[本机存储接口](../../engineering/scripts/tactical_workbench.py)、[HTTP 服务](../../engineering/scripts/serve_player_review.py)。

## 结论与依据

- 2026-10-03 用户本轮需求；THY 来源为 [main 基线提交](https://github.com/Linzeyu912/courtstory/commit/1e3c79a979befbbe625992676b91bd3e3da9d1a9)及[此前战术交接](../thy-0629/2026-10-03-1103-tactical-overlay-sync.md)。
- THY 005 候选包含 6 人、14 动作、3 阶段；来源只作为待审候选，不升级为已核对身份、接地、标定或战术真值。
- 实际完整视频与共享目录保留原内容，15 段 THY 新增视频已在先前拉取阶段下载并核对，详见[拉取交接](2026-10-03-1413-thy-updates-pull.md)。
- Git 换行转换仅接受与锁定文本哈希等价的 LF/CRLF 差异，来源绑定仍使用实际文件字节；视频哈希必须完全匹配。

## 验证

- JavaScript：`node --test engineering/tools/player-review/*.test.mjs engineering/tools/tactical-overlay/*.test.mjs`，313 项中 312 通过、1 项 Windows 符号链接权限跳过，无失败。
- Python：`python -m unittest discover -s engineering/scripts -p 'test_*.py'`，194 项全部通过。HTTP 测试使用独立临时导入缓存，避免读取用户本机已处理视频。
- `scripts/validate_video_data.py --metadata-only --check-index`：7 批、157 条、157 个索引 LFS 指针通过；此命令未宣称全库视频字节校验。
- 已构建 React bundle，`git diff --check` 通过；新文档链接与候选迁移路径核对。
- 实际 GPU：共享素材 `2025-11-09_MIL_Q3_0518_elbow_entry_guard_screen_dunk_silent.mp4` 用 team-stable 处理 494 帧，自动打开成功。通过建立战术草稿、编辑意见、本机保存及刷新恢复。处理结果保持在既有 `artifacts/player-review-imports/` 缓存。
- 实际浏览器 QA：005 三阶段帧 16 / 41 / 91、6 人名单、动作审核撤回及编辑、当前轨迹草稿、阶段分割撤销、缺少投影的 2D 提示、视频 / 模型导航和交付入口。所有测试性人工确认只在 QA 空间。
- HTML 自包含报告含真实冻结 JPEG 和讲解意见，约 4.9 MB。宽屏、窄屏 DOM 尺寸与交互检查通过；截图接口持续超时，未取得截图级视觉验收证据。
- 本机测试日志与证据：`artifacts/workbench-integration-20261003/`（被忽略），含前后端日志、`http-proof.json`、`final-http-proof.json`、`candidate-report.html`。

## 阻塞与待确认

- 没有实现阻塞；人物身份、地面位置、标定精度和战术内容由用户人工审核。
- 战术为独立阶段冻结图；实时视频同步叠加、烧录 MP4、配音和字幕合成尚未实现，界面已明确边界。
- 截图接口超时仅影响视觉证据留存；实际页面交互与 DOM 检查已完成。

## 下一步

1. 在本机打开 `http://127.0.0.1:8890/?sample=005&variant=ebard&area=tactics&candidate=1`，先审核 THY 示例的阶段、动作与讲解。
2. 自有视频从「视频库 / 导入」进入；确认人物和球场后建立当前轨迹战术草稿。
3. 修改后点击「保存到本机」，或导出审核数据 / 冻结帧报告。用户验收后按明确同步范围选择性提交 main。

## 同步状态

- 当前 main 已拉到 THY 云端基线 `1e3c79a`。拉取时 33 个既有修改原样保留，整合过程在其基础上适配。
- 本轮没有新建分支、PR、提交或推送；所有整合成果留在本机。此前交接的远端完成状态不代表本轮代码已上传。
- 正式本机服务在 8890 运行，监听 127.0.0.1；没有创建云资源或发布赛事作品。
