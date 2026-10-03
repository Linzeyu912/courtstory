# 战术冻结帧叠加工具

2026-10-03 接入补充：独立引擎现已通过工作台左栏「战术分析与讲解」提供冻结帧审核、动作编辑、保存和导出；实时播放叠加仍未实现。候选数据位于 `data/tactics/`，新增本机适配入口 `workbench-cli.mjs`。详见[整合说明](../../docs/workbench-integration.md)。下方早期独立工具说明保留其复现接口。

这是独立、只读的战术叠加引擎和静态核对报告。它消费已序列化的 schema 2 审阅快照与绑定的 play 定义，不修改 player-review 工作台、正式草稿、原视频或轨迹，不调用服务 API。合成规则演示和真实候选必须分别导出到不同目录；真实候选的身份、接地、标定和掩护关系仍需人工复核。

运行要求：Node.js 22+，无新依赖。本轮实际测试 Node **v24.15.0**；没有把 Node 22、真实战术验收或播放器接入算作已经验证。报告使用现代浏览器的 `ResizeObserver`。

## 导出与查看

```powershell
node engineering/tools/tactical-overlay/export.mjs --review <review.json> --play <play.json> --frames <frames.json> --out artifacts/tactical-overlay-preview
python -m http.server 8890 --bind 127.0.0.1 --directory artifacts/tactical-overlay-preview
```

浏览器打开 `http://127.0.0.1:8890/index.html`。8890 的服务根只包含产物；不要占用工作台 8876。HTML 自包含，JPEG、manifest、初始 SVG、渲染函数和阶段列表均内嵌，也可以直接打开本地 `index.html`。没有网络视频请求、seek 或新增自定义服务器。`--title "标题"` 可选。

不提供 `--frames` 时仅输出清楚标注的球场 2D；`synthetic:true` 的输入显示“合成规则演示”，真实输入显示“真实候选 · 仅 2D”。有精确 JPEG 但冻结投影不可用时也只显示 2D，来源索引仍保留已验证的 JPEG 记录。阶段按钮使用 play 的 `order`、`title` 和默认 `freezeFrame`。

每次导出先验证全部阶段和必要资产，再发布完整报告。输出目录必须为空或已有本工具的 `source-index.json`，不能包含任何输入快照/帧资产；已有目录通过规范化路径和软链接解析保护。失败的重新导出会把本工具的入口页和来源索引改为明确的“拒绝叠加”，入口页不留旧 JPEG/几何。旧阶段文件保留供排查，来源索引不再引用它们；应从本次成功的入口页/来源索引进入。新目录在资产校验失败时不创建产物。

所有实际输出目标在发布前检查；已有软链接或多重硬链接会拒绝导出。写入使用同目录的独占临时文件再替换目录条目，不截断或跟随已有目标。拒绝时只安全替换本工具的入口页/来源索引，保留它们链接的原文件字节与阶段文件别名。`frames:[null]` 等已解析但无效的索引记录也进入拒绝流程，不保留先前成功场景。

## 帧索引与来源证明

调用方提供的最小索引：

```json
{
  "videoSha256": "与 review 和 play.sourceBinding 完全相同的 SHA256",
  "frames": [
    {"frame": 100, "time": 4.004, "file": "frames/frame-100.jpg", "sha256": "该 JPEG 实际字节的 64 位 SHA256"}
  ]
}
```

`frame` 是 review 本地零基安全整数，`time` 必须精确等于 `review.sourceFrameMapping[frame].time`，不能用 fps 重算。`file` 相对 **frames.json 所在目录** 解析，也接受绝对路径。每个阶段默认冻结帧都需要一个自己的索引记录，即使该阶段视频投影不可用；同一冻结帧可被多个阶段引用。重复帧索引被拒绝。

可选的索引顶层 `sourceBinding` 若提供，全部字段必须与引擎重新计算的 binding 相同；建议真实 producer 提供它。记录可选 `sourceFrame` / `sourceTime` 若提供，必须与 review 映射一致。工具检查实际文件字节的 SHA256、JPEG 首尾标记、精确冻结帧/时刻、视频摘要、提供的来源字段和 review 的完整 binding。HTML 构建 API 也重新校验内嵌字节 SHA256 与场景 binding，避免调用者拼入另一个阶段的图片。

**索引是调用方提交的 provenance，不是独立证明 JPEG 确实从该视频正确解码。** 本工具不解码视频或 JPEG，也不证明画面内容/尺寸或真实提取过程。真实 producer 应另保存提取命令、视频字节摘要、原始帧/时刻映射、解码工具版本和提取证据；浏览器验收要确认 JPEG 能加载，画面与对应帧一致。真实素材不得用合成夹具或仅 SHA 一致代替人工验收。

