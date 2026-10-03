# 工作台整合与战术人工审核

更新：2026-10-03，Asia/Shanghai。本文记录当前实现；分类提交与同步结果见[发布交接](../../handoffs/Linzeyu912/2026-10-03-1630-workbench-updates-publication.md)。人工核验继续使用本机草稿。

## 完整操作路径

1. 顶部「当前视频」切换已有结果；「视频库 / 导入」合并展示共享目录与本地视频文件夹，支持文件名搜索和来源筛选。共享视频直接读取已登记的文件，不复制回导入目录。尚未下载的 LFS 文件不能启动推理。
2. 分别选择 YOLO 检测器与跟踪器，或在视频库选择组合后点击「处理并打开」。默认保留原篮球优化路线，两个推荐项各有小标记；各组合继续使用独立草稿。处理成功后回到该视频的处理页，清除前一视频的战术示例导航参数。见[后续选择与布局调整](model-selection-layout.md)。
3. 顶部按「直播画面筛选 → 球员标定 → 球场标定 → 2D 轨迹核对」排列。球员与球场两项标定可交替核对；十人关联登记后继续球场标定，已有位置和映射的帧自动生成 2D 轨迹。进入第 4 步会展开球场预览，显示当前帧的关联人数、映射和位置缺口；可直接继续到数据核对或战术页。人物 / 球场未确认与缺失状态分别保留，不因投影成功自动确认。
4. 点击左栏「战术分析与讲解」→「使用当前轨迹建立草稿」。新草稿保留所有已关联参与者，初始无动作；用户自行确定动作与阶段，不自动推断战术。
5. 修改阶段名称、冻结帧，按指定帧拆分阶段；合并阶段时保留动作。动作支持跑位、切入、顺下、外弹、持位、拉开和掩护，可以改人、改区间或删除。掩护可以指定受掩护者和相关防守者；未知朝向不伪造横杠。
6. 填写审核人后点「我已核对本动作」，只记录该动作判断的人工审核；不会自动确认人物、接地点或球场标定。修改动作会撤回其旧审核，支持单独撤回与战术撤销。
7. 编辑讲解草稿与意见；「保存到本机」写入本机数据目录，重开后继续。导出审核 JSON 可保存完整来源快照；导出 HTML 得到三阶段等多阶段自包含报告，包含实际冻结图、叠加和讲解意见。
8. 日常处理由当前草稿在工作台内接续，修改会沿用原保存机制，不需要下载文件后再导入。左栏「导出与交付」保留视频和战术报告入口，并将轨迹 JSON 放在「轨迹文件备份（可选）」折叠项。视频烧录叠加、配音与字幕合成尚未实现。

## THY 示例

点击战术页「THY 三阶段示例」，切到 005 SAS–MIA 的 E-BARD 来源，读取独立候选快照。它包含 6 名参与者、14 个动作、3 个阶段，原冻结帧为内部索引 15 / 40 / 90（界面第 16 / 41 / 91 帧）。可修改动作、阶段和意见，但不会替换工作台人物或标定草稿。

「当前视频草稿」与 THY 示例分别保存。示例上的人物身份、地面位置和战术关系仍待人工核对。原候选数据已原字节迁到 `data/tactics/005-candidate/annotation.json`；生成器仍位于工程目录。跨机器 Git 的 LF/CRLF 转换只在确认为已锁定文本的纯换行差异时接受，生成的来源绑定仍使用实际本机字节哈希。

## 帧与版本绑定

