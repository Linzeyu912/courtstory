# Qwen3-VL-235B-A22B 是什么

核验日期：2026-10-06 14:25，Asia/Shanghai。用户追问具体模型名称；本轮只核对公开模型资料及现有本机权限报告，未发起模型调用。

这是阿里巴巴通义千问 Qwen 团队的视觉语言模型，属于 Qwen3-VL 的大型 MoE（混合专家）型号。名称中的 VL 是 Vision-Language；235B 表示约 2350 亿参数规模，A22B 表示每个 token 的计算约激活 220 亿参数。激活参数少主要减少计算，不代表自部署只需保存 22B 权重，更不是 22GB 显存。[技术报告](https://arxiv.org/html/2511.21631v1)

官方开放权重提供 [Instruct](https://huggingface.co/Qwen/Qwen3-VL-235B-A22B-Instruct) 和 [Thinking](https://huggingface.co/Qwen/Qwen3-VL-235B-A22B-Thinking) 两个版本，前者面向指令回答，后者加强推理。支持图片、视频相关理解、OCR、空间定位和视觉问答，原生上下文为 256K；不将模型卡中的发布时最高水平宣传当作当前排名。它不是篮球专用模型，也不是本仓库已测试的 `qwen3.8-max`。

## AWS 托管接口与模型能力必须分开

[AWS 当前模型卡](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-vl-235b-a22b.html)显示：

- `bedrock-runtime` 的模型 ID 为 `qwen.qwen3-vl-235b-a22b`。
- 输入支持文字、图片；音频和视频输入均标为不支持。输出为文本。
- 上下文 256K，最大输出 8K；支持 Invoke / Converse。
- 原模型能理解视频，不等于该托管接口能直接接收 MP4。通过此端点分析比赛时，需要应用抽取带时间戳的帧 / 裁图，再组织图片请求；具体每次图片数量和请求尺寸应另按实际接口限制核对。

## 本项目当前意义

根据同日 14:19 已有的[比赛账号权限报告](../../../environment/aws/bedrock-model-access-20261006.md)，比赛角色模型白名单只有 Qwen3-VL-235B-A22B 与 Sonnet 4.6。报告记录 Qwen 的一次文本 Converse 返回 `BEDROCK_OK`；图像、工具循环和篮球视频效果尚未验收。此为引用另一轮已保存结果，本轮没有重复执行或改变账户设置。

因此，前一份报告中的 Gemini / GPT / 新版 Claude 是通用市场候选；**当前赛事账号内优先验证这个 Qwen 的图片理解与篮球事件识别更符合已核实权限**。已有阿里云 Qwen3.8-Max 实测结果不能移作它的精度证明。建议先测传球参与者、掩护角色、出手时间和证据帧，再评价战术解释；以上是建议，尚未执行。

公开来源均于本次核验日期读取；产品功能、模型精度和账户权限三个层面分别记录。本文件未提交 / 推送。
