import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {mountTacticsUI,suggestManualDrawingRange,confirmManualCommentaryAnnotation} from './tactics-ui.mjs';
import {createSourceBinding} from '../tactical-overlay/binding.mjs';
import {courtToVideo} from './tactics-presentation.mjs';
import {createTacticsDocument,splitPhase,refreshSnapshot} from './tactics-document.mjs';
import {adoptAgentCandidate} from './tactics-agent.mjs';
import {createAnnotation} from './tactics-annotations.mjs';
import {createManualAnnotation} from './tactics-manual-editor.mjs';
import {updateProductionCamera,productionPhaseSnapshot,DEFAULT_RIBBON,compileProduction} from './tactics-production.mjs';
let environmentId=0;
// The storage module keeps one IDB connection for the mounted application.
// Route that connection to each test's transaction store rather than the first fixture.
let activeDatabase;
const connection={transaction(...args){return activeDatabase.transaction(...args);}};

test('explicit manual confirmation preserves edited geometry and provenance while detaching stale commentary dependency',async()=>{
  let d=await createTacticsDocument((await makePresentationDemo()).review);
  d=createAnnotation(d,{id:'edited',type:'screen',phaseId:'phase-1',frame:12,space:'video',points:[{x:600,y:320}],
    origin:{kind:'human_modified',jobId:'old-draw',sourceFrames:[12],note:'original basis'}});
  d.annotations.items[0].origin.kind='human_modified';
  d.agentRuns=[{jobId:'old-draw',commentaryPlanRef:{planId:'p',revision:1,digest:'old'},pendingAnnotations:[{annotationId:'edited',reason:'stale'}]}];
  const next=confirmManualCommentaryAnnotation(d,'edited');
  assert.deepEqual(next.annotations.items[0].points,d.annotations.items[0].points);assert.equal(next.annotations.items[0].origin,undefined);
  assert.deepEqual(next.agentRuns[0].manualConfirmations[0].previousOrigin,d.annotations.items[0].origin);
  assert.equal(next.agentRuns[0].pendingAnnotations.length,0);assert.ok(d.annotations.items[0].origin,'input stays unchanged');
});

test('default drawing waits for saved commentary and forwards resolved names and the exact plan reference to a separate job',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),calls=[];
  const plan={schemaVersion:2,planId:'plan-a',revision:1,digest:'digest-a',summary:'传球',events:[],
    producerConfigSnapshot:{model:'model-a'},nodes:[{nodeId:'node-a',anchorAssetFrame:12,cueIds:['cue-a']}],
    cues:[{cueId:'cue-a',text:'库里接球',suggestedStartTime:1,suggestedEndTime:2,delivery:'pause'}]};
  const names={nameIdentitySource:{videoSha256:d.review.videoSha256},playerNameIdentities:[{id:'P1',observations:[{frame:12,nameIdentity:{name:'库里',nameStatus:'human_confirmed'}}]}]};
  const env=environment(d,{currentPipeline:true,nameOverlay:names,
    commentary:async(path,payload)=>{calls.push([path,payload]);return path==='/api/commentary/jobs'?{id:'understand-a',status:'completed',action:'understand',plan}:path==='/api/commentary/save'?plan:{status:{model:'model-a',understandingConfigured:true},plan:null,job:null};},
    agent:async(path,payload)=>{calls.push([path,payload]);return path.endsWith('/status')?{available:true,message:'ready'}:{jobId:'drawing-a',status:'failed',error:'fixture stopped'};}});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();
    const understanding=calls.find(([p])=>p==='/api/commentary/jobs'),drawing=calls.find(([p])=>p==='/api/commentary-drawing/jobs');
    assert.ok(understanding,'first create a commentary job');assert.ok(drawing,`then create a separate drawing job: ${env.get('tacticsAgentStatus').textContent}`);
    assert.ok(calls.indexOf(understanding)<calls.indexOf(drawing));
    assert.deepEqual(understanding[1].review.playerNameIdentities,names.playerNameIdentities);
    assert.deepEqual(drawing[1].commentaryPlanRef,{planId:'plan-a',revision:1,digest:'digest-a'});
    assert.deepEqual(drawing[1].review.playerNameIdentities,names.playerNameIdentities);
    assert.equal(drawing[1].drawingModelOverride,null);
    assert.equal(calls.some(([p])=>p==='/api/tactics-agent/jobs'),false);
  }finally{env.restore();}
});

test('failed commentary prevents drawing and retains the existing document',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),calls=[];
  const env=environment(d,{currentPipeline:true,
    commentary:async(path)=>path==='/api/commentary/jobs'?{id:'failed-a',status:'failed',error:'理解失败'}:{status:{},plan:null,job:null},
    agent:async(path)=>{calls.push(path);return {available:true,message:'ready'};}});
  try{await env.load();const before=structuredClone(env.ui.getSceneState().annotations);await env.get('tacticsAgentRun').onclick();
    assert.equal(calls.some(p=>p.endsWith('/jobs')),false);assert.match(env.get('tacticsAgentStatus').textContent,/理解失败/);
    assert.deepEqual(env.ui.getSceneState().annotations,before);
  }finally{env.restore();}
});

test('drawing override stays separate, edited commentary uses the saved revision, and joint render receives graphics and names',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),calls=[];
  let plan={schemaVersion:2,planId:'plan-a',revision:1,digest:'digest-a',summary:'接球',events:[],
    producerConfigSnapshot:{model:'model-a'},nodes:[{nodeId:'node-a',anchorAssetFrame:12,cueIds:['cue-a']}],
    cues:[{cueId:'cue-a',text:'接球进攻',suggestedStartTime:1,suggestedEndTime:2,delivery:'pause'}]};
  const names={nameIdentitySource:{videoSha256:d.review.videoSha256},playerNameIdentities:[]};
  const env=environment(d,{currentPipeline:true,nameOverlay:names,
    commentary:async(path,payload)=>{
      calls.push([path,payload]);
      if(path==='/api/commentary/save'){assert.equal(payload.expectedRevision,1);plan={...payload.plan,revision:2,digest:'digest-b'};return plan;}
      if(path==='/api/commentary/jobs')return {id:'render-a',status:'failed',error:'fixture stopped'};
      return {status:{model:'model-a'},plan,job:null};
    },agent:async(path,payload)=>{calls.push([path,payload]);return path.endsWith('/status')?{available:true,message:'ready'}:{jobId:'drawing-a',status:'failed',error:'fixture stopped'};}});
  try{
    await env.load();env.get('tacticsDrawingModel').value='provider/drawing-only';await env.get('tacticsAgentRun').onclick();
    assert.equal(calls.find(([p])=>p==='/api/commentary-drawing/jobs')[1].drawingModelOverride,'provider/drawing-only');
    const walk=n=>[n,...n.children.flatMap(walk)],all=walk(env.get('tacticsPanel'));
    const text=all.find(n=>n.tag==='textarea'&&n.value==='接球进攻');text.value='接球后传给队友';await text.listeners.input[0]();
    assert.match(env.get('tacticsAgentStatus').textContent,/依据已过期/);
    env.get('tacticsDrawingModel').value='';await env.get('tacticsAgentRun').onclick();
    const latest=calls.filter(([p])=>p==='/api/commentary-drawing/jobs').at(-1)[1];
    assert.deepEqual(latest.commentaryPlanRef,{planId:'plan-a',revision:2,digest:'digest-b'});assert.equal(latest.drawingModelOverride,null);
    const render=all.find(n=>n.tag==='button'&&n.textContent==='配音并生成联合视频');await render.listeners.click[0]();
    const payload=calls.find(([p])=>p==='/api/commentary/jobs')[1];
    assert.equal(payload.action,'render');assert.equal(payload.plan.cues[0].text,'接球后传给队友');
    assert.deepEqual(payload.document.annotations,d.annotations);assert.deepEqual(payload.nameOverlay,names);
  }finally{env.restore();}
});

test('legacy commentary remains editable and uses standalone narration without inventing joint provenance',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),calls=[];
  let plan={summary:'旧稿',cues:[{cueId:'old-cue',text:'原解说',suggestedStartTime:1,suggestedEndTime:2,delivery:'during_play'}]};
  const env=environment(d,{currentPipeline:true,commentary:async(path,payload)=>{
    calls.push([path,payload]);
    if(path==='/api/commentary/save'){assert.equal(payload.expectedRevision,0);plan={...payload.plan,planId:'legacy',revision:1,digest:'saved',producerConfigSnapshot:null};return plan;}
    if(path==='/api/commentary/jobs')return {id:'legacy-render',status:'failed',error:'fixture stopped'};
    return {status:{},plan,job:null};
  }});
  try{
    await env.load();const walk=n=>[n,...n.children.flatMap(walk)],all=walk(env.get('tacticsPanel'));
    const editor=all.find(n=>n.tag==='textarea'&&n.value==='原解说');editor.value='已修改的旧解说';await editor.listeners.input[0]();
    const render=all.find(n=>n.tag==='button'&&n.textContent==='配音并生成字幕视频');assert.ok(render,'legacy render remains explicitly available');
    await render.listeners.click[0]();const payload=calls.find(([p])=>p==='/api/commentary/jobs')[1];
    assert.equal(payload.plan.cues[0].text,'已修改的旧解说');assert.equal(payload.document,undefined);assert.equal(payload.commentaryPlanRef,undefined);
  }finally{env.restore();}
});