## 公共消费接口

```js
import {renderOverlaySvg} from './render-svg.mjs';
import {buildPreviewHtml} from './preview.mjs';
import {exportPreview} from './export.mjs';

const svg = renderOverlaySvg(manifest, {
  mode: 'video', // 或 'court'
  viewport: {width: 1280, height: 720} // 实际 CSS px，不乘 devicePixelRatio
});
const {scenes,index} = await exportPreview({
  review, playDefinition, frames, framesDirectory,
  outDirectory, title, options, inputFiles: []
});
const html = buildPreviewHtml({title,scenes});
```

`renderOverlaySvg` 是可在 Node / 浏览器执行的纯函数，只消费引擎 manifest：视频读取每点 `freezePoint`，2D 读取 `courtPoint`，不使用旧 `imagePoint`。它保留真实分段和完整点序列，不插值、补长、平滑或重新判断时间状态。方向来自 `segments[].arrow` 与当前有效段的末端切线。未确定朝向的关系没有横杠，参与关系和质量在报告外侧逐项列出。静态角色使用引擎 marker，全 roster（包括缺席者）保留在可见列表和 SVG 可访问描述中。

`roster[].actionStates` 只列出该人作为 `actorId` 执行的动作，`roles` 保留原声明角色及这些动作的 kind。关系参与者仍完整留在 action.participantIds、roster 和高亮集合；新增的 `relationStates` 明确保存 `{relationId,actionId,role,temporalStatus,screenerId,beneficiaryId,defenderId}`，role 为 `screener / beneficiary / defender`。可见名单分别说明掩护者、受掩护者和相关防守者，同时保留每个人自己的并行动作；参与掩护关系不表示执行掩护。

`future_action_start` 使用空心虚线圈与“后续起点·P?/帧?”标签，帧号读取该点的 `sourceFrame`；当前冻结位置保留实心标记。即使两个标记重合，后续标签仍保留，不把后续起点画成另一处当前球员位置。

标签按同一参与者、同一画面位置聚合，分别写出“冻结位 F?”、“当前 / 后续 / 已完成”的静态角色，以及独立的后续起点来源帧。完整名字留在外侧名单，画面用 P 编号缩短文字。纯渲染函数按实际 CSS viewport 计算文字框并避让，引线明确连接原始标记；`textLength` 使用固定估算字宽约束实际文字长度，同一函数在 Node 和浏览器保持确定性。文字框移动不修改任何数据坐标、标记或路线。若给定视口无法容纳全部标签则明确抛出布局错误，不静默丢人或裁掉文字；接入方应提供足够显示空间。

不透明标签还会避开实际绘制的路线描边、箭头头部和掩护横杠，包括外轮廓与端点；保护区直接来自同次绘制的几何，不改变来源点或动作状态。空间不足时继续使用下述完整画布滚动处理，不以遮住路线或把路线画到文字上方解决。

静态报告会捕获标签空间不足，依次用更宽的 640 / 960 / 1280 CSS px 画布重绘，并明确提示横向滚动查看全部标记。画布实际 CSS 尺寸与 SVG 渲染尺寸一致，不把旧 SVG 缩小来凑宽度；切阶段会发布完整的新背景/叠加。窗口重新变宽时自动回到可容纳标签的自然宽度。1280 是报告构建时已成功验证的尺寸；若发生其他绘制错误，报告清除旧场景并显示具体错误，不把旧图误充为新阶段。

6 / 18 / 2 默认线宽、箭头尺寸、描边来自 `styleHints`，单位为 CSS px。坐标按实际 viewport 映射；HTML 在每次容器变化时从同一个 manifest 重新绘制，避免缩小 viewBox 使线/箭头变细。独立 SVG 保存于 1280×720，属于透明叠加；对应 JPEG 与来源索引另存。视频按原图比例居中 contain，SVG 使用相同映射。

`buildPreviewHtml` 是 **Node 同步构建器**（使用原生 SHA256 校验），返回字符串；其内嵌运行时和 renderer 无 Node 依赖。`scenes` 应使用 `exportPreview` 返回的记录：

```js
{
  title, mode: 'video' | 'court', manifest,
  background: null | {
    frame,time,sourceFrame,sourceTime,videoSha256,sha256,
    sourceBinding,file,dataUrl: 'data:image/jpeg;base64,...'
  },
  manifestFile,svgFile,frameFile,svg
}
```

