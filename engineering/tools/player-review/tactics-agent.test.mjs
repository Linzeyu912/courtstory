import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createTacticsDocument,validateDocument,splitPhase,upsertAction} from './tactics-document.mjs';
import {createAnnotation} from './tactics-annotations.mjs';
import * as annotations from './tactics-annotations.mjs';
import {DEFAULT_RIBBON} from './tactics-authored-geometry.mjs';
import {compileTacticKeyframes,upsertTacticKeyframe} from './tactics-keyframes.mjs';
import {compileProduction,updateProductionCue} from './tactics-production.mjs';
import {createManualAnnotation} from './tactics-manual-editor.mjs';
import {makeV2Fixture} from './tactics-v2-fixture.mjs';
const agent=await import('./tactics-agent.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const setup=async()=>{const {review}=await makePresentationDemo();return createTacticsDocument(review);};
const result={summary:'P1 向篮下切入',issues:[],phases:[{title:'切入',startFrame:0,endFrameExclusive:61,freezeFrame:12,reason:'观察到切入',evidenceFrames:[12,20],actions:[],annotations:[{type:'route',entityId:'P1',space:'video',anchorFrame:12,startFrame:12,endFrameExclusive:30,points:[{x:600,y:400},{x:720,y:320}],angle:0,size:1.5,color:'#26baff',explanation:'概括未来切入',evidenceFrames:[12,20]}]}]};
test('Agent data creates editable bound drawings without changing the observation snapshot or approving evidence',async()=>{
  assert.equal(typeof agent.adoptAgentCandidate,'function');const doc=await setup(),before=structuredClone(doc);
  const adopted=await agent.adoptAgentCandidate(doc,result,{jobId:'job-one',scope:'play',phaseId:'phase-1'});
  assert.equal(adopted.annotations.items.length,1);assert.equal(adopted.annotations.items[0].origin.kind,'agent');
  assert.deepEqual(adopted.review,before.review);assert.deepEqual(adopted.playDefinition.reviewEvidence,[]);
  assert.equal(adopted.playDefinition.phases[0].freezeFrame,12);await validateDocument(adopted);
  const repeated=await agent.adoptAgentCandidate(adopted,result,{jobId:'job-one',scope:'play',phaseId:'phase-1'});
  assert.deepEqual(repeated,adopted);
});
test('Agent schema rejects foreign identities, out of range time, unknown command fields and uncalibrated court geometry',async()=>{
  assert.equal(typeof agent.adoptAgentCandidate,'function');const doc=await setup();
  for(const change of [r=>r.command='run',r=>r.phases[0].annotations[0].entityId='stranger',r=>r.phases[0].annotations[0].endFrameExclusive=62,r=>r.phases[0].annotations[0].points.push({x:-1,y:1})]){
    const bad=structuredClone(result);change(bad);await assert.rejects(()=>agent.adoptAgentCandidate(doc,bad,{jobId:'bad',scope:'play',phaseId:'phase-1'}));
  }
  doc.review.court.calibration={keyframes:[]};const bad=structuredClone(result);bad.phases[0].annotations[0].space='court';
  await assert.rejects(()=>agent.adoptAgentCandidate(doc,bad,{jobId:'bad',scope:'play',phaseId:'phase-1'}));
});
test('Agent append preserves existing phase settings and detects unsaved document edits through a content digest',async()=>{
  assert.equal(typeof agent.documentDigest,'function');const doc=await setup(),before=await agent.documentDigest(doc);
  doc.notes='unsaved edit';assert.notEqual(await agent.documentDigest(doc),before);
  const appended=structuredClone(result);appended.phases[0].freezeFrame=doc.playDefinition.phases[0].freezeFrame;
  const adopted=await agent.adoptAgentCandidate(doc,appended,{jobId:'append',scope:'phase',phaseId:'phase-1'});
  assert.deepEqual(adopted.playDefinition.phases,doc.playDefinition.phases);assert.equal(adopted.notes,'unsaved edit');
});
test('phase append rejects a different candidate freeze rather than previewing a frame adoption will never use',async()=>{
  const doc=await setup();
  await assert.rejects(()=>agent.adoptAgentCandidate(doc,result,{jobId:'freeze-mismatch',scope:'phase',phaseId:'phase-1'}),/暂停/);
});

test('adoption rejects every invisible new drawing even when existing human and another new drawing are visible',async()=>{
  let doc=await setup();doc=createAnnotation(doc,{id:'human',type:'screen',entityId:null,phaseId:'phase-1',frame:0,space:'video',points:[{x:300,y:300}]});
  const bad=structuredClone(result);bad.phases[0].freezeFrame=0;
  bad.phases[0].annotations.push({...structuredClone(bad.phases[0].annotations[0]),points:[{x:400,y:400},{x:400,y:400}]});
  const before=structuredClone(doc);
  await assert.rejects(()=>agent.adoptAgentCandidate(doc,bad,{jobId:'zero-route',scope:'phase',phaseId:'phase-1'}),/第 2 个图形.*completed/);
  assert.deepEqual(doc,before);
});

test('a following Agent spotlight needs a real foot at its own anchor even if later positions exist',async()=>{
  const {review}=await makePresentationDemo();review.entities[0].trajectory=review.entities[0].trajectory.filter(p=>p.frame!==12);
  const doc=await createTacticsDocument(review),bad=structuredClone(result);
  bad.phases[0].annotations[0]={...bad.phases[0].annotations[0],type:'spotlight',points:[{x:600,y:400}]};
  await assert.rejects(()=>agent.adoptAgentCandidate(doc,bad,{jobId:'missing-foot',scope:'play',phaseId:'phase-1'}),/第 1 个图形.*missing_position/);
});

test('single-frame court and following drawings produce presentation cues without moving the phase freeze',async()=>{
  const doc=await setup(),candidate=structuredClone(result),annotation=candidate.phases[0].annotations[0];
  candidate.phases[0].freezeFrame=0;
  candidate.phases[0].annotations=[
    {...annotation,type:'screen',entityId:null,space:'court',anchorFrame:12,startFrame:12,endFrameExclusive:13,points:[{x:18,y:10}]},
    {...annotation,type:'spotlight',anchorFrame:20,startFrame:20,endFrameExclusive:21,points:[{x:600,y:400}]}];
  const adopted=await agent.adoptAgentCandidate(doc,candidate,{jobId:'single-frames',scope:'phase',phaseId:'phase-1'});
  assert.equal(typeof annotations.annotationPresentation,'function');const report=annotations.annotationPresentation(adopted);
  assert.equal(adopted.playDefinition.phases[0].freezeFrame,0);
  assert.deepEqual(report.pausePoints.map(p=>p.frame),[12,20]);
  assert.ok(report.items.every(i=>i.visible&&i.mode==='reference_frame'));
});

test('Agent adoption rejects a finite court drawing whose projected paint is entirely outside the viewport',async()=>{
  const {review}=await makePresentationDemo();
  for(const key of review.court.calibration.keyframes)for(const point of key.points)point.image[0]+=1000;
  const doc=await createTacticsDocument(review),candidate=structuredClone(result);
  candidate.phases[0].annotations[0]={...candidate.phases[0].annotations[0],type:'screen',entityId:null,space:'court',anchorFrame:20,points:[{x:26,y:7}]};
  await assert.rejects(()=>agent.adoptAgentCandidate(doc,candidate,{jobId:'offscreen',scope:'play',phaseId:'phase-1'}),/第 1 个图形.*outside_viewport/);
});

const v2=()=>{const candidate=structuredClone(result);candidate.schemaVersion=2;
  candidate.production={cameras:[{id:'view',phaseIndex:0,approximate:true,groundQuad:[[0,0],[10,0],[10,10],[0,10]],keyframes:[{frame:0,quad:[[100,100],[1100,100],[1100,650],[100,650]],evidenceFrames:[0]},{frame:60,quad:[[120,100],[1120,100],[1120,650],[120,650]],evidenceFrames:[60]}]}],timeline:{timebaseFps:30,cues:[{phaseIndex:0,frame:12,settleFrames:5,drawFrames:21,holdFrames:49,easing:'smoothstep'}],endHoldFrames:18}};
  candidate.phases[0].annotations[0].points=[{x:250,y:500},{x:450,y:300},{x:650,y:300},{x:850,y:500}];
  candidate.phases[0].annotations[0].authoredPath={version:1,curve:'cubic_bezier',cameraId:'view',progressFrames:[{frame:12,t:0},{frame:30,t:1}],ribbon:structuredClone(DEFAULT_RIBBON)};return candidate;
};
test('Agent V2 binds approximate production cameras on host and preserves V1 strict compatibility',async()=>{
  const doc=await setup(),candidate=v2(),adopted=await agent.adoptAgentCandidate(doc,candidate,{jobId:'v2',scope:'play',phaseId:'phase-1'});
  assert.equal(adopted.production.cameras[0].id,'v2-camera-view');assert.equal(adopted.production.cameras[0].origin.kind,'agent');
  assert.equal(adopted.annotations.items[0].authoredPath.cameraDigest,adopted.production.cameras[0].digest);assert.deepEqual(adopted.review,doc.review);
  assert.ok(annotations.projectAnnotations(adopted,{phaseId:'v2-phase-0',frame:20}).items[0].video.ribbon);await validateDocument(adopted);
  for(const change of [c=>delete c.production,c=>delete c.phases[0].annotations[0].authoredPath,c=>c.production.cameras[0].approximate=false,c=>c.phases[0].annotations[0].authoredPath.cameraDigest='0'.repeat(64),c=>c.production.cameras[0].phaseIndex=2,
    c=>c.production.cameras[0].keyframes=[{...c.production.cameras[0].keyframes[0],frame:12}],c=>c.phases[0].annotations[0].authoredPath.progressFrames[1].t=.5]){const bad=v2();change(bad);await assert.rejects(agent.adoptAgentCandidate(doc,bad,{jobId:'bad-v2',scope:'play',phaseId:'phase-1'}));}
  const nullable=structuredClone(result);nullable.schemaVersion=2;nullable.production=null;nullable.phases[0].annotations[0].authoredPath=null;
  assert.equal((await agent.adoptAgentCandidate(doc,nullable,{jobId:'v2-null',scope:'play',phaseId:'phase-1'})).annotations.items.length,1);
});

test('V3 range candidates bind prepared points, support dashed/dotted styles and selected adoption without changing manual objects',async()=>{
  const {adoptAgentCandidate}=await import('./tactics-agent.mjs');
  const {makeV2Fixture}=await import('./tactics-v2-fixture.mjs');const {preparationDigest}=await import('./court-preparation.mjs');const {createCourtAnnotation}=await import('./tactics-court-editor.mjs');
  let {document:d}=await makeV2Fixture();d=createCourtAnnotation(d,{id:'human',type:'screen',phaseId:'phase-1',range:{startFrame:30,endFrameExclusive:50},points:[{x:10,y:8}]});
  const candidate={schemaVersion:3,summary:'synthetic contract test',issues:[],range:{startFrame:30,endFrameExclusive:50},preparationDigest:preparationDigest(d.review.courtPreparation),annotations:['dashed','dots'].map((pattern,i)=>({id:'a'+i,phaseId:'phase-1',type:'route',entityId:'P1',startFrame:30,endFrameExclusive:50,cueFrame:30,points:[{x:10,y:8},{x:18,y:6}],curve:'polyline',style:{angle:0,size:1,color:pattern==='dots'?'#ffd45c':'#19a9e1',pattern},meaning:pattern==='dots'?'pass':'later_observed_action',progressFrames:[{frame:30,t:0},{frame:50,t:1}],evidenceFrames:[30,40],explanation:'synthetic evidence'})),keyframes:[{frame:30,annotationIds:['a0','a1'],freeze:true,holdSeconds:2.5}]};
  const options={jobId:'v3-test',scope:'range',phaseId:'phase-1',range:candidate.range};
  const next=await adoptAgentCandidate(d,candidate,{...options,selectedIds:['a1']});assert.equal(next.annotations.items.length,2);assert.deepEqual(next.annotations.items[0],d.annotations.items[0]);assert.equal(next.annotations.items[1].style.pattern,'dots');assert.equal(next.tacticKeyframes.items[0].annotationIds.length,1);
  for(const patch of [{preparationDigest:'0'.repeat(64)},{range:{startFrame:0,endFrameExclusive:60}},{annotations:[{...candidate.annotations[0],endFrameExclusive:60}]}])await assert.rejects(adoptAgentCandidate(d,{...candidate,...patch},options));
});

const videoCandidate=()=>{
  const c=structuredClone(result);c.schemaVersion=4;c.production=null;
  const phase=c.phases[0];phase.annotations[0].authoredPath=null;
  phase.annotations.push({...structuredClone(phase.annotations[0]),type:'spotlight',entityId:'P2',points:[{x:828,y:288}]});
  phase.participants=['P1','P2','P3','P4','P5','P6'].map((entityId,i)=>({subjectId:`local-${i}`,entityId,label:entityId,
    role:i===0?'ball_handler':i===1?'screener':i===5?'defender':'off_ball',disposition:i<2?'annotated':'uncertain',
    annotationIndexes:i<2?[i]:[],evidenceFrames:[12],reason:i<2?'本帧可见动作':'未能判断本阶段战术参与，需要人工检查'}));
  return c;
};
test('V4 direct-video drafts preserve independent participants and expose uncertainty without requiring calibration',async()=>{
  const doc=await setup();delete doc.review.court;
  const {createSourceBinding}=await import('../tactical-overlay/binding.mjs');doc.playDefinition.sourceBinding=await createSourceBinding(doc.review);
  const c=videoCandidate(),next=await agent.adoptAgentCandidate(doc,c,{jobId:'video-many',scope:'play',phaseId:'phase-1'});
  assert.equal(next.annotations.items.length,2);assert.equal(next.annotations.items[1].followEntity,false);
  assert.equal(next.production,undefined);assert.deepEqual(next.review,doc.review);
  assert.equal(next.agentRuns[0].coverage[0].annotated,2);assert.equal(next.agentRuns[0].coverage[0].uncertain,4);
  assert.ok(annotations.annotationPresentation(next).items.every(i=>i.visible));
  assert.equal(next.annotations.items[1].type,'position');
  assert.match(annotations.renderAnnotationsSVG(annotations.projectAnnotations(next,{phaseId:next.playDefinition.phases[0].phaseId,frame:12})),/data-part="position-mark"/);
  assert.ok(next.agentRuns[0].issues.some(issue=>issue.includes('重点圈已改为位置标记')));
});

test('V4 route-first output preserves several observed routes and uses a single holder circle while keeping manual circles',async()=>{
  let {document:doc}=await makeV2Fixture();
  doc=createAnnotation(doc,{id:'human-defender-circle',type:'spotlight',entityId:'P6',phaseId:'phase-1',frame:12,space:'video',points:[{x:500,y:400}],followEntity:false});
  const old=structuredClone(doc.annotations.items[0]),c=videoCandidate(),p=c.phases[0];
  p.annotations[1]={...p.annotations[0],entityId:'P2',points:[{x:828,y:288},{x:760,y:370}],meaning:'later_observed_action',pattern:'dashed'};
  p.annotations.push({...p.annotations[0],type:'spotlight',points:[{x:600,y:400}]});p.participants[0].annotationIndexes.push(2);
  const before=structuredClone(c),next=await agent.adoptAgentCandidate(doc,c,{jobId:'route-first',scope:'play',phaseId:'phase-1'});
  assert.deepEqual(c,before);assert.deepEqual(next.annotations.items[0],old);
  const added=next.annotations.items.slice(1);assert.equal(added.filter(a=>a.type==='route').length,2);
  assert.equal(added.filter(a=>a.type==='spotlight').length,1);assert.equal(added.find(a=>a.type==='spotlight').entityId,'P1');
  const later=added.find(a=>a.entityId==='P2');assert.equal(later.meaning,'later_observed_action');assert.equal(later.style.pattern,'dashed');
  const svg=annotations.renderAnnotationsSVG(annotations.projectAnnotations(next,{phaseId:'phase-1',frame:12,freeze:true}));
  assert.match(svg,/stroke-dasharray=/);await validateDocument(next);
});

test('V4 adoption validates a later observed three-point route without splitting or losing its middle bend',async()=>{
  const {document:doc}=await makeV2Fixture(),candidate=videoCandidate();
  const points=[{x:828,y:288},{x:800,y:350},{x:760,y:370}];
  candidate.phases[0].annotations[1]={...candidate.phases[0].annotations[0],entityId:'P2',points,meaning:'later_observed_action',pattern:'dashed'};
  const original=structuredClone(candidate),next=await agent.adoptAgentCandidate(doc,candidate,{jobId:'observed-bend',scope:'play',phaseId:'phase-1'});
  assert.deepEqual(candidate,original);assert.deepEqual(next.review,doc.review);
  const route=next.annotations.items.filter(a=>a.entityId==='P2');assert.equal(route.length,1);
  assert.deepEqual(route[0].points,points);assert.equal(route[0].meaning,'later_observed_action');assert.equal(route[0].curve,'polyline');
  assert.equal(route[0].style.pattern,'dashed');assert.deepEqual(route[0].origin.sourceFrames,[12,20]);
  const scene=annotations.projectAnnotations(next,{phaseId:route[0].phaseId,frame:12,freeze:true});
  assert.equal(scene.items.filter(a=>a.id===route[0].id).length,1);assert.match(annotations.renderAnnotationsSVG(scene),/stroke-dasharray=/);
  await validateDocument(JSON.parse(JSON.stringify(next)));
});

test('V4 possession changes permit different holders at separate pause frames and reject simultaneous circles',async()=>{
  const doc=await setup(),c=videoCandidate(),p=c.phases[0];
  p.annotations[0]={...p.annotations[0],type:'spotlight',points:[{x:600,y:400}]};
  p.participants[1].role='ball_handler';
  Object.assign(p.annotations[1],{anchorFrame:20,startFrame:20,endFrameExclusive:21,evidenceFrames:[20]});p.participants[1].evidenceFrames=[20];
  const next=await agent.adoptAgentCandidate(doc,c,{jobId:'holder-change',scope:'play',phaseId:'phase-1'});
  assert.deepEqual(next.annotations.items.map(a=>[a.type,a.entityId,a.anchorFrame]),[['spotlight','P1',12],['spotlight','P2',20]]);
  p.annotations[1].anchorFrame=12;p.annotations[1].startFrame=12;p.annotations[1].endFrameExclusive=30;p.annotations[1].evidenceFrames=[12];p.participants[1].evidenceFrames=[12];
  await assert.rejects(agent.adoptAgentCandidate(doc,c,{jobId:'holder-conflict',scope:'play',phaseId:'phase-1'}),/只能圈出一个当前持球人/);
});

test('V4 rejects unsupported movement and semantic mismatches without inventing paths; static-only drafts report a manual route gap',async()=>{
  const doc=await setup();
  for(const patch of [a=>a.evidenceFrames=[12],a=>{a.meaning='later_observed_action';a.pattern='solid';}]){
    const c=videoCandidate();patch(c.phases[0].annotations[0]);
    await assert.rejects(agent.adoptAgentCandidate(doc,c,{jobId:'invalid-route',scope:'play',phaseId:'phase-1'}),/前后画面依据|路线语义/);
  }
  const c=videoCandidate(),p=c.phases[0];p.annotations[0]={...p.annotations[0],type:'spotlight',points:[{x:600,y:400}]};
  p.actions=[{kind:'cut',entityId:'P2',startFrame:12,endFrameExclusive:30,beneficiaryId:null,defenderId:null,note:'有观察到的切入',evidenceFrames:[12,20]}];
  await assert.rejects(agent.adoptAgentCandidate(doc,c,{jobId:'missing-cut-route',scope:'play',phaseId:'phase-1'}),/补路线/);
  p.actions=[];const next=await agent.adoptAgentCandidate(doc,c,{jobId:'static-only',scope:'play',phaseId:'phase-1'});
  assert.equal(next.annotations.items.filter(a=>a.type==='route').length,0);
  assert.ok(next.agentRuns[0].issues.some(issue=>issue.includes('尚无有前后画面依据的路线')));
});

test('V4 normalization preserves sixty original issues and bounds extra diagnostics without rejecting a valid static candidate',async()=>{
  const doc=await setup(),c=videoCandidate(),p=c.phases[0];
  p.annotations[0]={...p.annotations[0],type:'position',points:[{x:600,y:400}]};
  c.issues=Array.from({length:60},(_,i)=>`原始待核对说明 ${i}`);
  const original=structuredClone(c),diagnostics=[],normalized=agent.normalizeVideoCandidate(c,{diagnostics});
  assert.deepEqual(normalized.issues,original.issues);assert.deepEqual(c,original);
  assert.ok(diagnostics.some(issue=>issue.includes('尚无有前后画面依据的路线')));
  assert.ok(diagnostics.every(issue=>issue.length<=2000));
  const next=await agent.adoptAgentCandidate(doc,c,{jobId:'full-issues-static',scope:'play',phaseId:'phase-1'});
  assert.deepEqual(next.agentRuns[0].issues.slice(0,60),original.issues);
  assert.ok(next.agentRuns[0].issues.some(issue=>issue.includes('尚无有前后画面依据的路线')));
  assert.equal(next.annotations.items.filter(a=>a.type==='route').length,0);
  const malformed=structuredClone(original),longDiagnostics=[];
  malformed.phases[0].participants[1].label='长标签'.repeat(1000);
  agent.normalizeVideoCandidate(malformed,{diagnostics:longDiagnostics});
  assert.ok(longDiagnostics.length>0);assert.ok(longDiagnostics.every(issue=>issue.length<=2000));
  await assert.rejects(agent.adoptAgentCandidate(doc,malformed,{jobId:'long-invalid-label',scope:'play',phaseId:'phase-1'}),/文本不正确/);
});
test('V4 rejects silent participant removal, shared drawings and claimed coverage without a drawing',async()=>{
  const doc=await setup();
  for(const change of [c=>c.phases[0].participants.pop(),c=>c.phases[0].participants[1].annotationIndexes=[0],
    c=>c.phases[0].participants[1].annotationIndexes=[],c=>c.phases[0].participants[2].reason='',
    c=>c.phases[0].participants[2].annotationIndexes=[1]]){
    const c=videoCandidate();change(c);await assert.rejects(agent.adoptAgentCandidate(doc,c,{jobId:'bad-video-many',scope:'play',phaseId:'phase-1'}));
  }
});
test('V4 unknown local participants may use visible geometry without creating player identities',async()=>{
  const doc=await setup(),c=videoCandidate(),p=c.phases[0];
  p.annotations.push({...structuredClone(p.annotations[1]),entityId:null,points:[{x:700,y:350}]});
  p.participants.push({subjectId:'visible-defender',entityId:null,label:'画面右侧防守者',role:'defender',disposition:'annotated',annotationIndexes:[2],evidenceFrames:[12],reason:'仅此暂停帧可见，身份未知'});
  const next=await agent.adoptAgentCandidate(doc,c,{jobId:'unknown-person',scope:'play',phaseId:'phase-1'});
  assert.equal(next.annotations.items.at(-1).entityId,null);assert.equal(next.annotations.items.at(-1).followEntity,false);
  assert.deepEqual(next.playDefinition.participants,doc.playDefinition.participants);
});
test('V4 whole-play generation appends to an existing draft without replacing phases, human drawings, actions or production',async()=>{
  let doc=await setup();
  doc=upsertAction(doc,{actionId:'human-action',actorId:'P6',kind:'hold',startFrame:0,endFrameExclusive:61,note:'原人工动作'});
  doc=createAnnotation(doc,{id:'human-circle',type:'spotlight',entityId:null,phaseId:'phase-1',frame:0,space:'video',points:[{x:600,y:450}]});
  const {updateProductionCue}=await import('./tactics-production.mjs');
  doc=updateProductionCue(doc,{phaseId:'phase-1',frame:0,settleFrames:5,drawFrames:21,holdFrames:40});
  const before=structuredClone(doc),options={jobId:'append-whole',scope:'play',phaseId:'phase-1'};
  const next=await agent.adoptAgentCandidate(doc,videoCandidate(),options);
  assert.deepEqual(doc,before);assert.deepEqual(next.annotations.items[0],before.annotations.items[0]);
  assert.deepEqual(next.playDefinition.phases,before.playDefinition.phases);
  assert.deepEqual(next.playDefinition.actions,before.playDefinition.actions);
  assert.deepEqual(next.production,before.production);assert.equal(next.annotations.items.length,3);
  assert.deepEqual(next.agentRuns.at(-1).pendingAnnotations,[]);
  assert.deepEqual(await agent.adoptAgentCandidate(next,videoCandidate(),options),next);
});
test('V4 cross-phase evidence stays explicitly pending while safe anchor-frame drawings append into unchanged manual phases',async()=>{
  let doc=await setup();doc=splitPhase(doc,'phase-1',18);
  const before=structuredClone(doc),c=videoCandidate();c.phases[0].annotations[1].evidenceFrames=[12];
  c.phases[0].actions=[{kind:'screen',entityId:'P2',startFrame:12,endFrameExclusive:30,beneficiaryId:'P1',defenderId:'P6',note:'跨阶段掩护待人工确认',evidenceFrames:[12,20]}];
  const next=await agent.adoptAgentCandidate(doc,c,{jobId:'cross-phase',scope:'play',phaseId:'phase-1'}),run=next.agentRuns.at(-1);
  assert.deepEqual(next.playDefinition.phases,before.playDefinition.phases);assert.deepEqual(next.playDefinition.actions,[]);
  assert.equal(next.annotations.items.length,1);assert.equal(next.annotations.items[0].phaseId,'phase-1');
  assert.equal(next.annotations.items[0].startFrame,12);assert.equal(next.annotations.items[0].endFrameExclusive,18);
  assert.equal(run.pendingAnnotations.length,1);assert.equal(run.pendingActions.length,1);
  assert.deepEqual(run.pendingActions[0].candidateAction,c.phases[0].actions[0]);
  assert.equal(run.pendingActions[0].relations[0].defenderId,'P6');
  assert.deepEqual(run.pendingAnnotations[0].annotation.points,c.phases[0].annotations[0].points);
  assert.equal(run.coverage[0].generated,2);assert.equal(run.coverage[0].annotated,1);assert.equal(run.coverage[0].pending,1);
});

test('V4 appends reference-frame holds to seconds-based drafts while preserving human timing, drawings and phases',async()=>{
  let {document:doc}=await makeV2Fixture();
  doc=createManualAnnotation(doc,{id:'human-circle',type:'spotlight',phaseId:'phase-1',space:'video',
    range:{startFrame:0,endFrameExclusive:61},points:[{x:400,y:400}]});
  doc=upsertTacticKeyframe(doc,{id:'human-pause',frame:12,annotationIds:['human-circle'],holdSeconds:.6});
  doc=updateProductionCue(doc,{phaseId:'phase-1',frame:40,settleFrames:5,drawFrames:21,holdFrames:40});
  const before=structuredClone(doc),c=videoCandidate(),a=c.phases[0].annotations[1];
  Object.assign(a,{anchorFrame:20,startFrame:20,endFrameExclusive:21,evidenceFrames:[20]});
  c.phases[0].participants[1].evidenceFrames=[20];
  const options={jobId:'v4-seconds',scope:'play',phaseId:'phase-1'},next=await agent.adoptAgentCandidate(doc,c,options);
  assert.deepEqual(doc,before);assert.deepEqual(next.annotations.items[0],before.annotations.items[0]);
  assert.deepEqual(next.playDefinition.phases,before.playDefinition.phases);assert.deepEqual(next.production,before.production);
  assert.deepEqual(next.tacticKeyframes.items.slice(0,before.tacticKeyframes.items.length),before.tacticKeyframes.items);
  const cues=compileTacticKeyframes(next);assert.deepEqual(cues.map(k=>[k.frame,k.holdSeconds]),[[12,.6],[20,2.5]]);
  assert.equal(cues[0].kind,undefined);assert.equal(cues[1].kind,'explanation');
  const plan=compileProduction(next),oldPlan=compileProduction(before);
  assert.deepEqual(plan.frames.filter(f=>f.sourceFrame===12&&f.state!=='source'),oldPlan.frames.filter(f=>f.sourceFrame===12&&f.state!=='source'));
  assert.deepEqual(plan.frames.filter(f=>f.sourceFrame===40&&f.state!=='source'),oldPlan.frames.filter(f=>f.sourceFrame===40&&f.state!=='source'));
  assert.equal(plan.frames.filter(f=>f.sourceFrame===20&&f.state!=='source').length,75);
  for(const item of next.annotations.items.slice(1)){
    assert.equal(item.cueFrame,item.anchorFrame);assert.equal(item.timingMode,'manual');assert.equal(item.displayMode,'full');
    assert.equal(item.videoMode,undefined);assert.equal(item.followEntity,false);
    assert.deepEqual(item.actionRange,{startFrame:item.startFrame,endFrameExclusive:item.endFrameExclusive});
    assert.ok(annotations.projectAnnotations(next,{phaseId:item.phaseId,frame:item.anchorFrame,freeze:true,reveal:1}).items.find(a=>a.id===item.id).video);
    assert.equal(annotations.projectAnnotations(next,{phaseId:item.phaseId,frame:item.anchorFrame+1}).items.find(a=>a.id===item.id).video,null);
  }
  assert.deepEqual(await agent.adoptAgentCandidate(next,c,options),next);
});

test('V4 uses the same explicit holds on a blank V2 canvas and keeps late-anchor geometry static',async()=>{
  const {document:doc}=await makeV2Fixture(),c=videoCandidate(),route=c.phases[0].annotations[0];
  Object.assign(route,{anchorFrame:29,evidenceFrames:[20,29]});c.phases[0].participants[0].evidenceFrames=[29];
  const next=await agent.adoptAgentCandidate(doc,c,{jobId:'v4-blank-seconds',scope:'play',phaseId:'phase-1'});
  const cues=compileTacticKeyframes(next);assert.deepEqual(cues.map(k=>k.frame),[12,29]);
  assert.equal(cues[1].kind,undefined);assert.equal(cues[1].holdSeconds,2.5);
  const a=next.annotations.items[0];assert.deepEqual(a.points,route.points);assert.equal(a.startFrame,route.startFrame);
  assert.equal(a.endFrameExclusive,route.endFrameExclusive);assert.equal(a.followEntity,false);assert.equal(a.authoredPath,undefined);
  const projected=annotations.projectAnnotations(next,{phaseId:a.phaseId,frame:29,freeze:true,reveal:1}).items.find(i=>i.id===a.id);
  assert.ok(projected.video);assert.deepEqual(projected.video.curve[0],route.points[0]);
  assert.equal(annotations.projectAnnotations(next,{phaseId:a.phaseId,frame:28}).items.find(i=>i.id===a.id).video,null);
  assert.equal(compileProduction(next).frames.filter(f=>f.sourceFrame===29&&f.state!=='source').length,75);
});

test('V4 does not add V2 pause references for pending cross-phase evidence',async()=>{
  let {document:doc}=await makeV2Fixture();doc=splitPhase(doc,'phase-1',18);
  const c=videoCandidate();c.phases[0].annotations[1].evidenceFrames=[12];
  const next=await agent.adoptAgentCandidate(doc,c,{jobId:'v4-pending-seconds',scope:'play',phaseId:'phase-1'});
  assert.equal(next.agentRuns.at(-1).pendingAnnotations.length,1);
  assert.deepEqual(compileTacticKeyframes(next).flatMap(k=>k.annotationIds),[next.annotations.items[0].id]);
  assert.deepEqual(next.annotations.items[0].actionRange,{startFrame:12,endFrameExclusive:18});
  assert.equal(next.tacticKeyframes.items.some(k=>k.annotationIds.includes('v4-pending-seconds-annotation-0')),false);
});

test('V4 respects existing empty explanation pauses as human content when appending a whole play',async()=>{
  let {document:doc}=await makeV2Fixture();
  doc=upsertTacticKeyframe(doc,{id:'human-empty-pause',kind:'explanation',frame:12,annotationIds:[],holdSeconds:1.2});
  const before=structuredClone(doc),next=await agent.adoptAgentCandidate(doc,videoCandidate(),{jobId:'v4-human-pause',scope:'play',phaseId:'phase-1'});
  assert.deepEqual(next.playDefinition.phases,before.playDefinition.phases);assert.deepEqual(next.tacticKeyframes.items[0],before.tacticKeyframes.items[0]);
  assert.equal(compileTacticKeyframes(next)[0].holdSeconds,1.2);
  assert.deepEqual(compileProduction(next).frames.filter(f=>f.state!=='source'),compileProduction(before).frames.filter(f=>f.state!=='source'));
});

test('V4 reference holds preserve equal-length authored cue timing while a longer explicit hold still extends it',async()=>{
  let {document:doc}=await makeV2Fixture();
  doc=updateProductionCue(doc,{phaseId:'phase-1',frame:12,settleFrames:5,drawFrames:0,holdFrames:40});
  const next=await agent.adoptAgentCandidate(doc,videoCandidate(),{jobId:'v4-equal-cue',scope:'play',phaseId:'phase-1'});
  const pauseFrames=d=>compileProduction(d).frames.filter(f=>f.sourceFrame===12&&f.state!=='source');
  assert.deepEqual(next.production,doc.production);assert.deepEqual(pauseFrames(next),pauseFrames(doc));
  assert.equal(compileTacticKeyframes(next)[0].holdSeconds,1.5);
  const longer=upsertTacticKeyframe(next,{id:'explicit-longer-pause',frame:12,annotationIds:next.annotations.items.map(a=>a.id),holdSeconds:3});
  assert.equal(pauseFrames(longer).length,90);assert.equal(pauseFrames(doc).length,45);
});
