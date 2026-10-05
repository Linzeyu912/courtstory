# 本机补跑的可选模型结果

生成与核验：2026-10-02（Asia/Shanghai）。本轮本地整合产物，尚未提交推送。旧 THY 快照保留在相邻的 `basketball-20261002/`。

使用 RTX 5070 Laptop GPU、Torch 2.11.0+cu128、Ultralytics 8.4.171、PyAV 17.0.0。以下 10 组共 2,712 帧，逐帧核对源视频 SHA、解码帧数、PTS 和帧内唯一编号。相邻 `.gitattributes` 保留 JSON 原字节，防止换行转换改变草稿指纹。

部署和复现见[模型说明](../../../../../../environment/local/model-runtime.md)，运行环境、权重、配置与完整核验见[JSON 记录](../../../../../../research/vision/model-integration-20261002.json)。候选仅供人工核对，不代表真实身份准确率已经验收。

| 结果 | 帧数 | tracks SHA-256 | metadata SHA-256 |
|---|---:|---|---|
| [004-baseline.json](004-baseline.json) | 210 | `6ce659c01d1203c461abe634097b72980d336d29a2fd2e978d3847e0c3c11869` | `9276281839ba8eeb620da95e446db84d3b187cda1dd75c3d3a097f3313187e3b` |
| [004-low.json](004-low.json) | 210 | `8370284f29d639763cf76acf3899616389ed10b4f0f3b6b2b7440fd95e7b2f99` | `21b789ffa3904362ad64ce3d3ec8e7068ec05c308b2e8489ab05d3c1eb9cf328` |
| [004-reid.json](004-reid.json) | 210 | `d62d98c6788b3c6b4a856252c9a17e8174f39f4aa2deaafc9cd5f404bf57b22b` | `f5f4c300840ece6786680d7b9f590eeba2c1b8fadc8e037992c08d393a4a94d3` |
| [005-baseline.json](005-baseline.json) | 143 | `a78acf752488fa54fa11608bf45228551733ade0ca31474019f7494db91a1e15` | `3e2cf1bd143968a89010b034ac53da8e04ec398c3de33c5747e30f0a09519f65` |
| [005-low.json](005-low.json) | 143 | `be9a8e8f2677418c549083e074d39fa9b632b322a94beb0335b6721eab8ab3f1` | `fd928a3c19f8cdb033e73f069c5d43b40eb8bd92e3834410d74e2e568ed3ad6c` |
| [005-reid.json](005-reid.json) | 143 | `5bfccdcd5965ce64c18944bf2b8cbf32412b64a079e063d610f914c3cd6e59c4` | `00346bff929248d659f9332938ddd3c7f1075205ed476bd435953f66617d8ccb` |
| [006-baseline.json](006-baseline.json) | 462 | `cc2b38daf0b1407e7a0af15227e8ba1e718516ce29789689b2e6049eb246ab2b` | `0759286f3e7aa2199f4231b4d6a9ac74267040af8f8930d4ecd2e2e651576715` |
| [006-low.json](006-low.json) | 462 | `591ce4143a24d9b9846ad35439c30f795ae77fb70bca039182f1911743f6ecf3` | `5782f6f55d7fc11adc59b13ae18510da58ff85b8dd06587f705d0848082d3583` |
| [006-reid.json](006-reid.json) | 462 | `c0d76d9210c684d5048e64248da8930cf227ab9acccbd401946b65ffe395065a` | `0d5628f67c475236f5a239e9c760a557a5a156c6f59cae6c8a920b6c01ecb0db` |
| [nba-lal-min-005-yolo.json](nba-lal-min-005-yolo.json) | 267 | `427a76eb6ab3a37672acdbc924bb889f4cd0270230b258a10158963e899673ac` | `42e3e19d563b3fee01b4d89127518eade86ed48f978f3a18e0d59e5926434a02` |
