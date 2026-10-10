import test from 'node:test';
test('commentary drawing reports actual node progress before there is a candidate',()=>{
  const job={status:'analyzing',commentaryPlanRef:{jobId:'commentary'},nodes:[{status:'analyzing'}],auditPending:true,
    message:'根据解说节点 n1 局部绘图',progress:{completed:0,total:5}};
  assert.equal(agentAuditStatusDescription(job),'');
  assert.match(agentStatusDescription(job),/根据解说节点 n1 局部绘图/);
  assert.doesNotMatch(agentStatusDescription(job),/已生成/);
});
import assert from 'node:assert/strict';
import {tacticsSceneSize,agentRuntimeDescription,agentFailureDescription,isStraightPass,agentReviewIssues,agentStageCoverageDescription,agentVisualAuditIssues,agentVisualAuditGroups,agentStatusDescription,savedVisualAuditRun,agentStageStatusDescription,agentAuditStatusDescription} from './tactics-ui.mjs';
import {createTacticsDocument,refreshSnapshot} from './tactics-document.mjs';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';

test('video scene uses the available width and source ratio even on a short viewport',()=>{
  for(const viewportHeight of [720,1440]){
    assert.deepEqual(tacticsSceneSize({mode:'video',modelWidth:1920,modelHeight:1080,canvasWidth:876,viewportHeight,selectionHeight:42}),{width:874,height:491.625});
  }
  assert.deepEqual(tacticsSceneSize({mode:'video',modelWidth:1080,modelHeight:1920,canvasWidth:320,viewportHeight:720}),{width:318,height:318*(1920/1080)});
  assert.equal(tacticsSceneSize({mode:'video',modelWidth:1920,modelHeight:1080,canvasWidth:180,viewportHeight:720}).width,178,'a narrow container must not crop a forced 200px scene');
});
test('court scene retains the prior viewport height cap',()=>{
  const ratio=15.24/28.6512;
  for(const [viewportHeight,height] of [[720,222],[1440,480]]){
    const result=tacticsSceneSize({mode:'court',modelWidth:1920,modelHeight:1080,canvasWidth:876,viewportHeight,selectionHeight:42});
    assert.equal(result.width,Math.max(200,Math.min(874,height/ratio)));
    assert.equal(result.height,result.width*ratio);
  }
});

test('completed manual-review analysis does not claim failed generation while real failures remain explicit',()=>{
  const job={status:'partial',completionKind:'manual_review',candidate:{},failure:{code:'visual_audit'},auditNeedsRepair:true,progress:{completed:2,total:2},stages:[{status:'ready'},{status:'ready'}]};
  assert.match(agentStatusDescription(job),/全段已分析，部分图形待核对/);assert.doesNotMatch(agentStatusDescription(job),/生成未完成|未完成阶段/);
  assert.match(agentStatusDescription(job,{scope:'phase'}),/所选范围已分析/);assert.doesNotMatch(agentStatusDescription(job,{scope:'phase'}),/全段已分析/);
  assert.match(agentStatusDescription({...job,stages:[{status:'ready'},{status:'failed'}],failure:{code:'no_response'},progress:{completed:1,total:2}}),/未.*返回内容/);
  assert.match(agentStatusDescription({...job,failure:{code:'storage'}}),/结果保存受阻/);
});
test('audit aggregation retains every distinct basis and original frame while separating stages and people',()=>{
  const mapping=Array.from({length:10},(_,frame)=>({time:frame*.1})),r=(personId,frame,reason,kind='route')=>({personId,frame,reason,kind});
  const job={jobId:'current',visualAudit:{stages:{s1:{exceptionItems:[r('p1',1,'身份不清'),r('p1',2,'终点不清'),r('p2',1,'另一人路线未核对'),r(null,1,'画面遮挡','frame')]},s2:{exceptionItems:[r('p1',1,'另一阶段的同名局部人')]}}}};
  const rows=agentVisualAuditIssues(job,mapping),groups=agentVisualAuditGroups(rows,mapping);
  assert.equal(rows.length,5);assert.equal(groups.length,4);assert.equal(groups[0].issues.length,2);assert.deepEqual(groups[0].frames,[1,2]);
  assert.equal(groups.reduce((sum,g)=>sum+g.issues.length,0),rows.length);assert.notEqual(groups[0].stageId,groups[3].stageId);
  assert.notEqual(groups[0].personId,groups[1].personId);assert.match(groups[0].timeLabel,/0\.10、0\.20/);
});

