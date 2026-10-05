# 本轮研究复现

日期：2026-10-05，Asia/Shanghai。所有命令从仓库根运行；不改生产服务和工作台数据。

## 1. 源码和权重

以下目录是本机忽略目录；其他成员拉取本研究文档后，需要自己取得这些公开资产。路径存在时先核对提交，不覆盖已有副本。

```powershell
git clone --depth 1 https://github.com/Mr81wx/HoopTransformer.git tmp/mentor-research/HoopTransformer
git clone --depth 1 --no-checkout https://github.com/Mr81wx/HoopEval.git tmp/mentor-research/HoopEval
git -C tmp/mentor-research/HoopEval restore --source=HEAD --worktree -- Model conf README.md train.py players.csv
git clone --depth 1 --no-checkout https://github.com/Mr81wx/HoopEval_vis_2.git tmp/mentor-research/HoopEval_vis_2
git -C tmp/mentor-research/HoopEval_vis_2 restore --source=HEAD --worktree -- README.md package.json package-lock.json src public dist index.html vite.config.js
git clone --depth 1 --branch app --no-checkout https://github.com/Mr81wx/HoopPad.git tmp/mentor-research/HoopPad
git -C tmp/mentor-research/HoopPad restore --source=HEAD --worktree -- server start.md client/src/App.jsx
git clone --depth 1 https://github.com/ytrqua3/Hoop-MSSL.git tmp/mentor-research/Hoop-MSSL
```

本轮固定版本：

| 仓库 | SHA |
| --- | --- |
| HoopTransformer | `74c8004171f1f61a9153982172dacfee1ec4e0bc` |
| HoopEval | `62cf695a9dfae0891ea3d5e091ccb73bf4d0e98b` |
| HoopEval_vis_2 | `2483372f0e3876cbf6c1a0c6adf3b415b4f4cae9` |
| HoopPad | `6376cb08ab423879f026148133741495c401863e` |
| Hoop-MSSL 第三方 | `f33a4c0130c70fef9f12ef8c0af51d5c705c2021` |

运行前逐个核对 `git -C <研究副本目录> rev-parse HEAD` 与表中版本一致；不一致时不要把新版本结果称为复现。本轮这些默认分支恰好位于表中提交。

若在线分支已前进，使用一个**新建的空研究目录**取得固定提交，再只恢复白名单路径。例如 HoopEval：

```powershell
git init tmp/mentor-research/HoopEval-pinned
git -C tmp/mentor-research/HoopEval-pinned fetch --depth 1 https://github.com/Mr81wx/HoopEval.git 62cf695a9dfae0891ea3d5e091ccb73bf4d0e98b
git -C tmp/mentor-research/HoopEval-pinned update-ref --no-deref HEAD 62cf695a9dfae0891ea3d5e091ccb73bf4d0e98b
git -C tmp/mentor-research/HoopEval-pinned restore --source=HEAD --staged --worktree -- Model conf README.md train.py players.csv
git -C tmp/mentor-research/HoopEval-pinned rev-parse HEAD
```

其他仓库替换 URL、SHA、空研究目录与上方白名单；运行探针的 `--repo` 指向对应副本。此流程只用于新建的第三方研究副本，不能在主仓库或已有工作目录执行。HoopEval Windows 全量 checkout 会因非法文件名失败，使用白名单。HoopEval_vis_2 上游提交了 node_modules，本轮没有使用那份依赖，重新 npm ci。

## 2. 环境

本机已有可用的 Python 3.12.10、NumPy 2.4.3、PyTorch 2.11.0+cu128、einops、pandas、SciPy、PyYAML。以下 `--system-site-packages` 仅在这些基础依赖已有时复用；否则在独立环境按本机 CPU / CUDA 版本安装，不照抄上游的旧 numpy / Flask 锁定文件去改全局环境。

```powershell
python -m venv --system-site-packages tmp/mentor-research/venv
& tmp/mentor-research/venv/Scripts/python.exe -m pip install torch-geometric==2.6.1 pytorch-lightning==2.6.1 tensorboard==2.21.0
```