test('commentary drawing recovery preserves node scope and validates retry against fresh names',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),storage=new Map(),storageKey='recover-commentary',service=recoverableAgent();
  const plan={planId:'p',revision:3,digest:'digest',producerConfigSnapshot:{model:'m'},nodes:[{nodeId:'n',anchorAssetFrame:12,cueIds:['c']}],summary:'传球',cues:[{cueId:'c',text:'传球',suggestedStartTime:1,suggestedEndTime:2,delivery:'pause'}]};
  const names={playerNameIdentities:[{id:'P1',observations:[]}],nameDisplay:{enabled:true}};
  const options={currentPipeline:true,agent:service.request,storage,storageKey,nameOverlay:names,commentary:async()=>({status:{},plan,job:null})};
  let env=environment(d,options);
  try{
    await env.load();env.get('tacticsDrawingModel').value='vendor/drawing';await env.get('tacticsAgentRun').onclick();await env.ui.saveDraft();
    const original=service.submits[0],saved=env.saved.at(-1);env.restore();
    names.nameDisplay.enabled=false;
    env=environment(saved.document,{...options,serverVersion:saved.expectedVersion+1});await env.load();
    assert.equal(env.get('tacticsAgentBackend').value,'commentary');assert.equal(env.get('tacticsDrawingModel').value,'vendor/drawing');
    await env.get('tacticsAgentRetry').onclick();const retry=service.retries[0];assert.ok(retry,env.get('tacticsAgentStatus').textContent);
    assert.deepEqual(retry.nodeIds,original.nodeIds);assert.deepEqual(retry.commentaryPlanRef,original.commentaryPlanRef);
    assert.equal(retry.drawingModelOverride,'vendor/drawing');assert.equal(retry.review.nameDisplay.enabled,false);
    assert.equal(retry.documentDigest,original.documentDigest);assert.equal(retry.clientRevision,original.clientRevision);
    assert.ok(env.requests.some(p=>p.startsWith('/api/commentary-drawing/jobs/reload-job/retry')));
  }finally{env.restore();}
});

test('a legacy-only range never starts paid commentary in the default drawing flow',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),calls=[];
  const env=environment(d,{currentPipeline:true,commentary:async(path)=>{calls.push(path);return {status:{},plan:null,job:null};}});
  try{await env.load();env.get('tacticsAgentScope').value='range';await env.get('tacticsAgentRun').onclick();
    assert.equal(calls.includes('/api/commentary/jobs'),false);assert.match(env.get('tacticsAgentStatus').textContent,/旧版兼容入口/);
  }finally{env.restore();}
});

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
    assert.equal(calls.length,1);assert.equal(calls[0].body.expectedVersion,1);
    assert.equal(env.get('tacticsRenderVideo').getAttribute('src'),env.get('deliveryRenderVideo').getAttribute('src'));
    assert.equal(env.get('deliveryRenderDownload').href,env.get('tacticsRenderVideo').getAttribute('src'));
    await env.get('tacticsToolScreen').onclick();await env.event('pointerdown',{pointerId:1,target:env.target(),clientX:650,clientY:300});
    assert.match(env.get('tacticsRenderStatus').textContent,/草稿已修改/);assert.match(env.get('deliveryRenderDownload').textContent,/旧快照/);
    await env.get('deliveryRenderStart').onclick();assert.equal(calls.length,2);assert.equal(calls[1].body.document.annotations.items.length,1);
    assert.match(env.get('tacticsRenderMetadata').textContent,/静音/);
  }finally{env.restore();}
});
test('a slow Agent recovery keeps generation locked throughout draft reload without cancelling the task',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review);let jobs=0,cancels=0,releaseRecovery,recoveryStarted;
  const started=new Promise(resolve=>recoveryStarted=resolve),recovered=new Promise(resolve=>releaseRecovery=resolve);
  const env=environment(d,{agent:async(path)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/cancel')){cancels++;return {jobId:'job-1',status:'cancelled'};}
    if(path.endsWith('/jobs')){jobs++;return {jobId:`job-${jobs}`,status:'queued',message:'queued'};}
    recoveryStarted();await recovered;return {jobId:'job-1',status:'queued',message:'queued'};
  }});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();
    const reload=env.get('tacticsWorkspace').onclick();await started;
    assert.equal(env.get('tacticsAgentRun').disabled,true,'reload must lock before waiting for the original task');
    await env.get('tacticsAgentRun').onclick();assert.equal(jobs,1);
    releaseRecovery();await reload;
    assert.equal(env.get('tacticsAgentRun').disabled,true);assert.equal(env.get('tacticsAgentCancel').hidden,false);assert.equal(cancels,0);
  }finally{releaseRecovery();env.restore();}
});

test('a stale Agent adoption response cannot unlock or relabel a newer queued job',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review);let jobs=0,releaseAdopt,adoptStarted,firstJob;
  const started=new Promise(resolve=>adoptStarted=resolve),response=new Promise(resolve=>releaseAdopt=resolve);
  const output={summary:'路线建议',issues:[],phases:[{title:'切入',startFrame:0,endFrameExclusive:61,freezeFrame:0,reason:'跑位',evidenceFrames:[0,20],actions:[],annotations:[{type:'route',entityId:'P1',space:'video',anchorFrame:0,startFrame:0,endFrameExclusive:30,points:[{x:600,y:400},{x:700,y:300}],angle:0,size:1,color:'#26baff',explanation:'切入',evidenceFrames:[0,20]}]}]};
  const env=environment(d,{agent:async(path,payload)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/cancel'))return {jobId:`job-${jobs}`,status:'cancelled'};
    if(path.endsWith('/adopt')){adoptStarted();return response;}
    if(path.endsWith('/jobs')){
      jobs++;if(jobs>1)return {jobId:`job-${jobs}`,status:'queued',message:'new job queued'};
      firstJob={jobId:'job-1',status:'ready',message:'ready',candidate:output,previewFrames:[],previewDocument:await adoptAgentCandidate(payload.document,output,{jobId:'job-1',scope:payload.scope,phaseId:payload.phaseId})};return firstJob;
    }
    if(path.includes('/jobs/job-1?'))return firstJob;
    return {jobId:`job-${jobs}`,status:'queued',message:'new job queued'};
  }});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();const adoption=env.get('tacticsAgentAdopt').onclick();await started;
    await env.get('tacticsWorkspace').onclick();await env.get('tacticsAgentRun').onclick();
    releaseAdopt({document:d});await adoption;
    assert.equal(env.get('tacticsAgentRun').disabled,true);assert.equal(env.get('tacticsAgentCancel').hidden,false);
    assert.equal(env.get('tacticsAgentStatus').textContent,'new job queued');assert.equal(env.ui.getSceneState().annotations.items.length,0);
  }finally{releaseAdopt({document:d});env.restore();}
});

test('reloading a draft restores the running Agent task and only explicit cancellation unlocks fresh generation',async()=>{
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
    assert.equal(env.get('tacticsAgentRun').disabled,true);assert.equal(env.get('tacticsAgentCancel').hidden,false);
    assert.equal(cancels,0);await env.get('tacticsAgentRun').onclick();assert.equal(jobs,1);
    await env.get('tacticsAgentCancel').onclick();assert.equal(cancels,1);assert.equal(env.get('tacticsAgentRun').disabled,false);
    await env.get('tacticsAgentRun').onclick();assert.equal(jobs,2);
  }finally{env.restore();}
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

test('modern V4 adoption checks the first new cue at frame 161, preserves manual circles and keeps continuous playback explicit',async()=>{
  const {review}=await makePresentationDemo();review.entities=[];review.court.calibration.keyframes=[];
  review.sourceFrameMapping=Array.from({length:211},(_,frame)=>({frame,time:frame/30,sourceFrame:frame,sourceTime:frame/30}));review.mediaEndTime=211/30;
  let d=await createTacticsDocument(review);for(const [index,x] of [400,650].entries())d=createManualAnnotation(d,{id:`retained-circle-${index}`,type:'spotlight',phaseId:'phase-1',range:{startFrame:0,endFrameExclusive:90},frame:0,space:'video',points:[{x,y:400}],name:`人工定位圈 ${index+1}`});
  const manual=structuredClone(d.annotations.items),candidate={schemaVersion:4,production:null,summary:'逐点检查两个动作',issues:[],phases:[{title:'参考帧标注',startFrame:0,endFrameExclusive:211,freezeFrame:0,reason:'仅根据可见参考帧说明',evidenceFrames:[161,190],actions:[],annotations:[161,190].map((frame,index)=>({type:'screen',entityId:null,space:'video',anchorFrame:frame,startFrame:frame,endFrameExclusive:frame+1,points:[{x:500+index*100,y:350}],angle:0,size:1,color:'#ffd34e',explanation:'可见位置的挡拆标记',evidenceFrames:[frame],authoredPath:null})),participants:[{subjectId:'visible-screener',entityId:null,label:'画面中的掩护者',role:'screener',disposition:'annotated',annotationIndexes:[0,1],evidenceFrames:[161,190],reason:''}]}]};
  let preview,job;const env=environment(d,{player:true,agent:async(path,payload)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/adopt'))return {document:preview};
    if(path.endsWith('/jobs')){preview=await adoptAgentCandidate(payload.document,candidate,{jobId:'modern-cues',scope:payload.scope,phaseId:payload.phaseId});job={jobId:'modern-cues',status:'ready',candidate,previewDocument:preview};}
    return job;
  }});
  try{
    await env.load();assert.equal(env.get('tacticsContinue').textContent,'原片播放');assert.equal(env.get('tacticsSourcePlay').hidden,true);
    await env.get('tacticsContinue').onclick();env.present(165);assert.equal(env.ui.getPlaybackState().status,'playing','a draft without cues must not gain an extra stop');assert.equal(env.ui.getSceneState().frame,165);
    env.get('tacticsPause').onclick();env.get('tacticsSeek').value='0';env.get('tacticsSeek').oninput();await env.ui.ready();await Promise.resolve();
    await env.get('tacticsAgentRun').onclick();await env.get('tacticsAgentAdopt').onclick();await env.ui.ready();await Promise.resolve();
    assert.deepEqual(env.ui.getSceneState().annotations.items.slice(0,2),manual);assert.match(env.get('tacticsAgentStatus').textContent,/2 个图形.*2 个.*暂停点/);
    assert.equal(env.get('tacticsContinue').textContent,'逐点检查');assert.equal(env.get('tacticsSourcePlay').hidden,false);assert.equal(env.ui.getSceneState().frame,0);
    assert.deepEqual(env.get('tacticsCueList').children.map(button=>button.textContent),['5.37 秒 · 1 个图形','6.33 秒 · 1 个图形']);
    const writes=env.writes.length;await env.get('tacticsContinue').onclick();env.holdSeek();env.present(165);
    assert.equal(env.ui.getPlaybackState().targetFrame,161);assert.equal(env.ui.getPlaybackState().status,'seeking');assert.equal(env.get('tacticsToolScreen').disabled,true);
    env.finishSeek();assert.equal(env.ui.getSceneState().frame,161);assert.equal(env.ui.getPlaybackState().status,'paused');assert.equal(env.get('tacticsContinue').textContent,'继续播放');
    const agentGraphics=env.ui.getSceneState().annotations.items.filter(a=>a.origin?.jobId==='modern-cues');assert.equal(agentGraphics.length,2);
    assert.ok(env.get('tacticsCanvas').children[0].children[1].innerHTML.includes(agentGraphics[0].id));
    const second=env.get('tacticsObjectList').children.find(button=>button.getAttribute('data-object-id')===agentGraphics[1].id);assert.match(second.textContent,/6\.33 秒/);
    second.onclick();await env.ui.ready();await Promise.resolve();assert.equal(env.ui.getSceneState().frame,190);assert.equal(env.ui.getSceneState().selectedAnnotationId,agentGraphics[1].id);assert.equal(env.writes.length,writes);
    await env.get('tacticsReplay').onclick();await env.ui.ready();await Promise.resolve();env.present(165);await Promise.resolve();assert.equal(env.ui.getSceneState().frame,161);assert.equal(env.ui.getPlaybackState().status,'paused');
    await env.get('tacticsSourcePlay').onclick();env.present(195);assert.equal(env.ui.getPlaybackState().status,'playing');assert.equal(env.ui.getSceneState().frame,195);env.get('tacticsPause').onclick();
    await env.get('tacticsSave').onclick();assert.deepEqual(env.saved.at(-1).document.annotations.items.slice(0,2),manual);assert.deepEqual(env.saved.at(-1).document.review,d.review);
  }finally{env.restore();}
});

