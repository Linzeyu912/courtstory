import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {mountTacticsUI} from './tactics-ui.mjs';
import {createSourceBinding} from '../tactical-overlay/binding.mjs';
import {courtToVideo} from './tactics-presentation.mjs';
import {createTacticsDocument,splitPhase,refreshSnapshot} from './tactics-document.mjs';
import {adoptAgentCandidate} from './tactics-agent.mjs';
import {createAnnotation} from './tactics-annotations.mjs';
import {updateProductionCamera,productionPhaseSnapshot,DEFAULT_RIBBON,compileProduction} from './tactics-production.mjs';
let environmentId=0;
// The storage module keeps one IDB connection for the mounted application.
// Route that connection to each test's transaction store rather than the first fixture.
let activeDatabase;
const connection={transaction(...args){return activeDatabase.transaction(...args);}};
async function productionFixture(){
  let d=await createTacticsDocument((await makePresentationDemo()).review);
  d=updateProductionCamera(d,'cam',{id:'cam',phaseId:'phase-1',phaseSnapshot:productionPhaseSnapshot(d.playDefinition.phases[0]),approximate:true,groundQuad:[[0,0],[10,0],[10,10],[0,10]],keyframes:[{frame:0,quad:[[100,100],[1100,100],[1100,650],[100,650]],evidenceFrames:[0]},{frame:60,quad:[[120,100],[1120,100],[1120,650],[120,650]],evidenceFrames:[60]}]});
  return createAnnotation(d,{id:'bezier',type:'route',phaseId:'phase-1',frame:10,startFrame:10,endFrameExclusive:50,space:'video',points:[{x:250,y:500},{x:450,y:300},{x:650,y:300},{x:850,y:500}],authoredPath:{version:1,curve:'cubic_bezier',cameraId:'cam',cameraDigest:d.production.cameras[0].digest,progressFrames:[{frame:10,t:0},{frame:30,t:.5},{frame:50,t:1}],ribbon:DEFAULT_RIBBON}});
}
test('production guards stage changes and explicit removal preserves static graphics, allows splitting and can undo',async()=>{
  let d=await productionFixture();d=createAnnotation(d,{id:'manual-screen',type:'screen',phaseId:'phase-1',frame:10,space:'video',points:[{x:400,y:400}],style:{color:'#ffd34e'}});
  const original=structuredClone(d),env=environment(d,{player:true});
  try{
    await env.load();const writes=env.writes.length;
    env.get('tacticsSplitAt').value='31';await env.get('tacticsSplit').onclick();assert.equal(env.get('tacticsPhases').children.length,1);
    assert.match(env.get('tacticsStatus').textContent,/先移除成片编排/);await env.get('tacticsRemovePhase').onclick();assert.match(env.get('tacticsStatus').textContent,/先移除成片编排/);
    env.get('tacticsFreeze').value='11';await env.get('tacticsApplyPhase').onclick();assert.equal(env.ui.getSceneState().phase.freezeFrame,0);assert.equal(env.writes.length,writes);
    env.get('tacticsFreeze').value='1';env.get('tacticsPhaseTitle').value='可改阶段名称';await env.get('tacticsApplyPhase').onclick();assert.equal(env.ui.getSceneState().phase.title,'可改阶段名称');
    await env.get('tacticsRemoveProduction').onclick();await env.get('tacticsSave').onclick();const stripped=env.saved.at(-1).document;
    assert.equal(stripped.production,undefined);assert.equal(stripped.annotations.items[0].authoredPath,undefined);
    assert.deepEqual(stripped.annotations.items[0].points,original.annotations.items[0].points);assert.deepEqual(stripped.annotations.items[0].style,original.annotations.items[0].style);
    assert.deepEqual(stripped.annotations.items[1],original.annotations.items[1]);assert.deepEqual(stripped.review,original.review);
    env.get('tacticsSplitAt').value='31';await env.get('tacticsSplit').onclick();assert.equal(env.get('tacticsPhases').children.length,2);
    await env.get('tacticsUndo').onclick();await env.get('tacticsUndo').onclick();await env.get('tacticsSave').onclick();
    assert.deepEqual(env.saved.at(-1).document.production,original.production);assert.deepEqual(env.saved.at(-1).document.annotations,original.annotations);
  }finally{env.restore();}
});
test('same-video review refresh stays stale until explicit production rebind, which saves and undoes without changing evidence',async()=>{
  const d=await productionFixture(),env=environment(d,{player:true});
  try{
    await env.load();d.review=structuredClone(d.review);d.review.exportCompatibility='updated export';await env.load();await env.get('tacticsSave').onclick();
    const stale=env.saved.at(-1).document;assert.throws(()=>compileProduction(stale),/来源/);
    const evidence=structuredClone(stale.review);await env.get('tacticsRebindProduction').onclick();await env.get('tacticsSave').onclick();
    const restored=env.saved.at(-1).document;assert.deepEqual(restored.review,evidence);assert.ok(compileProduction(restored).totalFrames>0);
    assert.deepEqual(restored.production.cameras,stale.production.cameras);assert.match(env.get('tacticsProductionRebindHint').textContent,/核对/);
    await env.get('tacticsUndo').onclick();await env.get('tacticsSave').onclick();assert.deepEqual(env.saved.at(-1).document.production,stale.production);
    assert.deepEqual(env.saved.at(-1).document.annotations,stale.annotations);
  }finally{env.restore();}
});
test('legacy production recovery reads matching saved provenance and refuses an already-replaced saved review',async()=>{
  const original=await productionFixture(),review=structuredClone(original.review);review.exportCompatibility='updated export';
  const stale=await refreshSnapshot(original,review);delete stale.production.mediaBinding;
  for(const reference of [original,stale]){
    let reads=0;const env=environment(stale,{player:true,loadDocument:()=>++reads===1?stale:reference});
    try{
      await env.load();const writes=env.writes.length;await env.get('tacticsRebindProduction').onclick();assert.equal(reads,2);
      if(reference===stale){assert.equal(env.writes.length,writes);assert.match(env.get('tacticsStatus').textContent,/来源凭据/);}
      await env.get('tacticsSave').onclick();const result=env.saved.at(-1).document;
      assert.deepEqual(result.review,stale.review);
      if(reference===original){assert.ok(compileProduction(result).totalFrames>0);assert.equal(result.production.mediaBinding.width,original.review.width);}
      else {assert.deepEqual(result.production,stale.production);assert.throws(()=>compileProduction(result),/来源/);}
    }finally{env.restore();}
  }
});
test('explicit production removal also recovers a previously saved stale stage layout without dropping drawings',async()=>{
  const d=splitPhase(await productionFixture(),'phase-1',30),env=environment(d,{player:true});
  assert.throws(()=>compileProduction(d));
  try{
    await env.load();assert.equal(env.get('tacticsRemoveProduction').disabled,false);
    await env.get('tacticsRemoveProduction').onclick();await env.get('tacticsSave').onclick();
    const result=env.saved.at(-1).document;assert.equal(result.annotations.items.length,d.annotations.items.length);assert.equal(result.production,undefined);
    assert.throws(()=>compileProduction(result),/失效图形/,'removing production must not silently rebind stale drawings');
    env.get('tacticsSeek').value='10';env.get('tacticsSeek').oninput();await env.ui.ready();await Promise.resolve();
    env.get('tacticsObjectList').children[0].onclick();await env.get('tacticsAnnotationRebind').onclick();await env.get('tacticsSave').onclick();
    assert.ok(compileProduction(env.saved.at(-1).document).totalFrames>0,'existing explicit rebind can recover the retained static drawing');
  }finally{env.restore();}
});
test('authored Bezier exposes four fixed controls and progress edits persist with undo',async()=>{
  const d=await productionFixture(),env=environment(d,{player:true});
  try{
    await env.load();env.get('tacticsObjectList').children[0].onclick();await env.ui.ready();await Promise.resolve();
    assert.equal(env.ui.getSceneState().frame,10);assert.equal(env.get('tacticsAnnotationPoint').children.length,4);
    assert.equal(env.get('tacticsAnnotationAddPoint').disabled,true);assert.equal(env.get('tacticsAnnotationDeletePoint').disabled,true);
    assert.match(env.get('tacticsAnnotationPoint').children[1].textContent,/手柄/);
    await env.event('pointerdown',{pointerId:20,target:env.target({'data-annotation-id':'bezier','data-annotation-control-index':'1'}),clientX:450,clientY:300});
    await env.event('pointermove',{pointerId:20,clientX:470,clientY:320});await env.event('pointerup',{pointerId:20});
    assert.deepEqual(env.ui.getSceneState().annotations.items[0].points[1],{x:470,y:320});
    env.get('tacticsProgressPoint').value='1';env.get('tacticsProgressPoint').onchange();env.get('tacticsProgressValue').value='65';await env.get('tacticsProgressApply').onclick();
    await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.annotations.items[0].authoredPath.progressFrames[1].t,.65);
    await env.get('tacticsUndo').onclick();assert.equal(env.ui.getSceneState().annotations.items[0].authoredPath.progressFrames[1].t,.5);
    await env.get('tacticsUndo').onclick();assert.deepEqual(env.ui.getSceneState().annotations.items[0].points[1],{x:450,y:300});
    assert.deepEqual(env.saved.at(-1).document.review,d.review);
  }finally{env.restore();}
});
test('approximate camera corner edits wait for decoded reference and preserve reviewed calibration on save and undo',async()=>{
  const d=await productionFixture(),env=environment(d,{player:true});
  try{
    await env.load();env.get('tacticsCameraFrame').value='60';env.get('tacticsCameraFrame').onchange();env.holdSeek();env.get('tacticsEditCamera').onclick();
    const writes=env.writes.length;await env.event('pointerdown',{pointerId:21,target:env.target({'data-camera-corner':'0'}),clientX:120,clientY:100});
    await env.event('pointermove',{pointerId:21,clientX:145,clientY:105});await env.event('pointerup',{pointerId:21});assert.equal(env.writes.length,writes);
    env.finishSeek();await env.ui.ready();assert.equal(env.ui.getSceneState().frame,60);
    await env.event('pointerdown',{pointerId:22,target:env.target({'data-camera-corner':'0'}),clientX:120,clientY:100});
    await env.event('pointermove',{pointerId:22,clientX:145,clientY:105});await env.event('pointerup',{pointerId:22});await env.get('tacticsSave').onclick();
    const result=env.saved.at(-1).document;assert.deepEqual(result.production.cameras[0].keyframes[1].quad[0],[145,105]);assert.deepEqual(result.review,d.review);
    assert.equal(result.annotations.items[0].authoredPath.cameraDigest,result.production.cameras[0].digest);
    await env.get('tacticsUndo').onclick();await env.get('tacticsSave').onclick();assert.deepEqual(env.saved.at(-1).document.production.cameras[0].keyframes[1].quad[0],[120,100]);
  }finally{env.restore();}
});
test('authored duration and progress endpoints update together instead of locking each other',async()=>{
  const d=await productionFixture(),env=environment(d,{player:true});
  try{
    await env.load();env.get('tacticsObjectList').children[0].onclick();await env.ui.ready();await Promise.resolve();
    env.get('tacticsAnnotationEnd').value='55';await env.get('tacticsAnnotationApplyTime').onclick();
    let a=env.ui.getSceneState().annotations.items[0];assert.equal(a.endFrameExclusive,55);assert.equal(a.authoredPath.progressFrames.at(-1).frame,55);
    env.get('tacticsProgressPoint').value='0';env.get('tacticsProgressPoint').onchange();env.get('tacticsProgressFrame').value='10';await env.get('tacticsProgressApply').onclick();
    a=env.ui.getSceneState().annotations.items[0];assert.equal(a.startFrame,9);assert.equal(a.authoredPath.progressFrames[0].frame,9);
    await env.get('tacticsUndo').onclick();assert.equal(env.ui.getSceneState().annotations.items[0].startFrame,10);
    await env.get('tacticsUndo').onclick();assert.equal(env.ui.getSceneState().annotations.items[0].endFrameExclusive,50);
  }finally{env.restore();}
});
test('authored projected selection seeks its anchor without writing old-frame coordinates and reload keeps edits',async()=>{
  const d=await productionFixture(),env=environment(d,{player:true});
  try{
    await env.load();env.ui.externalSeek(30);env.present(30);await env.ui.ready();env.holdSeek();
    const before=structuredClone(env.ui.getSceneState().annotations.items[0].points),writes=env.writes.length;
    await env.event('pointerdown',{pointerId:25,target:env.target({'data-annotation-id':'bezier'}),clientX:650,clientY:300});
    await env.event('pointermove',{pointerId:25,clientX:700,clientY:330});await env.event('pointerup',{pointerId:25});
    assert.equal(env.ui.getPlaybackState().targetFrame,10);assert.deepEqual(env.ui.getSceneState().annotations.items[0].points,before);assert.equal(env.writes.length,writes);
    env.finishSeek();await env.ui.ready();env.get('tacticsProgressPoint').value='1';env.get('tacticsProgressPoint').onchange();env.get('tacticsProgressValue').value='60';await env.get('tacticsProgressApply').onclick();
    await env.get('tacticsSave').onclick();await env.get('tacticsWorkspace').onclick();await env.ui.ready();
    assert.equal(env.ui.getSceneState().annotations.items[0].authoredPath.progressFrames[1].t,.6);
  }finally{env.restore();}
});
test('freeze animation timing edits share the draft undo and save path',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),env=environment(d);
  try{
    await env.load();assert.deepEqual(['tacticsCueSettle','tacticsCueDraw','tacticsCueHold'].map(id=>Math.round(Number(env.get(id).value)*30)),[5,0,40]);
    env.get('tacticsCueSettle').value='0.5';env.get('tacticsCueDraw').value='1.2';env.get('tacticsCueHold').value='2';
    await env.get('tacticsApplyCue').onclick();await env.get('tacticsSave').onclick();
    const cue=env.saved.at(-1).document.production.timeline.cues[0];assert.deepEqual([cue.settleFrames,cue.drawFrames,cue.holdFrames],[15,36,60]);
    await env.get('tacticsUndo').onclick();await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.production,undefined);
  }finally{env.restore();}
});
test('canvas and delivery preview the same encoded MP4 and changed graphics require regeneration',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),calls=[];
  const env=environment(d,{renderJob:async(path,body)=>{calls.push({path,body});return {id:'movie-1',status:'succeeded',documentDigest:body.documentDigest,videoUrl:'/api/tactics-render/jobs/movie-1/video?sample=test',duration:3,fps:30,totalFrames:90,width:1280,height:720};}});
  try{
    await env.load();await env.get('tacticsRenderStart').onclick();await env.get('deliveryRenderStart').onclick();
    assert.equal(calls.length,1);assert.equal(calls[0].body.expectedVersion,0);
    assert.equal(env.get('tacticsRenderVideo').getAttribute('src'),env.get('deliveryRenderVideo').getAttribute('src'));
    assert.equal(env.get('deliveryRenderDownload').href,env.get('tacticsRenderVideo').getAttribute('src'));
    await env.get('tacticsToolScreen').onclick();await env.event('pointerdown',{pointerId:1,target:env.target(),clientX:650,clientY:300});
    assert.match(env.get('tacticsRenderStatus').textContent,/草稿已修改/);assert.match(env.get('deliveryRenderDownload').textContent,/旧快照/);
    await env.get('deliveryRenderStart').onclick();assert.equal(calls.length,2);assert.equal(calls[1].body.document.annotations.items.length,1);
    assert.match(env.get('tacticsRenderMetadata').textContent,/静音/);
  }finally{env.restore();}
});
test('a slow Agent cancellation keeps generation locked throughout draft reload',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review);let jobs=0,releaseCancel,cancelStarted;
  const started=new Promise(resolve=>cancelStarted=resolve),cancelled=new Promise(resolve=>releaseCancel=resolve);
  const env=environment(d,{agent:async(path)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/cancel')){cancelStarted();await cancelled;return {jobId:'job-1',status:'cancelled'};}
    if(path.endsWith('/jobs')){jobs++;return {jobId:`job-${jobs}`,status:'queued',message:'queued'};}
    return {jobId:`job-${jobs}`,status:'queued',message:'queued'};
  }});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();
    const reload=env.get('tacticsWorkspace').onclick();await started;
    assert.equal(env.get('tacticsAgentRun').disabled,true,'reload must lock before waiting for cancellation');
    await env.get('tacticsAgentRun').onclick();assert.equal(jobs,1);
    releaseCancel();await reload;
    assert.equal(env.get('tacticsAgentRun').disabled,false);assert.equal(env.get('tacticsAgentCancel').hidden,true);
  }finally{releaseCancel();await env.get('tacticsWorkspace').onclick();await env.ui.ready();env.restore();}
});