GPU 可选；本轮 RTX 5070 Laptop 8 GB。记录中的显存为 Torch 峰值 allocated，不包括 CUDA 上下文，也不代表完整训练需求。模型前向耗时不包含模型启动、加载、轨迹适配、视频处理和 IO。

## 3. 运行模型与向量探针

输出到 `artifacts/mentor-research-recheck/`，避免覆盖首次 evidence。

```powershell
& tmp/mentor-research/venv/Scripts/python.exe research/basketball-models/mentor-components-20261005/probe_models.py transformer --repo tmp/mentor-research/HoopTransformer --device cpu --output artifacts/mentor-research-recheck/transformer-cpu.json
& tmp/mentor-research/venv/Scripts/python.exe research/basketball-models/mentor-components-20261005/probe_models.py transformer --repo tmp/mentor-research/HoopTransformer --device cuda --output artifacts/mentor-research-recheck/transformer-cuda.json
& tmp/mentor-research/venv/Scripts/python.exe research/basketball-models/mentor-components-20261005/probe_models.py evaluation --repo tmp/mentor-research/HoopEval --device cpu --output artifacts/mentor-research-recheck/evaluation-cpu.json
& tmp/mentor-research/venv/Scripts/python.exe research/basketball-models/mentor-components-20261005/probe_models.py evaluation --repo tmp/mentor-research/HoopEval --device cuda --output artifacts/mentor-research-recheck/evaluation-cuda.json
& tmp/mentor-research/venv/Scripts/python.exe research/basketball-models/mentor-components-20261005/probe_models.py embeddings --repo tmp/mentor-research/HoopTransformer --output artifacts/mentor-research-recheck/embeddings.json
& tmp/mentor-research/venv/Scripts/python.exe research/basketball-models/mentor-components-20261005/probe_models.py mssl --repo tmp/mentor-research/Hoop-MSSL --output artifacts/mentor-research-recheck/mssl-third-party.json
& tmp/mentor-research/venv/Scripts/python.exe research/basketball-models/mentor-components-20261005/probe_hooppad.py --repo tmp/mentor-research/HoopPad --output artifacts/mentor-research-recheck/hooppad.json
```

- 每个模式用新的 Python 进程：各上游都用了 `Model` 包名，在同一个解释器中混用会误导 import。
- Transformer / evaluation 明确为随机参数结构烟测，不产生可供工作台使用的战术或价值结果。
- MSSL 模式预期记录 `status=failed` 与重建头形状错误；探针为了保存诊断不把所有研究失败变成进程异常。判断结果要看 JSON，不能只看退出码。
- HoopPad 先捕获原始加载器报错，再通过原编码器 / 解码器按权重形状适配。只载入推理模块、strict 检查；不修改原始 checkpoint。BC 的训练判别器未参与推理。
- 不运行上游笔记本 / 训练 shell。原始 pickle 用受限白名单；张量权重 `weights_only=True`。不导出或上传作者的样例原轨迹。

## 4. 可视化复现

```powershell
npm --prefix tmp/mentor-research/HoopEval_vis_2 ci --ignore-scripts --no-audit --no-fund
npm --prefix tmp/mentor-research/HoopEval_vis_2 run build
npm --prefix tmp/mentor-research/HoopEval_vis_2 run dev -- --host 127.0.0.1 --port 8911 --strictPort
```

打开 `http://127.0.0.1:8911/HoopEval_vis_2/`，首样例 24 帧、末样例 30 帧。播放 / 暂停后曲线、柱形图和球场同帧联动；切换数据文件应重置帧号。此页面读取静态 JSON，展示不是新视频模型推理。

本轮用独立 Playwright `mentor-research` 会话验证，原始截图在本机 `output/playwright/mentor-hoopeval-wide.png`；该路径被忽略。验证完关闭本轮测试页面与 8911 服务，不影响工作台已有端口。

## 5. 资产重新核查

```powershell
python research/basketball-models/mentor-components-20261005/audit_public_assets.py --output artifacts/mentor-research-recheck/public-assets.json
```