for(const variant of ['server report','legacy without images','empty report']){
  test(`Agent preview uses actual marker frames and exposes unavailable previews: ${variant}`,async()=>{
    const {review}=await makePresentationDemo();review.court.calibration.keyframes=[];const d=await createTacticsDocument(review);
    const annotations=variant==='empty report'?[]:[12,24].map(frame=>({type:'screen',entityId:null,space:'video',anchorFrame:frame,startFrame:frame,endFrameExclusive:frame+1,points:[{x:600,y:320}],angle:0,size:1,color:'#ffd45c',explanation:'参考画面',evidenceFrames:[frame]}));
    const output={summary:'逐帧标记预览',issues:['需要核对球员位置','身份尚待确认'],phases:[{title:'当前阶段',startFrame:0,endFrameExclusive:61,freezeFrame:0,reason:'参考帧不同于阶段暂停帧',evidenceFrames:[0,12,24],actions:[],annotations}]};
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
      const issues=tree.find(node=>node.className==='tactics-agent-issues'),card=tree.find(node=>node.className==='tactics-agent-card');
      assert.equal(issues.open,false);assert.match(words(issues),/待核对说明 · 2 条.*需要核对球员位置.*身份尚待确认/);assert.equal(card.tag,'details');assert.equal(card.open,false);
      const points=tree.filter(node=>node.attrs['data-preview-frame']!==undefined),images=tree.filter(node=>node.tag==='img');
      assert.deepEqual(points.map(node=>Number(node.attrs['data-preview-frame'])),variant==='empty report'?[0]:[0,12,24]);
      if(variant==='server report'){
        assert.equal(images.length,2);assert.match(images[0].alt,/13/);assert.match(images[1].alt,/25/);
        assert.deepEqual(images.map(image=>[image.width,image.height]),[[1280,720],[1280,720]],'lazy previews reserve their source aspect ratio before decoding');
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
    assert.equal(env.get('tacticsCueList').children.length,0);assert.match(env.get('tacticsCueStatus').textContent,/没有标记讲解暂停点/);
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

function environment(source,{player=false,empty=false,agent=null,renderJob=null,loadDocument=null,storage=null,storageKey=null,serverVersion=0,commentary=null,currentPipeline=false,nameOverlay=null}={}){
  const nodes=new Map(),events={},writes=[],metadataWrites=[],saved=[],requests=[],store=storage??new Map();let hold=false,releases=[],frameRequests=0,resizeCallback;
  function make(tag='div'){
    const queries=new Map();
    const node={tag,children:[],attrs:{},listeners:{},style:{},dataset:{},value:'',checked:false,clientWidth:800,hidden:false,textContent:'',
      append(...children){for(const child of children){if(child&&typeof child==='object'){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(n=>n!==child);child.parentElement=this;}this.children.push(child);}},
      prepend(...children){this.append(...children);this.children=[...children,...this.children.filter(n=>!children.includes(n))];},
      after(...children){const parent=this.parentElement;if(!parent)return;for(const child of children){if(child?.parentElement)child.parentElement.children=child.parentElement.children.filter(n=>n!==child);if(child&&typeof child==='object')child.parentElement=parent;}parent.children.splice(parent.children.indexOf(this)+1,0,...children);},
      classList:{add(...names){node.className=[...new Set([...(node.className??'').split(/\s+/).filter(Boolean),...names])].join(' ');},contains(name){return (node.className??'').split(/\s+/).includes(name);}},
      replaceChildren(...children){this.children=[];this.append(...children);if(tag==='select')this.value=children[0]?.value||'';},focus(){document.activeElement=this;},
      setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]??null;},removeAttribute(k){delete this.attrs[k];},remove(){this.removed=true;},
      querySelector(selector){
        if(selector==='svg')return this.children.find(n=>n.tag==='svg')||null;
        if(selector==='[data-edit-handles]')return this.children.find(n=>!n.removed&&n.attrs?.['data-edit-handles'])||null;
        if(/^\[data-[\w-]+\]$/.test(selector)||selector.startsWith('.')&&this.html?.includes(selector.slice(1))){
          if(!queries.has(selector)){const child=make(selector.includes('scope')?'select':'div');queries.set(selector,child);this.append(child);}return queries.get(selector);
        }
        return null;
      },
      addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);},setPointerCapture(id){this.pointer=id;},hasPointerCapture(id){return this.pointer===id;},releasePointerCapture(){this.pointer=null;},click(){},
      drawCalls:[],getContext:()=>({drawImage(...args){node.drawCalls.push(args);},clearRect(){}}),getScreenCTM:()=>({inverse:()=>({})}),createSVGPoint:()=>({matrixTransform(){return {x:this.x,y:this.y};}})};
    Object.defineProperty(node,'innerHTML',{get(){return this.html||'';},set(value){this.html=value;this.children=value.startsWith('<svg')?[make('svg')]:[];}});
    if(['input','textarea','select'].includes(tag)){let value='';Object.defineProperty(node,'value',{get(){return value;},set(next){value=String(next);}});}
    if(tag==='video')Object.assign(node,{paused:true,pause(){this.paused=true;},load(){}});
    return node;
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
  const originals=new Map(['document','window','location','Image','ResizeObserver','indexedDB','localStorage','fetch'].map(k=>[k,globalThis[k]]));
  const database={transaction(_store,mode){const tx={objectStore:()=>({
    get(key){const r={};queueMicrotask(()=>{r.result=store.get(key);r.onsuccess();});return r;},
    put(value,key){const finish=()=>{store.set(key,structuredClone(value));(value.document?writes:metadataWrites).push(structuredClone(value));tx.oncomplete();};if(hold)releases.push(finish);else queueMicrotask(finish);}
  })};return tx;}};
  activeDatabase=database;Object.assign(globalThis,{
    document:{body:{dataset:{area:'tactics'}},getElementById:get,createElement:make,createElementNS:(_ns,tag)=>make(tag),addEventListener:(name,fn)=>events[name]=fn},
    window:{history:{replaceState(){}}},location:{search:'?sample=test&qa=1'},Image:class{async decode(){}},ResizeObserver:class{constructor(callback){resizeCallback=callback;}observe(){}},
    localStorage:{getItem:()=>null},indexedDB:{open(){const r={};queueMicrotask(()=>{r.result=connection;r.onsuccess();});return r;}},
    fetch:async(path,options)=>{
      requests.push(path);
      let value;if(path.startsWith('/api/tactics?'))value={version:serverVersion,document:empty?null:loadDocument?await loadDocument():source};
      else if(path.startsWith('/api/commentary?')||path.startsWith('/api/commentary/'))value=commentary?await commentary(path,options?JSON.parse(options.body):null):{status:{model:'fixture-commentary',understandingConfigured:false,ttsConfigured:false},plan:null,job:null};
      else if(path==='/api/tactics/frame'){frameRequests++;value={frames:JSON.parse(options.body).frames.map(frame=>({...source.review.sourceFrameMapping[frame],videoSha256:source.review.videoSha256,dataUrl:'data:image/jpeg;base64,/9j/'}))};}
      else if(path==='/api/tactics/save'){const payload=JSON.parse(options.body);saved.push(payload);value={version:payload.expectedVersion+1};}
      else if((path.startsWith('/api/tactics-agent/')||path.startsWith('/api/commentary-drawing/'))&&agent)value=await agent(path,options?JSON.parse(options.body):null);
      else if(path.startsWith('/api/tactics-render/')&&renderJob)value=await renderJob(path,options?JSON.parse(options.body):null);
      else throw new Error(path);return {ok:true,json:async()=>value};
    }
  });
  let point=null,paused=true,seekSerial=0,seekHeld=false,pendingSeeks=[];const playerCalls=[],background={kind:'decoded-canvas'};
  const present=(frame)=>{seekSerial++;point={frame,time:source.review.sourceFrameMapping[frame].time,source:background,paused};ui.onPresentedFrame?.(point);};
  const bridge=player?{seek(frame){const serial=++seekSerial;playerCalls.push(['seek',frame]);paused=true;const done=()=>{if(serial===seekSerial)present(frame);};if(seekHeld)pendingSeeks.push(done);else queueMicrotask(done);},play(){paused=false;playerCalls.push(['play']);},getPresentedFrame:()=>point}:{};
  const ui=mountTacticsUI({key:storageKey??`player-review:ui-fixture-${++environmentId}:qa`,sample:'test',variant:'test',qa:true,title:'fixture',clip:{video_sha256:source.review.videoSha256},pause(){paused=true;playerCalls.push(['pause']);},snapshot:()=>source.review,nameOverlaySnapshot:()=>nameOverlay,frame:()=>point?.frame??12,openStep(){},...bridge});
  if(!currentPipeline)get('tacticsAgentBackend').value='legacy';
  return {get,ui,writes,metadataWrites,saved,requests,store,playerCalls,present,background,get frameRequests(){return frameRequests;},get pendingWrites(){return releases.length;},
    holdSeek(){seekHeld=true;},finishSeek(){seekHeld=false;for(const done of pendingSeeks.splice(0))done();},
    async load(){await events['workbench-area']();await ui.ready();},resize(){resizeCallback();},
    async exit(){await events['workbench-area']();},
    async event(name,event){for(const fn of get('tacticsCanvas').listeners[name]||[])await fn({button:0,preventDefault(){},...event});},
    selectPlayer(id){get('tacticsRoutePlayer').value=id;get('tacticsRoutePlayer').onchange();},
    selectRoute(){get('tacticsRoutePlayer').value='P1';get('tacticsRoutePlayer').onchange();get('tacticsShowReference').checked=true;get('tacticsShowReference').onchange?.();const route=ui.getSceneState().model.routes.find(r=>r.entityId==='P1');get('tacticsRoute').value=route.routeId;get('tacticsRoute').onchange();return route;},
    target(attrs={}){return {closest:selector=>{const key=selector.slice(1,-1);return Object.hasOwn(attrs,key)?{getAttribute:k=>attrs[k]??null}:null;}};},
    async key(key,extra={}){await events.keydown?.({key,target:{tagName:'DIV'},preventDefault(){},...extra});},
    handle(index){return {closest:selector=>selector==='[data-control-index]'?{getAttribute:()=>String(index)}:null};},
    hold(){hold=true;},release(){hold=false;for(const release of releases.splice(0))release();},
    restore(){ui.dispose();for(const [k,v] of originals){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
  };
}

test('the tactics workspace mounts commentary after its heading and loads an isolated empty commentary draft',async()=>{
  const env=environment(await createTacticsDocument((await makePresentationDemo()).review));
  try{
    await env.load();
    const panel=env.get('tacticsPanel'),heading=panel.querySelector('.tactics-heading'),commentary=panel.children[panel.children.indexOf(heading)+1];
    assert.equal(commentary.tag,'section');assert.equal(commentary.parentElement,panel);assert.equal(commentary.classList.contains('commentary-ui'),true);
    assert.deepEqual(env.requests.filter(path=>path.startsWith('/api/commentary?')),['/api/commentary?sample=test&variant=test&qa=1']);
    const descendants=node=>[node,...node.children.flatMap(descendants)];
    assert.ok(descendants(commentary).some(node=>node.textContent.includes('fixture-commentary')));
    assert.ok(descendants(commentary).some(node=>node.textContent==='配音并生成联合视频'&&node.disabled));
    const videos=descendants(commentary).filter(node=>node.tag==='video');assert.equal(videos.length,2);
    for(const video of videos)video.paused=false;
    env.ui.dispose();assert.ok(videos.every(video=>video.paused));
  }finally{env.restore();}
});

test('video preview redraws at full canvas width on resize, leaving source coordinates intact and court height capped',async()=>{
  const {review}=await makePresentationDemo();review.mediaEndTime=6.1;
  const d=await createTacticsDocument(review),original=structuredClone(d),env=environment(d,{player:true});
  try{
    window.innerHeight=720;env.get('tacticsCanvas').clientWidth=876;await env.load();
    const scene=env.get('tacticsCanvas').children[0],ratio=d.review.height/d.review.width;
    assert.equal(scene.style.width,'874px');assert.equal(scene.style.height,`${874*ratio}px`);
    const before=structuredClone(env.ui.getSceneState().model),writeCount=env.writes.length,saveCount=env.saved.length;
    env.get('tacticsCanvas').clientWidth=1200;env.resize();
    assert.equal(scene.style.width,'1198px');assert.equal(scene.style.height,`${1198*ratio}px`);
    assert.deepEqual(env.ui.getSceneState().model,before,'display resize must not change annotation coordinates or projection input');
    env.get('tacticsCourtView').onclick();assert.equal(scene.style.height,'222px');
    env.get('tacticsVideoView').onclick();assert.equal(scene.style.width,'1198px');
    assert.deepEqual(d,original);assert.equal(env.writes.length,writeCount);assert.equal(env.saved.length,saveCount);
  }finally{env.restore();}
});

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
    assert.equal(env.ui.getSceneState().annotations.items.length,0);assert.match(env.get('tacticsStatus').textContent,/可在点击处放人工圈/);assert.equal(env.get('tacticsSpotlightFallback').hidden,false);
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
  let pending;
  try{
    await env.load();assert.match(env.get('tacticsRouteHint').textContent,/先选择/);
    const state=env.ui.getSceneState(),canvas=state.background,route=env.selectRoute(),point=route.controlPoints[0];
    const host=env.get('tacticsCanvas'),overlay=host.children[0].children[1];
    assert.doesNotMatch(overlay.innerHTML,/<text\b|<foreignObject\b/);
    await env.event('pointerdown',{pointerId:1,target:env.handle(0)});
    await env.event('pointermove',{pointerId:1,clientX:(point.x+.2)*40,clientY:point.y*40});
    assert.equal(env.writes.at(-1).document.presentation,undefined);
    env.hold();pending=env.event('pointerup',{pointerId:1});await Promise.resolve();await Promise.resolve();
    assert.equal(env.ui.getSceneState().editBusy,true);
    await env.event('pointerdown',{pointerId:2,target:env.handle(0)});await env.event('pointermove',{pointerId:2,clientX:40,clientY:80});await env.event('pointerup',{pointerId:2});
    const deadline=Date.now()+3000;while(!env.pendingWrites&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,2));
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
  }finally{env.release();await pending?.catch(()=>{});env.restore();}
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

for(const [tool,pattern,name,color] of [['tacticsToolDashed','dashed','传球','#19a9e1'],['tacticsToolDots','dots','圆点传球','#ffd45c']]){
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
    assert.equal(env.get('tacticsAnnotationColor').disabled,false);
    assert.equal(env.get('tacticsContinue').disabled,false,'finishing a manual edit must restore the visible preview button');
    const overlay=env.get('tacticsCanvas').children[0].children[1];assert.match(overlay.innerHTML,/data-annotation-id/);
    env.get('tacticsAnnotationAngle').value='45';await env.get('tacticsAnnotationAngle').onchange();
    assert.equal(env.writes.at(-1).document.annotations.items[0].style.angle,45);
    await env.get('tacticsToolSpotlight').onclick();env.selectPlayer('P1');await env.event('pointerdown',{pointerId:42,target:env.target(),clientX:720,clientY:410});
    items=env.writes.at(-1).document.annotations.items;assert.equal(items[1].type,'spotlight');assert.equal(items[1].followEntity,true);
    assert.equal(items[1].style.color,'#ffffff');
    assert.equal(env.get('tacticsAnnotationColor').value,'#ffffff');assert.equal(env.get('tacticsAnnotationColor').disabled,true);
    assert.match(overlay.innerHTML,/data-part="spotlight-soft-light"/);assert.match(overlay.innerHTML,/data-part="spotlight-halo"/);
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

test('manual drawing restores Agent controls after saving without unlocking an active generation',async()=>{
  const {review}=await makePresentationDemo();review.entities=[];review.court.calibration.keyframes=[];review.mediaEndTime=6.1;
  const d=await createTacticsDocument(review);let jobs=0;
  const env=environment(d,{player:true,agent:async(path)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/jobs'))jobs++;
    return {jobId:'manual-followup',status:'queued',message:'queued'};
  }});
  try{
    await env.load();assert.equal(env.get('tacticsAgentRun').disabled,false);assert.equal(env.get('tacticsAgentManual').disabled,false);
    const choosing=env.get('tacticsToolRoute').onclick();
    try{assert.equal(env.ui.getSceneState().editBusy,true);assert.equal(env.get('tacticsAgentRun').disabled,true);assert.equal(env.get('tacticsAgentManual').disabled,true);}
    finally{await choosing;}
    assert.equal(env.ui.getSceneState().editBusy,false);assert.equal(env.get('tacticsAgentRun').disabled,false);assert.equal(env.get('tacticsAgentManual').disabled,false);
    for(const [x,y] of [[400,320],[600,400]])await env.event('pointerdown',{pointerId:149,target:env.target(),clientX:x,clientY:y});
    await env.get('tacticsFinishDrawing').onclick();await env.get('tacticsSave').onclick();env.get('tacticsAgentPanel').open=true;
    assert.equal(env.saved.at(-1).document.annotations.items.length,1);assert.equal(env.get('tacticsAgentRun').disabled,false);assert.equal(env.get('tacticsAgentManual').disabled,false);
    await env.get('tacticsAgentRun').onclick();assert.equal(jobs,1);assert.equal(env.get('tacticsAgentRun').disabled,true);
    env.get('tacticsAnnotationName').value='人工补充路线';const editing=env.get('tacticsAnnotationName').onchange();
    try{assert.equal(env.ui.getSceneState().editBusy,true);assert.equal(env.get('tacticsAgentManual').disabled,true);}
    finally{await editing;}
    assert.equal(env.ui.getSceneState().annotations.items[0].name,'人工补充路线');assert.equal(env.ui.getSceneState().editBusy,false);
    assert.equal(env.get('tacticsAgentRun').disabled,true,'finishing a manual edit must keep an active Agent generation locked');assert.equal(env.get('tacticsAgentManual').disabled,false);
    await env.get('tacticsAgentRun').onclick();assert.equal(jobs,1);
  }finally{env.restore();}
});

test('a first spotlight click in a modern empty video offers a visible manual fallback, editable save and undo',async()=>{
  const {review}=await makePresentationDemo();review.entities=[];review.court.calibration.keyframes=[];review.mediaEndTime=6.1;
  const d=await createTacticsDocument(review),env=environment(d,{player:true});
  try{
    await env.load();const evidence=structuredClone(d.review);
    await env.get('tacticsToolSpotlight').onclick();
    assert.equal(env.get('tacticsToolSpotlight').getAttribute('aria-pressed'),'true');
    assert.equal(env.get('tacticsSpotlightMode').hidden,false);assert.match(env.get('tacticsDrawingRangeText').textContent,/0\.00—3\.00 秒/);
    assert.deepEqual(env.writes.at(-1).document.newDrawingRange,{startFrame:0,endFrameExclusive:30});
    await env.event('pointerdown',{target:env.target(),clientX:450,clientY:410});
    assert.equal(env.ui.getSceneState().annotations.items.length,0);assert.equal(env.get('tacticsSpotlightFallback').hidden,false);
    await env.get('tacticsPlaceManualSpotlight').onclick();
    let circle=env.ui.getSceneState().annotations.items[0];assert.equal(circle.entityId,null);assert.equal(circle.followEntity,false);assert.equal(circle.space,'video');assert.equal(circle.videoMode,'fixed');assert.match(circle.name,/人工定位/);assert.deepEqual(circle.points,[{x:450,y:410}]);
    assert.match(env.get('tacticsCanvas').children[0].children[1].innerHTML,/data-part="spotlight-soft-light"/);
    assert.equal(circle.style.color,'#ffffff');
    assert.equal(env.get('tacticsSpotlightFallback').hidden,true);assert.match(env.get('tacticsFootStatus').textContent,/不代表自动追踪/);
    await env.event('pointerdown',{pointerId:145,target:env.target({'data-annotation-id':circle.id,'data-annotation-control-index':'0'}),clientX:450,clientY:410});
    await env.event('pointermove',{pointerId:145,clientX:480,clientY:425});await env.event('pointerup',{pointerId:145});
    assert.deepEqual(env.ui.getSceneState().annotations.items[0].points,[{x:480,y:425}]);
    await env.get('tacticsUndo').onclick();assert.deepEqual(env.ui.getSceneState().annotations.items[0].points,[{x:450,y:410}]);
    await env.get('tacticsRedo').onclick();await env.get('tacticsSave').onclick();
    assert.deepEqual(env.saved.at(-1).document.review,evidence);assert.deepEqual(env.saved.at(-1).document.annotations.items[0].points,[{x:480,y:425}]);
    await env.get('tacticsWorkspace').onclick();await env.ui.ready();assert.deepEqual(env.ui.getSceneState().annotations.items[0],env.saved.at(-1).document.annotations.items[0]);
    await env.get('tacticsToolSpotlight').onclick();await env.get('tacticsSpotlightManual').onclick();
    assert.equal(env.get('tacticsSpotlightManual').getAttribute('aria-pressed'),'true');assert.equal(env.get('tacticsSpotlightAuto').getAttribute('aria-pressed'),'false');
    await env.event('pointerdown',{target:env.target(),clientX:700,clientY:350});assert.equal(env.ui.getSceneState().annotations.items.length,2);
    assert.equal((env.get('tacticsCanvas').children[0].children[1].innerHTML.match(/data-part="spotlight-soft-light"/g)??[]).length,2);
  }finally{env.restore();}
});

test('manual range suggestions follow source timestamps and stop at a cut, phase edge or last frame',()=>{
  const d={review:{sourceFrameMapping:[0,.04,.14,1.8,3.2,4.9].map((time,frame)=>({frame,time})),mediaEndTime:5,settings:{cuts:[4]}},playDefinition:{phases:[{phaseId:'a',startFrame:0,endFrameExclusive:6}]}};
  const before=structuredClone(d);
  assert.deepEqual(suggestManualDrawingRange(d,2,'a'),{startFrame:2,endFrameExclusive:4});
  assert.deepEqual(suggestManualDrawingRange(d,5,'a'),{startFrame:5,endFrameExclusive:6});
  assert.throws(()=>suggestManualDrawingRange(d,6,'a'),/当前阶段/);assert.deepEqual(d,before);
});

test('an explicit drawing interval outside the current picture is kept and offers a current-frame reset',async()=>{
  const {review}=await makePresentationDemo();review.entities=[];review.court.calibration.keyframes=[];review.mediaEndTime=6.1;
  const d=await createTacticsDocument(review);d.newDrawingRange={startFrame:20,endFrameExclusive:30};const env=environment(d,{player:true});
  try{
    await env.load();await env.get('tacticsToolSpotlight').onclick();await env.get('tacticsSpotlightManual').onclick();
    await env.event('pointerdown',{target:env.target(),clientX:450,clientY:410});
    assert.equal(env.ui.getSceneState().annotations.items.length,0);assert.deepEqual(env.writes.at(-1).document.newDrawingRange,d.newDrawingRange);
    assert.match(env.get('tacticsStatus').textContent,/当前画面不在新标注区间/);
    await env.get('tacticsDrawingRangeHere').onclick();await env.event('pointerdown',{target:env.target(),clientX:450,clientY:410});
    assert.equal(env.ui.getSceneState().annotations.items.length,1);assert.equal(env.ui.getSceneState().annotations.items[0].startFrame,0);
  }finally{env.restore();}
});

test('missing observed feet never erase an existing circle or turn its manual placement into tracking truth',async()=>{
  const d=await identityFixture();d.review.entities[0].trajectory[12].source='interpolated';d.playDefinition.sourceBinding=await createSourceBinding(d.review);
  const env=environment(d,{player:true});
  try{
    await env.load();await env.get('tacticsToolSpotlight').onclick();env.selectPlayer('P1');
    await env.event('pointerdown',{target:env.target(),clientX:35,clientY:40});
    assert.equal(env.ui.getSceneState().annotations.items.length,0);assert.match(env.get('tacticsSpotlightFallbackReason').textContent,/估计|可靠/);
    await env.get('tacticsPlaceManualSpotlight').onclick();const circle=structuredClone(env.ui.getSceneState().annotations.items[0]);
    env.get('tacticsAnnotationPlayer').value='P1';await env.get('tacticsAnnotationPlayer').onchange();
    assert.deepEqual(env.ui.getSceneState().annotations.items[0],circle);assert.match(env.get('tacticsStatus').textContent,/原圈已保留/);
    await env.get('tacticsSave').onclick();assert.deepEqual(env.saved.at(-1).document.review,d.review);
  }finally{env.restore();}
});

const uiWords=node=>typeof node==='string'?node:[node.textContent??'',...(node.children??[]).map(uiWords)].join(' ');
const partialCandidate=()=>({schemaVersion:4,production:null,summary:'有证据的阶段',issues:[],phases:[{title:'阶段一',startFrame:0,endFrameExclusive:30,freezeFrame:0,reason:'可见参与者',actions:[],annotations:[],participants:[{subjectId:'visible-1',entityId:null,label:'左侧接应者',role:'receiver',disposition:'uncertain',annotationIndexes:[],evidenceFrames:[0],reason:'脚点被遮挡，待人工定位'}]}]});

function recoverableAgent({loseFirstAdoption=false}={}){
  const state={submits:[],adopts:[],retries:[],reads:[],job:null};
  state.request=async(path,payload)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/jobs')){
      state.submits.push(structuredClone(payload));
      const candidate={summary:'可恢复的路线建议',issues:[],phases:[{title:'切入',startFrame:0,endFrameExclusive:61,freezeFrame:0,reason:'跑位',evidenceFrames:[0,20],actions:[],annotations:[{type:'route',entityId:'P1',space:'video',anchorFrame:0,startFrame:0,endFrameExclusive:30,points:[{x:600,y:400},{x:700,y:300}],angle:0,size:1,color:'#26baff',explanation:'切入',evidenceFrames:[0,20]}]}]};
      state.job={jobId:'reload-job',status:'ready',canRetry:true,base:{expectedVersion:payload.expectedVersion,clientRevision:payload.clientRevision,documentDigest:payload.documentDigest},candidate,previewDocument:await adoptAgentCandidate(payload.document,candidate,{jobId:'reload-job',scope:payload.scope,phaseId:payload.phaseId})};
    }else if(path.endsWith('/adopt')){
      state.adopts.push(structuredClone(payload));state.job.adopted=true;
      if(loseFirstAdoption&&state.adopts.length===1)throw new Error('响应连接中断');
      return {document:structuredClone(state.job.previewDocument)};
    }else if(path.endsWith('/retry'))state.retries.push(structuredClone(payload));
    else if(path.includes('/jobs/reload-job?'))state.reads.push(path);
    else throw new Error(path);
    return structuredClone(state.job);
  };
  return state;
}

