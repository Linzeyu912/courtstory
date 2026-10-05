# 交接：三项 Hoop 模型发布深查与历史权重实测

- 日期 / 时区：2026-10-05 20:45，Asia/Shanghai
- 成员：Linzeyu912
- 任务 / Issue：用户要求专项核实 HoopTransformer、Hoop-MSSL、HoopEval 是否开源模型；本库开放 Issue 查询为空，无新建 Issue / 职责分配。
- 分支：main
- 提交：研究文件未提交；本地与本轮核对的实际远端均为 `b90f816af07fa5b1b3e64de19d672a2547942408`
- 状态：专项调研与可取得权重的兼容测试完成；完整业务接入及精度验收未完成。

## 本次完成

- 新增[专项报告](../../research/basketball-models/mentor-components-20261005/OPEN_SOURCE_AUDIT.md)，按论文解释功能、输入、输出、组件位置、源码 / 权重 / 推理材料 / 许可的不同状态。
- 新增 `audit_model_releases.py`：读取公开 branch / tag 可达历史、树、全部 Issue / 评论资产链接及 Releases；三核心仓库共 58 个提交，相关 5 个仓库检查 tip 树。
- 新增 `probe_historical_hoopeval.py`；将可下载的旧权重与同提交源码配对，记录 strict 加载、输出形状、训练与 EMA 状态。
- 新增 7 份 JSON 证据；更新主报告、逐篇指南、复现说明、研究索引与团队状态。早期来源快照、模型输出及历史交接保留当时记录。

## 结论与依据

- **修正旧结论。** [HoopTransformer Issue #1](https://github.com/Mr81wx/HoopTransformer/issues/1)内作者提供 `Checkpoints_C.ckpt` 和 Colab，不能再说作者未分享权重。权重本轮匿名下载转登录，预览 401；notebook 匿名下载成功并静态审阅，但未包含完整分类推理包。
- [HoopEval 旧提交](https://github.com/Mr81wx/HoopEval/tree/3a75cad8f024e457be1b76f90ea176cb59037104)含 `1030_soft_onlyball/version_13.ckpt`，17,359,176 字节，SHA-256 `80b3a25b08cdc81ab5a68b09ab37baa73d8ea81f0a834d1967aa1fc81920cb90`。2025-11-19 后当前目录移除，历史仍可下载。
- checkpoint 记录 epoch 24、global_step 6750；主模型匹配旧格点版 `QTransformer.py`，不是当前连续坐标版。`ema_model.initted=False`、`ema_model.step=0`，不可把 EMA 副本视为训练完成。
- Hoop-MSSL 检索到的 `ytrqua3/Hoop-MSSL` 明确是第三方复现；作者 / 相关账号目录、GitHub 名称 / 描述 / README 检索尚未确认官方发布。OpenReview 直接访问受验证限制，不能据搜索无结果断言从未发布。
- 来源均采集于 2026-10-05，范围与访问限制见报告和证据。未联系作者，没有对外发送消息。

## 验证

- 旧 HoopEval 主模型和 EMA 状态各 132 项严格加载，无 missing / unexpected keys；核心参数 1,087,427。CPU / GPU 合成有效 token 前向全部输出有限。EMA 仅测试兼容，不作为有效训练模型。
- 业务输入是格点 token `[12,80,1]`、动作 `[6,80]`、边特征 `[1,80,132,1]`；输出球 Q `[80,1,6]`、球员 Q `[80,5,19]`、qSQ `[1,5,80,1]`。未做真实篮球准确性或 CPU / GPU 同输入数值一致性测试。
- 已审计树未截断。下载验证内容类型 / 哈希，避免把 HTTP 200 登录 HTML 当模型；使用 `weights_only=True`，未执行 notebook / 训练脚本。
- 文档本地链接、JSON、脚本语法及差异空白检查完成；未修改视频或生产代码，无须重跑视频入库与工作台回归。

## 阻塞与待确认

- Transformer 权重当前匿名访问受限；完整分类头 / 标签、平均池化边界、向量库对应版本未齐。
- MSSL 官方发布未确认；第三方此前前向错误未在本轮修复。
- Eval 旧 checkpoint 与最终论文的关系、动作 / 格点 / 球员映射、训练配方和许可未确认。前向成功不是本项目评分验收。

## 下一步

- 若继续战术识别，先解决 Transformer 匹配权重及分类包，并准备人工确认的回合轨迹 / 标签；MSSL 保留为任务设计与训练路线。
- 若继续动作评价，以固定旧提交及 `model.` 状态核对前处理 / 真实回合，再做独立盲审与分布外测试；不要直接接当前主分支或采用未初始化 EMA。
- 可按 `REPRODUCE.md` 第 6 节重新下载和测试，复查结果放 `artifacts/mentor-research-recheck/`，避免覆盖首次证据。

## 同步状态

- 本轮与前两轮导师专题研究都留在本地 main，未提交 / 未推送。用户尚未授权本研究提交同步。
- 本轮末次远端核对仍为 `b90f816af07fa5b1b3e64de19d672a2547942408`，没有新建分支 / PR、覆盖他人改动或执行 force push。
- 第三方源码、权重、notebook / 登录页面下载及论文放忽略目录 `tmp/mentor-research/`，没有作为共享附件入库。共享证据不保留邮件地址 / 线程 / 通知退订链接。
