# 本机工作台数据

`tactics/drafts/` 保存战术审核文件，`tactics/qa/` 保存测试空间。按视频哈希、模型版本和来源指纹隔离，文件含轨迹快照、阶段、动作、审核证据、意见与保存版本。

这些 JSON 是本机数据，不自动提交 Git。通过「保存到本机」写入，重启服务后可以继续读取；写入有版本检查，其他页面保存的新版本不会被旧请求覆盖。浏览器使用 IndexedDB 保留即时草稿和重新读取前的恢复副本，避免长视频超出 localStorage 容量。

共享候选位于 [data/tactics](../tactics/README.md)，共享视频在 [data/videos](../videos/README.md)，用户导入原片在 [data/local-videos](../local-videos/README.md)。推理缓存与日志继续位于被忽略的 `artifacts/player-review-imports/`。
