import test from 'node:test';
import assert from 'node:assert/strict';
import * as trajectory from './trajectory.mjs';
import * as identity from './identity-timeline.mjs';
import {editImageAnchor} from './image-edit.mjs';

const frames=Array.from({length:9},(_,frame)=>({frame,time:frame/10,
  tracks:[10,20,30].map((id,i)=>[i*100,10,i*100+40,100,id,.85,0])}));
const proposal=id=>({trackId:id,box:frames[0].tracks.find(box=>box[4]===id).slice(0,4)});
const suggestions=(entities)=>({version:1,method:'test-fragments',verified:false,entities});
const proposed=(id,trackId,start=0,end=8)=>({id,bindings:[{start,end,trackId}]});
function adopt(session,value){
  assert.equal(typeof identity.adoptIdentitySuggestions,'function','model suggestions need an explicit adoption operation');
  return identity.adoptIdentitySuggestions(session,value,frames);
}

// A changed default must not manufacture positions while a player is hidden.
test('new fixed ten-player sessions keep short unseen gaps empty by default',()=>{
  const s=trajectory.blankSession('clip');
  s.entities[0].anchors=[{frame:0,x:20,y:100,trackId:null},{frame:2,x:30,y:100,trackId:null}];
  const points=trajectory.buildTrajectories(s,frames);
  assert.equal(Object.keys(points).length,10);
  assert.equal(points.P1[1].source,'missing');assert.equal(points.P1[1].x,null);
  assert(s.entities.slice(1).every(e=>points[e.id].every(p=>p.x===null)));
});

// Sparse/duplicated old drafts must not remove a fixed slot or discard evidence.
test('restoring old drafts keeps ten unique player slots and preserves displaced records',()=>{
  assert.equal(typeof trajectory.ensurePlayerSlots,'function');
  const first={id:'P1',name:'先前姓名',role:'player',anchors:[{frame:0,x:20,y:100,trackId:10}]};
  const duplicate={id:'P1',name:'重复记录',role:'player',anchors:[{frame:2,x:120,y:100,trackId:20}]};
  const s={version:1,entities:[first,duplicate,{id:'R1',name:'裁判 1',role:'referee',anchors:[]}]};
  trajectory.ensurePlayerSlots(s);
  assert.deepEqual(s.entities.filter(e=>e.role==='player').map(e=>e.id),['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10']);
  assert.deepEqual(s.entities[0],first);assert.equal(s.entities.at(-1).id,'R1');
  assert.deepEqual(s.recoveredEntities[0].entity,duplicate);
  trajectory.ensurePlayerSlots(s);assert.equal(s.recoveredEntities.length,1);
});

// Loading a proposal cannot turn the roster or an exported identity into human evidence.
test('adopted suggestions show model positions but remain unconfirmed in the roster and export',()=>{
  const s=trajectory.blankSession('clip');
  adopt(s,suggestions([proposed('P1',10)]));
  const e=s.entities[0],point=trajectory.buildTrajectories(s,frames).P1[1];
  assert.equal(e.anchors.length,0);assert.equal(e.name,'球员 1');
  assert.equal(trajectory.isSelected(e),false);
  assert.equal(trajectory.hasAssociation(e),true);assert.equal(trajectory.isHumanIdentitySelected(e),false);
  assert.equal(point.source,'tracked');assert.equal(point.identitySource,'model_suggestion');
  assert.equal(point.reviewRequired,true);assert.equal(point.identityConfirmed,false);
  assert.equal(point.identityConfidence,undefined);
  const output=trajectory.exportReview(s,{video_sha256:'clip',width:500,height:200,frames,
    trackingMetadata:{model_name:'basketball-player',device:'cuda:0'}},'test-time');
  assert.equal(output.selectionConfirmed,false);assert.equal(output.entities[0].identityConfirmed,false);
  assert.equal(output.trackingMetadata.model_name,'basketball-player');
});

// A late-starting suggestion cannot outrank an existing human boundary or change their fields.
test('human fields, ranges, anchors and later confirmations survive adoption and reload',()=>{
  const s=trajectory.blankSession('clip');
  identity.confirmIdentity(s,'P1',1,proposal(10),frames);
  trajectory.confirmBinding(s,'P1',{kind:'track',trackId:30,start:5,end:7},frames);
  s.entities[0].name='已确认姓名';s.entities[0].team='人工队名';s.entities[0].jersey='8';
  const before=structuredClone(s.entities[0]);
  const unchanged=trajectory.buildTrajectories(s,frames).P1;
  adopt(s,suggestions([{...proposed('P1',20,3,8),teamHint:'模型队色'},proposed('P2',20)]));
  const after=s.entities[0];
  for(const field of ['name','team','jersey','anchors','bindings','identityKeyframes'])assert.deepEqual(after[field],before[field]);
  assert.deepEqual(trajectory.buildTrajectories(s,frames).P1.slice(1),unchanged.slice(1));
  const loaded=JSON.parse(JSON.stringify(s));identity.migrateIdentitySession(loaded);
  assert.deepEqual(trajectory.buildTrajectories(loaded,frames),trajectory.buildTrajectories(s,frames));
  const p1=trajectory.buildTrajectories(loaded,frames).P1;
  identity.confirmIdentity(loaded,'P2',3,proposal(20),frames);
  assert.deepEqual(trajectory.buildTrajectories(loaded,frames).P1,p1);
  assert.equal(trajectory.isHumanIdentitySelected(loaded.entities[1]),true);
});

