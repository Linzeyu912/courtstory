# 当前工作台与篮球候选发布记录

记录时间：2026-10-02 20:27，Asia/Shanghai。当前工作台源码与候选已按授权推送至 GitHub `main`，实测提交为 [351292f](https://github.com/Linzeyu912/broadcastcode-team-hub/commit/351292fba6c5e7accafea9f8780a81b93810caba)。本记录与[20:27交接](../../handoffs/thy-0629/2026-10-02-2027-workbench-identity-publish.md)随本次文档提交同步，具体提交以 Git 日志为准。操作见[工作台](../tools/player-review/README.md)；历史研究 / 交接中的未提交文字保留当时状态。

## 发布范围

现有默认简版、固定显示 ID 1–10、队色与脚下编号、人工球员资料确认、13 项 2K 原能力及逐字段来源、旧高级工具的兼容结果连同代码 / 测试 / 验收文档发布。此轮不新增跟踪优化、OCR、断轨续接或投篮难度分析。

[共享候选目录](../../data/videos/tactics/acceptance/tracks/basketball-20261002/README.md)保存 11 份已有检测结果及 11 份相邻 metadata，共 22 份、19,683,694 字节。原来源逐项 SHA 与映射在目录 README；`review-library.json` 只替换 11 条路径。目录 `*.json -text` 保留原 CRLF / LF 字节、候选 SHA 与旧草稿指纹。它们是预计算输出，不是模型权重。

视频复用已经共享的 Git LFS 成片，本次没有新增视频上传。模型权重、GPU 环境、原缓存、QA 草稿及本机测试成片不发布。独立验收的 JSON / 图片仍在被忽略的 `artifacts/`，不是随 Git 共享的产物。姓名确认与模型轨道状态仍独立，十个显示编号不代表十人身份或连续轨迹已经锁准。

## 本次验证

- 根任务本 turn 新运行 144 项 JavaScript、102 项 Python及 38 项离线篮球测试均通过；38 项为另外运行的离线套件，不叠加成前两套的测试总数。
- 视频校验 5 批 / 142 条清单、142 个文件及 LFS 指针通过；本次没有新增视频文件。
- 22 个共享候选 / metadata 与原本机来源逐项 SHA 一致；原文件不变。新路径加载的四样例 / 17 版完整 clip payload 与运行中原 API 逐版相同，不只比较框数量。
- 本机依据为 `artifacts/player-identity-2k-publish-20261002/shared-candidates.json`、`shared-payload-equivalence.json` 及发布测试日志；只在保留本机产物的 checkout 可读取。独立发布范围审查由另一代理执行，文档作者不自行批准。

## 复现边界

已有 Python / PyAV 环境及 LFS 视频时，从仓库根执行 `python engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8876`，即可查看预计算候选和本地 2K 数据包。环境依赖见[requirements-review.txt](../requirements-review.txt)；不会在线下载或部署模型。

重跑检测需要对应权重、CUDA 与额外推理依赖。离线 `basketball_render.py` 的历史默认 FFmpeg 为原 D 盘路径，其他机器应显式传入 `--ffmpeg <本机可执行路径>`；服务浏览预计算结果不受此默认值影响。

## 提交与远端状态

源码与数据提交 `351292fba6c5e7accafea9f8780a81b93810caba` 已正常推送，父提交为 `72c74e041fd673de81488ebdf48cb97d39427bda`；GitHub API、ls-remote 与 fetch 均核对 `main` 为该提交。此提交包含 72 个文件，候选 / metadata 入 index 前后原字节核对通过。

本次最新发布说明和新交接已通过另一代理独立审查，随本次文档提交同步，具体提交以 Git 日志为准。GitHub 实际回读 72 条路径 / 68 个不同 Blob，GitOID、SHA256 与大小全部一致，其中 22 份候选 JSON 原字节一致；本机证据为 `artifacts/player-identity-2k-publish-20261002/source-remote-verification.json`。
