# 脚部候选：RTMPose-s 与现有脚点对照

采集与实测：2026-10-02，Asia/Shanghai。范围为样例 004 / 005 / 006 的本机离线试验；没有继续开发 ByteTrack，也没有改写原始人物框、固定身份或人工脚点。

## 结论

**保留 RTMPose-s Halpe26 作为“人工可采用的脚部参考点”来源。** 它可以复用 E-BARD 框，输出脚趾和脚跟，清晰画面里比脚踝更接近鞋的位置。它还不能独立确定真实的地面接触点；字幕、其他球员与裁剪框遮住腿时，也会生成高分错点。本轮没有位置真值，不能宣称其地面定位准确率胜过其他方法。

工作台适合展示左右脚提议，让操作者在视频里确认后采用。模型输出不自动覆盖人工脚点，不因候选分数高而直接升级为地面真值。脚点到米制球场的变换仍依赖同时刻经过核对的球场标定。

## 实际运行了什么

1. 从 [OpenMMLab 官方入口](https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-s_simcc-body7_pt-body7-halpe26_700e-256x192-7f134165_20230605.zip)下载 RTMPose-s Halpe26。ZIP 为 21,371,025 字节，ONNX 为 22,793,379 字节，ONNX SHA-256 为 `85c5d669aa0b0c7969799ea9e0620d3b8c1d3c2b6878243e98a1ef8351457986`。
2. `rtmlib==0.0.16` 只装入本机 `tmp/ground-model-deps/`，复用原 venv 中的 ONNXRuntime 1.25.0，未修改基础环境依赖。权重与依赖继续留在被忽略的 `tmp/`。
3. 使用 rtmlib 的 RTMPose 底层接口，将每个 E-BARD 球员框扩边 1.25 倍后做 192×256 姿态输入。脚部定义为 Halpe26 的 20 / 22 / 24（左大脚趾 / 小脚趾 / 脚跟）及 21 / 23 / 25（右脚）。没有再次检测全场人物。
4. 在三个片段各取四帧，对照原始框底中心、已有 YOLOv8s-pose 脚踝和 RTMPose 脚部点。之后单独运行 RTMPose 全部 815 帧，产出与原跟踪文件哈希绑定的候选缓存。