手工调用构建器时至少提供 `title/mode/manifest/background`。video 必须带完整且一致的背景字段，court 必须 `background:null`。构建器忽略调用方旧 `svg`，从本次 manifest 重建；文本、SVG 属性、嵌入 JSON 均转义。按钮一次替换整幅背景与叠加，同时更新时间、名单、关系和来源详情，不保留上阶段几何。

## 产物

```text
<out>/
  index.html                       自包含阶段报告
  source-index.json                来源摘要、每阶段映射、产物 SHA256 与 JPEG 元数据
  stage-001.manifest.json          原样引擎 manifest
  stage-001.video.svg              或 stage-001.court.svg
  stage-001.freeze.jpg             提供帧索引时保存实际已校验 JPEG
  stage-002.* / stage-003.* ...
```

来源索引 `producer=tactical-overlay-static-v1`；`status=ready/refused` 是导出状态，每场景 `status` 保留引擎 `ok/partial`。索引包含全部 `sourceBinding`、playId/revision、阶段 ID、freeze/time/sourceFrame/sourceTime、mode、manifest/SVG 文件与 SHA256、frameFile 和原始 JPEG 元数据。自包含 HTML 不依赖这些外部文件。

## 验证

```powershell
node --test engineering/tools/tactical-overlay/consumer.test.mjs
node --test engineering/tools/tactical-overlay/binding.test.mjs engineering/tools/tactical-overlay/overlay.test.mjs engineering/tools/tactical-overlay/consumer.test.mjs engineering/tools/tactical-overlay/candidate.test.mjs
```

Consumer 测试覆盖完整时序和多人静态/掩护、CSS 像素 resize、文字注入保护、真实文件字节/摘要/映射拒绝、整场景切换、输入不写回及失败入口页。Node VM 只测试本工具输出的阶段脚本与 DOM 边界行为，不能替代真实浏览器视觉、JPEG 解码和高 DPI 验收。旧工作台未修改，旧 suite 本轮由主任务管理，不在该命令重复运行。

## 可复现的两类演示

[005 候选来源与完整复现步骤](fixtures/005-candidate/README.md)包含锁定文件 SHA、11 个身份区间和真实缺口、精确帧提取方法，以及中断后的恢复步骤。

```powershell
node engineering/tools/tactical-overlay/fixtures/005-candidate/generate.mjs
node engineering/tools/tactical-overlay/export.mjs --review artifacts/tactical-overlay-preview/real-input/review.json --play artifacts/tactical-overlay-preview/real-input/play.json --frames artifacts/tactical-overlay-20261002/frozen-source/frames.json --out artifacts/tactical-overlay-preview/real --title '005 SAS–MIA · 三阶段真实候选'
node engineering/tools/tactical-overlay/export.mjs --review artifacts/tactical-overlay-preview/synthetic-input/review.json --play artifacts/tactical-overlay-preview/synthetic-input/play.json --out artifacts/tactical-overlay-preview/synthetic --title '合成规则演示 · 多人发动与分阶段箭头'
```

使用本页开头的静态服务查看 `/real/` 与 `/synthetic/`。原始四帧边界夹具保持不变；新增合成视觉夹具采用 0.1 秒间隔与约 3–5 米位移，使路线可读，同时使用引擎原来的速度和缺口保护。

真实 005 的三个阶段保持完整 play `[0,143)` 和全部六位参与者，冻结帧为 15/40/90。所有质量仍为 `needs_review`、整体 `partial`；位置是未经接地确认的框底代理。139 个场地候选仅在独立副本采用为参考，原状态和来源保留，108–111 无效帧及身份缺口不补线。真实掩护朝向未知，横杠明确不可用；合成演示有完整横杠。没有修改真实草稿、既有前端或播放器。

接入时让队友保留现有 schema 2 导出边界，调用异步 `createSourceBinding(review)` 建立 play 的绑定，再按 phase/freeze 调用 `buildTacticalOverlay`。可直接复用 SVG renderer，也可消费 manifest 绘制；必须保留完整 roster、分段、时间状态、各项质量和来源映射。当前先交付独立静态报告，live video 的帧同步要求见下节。

## 未来 live video 接入的必要条件

当前报告没有接入播放器。未来接入必须在发起 seek **之前隐藏叠加**，收到实际呈现帧证据并确认视频字节摘要、来源绑定、frame/time 与 manifest 一致后才恢复；seek 失败、超时、切镜、来源变化或帧不匹配时保持隐藏。仅 `seeked`、请求时间或上一帧像素不能作为实际呈现帧已匹配的证明。不要把本静态预览称作已经实现该同步。