test('a stale Agent adoption response cannot unlock or relabel a newer queued job',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review);let jobs=0,releaseAdopt,adoptStarted;
  const started=new Promise(resolve=>adoptStarted=resolve),response=new Promise(resolve=>releaseAdopt=resolve);
  const output={summary:'路线建议',issues:[],phases:[{title:'切入',startFrame:0,endFrameExclusive:61,freezeFrame:0,reason:'跑位',evidenceFrames:[0,20],actions:[],annotations:[{type:'route',entityId:'P1',space:'video',anchorFrame:0,startFrame:0,endFrameExclusive:30,points:[{x:600,y:400},{x:700,y:300}],angle:0,size:1,color:'#26baff',explanation:'切入',evidenceFrames:[0,20]}]}]};
  const env=environment(d,{agent:async(path,payload)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/cancel'))return {jobId:`job-${jobs}`,status:'cancelled'};
    if(path.endsWith('/adopt')){adoptStarted();return response;}
    if(path.endsWith('/jobs')){
      jobs++;if(jobs>1)return {jobId:`job-${jobs}`,status:'queued',message:'new job queued'};
      return {jobId:'job-1',status:'ready',message:'ready',candidate:output,previewFrames:[],previewDocument:await adoptAgentCandidate(payload.document,output,{jobId:'job-1',scope:payload.scope,phaseId:payload.phaseId})};
    }
    return {jobId:`job-${jobs}`,status:'queued',message:'new job queued'};
  }});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();const adoption=env.get('tacticsAgentAdopt').onclick();await started;
    await env.get('tacticsWorkspace').onclick();await env.get('tacticsAgentRun').onclick();
    releaseAdopt({document:d});await adoption;
    assert.equal(env.get('tacticsAgentRun').disabled,true);assert.equal(env.get('tacticsAgentCancel').hidden,false);
    assert.equal(env.get('tacticsAgentStatus').textContent,'new job queued');assert.equal(env.ui.getSceneState().annotations.items.length,0);
  }finally{releaseAdopt({document:d});await env.get('tacticsWorkspace').onclick();await env.ui.ready();env.restore();}
});

test('reloading a draft while Agent is generating cancels only the captured job and unlocks a fresh generation',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review);let jobs=0,cancels=0;
  const env=environment(d,{agent:async(path)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/cancel')){cancels++;return {jobId:'old-job',status:'cancelled'};}
    if(path.endsWith('/jobs')){jobs++;return {jobId:'old-job',status:'queued',message:'queued'};}
    return {jobId:'old-job',status:'queued',message:'queued'};
  }});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();
    assert.equal(env.get('tacticsAgentRun').disabled,true);
    await env.get('tacticsWorkspace').onclick();
    assert.equal(env.get('tacticsAgentRun').disabled,false);assert.equal(env.get('tacticsAgentCancel').hidden,true);
    assert.equal(cancels,1);await env.get('tacticsAgentRun').onclick();assert.equal(jobs,2);
  }finally{await env.get('tacticsWorkspace').onclick();await env.ui.ready();env.restore();}
});

test('saving waits until an Agent adoption has committed the editable graphics',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review);let releaseAdopt,adoptStarted,preview;
  const started=new Promise(resolve=>adoptStarted=resolve),response=new Promise(resolve=>releaseAdopt=resolve);
  const output={summary:'路线建议',issues:[],phases:[{title:'切入',startFrame:0,endFrameExclusive:61,freezeFrame:0,reason:'跑位',evidenceFrames:[0,20],actions:[],annotations:[{type:'route',entityId:'P1',space:'video',anchorFrame:0,startFrame:0,endFrameExclusive:30,points:[{x:600,y:400},{x:700,y:300}],angle:0,size:1,color:'#26baff',explanation:'切入',evidenceFrames:[0,20]}]}]};
  const env=environment(d,{agent:async(path,payload)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/adopt')){adoptStarted();return response;}
    preview=await adoptAgentCandidate(payload.document,output,{jobId:'job-1',scope:payload.scope,phaseId:payload.phaseId});
    return {jobId:'job-1',status:'ready',message:'ready',candidate:output,previewDocument:preview,previewFrames:[]};
  }});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();const adoption=env.get('tacticsAgentAdopt').onclick();await started;
    assert.equal(env.get('tacticsSave').disabled,true);await env.get('tacticsSave').onclick();assert.equal(env.saved.length,0);
    releaseAdopt({document:preview});await adoption;assert.equal(env.get('tacticsSave').disabled,false);
    await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.annotations.items.length,1);
  }finally{releaseAdopt({document:preview});await env.ui.ready();env.restore();}
});

