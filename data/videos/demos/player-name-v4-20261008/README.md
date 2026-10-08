# 官方001全员姓名v4渲染演示

2026-10-08，America/New_York。按本聊天用户要求随姓名代码共享，视频使用Git LFS；这是官方001的派生展示输出，包含姓名、号码、检测框和脚环，不作为新的原始训练素材或独立球权。

- [完整回放](clips/official001-all-players-full.mp4)：1920×1080、1291帧、约59.94fps、21.538秒，保留源PTS和原声。
- [渲染规格](render-summary.json)、[逐人覆盖与v3对照](coverage-comparison.json)、[视频清单](manifest.json)、[身份说明](labels/001.json)。
- 十个P各有唯一姓名；有有效显示位置的记录中，姓名覆盖91.39%，226帧同时显示十个姓名。未经过独立人工逐帧真值验收，覆盖率不是准确率。
- 源视频仍为[官方训练001](../../uploads/2026-10-05-official-training/README.md)，此输出与其整段画面重复，不改源片。代码、方法与限制见[工程v4记录](../../../../engineering/docs/player-name-optimization-20261007.md)。

网页提供全局／球队／单人的显示开关；此MP4为固定烙字。模型请求原图、原始响应、失败日志和输入缓存保留本机忽略目录，没有随视频共享。

下载当前演示：

```sh
git lfs pull --include="data/videos/demos/player-name-v4-20261008/clips/**" origin
python scripts/validate_video_data.py --check-index
```