test('saved audit source proof permits a readonly report after a name change and refuses stale media or another context',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),{reviewDigest,...binding}=d.playDefinition.sourceBinding;
  const run={jobId:'saved',issues:['full diagnostic'],visualAudit:{stages:{s1:{exceptionItems:[{kind:'route',reason:'核对同一球员',frame:20}]}}},visualAuditSource:{schemaVersion:1,jobId:'saved',...binding,width:d.review.width,height:d.review.height,mediaEndTime:d.review.mediaEndTime??null,cuts:d.review.settings?.cuts??[],sourceCuts:d.review.settings?.sourceCuts??[],context:{variant:'test',qa:true,kind:'workspace'}}};
  d.agentRuns=[{jobId:'older',visualAudit:{exceptionItems:[{reason:'旧问题'}]}},run];
  assert.equal(savedVisualAuditRun(d,{variant:'test',qa:true,kind:'workspace'}),run);
  assert.equal(agentVisualAuditIssues(null,d.review.sourceFrameMapping,d).length,1);
  const review=structuredClone(d.review);review.entities[0].name='same player renamed';const renamed=await refreshSnapshot(d,review);
  assert.equal(savedVisualAuditRun(renamed)?.jobId,'saved');
  for(const key of ['videoSha256','sourceVideoSha256','frameMappingDigest','trackingFingerprint','width','height','mediaEndTime','cuts','sourceCuts','jobId']){
    const changed=structuredClone(d);changed.agentRuns[1].visualAuditSource[key]=key.includes('cuts')||key==='sourceCuts'?[1]:key==='width'||key==='height'||key==='mediaEndTime'?999:'changed';
    assert.equal(savedVisualAuditRun(changed),null,key);assert.deepEqual(agentVisualAuditIssues(null,changed.review.sourceFrameMapping,changed),[]);
  }
  assert.equal(savedVisualAuditRun(d,{variant:'test',qa:false,kind:'workspace'}),null);
  const changed=structuredClone(d);delete changed.agentRuns[1].visualAuditSource;assert.equal(savedVisualAuditRun(changed),null);
});

test('visual audit issues show only current job, plain categories and source times with strict frame validation',()=>{
  const mapping=Array.from({length:5},(_,frame)=>({frame,time:frame*.25}));
  const item={kind:'route',itemIndex:0,personId:'white',code:'route_pending',reason:'白衣4号接成了卷发1号',evidenceFrames:[1,3]};
  const job={jobId:'new',visualAudit:{stages:{s1:{exceptionItems:[item,{kind:'ball',code:'ball_pending',reason:'球在旁边的人手中',frames:[2]}]}}},
    stages:[{stageId:'s1',visualAudit:{exceptionItems:[item]}},{jobId:'old',stageId:'s0',visualAudit:{exceptionItems:[{reason:'旧任务问题'}]}}],
    previewDocument:{agentRuns:[{jobId:'old',visualAudit:{exceptionItems:[{reason:'其他任务遗留'}]}}]}};
  const rows=agentVisualAuditIssues(job,mapping);
  assert.equal(rows.length,2);assert.equal(rows[0].category,'路线');assert.equal(rows[0].timeLabel,'0.25、0.75 秒');assert.deepEqual(rows[0].frames,[1,3]);
  assert.equal(rows[1].category,'持球圈');assert.doesNotMatch(JSON.stringify(rows),/旧任务|其他任务/);
  const malformed=agentVisualAuditIssues({jobId:'new',stages:[{visualAudit:{exceptionItems:[null,3,{reason:'找不到对应画面',code:'wrong_foot',frames:[-1,9,'2',2.5,null]}]}}]},mapping);
  assert.equal(malformed.length,1);assert.deepEqual(malformed[0].frames,[]);assert.equal(malformed[0].reason,'找不到对应画面');
  assert.deepEqual(agentVisualAuditIssues(null,mapping),[]);
  assert.deepEqual(agentVisualAuditIssues({visualAudit:{exceptionItems:[{reason:'未指定任务'}]}},mapping),[]);
});