test('page reload restores a small Agent handle and keeps the original client revision for retry and adoption',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),storage=new Map(),storageKey='recover-revision',service=recoverableAgent();
  let env=environment(d,{agent:service.request,storage,storageKey});
  try{
    await env.load();
    for(const note of ['第一条人工意见','保留人工意见']){env.get('tacticsNotes').value=note;env.get('tacticsNotes').oninput();}
    env.get('tacticsAgentGoal').value='检查接应者';await env.get('tacticsAgentRun').onclick();await env.ui.saveDraft();
    const original=service.submits[0],handles=[...storage.entries()].filter(([key])=>/agent-(job|candidate)$/.test(key));
    assert.equal(handles.length,2);assert.ok(original.clientRevision>1);
    for(const [,handle] of handles){assert.ok(JSON.stringify(handle).length<1024);assert.equal(handle.document,undefined);assert.equal(handle.candidate,undefined);assert.equal(handle.clientRevision,original.clientRevision);assert.equal(handle.goal,'检查接应者');}
    env.restore();env=environment(d,{agent:service.request,storage,storageKey});await env.load();
    assert.equal(service.submits.length,1);assert.equal(service.reads.length,1);assert.match(uiWords(env.get('tacticsAgentPreview')),/可恢复的路线建议/);
    assert.equal(env.get('tacticsAgentAdopt').disabled,false);await env.get('tacticsAgentRetry').onclick();assert.deepEqual(service.retries[0],original);
    await env.get('tacticsAgentAdopt').onclick();assert.equal(service.adopts[0].clientRevision,original.clientRevision);assert.equal(service.adopts[0].documentDigest,original.documentDigest);assert.equal(service.adopts[0].expectedVersion,original.expectedVersion);
    assert.equal(env.ui.getSceneState().annotations.items.length,1);await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.notes,'保留人工意见');
    const adopts=service.adopts.length;await env.get('tacticsWorkspace').onclick();assert.equal(env.get('tacticsAgentAdopt').disabled,true);await env.get('tacticsAgentAdopt').onclick();assert.equal(service.adopts.length,adopts);
  }finally{env.restore();}
});