test('circle clicks a player box, follows feet at zero offset and changing the player snaps again',async()=>{
  const f=await makePresentationDemo();for(const e of f.review.entities)for(const p of e.trajectory)p.box=[p.x-20,p.y-80,p.x+20,p.y];
  f.playDefinition.sourceBinding=await createSourceBinding(f.review);
  const env=environment({schemaVersion:1,title:'foot',notes:'',...f});
  try{await env.load();const p=f.review.entities[1].trajectory[12];
    await env.get('tacticsToolSpotlight').onclick();await env.event('pointerdown',{pointerId:100,target:env.target(),clientX:p.x,clientY:p.y-50});
    let a=env.ui.getSceneState().annotations.items[0];assert.equal(a.entityId,'P2');assert.equal(a.anchorMode,'player_foot');assert.deepEqual(a.offset,{x:0,y:0});
    assert.match(env.get('tacticsAnnotationPlayerLabel').textContent,/跟随谁/);assert.equal(env.get('tacticsSnapFoot').disabled,false);
    assert.equal(env.get('tacticsSave').disabled,false,'manual graphic completion leaves Save available');
    env.get('tacticsAnnotationPlayer').value='P1';await env.get('tacticsAnnotationPlayer').onchange();a=env.ui.getSceneState().annotations.items[0];assert.equal(a.entityId,'P1');assert.deepEqual(a.offset,{x:0,y:0});
    assert.equal(a.space,'video');await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.annotations.items[0].anchorMode,'player_foot');
  }finally{env.restore();}
});

test('Agent candidate adoption appends editable graphics, preserves manual edits and refuses a stale generation',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review);let captured,preview,job=0,adopts=0;
  const output={summary:'路线建议',issues:[],phases:[{title:'切入',startFrame:0,endFrameExclusive:61,freezeFrame:0,reason:'跑位',evidenceFrames:[0,20],actions:[],annotations:[{type:'route',entityId:'P1',space:'video',anchorFrame:0,startFrame:0,endFrameExclusive:30,points:[{x:600,y:400},{x:700,y:300}],angle:0,size:1,color:'#26baff',explanation:'切入',evidenceFrames:[0,20]}]}]};
  const env=environment(d,{agent:async(path,payload)=>{
    if(path.endsWith('/status'))return {available:true,message:'就绪'};
    if(path.endsWith('/jobs')){captured=payload;job++;preview=await adoptAgentCandidate(payload.document,output,{jobId:`job-${job}`,scope:payload.scope,phaseId:payload.phaseId});return {jobId:`job-${job}`,status:'ready',base:{expectedVersion:payload.expectedVersion,clientRevision:payload.clientRevision,documentDigest:payload.documentDigest},candidate:output,previewDocument:preview,previewFrames:[]};}
    if(path.endsWith('/adopt')){adopts++;return {document:preview};}throw new Error(path);
  }});
  try{await env.load();env.get('tacticsAgentScope').value='play';await env.get('tacticsAgentRun').onclick();assert.equal(env.get('tacticsAgentAdopt').disabled,false);
    await env.get('tacticsAgentAdopt').onclick();assert.equal(env.ui.getSceneState().annotations.items.length,1);assert.equal(adopts,1);assert.deepEqual(env.writes.at(-1).document.review,d.review);
    env.get('tacticsAgentScope').value='phase';await env.get('tacticsAgentRun').onclick();env.get('tacticsNotes').value='人工新增意见';env.get('tacticsNotes').oninput();
    await env.get('tacticsAgentAdopt').onclick();assert.equal(adopts,1);assert.equal(env.ui.getSceneState().annotations.items.length,1);assert.match(env.get('tacticsAgentStatus').textContent,/变化|修改/);
    await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.notes,'人工新增意见');assert.ok(captured.documentDigest);
  }finally{env.restore();}
});

test('adopted frame-only Agent marks become exact preview stops and read-only jump buttons without replacing a manual draft',async()=>{
  const {review}=await makePresentationDemo();review.court.calibration.keyframes=[];
  let d=await createTacticsDocument(review);const phaseId=d.playDefinition.phases[0].phaseId;
  d=createAnnotation(d,{id:'manual-screen',type:'screen',phaseId,frame:0,space:'video',points:[{x:480,y:320}],style:{angle:25}});
  const manual=structuredClone(d.annotations.items[0]);let preview;
  const output={summary:'证据帧标记',issues:['无标定，仅参考画面显示'],phases:[{title:'当前阶段',startFrame:0,endFrameExclusive:61,freezeFrame:0,reason:'证据帧讲解',evidenceFrames:[20,35,45],actions:[],annotations:[20,20,35,45].map((frame,index)=>({type:'screen',entityId:null,space:'video',anchorFrame:frame,startFrame:frame,endFrameExclusive:frame+1,points:[{x:600+index*25,y:340}],angle:0,size:1,color:'#ffd45c',explanation:'仅此参考帧有可靠位置',evidenceFrames:[frame]}))}]};
  const env=environment(d,{player:true,agent:async(path,payload)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/adopt'))return {document:preview};
    preview=await adoptAgentCandidate(payload.document,output,{jobId:'cue-job',scope:payload.scope,phaseId:payload.phaseId});
    return {jobId:'cue-job',status:'ready',candidate:output,previewDocument:preview,previewFrames:[]};
  }});
  try{
    await env.load();env.get('tacticsAgentScope').value='phase';await env.get('tacticsAgentRun').onclick();await env.get('tacticsAgentAdopt').onclick();
    assert.equal(env.ui.getSceneState().annotations.items.length,5);assert.deepEqual(env.ui.getSceneState().annotations.items[0],manual);
    assert.match(env.get('tacticsAgentStatus').textContent,/4 个图形.*3 个.*暂停点/);
    assert.match(env.get('tacticsCueStatus').textContent,/4 个标记讲解暂停点/);
    const buttons=env.get('tacticsCueList').children;assert.equal(buttons.length,4);assert.match(buttons[1].textContent,/2\.00 秒.*2 个图形/);
    const writes=env.writes.length;await env.get('tacticsContinue').onclick();env.holdSeek();env.present(22);
    assert.equal(env.ui.getPlaybackState().status,'seeking');assert.equal(env.ui.getPlaybackState().targetFrame,20);
    const overlay=env.get('tacticsCanvas').children[0].children[1];assert.equal(overlay.children.length,0,'a skipped marker frame cannot draw on the wrong decoded picture');
    assert.doesNotMatch(env.get('tacticsCueStatus').textContent,/已停在/);assert.equal(env.get('tacticsCueList').children[1].disabled,true);
    env.finishSeek();assert.equal(env.ui.getSceneState().frame,20);assert.equal(env.ui.getPlaybackState().status,'paused');
    assert.match(overlay.innerHTML,/cue-job-annotation-0/);assert.match(overlay.innerHTML,/cue-job-annotation-1/);
    assert.match(env.get('tacticsCueStatus').textContent,/已停在标记画面.*继续播放/);assert.equal(env.get('tacticsContinue').textContent,'继续播放');
    assert.equal(env.get('tacticsCueList').children[1].attrs['aria-pressed'],'true');
    await env.get('tacticsContinue').onclick();env.present(36);await Promise.resolve();assert.equal(env.ui.getSceneState().frame,35);
    await env.get('tacticsContinue').onclick();env.present(46);await Promise.resolve();assert.equal(env.ui.getSceneState().frame,45);
    assert.equal(env.writes.length,writes);env.holdSeek();env.get('tacticsCueList').children[1].onclick();
    assert.equal(env.ui.getPlaybackState().targetFrame,20);assert.equal(env.get('tacticsContinue').disabled,true);env.finishSeek();
    assert.equal(env.ui.getSceneState().frame,20);assert.equal(env.writes.length,writes);
    await env.get('tacticsSave').onclick();const saved=env.saved.at(-1).document;
    assert.deepEqual(saved.annotations,preview.annotations);assert.deepEqual(saved.review,d.review);assert.equal(saved.playDefinition.phases.length,1);assert.equal(saved.playDefinition.phases[0].freezeFrame,0);
  }finally{env.restore();}
});

for(const variant of ['server report','legacy without images','empty report']){
  test(`Agent preview uses actual marker frames and exposes unavailable previews: ${variant}`,async()=>{
    const {review}=await makePresentationDemo();review.court.calibration.keyframes=[];const d=await createTacticsDocument(review);
    const annotations=variant==='empty report'?[]:[12,24].map(frame=>({type:'screen',entityId:null,space:'video',anchorFrame:frame,startFrame:frame,endFrameExclusive:frame+1,points:[{x:600,y:320}],angle:0,size:1,color:'#ffd45c',explanation:'参考画面',evidenceFrames:[frame]}));
    const output={summary:'逐帧标记预览',issues:[],phases:[{title:'当前阶段',startFrame:0,endFrameExclusive:61,freezeFrame:0,reason:'参考帧不同于阶段暂停帧',evidenceFrames:[0,12,24],actions:[],annotations}]};
    const env=environment(d,{player:true,agent:async(path,payload)=>{
      if(path.endsWith('/status'))return {available:true,message:'ready'};
      const previewDocument=annotations.length?await adoptAgentCandidate(payload.document,output,{jobId:'preview-job',scope:payload.scope,phaseId:payload.phaseId}):d;
      const items=annotations.map((a,index)=>({id:`preview-job-annotation-${index}`,phaseId:previewDocument.playDefinition.phases[0].phaseId,frame:a.anchorFrame,mode:'reference_frame',visible:true,reason:null}));
      const presentation={items,pausePoints:items.map(item=>({phaseId:item.phaseId,frame:item.frame,annotationIds:[item.id]}))};
      return {jobId:'preview-job',status:'ready',candidate:output,previewDocument,...(variant.startsWith('legacy')?{}:{presentation}),previewFrames:variant==='server report'?[12,24].map(frame=>({...review.sourceFrameMapping[frame],videoSha256:review.videoSha256,dataUrl:'data:image/jpeg;base64,/9j/'})):[]};
    }});
    const walk=node=>[node,...node.children.flatMap(walk)],words=node=>walk(node).map(item=>item.textContent||'').join(' ');
    try{
      await env.load();await env.get('tacticsAgentRun').onclick();const tree=walk(env.get('tacticsAgentPreview'));
      const points=tree.filter(node=>node.attrs['data-preview-frame']!==undefined),images=tree.filter(node=>node.tag==='img');
      assert.deepEqual(points.map(node=>Number(node.attrs['data-preview-frame'])),variant==='empty report'?[0]:[0,12,24]);
      if(variant==='server report'){
        assert.equal(images.length,2);assert.match(images[0].alt,/13/);assert.match(images[1].alt,/25/);
        assert.match(words(points[1]),/1\.20 秒.*本帧可见 1 个/);assert.match(words(points[2]),/2\.40 秒.*本帧可见 1 个/);
        assert.ok(walk(points[1]).some(node=>node.innerHTML?.includes('preview-job-annotation-0')));
        assert.ok(walk(points[2]).some(node=>node.innerHTML?.includes('preview-job-annotation-1')));
        assert.match(words(points[0]),/缺少.*预览图/);
        images[1].onerror();assert.match(words(points[2]),/预览图加载失败/);assert.equal(walk(points[2]).filter(node=>node.tag==='img').length,0);
      }else{
        assert.equal(images.length,0);for(const point of points)assert.match(words(point),/缺少.*预览图/);
        if(variant==='empty report')assert.match(words(env.get('tacticsAgentPreview')),/没有可展示的标记/);
        else assert.match(words(points[1]),/本帧可见 1 个/);
      }
    }finally{env.restore();}
  });
}