test('same-job adopted reports remain locatable without reading another saved run',()=>{
  const mapping=[{time:0},{time:.5}],report={exceptionItems:[{code:'missed_on_court_player',reason:'漏掉右侧防守者',frame:1}]};
  const rows=agentVisualAuditIssues({jobId:'new'},mapping,{agentRuns:[{jobId:'other',visualAudit:{exceptionItems:[{reason:'不应出现'}]}},{jobId:'new',visualAudit:report}]});
  assert.equal(rows.length,1);assert.equal(rows[0].category,'漏人');assert.equal(rows[0].timeLabel,'0.50 秒');assert.deepEqual(rows[0].frames,[1]);
});

test('generated stage counts do not imply automatic visual verification has passed',()=>{
  assert.equal(agentStageStatusDescription({status:'generated_pending_audit'},{status:'analyzing'}),'已生成，正在核对');
  assert.equal(agentStageStatusDescription({status:'awaiting_audit'},{status:'analyzing'}),'观察已生成，待自动核对');
  const ready={status:'ready',visualAudit:{allApproved:false}};
  assert.match(agentStageStatusDescription(ready,{status:'analyzing',auditPending:true,progress:{auditStatus:'analyzing'}}),/已生成，正在自动核对/);
  assert.match(agentStageStatusDescription(ready,{status:'analyzing',auditNeedsRepair:true,progress:{auditRepairStatus:'analyzing'}}),/已生成，正在自动修复/);
  assert.match(agentStageStatusDescription(ready,{status:'partial',auditNeedsRepair:true}),/待核对/);
  assert.equal(agentStageStatusDescription({status:'ready',visualAudit:{allApproved:true}},{status:'ready',visualAudit:{allApproved:true}}),'已生成，核对通过');
  assert.equal(agentStageStatusDescription({status:'ready',visualAudit:{allApproved:true}},{status:'analyzing',auditNeedsRepair:true,progress:{auditRepairStatus:'analyzing'}}),'已生成，核对通过');
  assert.equal(agentAuditStatusDescription({status:'ready',visualAudit:{allApproved:false}}),'已生成，待核对');
  assert.equal(agentStageStatusDescription({status:'ready'},{}),'已完成');
  assert.match(agentAuditStatusDescription({status:'analyzing',auditPending:true,progress:{completed:2,total:2,auditStatus:'analyzing'}}),/正在自动核对/);
  assert.equal(agentAuditStatusDescription({status:'ready'}),'');
});

test('stage audit progress distinguishes generated work from verified stages and identifies the current stage',()=>{
  const job={status:'analyzing',auditPending:true,progress:{completed:2,total:2,auditStatus:'analyzing',auditCompletedStages:1,auditTotalStages:2,auditCurrentStageId:'s2'},stages:[{stageId:'s1',status:'awaiting_audit'},{stageId:'s2',status:'awaiting_audit'}]};
  const summary=agentStatusDescription(job);
  assert.match(summary,/已生成.*自动核对\s*1\/2\s*段/);
  assert.match(summary,/正在核对第\s*2\s*段/);
  assert.doesNotMatch(summary,/已分析\s*2\/2|核对通过|已采用|已发布/);
  assert.match(agentStageStatusDescription(job.stages[1],job),/正在自动核对本段/);
  assert.doesNotMatch(agentStageStatusDescription(job.stages[0],job),/正在自动核对本段|核对通过/);
});

test('failed or cancelled stage audits retain checked counts and explain a bounded resume without claiming a candidate',()=>{
  for(const status of ['failed','cancelled']){
    const job={status,auditPending:true,canRetry:true,failure:status==='failed'?{code:'no_response'}:null,progress:{completed:2,total:2,auditCompletedStages:1,auditTotalStages:2,auditCurrentStageId:'s2'},stages:[{stageId:'s1',status:'awaiting_audit'},{stageId:'s2',status:'awaiting_audit'}]};
    const summary=agentStatusDescription(job);
    assert.match(summary,/已核对\s*1\/2\s*段/);
    assert.match(summary,/下次只继续未核对段/);
    assert.doesNotMatch(summary,/完成的阶段可先核对采用|全段已分析|核对通过|已采用|已发布/);
  }
});