for(const scope of ['phase','range'])test(`page reload restores the visible ${scope} scope and goal without resubmitting or changing the request`,async()=>{
  const {review}=await makePresentationDemo();review.mediaEndTime=6.1;
  const d=await createTacticsDocument(review);d.newDrawingRange={startFrame:10,endFrameExclusive:30};
  const storage=new Map(),storageKey=`recover-inputs-${scope}`,goal='逐阶段核对多人配合与不确定脚点';let submitted,retried,job,submits=0,reads=0;
  const agent=async(path,payload)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/jobs')){submits++;submitted=structuredClone(payload);job={jobId:`scope-${scope}`,status:'failed',canRetry:true,message:'保留原请求待重试',base:{expectedVersion:payload.expectedVersion,clientRevision:payload.clientRevision,documentDigest:payload.documentDigest}};}
    else if(path.endsWith('/retry'))retried=structuredClone(payload);
    else if(path.includes(`/jobs/scope-${scope}?`))reads++;
    else throw new Error(path);
    return structuredClone(job);
  };
  let env=environment(d,{agent,storage,storageKey});
  try{
    await env.load();env.get('tacticsAgentScope').value=scope;env.get('tacticsAgentGoal').value=goal;await env.get('tacticsAgentRun').onclick();await env.ui.saveDraft();env.restore();
    env=environment(d,{agent,storage,storageKey});await env.load();
    assert.equal(submits,1);assert.equal(reads,1);assert.equal(env.get('tacticsAgentScope').value,scope);assert.equal(env.get('tacticsAgentGoal').value,goal);
    assert.equal(submitted.scope,scope);assert.equal(submitted.phaseId,'phase-1');assert.deepEqual(submitted.range,scope==='range'?d.newDrawingRange:undefined);
    await env.get('tacticsAgentRetry').onclick();assert.deepEqual(retried,submitted);assert.equal(submits,1);
  }finally{env.restore();}
});