test('marker cue navigation respects a phase cue before its freeze and refreshes its read-only list after edits',async()=>{
  const f=await makePresentationDemo();f.review.court.calibration.keyframes=[];f.playDefinition.sourceBinding=await createSourceBinding(f.review);
  let d={schemaVersion:1,title:'phase cues',notes:'',...f};
  for(const [id,phaseId,frame] of [['early','setup',5],['later','finish',35]])d=createAnnotation(d,{id,type:'screen',phaseId,frame,space:'video',points:[{x:600,y:320}]});
  const env=environment(d,{player:true});
  try{
    await env.load();assert.equal(env.ui.getSceneState().frame,5);assert.match(env.get('tacticsCueList').children[0].textContent,/0\.50 秒/);
    const writes=env.writes.length;await env.get('tacticsContinue').onclick();env.present(16);await Promise.resolve();assert.equal(env.ui.getSceneState().frame,12);
    await env.get('tacticsContinue').onclick();env.present(39);await env.ui.ready();await Promise.resolve();
    assert.equal(env.ui.getSceneState().phaseId,'finish');assert.equal(env.ui.getSceneState().frame,35);assert.match(env.get('tacticsCueList').children[0].textContent,/3\.50 秒/);
    assert.equal(env.writes.length,writes);await env.get('tacticsReplay').onclick();await Promise.resolve();assert.equal(env.ui.getSceneState().frame,35);
    env.get('tacticsPause').onclick();env.get('tacticsObjectList').children[0].onclick();await env.get('tacticsQuickDelete').onclick();
    assert.equal(env.get('tacticsCueList').children.length,0);assert.match(env.get('tacticsCueStatus').textContent,/0 个标记讲解暂停点/);
    await env.get('tacticsUndo').onclick();assert.equal(env.get('tacticsCueList').children.length,1);
    assert.deepEqual(env.writes.at(-1).document.review,d.review);assert.deepEqual(env.writes.at(-1).document.playDefinition,d.playDefinition);
  }finally{env.restore();}
});

test('entering tactics synchronizes corrected feet and participants, archives removed player graphics and restores explicitly',async()=>{
  const f=await makePresentationDemo(),d={schemaVersion:1,title:'sync',notes:'',...f},env=environment(d);
  try{await env.load();await env.get('tacticsToolSpotlight').onclick();env.selectPlayer('P1');await env.event('pointerdown',{pointerId:110,target:env.target(),clientX:720,clientY:400});
    const id=env.ui.getSceneState().annotations.items[0].id;d.review=structuredClone(d.review);d.review.entities[0].trajectory[12].x+=30;d.review.entities.push({...structuredClone(d.review.entities[1]),id:'P9',name:'新参与者'});
    await env.load();await env.ui.ready();let saved=env.writes.at(-1).document;assert.equal(saved.annotations.items[0].sourceBinding.reviewDigest,saved.playDefinition.sourceBinding.reviewDigest);assert.ok(saved.playDefinition.participants.some(p=>p.id==='P9'));
    d.review=structuredClone(d.review);d.review.entities=d.review.entities.filter(e=>e.id!=='P1');await env.load();await env.ui.ready();
    saved=env.writes.at(-1).document;assert.equal(saved.annotations.items.length,0);assert.equal(saved.archivedTactics.annotations[0].id,id);assert.equal(env.get('tacticsArchive').hidden,false);
    env.get('tacticsArchivePlayer').value='P2';await env.get('tacticsArchiveList').children[0].onclick();saved=env.writes.at(-1).document;assert.equal(saved.annotations.items[0].id,id);assert.equal(saved.annotations.items[0].entityId,'P2');assert.equal(saved.archivedTactics.annotations.length,0);
  }finally{env.restore();}
});

function environment(source,{player=false,empty=false,agent=null,renderJob=null,loadDocument=null}={}){
  const nodes=new Map(),events={},writes=[],saved=[],store=new Map();let hold=false,releases=[],frameRequests=0;
  function make(tag='div'){
    const node={tag,children:[],attrs:{},listeners:{},style:{},value:'',checked:false,clientWidth:800,hidden:false,textContent:'',
      append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;if(tag==='select')this.value=children[0]?.value||'';},
      setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]??null;},remove(){this.removed=true;},
      querySelector(selector){if(selector==='svg')return this.children.find(n=>n.tag==='svg')||null;return this.children.find(n=>!n.removed&&selector==='[data-edit-handles]'&&n.attrs['data-edit-handles'])||null;},
      addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);},setPointerCapture(id){this.pointer=id;},hasPointerCapture(id){return this.pointer===id;},releasePointerCapture(){this.pointer=null;},click(){},
      drawCalls:[],getContext:()=>({drawImage(...args){node.drawCalls.push(args);},clearRect(){}}),getScreenCTM:()=>({inverse:()=>({})}),createSVGPoint:()=>({matrixTransform(){return {x:this.x,y:this.y};}})};
    Object.defineProperty(node,'innerHTML',{get(){return this.html||'';},set(value){this.html=value;this.children=value.startsWith('<svg')?[make('svg')]:[];}});
    return node;
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
  const originals=new Map(['document','window','location','Image','ResizeObserver','indexedDB','localStorage','fetch'].map(k=>[k,globalThis[k]]));
  const database={transaction(_store,mode){const tx={objectStore:()=>({
    get(key){const r={};queueMicrotask(()=>{r.result=store.get(key);r.onsuccess();});return r;},
    put(value,key){const finish=()=>{store.set(key,structuredClone(value));writes.push(structuredClone(value));tx.oncomplete();};if(hold)releases.push(finish);else queueMicrotask(finish);}
  })};return tx;}};
  activeDatabase=database;Object.assign(globalThis,{
    document:{body:{dataset:{area:'tactics'}},getElementById:get,createElement:make,createElementNS:(_ns,tag)=>make(tag),addEventListener:(name,fn)=>events[name]=fn},
    window:{history:{replaceState(){}}},location:{search:'?sample=test&qa=1'},Image:class{async decode(){}},ResizeObserver:class{observe(){}},
    localStorage:{getItem:()=>null},indexedDB:{open(){const r={};queueMicrotask(()=>{r.result=connection;r.onsuccess();});return r;}},
    fetch:async(path,options)=>{
      let value;if(path.startsWith('/api/tactics?'))value={version:0,document:empty?null:loadDocument?await loadDocument():source};
      else if(path==='/api/tactics/frame'){frameRequests++;value={frames:JSON.parse(options.body).frames.map(frame=>({...source.review.sourceFrameMapping[frame],videoSha256:source.review.videoSha256,dataUrl:'data:image/jpeg;base64,/9j/'}))};}
      else if(path==='/api/tactics/save'){const payload=JSON.parse(options.body);saved.push(payload);value={version:payload.expectedVersion+1};}
      else if(path.startsWith('/api/tactics-agent/')&&agent)value=await agent(path,options?JSON.parse(options.body):null);
      else if(path.startsWith('/api/tactics-render/')&&renderJob)value=await renderJob(path,options?JSON.parse(options.body):null);
      else throw new Error(path);return {ok:true,json:async()=>value};
    }
  });
  let point=null,paused=true,seekSerial=0,seekHeld=false,pendingSeeks=[];const playerCalls=[],background={kind:'decoded-canvas'};
  const present=(frame)=>{seekSerial++;point={frame,time:source.review.sourceFrameMapping[frame].time,source:background,paused};ui.onPresentedFrame?.(point);};
  const bridge=player?{seek(frame){const serial=++seekSerial;playerCalls.push(['seek',frame]);paused=true;const done=()=>{if(serial===seekSerial)present(frame);};if(seekHeld)pendingSeeks.push(done);else queueMicrotask(done);},play(){paused=false;playerCalls.push(['play']);},getPresentedFrame:()=>point}:{};
  const ui=mountTacticsUI({key:`player-review:ui-fixture-${++environmentId}:qa`,sample:'test',variant:'test',qa:true,title:'fixture',clip:{video_sha256:source.review.videoSha256},pause(){paused=true;playerCalls.push(['pause']);},snapshot:()=>source.review,frame:()=>point?.frame??12,openStep(){},...bridge});
  return {get,ui,writes,saved,store,playerCalls,present,background,get frameRequests(){return frameRequests;},get pendingWrites(){return releases.length;},
    holdSeek(){seekHeld=true;},finishSeek(){seekHeld=false;for(const done of pendingSeeks.splice(0))done();},
    async load(){await events['workbench-area']();await ui.ready();},
    async exit(){await events['workbench-area']();},
    async event(name,event){for(const fn of get('tacticsCanvas').listeners[name]||[])await fn({button:0,preventDefault(){},...event});},
    selectPlayer(id){get('tacticsRoutePlayer').value=id;get('tacticsRoutePlayer').onchange();},
    selectRoute(){get('tacticsRoutePlayer').value='P1';get('tacticsRoutePlayer').onchange();get('tacticsShowReference').checked=true;get('tacticsShowReference').onchange?.();const route=ui.getSceneState().model.routes.find(r=>r.entityId==='P1');get('tacticsRoute').value=route.routeId;get('tacticsRoute').onchange();return route;},
    target(attrs={}){return {closest:selector=>{const key=selector.slice(1,-1);return Object.hasOwn(attrs,key)?{getAttribute:k=>attrs[k]??null}:null;}};},
    async key(key,extra={}){await events.keydown?.({key,target:{tagName:'DIV'},preventDefault(){},...extra});},
    handle(index){return {closest:selector=>selector==='[data-control-index]'?{getAttribute:()=>String(index)}:null};},
    hold(){hold=true;},release(){hold=false;for(const release of releases.splice(0))release();},
    restore(){for(const [k,v] of originals){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
  };
}

async function identityFixture(){
  const f=await makePresentationDemo();
  for(const e of f.review.entities)for(const p of e.trajectory)p.box=[p.x-20,p.y-80,p.x+20,p.y];
  const e=f.review.entities[0];e.identityReference={version:1,videoHash:f.review.videoSha256,trackingFingerprint:f.review.trackingFingerprint,
    frame:12,trackId:1,box:e.trajectory[12].box.slice(),team:'紫衣',jersey:'10'};
  f.review.entities[1].playerProfile={status:'confirmed',name:'NBA Name',jersey_number:'30'};
  f.playDefinition.sourceBinding=await createSourceBinding(f.review);return {schemaVersion:1,title:'identity inspection',notes:'',...f};
}

test('player selectors explain confirmed identity, never substitute NBA metadata, and new drawings start unassociated',async()=>{
  const d=await identityFixture(),env=environment(d,{player:true});
  try{
    await env.load();const options=env.get('tacticsRoutePlayer').children;
    assert.equal(env.get('tacticsRoutePlayer').value,'');assert.equal(env.ui.getSceneState().selectedEntityId,null);
    assert.equal(options.find(o=>o.value==='P1').textContent,'紫衣 10 号 · 球员 1');
    assert.equal(options.find(o=>o.value==='P2').textContent,'球员 2 · 身份待确认');
    assert.match(env.get('tacticsPersonDescription').textContent,/尚未关联/);
    await env.get('tacticsToolRoute').onclick();
    for(const [x,y] of [[600,300],[650,320]])await env.event('pointerdown',{target:env.target(),clientX:x,clientY:y});
    await env.get('tacticsFinishDrawing').onclick();assert.equal(env.ui.getSceneState().annotations.items[0].entityId,null);
  }finally{env.restore();}
});

test('person inspection crops the presented frame and highlights only in the editor without writing a document',async()=>{
  const d=await identityFixture(),env=environment(d,{player:true});
  try{
    await env.load();const writes=env.writes.length;
    env.get('tacticsRoutePlayer').value='P1';env.get('tacticsRoutePlayer').onchange();
    assert.equal(env.get('tacticsPersonImage').hidden,false);assert.match(env.get('tacticsPersonReview').textContent,/本帧关联待核对/);
    const box=d.review.entities[0].trajectory[12].box,crop=env.get('tacticsPersonImage').drawCalls.at(-1);
    assert.equal(crop[0],env.background);assert.deepEqual(crop.slice(1,5),[box[0],box[1],box[2]-box[0],box[3]-box[1]]);
    await env.get('tacticsLocatePlayer').onclick();const overlay=env.get('tacticsCanvas').children[0].children[1];
    assert.match(overlay.innerHTML,/data-player-inspection/);assert.doesNotMatch(overlay.innerHTML,/<text\b|<foreignObject\b/);
    assert.equal(env.writes.length,writes);assert.equal(env.ui.getSceneState().annotations.items.length,0);
    await env.get('tacticsContinue').onclick();
    assert.doesNotMatch(overlay.innerHTML,/data-player-inspection/);assert.equal(env.get('tacticsPersonImage').hidden,true);
    env.present(13);
    await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.annotations?.items?.length||0,0);
    assert.deepEqual(env.saved.at(-1).document.review,d.review);
  }finally{env.restore();}
});