test('single-stage audits and legacy jobs do not invent audit completion or override an active repair',()=>{
  const single={status:'analyzing',auditPending:true,progress:{completed:1,total:1,auditStatus:'analyzing',auditCompletedStages:0,auditTotalStages:1,auditCurrentStageId:'s1'},stages:[{stageId:'s1',status:'awaiting_audit'}]};
  assert.match(agentStatusDescription(single),/自动核对\s*0\/1\s*段/);
  assert.match(agentStatusDescription(single),/正在核对第\s*1\s*段/);
  assert.match(agentAuditStatusDescription({...single,progress:{...single.progress,auditRepairStatus:'analyzing'}}),/自动修复/);
  const legacy={status:'cancelled',progress:{completed:1,total:2},stages:[{status:'ready'},{status:'cancelled'}]};
  assert.doesNotMatch(agentStatusDescription(legacy),/已核对|未核对段|自动核对/);
  for(const progress of [{auditCompletedStages:2,auditTotalStages:1},{auditCompletedStages:-1,auditTotalStages:2},{auditCompletedStages:1.5,auditTotalStages:2}]){
    assert.doesNotMatch(agentStatusDescription({...single,progress}),/自动核对\s*\d+\/\d+\s*段|已核对\s*\d+\/\d+\s*段/);
  }
});

test('collected audits still await native validation and a missing current stage never invents a stage number',()=>{
  const job={status:'analyzing',auditPending:true,progress:{completed:2,total:2,auditStatus:'analyzing',auditCompletedStages:2,auditTotalStages:2,auditCurrentStageId:null},stages:[{stageId:'s1',status:'awaiting_audit'},{stageId:'s2',status:'awaiting_audit'}]};
  assert.match(agentStatusDescription(job),/核对结果已收集\s*2\/2\s*段.*正在校验/);
  assert.doesNotMatch(agentStatusDescription(job),/核对通过|全段已分析|下次只继续/);
  const missing={...job,stages:[{status:'awaiting_audit'}],progress:{...job.progress,auditCompletedStages:0,auditTotalStages:1,auditCurrentStageId:undefined}};
  assert.doesNotMatch(agentStatusDescription(missing),/正在核对第/);
  assert.doesNotMatch(agentStageStatusDescription(missing.stages[0],missing),/正在自动核对本段/);
  const blocked={...job,status:'failed',canRetry:false,progress:{...job.progress,auditCompletedStages:1}};
  assert.match(agentStatusDescription(blocked),/不能继续重试/);
  assert.doesNotMatch(agentStatusDescription(blocked),/下次只继续/);
});

test('visual facts progress describes people and route coverage without counting unbound fixed identities as failed work',()=>{
  const stage={factsReport:{observedPeople:11,routePeople:2,motionPeople:2,exceptionItems:['anchor needs evidence']},coverage:[{annotated:11,uncertain:13,pending:0}]};
  assert.equal(agentStageCoverageDescription(stage),' · 已分析 11 人 · 路线覆盖 2 人 · 1 项疑点');
  assert.doesNotMatch(agentStageCoverageDescription(stage),/13|待确认/);
  assert.equal(agentStageCoverageDescription({factsReport:{observedPeople:0,routePeople:0,motionPeople:0,exceptionItems:[]}}),' · 已分析 0 人 · 路线覆盖 0 人 · 0 项疑点');
  assert.equal(agentStageCoverageDescription({factsReport:{observedPeople:3,exceptionItems:2}}),' · 已分析 3 人 · 2 项疑点');
  assert.equal(agentStageCoverageDescription({factsReport:{routePeople:0,exceptionItems:[]}}),' · 路线覆盖 0 人 · 0 项疑点');
  assert.equal(agentStageCoverageDescription({factsReport:{},coverage:[{annotated:2,uncertain:4,pending:1}]}),' · 已标 2 人，待确认 4 人 · 另 1 项需人工处理');
  assert.equal(agentStageCoverageDescription({factsReport:{observedPeople:-1,routePeople:NaN,exceptionItems:-1},coverage:{annotated:1,uncertain:0,pending:0}}),' · 已标 1 人，待确认 0 人');
  assert.equal(agentStageCoverageDescription({coverage:{annotated:0,uncertain:0,pending:0}}),' · 已标 0 人，待确认 0 人');
  assert.equal(agentStageCoverageDescription({}),'');
});

test('visual facts waiting and storage failures describe the correct operation',()=>{
  assert.match(agentRuntimeDescription({status:'analyzing',runtime:{analysisMode:'visual_facts',modelOutputSeen:false}}),/分析人物与实际动作/);
  assert.match(agentRuntimeDescription({status:'analyzing',runtime:{analysisMode:'visual_facts',modelOutputSeen:false}}),/等待模型返回/);
  assert.equal(agentFailureDescription('storage'),'结果保存受阻');
  assert.doesNotMatch(agentFailureDescription('storage'),/模型|额度|网络/);
});