for(const changed of ['document','version'])test(`recovered Agent suggestions are read-only when the same video has a different ${changed}`,async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),storage=new Map(),storageKey=`recover-${changed}`,service=recoverableAgent();
  let env=environment(d,{agent:service.request,storage,storageKey});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();await env.ui.saveDraft();env.restore();
    const draftKey=[...storage.keys()].find(key=>key.endsWith(':tactics:workspace')),draft=structuredClone(storage.get(draftKey));
    if(changed==='document')draft.document.notes='在另一个页面保存的人工意见';else draft.version++;
    storage.set(draftKey,draft);env=environment(d,{agent:service.request,storage,storageKey});await env.load();
    assert.match(uiWords(env.get('tacticsAgentPreview')),/可恢复的路线建议/);assert.match(env.get('tacticsAgentStatus').textContent,/仅供查看/);
    assert.equal(env.get('tacticsAgentAdopt').disabled,true);assert.equal(env.get('tacticsAgentRetry').disabled,true);
    await env.get('tacticsAgentAdopt').onclick();await env.get('tacticsAgentRetry').onclick();assert.equal(service.adopts.length,0);assert.equal(service.retries.length,0);assert.equal(env.ui.getSceneState().annotations.items.length,0);
    await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.notes,draft.document.notes);assert.equal(env.saved.at(-1).expectedVersion,draft.version);
  }finally{env.restore();}
});

test('reload can retrieve an idempotent adoption after the server adopted but its response was lost',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),storage=new Map(),storageKey='recover-adopt-response',service=recoverableAgent({loseFirstAdoption:true});
  let env=environment(d,{agent:service.request,storage,storageKey});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();await env.get('tacticsAgentAdopt').onclick();
    assert.equal(service.job.adopted,true);assert.equal(env.ui.getSceneState().annotations.items.length,0);assert.match(env.get('tacticsAgentStatus').textContent,/响应连接中断/);
    await env.ui.saveDraft();env.restore();env=environment(d,{agent:service.request,storage,storageKey});await env.load();
    assert.equal(env.get('tacticsAgentAdopt').disabled,false);assert.match(env.get('tacticsAgentAdopt').textContent,/恢复上次采用/);
    await env.get('tacticsAgentAdopt').onclick();assert.equal(service.adopts.length,2);assert.deepEqual(service.adopts[1],service.adopts[0]);assert.equal(env.ui.getSceneState().annotations.items.length,1);assert.equal(env.get('tacticsAgentAdopt').disabled,true);
    await env.get('tacticsAgentAdopt').onclick();assert.equal(service.adopts.length,2);await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.agentRuns.filter(run=>run.jobId==='reload-job').length,1);
  }finally{env.restore();}
});

test('edits after recovering a task still invalidate its original request and retain the manual change',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),storage=new Map(),storageKey='recover-edit',service=recoverableAgent();
  let env=environment(d,{agent:service.request,storage,storageKey});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();env.restore();env=environment(d,{agent:service.request,storage,storageKey});await env.load();
    env.get('tacticsNotes').value='恢复后继续人工修改';env.get('tacticsNotes').oninput();await env.get('tacticsAgentRetry').onclick();await env.get('tacticsAgentAdopt').onclick();
    assert.equal(service.retries.length,0);assert.equal(service.adopts.length,0);assert.match(env.get('tacticsAgentStatus').textContent,/修改|变化/);await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.notes,'恢复后继续人工修改');
  }finally{env.restore();}
});

test('reload keeps the last successful candidate when the newest generation failed',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),storage=new Map(),storageKey='recover-retained',service=recoverableAgent();let submits=0;
  const request=async(path,payload)=>{
    if(path.endsWith('/jobs')&&++submits>1)return {jobId:'later-failure',status:'failed',message:'新任务连接失败',canRetry:true};
    if(path.includes('/jobs/later-failure?'))return {jobId:'later-failure',status:'failed',message:'新任务连接失败',canRetry:true};
    return service.request(path,payload);
  };
  let env=environment(d,{agent:request,storage,storageKey});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();await env.get('tacticsAgentRun').onclick();env.restore();
    env=environment(d,{agent:request,storage,storageKey});await env.load();
    assert.equal(submits,2);assert.match(env.get('tacticsAgentStatus').textContent,/新任务连接失败/);assert.match(uiWords(env.get('tacticsAgentPreview')),/可恢复的路线建议/);assert.equal(env.get('tacticsAgentRestore').hidden,false);
    await env.get('tacticsAgentRestore').onclick();await env.get('tacticsAgentAdopt').onclick();assert.equal(service.adopts.length,1);assert.equal(env.ui.getSceneState().annotations.items.length,1);
  }finally{env.restore();}
});

test('a pending size edit disables the name input until both edits can be saved in order',async()=>{
  let d=await createTacticsDocument((await makePresentationDemo()).review);d=createAnnotation(d,{id:'manual-name',phaseId:'phase-1',frame:0,type:'spotlight',space:'video',points:[{x:400,y:400}],name:'原人工圈'});
  const env=environment(d);let resize;
  try{
    await env.load();env.get('tacticsObjectList').children[0].onclick();await env.ui.ready();assert.equal(env.get('tacticsAnnotationName').disabled,false);
    env.hold();env.get('tacticsAnnotationSize').value='1.6';resize=env.get('tacticsAnnotationSize').onchange();
    const deadline=Date.now()+3000;while(!env.pendingWrites&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,2));
    assert.ok(env.pendingWrites>0);assert.equal(env.get('tacticsAnnotationName').disabled,true);assert.equal(env.get('tacticsAnnotationSize').disabled,true);
    env.release();await resize;assert.equal(env.get('tacticsAnnotationName').disabled,false);env.get('tacticsAnnotationName').value='核对后的人工圈';await env.get('tacticsAnnotationName').onchange();
    await env.get('tacticsSave').onclick();const circle=env.saved.at(-1).document.annotations.items[0];assert.equal(circle.style.size,1.6);assert.equal(circle.name,'核对后的人工圈');
  }finally{env.release();await resize?.catch(()=>{});env.restore();}
});

test('partial Agent results show uncertainty, retry only the captured request and stay separate from the manual draft',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review);let first,retry,retries=0;
  const candidate=partialCandidate(),partial={jobId:'partial-job',status:'partial',canRetry:true,message:'第二段暂未完成',failure:{code:'model_timeout',retryable:false},progress:{completed:1,total:2,budgetSeconds:300},candidate,previewDocument:d,stages:[{stageId:'s1',startFrame:0,endFrameExclusive:30,status:'ready',coverage:[{annotated:2,uncertain:1}]},{stageId:'s2',startFrame:30,endFrameExclusive:61,status:'failed',message:'模型超时'}]};
  const env=environment(d,{agent:async(path,payload)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/retry')){retry=payload;retries++;return {...partial,status:'partial',message:'仍有未完成阶段'};}
    if(path.endsWith('/jobs')){first=payload;return partial;}throw new Error(path);
  }});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();assert.equal(first.scope,'play');assert.equal(first.range,undefined);
    assert.match(uiWords(env.get('tacticsAgentPreview')),/接应.*待人工确认.*脚点被遮挡/);
    assert.match(uiWords(env.get('tacticsAgentStages')),/已标 2 人，待确认 1 人/);assert.match(env.get('tacticsAgentStatus').textContent,/阶段 1\/2.*300 秒.*生成超过本次时间上限/);
    assert.equal(env.get('tacticsAgentAdopt').disabled,false);assert.equal(env.get('tacticsAgentRetry').hidden,false);assert.equal(env.ui.getSceneState().annotations.items.length,0);
    await env.get('tacticsAgentRetry').onclick();assert.equal(retries,1);assert.deepEqual(retry,first);
    env.get('tacticsNotes').value='人工补充判断';env.get('tacticsNotes').oninput();await env.get('tacticsAgentRetry').onclick();
    assert.equal(retries,1);assert.match(env.get('tacticsAgentStatus').textContent,/草稿已有修改/);await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.notes,'人工补充判断');
  }finally{env.restore();}
});

