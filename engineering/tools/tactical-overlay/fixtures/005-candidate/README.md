# 005 真实战术候选：来源与复现

这里保存小型观察标注和只读生成器。`005` 指 **SAS–MIA 的 005_SAS_pick_roll / 005-ebard**。不是同名其他比赛、不是球员真实身份库，也不是人工验收成片。

`annotation.json` 摘录独立助理于 2026-10-02 目视检查的候选，保留原观察文件的路径与 SHA256。原记录看过 60 个精确帧联系表，其中 14 帧另外查看全分辨率；没有逐帧确认 143 帧中的身份、脚底接触、米制精度或战术边界。方法为 `assistant_visual_inspection`，输入来源为 `upstream_supplied`，所有真实质量保持 `needs_review`。

## 锁定的输入

路径相对仓库根；生成器读取实际字节并要求完整 SHA256 匹配 `annotation.json`。

| 文件 | SHA256 |
|---|---|
| `data/videos/tactics/acceptance/clips/005_SAS_pick_roll.mp4` | `1f7bd135ad8cde5ab877612e596f93200281b6902aac8084fad19a544d20b85d` |
| `data/videos/tactics/acceptance/tracks/005-ebard.json` | `e2d1b8c50a4714afc9e3ae7628dde6dda7259e127f1f3fe42cfaf9b97caaa12e` |
| `engineering/research/vision-player-refinement/feet-candidates-005.json` | `9e54439058c79e9e77094785b1e516d2acd30f6ec9bf7a5bd749ad25dcf25525` |
| `engineering/research/vision-player-refinement/court-candidates-005.json` | `a5ec52f6aac0ca87d5c43df07d3d7b0e06767ebfdff3b2b594b6c8de3aca6988` |

原片为 1920×1080 / 143 帧，实际 PTS 范围 0–4.733333333333333 秒。源轨迹的全部 143 项时间与顺序解码 PTS 相同；生成器保留原数值，不从 fps 生成时间。`extract_frames.py` 会在重新提取时再次逐项比较。

## 保留的范围和不确定性

完整 play `[0,143)`；三阶段 `[0,33)`、`[33,78)`、`[78,143)`，冻结帧 **15 / 40 / 90**。五位白队进攻者和一位直接相关的黑队防守者全部进入名单。P 编号仅属于这个独立候选。

| P / 画面标识 | T 候选半开区间 | 缺口 |
|---|---|---|
| P1 白 20 | T3 `[0,108)` | `[108,143)` |
| P2 白 21 | T2 `[0,31),[33,38),[39,45),[46,143)` | `[31,33),[38,39),[45,46)` |
| P3 白 9 | T8 `[0,80),[84,143)` | `[80,84)` |
| P4 白 33 | T5 `[0,108)` | `[108,143)` |
| P5 白 2 | T7 `[0,111)`；T15 `[128,136)` 为单独暂定段 | `[111,128),[136,143)` |
| P6 黑 3 | T1 `[0,143)` | 未额外声明缺轨，但仍未确认身份及脚点 |

不会用 T10 补白 21，不会把 108 后混合的 T5 继续当白 33，不会将左侧 T16 接到白 2。P5 在 f98 框底跳变仍保留速度保护；缺检测不写成出画。

生成器借用既有 schema 2 `exportReview` 和 `acceptCourtCandidates`，只在内存中的独立 QA 副本采用 **139 个 accepted_reference**；每帧保留 `originalStatus:needs_review`、原来源和 `reviewRequired:true`。原文件不写回，108–111 四个 invalid 保留，最大标定间隔为 0。`accepted_reference` 仅允许预览参考投影，不是人工复核通过。

位置使用原轨迹框底中心，`groundContactConfirmed:false`；脚部缓存只核对来源，不被偷偷升级成地面真值。模型建议通道 `modelBindings` 保留半开区间转换后的闭区间，既有导出自然产生 `identityConfirmed:false` 与缺帧。不插值或平滑。

14 个动作保留跨阶段完整区间。P1 的 `[0,53)` 当前路线在 f15/f40 都包括之后真实发生的点，并为实线；P2 的后续顺下 `[47,94)` 在 f15/f40 为虚线。静态 space/hold 不造移动箭头。掩护是 P2→P1 / P6，`[30,47)`；位置和朝向仍为空，原 f40 框底候选只作为证据保存，因此真实横杠不可用且有 `screen_orientation_missing`。合成演示验证有朝向时的横杠，不替代真实确认。

## 复现输入与报告

在仓库根运行；没有新 npm 依赖。大型 review、冻结帧及报告均写入被忽略的 `artifacts/`。

```powershell
node engineering/tools/tactical-overlay/fixtures/005-candidate/generate.mjs
node engineering/tools/tactical-overlay/export.mjs --review artifacts/tactical-overlay-preview/real-input/review.json --play artifacts/tactical-overlay-preview/real-input/play.json --frames artifacts/tactical-overlay-20261002/frozen-source/frames.json --out artifacts/tactical-overlay-preview/real --title '005 SAS–MIA · 三阶段真实候选'
node engineering/tools/tactical-overlay/export.mjs --review artifacts/tactical-overlay-preview/synthetic-input/review.json --play artifacts/tactical-overlay-preview/synthetic-input/play.json --out artifacts/tactical-overlay-preview/synthetic --title '合成规则演示 · 多人发动与分阶段箭头'
```

本次沿用已经解码核对的 `artifacts/tactical-overlay-20261002/frozen-source/frames.json` 与 `provenance.json`：f15=0.5s，f40=1.3333333333333333s，f90=3.0s。PNG 为顺序 PyAV 解码结果，JPEG 仅做 FFmpeg 编码转换，没有近似 seek。CLI 校验的三个 JPEG SHA 分别为：

- f15：`bb0a3ed298a956feeb02fcae3068b25e237ce6a089e70ba05a4bb0edc36affda`
- f40：`ea4a6078af6dfe88868eaf8b3aebb9cfd44429b6013938e9c01779bac03d2af3`
- f90：`3f6fa55e1d0377b17dde2c358d870b1c05cc7457d59b8d1978101b4979ff332f`

其他机器没有本地提取目录时，用已具备 PyAV/Pillow 的 Python 和 FFmpeg 路径生成新的精确帧资产：

```powershell
python engineering/tools/tactical-overlay/fixtures/005-candidate/extract_frames.py --ffmpeg '<FFmpeg executable>' --out artifacts/tactical-overlay-preview/frozen-source
```

然后把真实导出命令的 `--frames` 改为 `artifacts/tactical-overlay-preview/frozen-source/frames.json`。脚本只允许写入仓库 artifacts 的空子目录；输出全部 143 项解码映射、工具版本、原片/原PNG/JPEG摘要，并在全部比较完成后才写 frames.json。编码器版本不同可能使 JPEG 字节不同，应使用新索引内的实际 SHA，不能沿用旧 SHA。

生成器中断时：已完成的文件保留在 `real-input/`、`synthetic-input/`；可重新运行生成器，再顺序运行两个 CLI。提取脚本中断时：保留原目录证据，选择另一个空的 artifacts 子目录重试。未生成 frames.json 不算提取成功。恢复后再次查看 `source-index.json` 的 ready 状态及当前绑定；旧文件存在不代表最新导出已通过。

独立观察原证据（本地忽略产物）位于 `artifacts/tactical-overlay-20261002/observations/report.md` 及同目录联系表；没有这些本地图片的接收者仍可复现输入、精确冻结帧与报告，但不得声称已经亲自完成该次目视检查。