test('starting a model session is described as waiting, not a completed analysis',()=>{
  const waiting=agentRuntimeDescription({status:'analyzing',runtime:{phase:'waiting_model',elapsedSeconds:22.4,modelOutputSeen:false}});
  assert.match(waiting,/等待模型返回/);assert.match(waiting,/22 秒/);assert.doesNotMatch(waiting,/已收到模型输出/);
  assert.match(agentRuntimeDescription({status:'analyzing',runtime:{elapsedSeconds:24,modelOutputSeen:true,retryMode:'reduced_images'}}),/已收到模型输出.*精简画面重试/);
  assert.equal(agentRuntimeDescription({status:'queued'}),'');
  assert.match(agentRuntimeDescription({status:'analyzing',runtime:{imageInputMode:'contact_sheet',imageCount:5,transportImageCount:1,modelOutputSeen:false}}),/本段抽取 5 幅画面/);
});
test('failure explanations distinguish no response, connectivity, validation and unknown causes',()=>{
  assert.match(agentFailureDescription('no_response'),/未.*返回内容/);
  assert.match(agentFailureDescription('transport'),/连接中断/);
  assert.match(agentFailureDescription('validation'),/校验/);
  assert.doesNotMatch(agentFailureDescription('unknown'),/网络|额度/);
});
test('observed later movement stays a bendable route while manual dashed passes stay straight',()=>{
  assert.equal(isStraightPass({type:'route',style:{pattern:'dashed'},meaning:'later_observed_action'}),false);
  assert.equal(isStraightPass({type:'route',style:{pattern:'dashed'},meaning:'pass'}),true);
  assert.equal(isStraightPass({type:'route',style:{pattern:'dashed'}}),true);
});
test('preview presents validator review feedback before adoption and keeps unrelated runs out',()=>{
  assert.deepEqual(agentReviewIssues({jobId:'new',candidate:{issues:['模型说明']},previewDocument:{agentRuns:[{jobId:'new',issues:['模型说明','尚无路线，请补充']},{jobId:'old',issues:['旧稿说明']}]}}),['模型说明','尚无路线，请补充']);
});
test('all seventy diagnostics remain visible before adoption and after reloading their adopted run',()=>{
  const diagnostics=Array.from({length:70},(_,i)=>`阶段疑点 ${i+1}`),summary='本段有70项具体疑点，详见诊断记录';
  const candidate={issues:[...diagnostics.slice(0,59),summary]};
  const before=agentReviewIssues({jobId:'new',diagnostics,candidate,diagnosticsRef:{file:'diagnostics.json'},
    previewDocument:{agentRuns:[{jobId:'new',issues:diagnostics.slice(0,4)},{jobId:'other',issues:['其他任务问题']}]}});
  assert.equal(before.length,71);for(const issue of diagnostics)assert.ok(before.includes(issue));
  assert.ok(before.includes(summary));assert.ok(!before.includes('其他任务问题'));assert.ok(!before.includes('diagnostics.json'));
  const adopted=agentReviewIssues({jobId:'new',candidate,previewDocument:{agentRuns:[{jobId:'new',issues:[...diagnostics,summary]},{jobId:'other',issues:['其他任务问题']}]}});
  assert.deepEqual(adopted,before);
});
test('diagnostic merging ignores malformed non-string entries and never expands a cache reference or an unscoped run',()=>{
  assert.deepEqual(agentReviewIssues({jobId:'new',diagnostics:['具体问题',null,2,{reason:'不是说明'},'具体问题'],
    candidate:{issues:['摘要',false]},previewDocument:{agentRuns:[null,{jobId:'new',issues:['具体问题','采用后的说明',{}]},{jobId:'old',issues:['旧任务']}]} }),['摘要','具体问题','采用后的说明']);
  assert.deepEqual(agentReviewIssues({diagnosticsRef:['文件引用不是异常'],candidate:{issues:'不能拆成字符'},diagnostics:'不能拆成字符',previewDocument:{agentRuns:[{issues:['未指定任务']}]} }),[]);
  assert.deepEqual(agentReviewIssues({jobId:'new',diagnostics:['唯一'],previewDocument:{agentRuns:{jobId:'new',issues:['非法列表']}}}),['唯一']);
  assert.deepEqual(agentReviewIssues(null),[]);
});
