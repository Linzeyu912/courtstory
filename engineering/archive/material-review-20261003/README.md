# 2026-10-03 素材审核生成器归档

归档日期：2026-10-05，Asia/Shanghai。这两个脚本属于旧 157 段素材审核流程：

- [prepare_material_review.py](prepare_material_review.py)：生成该批次的本机抽帧、联系图和清单。
- [build_material_catalog.py](build_material_catalog.py)：读取 `artifacts/material-review-20261003/`，写旧 `material_review` 字段及 `data/videos/reviews/2026-10-03/` 的 HTML / CSV 阅读目录。

当前活动库、人工意见和场景标签以 [结构化素材目录](../../../data/videos/classification/README.md) 为准，维护入口为 `engineering/scripts/build_material_labels.py --check` / `--refresh`。旧生成器会写旧标签和清单，只应在需要复现历史的独立副本中运行；不得重放旧 AI 结果覆盖当前人工意见。

历史输出与原采集记录保留。两个脚本的仓库根目录计算已适配新位置，原模型和审核结果不随本次归档补造。
