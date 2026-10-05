import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession} from '../trajectory.mjs';
import {buildCourtPreparation} from '../court-preparation.mjs';
import {normalizeContext} from '@earendil-works/pi-ai';
import {createQwenProvider} from './qwen-provider.mjs';
import {createTrajectoryTools} from './ground-trajectory-tools.mjs';

function fixture(){
  const frames=Array.from({length:21},(_,frame)=>({frame,time:frame*0.041+(frame>10?.003:0),tracks:[[90+frame,40,110+frame,80,1,.9,0]]}));
  const clip={video_sha256:'a'.repeat(64),tracking_fingerprint:'b'.repeat(64),frames,mediaEndTime:.91,width:640,height:480};
  const session=blankSession(clip.video_sha256);session.entities[0].bindings=[{kind:'track',trackId:1,start:0,end:20}];
  const quality={independentAccuracyValidated:false,diagnostic:'camera debug '.repeat(10000)};
  const maps=frames.map(()=>({toCourt:[.05,0,0,0,.05,0,0,0,1],toImage:[20,0,0,0,20,0,0,0,1],method:'test',supportFrames:[0],supportHulls:[],referenceOnly:true,quality}));
  const preparation=buildCourtPreparation({session,clip,maps});
  return {jobId:'test-job',entityIds:['P1'],range:{startFrame:0,endFrameExclusive:21},session,clip,preparation,config:{model:'qwen3.8-max'}};
}
test('model context retains exact timing/projection and locks without repeating camera diagnostics',()=>{
  const start=fixture();start.preparation.rawByPlayer.P1[5].locked=true;
  const runtime=createTrajectoryTools(start,{rpc:()=>{},emit:()=>{},budget:{},requestNumber:()=>1});
  const context=runtime.context();
  assert.deepEqual(context.frameMapping,start.preparation.frameMapping);
  assert.deepEqual(context.calibration.maps[0].map.toCourt,start.preparation.maps[0].toCourt);
  assert.equal(context.players.P1.manualLocks[0].frame,5);
  assert.equal(context.players.P1.observed[0].referenceCalibration,true);
  assert.ok(JSON.stringify(context).length<20000);
  assert.ok(start.preparation.maps[0].quality.diagnostic.length>100000);
});
test('oversized crop request is rejected before decoding, with a useful audit entry',async()=>{
  let calls=0;
  const runtime=createTrajectoryTools(fixture(),{rpc:()=>{calls++;},emit:()=>{},
    budget:{maxImagesPerReply:8,maxUniqueFrames:64,maxToolCalls:96,toolCalls:0},requestNumber:()=>1});
  const tool=runtime.tools.find(t=>t.name==='inspect_frames');
  await assert.rejects(()=>tool.execute('1',{frames:Array.from({length:12},(_,i)=>i),mode:'player'}),/12 张图.*8 张/);
  assert.equal(calls,0);assert.match(runtime.state.audit.at(-1).error,/sheet/);
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
