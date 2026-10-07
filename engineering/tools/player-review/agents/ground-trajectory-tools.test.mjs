import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession} from '../trajectory.mjs';
import {buildCourtPreparation} from '../court-preparation.mjs';
import {normalizeContext} from '@earendil-works/pi-ai';
import {createQwenProvider} from './qwen-provider.mjs';
import {createTrajectoryTools,summarizeTrajectoryIssues} from './ground-trajectory-tools.mjs';

function fixture(){
  const frames=Array.from({length:21},(_,frame)=>({frame,time:frame*0.041+(frame>10?.003:0),tracks:[[90+frame,40,110+frame,80,1,.9,0]]}));
  const clip={video_sha256:'a'.repeat(64),tracking_fingerprint:'b'.repeat(64),frames,mediaEndTime:.91,width:640,height:480};
  const session=blankSession(clip.video_sha256);session.entities[0].bindings=[{kind:'track',trackId:1,start:0,end:20}];
  const quality={independentAccuracyValidated:false,diagnostic:'camera debug '.repeat(10000)};
  const maps=frames.map(()=>({toCourt:[.05,0,0,0,.05,0,0,0,1],toImage:[20,0,0,0,20,0,0,0,1],method:'test',supportFrames:[0],supportHulls:[],referenceOnly:true,quality}));
  const preparation=buildCourtPreparation({session,clip,maps});
  return {jobId:'test-job',entityIds:['P1'],range:{startFrame:0,endFrameExclusive:21},session,clip,preparation,config:{model:'qwen3.8-max'}};
}
test('long missing-frame reports retain every interval and reason without repeating one issue per frame',()=>{
  const issues=Array.from({length:90},(_,frame)=>({entityId:'P1',frame:frame<45?frame:frame+5,reason:'uncalibrated'}));
  const summary=summarizeTrajectoryIssues(issues);
  assert.equal(summary.total,90);
  assert.deepEqual(summary.ranges,[{entityId:'P1',reason:'uncalibrated',count:90,ranges:[[0,45],[50,95]]}]);
  assert.equal(issues.length,90);
});
test('model context retains exact timing/projection and locks without repeating camera diagnostics',()=>{
  const start=fixture();start.preparation.rawByPlayer.P1[5].locked=true;
  const target=start.session.entities.find(entity=>entity.id==='P1');
  Object.assign(target,{name:'Target blue 00',team:'dark_blue',jersey:'00',role:'player'});
  const other=start.session.entities.find(entity=>entity.id!=='P1');
  if(other)Object.assign(other,{name:'DO_NOT_INCLUDE_OTHER_IDENTITY',team:'red',jersey:'99'});
  const rawSnapshot=structuredClone(start.preparation.rawByPlayer.P1);
  const runtime=createTrajectoryTools(start,{rpc:()=>{},emit:()=>{},budget:{},requestNumber:()=>1});
  const context=runtime.context();
  assert.deepEqual(context.frameMapping,start.preparation.frameMapping);
  assert.deepEqual(context.calibration.maps[0].map.toCourt,start.preparation.maps[0].toCourt);
  assert.deepEqual(context.players.P1.identity,{name:'Target blue 00',team:'dark_blue',jersey:'00',role:'player'});
  assert.equal(JSON.stringify(context).includes('DO_NOT_INCLUDE_OTHER_IDENTITY'),false);
  assert.deepEqual(start.preparation.rawByPlayer.P1,rawSnapshot);
  for(const key of ['name','team','jersey','role'])delete target[key];
  assert.deepEqual(runtime.context().players.P1.identity,{name:null,team:null,jersey:null,role:null});
  assert.equal(context.players.P1.manualLocks[0].frame,5);
  assert.equal(context.players.P1.observed[0].referenceCalibration,true);
  assert.ok(JSON.stringify(context).length<20000);
  assert.ok(start.preparation.maps[0].quality.diagnostic.length>100000);
});
test('context exposes unsampled existing projection runs without changing raw points',()=>{
  const start=fixture();
  const raw=start.preparation.rawByPlayer.P1;
  for(const point of raw){point.x=null;point.y=null;}
  const runtime=createTrajectoryTools(start,{rpc:()=>{},emit:()=>{},budget:{},requestNumber:()=>1});
  const sampled=new Set(runtime.context().suggestedFrames);
  const frame=raw.findIndex((point,index)=>index>=start.range.startFrame&&index<start.range.endFrameExclusive&&!sampled.has(index));
  assert.notEqual(frame,-1);
  raw[frame].x=6.25;raw[frame].y=4.5;
  const snapshot=structuredClone(raw);
  const context=runtime.context();
  const player=context.players.P1;
  assert.ok(player.observed.every(point=>!Number.isFinite(point?.x)&&!Number.isFinite(point?.y)));
  assert.equal(player.availableProjectionCount,1);
  assert.deepEqual(player.availableProjectionRanges,[{startFrame:frame,endFrameExclusive:frame+1,suggestedEvidenceFrames:[frame]}]);
  assert.match(player.availableProjectionMeaning,/不代表人物可见、脚点接地或位置真值/);
  assert.deepEqual(raw,snapshot);
});
test('oversized crop request is rejected before decoding, with a useful audit entry',async()=>{
  let calls=0;
  const runtime=createTrajectoryTools(fixture(),{rpc:()=>{calls++;},emit:()=>{},
    budget:{maxImagesPerReply:8,maxUniqueFrames:64,maxToolCalls:96,toolCalls:0},requestNumber:()=>1});
  const tool=runtime.tools.find(t=>t.name==='inspect_frames');
  await assert.rejects(()=>tool.execute('1',{frames:Array.from({length:12},(_,i)=>i),mode:'player'}),/12 张图.*8 张/);
  assert.equal(calls,0);assert.match(runtime.state.audit.at(-1).error,/sheet/);
});

