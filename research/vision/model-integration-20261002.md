# 人物模型整合的生成与验证记录

原核验日期：2026-10-02，Asia/Shanghai。2026-10-05 从模型环境说明中拆出，保留当时实验条件、数量和限制；本次整理未重新运行。环境准备见[本机模型环境](../../environment/local/model-runtime.md)。

## 生成与复现


批处理先核验视频 SHA，拒绝覆盖已有候选、元数据或报告。它只输出候选和建议的 `library_entry`，不修改样例清单或草稿。

```powershell
# 先在短帧检查五种执行配置；partial_run=true，不登记工作台。
& tmp/model-runtime/Scripts/python.exe engineering/scripts/prepare_tracking_variants.py --sample 004 --variants baseline low reid optimized yolo --max-frames 8 --output-dir tmp/check-new --report tmp/check-new-report.json

# 新视频或需要的新对照使用全片；输出和报告路径必须未被占用。
& tmp/model-runtime/Scripts/python.exe engineering/scripts/prepare_tracking_variants.py --sample 004 --variants baseline low reid --output-dir tmp/new-candidates --report tmp/new-candidates-report.json

# 也可直接运行 THY 完整跟踪配置，保留解码 PTS。
& tmp/model-runtime/Scripts/python.exe engineering/scripts/basketball_run.py --video data/videos/tactics/acceptance/clips/004_GSW_elevator.mp4 --weights tmp/models/BODD_yolov8n_0001.pt --variant optimized --output tmp/new-optimized.json --evidence-frames
```

生成 `team-stable` 展示元数据使用既有 `prepare_basketball_team_overlay.py`，输入清单中必须先登记 `optimized`。原 E-BARD + ByteTrack 入口为 `build_ebard_review_tracks.py`；该入口也拒绝覆盖旧候选。原候选与新结果的临时 T 编号不应互相套用。

## 本轮验证

- 五种执行配置各完成 8 帧 GPU 检查；E-BARD + ByteTrack 另以原有逐角色跟踪逻辑完成 8 帧检查。ReID 确认收到原生检测特征。
- 为 004 / 005 / 006 分别生成 baseline、low、reid 全片候选，帧数分别为 **210 / 143 / 462**；为 LAL 新增通用 YOLO + ByteTrack **267 帧**。共 10 组、2,712 帧观测。
- 逐一核对源视频 SHA、完整解码帧数、顺序、每帧唯一 T 编号和 PTS。输出时间保留 9 位小数，最大舍入误差约 `4.99e-10` 秒。
- 四个样例已有 optimized / team-stable 的 JSON 与元数据，共 **16 个文件**，与 THY `1839dcd` 快照 SHA 完全一致。
- 38 项跟踪 / 渲染测试和 8 项展示测试通过。Windows 沙箱下的临时目录 ACL 阻止了两项文件测试；在获准提升执行后完整通过。

新候选位于 `data/videos/tactics/acceptance/tracks/integration-20261002/`。权重、每组候选、配置、元数据及保留文件的哈希见[机器可读核验](model-integration-20261002.json)。本轮没有独立真人身份真值、IDF1 / MOTA 或米制脚点误差评测；检测数量和显示稳定性均不等于准确率。