test('audit problems locate original frames, keep full diagnostics and survive adopted handle recovery without edits',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),storage=new Map(),storageKey='audit-problems',service=recoverableAgent();
  const issue={kind:'route',code:'route_pending',reason:'短发4号被接成卷发1号',evidenceFrames:[20,40]},diagnostics=Array.from({length:70},(_,i)=>`stage-1 route #${i} frames=[20] originalAction=cut：完整说明 ${i}`);
  const request=async(path,payload)=>{const result=await service.request(path,payload);if(result.jobId)Object.assign(result,{status:'partial',completionKind:'manual_review',canRetry:false,auditNeedsRepair:true,diagnostics,
    visualAudit:{allApproved:false,stages:{s1:{allApproved:false,exceptionItems:[issue,{kind:'frame',code:'missed_on_court_player',reason:'篮下漏掉防守者',frame:30},{kind:'ball',code:'ball_pending',reason:'原画面编号无效，仍须核对持球人',frame:999}]}}},
    stages:[{stageId:'s1',startFrame:0,endFrameExclusive:61,status:'ready',visualAudit:{allApproved:false,exceptionItems:[issue]}}]});return result;};
  let env=environment(d,{player:true,agent:request,storage,storageKey});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();
    let list=env.get('tacticsAgentAuditList');assert.equal(list.children.length,3);
    assert.match(uiWords(list),/路线.*2\.00、4\.00 秒.*短发4号被接成卷发1号/);
    assert.match(uiWords(list),/漏人.*3\.00 秒/);assert.doesNotMatch(uiWords(list),/stage-1|#\d|originalAction|frames=/);
    assert.equal(list.children[2].children.length,1,'invalid frame keeps its reason but has no seek button');
    const writes=env.writes.length,before=structuredClone(env.ui.getSceneState().annotations.items);
    await list.children[0].children[2].onclick();await env.ui.ready();await Promise.resolve();
    assert.equal(env.ui.getSceneState().frame,40);assert.equal(env.writes.length,writes);assert.deepEqual(env.ui.getSceneState().annotations.items,before);
    assert.match(uiWords(env.get('tacticsAgentStages')),/已生成，待核对/);
    assert.match(uiWords(env.get('tacticsAgentPreview')),/完整说明 69/);
    await env.get('tacticsAgentAdopt').onclick();await env.ui.saveDraft();env.restore();
    env=environment(d,{player:true,agent:request,storage,storageKey});await env.load();
    list=env.get('tacticsAgentAuditList');assert.equal(list.children.length,3);
    const reloadWrites=env.writes.length,objects=structuredClone(env.ui.getSceneState().annotations.items);
    await list.children[1].children[1].onclick();await env.ui.ready();await Promise.resolve();
    assert.equal(env.ui.getSceneState().frame,30);assert.equal(env.writes.length,reloadWrites);assert.deepEqual(env.ui.getSceneState().annotations.items,objects);
    assert.match(uiWords(env.get('tacticsAgentPreview')),/完整说明 69/);
  }finally{env.restore();}
});

test('saved audit without a browser handle remains readonly and old locate buttons reject replacement reports',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),{reviewDigest,...binding}=d.playDefinition.sourceBinding;
  const issue={kind:'route',code:'route_pending',reason:'持球者4号不能接成1号',evidenceFrames:[20,40]};
  d.agentRuns=[{jobId:'saved-only',visualAudit:{allApproved:false,stages:{s1:{exceptionItems:[issue]}}},issues:Array.from({length:70},(_,i)=>`保存的完整核对说明 ${i}`),
    visualAuditSource:{schemaVersion:1,jobId:'saved-only',...binding,width:d.review.width,height:d.review.height,mediaEndTime:d.review.mediaEndTime??null,cuts:d.review.settings?.cuts??[],sourceCuts:d.review.settings?.sourceCuts??[],context:{variant:'test',qa:true,kind:'workspace'}}}];
  let requests=0;const env=environment(d,{player:true,agent:async(path)=>{requests++;assert.match(path,/\/status$/);return {available:true,message:'ready'};}});
  try{
    await env.load();const list=env.get('tacticsAgentAuditList');assert.equal(list.children.length,2);
    assert.match(uiWords(list),/路线.*2\.00、4\.00 秒.*4号/);assert.match(uiWords(list),/保存的完整核对说明 69/);
    assert.equal(env.get('tacticsAgentAdopt').hidden,true);assert.equal(env.get('tacticsAgentRetry').hidden,true);assert.equal(env.get('tacticsAgentRefresh').hidden,true);
    const writes=env.writes.length,before=structuredClone(env.ui.getSceneState().annotations.items),oldButton=list.children[0].children[2];
    assert.equal(oldButton.disabled,false);
    await oldButton.onclick();await env.ui.ready();await Promise.resolve();assert.equal(env.ui.getSceneState().frame,40);
    assert.equal(env.writes.length,writes);assert.deepEqual(env.ui.getSceneState().annotations.items,before);
    const beforeChangedPTS=env.playerCalls.length,originalTime=d.review.sourceFrameMapping[20].sourceTime;
    d.review.sourceFrameMapping[20].sourceTime+=.01;await oldButton.onclick();assert.equal(env.playerCalls.length,beforeChangedPTS,'a live PTS change cannot borrow the old digest');
    d.review.sourceFrameMapping[20].sourceTime=originalTime;
    const oldCuts=structuredClone(d.review.settings?.cuts??[]);d.review.settings??={};d.review.settings.cuts=[10];
    await oldButton.onclick();assert.equal(env.playerCalls.length,beforeChangedPTS,'changed cuts cannot use the old saved run');d.review.settings.cuts=oldCuts;
    d.agentRuns[0].visualAudit.stages.s1.exceptionItems[0].reason='新版说明';await env.load();
    const calls=env.playerCalls.length;await oldButton.onclick();assert.equal(env.playerCalls.length,calls,'old source/run context cannot seek after reload');
    assert.match(uiWords(env.get('tacticsAgentAuditList')),/新版说明/);assert.ok(requests>0);
  }finally{env.restore();}
});

test('completed manual-review results group related issues, collapse overflow and retain every basis and guarded frame link',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),service=recoverableAgent();
  const issues=Array.from({length:12},(_,i)=>({personId:`local-${Math.floor(i/2)}`,kind:i%2?'person':'route',code:i%2?'proposed_motion_unverified':'route_pending',frame:20+i,reason:`独立核对依据 ${i}`}));
  const request=async(path,payload)=>{const result=await service.request(path,payload);if(result.jobId)Object.assign(result,{status:'partial',completionKind:'manual_review',failure:{code:'visual_audit'},auditNeedsRepair:true,progress:{completed:2,total:2},
    visualAudit:{allApproved:false,stages:{s1:{exceptionItems:issues},s2:{exceptionItems:[{personId:'local-0',kind:'ball',frame:40,reason:'第二阶段另一个人的球权待核对'}]}}},
    stages:[{stageId:'s1',status:'ready'},{stageId:'s2',status:'ready'}]});return result;};
  const env=environment(d,{player:true,agent:request});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();
    assert.match(env.get('tacticsAgentStatus').textContent,/全段已分析，部分图形待核对/);assert.doesNotMatch(env.get('tacticsAgentStatus').textContent,/生成未完成|未完成阶段/);
    const list=env.get('tacticsAgentAuditList');assert.equal(list.children.length,6,'four groups, one collapsed overflow and the other-stage group');
    assert.match(env.get('tacticsAgentAuditTitle').textContent,/7 组.*13 条审核依据/);
    assert.equal(list.children[0].children.at(-1).tag,'details');assert.equal(list.children[0].children.at(-1).open,false);
    assert.equal(list.children[4].tag,'details');assert.equal(list.children[4].open,false);
    for(let i=0;i<12;i++)assert.match(uiWords(list),new RegExp(`独立核对依据 ${i}(?:\\D|$)`));
    const writes=env.writes.length;await list.children[0].children[2].onclick();await env.ui.ready();await Promise.resolve();
    assert.equal(env.ui.getSceneState().frame,21);assert.equal(env.writes.length,writes);
  }finally{env.restore();}
});

test('saved audit with another source or missing source proof never exposes a locate button',async()=>{
  for(const proof of [undefined,{schemaVersion:1,jobId:'saved',videoSha256:'another-video'}]){
    const d=await createTacticsDocument((await makePresentationDemo()).review);d.agentRuns=[{jobId:'saved',visualAudit:{exceptionItems:[{reason:'历史问题',frame:20}]},visualAuditSource:proof}];
    const env=environment(d,{player:true});try{await env.load();assert.equal(env.get('tacticsAgentAuditIssues').hidden,true);assert.equal(env.get('tacticsAgentAuditList').children.length,0);}finally{env.restore();}
  }
});

test('mounted facts stages show anonymous analysis separately from unbound identity slots and storage errors',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),candidate=partialCandidate();
  const job={jobId:'facts-progress',status:'partial',canRetry:false,failure:{code:'storage'},candidate,previewDocument:d,
    stages:[{stageId:'s1',startFrame:0,endFrameExclusive:30,status:'ready',coverage:[{annotated:11,uncertain:13,pending:0}],
      factsReport:{observedPeople:11,routePeople:2,motionPeople:2,exceptionItems:[]}},{stageId:'s2',startFrame:30,endFrameExclusive:61,status:'failed',failure:{code:'storage'}}]};
  const env=environment(d,{agent:async(path)=>path.endsWith('/status')?{available:true,message:'ready'}:job});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();
    assert.match(env.get('tacticsPanel').innerHTML,/绘图与解说分别调用/);
    assert.match(env.get('tacticsPanel').innerHTML,/按解说关键节点取证和绘图/);
    assert.doesNotMatch(env.get('tacticsPanel').innerHTML,/无法确认的路线留待人工补充/);
    const rows=env.get('tacticsAgentStages').children;
    assert.match(uiWords(rows[0]),/已分析 11 人 · 路线覆盖 2 人 · 0 项疑点/);
    assert.doesNotMatch(uiWords(rows[0]),/13|待确认/);assert.equal(rows[0].children.length,1,'unbound identity slots alone must not offer manual completion');
    const title=env.get('tacticsAgentPreview').children[1].children[0].textContent;
    assert.match(title,/已分析 11 人 · 路线覆盖 2 人/);assert.doesNotMatch(title,/人待确认/);
    assert.match(uiWords(rows[1]),/保存受阻/);assert.match(env.get('tacticsAgentStatus').textContent,/结果保存受阻/);
    assert.equal(env.ui.getSceneState().annotations.items.length,0);
  }finally{env.restore();}
});

