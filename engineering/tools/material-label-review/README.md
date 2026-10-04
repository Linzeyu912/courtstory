# 视频标签人工审核页

面向逐段看视频、核对中文标签和决定素材去留。读取当前 catalog 中全部 **175 段 / 8 批**的 `material_labels`，包括困难场景、机器建议排除的教学片段和重复备选。服务保留全部素材，页面默认使用 `data/videos/classification/review-sample-40.json` 的40段分层抽检队列；已审片段计入40段，目录、进度及完成后跳转都以当前队列为准。可在目录上方切换至全部当前保留素材。

## 打开

Windows 双击 [start-review.cmd](start-review.cmd)，会启动本机保存服务并打开浏览器。已有服务时复用；不需要安装前端依赖。Python 3.10+，Windows 的时区支持沿用仓库现有 Python 环境。

也可以在仓库根目录运行：

```powershell
python -X utf8 engineering/scripts/serve_material_label_review.py
```

然后打开 `http://127.0.0.1:8901/`。通过本机服务打开，才能将评价直接保存到文件；双击 `index.html` 不提供保存服务。重启服务后从最后一段继续，已保存结果仍在。

## 逐段审核

1. 看中间的视频；可慢放、前后跳两秒、按标称帧率逐帧定位。标签上的时间段可点击播放，并选择循环。场景边界来自近似标注，需对着画面核对。
2. 全部标签都正确且视频要保留时，点 **「全对 · 保留 · 下一段」**，写入完成记录并进入下一段未审完的视频。
3. 有标签错时，点该项 **「不正确」**，选问题类型并填写意见，例如正确标签、应改成的时间或漏标情况。也可选「不确定」。点 **「其余标签正确」**不会清掉已经登记的错误或不确定项。
4. 另外选择 **保留 / 建议丢弃 / 暂不确定**，必要时填写理由。完成后点 **「完成本段并下一段」**。有纠错项也可以完成审核，随后由 Agent 处理。
5. 「上一段 / 下一段」是浏览操作，会先保存当前修改，不将未核对完的视频标为完成。目录可筛选批次、未审完、有问题、机器建议排除或重复。

评价在修改后自动保存，底部明确显示 **「已保存到文件」**。保存失败显示「尚未落盘」，保留浏览器草稿，并阻止离开当前视频；重启服务后重试。关页前确认已保存。顶部可将汇总 JSON 备份直接保存到本机 `exports/`，提示会显示实际路径，日常审核不依赖手动导出。

## 结果与后续修改

正式人工反馈在被 Git 忽略的本机目录：

```text
artifacts/material-label-human-review/
  records/<clip_id>.json      # 每段实际评价，自动保存
  exports/human-review-*.json # 点击导出的汇总备份，直接落盘
  session.json               # 最后浏览的视频
  server.json                # 本机服务地址与进程信息
  history/<clip_id>/          # 原标签换版后，保存被替代的旧评价
```

每条记录包含：稳定 `clip_id`、视频和标签相对路径、视频 SHA-256、原 `material_labels` 快照及其指纹、逐项 `evaluations`、去留 `retention`、整段意见、保存时间与修订号。`evaluations` 的键直接对应正式标签，例如 `scenarios.camera_zoom` 或 `content.action_tags.0`；值记录 correct / incorrect / unsure / pending、问题类型、中文修改意见和点击评价时的视频位置。`source`、`selection`、`content_relations` 是可整体核对并说明错误的复合字段。

`status=completed` 表示用户已完成该段审核，仍可能包含需修改的标签；`draft` 不是最终审核。标签换版且已在 `data/videos/classification/human-review-updates.json` 登记处理回执时，原已完成评价继续计入进度。回执须同时匹配原评价修订号、更新时间、原标签指纹和当前结果标签指纹。页面显示“你的审核意见已处理”及已修正项的原意见，原评价不会因浏览或完成跳转被重写；实际再次修改评价才保存当前版本，并将换版前的记录归档至 `history/`。没有有效回执的标签换版需要重新审核；草稿始终不计为已完成。同一段在其他页面保存后，会要求刷新，避免覆盖更新。

后续 Agent 应先读取 `records/`，核对视频及标签版本，按 incorrect / unsure、去留决定与意见逐项修改正式 `material_labels`，再重建分类索引。**这些人工反馈不是 `build_material_labels.py --results` 的原始 AI 输入，不能直接传给该参数。** 未审片段保持未审，不把页面 QA 测试当作人工结论。

点「建议丢弃」仅记录决定，不删除视频或修改正式标签。最终去杂和标签修改在用户审核之后执行。本工具的测试输出在 `artifacts/material-label-human-review-qa/`，与正式反馈分开。

## 必要检查

```powershell
python -m unittest discover -s engineering/scripts -p test_material_label_review.py -v
node engineering/tools/material-label-review/review-model.test.mjs
node --check engineering/tools/material-label-review/review.mjs
```

服务只监听 `127.0.0.1`，通过登记的片段 ID 读取视频，支持 HTTP Range 定位。反馈按临时文件替换写入，每次成功响应前已保存；正式源标签和原视频只读。

2026-10-04 本轮40段抽检全部完成：保留28、删除12，活动库163段。实际人工原记录已共享在 `data/videos/reviews/human-2026-10-04/records/`；服务优先读取本机的新记录，本机没有时读取共享原记录。导出保留已删除12条的意见及原快照，不因媒体删除而漏失审核证据。人工审核后的AI推拉修改在字段旁单独提示，完成状态表示历史审核已完成，不能解释为用户再次确认了AI修改。
