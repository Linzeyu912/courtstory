# 分队、稳定标注与脚下定位环

日期：2026-10-02，Asia/Shanghai。状态：本轮分队展示、稳定框和脚下编号已完成本机验证，最终版本为 r3。代码、草稿和产物仍在本地，未提交推送；自动十名真人身份与地面定位精度尚未验收。

## 用户目标与范围

继续现有篮球数据工作台：两队各五个固定球员槽位、同队同色、减少框和数字跳动、在脚下提供定位入口。模型与人工判断继续分开保存；不替换已有人工身份，不为凑满十人生成遮挡坐标。本轮扩展已有显示、复核和导出成片流程。

## 当前技术与跳动原因

用户提到的“Beta Track”推测指 ByteTrack。ByteTrack 将高分和低分检测分别关联，低分目标仍有机会续接轨迹；它本身不提供球队、球衣号码或地面脚点识别。[作者论文](https://arxiv.org/abs/2110.06864)、[作者代码](https://github.com/FoundationVision/ByteTrack)。

当前已用 BoT-SORT、原生 ReID 和 sparseOptFlow 相机补偿，并包含 ByteTrack 式低分续接。保留该关联方案；这次优先改进队伍归组与标注展示。[BoT-SORT 作者论文](https://arxiv.org/abs/2206.14651)、[Ultralytics 官方文档](https://docs.ultralytics.com/modes/track/#bot-sort)，采集于2026-10-02，实际参数以本机配置为准。

修改前的输出使用真实检测框，未直接使用 Kalman 估计框；UI 和 MP4 原样逐帧绘制。同一 T2 的框底在帧158/159/160为639.09/718.18/640.91像素，身份没有改变，但标签跟着框角大幅跳动。修改前建议按共同帧左右顺序分配十个编号，尚未按队伍排序；UI 有十种颜色，模型建议统一黄棕，成片无脚下环。

工作台原来已有 bbox_bottom_center 小圆点：它是框底中心近似，不等于脚与地面接触位置。白衣7号在帧159被比分条遮挡脚部，尤其不能把框底当作已验证触地点。后续姿态脚踝、接触判断和球场标定是另一个准确性问题。

## 交付原则

- 同队颜色持久绑定到球员分组，避免逐帧跟着球衣亮暗改变。新建议按可靠多帧颜色分到P1–P5/P6–P10，每队最多五名；未知、冲突及超额候选留待人工，不强凑。
- 原人工编号、姓名、球队文字、号码、身份时间点和补点保留。模型分组仍待核对，人工可修正。
- 几何平滑仅用于显示；保留原始检测和人工坐标。切镜、缺失、出画、冲突和身份边界不沿用滤波，人工修正精确生效。脚下编号环说明是图像近似点，不输出准确地面测量承诺。
- 采用独立team-stable版本，保留原版本和草稿。四段视频复用已有检测结果，记录父候选与实现来源；本轮不重训模型，也不改BoT-SORT关联规则。

## 运行与验证

### 已交付行为

新 `team-stable` 版本保留两个五人组：新建议 P1–P5 为蓝队（`#38bdf8`），P6–P10 为橙队（`#fb923c`）。人工可修正分队，每队最多五人；原人工编号不重排。颜色绑定固定身份，不随当前帧球衣亮暗重新切换。模型颜色证据不足、跨队冲突、弱第三色和超额候选留待确认，不为凑满五人强认。

身份与分队分别确认。只确认其中一项，仍保留问号 / 虚线；两项都确认后才去除问号，队色不变。未知分队为灰色，估计位置保留 `~` 和虚线。人工 `teamGroup` / `teamGroupSource` 与 `modelTeamGroup` 分开，原 `team`、姓名、球衣号码和身份锚点保留。

展示几何使用确定的三帧居中中位数与限幅混合策略，参数统一保存在 `engineering/tools/player-review/team-overlay-policy.json`；相邻观测时间间隔上限0.12秒，720p坐标偏离上限64px，按高度缩放。切镜、缺失、身份 / 来源 / 绑定边界、人工锚点不穿越，不向遮挡帧补坐标。最多参考后一帧，适合当前离线短片，未验证零延迟实时能力。暂停、回看、跳转不依赖此前播放状态。

稳定框底绘制同队色椭圆和编号。它是图像框底参考，不是已验证脚踝 / 地面接触点。稳定显示默认开启，关闭后可编辑原始框和脚点；进入坐标编辑自动关闭稳定显示，人工小数坐标原样保存。导出轨迹与球场投影仍使用原始或人工坐标，显示滤波不改写它们。

UI 与 MP4 共用政策和对应 JS / Python 展示实现。独立验证逐帧比较四段真实数据的一致输入，两端几何、颜色与样式完全一致；字体字形不保证逐像素一致。下面的 MP4 使用冻结的模型建议，不包含浏览器 QA 草稿里的人工操作，也没有新增上传推理 API。

### 同片结果

| 样例 | 帧数 | 蓝 / 橙候选 | 待分队候选 | 原运动残差 P95 px | 稳定展示 P95 px |
|---|---:|---|---:|---:|---:|
| 004 | 210 | 2 / 3 | 5 | 15.409 | 11.869 |
| 005 | 143 | 5 / 4 | 1 | 10.347 | 6.793 |
| 006 | 462 | 5 / 3 | 2 | 10.227 | 6.541 |
| nba-lal-min-005 | 267 | 4 / 4 | 2 | 7.500 | 4.994 |

运动残差指框底Y与相邻有观测帧按源时间线性连接的差值，包含真实球员 / 相机运动，只证明展示尖峰减少。它不是身份准确率、IDF1、MOTA或真实脚点误差；候选人数也不代表已确认不同真人，且不保证每帧都可见。

LAL 的 T2 在帧158/159/160，框底从 **639.09 / 718.18 / 640.91** 变为展示 **639.77 / 660.23 / 640.91** px。该片最大运动残差84.77→31.59px，610个有观测的展示帧发生几何调整，填补缺失帧数为0。帧159脚仍被比分栏遮挡，椭圆落在比分栏附近，不能据此确认真实触地点。

### 验证与发现的修复

首次实现后独立审查发现并修复：服务器缺少两条静态资产导致界面无法启动；只确认身份错误地消除分队不确定性；弱第三色挤掉主要白色球队。三个问题都有失败反例，修复后 **71个JS + 40个服务 / 剪辑 / 展示Python + 38个跟踪 / 渲染Python，共149项**通过，构建和语法检查通过。

实际浏览器又复现既有坐标表单的原生 `stepMismatch`：初始高精度坐标被当成步进基数，`650.25 / 400.75` 无法提交。最终r3仅把精确坐标输入的两组 `step` 改为 `any`，保留有限数、框范围和原始坐标校验；**17项相关既有保存 / finite回归**、构建、语法及四段真实loader通过。该17项是针对最后两行修正的回归，含已有测试，不当作149之外的新增独立测试数量。

独立代码审查初版全范围、r2三项修复及r3两行收尾分别执行，最终批准相应范围。独立数据 / 媒体验证四段默认入口200、来源SHA、原候选字节、policy / implementation / sidecar、JS / Python全帧一致性。原四源视频、24个旧候选 / meta / 成片、10个旧HTTP指纹，以及r1 / r2 / baseline证据字节均保留。

最终LAL预览完整解码 **267帧、1280×720**，全部精确PTS与源视频一致（0.120–10.760秒），**508个AAC包**的内容、PTS、DTS、duration、time base与codec配置完全保留，包括预滚包。

真实浏览器只操作 `&qa=1`：工作台启动 / 建议采用、两队槽位与标注、身份与分队分开确认、精确脚点与框保存、稳定显示开关、重复采用、刷新及版本切换保留人工姓名 / 球队 / 号码 / 身份锚点 / 坐标、每队容量、完整播放及测试导出保护通过。P3测试脚点 `650.25 / 400.75` 与框 `595.25 / 264.75 / 706.125 / 397.375` 精确恢复，旧optimized中P8的白衣7号记录保留。未代用户确认正式数据；测试资料不是真人身份或地面精度验收。

### 最终文件与复现

最终本机产物在 `artifacts/player-team-overlay-20261002/r3/`，依赖 / 权重 / 产物为忽略目录，Git同步不自动带走：

- 四段 `{004,005,006,nba-lal-min-005}-team-stable.json` 与相邻 `.meta.json`，raw JSON字节与各optimized父候选一致。
- `team-stable-preview.mp4` 与sidecar；视频SHA `0602110be739bc09337f545eef904c4f28aa82bfb986df34cb39e786b47d3af5`。
- `geometry-comparison.json`、`independent-verification.json`、`independent-data-verification.json`、`independent-revision-parity.json`。
- `workbench-team-overlay.jpg`、`workbench-coordinate-green.jpg`及保存 / 容量 / 旧草稿 / 版本返回 / QA导出文本证据。

政策SHA `e19da8dcae76d0203ac1a9f87d0dd6af9bff9797c9be69fee685491f1a80e011`；最终实现SHA `597bbf6e27d9c778685b88cab864312a34b881830e6d6ea7c417fd2be4a3a216`；LAL fingerprint `b4dc5e31154d4633d3c191f426e97388c2faa3eed5dfa725d6edccccdc988d15`。r1/r2文件和首次失败证据保留，不覆盖后冒充首次成功。

详细作者 / 独立审查 / 验证日志在本机 `tmp/player-identity-test/team-overlay-task-report.md`、`team-overlay-r3-code-review.md`、`team-overlay-r3-verifier-report.md`、`team-overlay-browser-qa.md`。共享文档记录结论，忽略目录证据需另行传递。

工作台正式入口 `http://127.0.0.1:8876/?sample=nba-lal-min-005&variant=team-stable`。保留整段并进入球员标定，载入建议，逐人确认身份与分队；发现串号在错误起点重新关联。留在浏览器的演示带 `&qa=1`，正式入口使用独立草稿。

```powershell
# 在仓库根目录；本机已有候选时仅启动工作台。
& 'tmp/player-identity-test/.venv/Scripts/python.exe' engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876

# 重新准备时用新的目录；不可覆盖已验证的r3文件。
& 'tmp/player-identity-test/.venv/Scripts/python.exe' engineering/scripts/prepare_basketball_team_overlay.py --output-dir artifacts/player-team-overlay-reproduction
& 'tmp/player-identity-test/.venv/Scripts/python.exe' engineering/scripts/basketball_render.py --video 'data/videos/nba/2024-25/clips/005_LAL-MIN_Q2_catch-shoot_10.8s_720p.mp4' --tracks 'artifacts/player-team-overlay-reproduction/nba-lal-min-005-team-stable.json' --output 'artifacts/player-team-overlay-reproduction/team-stable-preview.mp4'
```

本轮复用已完成的四段篮球候选做离线准备，不重新跑检测模型；显示来源中的GPU / 模型运行信息来自父推理meta。更换视频必须先生成匹配候选，不能把此服务当作自动视频推理端点。

## 尚未解决

T21 / T12等原生跨队串号仍存在，自动轨迹片段连接仍为0；本轮不改关联核心。几何滤波无法把错误身份变正确，也无法区分同队球员。持续错误、快速变向和比分条遮挡仍可能使标注不稳或偏离真实脚下。

自动确认十名真人、遮挡后的可靠同人续接、真实姓名 / 球衣号码OCR与2K匹配、真实地面脚点与米制定位、战术分析和云部署尚未验收。可以继续用现有人工分段关联 / 补点复核；后续自动改善需分别评测身份与位置，不用更低几何变化量代替准确率。
