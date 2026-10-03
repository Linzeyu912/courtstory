# 交接：人工展示路线编辑

- 日期 / 时区：2026-10-03 17:42，Asia/Shanghai。
- 成员：thy-0629。
- 任务：未来路线 Task2；直接 main，本地选择性提交，不推送。
- 状态：实现与定向验证完成，等待独立审核；播放接入由 Task3 完成。

## 改动

消费 Task1 预建平滑合法路线；画内去除球员文字标签，画外选人及帧锚点控件。支持拖动、插/删内部点、来源恢复与原文档撤销；pointerup 单次提交，取消/加载/阶段/上下文变化阻止迟到修改。展示修正复用原 IndexedDB/CAS 保存链，仅持久化顶层 presentation。保留审核名单与问题折叠详情。

主场景背景 canvas 与容器稳定，提供同步播放绘图钩子；纯展示修改复用已验证冻结 JPEG。独立浏览器反馈促使选中路线改深蓝加白衬边，并仅在球员最后剩余段显示落点圈；合法断段没有跨接。冻结报告 UI/正文明确其范围不含新展示修正，JSON 保留完整修正。

接口、文件与使用边界见[编辑说明](../../engineering/docs/future-route-editor.md)和[几何说明](../../engineering/docs/future-route-geometry.md)。依据为用户本轮无标签要求及独立浏览器 005 phase2 实测反馈，未新增赛事要求或审核真值。

## 验证与边界

新增编辑 8 项、UI 集成 1 项、报告 1 项、renderer 1 项通过；Task1/文档已有 21 项回归通过。后端 TacticalWorkbench 6 项通过，新模块 QA 静态路径 200/text/javascript，JS 语法及 diff whitespace 检查通过。

修改未推送；真实身份/接地点/球场标定精度仍需人工验收。播放尚未接入，新 HTML 冻结报告保留既有审核绘图并明确不含新展示路线。原有未跟踪文件及其他任务计划/规格增量未暂存。

根任务独立浏览器QA：005 phase2 P2 UI69–78段真实拖动、插帧73、删除、撤销、恢复来源、撤销恢复、本机v1保存和刷新恢复4点manual通过；画内无球员文字，深色及仅最终落点已实际观察。证据保存在被忽略 `artifacts/future-route-editor/browser-editor-qa.md` 与 `qa-server/editor-restored.jpg`，背景复用最终集成轻测仍由根任务执行。