test('missing current crops name their fallback frame and never show an old image during a held seek',async()=>{
  const d=await identityFixture();d.review.entities[0].trajectory[13]={frame:13,time:1.3,x:null,y:null,source:'missing'};
  d.playDefinition.sourceBinding=await createSourceBinding(d.review);const env=environment(d,{player:true});
  try{
    await env.load();env.present(13);env.get('tacticsRoutePlayer').value='P1';env.get('tacticsRoutePlayer').onchange();
    assert.equal(env.get('tacticsPersonImage').hidden,true);assert.match(env.get('tacticsPersonDescription').textContent,/当前帧.*无|当前帧.*不可见/);
    assert.match(env.get('tacticsPersonFrame').textContent,/参考帧.*13/);
    const writes=env.writes.length,crops=env.get('tacticsPersonImage').drawCalls.length;env.holdSeek();await env.get('tacticsLocatePlayer').onclick();
    assert.equal(env.get('tacticsPersonImage').hidden,true);assert.equal(env.get('tacticsPersonImage').drawCalls.length,crops);
    assert.match(env.get('tacticsPersonDescription').textContent,/定位/);
    env.finishSeek();await env.ui.ready();
    assert.equal(env.ui.getSceneState().frame,12);assert.equal(env.get('tacticsPersonImage').hidden,false);assert.match(env.get('tacticsPersonFrame').textContent,/参考帧.*13/);
    assert.equal(env.writes.length,writes);
  }finally{env.restore();}
});

test('circles require an explicit player or static choice and inspecting an existing circle never changes its owner',async()=>{
  const d=await identityFixture(),env=environment(d,{player:true});
  try{
    await env.load();await env.get('tacticsToolSpotlight').onclick();
    await env.event('pointerdown',{target:env.target(),clientX:10,clientY:10});
    assert.equal(env.ui.getSceneState().annotations.items.length,0);assert.match(env.get('tacticsStatus').textContent,/先选择|点击人物/);
    env.get('tacticsRoutePlayer').value='__static__';env.get('tacticsRoutePlayer').onchange();
    await env.event('pointerdown',{target:env.target(),clientX:10,clientY:10});
    assert.equal(env.ui.getSceneState().annotations.items[0].entityId,null);assert.equal(env.ui.getSceneState().annotations.items[0].followEntity,false);
    await env.get('tacticsToolSpotlight').onclick();const point=d.review.entities[1].trajectory[12];
    await env.event('pointerdown',{target:env.target(),clientX:point.x,clientY:point.y-50});
    const circle=structuredClone(env.ui.getSceneState().annotations.items[1]),writes=env.writes.length;
    assert.equal(circle.entityId,'P2');assert.match(env.get('tacticsPersonName').textContent,/球员 2/);
    await env.get('tacticsLocatePlayer').onclick();assert.deepEqual(env.ui.getSceneState().annotations.items[1],circle);assert.equal(env.writes.length,writes);
  }finally{env.restore();}
});

test('read-only inspection reaches a reference in another phase even when that phase excludes this player',async()=>{
  const source=await identityFixture();for(const p of source.review.entities[0].trajectory)if(p.frame>=30){p.source='missing';p.x=null;p.y=null;p.box=null;}
  let d=await createTacticsDocument(source.review);d=splitPhase(d,d.playDefinition.phases[0].phaseId,30);
  d.playDefinition.phases[0].participantIds=d.playDefinition.phases[0].participantIds.filter(id=>id!=='P1');
  const env=environment(d,{player:true});
  try{
    await env.load();env.get('tacticsPhases').children[1].onclick();await env.ui.ready();env.selectPlayer('P1');
    assert.equal(env.ui.getSceneState().frame,30);assert.equal(env.get('tacticsPersonImage').hidden,true);
    const writes=env.writes.length;env.holdSeek();await env.get('tacticsLocatePlayer').onclick();await env.ui.ready();
    assert.equal(env.get('tacticsPersonImage').hidden,true);assert.match(env.get('tacticsPersonName').textContent,/紫衣 10 号/);
    env.finishSeek();await env.ui.ready();
    assert.equal(env.ui.getSceneState().frame,12);assert.equal(env.get('tacticsPersonImage').hidden,false);
    assert.match(env.get('tacticsPersonName').textContent,/紫衣 10 号/);assert.match(env.get('tacticsPersonFrame').textContent,/参考帧.*13/);
    const overlay=env.get('tacticsCanvas').children[0].children[1];assert.match(overlay.innerHTML,/data-player-inspection/);
    assert.equal(env.writes.length,writes);await env.get('tacticsSave').onclick();
    assert.deepEqual(env.saved.at(-1).document.playDefinition,d.playDefinition);assert.deepEqual(env.saved.at(-1).document.review,d.review);
    assert.equal(env.saved.at(-1).document.annotations?.items?.length||0,0);
  }finally{env.restore();}
});

