# 独立只读审查记录

2026-10-02 UTC。审查者：本轮独立代理 `contract_review`。未修改项目或工件，未访问网络或凭证。

初版审查追加了原测试之外的三个对抗输入，发现全部误放行：

1. 修订 binding 后，只把旧事实的依赖版本号换成新号，可以继续消费旧 payload。
2. 重算 record hash 后可以伪造派生位移、时间差、球邻近距离、球场投影和 slot 内容。
3. 真实 tracks 数组的 class_id 未核对，player 可以伪装成 ball。

实现已据此增加未物化修订硬阻断、分类型值约束与数值重算、原类别与规范类别映射检查。独立代理在修改后重新运行其探针，报告：

- 修订后仅替换依赖版本：`REVISION_REQUIRES_RECOMPUTE`。
- player 源观测伪装成 ball：`CLASS_MAPPING`。
- 四类候选分别篡改数值且保持 schema 合法：全部 `DERIVATION_MISMATCH`，对应候选退出活跃列表。
- 空 provenance 被 schema 拒绝；未知 variant、分母为零、空 timeline、投影 geometry=null 均返回 `SEMANTIC_INPUT_ERROR` 和空活跃列表，没有异常外抛。

独立复测时主套件为21/21；之后新增账本历史改写反例，主执行者重跑为22/22，见 `validation_results.json`。独立审查仅说明以上具体探针被阻断，不代表任意输入已被形式化证明安全，也不代表球员身份或篮球事件准确率。
