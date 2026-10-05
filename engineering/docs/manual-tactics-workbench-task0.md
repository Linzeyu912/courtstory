# 006 人工工作台：Task 0 源码与实操核实

日期：2026-10-05，Etc/UTC。先 fetch 并同步 `main@36ab6e59fe44f56196604324f31640e5d40333fb`；工作区原先干净，开放 GitHub Issues 查询为空。来源为用户附件 006、[005 视觉机制](005-authored-v2-workflow.md)、[编排指南](tactics-authored-production-guide.md)、[旧 2D 指南](2d-first-tactics-workbench-guide.md)和两份对应实施计划。旧 2D 计划的默认流程由本次明确的“视频人工优先”要求更新，保留底层能力与历史记录。

## 浏览器基线

Chromium + Playwright，通过现有 HTTP 服务打开独立的 8.1 秒 / 10 fps 合成视频，无识别框、无 AI、无标定、无草稿。仅基础视频与逐帧 PTS 在测试前准备，战术对象通过点击界面创建。

- 直接进入战术制作可建立空白画布，但默认 SVG 是 `0 0 28.6512 15.24` 的 2D 球场。
- 点“＋讲解关键帧”：提示“先选择要讲解的图形”，不能先建空白暂停点。
- 切“实拍投影预览”，把新建区间设为 1–5 秒，点击两个端点：对象建成，但其时间回显 **1–8.1 秒**，视频空间未消费新建区间。
- 定位原片 3 秒：路线消失，提示“此图形仅用于添加时的画面”。固定画面全区间和按时间裁短尚未支持。
- 基础暂停关联因此不能完成后续“未来传球/挡拆 → 冻结展示 → 恢复”；未把现有 MP4 按钮视作该流程通过。正式编排预览和下载已接同一个任务，但当前文档缺少需要的内容语义。
- 基线相关 5 个 Node 测试文件执行通过；它们未覆盖上述人工缺口。日志及浏览器截图保存在本轮独立临时验收目录，交付验收将写入工程记录。

## 真实修改映射

| 责任 | 文件与调用关系 | 已有能力 / 缺口 | 对应验证 |
| --- | --- | --- | --- |
| R1 页面、工具、选择 | `engineering/tools/player-review/tactics-ui.mjs`，由 `app.mjs` mount；`tactics.css`；`video-library.mjs` | SVG 命中、拖点、移动、挡拆旋转已接通；默认 2D、四点仅地面新建、无主弯曲柄/复制、AI 面板默认展开；导入默认先识别 | `tactics-ui.test.mjs`、新增人工浏览器验收 |
| R2 时间 | `tactics-timeline-ui.mjs` → `tactics-time-range.mjs` / `tactics-court-editor.mjs` | 真 PTS 吸附已有；新建视频对象未消费选区，默认整片；无逐对象全列表时间条与整体移动；区间重定位使用帧比例且旧起点覆盖顺序有问题 | `tactics-time-range.test.mjs`、`tactics-court-editor.test.mjs`、人工 VFR / 10fps 用例 |
| R3 文档、保存、撤销 | `tactics-document.mjs` → `tactics-annotations.mjs` / `tactics-keyframes.mjs`；`tactics-storage.mjs`；`engineering/scripts/tactical_workbench.py` | 单一 `annotations.items`、IndexedDB 自动草稿、本机版本冲突、撤销/重做已有；需可兼容的新固定画面/基础暂停字段、保存失败状态、一次操作一次历史 | 旧稿往返、刷新、失败重试、拖动一次撤销 |
| R4 曲线/进度 | `tactics-annotations.mjs` → `tactics-authored-geometry.mjs`；`tactics-presentation.mjs` 提供逆投影 | V2 三次曲线、弧长裁短、宽箭头已有；手工视频对象不能用；剩余过短淡出不完整；校正只给旧 authoredPath 帧号/百分比 | `tactics-route-render.test.mjs`、新增几何/手工校正测试 |
| R5 暂停/调度 | `tactics-keyframes.mjs` → `tactics-production.mjs::compileProduction`；`tactics-playback.mjs` | 输出/源时钟分开、同帧合并 max hold 已有；现有 cue 必须有对象且在对象区间内；不能提前展示未来动作；无共享基础最短停留，旧冻结只有绘制/停留 | `tactics-keyframes.test.mjs`、`tactics-production.test.mjs`、首尾/同帧/后续暂停测试 |
| R6 预览/导出 | `tactics-production-ui.mjs` → `/api/tactics-render/jobs` → `engineering/scripts/tactics_render.py` → `engineering/tools/tactical-overlay/production-worker.mjs` → 同 `renderProductionSvg` | 同份不可变快照、digest、Sharp/PyAV/FFmpeg 正式链路已有；需先保存当前版本再预览、显示来源版本；固定画面及提前讲解必须通过同引擎 | `tactics-production-ui.test.mjs`、`test_tactics_render.py`、真实界面下载 MP4 / 完整解码抽帧 |

## 契约和兼容边界

- `review.sourceFrameMapping[].time` 是当前素材源 PTS，保存范围零起点、半开 `[startFrame,endFrameExclusive)`。`sourceTime/sourceFrame` 保留裁切来源；`mediaEndTime` 由真实解码时长或有效流时长确定。输入秒数用 lower bound 吸附并回显实际时间，不能使用秒 × 30。
- 已有 `space:'court'` 是标准米制坐标，通过当前帧映射反投影；`space:'video'` 是 `review.width/height` 参考分辨率下的像素。旧 video 标记仍只在参考帧。新固定画面标注需显式字段与参考尺寸，不能静默改变旧稿含义。
- 认可样片使用 Bezier 参数 `t` 裁剩余曲线；现有普通 V2 跑位用采样曲线的**弧长比例**裁短。人工点击校正必须针对对象已有模型计算，不能互换两种定义。
- 旧 `tacticKeyframes` 要求至少一个对象且处于显示范围。基础讲解暂停将以显式语义兼容扩展，允许空白创建和早于动作的首次关联；旧重复讲解等语义不删改。
- 旧产物编码 fps 为 30；此数值仅属于输出时钟。现有基础 V2 pause 无最小停留，draw 为最多 15 个输出基准帧。本轮统一采用 005 的约 1/6 秒停稳、0.7 秒绘制预设，基础停留最低 0.9 秒（总额外时间）；旧编排 cue 保留原自定义节奏。
- 现有地面投影缺口检测逐帧拒绝导出，不应删除。新增固定画面路径不要求映射；已有映射优先逆映射保存，缺口必须明确说明并允许另画固定画面示意。

## 实施顺序

1. 定位失败测试，补兼容字段与视频直接创建、主弯曲柄、复制、独立时间与撤销。
2. 增加剩余段淡出、点击路线校正、真实 PTS 重定位与暂停关联验证。
3. 重用正式成片服务，将保存状态、版本、预览/下载接成闭环。
4. 用无 AI 的浏览器从空白绘制 006 十步用例并下载 MP4；再验证映射、VFR 与旧内容，逐项记录未通过/未验证。

历史归档、005 认可 MP4、原始轨迹与用户草稿均不覆盖；不新建并行文档/渲染机制，不扩展 AI 分析。
