# 交接：打开本机人物检测跟踪效果

- 日期 / 时区：2026-10-01 20:26，Asia/Shanghai。
- 成员：Linzeyu912。
- 任务 / Issue：用户要求运行已有 YOLO / ByteTrack 并打开效果；GitHub open Issues 查询为空。
- 分支：main。
- 提交：未提交；开工 fetch 后 HEAD 与 origin/main 均为 `3c69767018bd8e29ae6fb6e6247165b85affadc8`。
- 状态：已生成并通过本机默认视频播放器打开预览。

## 本次完成

- 新增 [视频预览脚本](../../engineering/archive/vision-clip001/render_vision_tracking_demo.py)：使用本地预训练权重运行 YOLOv8s + ByteTrack，逐帧绘制人物框、临时轨迹 ID 与检测置信度，按轨迹上色，编码 H.264 并保留原片音轨和时间戳。
- 本地输出 `artifacts/vision-deployment-benchmark/yolov8s-bytetrack-preview.mp4`，以及同名 JPG 诊断图、JSON 运行记录。这些预览产物位于被忽略目录，未作为共享视频资产入库。
- 通过 Codex 请求打开预览，同时调用系统默认视频播放器打开 MP4；系统启动命令成功。未自动操作播放器控件。
- 初次预览 `yolov8s-bytetrack-demo.mp4` 同样保留在本地；最终展示使用 `preview.mp4`，已改为按轨迹上色并保留原始视频时间戳。

## 结论与依据

- 输入来自 [library100 第 001 段](../../data/videos/nba/2024-25/clips/IND-OKC_Q4_pick-pop_8.1s_1080p.mp4)，素材来源说明见[原采集文档](../../data/videos/nba/2024-25/collection-report.md)。本轮未采集外部素材。
- 本轮为实际运行结果：YOLOv8s、ByteTrack、`imgsz=640`、FP16、仅人物类别、阈值 0.1；1080p 输出全部 243 帧。
- 最终一次运行从导入依赖到完成文件约 12.05 秒，绘制 / 检测 / 跟踪 / 编码阶段约 8.60 秒；与前轮纯检测跟踪基准计时范围不同，不能直接比较。
- 临时轨迹 ID 不等于球衣号码或球员身份；裁判与观众也属于模型检测的人物。仍存在漏检和跟踪问题，本轮没有完成球员筛选、脚下锚点、战术箭头或效果评测。

## 验证

- 脚本实际处理全部 243 帧并正常退出。
- 使用 PyAV 重新解码最终 MP4：H.264、1920×1080、243 帧，音轨可解码；逐帧时间戳与原片之差小于 1 毫秒。
- 查看最终第 60 帧 JPG，核验人物框、ID、颜色与标题显示。
- `git diff --check` 及本轮交接相对链接检查通过；保留此前未提交研究和无关文件。

## 阻塞与待确认

- 当前展示为离线运行后播放的诊断视频，尚未构建交互式 Agent 界面。
- 预览仅在本机，其他成员需用脚本复现；本轮未收到视频入库或提交推送要求。

## 下一步

- 根据用户观看反馈选择球员筛选、跟踪稳定性或脚下贴图中的下一项验证。
- 复现命令（仓库根目录；输出路径需不存在）：

```powershell
tmp/vision-deploy-bench-venv/Scripts/python.exe -u scripts/render_vision_tracking_demo.py --video data/videos/nba/2024-25/library100/clips/001_2025-06-05_IND-OKC_pick-pop/IND-OKC_Q4_pick-pop_8.1s_1080p.mp4 --model tmp/vision-deploy-bench/yolov8s.pt --imgsz 640 --output artifacts/vision-deployment-benchmark/new-preview.mp4
```

## 同步状态

- 当前任务的脚本、交接及状态补充仍在本地，未提交、未推送。
- 原视频未修改，新增视频留在被忽略的预览目录，未执行视频入库。
