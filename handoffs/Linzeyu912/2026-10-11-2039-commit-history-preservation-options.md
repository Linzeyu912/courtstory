# 交接：Team Hub 开发历史与 CourtStory 成果历史的保留方式

- 日期 / 时区：2026-10-11 20:39，Asia/Singapore（UTC+8）。
- 成员：Linzeyu912。
- 任务 / Issue：用户将 CourtStory 定位为 HKS / Team Hub 的成果整理版，询问保留开发过程 commit 的可选方式；本轮为方案比较。
- 分支：两个仓库保持 main。
- 提交：本文与交接索引仅本地，未提交、未推送。
- 状态：现状核对与方案比较完成，未实施历史迁移或备份。

## 本次完成

- 核对两个仓库的根提交、main 历史计数和 CourtStory 的成品迁移记录。
- 比较原仓库保留、可恢复备份、同仓历史标签及筛选代码历史四种方式。

## 结论与依据

- Team Hub main 为 `56e6466057c0560701d3163d2dbd1384e59249d2`，可达提交 197 条，根提交为 `81030b0e5b7c8216018ae9f138e0cf4f4bc881f9`；其他分支与标签不包含在这一 main 计数口径中。
- CourtStory 根提交为 `91b31a2a978fc3dac12e5b884b877fab37dbb0c0`；当前本地 main 可达 21 条提交，前轮获取的 origin/main 可达 31 条。它与 Team Hub 为独立历史，本轮未重新 fetch 或推进本地 main。
- [CourtStory 成品迁移说明](https://github.com/Linzeyu912/courtstory-snapshot/blob/769dca11ae7f56a451ce70f7da76bd1cfa3ca6fd/docs/product-import.md)明确按当时用户要求只迁移成果文件，不导入 Team Hub 历史；初始来源快照为 `53b1fc8`。
- [后续功能同步说明](https://github.com/Linzeyu912/courtstory-snapshot/blob/769dca11ae7f56a451ce70f7da76bd1cfa3ca6fd/docs/feature-sync-20261010.md)记录补齐 Team Hub 至 `56e6466` 的成果文件，仍保持独立历史。两份说明均在本机 CourtStory 检出内容中直接读取。
- HKS 原始 commit 仍在；此前删除 THY 历史工作目录未删除共享 Git 提交。

| 方式 | 能保留什么 | 适用范围与代价 |
| --- | --- | --- |
| 保留 Team Hub，并在 CourtStory 记录来源提交 | 原始提交、作者、时间、说明、差异与原始 SHA | 推荐的日常组织方式；历史在 Team Hub 查看，产品在 CourtStory 接续 |
| 额外制作 Git bundle 或镜像备份 | 指定 refs 可达的原始 Git 对象与历史，可恢复为仓库 | 可与上一项叠加；Git LFS 实体、未提交文件和本机环境需另存 |
| 将 Team Hub main 历史导入 CourtStory，以专用历史 tag 固定 | 导入范围内原始 SHA 与开发历史，同时保持 CourtStory main 内容 | 能在同一仓库切换历史标签查看；旧资料历史也会进入该仓库，须处理现有署名检查的兼容，不改写原始作者 |
| 通过 git-filter-repo 提取产品目录的历史 | 与所选路径有关的开发过程及提交元信息 | 改写树和父链会改变相关 SHA，空提交可能被裁剪；与已有独立 CourtStory 历史衔接更复杂，不作为当前首选 |

- 建议组合：保留 Team Hub 作为开发过程记录，CourtStory 作为成果与后续产品开发入口；维持源提交映射，再增加独立 Git 历史备份。此为本轮建议，未宣布新的团队决策或冻结任何仓库。
- 完整保留原始 SHA 与“从每个历史版本中剔除研究、旧素材等内容”不能同时保证；按产品目录筛选历史后，需要额外保存新旧 SHA 映射和原始仓库。
- tag 是定位提交的入口，不是独立副本；仅在 README 写一个 SHA 也不能替代保存该提交对应的 Git 对象。

## 验证与来源

- 本机执行 `git rev-list --count`、`git rev-list --max-parents=0`、refs 枚举与状态检查；读取迁移记录、功能同步记录及 CourtStory pre-push 检查。
- CourtStory 本地对象库未包含 Team Hub 源提交 `56e6466`，与独立文件导入记录一致。
- [Git bundle 官方文档](https://git-scm.com/docs/git-bundle)：全量 refs 备份、恢复、验证与不包含工作区等本地状态的边界。
- [Git tag 官方文档](https://git-scm.com/docs/git-tag)：标签引用机制。
- [GitHub 仓库复制说明](https://docs.github.com/en/repositories/creating-and-managing-repositories/duplicating-a-repository)：镜像与 Git LFS 对象的单独处理。
- [git-filter-repo 维护者文档](https://github.com/newren/git-filter-repo)：路径筛选、历史改写和裁剪行为。
- 来源读取日期均为 2026-10-11。本轮仅文档记录，检查链接及差异空白，不运行产品测试。

## 阻塞与待确认

- 无检查阻塞。具体保留方式尚由用户选择；没有把方案咨询当成创建 tag、导入历史或发布授权。

## 下一步

- 按用户后续选择执行备份或历史关联，先保留原始历史，再验证恢复结果及 SHA 对应关系。

## 同步状态

- 未创建分支、tag、Release 或 bundle，未更改 remote、历史、源码或部署。
- 两个仓库的已有未提交内容保留；仅新增本交接并更新索引。
