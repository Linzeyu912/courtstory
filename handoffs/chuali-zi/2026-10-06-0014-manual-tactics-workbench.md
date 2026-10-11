# 交接：006 人工视频战术制作闭环

- 日期 / 时区：2026-10-06 00:14，Asia/Shanghai（2026-10-05 16:14 UTC）
- 成员：chuali-zi
- 任务 / Issue：用户附件 006 实施，005 视觉机制参考；开工查询开放 Issues 为空
- 分支：main
- 提交：功能 [873b11a](https://github.com/Linzeyu912/courtstory/commit/873b11a0fa6a00765984df1f164928cc3d8afab5)；本文件与最终说明单独同步
- 状态：基础人工闭环实现并验收；真实比赛/005 视频回归受 LFS 素材限制

## 本次完成

- [真实文件与缺口核实](../../engineering/docs/manual-tactics-workbench-task0.md)、[用户操作指南](../../engineering/docs/manual-tactics-workbench-guide.md)、[实施及验收](../../engineering/docs/manual-tactics-workbench-acceptance.md)。改动集中在现有 `engineering/tools/player-review/` 和既有导入服务，无第二套工作台/战术文档/渲染器。
- 不识别直接打开视频，默认视频画布；跑位/方向传球/挡拆、主弯曲柄、独立秒级时间条、复制/删除/撤销；首次讲解暂停、源 PTS 裁短、点击完整路线校正；预览和正式 MP4 自动先保存并显示版本/digest。
- 固定像素与已有球场映射分别保存，2D/AI/旧脚圈及黄色圆点工具保留。历史草稿、005 归档配置/脚本/成片未覆盖。
- 修复实操发现的异步时间输入覆盖、原片重播状态、跟随脚圈默认值、透视下旧 Bezier 点击参数、临近完成孤立箭头和 VFR 片尾 nominal duration 问题。

## 结论与依据

006 十步由真实浏览器鼠标/键盘完成，没有后台预填战术对象。固定画面与 VFR 从上传入口开始；映射回归仅预备基础已知相机映射，再在界面绘制全部对象。生成请求来自正式 UI，PyAV 只在下载后完整解码检查。

本地证据（不随 Git）：`artifacts/manual-tactics-006-fixed-final/`、`manual-tactics-006-mapped-final/`、`manual-tactics-006-vfr-pass/`。每个目录有 `result.mp4`、版本 2 的 `saved.json`、`report.json`、13 抽帧、操作 WebM、trace 和日志。固定结果为 393 帧 / 13.1 秒；VFR 为 392 帧 / 13.066667 秒，源 8.05 秒，额外停留 5 秒，误差为输出帧取整。对象名称修改不入画，预览与正式任务的成片字节相同。对应摘要见验收文档。

## 验证

- 前端 `npm test --prefix engineering/tools/player-review`：500 测试通过；构建通过；最后 UI/时间条/预览 47 测试通过。
- Python 导入/正式渲染/HTTP 服务/裁剪/变体：74 测试通过；战术存储/集合/模型：22 测试通过。
- 同帧暂停、首尾/空暂停、后续无关路线、非单调拒绝、PTS 重定位、稳定箭头、旧 authored 386 帧和普通独立标记自动回归通过。
- 浏览器附加：Esc、输入 Delete 隔离、非法时间、时间条拖动一次撤销、Ctrl+D/Z、原片越过暂停播放、缩放、保存刷新、模拟 503 保留草稿后重试通过。
- 默认沙箱曾阻止 Node spawnSync 报告测试；允许本机子进程后完整前端通过。这是运行环境限制，未改测试断言来掩盖。
- overlay 56/61 通过，5 项因真实 005 LFS pointer 的源 hash mismatch 失败。全仓 `validate_video_data.py --check-index` 因一份 NBA 源未下载终止，未登记通过。

## 阻塞与待确认

真实 005 原片和作者本机认可成片未能重新播放验收：当前为 LFS pointer，下载缺凭据，接现有登录后 LFS 返回 maximum login attempts exceeded。真实比赛镜头精度、历史草稿浏览器迁移、真实 AI 草稿编辑未验证。合成映射不替代实际贴地精度。成片仍为静音 30 fps，无云部署。

## 下一步

1. 拉取 main，重启原服务，用指南在自己的比赛素材上制作。
2. 准备完整 LFS 原片与作者认可成片，再跑 005/官方训练片移动镜头和历史草稿迁移回归，保持旧字节。
3. 使用测试脚本时指定新输出目录，不覆盖本轮录像/成片；用户制作仍只操作 UI。

## 同步状态

开工同步 `36ab6e5`。发布前远端新增 `af41fce` / `0ffb9fe` / `2959791`，已重放本轮改动；视频库文档冲突保留两侧说明，默认官方训练入口和人工导入同时存在。整合后导入/渲染/HTTP/集合/模型 70 测试通过。功能已直接推送 main，实际 `ls-remote` 核对为 `873b11a0fa6a00765984df1f164928cc3d8afab5`。本交接、最终验收说明和少量操作提示随后提交推送；最终远端 SHA 由本轮交付核对。视频、草稿、模型依赖和凭据均留在本地忽略目录。