- 战术页显示独立冻结图，下方时间轴用于回看原视频，二者明确区分。没有把静态报告接成未经验证的实时播放叠加。
- 后端按零基帧索引顺序解码视频，核对视频 SHA-256、PTS、帧尺寸和源帧映射，返回真实 JPEG 与摘要。切阶段先清除旧画面，过期响应不能覆盖新阶段；校验或解码失败不显示旧叠加。
- 冻结标定不可用时明确降级为 2D。没有球场坐标时显示具体缺失信息并提供返回人物 / 球场核对入口，不画推测路线。
- 每份战术定义绑定导出的 schema 2 轨迹快照。人物或标定改变后，旧草稿继续作为旧快照显示；用户显式更新快照时重新绑定并撤回战术审核。不同视频、模型和帧映射不能重新绑定为同一份草稿。
- 保存使用版本号检查，旧页面的保存不能覆盖较新版本；QA 与正式草稿隔离。
- 浏览器即时草稿使用 IndexedDB，避免长视频轨迹超出 localStorage 容量。旧战术草稿仅在迁移事务成功后移除原副本；视频 / 模型切换等待草稿写入完成。

## 文件位置

| 内容 | 位置 |
|---|---|
| 共享视频、清单、标签 | `data/videos/` |
| 用户本机导入 | `data/local-videos/` |
| 共享战术候选与来源 | `data/tactics/` |
| 本机正式 / QA 战术草稿 | `data/local-workbench/tactics/drafts/`、`qa/` |
| 已有视频处理缓存与日志 | `artifacts/player-review-imports/`，保持原路径及结果 |
| 工作台界面与文档适配 | `engineering/tools/player-review/tactics-ui.mjs`、`tactics-document.mjs` |
| 独立引擎及报告构建 | `engineering/tools/tactical-overlay/` |
| 本机持久化与解码接口 | `engineering/scripts/tactical_workbench.py` |

## 接口

- `GET /api/video-library`：在现有本地库基础上包含 catalog 登记的共享素材、来源类别和实际可用性。已有样例结果可直接打开。
- `GET /api/tactics?sample=...&variant=...&qa=0|1&kind=workspace|candidate`：读取本机已保存的文档及版本。
- `GET /api/tactics/candidate`：通过锁定来源适配器建立 THY 示例快照。
- `POST /api/tactics/frame`：传入 sample、variant、videoSha256 和最多 40 个 frames，取得核对后的精确 JPEG。
- `POST /api/tactics/save`：sample、variant、qa、kind、document、expectedVersion；在 Node 引擎验证来源与定义后原子写入。
- `POST /api/tactics/export`：相同来源和 document，返回包含全部阶段的 HTML。

写接口限定本机 Host / Origin，不接受任意来源路径或执行命令。启动新增可选参数 `--shared-video-catalog`、`--tactics-folder`；原命令与视频 / 模型 / 草稿入口兼容。Node.js 22+ 用于战术验证和导出，PyAV 使用已有服务环境。

## 验证入口

```powershell
node --test engineering/tools/player-review/*.test.mjs engineering/tools/tactical-overlay/*.test.mjs
& tmp/vision-deploy-bench-venv/Scripts/python.exe -m unittest discover -s engineering/scripts -p test_tactical_workbench.py
& tmp/vision-deploy-bench-venv/Scripts/python.exe -m unittest discover -s engineering/scripts -p test_local_video_library.py
```

真实战术判断由用户后续验收。本轮不重新评测模型准确率，不将程序测试当作位置、身份或战术准确率结论。

2026-10-03 实测：前端 313 项中 312 通过、1 项 Windows 符号链接权限跳过；后端 194 项全部通过。共享清单 7 批 / 157 条及索引 LFS 指针检查通过。真实新增 MIL 片段用推荐方案处理 494 帧，并通过打开、建立战术草稿、保存和刷新恢复；005 示例通过三阶段精确帧与独立 HTML 导出。宽屏及窄屏页面均检查了交互与 DOM 尺寸；浏览器截图接口超时，未取得截图级视觉验收证据。

本机审核入口：`http://127.0.0.1:8890/?sample=005&variant=ebard&area=tactics&candidate=1`。本轮验收修改保存在 QA 空间，不代表用户已审核。细节见[整合交接](../../handoffs/Linzeyu912/2026-10-03-1507-workbench-tactics-integration.md)。
