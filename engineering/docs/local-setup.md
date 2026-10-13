# 本地安装与启动

需要 Python 3.12、Node.js、FFmpeg 和 Git LFS。所有命令从仓库根目录执行。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-git-identity.ps1
git lfs pull
python -m venv .venv
.venv/Scripts/python -m pip install -r engineering/requirements-review.txt
npm ci --prefix engineering/tools/player-review
npm ci --prefix engineering/tools/player-review/agents
npm install --prefix tmp/node-deps --no-audit --no-fund sharp@0.34.5
$env:NODE_PATH = "$PWD/tmp/node-deps/node_modules"
.venv/Scripts/python engineering/scripts/serve_player_review.py --library data/videos/tactics/acceptance/review-library.json --port 8892
```

浏览器打开 http://127.0.0.1:8892/ 。若该端口已被旧工作区占用，选其他端口。macOS/Linux 使用 `.venv/bin/python`，环境变量使用所在 Shell 的语法。

仓库已包含构建后的前端；修改 JSX 后运行 `npm run build --prefix engineering/tools/player-review`。`npm test --prefix engineering/tools/player-review` 可运行现有前端测试。`python scripts/validate_video_data.py --check-index` 验证素材文件与 LFS 指针。

视频库可打开已准备样例，或选择“直接人工制作”导入视频。新增素材、草稿、缓存及渲染输出保存到被 Git 忽略的本地目录。原电脑的浏览器草稿、密钥、模型权重和已安装依赖未复制到此仓库。

自动识别需要另行安装模型依赖与权重；服务参数 `--inference-python`、`--models`、`--court-model` 指定实际路径。模型识别不是人工制作的前置条件。完整参数用 `python engineering/scripts/serve_player_review.py --help` 查看。

解说和姓名识别等远程模型需要相应凭据，可通过 `--env-file .env` 显式加载；切勿提交 `.env`。当前默认中文配音使用阿里云 Qwen Audio，需要对应 TTS 凭据；模型与音色以 [commentary_tts.py](../scripts/commentary_tts.py) 的配置为准。视频导出需要 FFmpeg，带姓名叠加的路径还需要 OpenCV。本次目录整理不重跑付费模型或配音请求。