test('synchronizing new review positions discards the old inspection crop and track label',async()=>{
  const d=await identityFixture(),env=environment(d,{player:true});
  try{
    await env.load();env.selectPlayer('P1');await env.get('tacticsLocatePlayer').onclick();
    d.review=structuredClone(d.review);Object.assign(d.review.entities[0].trajectory[12],{x:920,y:280,box:[900,200,940,280],trackId:62});
    await env.load();await env.ui.ready();
    const crop=env.get('tacticsPersonImage').drawCalls.at(-1);
    assert.equal(env.get('tacticsPersonImage').hidden,false);assert.deepEqual(crop.slice(1,5),[900,200,40,80]);
    assert.match(env.get('tacticsPersonFrame').textContent,/T62/);
    const overlay=env.get('tacticsCanvas').children[0].children[1];assert.doesNotMatch(overlay.innerHTML,/data-player-inspection/);
    assert.deepEqual(env.writes.at(-1).document.review,d.review);assert.equal(env.writes.at(-1).document.annotations?.items?.length||0,0);
  }finally{env.restore();}
});
// One mounted session exercises the real UI handlers, asynchronous validation and queued drafts.
test('mounted UI edits persist through concurrent notes/title, keeps the canvas stable, cancels phase gestures and restores/undoes separately from review',async()=>{
  const f=await makePresentationDemo(),d={schemaVersion:1,title:'fixture',notes:'',...f},before=structuredClone(d.review),env=environment(d);
  try{
    await env.load();assert.match(env.get('tacticsRouteHint').textContent,/先选择/);
    const state=env.ui.getSceneState(),canvas=state.background,route=env.selectRoute(),point=route.controlPoints[0];
    const host=env.get('tacticsCanvas'),overlay=host.children[0].children[1];
    assert.doesNotMatch(overlay.innerHTML,/<text\b|<foreignObject\b/);
    await env.event('pointerdown',{pointerId:1,target:env.handle(0)});
    await env.event('pointermove',{pointerId:1,clientX:(point.x+.2)*40,clientY:point.y*40});
    assert.equal(env.writes.at(-1).document.presentation,undefined);
    env.hold();const pending=env.event('pointerup',{pointerId:1});await Promise.resolve();await Promise.resolve();
    assert.equal(env.ui.getSceneState().editBusy,true);
    await env.event('pointerdown',{pointerId:2,target:env.handle(0)});await env.event('pointermove',{pointerId:2,clientX:40,clientY:80});await env.event('pointerup',{pointerId:2});
    for(let i=0;i<50&&!env.pendingWrites;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(env.pendingWrites,1,'route document is applied and waiting on the deliberately slow draft');
    env.get('tacticsNotes').value='new notes while route save waits';env.get('tacticsNotes').oninput();
    env.get('tacticsTitle').value='new title while route save waits';env.get('tacticsTitle').oninput();
    const initialRequests=env.frameRequests;env.release();await pending;await env.ui.saveDraft();
    let draft=env.writes.at(-1).document;assert.equal(draft.presentation.routes.length,1);
    assert.ok(Math.abs(draft.presentation.routes[0].controlPoints[0].x-point.x-.2)<1e-6);
    assert.deepEqual(draft.review,before);assert.equal(env.ui.getSceneState().background,canvas);
    assert.equal(env.frameRequests,initialRequests,'presentation-only commit reuses the decoded freeze frame');
    const applied=env.ui.getSceneState().model.routes.find(r=>r.routeId===route.routeId);
    assert.equal(applied.manual,true,'model must reflect the saved presentation before editing unlocks');
    assert.ok(Math.abs(applied.controlPoints[0].x-point.x-.2)<1e-6);
    assert.equal(draft.notes,'new notes while route save waits');assert.equal(draft.title,'new title while route save waits');
    assert.equal(env.get('tacticsNotes').value,draft.notes);assert.equal(env.get('tacticsTitle').value,draft.title);
    env.get('tacticsRoutePlayer').value='P2';env.get('tacticsRoutePlayer').onchange();env.get('tacticsRoutePlayer').value='P1';env.get('tacticsRoutePlayer').onchange();env.selectRoute();
    const internal=applied.controlPoints[1];
    await env.event('pointerdown',{pointerId:4,target:env.handle(1)});await env.event('pointermove',{pointerId:4,clientX:internal.x*40,clientY:(internal.y+.1)*40});await env.event('pointerup',{pointerId:4});
    draft=env.writes.at(-1).document;assert.ok(Math.abs(draft.presentation.routes[0].controlPoints[0].x-point.x-.2)<1e-6,'later drag retains the first saved point');
    assert.equal(draft.notes,'new notes while route save waits');assert.equal(draft.title,'new title while route save waits');
    await env.get('tacticsSave').onclick();assert.equal(env.saved[0].qa,true);assert.equal(env.saved[0].kind,'workspace');assert.deepEqual(env.saved[0].document.presentation,draft.presentation);
    await env.get('tacticsWorkspace').onclick();await env.ui.ready();
    assert.equal(env.ui.getSceneState().model.routes.find(r=>r.routeId===route.routeId).manual,true,'IndexedDB reload retains presentation');
    env.selectRoute();await env.get('tacticsInsertPoint').onclick();draft=env.writes.at(-1).document;
    assert.equal(draft.presentation.routes[0].controlPoints.length,route.controlPoints.length+1);
    assert.equal(env.get('tacticsDeletePoint').disabled,false,'inserted internal point remains selected after rebuild');
    await env.get('tacticsDeletePoint').onclick();assert.equal(env.writes.at(-1).document.presentation.routes[0].controlPoints.length,route.controlPoints.length);
    const count=env.writes.length;
    await env.event('pointerdown',{pointerId:3,target:env.handle(0)});await env.event('pointermove',{pointerId:3,clientX:40,clientY:80});
    env.get('tacticsPhases').children[1].onclick();await env.ui.ready();await env.event('pointerup',{pointerId:3});assert.equal(env.writes.length,count);
    env.get('tacticsPhases').children[0].onclick();await env.ui.ready();env.selectRoute();
    await env.get('tacticsRestoreRoute').onclick();assert.equal(env.writes.at(-1).document.presentation,undefined);
    await env.get('tacticsUndo').onclick();assert.equal(env.writes.at(-1).document.presentation.routes.length,1);assert.deepEqual(env.writes.at(-1).document.review,before);
  }finally{env.release();env.restore();}
});

test('canvas creates and edits an independent route with no detected route, saves/reloads, and undoes without changing evidence',async()=>{
  const f=await makePresentationDemo();for(const e of f.review.entities)e.trajectory=[];
  f.playDefinition.sourceBinding=await createSourceBinding(f.review);
  const d={schemaVersion:1,title:'manual canvas',notes:'',...f},before=structuredClone(f.review),env=environment(d);
  try{
    await env.load();assert.equal(env.ui.getSceneState().model.routes.length,0);
    assert.equal(env.get('tacticsShowReference').checked,false,'no automatic route clutter by default');
    assert.equal(typeof env.get('tacticsToolRoute').onclick,'function');
    await env.get('tacticsToolRoute').onclick();
    for(const [i,p] of [[400,320],[540,270],[660,330]].entries())await env.event('pointerdown',{pointerId:20+i,target:env.target(),clientX:p[0],clientY:p[1]});
    assert.match(env.get('tacticsToolHint').textContent,/完成绘制/);assert.equal(env.get('tacticsFinishDrawing').disabled,false);
    await env.get('tacticsFinishDrawing').onclick();await env.ui.saveDraft();
    let a=env.writes.at(-1).document.annotations.items[0];assert.equal(a.type,'route');assert.equal(a.points.length,3);
    assert.deepEqual(env.writes.at(-1).document.review,before);assert.equal(env.get('tacticsObjectList').children.length,1);
    const routeId=a.id,originalX=a.points[1].x;
    await env.event('pointerdown',{pointerId:30,target:env.target({'data-annotation-control-index':'1','data-annotation-id':routeId}),clientX:540,clientY:270});
    await env.event('pointermove',{pointerId:30,clientX:580,clientY:280});await env.event('pointerup',{pointerId:30});
    a=env.writes.at(-1).document.annotations.items[0];assert.notEqual(a.points[1].x,originalX);
    await env.get('tacticsAnnotationDeletePoint').onclick();assert.equal(env.writes.at(-1).document.annotations.items[0].points.length,2);
    await env.get('tacticsUndo').onclick();assert.equal(env.writes.at(-1).document.annotations.items[0].points.length,3);
    await env.get('tacticsAnnotationAddPoint').onclick();await env.event('pointerdown',{pointerId:31,target:env.target(),clientX:620,clientY:320});
    assert.equal(env.writes.at(-1).document.annotations.items[0].points.length,4);
    await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.annotations.items[0].points.length,4);
    await env.get('tacticsWorkspace').onclick();await env.ui.ready();assert.equal(env.ui.getSceneState().annotations.items.length,1);
    assert.equal(env.ui.getSceneState().annotations.items[0].id,routeId);
  }finally{env.restore();}
});

for(const [tool,pattern,name,color] of [['tacticsToolDashed','dashed','虚线箭头','#19a9e1'],['tacticsToolDots','dots','传球路线','#ffd45c']]){
  test(`${name} completes at two points, supports endpoint and whole-line edits, and persists its pattern without player assignment`,async()=>{
    const f=await makePresentationDemo(),d={schemaVersion:1,title:name,notes:'',...f},env=environment(d,{player:true});
    try{
      await env.load();assert.equal(typeof env.get(tool).onclick,'function');await env.get(tool).onclick();
      assert.match(env.get('tacticsToolHint').textContent,/起点.*终点/);
      const writes=env.writes.length;
      await env.event('pointerdown',{pointerId:200,target:env.target(),clientX:600,clientY:300});
      assert.equal(env.ui.getSceneState().drawingPoints,1);assert.equal(env.writes.length,writes);
      assert.equal(env.get('tacticsFinishDrawing').hidden,true);
      await env.event('pointerdown',{pointerId:200,target:env.target(),clientX:600,clientY:300});
      assert.equal(env.ui.getSceneState().drawingPoints,1);assert.equal(env.ui.getSceneState().annotations.items.length,0);
      assert.match(env.get('tacticsStatus').textContent,/起点.*终点.*重合/);assert.equal(env.writes.length,writes);
      await env.event('pointermove',{pointerId:200,clientX:720,clientY:350});
      const overlay=env.get('tacticsCanvas').children[0].children[1];
      assert.match(overlay.innerHTML,new RegExp(`data-drawing-pattern="${pattern}"`));assert.ok(overlay.innerHTML.includes(color));
      if(pattern==='dots')assert.doesNotMatch(overlay.innerHTML,/data-drawing-arrow/);else assert.match(overlay.innerHTML,/data-drawing-arrow/);
      await env.event('pointerdown',{pointerId:201,target:env.target(),clientX:720,clientY:350});
      let a=env.ui.getSceneState().annotations.items[0];assert.equal(a.type,'route');assert.equal(a.points.length,2);
      assert.equal(a.style.pattern,pattern);assert.equal(a.style.color,color);assert.equal(a.entityId,null);
      assert.equal(env.ui.getSceneState().drawingPoints,0);assert.match(env.get('tacticsSelectedTitle').textContent,new RegExp(name));
      assert.match(env.get('tacticsObjectList').children[0].textContent,new RegExp(name));
      assert.equal(env.get('tacticsAnnotationAddPoint').disabled,true);assert.equal(env.get('tacticsAnnotationDeletePoint').disabled,true);
      await env.get('tacticsAnnotationAddPoint').onclick();assert.doesNotMatch(env.get('tacticsToolHint').textContent,/新的转弯/);
      const id=a.id,before=structuredClone(a.points),position=a.space==='court'?courtToVideo(env.ui.getSceneState().model,12,a.points[0]):a.points[0];
      await env.event('pointerdown',{pointerId:202,target:env.target({'data-annotation-control-index':'0','data-annotation-id':id}),clientX:position.x,clientY:position.y});
      await env.event('pointermove',{pointerId:202,clientX:position.x+20,clientY:position.y+10});await env.event('pointerup',{pointerId:202});
      a=env.ui.getSceneState().annotations.items[0];assert.notDeepEqual(a.points[0],before[0]);assert.deepEqual(a.points[1],before[1]);
      const endpoints=structuredClone(a.points),start=a.space==='court'?courtToVideo(env.ui.getSceneState().model,12,a.points[0]):a.points[0];
      await env.event('pointerdown',{pointerId:203,target:env.target({'data-annotation-id':id}),clientX:start.x,clientY:start.y});
      await env.event('pointermove',{pointerId:203,clientX:start.x+12,clientY:start.y+8});await env.event('pointerup',{pointerId:203});
      a=env.ui.getSceneState().annotations.items[0];assert.notDeepEqual(a.points[0],endpoints[0]);assert.notDeepEqual(a.points[1],endpoints[1]);assert.equal(a.points.length,2);
      env.get('tacticsAnnotationSize').value='1.8';await env.get('tacticsAnnotationSize').onchange();
      env.get('tacticsAnnotationColor').value='#f05a33';await env.get('tacticsAnnotationColor').onchange();
      env.get('tacticsAnnotationStart').value='13';env.get('tacticsAnnotationEnd').value='22';await env.get('tacticsAnnotationApplyTime').onclick();
      const changed=structuredClone(env.ui.getSceneState().annotations.items[0]);assert.equal(changed.style.size,1.8);assert.equal(changed.style.color,'#f05a33');assert.equal(changed.endFrameExclusive,22);
      await env.get('tacticsQuickDelete').onclick();assert.equal(env.ui.getSceneState().annotations.items.length,0);
      await env.get('tacticsUndo').onclick();assert.deepEqual(env.ui.getSceneState().annotations.items[0],changed);
      await env.get('tacticsSave').onclick();assert.deepEqual(env.saved.at(-1).document.review,d.review);assert.equal(env.saved.at(-1).document.annotations.items[0].style.pattern,pattern);
      await env.get('tacticsWorkspace').onclick();await env.ui.ready();assert.deepEqual(env.ui.getSceneState().annotations.items[0],changed);
    }finally{env.restore();}
  });
}

