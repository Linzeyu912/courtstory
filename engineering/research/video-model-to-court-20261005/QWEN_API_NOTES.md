# Qwen API 验证准备

后续讨论指定模型为 **Qwen3.8-Max**，重点是 Agent 的多轮图片工具与地面轨迹修正，见[当前方案讨论](../qwen-video-trajectory-agent-20261005.md)。下方接口笔记保留；此前 M1 / M2 / M3 比较不是当前已确认的实施方案。

更新：2026-10-05，Etc/UTC。本聊天用户明确约定：后续提供的 Qwen API key 放在环境变量 **`QWEN_KEY`**。服务端读取该名称，无需用户改成官方示例中的 `DASHSCOPE_API_KEY`；不把密钥写入报告、Git 文件或浏览器配置。

## 已核实的接口能力

如果使用阿里云百炼 / Model Studio 的 Qwen 视觉服务，官方文档提供直接视频文件输入：OpenAI 兼容请求的消息项使用 `type: video_url`，视频可用符合要求的 URL 或 `data:video/mp4;base64,...`。服务端解码并采样，不等于完整原片每帧进入语言模型。

官方当前文档的 `fps` 默认 2.0，范围 0.1–10；适用于所支持的视频视觉型号。帧数预算及参数支持因型号和 SDK 而异，不能把本地 `qwen-vl-utils` 的参数直接照搬为云 API 参数。模型名、快照、采样设置和实际返回 usage 应纳入实验记录。

官方文档还说明 API key 与地域对应，部分地域的新接入地址含业务空间 ID。后续用户已明确使用阿里云官方服务，现行首版计划默认北京兼容端点 `https://dashscope.aliyuncs.com/compatible-mode/v1`，可由后端配置业务空间专属地址；真实调用时检查 key / 模型 / 地域匹配。此前未确定平台的状态由此更新，详见[最新实施计划](../../docs/plans/2026-10-05-qwen-ground-trajectory-agent-v1.md)。

来源（采集于 2026-10-05）：

- [官方图像与视频理解](https://docs.modelstudio.console.alibabacloud.com/zh/model-studio/vision)。
- [DashScope API 参考](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-dashscope)。
- [OpenAI 兼容视觉接口](https://help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai)。

## 对当前项目的影响

Qwen API 可以先验证[报告](REPORT.md)中的 M1：同一 3–5 秒篮球窗口，输入视频、已确认球员参考及时间 / 坐标要求，获取结构化身份和位置候选，再与人工真值及现有 `H_t` 对照。首轮区分“模型输出图像脚点 + 既有矩阵”和“模型直接输出球场坐标”，不把两者成绩混在一起。

Qwen API key 不会直接提供 Sa2VA / UFVideo 的 `[SEG]` 掩码解码器或 SAM 视频状态。那些项目通常需要自己的模型权重、推理环境和视频分割服务；如果结合 Qwen API 与 SAM，应由适配层将 Qwen 的定位结果转成 SAM 的框 / 点提示。

现有 `engineering/scripts/vision_provider.py` 的 `MultimodalApiProvider` 仍是不可用占位，接口契约只有 `images + prompt + schema`。真正的视频 API 实验需要一个明确携带视频 / 时间映射的适配入口；仅设置 key 不会自动接通它。本轮保留研究范围，尚未改生产 provider。

## 本轮实际执行状态

已检查当前执行环境是否存在非空 `QWEN_KEY`，未读取或输出其值；本轮检查时未配置。未发起带鉴权模型请求、未上传视频、未产生推理结果，也没有把“接口支持”写成“篮球轨迹效果已验证”。用户后续设置环境变量后，新进程 / 执行环境应实际获得该变量，再进行调用验证。