脚部定义与调用来自 [MMPose Halpe26 配置](https://github.com/open-mmlab/mmpose/blob/main/configs/_base_/datasets/halpe26.py)、[rtmlib RTMPose 实现](https://github.com/Tau-J/rtmlib/blob/main/rtmlib/tools/pose_estimation/rtmpose.py)及 [BodyWithFeet](https://github.com/Tau-J/rtmlib/blob/main/rtmlib/tools/solution/body_with_feet.py)。本次取得的 ONNX 来自 OpenMMLab；[rtmlib GitHub](https://github.com/Tau-J/rtmlib)同时列有作者维护的 [Hugging Face 镜像](https://huggingface.co/Tau-J/RTMPose)。代码许可与模型 / 训练数据许可应分别保留，未作云部署许可结论。

## 12 帧对照

RTMPose 与 YOLO 都用 CPU 4 线程。YOLO 为 `imgsz=704`、人物置信阈值 0.15；YOLO 的全帧姿态框按 IoU ≥ 0.4 一对一匹配 E-BARD 框。脚部关键点展示阈值均为 0.3。两种模型分数并未校准到相同概率，输入方式也不同，以下是实际管线候选覆盖而非公平的模型精度排行榜。

| 样例 | E-BARD 球员候选次数 | RTMPose 至少一脚有 ≥2 个过阈值点 | YOLO 匹配后至少一脚踝过阈值 |
|---|---:|---:|---:|
| 004 | 35 | 30 | 29 |
| 005 | 35 | 33 | 31 |
| 006 | 36 | 33 | 31 |
| 合计 | 106 | 96 | 91 |

- RTMPose 双脚都能提出候选为 92 / 106，六个脚部点全过阈值为 90 / 106。重复框、遮挡和误检也可能包含在这些分母与分子中。
- RTMPose 裁框、推理及后处理共 **0.510 秒**；YOLO 全帧检测与姿态共 **0.476 秒**。这是热身后的一次抽样运行，不含读帧、已有 E-BARD 检测、模型加载、渲染或写盘。
- 离线比较时把可用脚部点汇总为代理点，距框底中心的中位差为 19.45 像素，P90 为 40.73 像素。这只说明两种代理不同，不是错误减少量；该双脚汇总点没有作为工作台接地候选。
- 逐人裁框方法的速度随人数变化。不能直接拿以上总时间承诺完整长视频十分钟交付或 AWS 耗时。

完整数值与逐点输出见 [抽样报告](feet-model-comparison.json)。本机对照页为 `artifacts/feet-models-v2/index.html`，每帧有原图叠加和逐人鞋部放大图：黄色为框底中心，青色 / 紫色为左右脚趾和脚跟，白圈为 YOLO 脚踝。

### 目视核查到的具体情况

| 帧 / 临时编号 | 看图结果 | 对接入的影响 |
|---|---|---|
| 004 / 0 / T1；005 / 0 / T1、T2 | 可见鞋上，脚趾 / 脚跟点通常落在鞋的不同部位；YOLO 点在鞋上方的脚踝区域 | 保留脚部候选，允许用户选更合适的接触位置 |
| 004 / 0 / T9、T11 | 画面框主要为上半身，脚部六点没有过阈值 | 保留空候选；框底不能因为存在就当成脚 |
| 004 / 139 / T3 | ESPN 字幕遮住下肢；RTMPose 仍有 6 / 6 过阈值，点落在字幕附近 | 高分不保证可见、同人或接地；字幕遮挡需人工拒绝 |
| 005 / 94 / T6、T7 | 两人交叠时部分脚点可能落到前景球员脚边；其中 T7 给出 6 / 6 过阈值 | 不自动采用；必须结合选中人的身体与前后帧确认 |
| 006 / 153 / T5、T15；006 / 307 / T15 | 黑色鞋、深色禁区和交叠使部分点聚到一只鞋旁，另一些点离开清晰鞋缘 | 暂不按“两个候选都存在”推定双脚站立 |

以上是截图目视复核，没有独立像素 / 米制真值或接触状态标签。没有把“有六个点”视为成功样本。

## 全视频缓存与工作台接口

完整逐帧运行继续使用 CPU 4 线程，只增加 RTMPose，没有重新运行 YOLO 或改变跟踪器：

| 样例 | 帧 | 球员框次数 | 左脚提议 | 右脚提议 | 解码 + 姿态 + 收集耗时 |
|---|---:|---:|---:|---:|---:|
| 004 | 210 | 1,827 | 1,470 | 1,511 | 8.91 秒 |
| 005 | 143 | 1,311 | 1,203 | 1,197 | 6.70 秒 |
| 006 | 462 | 4,279 | 3,893 | 3,890 | 21.58 秒 |
| 合计 | 815 | 7,417 | 6,566 | 6,598 | **37.19 秒** |

其中纯裁框 / 姿态 / 后处理为 34.89 秒，模型加载与热身另为 0.124 秒。完整循环不含前置 E-BARD 检测、文件哈希、缓存写盘、视频渲染和人工修正。见 [完整运行记录](feet-model-full-run.json)。

共享缓存为 [004](feet-candidates-004.json)、[005](feet-candidates-005.json)、[006](feet-candidates-006.json)，合计约 9.3 MB。它们包含 `videoHash`、原 E-BARD 跟踪文件字节的 `trackingFingerprint`，以及每帧的临时编号、左右脚提议及原始脚部点。加载方必须核对哈希、帧索引和时间，不能把它们套到其他模型、重新跟踪结果或裁切视频上。

每脚提议规则：

- 同脚至少两个脚趾 / 脚跟点在图内且分数 ≥0.3，才提出一个参考点。
- 参考点取该脚最高分的原始脚趾或脚跟，记录 `sourceLandmark`；不把两脚平均成落地点。
- 左右脚独立缺失时为 `null`。`leftLandmarks` / `rightLandmarks` 仍保留原始输出，方便复核。
- 全部标记 `contactState: "unknown"`、`groundPoint: false`、`needsReview: true`；参考点本身不能证明真实接触。
- 各脚提议内也保留原始 landmarks。对象稍有冗余是为了让单脚提议可独立解释，未包含视频、图像或权重。

人工“采用”应产生带来源的人工确认脚点，不能悄悄改掉检测框或其他时间的人工标记。缓存产出与工作台集成分开验证；此脚本只生成候选，不负责正式位置替换。

## 复现与验证

```powershell
tmp/vision-deploy-bench-venv/Scripts/python.exe -m pip install --no-deps --target tmp/ground-model-deps rtmlib==0.0.16
tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/probe_feet_models.py --output artifacts/feet-models-new-run
tmp/vision-deploy-bench-venv/Scripts/python.exe engineering/scripts/probe_feet_models.py --cache-only --replace-cache
```

首次运行会从上述官方地址下载 ONNX 压缩包；`--replace-cache` 会显式重建三份候选缓存并更新完整运行报告。没有该参数时不覆盖已有缓存。抽样实验使用全新输出目录，以保留旧测量；当前共享抽样报告会写入最新一次测量，所以正式对照前应保存已有记录。

已执行：12 帧两种姿态模型真实推理、815 帧完整 RTMPose 推理、六张放大图目视复核、脚部缺失 / 两点支持 / 图像边界 / 最高分点选择检查。三份缓存全部通过源跟踪哈希、815 个帧索引及时间、每帧球员编号对应、候选分数与来源字段一致性核验。脚部真实地面精度和接触状态验收仍未完成。