// Duplicate model claims must never draw two people at one track; explicit human ownership wins.
test('duplicate model proposals have no boxes and one human lock leaves unrelated players intact',()=>{
  const s=trajectory.blankSession('clip');
  adopt(s,suggestions([proposed('P1',10),proposed('P2',10),proposed('P3',30)]));
  const before=trajectory.buildTrajectories(s,frames);
  assert.equal(before.P1[1].source,'conflict');assert.equal(before.P1[1].x,null);
  assert.equal(before.P2[1].x,null);assert.equal(before.P1[1].box,undefined);
  identity.confirmIdentity(s,'P1',0,proposal(10),frames);
  const after=trajectory.buildTrajectories(s,frames);
  assert.equal(after.P1[1].trackId,10);assert.equal(after.P2[1].x,null);
  assert.deepEqual(after.P3,before.P3);
  assert.equal(trajectory.isHumanIdentitySelected(s.entities[1]),false);
});

// A position correction is not an identity lock, and proposals cannot replace its coordinates.
test('manual position edits of a proposal survive re-adoption without confirming its identity',()=>{
  const s=trajectory.blankSession('clip'),value=suggestions([proposed('P1',10)]);
  adopt(s,value);
  const point=trajectory.buildTrajectories(s,frames).P1[2];
  s.entities[0].anchors.push(editImageAnchor(point,2,{x:27,y:93},500,200));
  adopt(s,value);
  const loaded=JSON.parse(JSON.stringify(s)),edited=trajectory.buildTrajectories(loaded,frames).P1[2];
  assert.equal(edited.x,27);assert.equal(edited.y,93);assert.equal(edited.source,'manual');
  assert.equal(edited.identitySource,'model_suggestion');
  assert.equal(trajectory.isHumanIdentitySelected(loaded.entities[0]),false);
  adopt(loaded,suggestions([proposed('P1',20)]));
  assert.equal(trajectory.buildTrajectories(loaded,frames).P1[2].x,27);
  assert.equal(trajectory.buildTrajectories(loaded,frames).P1[2].y,93);
});

// Confirming the suggested identity should not reset a foot the reviewer already corrected.
test('confirming a model identity preserves an independently corrected current-frame position',()=>{
  const s=trajectory.blankSession('clip');adopt(s,suggestions([proposed('P1',10)]));
  const point=trajectory.buildTrajectories(s,frames).P1[2];
  s.entities[0].anchors.push(editImageAnchor(point,2,{x:27,y:93},500,200));
  identity.confirmIdentity(s,'P1',2,{...proposal(10),preservePosition:true},frames);
  const locked=trajectory.buildTrajectories(s,frames).P1[2];
  assert.equal(locked.x,27);assert.equal(locked.y,93);assert.equal(locked.footMethod,'human_image_anchor');
  assert.equal(locked.identitySource,'manual_forward');assert.equal(trajectory.isHumanIdentitySelected(s.entities[0]),true);
});

// Bad proposals cannot leave half of a roster changed.
test('invalid or absent-track suggestions are rejected atomically',()=>{
  assert.equal(typeof identity.adoptIdentitySuggestions,'function');
  const s=trajectory.blankSession('clip'),before=structuredClone(s);
  for(const value of [suggestions([proposed('P1',10),proposed('P2',999)]),
    suggestions([proposed('P1',10),proposed('P1',20)]),suggestions([proposed('P11',10)]),
    suggestions([proposed('P1',10,5,3)]),{...suggestions([proposed('P1',10)]),verified:true}]){
    assert.throws(()=>adopt(s,value));assert.deepEqual(s,before);
  }
});

// Occlusion and cuts preserve a slot while keeping its unknown position blank.
test('model fragment gaps and camera cuts remain empty with distinct waiting states',()=>{
  const records=structuredClone(frames);records[2].tracks=records[2].tracks.filter(box=>box[4]!==10);
  const s=trajectory.blankSession('clip');adopt(s,suggestions([proposed('P1',10)]));s.cuts=[5];
  const points=trajectory.buildTrajectories(s,records).P1;
  assert.equal(points[2].source,'missing');assert.equal(points[2].x,null);assert.equal(points[2].box,undefined);
  assert.equal(points[2].visibility,'occluded_waiting');assert.equal(points[2].identitySource,'model_suggestion');
  assert.equal(points[5].source,'missing');assert.equal(points[5].trackId,undefined);
  assert.equal(trajectory.playerDisplayState(s.entities[0],points[2]).label,'遮挡 / 断轨待续接');
  assert.equal(trajectory.playerDisplayState(s.entities[0],points[5]).label,'位置未知');
  assert.deepEqual(trajectory.gapRanges(points),[{start:2,end:2},{start:5,end:8}]);
});