test('screen and player spotlight are visible independent objects; playback and phase changes discard incomplete gestures',async()=>{
  const f=await makePresentationDemo(),env=environment({schemaVersion:1,title:'marks',notes:'',...f},{player:true});
  try{
    await env.load();await env.get('tacticsToolScreen').onclick();
    await env.event('pointerdown',{pointerId:41,target:env.target(),clientX:650,clientY:300});
    let items=env.writes.at(-1).document.annotations.items;assert.equal(items[0].type,'screen');
    assert.equal(env.get('tacticsContinue').disabled,false,'finishing a manual edit must restore the visible preview button');
    const overlay=env.get('tacticsCanvas').children[0].children[1];assert.match(overlay.innerHTML,/data-annotation-id/);
    env.get('tacticsAnnotationAngle').value='45';await env.get('tacticsAnnotationAngle').onchange();
    assert.equal(env.writes.at(-1).document.annotations.items[0].style.angle,45);
    await env.get('tacticsToolSpotlight').onclick();env.selectPlayer('P1');await env.event('pointerdown',{pointerId:42,target:env.target(),clientX:720,clientY:410});
    items=env.writes.at(-1).document.annotations.items;assert.equal(items[1].type,'spotlight');assert.equal(items[1].followEntity,true);
    assert.match(overlay.innerHTML,/<(?:ellipse|polygon|path)\b/);assert.doesNotMatch(overlay.innerHTML,/<text\b/);
    await env.get('tacticsAnnotationDelete').onclick();assert.equal(env.writes.at(-1).document.annotations.items.length,1);
    await env.get('tacticsUndo').onclick();assert.equal(env.writes.at(-1).document.annotations.items.length,2);
    await env.get('tacticsToolRoute').onclick();await env.event('pointerdown',{pointerId:43,target:env.target(),clientX:600,clientY:360});
    await env.get('tacticsContinue').onclick();assert.equal(env.ui.getSceneState().drawingPoints,0);
    env.get('tacticsPause').onclick();await env.get('tacticsToolRoute').onclick();await env.event('pointerdown',{pointerId:44,target:env.target(),clientX:600,clientY:360});
    env.get('tacticsPhases').children[1].onclick();await env.ui.ready();assert.equal(env.ui.getSceneState().drawingPoints,0);
    assert.equal(env.writes.at(-1).document.annotations.items.length,2);
    await env.get('tacticsToolRoute').onclick();await env.event('pointerdown',{pointerId:45,target:env.target(),clientX:600,clientY:360});
    await env.key('Escape');assert.equal(env.ui.getSceneState().drawingPoints,0);
  }finally{env.restore();}
});

test('selected marker actions stay beside the canvas and rotate/delete/undo/save/reload the selected object',async()=>{
  const f=await makePresentationDemo(),env=environment({schemaVersion:1,title:'marker actions',notes:'',...f},{player:true});
  try{
    await env.load();assert.equal(env.get('tacticsSelectionActions').hidden,true);
    await env.get('tacticsToolScreen').onclick();await env.event('pointerdown',{pointerId:61,target:env.target(),clientX:650,clientY:300});
    let a=env.ui.getSceneState().annotations.items[0];const id=a.id;
    assert.equal(env.ui.getSceneState().selectedAnnotationId,id);assert.equal(env.get('tacticsSelectionActions').hidden,false);
    assert.equal(env.get('tacticsSelectionRotation').hidden,false);assert.equal(env.get('tacticsQuickAngle').textContent,'0°');
    await env.get('tacticsRotateLeft').onclick();assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,345);
    await env.get('tacticsRotateRight').onclick();assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,0);
    env.get('tacticsAnnotationAngle').value='95';
    await env.get('tacticsAnnotationAngle').onchange();assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,95);
    await env.get('tacticsQuickDelete').onclick();assert.equal(env.ui.getSceneState().annotations.items.length,0);
    assert.equal(env.get('tacticsSelectionActions').hidden,true);assert.equal(env.ui.getSceneState().selectedAnnotationId,null);
    assert.match(env.get('tacticsStatus').textContent,/已删除挡拆标记.*撤销/);
    await env.get('tacticsUndo').onclick();assert.equal(env.ui.getSceneState().annotations.items[0].id,id);
    assert.equal(env.get('tacticsSelectionActions').hidden,false);assert.equal(env.get('tacticsQuickAngle').textContent,'95°');
    await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.annotations.items[0].style.angle,95);
    await env.get('tacticsWorkspace').onclick();await env.ui.ready();
    assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,95);
    env.get('tacticsObjectList').children[0].onclick();await env.get('tacticsDeselect').onclick();
    assert.equal(env.ui.getSceneState().selectedAnnotationId,null);assert.equal(env.get('tacticsSelectionActions').hidden,true);
    await env.event('pointerdown',{pointerId:62,target:env.target({'data-annotation-id':id}),clientX:650,clientY:300});await env.event('pointerup',{pointerId:62});
    await env.key('Delete');assert.equal(env.ui.getSceneState().annotations.items.length,0);await env.get('tacticsUndo').onclick();
    await env.get('tacticsToolSpotlight').onclick();env.selectPlayer('P1');await env.event('pointerdown',{pointerId:63,target:env.target(),clientX:720,clientY:400});
    assert.equal(env.get('tacticsSelectionRotation').hidden,true);assert.equal(env.get('tacticsQuickDelete').disabled,false);
    await env.get('tacticsQuickDelete').onclick();assert.equal(env.ui.getSceneState().annotations.items.length,1);
  }finally{env.restore();}
});

test('rotation handle uses original annotation space, previews without writing, and cancels on seek or phase change',async()=>{
  const f=await makePresentationDemo();
  // Anisotropic projection makes a screen-space 45 degree drag a different court angle.
  for(const keyframe of f.review.court.calibration.keyframes)for(const p of keyframe.points)p.image[0]*=1.5;
  f.playDefinition.sourceBinding=await createSourceBinding(f.review);
  const env=environment({schemaVersion:1,title:'rotate on ground',notes:'',...f},{player:true});
  try{
    await env.load();await env.get('tacticsToolScreen').onclick();await env.event('pointerdown',{pointerId:71,target:env.target(),clientX:650,clientY:300});
    const a=env.ui.getSceneState().annotations.items[0],id=a.id,center=a.points[0],state=env.ui.getSceneState();assert.equal(a.space,'court');
    const toVideo=p=>courtToVideo(state.model,state.frame,p),start=toVideo({x:center.x,y:center.y-1}),end=toVideo({x:center.x+1,y:center.y-1});
    const target=env.target({'data-annotation-id':id,'data-annotation-rotate':'true'}),before=env.writes.length;
    await env.event('pointerdown',{pointerId:72,target,clientX:start.x,clientY:start.y});
    await env.event('pointermove',{pointerId:72,clientX:end.x,clientY:end.y});
    assert.equal(env.writes.length,before);assert.equal(env.get('tacticsQuickAngle').textContent,'45°');
    await env.event('pointerup',{pointerId:72});assert.equal(env.writes.length,before+1);
    assert.ok(Math.abs(env.ui.getSceneState().annotations.items[0].style.angle-45)<.001);
    assert.deepEqual(env.ui.getSceneState().annotations.items[0].points,a.points,'rotation does not move the marker');
    await env.get('tacticsUndo').onclick();assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,0);
    for(const navigation of ['seek','phase']){
      const count=env.writes.length;await env.event('pointerdown',{pointerId:73,target,clientX:start.x,clientY:start.y});
      await env.event('pointermove',{pointerId:73,clientX:end.x,clientY:end.y});
      if(navigation==='seek'){env.ui.externalSeek(state.frame+1);await Promise.resolve();}else{env.get('tacticsPhases').children[1].onclick();await env.ui.ready();}
      await env.event('pointerup',{pointerId:73});assert.equal(env.writes.length,count);
      assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,0);
    }
  }finally{env.restore();}
});

test('unmapped video marker rotates freely and route deletion is available beside the canvas',async()=>{
  const f=await makePresentationDemo();f.review.entities=[];f.review.court.calibration.keyframes=[];
  const env=environment({schemaVersion:1,title:'free markers',notes:'',...f},{player:true,empty:true});
  try{
    await env.load();await env.get('tacticsCreateCanvas').onclick();await env.ui.ready();
    await env.get('tacticsToolScreen').onclick();await env.event('pointerdown',{pointerId:81,target:env.target(),clientX:650,clientY:300});
    const a=env.ui.getSceneState().annotations.items[0];assert.equal(a.space,'video');
    await env.event('pointerdown',{pointerId:82,target:env.target({'data-annotation-id':a.id,'data-annotation-rotate':'true'}),clientX:650,clientY:260});
    await env.event('pointermove',{pointerId:82,clientX:690,clientY:300});await env.event('pointerup',{pointerId:82});
    assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,90);
    await env.get('tacticsToolRoute').onclick();
    for(const p of [[400,320],[600,400]])await env.event('pointerdown',{pointerId:83,target:env.target(),clientX:p[0],clientY:p[1]});
    await env.get('tacticsFinishDrawing').onclick();assert.equal(env.get('tacticsSelectionRotation').hidden,true);
    await env.get('tacticsQuickDelete').onclick();assert.equal(env.ui.getSceneState().annotations.items.length,1);
    await env.get('tacticsUndo').onclick();assert.equal(env.ui.getSceneState().annotations.items.length,2);
  }finally{env.restore();}
});

test('the empty-state primary action creates a usable manual canvas with no players or calibration',async()=>{
  const f=await makePresentationDemo();f.review.entities=[];f.review.court.calibration.keyframes=[];
  const env=environment({schemaVersion:1,title:'empty',notes:'',...f},{player:true,empty:true});
  try{
    await env.load();assert.equal(env.get('tacticsEmpty').hidden,false);assert.equal(env.get('tacticsCreateCanvas').disabled,false);
    await env.get('tacticsCreateCanvas').onclick();await env.ui.ready();
    assert.equal(env.get('tacticsEmpty').hidden,true);assert.equal(env.get('tacticsToolRoute').disabled,false);
    await env.get('tacticsToolRoute').onclick();
    for(const p of [[400,320],[600,400]])await env.event('pointerdown',{pointerId:60,target:env.target(),clientX:p[0],clientY:p[1]});
    await env.get('tacticsFinishDrawing').onclick();
    assert.equal(env.ui.getSceneState().annotations.items[0].entityId,null);
    assert.equal(env.ui.getSceneState().annotations.items[0].space,'video');
  }finally{env.restore();}
});

test('merging a phase keeps its orphaned drawings reachable for explicit rebind or deletion',async()=>{
  const f=await makePresentationDemo(),env=environment({schemaVersion:1,title:'merge',notes:'',...f},{player:true});
  try{
    await env.load();await env.get('tacticsToolScreen').onclick();
    await env.event('pointerdown',{pointerId:51,target:env.target(),clientX:650,clientY:300});
    const id=env.ui.getSceneState().annotations.items[0].id;
    await env.get('tacticsRemovePhase').onclick();await env.ui.ready();
    const entry=env.get('tacticsObjectList').children.find(b=>b.getAttribute('data-object-id')===id);
    assert.ok(entry,'removed-phase objects remain selectable');assert.match(entry.textContent,/待重新定位/);
    entry.onclick();assert.equal(env.get('tacticsAnnotationRebind').hidden,false);
    await env.get('tacticsAnnotationRebind').onclick();await env.ui.ready();
    assert.equal(env.ui.getSceneState().annotations.items[0].phaseId,env.ui.getSceneState().phaseId);
    assert.equal(env.get('tacticsAnnotationRebind').hidden,true);
    await env.get('tacticsAnnotationDelete').onclick();assert.equal(env.ui.getSceneState().annotations.items.length,0);
  }finally{env.restore();}
});