脚本用 gh 的已登录只读 API 取得公开仓库默认分支 SHA、树、许可证入口、权重和 Releases，再查同名 HF 模型 / 数据集。第三方 MSSL 固定 SHA 来自本轮实际 clone。原始证据是采集当日状态；重新运行可能得到更新，不应偷偷替换初次记录。

需要复核的来源 HTTP / PDF SHA、中文名证据及原文快照哈希见 [source-provenance.json](evidence/source-provenance.json)。

## 6. 补查 Issue、历史提交与旧 HoopEval 权重

默认分支扫描会漏掉作者 Issue 中的下载链接和已经删除的历史文件。专项结论见 [OPEN_SOURCE_AUDIT.md](OPEN_SOURCE_AUDIT.md)。审计使用只读公开 API，需要 `gh` 可用；输出目录先创建。

```powershell
New-Item -ItemType Directory -Force artifacts/mentor-research-recheck | Out-Null
python research/basketball-models/mentor-components-20261005/audit_model_releases.py --output artifacts/mentor-research-recheck/model-release-audit.json
```

旧权重固定来自 `Mr81wx/HoopEval@3a75cad8f024e457be1b76f90ea176cb59037104`。下面只下载四个已审阅源文件和权重，逐个核对哈希，放入忽略目录；不检出其余脚本 / 日志，不执行训练。首次运行需基础环境有 `requests`。

```powershell
@'
import hashlib, json, requests
from pathlib import Path
topic = Path('research/vision/mentor-components-20261005')
dest = Path('tmp/mentor-research/release-audit')
repo = dest / 'HoopEval-3a75cad'
base = 'https://raw.githubusercontent.com/Mr81wx/HoopEval/3a75cad8f024e457be1b76f90ea176cb59037104/'
selected = {'Model/QTransformer.py', 'Model/utils.py', 'Model/__init__.py', 'conf/config.yaml'}
manifest = json.loads((topic / 'evidence/historical-source-manifest.json').read_text(encoding='utf-8'))
for item in manifest:
    if item['path'] not in selected:
        continue
    response = requests.get(base + item['path'], timeout=60)
    response.raise_for_status()
    assert hashlib.sha256(response.content).hexdigest() == item['sha256']
    path = repo / item['path']
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(response.content)
response = requests.get(base + '1030_soft_onlyball/version_13.ckpt', timeout=60)
response.raise_for_status()
assert hashlib.sha256(response.content).hexdigest() == '80b3a25b08cdc81ab5a68b09ab37baa73d8ea81f0a834d1967aa1fc81920cb90'
(dest / 'evaluation-historical.bin').write_bytes(response.content)
print('Verified historical source and checkpoint.')
'@ | python -X utf8 -

& tmp/mentor-research/venv/Scripts/python.exe research/basketball-models/mentor-components-20261005/probe_historical_hoopeval.py --repo tmp/mentor-research/release-audit/HoopEval-3a75cad --checkpoint tmp/mentor-research/release-audit/evaluation-historical.bin --device cpu --output artifacts/mentor-research-recheck/hoopeval-historical-cpu.json
& tmp/mentor-research/venv/Scripts/python.exe research/basketball-models/mentor-components-20261005/probe_historical_hoopeval.py --repo tmp/mentor-research/release-audit/HoopEval-3a75cad --checkpoint tmp/mentor-research/release-audit/evaluation-historical.bin --device cuda --output artifacts/mentor-research-recheck/hoopeval-historical-cuda.json
```

核心 `model.` 与 `ema_model.ema_model.` 都可严格加载，但原文件记录 `ema_initted=False`、`ema_step=0`，不要把后者当训练后的 EMA。探针的张量是合成输入，只验证权重兼容和数值有限；没有验证六边形映射 / 动作字典、真实篮球评价质量或论文最终版本身份。CPU 与 GPU 输入各自在对应设备生成，不用于数值一致性比较。

HoopTransformer 的作者 Issue 和 Colab 链接见专项报告。作者 notebook 已按 JSON 静态审阅，未执行其挂载 Drive / 安装 / pickle 单元；权重请求返回登录页面，不能因 HTTP 200 就当下载成功。