for(const nested of [false,true])test(`stage manual navigation reads ${nested?'nested':'top-level'} source bounds without changing the draft`,async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review);d.review.mediaEndTime=6.1;d.playDefinition.sourceBinding=await createSourceBinding(d.review);
  const bounds={startFrame:30,endFrameExclusive:61},stage={stageId:'stage-review',...(nested?{range:bounds}:bounds),status:nested?'failed':'ready',coverage:[{annotated:1,uncertain:1}]};
  const env=environment(d,{player:true,agent:async(path)=>path.endsWith('/status')?{available:true,message:'ready'}:{jobId:'manual-review',status:'partial',canRetry:false,message:'有待人工确认的人物',candidate:partialCandidate(),previewDocument:d,stages:[stage]}});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();
    assert.match(uiWords(env.get('tacticsAgentStages')),/3\.00—6\.10 秒/);assert.equal(env.get('tacticsAgentRetry').hidden,true);
    assert.match(env.get('tacticsAgentStatus').textContent,/未确认事项需人工补充/);assert.doesNotMatch(env.get('tacticsAgentStatus').textContent,/失败阶段可重试/);
    const writes=env.writes.length;await env.get('tacticsAgentStages').children[0].children[1].onclick();await env.ui.ready();await Promise.resolve();
    assert.equal(env.ui.getSceneState().frame,30);assert.equal(env.writes.length,writes);assert.equal(env.ui.getSceneState().annotations.items.length,0);
  }finally{env.restore();}
});

test('failed regeneration preserves the previous candidate and explicit return can still adopt a matching draft',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),candidate=partialCandidate();let jobs=0,adopts=0;
  const preview=createAnnotation(d,{id:'agent-visible',phaseId:'phase-1',frame:0,type:'screen',space:'video',points:[{x:500,y:400}],origin:{kind:'agent',jobId:'first-job',sourceFrames:[0],note:'参考帧'}});
  const env=environment(d,{agent:async(path)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/adopt')){adopts++;assert.match(path,/first-job/);return {document:preview};}
    if(path.endsWith('/jobs'))return ++jobs===1?{jobId:'first-job',status:'ready',candidate,previewDocument:preview}:{jobId:'failed-job',status:'failed',message:'模型超时',canRetry:true};
    throw new Error(path);
  }});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();await env.get('tacticsAgentRun').onclick();
    assert.match(uiWords(env.get('tacticsAgentPreview')),/有证据的阶段/);assert.equal(env.get('tacticsAgentRestore').hidden,false);assert.equal(env.get('tacticsAgentAdopt').hidden,true);
    assert.equal(env.ui.getSceneState().annotations.items.length,0);await env.get('tacticsAgentRestore').onclick();await env.get('tacticsAgentAdopt').onclick();
    assert.equal(adopts,1);assert.equal(env.ui.getSceneState().annotations.items[0].id,'agent-visible');
  }finally{env.restore();}
});

test('partial adoption appends validated results while retaining the existing manual object',async()=>{
  let d=await createTacticsDocument((await makePresentationDemo()).review);
  d=createAnnotation(d,{id:'manual-before-agent',phaseId:'phase-1',frame:0,type:'screen',space:'video',points:[{x:400,y:400}]});
  const manual=structuredClone(d.annotations.items[0]),preview=createAnnotation(d,{id:'partial-visible',phaseId:'phase-1',frame:0,type:'screen',space:'video',points:[{x:600,y:400}]});
  const env=environment(d,{agent:async(path)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/adopt'))return {document:preview};
    return {jobId:'partial-adopt',status:'partial',canRetry:true,candidate:partialCandidate(),previewDocument:preview};
  }});
  try{
    await env.load();env.get('tacticsAgentScope').value='phase';await env.get('tacticsAgentRun').onclick();
    assert.match(env.get('tacticsAgentAdopt').textContent,/已完成阶段/);assert.equal(env.ui.getSceneState().annotations.items.length,1);
    await env.get('tacticsAgentAdopt').onclick();await env.get('tacticsSave').onclick();
    assert.deepEqual(env.saved.at(-1).document.annotations.items[0],manual);assert.equal(env.saved.at(-1).document.annotations.items.length,2);
  }finally{env.restore();}
});

test('whole-video candidate previews use retained document phases and include only the newly generated graphics',async()=>{
  let d=await createTacticsDocument((await makePresentationDemo()).review);d=createAnnotation(d,{id:'retained-manual',phaseId:'phase-1',frame:0,type:'screen',space:'video',points:[{x:400,y:400}]});
  let preview=d;for(const at of [0,40])preview=createAnnotation(preview,{id:`generated-${at}`,phaseId:'phase-1',frame:at,type:'screen',space:'video',points:[{x:600,y:400}],origin:{kind:'agent',jobId:'append-preview',sourceFrames:[at],note:'参考帧'}});
  const base=partialCandidate().phases[0],candidate={schemaVersion:4,production:null,summary:'整段补充',issues:[],phases:[base,{...base,title:'阶段二',startFrame:30,endFrameExclusive:61,freezeFrame:30}]};
  const env=environment(d,{agent:async(path)=>path.endsWith('/status')?{available:true,message:'ready'}:{jobId:'append-preview',status:'ready',candidate,previewDocument:preview,previewFrames:[0,40].map(frame=>({frame,dataUrl:'data:image/jpeg;base64,/9j/',videoSha256:d.review.videoSha256}))}});
  const walk=node=>[node,...(node.children??[]).filter(n=>typeof n==='object').flatMap(walk)];
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();const surfaces=walk(env.get('tacticsAgentPreview')).filter(n=>n.className==='tactics-agent-image');
    assert.equal(surfaces.length,2);assert.match(surfaces[0].children[1].innerHTML,/generated-0/);assert.match(surfaces[1].children[1].innerHTML,/generated-40/);
    assert.ok(surfaces.every(surface=>!surface.children[1].innerHTML.includes('retained-manual')));assert.deepEqual(env.ui.getSceneState().annotations.items,d.annotations.items);
  }finally{env.restore();}
});

test('manual-review suggestions remain unpainted, navigate to their own anchor, and survive adopt/save/reload',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review),pending={annotationId:'cross-phase-1',phaseId:'phase-1',anchorFrame:40,reason:'依据跨越已有人工阶段，请核对后手绘',annotation:{type:'route',entityId:null,anchorFrame:40,explanation:'保留完整建议，不剪改坐标'}};
  const candidate=partialCandidate(),preview={...structuredClone(d),agentRuns:[{jobId:'pending-job',summary:candidate.summary,issues:[],pendingAnnotations:[pending],pendingActions:[]}]};
  const env=environment(d,{player:true,agent:async(path)=>path.endsWith('/status')?{available:true,message:'ready'}:path.endsWith('/adopt')?{document:preview}:{jobId:'pending-job',status:'partial',completionKind:'manual_review',canRetry:false,candidate,previewDocument:preview,pendingAnnotations:[pending],pendingActions:[]}});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();assert.equal(env.get('tacticsAgentPending').hidden,false);
    assert.match(uiWords(env.get('tacticsAgentPendingList')),/跨越已有人工阶段/);assert.equal(env.ui.getSceneState().annotations.items.length,0);
    const writes=env.writes.length;await env.get('tacticsAgentPendingList').children[0].children[1].onclick();await env.ui.ready();await Promise.resolve();
    assert.equal(env.ui.getSceneState().frame,40);assert.equal(env.writes.length,writes);assert.equal(env.ui.getSceneState().annotations.items.length,0);
    await env.get('tacticsAgentAdopt').onclick();await env.get('tacticsSave').onclick();assert.deepEqual(env.saved.at(-1).document.agentRuns[0].pendingAnnotations,[pending]);
    await env.get('tacticsWorkspace').onclick();await env.ui.ready();assert.equal(env.get('tacticsAgentPending').hidden,false);assert.match(uiWords(env.get('tacticsAgentPendingList')),/4\.00 秒/);
    assert.equal(env.get('tacticsAgentPendingList').children.length,1);assert.equal(env.ui.getSceneState().annotations.items.length,0);
  }finally{env.restore();}
});

test('a failed status poll can resume the same job without submitting a second model request',async()=>{
  const d=await createTacticsDocument((await makePresentationDemo()).review);let submits=0,polls=0;
  const env=environment(d,{agent:async(path)=>{
    if(path.endsWith('/status'))return {available:true,message:'ready'};
    if(path.endsWith('/jobs')){submits++;return {jobId:'poll-job',status:'queued'};}
    if(path.includes('/jobs/poll-job?')){if(++polls===1)throw new Error('连接中断');return {jobId:'poll-job',status:'ready',candidate:partialCandidate(),previewDocument:d};}
    throw new Error(path);
  }});
  try{
    await env.load();await env.get('tacticsAgentRun').onclick();await new Promise(resolve=>setTimeout(resolve,1150));
    assert.equal(env.get('tacticsAgentRefresh').hidden,false);assert.equal(env.get('tacticsAgentRun').disabled,true);
    assert.match(env.get('tacticsAgentStatus').textContent,/任务状态读取失败/);
    await env.get('tacticsAgentRefresh').onclick();assert.equal(submits,1);assert.equal(polls,2);
    assert.equal(env.get('tacticsAgentAdopt').disabled,false);assert.equal(env.get('tacticsAgentRefresh').hidden,true);
  }finally{env.restore();}
});

test('an unavailable Agent can recover while direct manual editing stays available on an empty unprepared video',async()=>{
  const {review}=await makePresentationDemo();review.entities=[];review.court.calibration.keyframes=[];
  const d=await createTacticsDocument(review);let health=0,submits=0;
  const env=environment(d,{empty:true,agent:async(path,payload)=>{
    if(path.endsWith('/status'))return {available:++health>1,message:health===1?'暂不可用':'ready'};
    if(path.endsWith('/jobs')){submits++;assert.equal(payload.scope,'play');assert.equal(payload.document.production,undefined);assert.equal(payload.document.review.courtPreparation,undefined);return {jobId:'recovered',status:'failed',message:'无可靠观测，保留人工入口',canRetry:true};}
    throw new Error(path);
  }});
  try{
    await env.load();assert.equal(env.get('tacticsAgentManual').disabled,false);assert.equal(env.get('tacticsAgentRun').disabled,false);
    await env.get('tacticsAgentManual').onclick();await env.ui.ready();assert.equal(env.get('tacticsEmpty').hidden,true);assert.equal(env.get('tacticsToolRoute').getAttribute('aria-pressed'),'true');
    await env.get('tacticsAgentRun').onclick();assert.equal(health,2);assert.equal(submits,1);assert.equal(env.get('tacticsAgentManual').disabled,false);
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