// Opting into estimates still cannot bridge two separately proposed identities.
test('opted-in model gap estimates retain proposal provenance and stop at fragment boundaries',()=>{
  const records=structuredClone(frames);records[1].tracks=records[1].tracks.filter(box=>box[4]!==10);
  const s=trajectory.blankSession('clip');adopt(s,suggestions([proposed('P1',10)]));s.maxGapSeconds=.5;
  let points=trajectory.buildTrajectories(s,records).P1;
  assert.equal(points[1].source,'interpolated');assert.equal(points[1].reviewRequired,true);
  assert.equal(points[1].identitySource,'model_suggestion');assert.equal(points[1].identityConfirmed,false);
  s.entities[0].modelBindings.push({kind:'track',start:2,end:8,trackId:20,source:'model_suggestion',reviewRequired:true});
  points=trajectory.buildTrajectories(s,records).P1;assert.equal(points[1].source,'missing');
});

// Explicit range/exit fixes remain usable after model adoption.
test('human out-of-view and finite repair ranges override model proposals without fabricating positions',()=>{
  const s=trajectory.blankSession('clip');adopt(s,suggestions([proposed('P1',10)]));
  trajectory.confirmBinding(s,'P1',{kind:'out_of_view',start:2,end:8},frames);
  trajectory.confirmBinding(s,'P1',{kind:'track',trackId:20,start:6,end:7},frames);
  const points=trajectory.buildTrajectories(s,frames).P1;
  assert.equal(points[3].source,'out_of_view');assert.equal(points[3].x,null);
  assert.equal(points[6].trackId,20);assert.equal(points[6].identitySource,'manual_range');
  assert.equal(points[8].source,'out_of_view');assert.equal(points[0].identitySource,'model_suggestion');
  assert.equal(trajectory.playerDisplayState(s.entities[0],points[3]).label,'镜头外 · 无需补点');
});

test('manual unnumbered selection keeps its human lock while future positions remain unknown',()=>{
  const s=trajectory.blankSession('clip');
  identity.confirmIdentity(s,'P1',1,{trackId:null,box:[10,10,40,100]},frames);
  const points=trajectory.buildTrajectories(s,frames).P1;
  assert.equal(trajectory.isHumanIdentitySelected(s.entities[0]),true);
  assert.equal(trajectory.playerDisplayState(s.entities[0],points[1]).identity,'human_locked');
  assert.equal(trajectory.playerDisplayState(s.entities[0],points[2]).identity,'human_locked');
  assert.equal(points[2].x,null);assert.equal(points[2].source,'missing');
});

// Model version switching cannot reuse an incompatible draft, and baseline keys stay valid.
test('draft keys retain original saved sessions and isolate model fingerprints and QA',()=>{
  assert.equal(typeof trajectory.draftStorageKey,'function');
  assert.equal(trajectory.draftStorageKey({video_sha256:'video',tracking_fingerprint:'new'},'original',false),'player-review:video');
  assert.equal(trajectory.draftStorageKey({video_sha256:'video',tracking_fingerprint:'baseline'},'optimized',false),'player-review:video:baseline');
  assert.notEqual(trajectory.draftStorageKey({video_sha256:'video',tracking_fingerprint:'baseline'},'optimized',false),
    trajectory.draftStorageKey({video_sha256:'video',tracking_fingerprint:'optimized'},'optimized',false));
  assert.equal(trajectory.draftStorageKey({video_sha256:'video'},'original',true),'player-review:video:qa');
});

// A detector score is not a claim about a person's identity.
test('model summary accepts metadata variants and keeps scores out of identity labels',()=>{
  assert.equal(typeof trajectory.trackingModelSummary,'function');
  const summary=trajectory.trackingModelSummary({model_name:'basketball.pt',tracker:'BoT-SORT',
    device:'cuda:0',config:{conf:.10,with_reid:true,track_buffer:60},model_sha256:'abc123'},'篮球优化');
  assert.equal(summary.model,'basketball.pt');assert.equal(summary.tracker,'BoT-SORT');
  assert.equal(summary.device,'cuda:0');assert.equal(summary.variant,'篮球优化');
  assert(summary.details.some(d=>d.includes('0.1')));assert(summary.details.some(d=>d.includes('ReID')));
  assert.equal(trajectory.trackingModelSummary({},'原跟踪').model,'未提供模型信息');
  const nested=trajectory.trackingModelSummary({model:{name:'basketball.pt'},tracker:{name:'BoT-SORT'},
    device:{name:'NVIDIA RTX 5060',actual_model_parameter_device:'cuda:0'},detection:{conf:.1,iou:.5}},'优化');
  assert.equal(nested.device,'NVIDIA RTX 5060 · cuda:0');
  assert.equal(nested.model,'basketball.pt');
  assert(nested.details.some(d=>d.includes('0.1')));assert(nested.details.some(d=>d.includes('0.5')));
  const unknown=trajectory.trackingModelSummary({model:{unexpected:true},weights:{unexpected:true},
    tracker:{unexpected:true},device:{unexpected:true}},'优化');
  assert.equal(unknown.model,'未提供模型信息');assert.equal(unknown.device,'未提供设备信息');
});
