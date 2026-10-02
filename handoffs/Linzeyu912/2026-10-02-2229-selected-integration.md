# 交接：按用户选择整合工作台与 THY 能力

- 日期 / 时区：2026-10-02 22:29，Asia/Shanghai（UTC+08:00）
- 成员：Linzeyu912
- 任务 / Issue：本聊天用户明确指定的两版取舍与本地整合；未新建 Issue。
- 分支：独立目录中的 detached HEAD，基线为 `fffb6ea7513b161dba0d0959ee4b822ae0469cf0`。
- 提交：本轮未提交、未推送；THY 来源为 `1839dcde5b5cc0aa362baa474e58e5b530e6c695`。
- 状态：本地整合和运行验收完成；最终记录更新于 22:39，尚未提交推送。

## 本次完成

- 按用户要求保留左侧导航、分步骤操作和底部 2D 抽屉；上红进攻、下蓝防守固定，去掉攻守选择。默认推荐 THY 完整方案，保留原 YOLO 及其他已准备的版本入口。
- 合入 THY 的身份 / 2K 查询及展示、模型建议与呈现能力；保留用户版球场标定、视频恢复、清空 / 取消 / 交换语义。
- 后端合入模型 metadata / 指纹校验、只读身份 GET、相关静态模块和裁切来源映射，保留 `court-calibrate` / `review-edit`。
- 清空槽位加入模型自动回填抑制；取消区间裁剪模型绑定；交换完整人物资料、模型关联、2K 引用与抑制状态，颜色归属保持在槽位上。
- 新增[取舍与接口验收记录](../../engineering/docs/plans/2026-10-02-selected-integration.md)，更新[工作台说明](../../engineering/tools/player-review/README.md)及[团队状态](../../docs/status.md)。

## 结论与依据

- 依据：2026-10-02 本聊天用户的明确整合指示。原用户基线 [fffb6ea](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/fffb6ea7513b161dba0d0959ee4b822ae0469cf0) 与 THY 基线 [1839dcd](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/1839dcde5b5cc0aa362baa474e58e5b530e6c695) 保留，可继续比较。此取舍是本次用户要求，不作为赛事规则或未经确认的全队共识。
- 2K 查询复用原数据包；读取约定见[数据指引](../../2K%20Player%20Data/AGENTS.md)。新增的是查询、人工确认、展示和来源读取，数据值未重写。
- 2024–25 / MIN / 文字号码 `10` 的实际接口结果为 Mike Conley；能力和来源与包内记录一致。名册包内采集日 2026-09-30，能力来源为固定 2024-11-26 GitHub 快照，补丁日未知；完整 URL 见取舍记录。此结果不证明某段视频中的人物身份。

## 验证

- Python 全套 151/151 通过，Python 编译与所改代码 `git diff --check` 通过；覆盖草稿不可变输入、清空抑制、完整交换、旧攻守归一、模型建议 / 球场初始化重复裁切和 HTTP 路由共存。
- 独立 8890 预览：身份 options / lookup、三种 `review-edit` 操作均 HTTP 200。13 项返回能力逐一匹配 `players/2024-25.jsonl` 第 86 行；总评 79、三分 83、控球 89、外线防守 83。
- 005 / `team-stable` 首帧实际球场初始化 HTTP 200；权重 SHA 为 `68e5faf5fb5388cf83477238abe22e9824a69fb33a4cf34f79ab61858f410064`，输入 640，返回右侧待复核候选，单帧耗时约 8.50 秒（含该次首次加载）。未采用为正式标定，未验证米制精度。
- 接口请求使用内存中的 QA 草稿，操作前后源 clip payload 完全一致；未写正式浏览器草稿。整合 8890 服务由主任务重启载入最新实现，原 8876 服务保留。
- 22:38 在最新服务补验清空 / 区间取消重复请求、JSON 恢复后交换到空槽 P9：被拒绝的 T1 观察区间随人保存，重复操作不累加重复记录；源 clip 不变。新裁切不迁移人工草稿，取消记录和其他人工编辑同留在源存储键。
- 本机证据：`artifacts/integration-runtime-qa/runtime-checks.json`、`artifacts/integration-runtime-qa/court-calibration-response.json`、`artifacts/integration-runtime-qa/dismissed-observations-http.json`、`backend-integration-tests.log`，均为忽略产物。本轮最终前端、模型与浏览器结果见下条。

- 模型与前端收尾：27 个样例 / 版本组合 HTTP 校验通过；补跑 10 组、2,712 帧；THY 原 22 份 JSON 保持原字节；46 项模型 / 展示测试通过。JavaScript 171 项全部通过（0 跳过）；bundle 构建通过。
- 浏览器 QA 验证固定红蓝排列、原分步导航、2D 抽屉、2K 查询 / 清除、确认 / 取消 / 重载、交换 / 撤销、模型草稿隔离、视频重播和重新加载，控制台无错误。142 条视频 metadata / LFS index 校验通过。详细记录见[整合验收](../../engineering/docs/plans/2026-10-02-selected-integration.md)与[模型部署](../../engineering/docs/model-deployment.md)。

## 阻塞与待确认

- 本轮无阻塞。整合结果在本机预览可用。
- 模型身份准确性、真实接地和米制位置精度仍待独立评估；“推荐”不等于逐帧身份已经验证。

## 下一步

- 打开 `http://127.0.0.1:8890/`，从默认 THY 完整方案开始逐段核对；模型选择在“素材与检测设置”。
- 保持模型建议待人工确认，按原有球场标定流程核对 2D 映射。
- 按用户后续要求决定同步；保持原用户版本、THY 对照和本地整合的真实状态可辨。

## 同步状态

- 本轮源码和文档仅在独立本地整合目录中，detached HEAD 基于用户版；没有提交、推送或 PR。
- 原用户目录与 THY 对照目录保持独立；本轮未修改云端分支，不声称本轮整合已在 GitHub 可用。
