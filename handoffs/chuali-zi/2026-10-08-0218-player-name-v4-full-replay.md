# 交接：全员姓名v4优化与完整追踪回放

- 日期 / 时区：2026-10-08 02:18，America/New_York（UTC-04:00）
- 成员：chuali-zi（沿用本聊天既有交接目录）
- 任务 / Issue：本聊天用户要求全员具体姓名、追踪、脚底绘制与按需显示，并指定多个GPT-6.1 Sol子agent优化、测试和优先Qwen Token Plan；未提供专属Issue。
- 分支：main
- 提交：本任务未提交／未推送；收尾共享HEAD及远端main为`101d622ea6380cedaa5a76d9dc5ac6f831de46f4`。
- 状态：本样例代码优化、真实复测和全片回放已完成；任意比赛泛化与人工逐帧准确率未验收。

## 本次完成

- 姓名后端`engineering/scripts/player_name_identity.py`、`player_name_evidence.py`、`player_name_jobs.py`和比赛名单模块：清晰目标采样、修正窗优先、frame/T去重、窗外身份参考、有限同人比较、历史颜色风险重核及部分失败任务的显式重试。姓名按球队／当场号码唯一匹配名单。
- 前端`engineering/tools/player-review/player-name-identity.mjs`及身份／轨迹消费模块：姓名profile与有限位置关联分开，局部冲突不会清空整人。保留人工确认优先；缺少位置或证据不造新点。网页按全局／球队／单人及姓名／号码／脚环选择渲染，全员数据保留。
- 浏览器`team-overlay.mjs`与Python渲染共同维护脚底标签，拥挤场景增加有限横向避让及短连接线；原脚点不移动。MP4为固定烙字。
- 研究脚本归入`research/vision/player-name-identity-20261007/`：有限真实调用、同源结果合并、保存图恢复、工程消费回放及覆盖对照。工程说明在`engineering/docs/player-name-optimization-20261007.md`，相关README和团队状态已更新。
- 最终派生输入：本机忽略目录`artifacts/player-name-optimization-20261007/v4-final/`；回放：`artifacts/player-name-optimization-20261007/full-tracking-v4-final/official001-all-players-full.mp4`。同目录有coverage、comparison-summary、result、应用副本与抽查PNG；F502显示10位置／10姓名，F1048已修复标签重叠。

## 结论与依据

- 官方001样例实际十人：HOU的Amen Thompson #1、Jabari Smith Jr. #10、Tari Eason #17、Alperen Sengun #28、Kevin Durant #7；DAL的Max Christie #00、Daniel Gafford #21、Klay Thompson #31、Cooper Flagg #32、Naji Marshall #13。
- 名单依据[NBA官方2026-01-31 DAL/HOU终场统计](https://statsdmz.nba.com/pdfs/20260131/20260131_DALHOU.pdf)，本轮2026-10-07–08使用，采集记录见`data/player-rosters/README.md`。姓名不采用模型直接猜名；模型幻读HARDAWAY／BLAKE的原始结果保留，不能说姓氏OCR准确。
- 原v3有28／64段无采样证据，均匀取帧漏清晰背号、拥挤时错读前景、历史颜色复核状态误排除和网络失败共同造成大量未知。修正P2/P5、P1/P6、P7/P9错接窗口，保守释放合框边界，保留同源已有有限正证据。
- P10补看曾误说目标为裁判，实际发送图表明目标是蓝衣球员；撤回该判断，保留先前可靠姓名，不因模型幻读删球员。
- 六个最终组件55次真实HTTP尝试／35成功，优先且实际使用Token Plan，无按量Key回退。P9通过已保存真实图恢复早晚有限区间；0.85同人比较未强提到0.9。
- 同一新版消费链的v3对照为2549／11153=22.85%，最终10078／11027=91.39%，提高68.54个百分点。十个P各一个姓名，226帧同时有十姓名、433帧有十位置。该比例是有位置帧的姓名覆盖，不是识别准确率；分母减少126来自排除不可靠关联。
- 本样例参照帧和疑似错接窗口经过AI原图诊断，不将预设姓名喂成答案；没有独立人类逐帧真值，不能保证任意未复核视频一键达到相同效果。

## 验证

- 姓名后端与任务48项通过；姓名消费、客户端、跨Python合同、展示、人工身份与几何缓存70项通过。最后标签避让后19项展示／9项Python渲染通过，十个拥挤标签矩形不重叠且原脚点不变。
- 较大后端103项的sandbox运行102过、1项loopback HTTP遇WinError10053；该单例隔离escalated复验通过，无产品绕过。核心修正后再次48项通过。
- 最新共享前端723项：647过／76败。解说挂载与旧Fake DOM不兼容74项（72缺`.after`、2缺`querySelector`），另2项历史身份缓存／重试失败。本任务保留另一会话代码，未称全量通过。日志位于最终试验根目录`frontend-verified-test.log`、`name-final-focused.log`。
- 实际MP4：1920×1080、1291帧、59.93998fps、21.538211秒；源PTS与原声保持。输入session／clip／job／policy byte-equality通过，原片、正式草稿、旧raw calls未改。
- 收尾7个研究Python脚本语法、3份最终文档的相对链接、媒体结果／十人单一姓名断言及`git diff --check`通过；仅Git换行提示。无视频上传或LFS入库。

## 阻塞与待确认

- 无阻塞本样例回放交付的问题。P10覆盖73.2%、P5/P6/P9约85%，遮挡与换T短段仍有未知，未强行填写。源记录缺失时不生成位置，脚点主要为框底中心，实际地面接触精度未验收。
- 全量前端测试仍失败，跨模块发布前应由相关改动维护者修复测试兼容并重跑。远端Issue负责人和最新讨论本轮未再次核实，不据此分配团队职责。

## 下一步

- 接手先看工程v4说明和F502／F1048，再用coverage及diagnosis定位剩余有限缺口；评估准确率时独立人工审核目标归属与切换边界，不用覆盖率代替准确率。
- 当前final目录用于用户回放，后续复测另起输出目录并保留旧输入／模型原稿；具体复跑参数见研究README及脚本帮助。
- 若用户授权发布，先处理共享全量测试失败，再选择性提交当前任务文件，按main协作流程同步；当前交付不代表已部署。

## 同步状态

- 本任务未执行Git提交、推送、创建分支／PR或更新云服务。收尾另一会话提交了解说接入，当前HEAD及只读`git ls-remote origin refs/heads/main`均为101d622；该提交不包含本轮姓名功能发布。
- 保留共享工作区已有其他任务修改。源片与模型中间文件／最终回放位于本机既有入口和忽略目录，未上传、未将密钥写入文档或日志。