test('mounted playback reuses decoded frames, trims cached routes, pauses on skipped freeze, seeks backwards and exits safely',async()=>{
  const f=await makePresentationDemo();f.review.court.calibration.keyframes=f.review.court.calibration.keyframes.filter(k=>k.frame!==20);f.playDefinition.sourceBinding=await createSourceBinding(f.review);
  const d={schemaVersion:1,title:'fixture',notes:'',...f},env=environment(d,{player:true});
  try{
    await env.load();await Promise.resolve();assert.equal(env.frameRequests,0);
    assert.equal(env.ui.getSceneState().frame,12);const model=env.ui.getSceneState().model,canvas=env.ui.getSceneState().background;
    await env.get('tacticsContinue').onclick();assert.equal(env.ui.getPlaybackState().status,'playing');
    env.present(20);assert.equal(env.ui.getSceneState().model,model);assert.equal(env.ui.getSceneState().background,canvas);assert.equal(canvas.hidden,false);
    const overlay=env.get('tacticsCanvas').children[0].children[1];assert.doesNotMatch(overlay.innerHTML,/<polyline|<text\b/);assert.match(env.get('tacticsPresentationStatus').textContent,/缺少有效标定/);
    env.present(26);const remaining=env.ui.getSceneState().model.routes[0];assert.ok(remaining.curve.length>1);
    env.present(49);await env.ui.ready();await Promise.resolve();assert.equal(env.ui.getSceneState().phaseId,'finish');assert.equal(env.ui.getSceneState().frame,42);assert.equal(env.ui.getPlaybackState().status,'paused');
    const stops=env.playerCalls.filter(c=>c[0]==='seek'&&c[1]===42).length;env.present(42);assert.equal(env.playerCalls.filter(c=>c[0]==='seek'&&c[1]===42).length,stops);
    await env.get('tacticsReplay').onclick();await Promise.resolve();assert.equal(env.ui.getPlaybackState().status,'playing');
    env.ui.externalSeek(16);env.present(16);await env.ui.ready();assert.equal(env.ui.getSceneState().phaseId,'setup');assert.equal(env.ui.getPlaybackState().status,'paused');
    env.holdSeek();env.get('tacticsPhases').children[1].onclick();await env.ui.ready();
    assert.equal(env.ui.getSceneState().background.hidden,true,'a ready new model cannot paint on the previous phase decoded background while seeking');
    assert.equal(overlay.children.length,0);env.finishSeek();assert.equal(env.ui.getSceneState().background.hidden,false);
    env.get('tacticsPhases').children[0].onclick();await env.ui.ready();
    env.get('tacticsPhases').children[1].onclick();env.ui.externalSeek(50);env.present(50);await env.ui.ready();
    assert.ok(env.ui.getSceneState().model,'external seek during same-phase preparation must keep a current model');assert.equal(env.ui.getSceneState().frame,50);
    assert.equal(env.frameRequests,0);const plays=env.playerCalls.filter(c=>c[0]==='play').length;
    globalThis.document.body.dataset.area='footage';await env.exit();env.present(60);assert.equal(env.ui.getPlaybackState().status,'inactive');assert.equal(env.playerCalls.filter(c=>c[0]==='play').length,plays);
  }finally{env.restore();}
});

test('canvas progress seeks decoded frames, blocks pending edits, and leaves external seek as notification only',async()=>{
  const f=await makePresentationDemo(),env=environment({schemaVersion:1,title:'canvas seek',notes:'',...f},{player:true});
  try{
    await env.load();assert.equal(env.ui.getSceneState().frame,12);
    await env.get('tacticsToolRoute').onclick();await env.event('pointerdown',{pointerId:91,target:env.target(),clientX:650,clientY:300});
    const calls=env.playerCalls.length,writes=env.writes.length;
    env.holdSeek();env.get('tacticsSeek').value='20';env.get('tacticsSeek').oninput();
    assert.deepEqual(env.playerCalls.slice(calls),[['pause'],['seek',20]]);
    assert.deepEqual(env.ui.getPlaybackState(),{phaseId:'setup',status:'seeking',targetFrame:20});
    assert.equal(env.ui.getSceneState().frame,12,'do not label the old decoded frame as the requested frame');
    assert.equal(env.ui.getSceneState().editingEnabled,false);assert.equal(env.get('tacticsToolRoute').disabled,true);
    assert.equal(env.ui.getSceneState().drawingPoints,0);
    await env.event('pointerdown',{pointerId:92,target:env.target(),clientX:650,clientY:300});
    assert.equal(env.ui.getSceneState().drawingPoints,0);assert.equal(env.writes.length,writes);
    env.ui.onPresentedFrame({frame:12,time:1.2,source:env.background,paused:true});
    assert.equal(env.ui.getPlaybackState().status,'seeking');assert.equal(env.ui.getSceneState().editingEnabled,false);
    env.finishSeek();assert.equal(env.ui.getSceneState().frame,20);assert.equal(env.ui.getPlaybackState().status,'paused');
    assert.equal(env.get('tacticsToolRoute').disabled,false);assert.equal(env.ui.getSceneState().editingEnabled,true);
    const sameFrameCalls=env.playerCalls.length;
    env.get('tacticsSeek').value='20';env.get('tacticsSeek').oninput();await Promise.resolve();
    assert.deepEqual(env.playerCalls.slice(sameFrameCalls),[['pause'],['seek',20]]);
    assert.equal(env.ui.getPlaybackState().status,'paused');assert.equal(env.ui.getSceneState().frame,20);
    const externalCalls=env.playerCalls.length;
    env.ui.externalSeek(24);assert.deepEqual(env.playerCalls.slice(externalCalls),[['pause']]);
    assert.equal(env.ui.getSceneState().editingEnabled,false);
    env.present(24);assert.equal(env.ui.getSceneState().frame,24);assert.equal(env.ui.getSceneState().editingEnabled,true);
  }finally{env.restore();}
});

test('canvas requested seeks change phase without substituting its freeze frame or enabling undecoded edits',async()=>{
  const f=await makePresentationDemo(),env=environment({schemaVersion:1,title:'phase canvas seek',notes:'',...f},{player:true});
  try{
    await env.load();env.holdSeek();const calls=env.playerCalls.length;
    env.get('tacticsSeek').value='35';env.get('tacticsSeek').oninput();await env.ui.ready();
    assert.deepEqual(env.playerCalls.slice(calls),[['pause'],['seek',35]]);
    assert.deepEqual(env.ui.getPlaybackState(),{phaseId:'finish',status:'seeking',targetFrame:35});
    assert.equal(env.ui.getSceneState().phaseId,'finish');assert.equal(env.get('tacticsToolScreen').disabled,true);
    assert.equal(env.ui.getSceneState().background.hidden,true);
    env.finishSeek();assert.equal(env.ui.getSceneState().frame,35);assert.equal(env.ui.getPlaybackState().status,'paused');
    assert.equal(env.get('tacticsToolScreen').disabled,false);assert.equal(env.ui.getSceneState().background.hidden,false);
  }finally{env.restore();}
});

test('selecting a hidden frame-only object seeks its actual anchor and keeps the saved drawing unchanged',async()=>{
  const f=await makePresentationDemo();f.review.court.calibration.keyframes=[];f.playDefinition.sourceBinding=await createSourceBinding(f.review);
  const env=environment({schemaVersion:1,title:'return to object',notes:'',...f},{player:true});
  try{
    await env.load();await env.get('tacticsToolScreen').onclick();
    await env.event('pointerdown',{pointerId:93,target:env.target(),clientX:650,clientY:300});
    const annotation=structuredClone(env.ui.getSceneState().annotations.items[0]),writes=env.writes.length;
    assert.equal(annotation.space,'video');assert.equal(annotation.anchorFrame,12);
    env.ui.externalSeek(20);env.present(20);assert.equal(env.ui.getSceneState().frame,20);
    env.holdSeek();const calls=env.playerCalls.length;
    env.get('tacticsObjectList').children[0].onclick();
    assert.deepEqual(env.playerCalls.slice(calls),[['pause'],['seek',12]]);
    assert.equal(env.get('tacticsQuickDelete').disabled,true);
    env.finishSeek();assert.equal(env.ui.getSceneState().frame,12);assert.equal(env.ui.getPlaybackState().status,'paused');
    assert.equal(env.get('tacticsQuickDelete').disabled,false);assert.equal(env.ui.getSceneState().selectedAnnotationId,annotation.id);
    assert.deepEqual(env.ui.getSceneState().annotations.items[0],annotation);assert.equal(env.writes.length,writes);
    assert.match(env.get('tacticsCanvas').children[0].children[1].innerHTML,/data-part="screen-bar"/);
  }finally{env.restore();}
});

test('same-phase seek during a saved presentation rebuild applies the new model before edits unlock and retains the first edit',async()=>{
  const f=await makePresentationDemo(),env=environment({schemaVersion:1,title:'fixture',notes:'',...f},{player:true});
  const subtle=globalThis.crypto.subtle,own=Object.getOwnPropertyDescriptor(subtle,'digest'),real=subtle.digest;
  let release,blocked;const gate=new Promise(resolve=>release=resolve),reached=new Promise(resolve=>blocked=resolve);
  try{
    await env.load();const route=env.selectRoute(),first=route.controlPoints[0],changedX=first.x+.2;
    await env.event('pointerdown',{pointerId:7,target:env.handle(0)});
    await env.event('pointermove',{pointerId:7,clientX:changedX*40,clientY:first.y*40});
    Object.defineProperty(subtle,'digest',{configurable:true,value:async function(algorithm,data){
      const value=JSON.parse(new TextDecoder().decode(data));
      if(value?.points&&Object.hasOwn(value,'breakBefore')){blocked();await gate;}
      return real.call(this,algorithm,data);
    }});
    const pending=env.event('pointerup',{pointerId:7});await reached;await env.ui.saveDraft();
    await env.get('tacticsSave').onclick();assert.ok(Math.abs(env.saved.at(-1).document.presentation.routes[0].controlPoints[0].x-changedX)<1e-6);
    assert.equal(env.ui.getSceneState().editBusy,true);assert.equal(env.ui.getSceneState().model.routes.find(r=>r.routeId===route.routeId).manual,false);
    env.ui.externalSeek(16);env.present(16);assert.equal(env.ui.getSceneState().editBusy,true);
    release();await pending;await env.ui.ready();
    const updated=env.ui.getSceneState().model.routes.find(r=>r.routeId===route.routeId);
    assert.equal(updated.manual,true,'same-phase time navigation must not invalidate a newly saved document model');
    assert.ok(Math.abs(updated.controlPoints[0].x-changedX)<1e-6);assert.equal(env.ui.getSceneState().frame,16);assert.equal(env.ui.getSceneState().editBusy,false);
    env.get('tacticsRoutePlayer').value='P2';env.get('tacticsRoutePlayer').onchange();env.get('tacticsRoutePlayer').value='P1';env.get('tacticsRoutePlayer').onchange();env.selectRoute();
    const second=updated.controlPoints[1];await env.event('pointerdown',{pointerId:8,target:env.handle(1)});
    await env.event('pointermove',{pointerId:8,clientX:second.x*40,clientY:(second.y+.1)*40});await env.event('pointerup',{pointerId:8});
    await env.get('tacticsSave').onclick();assert.ok(Math.abs(env.saved.at(-1).document.presentation.routes[0].controlPoints[0].x-changedX)<1e-6,'editing another point must retain the saved first point');
  }finally{release();if(own)Object.defineProperty(subtle,'digest',own);else delete subtle.digest;env.restore();}
});
