# 解说视频预览

纯本地预览模板，展示Astra两段原稿；由 `engineering/scripts/render_commentary_preview.py` 注入时间轴数据并生成到新目录。播放导出的MP4，点击解说可跳至对应预览时刻。定格段显示其原片锚点，避免将延长后的预览秒数误认为源视频秒数。

运行：

```powershell
.venv/Scripts/python.exe engineering/scripts/render_commentary_preview.py --output artifacts/commentary-preview/demo
.venv/Scripts/python.exe engineering/scripts/serve_comparison_report.py --directory artifacts/commentary-preview/demo --port 8884
```

访问 `http://127.0.0.1:8884/`。导出1280×880、30fps H.264 MP4，完整原画面等比缩放到上方720像素，文字位于下方独立160像素区域。当前为无音轨的文字审阅版，不包含合成配音。源片和模型JSON不会修改。

暂停句选建议区间中点附近的真实PTS帧作为锚点，阅读时长按约每秒4字加1秒估算、至少4秒；不是模型生成的语音时长。该估算仅服务本次视觉预览。字体默认Windows微软雅黑；其他机器用 `--font` 指定中文字体。
