# 交接：选项内推荐标记与 BoT-SORT 当前组合

- 日期 / 时区：2026-10-04 20:48，Asia/Shanghai（UTC+08:00）
- 成员：Linzeyu912
- 任务 / Issue：用户要求推荐标记位于展开选项右侧、保留球场优化；随后重申优先使用 BoT-SORT。GitHub 当前打开的 Issue 列表为空。
- 分支：main
- 提交：未提交、未推送。
- 状态：本地完成。

## 本次完成

- `engineering/tools/player-review/model-selection.mjs`：顶部和视频库共用可访问选择列表，推荐项始终在选项右侧带黄标，收起只显示名称；支持鼠标、方向键、Home / End、Enter / 空格、Escape 和 Tab。保留原 select 值与模型组合契约。
- `engineering/tools/player-review/index.html`、`pipeline.css`：移除收起时的旧标记，增加列表布局。
- `engineering/tools/player-review/video-library.test.mjs`：补齐测试 DOM 替身的属性和父节点接口，保留原回归断言。
- 当前 005 页面通过“应用组合”切到已有 `team-stable` 结果，真实组合为篮球 YOLOv8n + BoT-SORT 外观续接；未发起新推理。旧 `ebard` 结果保留。
- 更新 `engineering/docs/model-selection-layout.md`，记录推荐位置及用户跟踪器偏好。
- 更新 `engineering/docs/court-fullcourt-calibration.md`，记录 005 半场参照与全场移动镜头的双重回归要求。

## 结论与依据

- 旧页面 URL 的 `variant=ebard` 对应 ByteTrack 历史结果，之前恢复入口时未切换结果。当前已按用户要求切为 `variant=team-stable`，没有把旧数据改名。
- 组合配置本来就以 `team-stable` 为默认，浏览器同时验证导入为 `ebard` + `botsort-reid`。用户认为 BoT-SORT 效果更好，作为本聊天的使用偏好记录，不冒充本轮模型精度实验。
- 用户再次附上的 36 秒全场视频 SHA-256 与既有测试一致：`994c43388a2c31a44fcc8259bba1d4d71abab0dd439aed46da09c22e14012b23`。对应 `engineering/research/court-fullcourt-20261004.md`，没有登记成新增独立样本，也未重复生成精度结论。
- 半场边线、多帧点线优化与全场中线 / 两端约束均保持；中圈模板和圆弧残差接口保留，但该片中圈被队徽遮挡，自动圆弧语义提取仍未通过真实样本验收。

## 验证

- `node --check engineering/tools/player-review/model-selection.mjs` 通过。
- `node --test model-selection.test.mjs video-library.test.mjs`：15 / 15 通过。首次因测试 DOM 替身缺少 `setAttribute` 失败，补齐后复跑通过。
- 实际浏览器验证非推荐项被选中时仍显示推荐项黄标、点击选择更新组合、Home / Enter 选择、Escape 取消不改变选择、视频库默认 BoT-SORT，以及当前结果切换成功。
- 浏览器最终错误日志查询为空；相关文件 `git diff --check` 通过。
- 本地证据在 `artifacts/option-recommendations-20261004/`，包括修改前备份、15 项测试日志、浏览器结果、截图和文件保护检查。

## 阻塞与待确认

- 无本轮 UI 阻塞。球场全场精度仍按既有研究记录待复核；本轮未更改算法，没有新增泛化结论。

## 下一步

- 继续按篮球 YOLOv8n + BoT-SORT 路线工作；球场改进需同时检查 005 局部贴合与全场跨中线的一致性。
- 新视频的全場标定先独立验收，再分别验收人物 / 脚点，最后联合到 2D。

## 同步状态

- 开始时已 fetch；本地 HEAD 与 `origin/main` 均为 `aada11c039d877bf326f3c6369393b178ddfab87`，领先 / 落后均为 0。
- 本次改动仍在本机，其他任务的未提交修改保留。