test('multi-player context omits unchanged duplicate observations while retaining timing and every player',()=>{
  const start=fixture();
  start.entityIds=['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10'];
  for(const id of start.entityIds){
    start.preparation.rawByPlayer[id]=structuredClone(start.preparation.rawByPlayer.P1);
    start.preparation.preparedByPlayer[id]=structuredClone(start.preparation.rawByPlayer.P1);
  }
  start.preparation.preparedByPlayer.P2[4].x=99;
  const context=createTrajectoryTools(start,{rpc:()=>{},emit:()=>{},budget:{},requestNumber:()=>1}).context();
  assert.equal(Object.keys(context.players).length,10);
  assert.equal(context.players.P1.observed.length,6);
  assert.deepEqual(context.players.P1.current,[]);
  assert.equal(context.players.P2.current.find(p=>p.frame===4).x,99);
  assert.deepEqual(context.frameMapping,context.suggestedFrames.map(frame=>start.preparation.frameMapping[frame]));
  assert.equal(context.frameMapping.find(p=>p.frame===4).time,start.preparation.frameMapping[4].time);
});
test('off mode is sent as the actual Qwen API switch before any network request',async()=>{
  const provider=createQwenProvider({QWEN_KEY:'test-placeholder'});let payload;
  const result=await provider.streamFn(provider.model,normalizeContext({messages:[{role:'user',content:'test',timestamp:0}]}),{
    onPayload:value=>{payload=value;throw new Error('payload captured before network');},
  }).result();
  assert.equal(result.stopReason,'error');assert.equal(payload.enable_thinking,false);
  assert.equal(payload.model,'qwen3.8-max');
});
test('source pixels use the exact frame mapping and failed projection keeps the previous anchors',async()=>{
  const start=fixture();
  const runtime=createTrajectoryTools(start,{rpc:()=>{},emit:()=>{},
    budget:{maxToolCalls:96,toolCalls:0},requestNumber:()=>1});
  runtime.state.seenFrames.add(10);runtime.state.seenFrames.add(11);
  const tool=runtime.tools.find(t=>t.name==='set_ground_anchors');
  await tool.execute('1',{revision:0,anchors:[{entityId:'P1',frame:10,imagePoint:{x:120,y:90},evidenceFrames:[10],basis:'Visible support foot'}]});
  assert.equal(runtime.state.anchors[0].x,6);assert.equal(runtime.state.anchors[0].y,4.5);
  assert.match(runtime.state.anchors[0].basis,/imagePoint 120,90/);
  start.preparation.maps[11]=null;
  await assert.rejects(()=>tool.execute('2',{revision:1,anchors:[{entityId:'P1',frame:11,imagePoint:{x:120,y:90},evidenceFrames:[11],basis:'Visible support foot'}]}),/没有可用球场映射/);
  assert.equal(runtime.state.revision,1);assert.equal(runtime.state.anchors.length,1);
});
test('image asset coordinates undo crop, label and scale before court projection',async()=>{
  const runtime=createTrajectoryTools(fixture(),{rpc:()=>{},emit:()=>{},
    budget:{maxToolCalls:96,toolCalls:0},requestNumber:()=>1});
  runtime.state.seenFrames.add(10);
  runtime.state.assets.push({id:'feet-image',frame:10,crop:[100,50,200,150],scale:2,labelHeight:28});
  const tool=runtime.tools.find(t=>t.name==='set_ground_anchors');
  await tool.execute('1',{revision:0,anchors:[{entityId:'P1',frame:10,imagePoint:{assetId:'feet-image',x:40,y:108},evidenceFrames:[10],basis:'Visible support foot'}]});
  assert.equal(runtime.state.anchors[0].x,6);assert.equal(runtime.state.anchors[0].y,4.5);
  await assert.rejects(()=>tool.execute('2',{revision:1,anchors:[{entityId:'P1',frame:10,imagePoint:{assetId:'feet-image',x:40,y:10},evidenceFrames:[10],basis:'Wrong label position'}]}),/标题/);
  assert.equal(runtime.state.revision,1);
});
