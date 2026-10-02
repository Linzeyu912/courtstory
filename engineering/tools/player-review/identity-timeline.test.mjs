import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession,buildTrajectories,addBinding,confirmBinding,exportReview} from './trajectory.mjs';
import {confirmIdentity,migrateIdentitySession} from './identity-timeline.mjs';
import {editImageAnchor} from './image-edit.mjs';

const frames=Array.from({length:25},(_,frame)=>({frame,time:frame,
  tracks:[10,60,70,90].map((id,index)=>[index*100,10,index*100+40,100,id,.9,0])}));
const proposal=(id)=>({trackId:id,box:frames[0].tracks.find(box=>box[4]===id).slice(0,4)});
const select=(session,id,frame,track)=>confirmIdentity(session,id,frame,proposal(track),frames);

test('10 → 60 → 70 starts at each confirmation and leaves the earlier timeline identical',()=>{
  const s=blankSession('clip');select(s,'P1',0,10);
  const before=buildTrajectories(s,frames).P1;
  select(s,'P1',6,60);let points=buildTrajectories(s,frames).P1;
  assert.deepEqual(points.slice(0,6),before.slice(0,6));
  assert.equal(points[6].trackId,60);assert.equal(points[24].trackId,60);
  const middle=points;select(s,'P1',10,70);points=buildTrajectories(s,frames).P1;
  assert.deepEqual(points.slice(0,10),middle.slice(0,10));
  assert.equal(points[10].trackId,70);assert.equal(points[24].trackId,70);
});

test('a first selection never binds frames before it, even when its ID is visible there',()=>{
  const s=blankSession('clip');select(s,'P1',5,60);
  assert(buildTrajectories(s,frames).P1.slice(0,5).every(point=>point.source==='missing'));
});

test('a new selection overrides an old full-length range beyond its current frame',()=>{
  const s=blankSession('clip');addBinding(s.entities[0],{kind:'track',trackId:10,start:0,end:24},frames);
  const before=buildTrajectories(s,frames).P1;select(s,'P1',6,60);
  const points=buildTrajectories(s,frames).P1;
  assert.deepEqual(points.slice(0,6),before.slice(0,6));assert.equal(points[7].trackId,60);
});

test('an earlier correction preserves a later confirmation and stops at camera cuts',()=>{
  const s=blankSession('clip');s.cuts=[20];select(s,'P1',0,10);select(s,'P1',12,70);
  const before=buildTrajectories(s,frames).P1;const interval=select(s,'P1',6,60);
  const points=buildTrajectories(s,frames).P1;
  assert.deepEqual(interval,{start:6,end:11});assert.deepEqual(points.slice(12),before.slice(12));
  assert.equal(points[19].trackId,70);assert.equal(points[20].source,'missing');
});

test('claiming a misassigned ID clears only its competing interval and preserves other P4 segments',()=>{
  const s=blankSession('clip');select(s,'P1',0,10);select(s,'P4',0,60);select(s,'P4',12,90);
  const before=buildTrajectories(s,frames);select(s,'P1',6,60);const after=buildTrajectories(s,frames);
  assert.deepEqual(after.P4.slice(0,6),before.P4.slice(0,6));
  assert(after.P4.slice(6,12).every(point=>point.source==='missing'&&point.claimedBy==='P1'));
  assert.deepEqual(after.P4.slice(12),before.P4.slice(12));
  assert(after.P1.slice(6).every(point=>point.trackId===60));
  assert.equal(s.entities[3].identityKeyframes.length,2);
});

test('a later confirmation by another player reclaims the ID without altering the earlier claim',()=>{
  const s=blankSession('clip');select(s,'P4',0,60);select(s,'P4',12,60);select(s,'P1',6,60);
  const points=buildTrajectories(s,frames);
  assert.equal(points.P1[11].trackId,60);assert.equal(points.P4[11].source,'missing');
  assert.equal(points.P4[12].trackId,60);assert.equal(points.P1[12].source,'missing');
  select(s,'P1',12,60);
  assert.equal(buildTrajectories(s,frames).P1[12].trackId,60);
});

test('coordinate edits cannot create identity boundaries or retain positions tied to a replaced ID',()=>{
  const s=blankSession('clip');select(s,'P1',0,10);
  s.entities[0].anchors.push(editImageAnchor(buildTrajectories(s,frames).P1[8],8,{x:30,y:90},500,200));
  select(s,'P1',6,60);const points=buildTrajectories(s,frames).P1;
  assert.equal(s.entities[0].identityKeyframes.length,2);
  assert.equal(points[8].trackId,60);assert.equal(points[8].source,'tracked');assert.equal(points[8].x,120);
  s.entities[0].anchors.push(editImageAnchor(points[9],9,{x:130,y:90},500,200));
  assert.equal(buildTrajectories(s,frames).P1[10].trackId,60);
  assert.equal(s.entities[0].identityKeyframes.length,2);
});

test('finite range correction restores outside frames and respects later identity confirmations',()=>{
  const s=blankSession('clip');select(s,'P1',0,10);select(s,'P1',12,70);select(s,'P4',0,60);
  const before=buildTrajectories(s,frames);confirmBinding(s,'P1',{kind:'track',trackId:60,start:6,end:15},frames);
  const after=buildTrajectories(s,frames);
  assert.deepEqual(after.P1.slice(0,6),before.P1.slice(0,6));
  assert(after.P1.slice(6,12).every(point=>point.trackId===60));
  assert.deepEqual(after.P1.slice(12),before.P1.slice(12));
  assert.equal(after.P4[6].source,'missing');assert.equal(after.P4[12].trackId,60);
});

test('missing new ID never falls back to the previous ID or interpolates across the switch',()=>{
  const records=structuredClone(frames);records[7].tracks=records[7].tracks.filter(box=>box[4]!==60);
  records[4].tracks=[];records[5].tracks=[];
  const s=blankSession('clip');s.maxGapSeconds=10;select(s,'P1',0,10);select(s,'P1',6,60);
  const points=buildTrajectories(s,records).P1;
  assert.equal(points[4].source,'missing');assert.equal(points[5].source,'missing');
  s.maxGapSeconds=0;assert.equal(buildTrajectories(s,records).P1[7].source,'missing');
});

test('unnumbered selection stops an old identity; reentry supersedes out-of-view',()=>{
  const s=blankSession('clip');select(s,'P1',0,10);
  confirmIdentity(s,'P1',6,{trackId:null,box:[10,10,40,100]},frames);
  assert.equal(buildTrajectories(s,frames).P1[6].source,'manual');
  assert.equal(buildTrajectories(s,frames).P1[7].source,'missing');
  confirmBinding(s,'P1',{kind:'out_of_view',start:8,end:24},frames);select(s,'P1',12,70);
  assert.equal(buildTrajectories(s,frames).P1[10].source,'out_of_view');
  assert.equal(buildTrajectories(s,frames).P1[13].trackId,70);
});

test('legacy migration retains raw anchors and ranges, and export records the forward rule',()=>{
  const s=blankSession('clip');delete s.identityBindingMode;
  s.entities[0].anchors=[{frame:0,x:20,y:100,trackId:10},{frame:5,x:30,y:90,trackId:10},{frame:12,x:220,y:100,trackId:70}];
  addBinding(s.entities[0],{kind:'track',trackId:60,start:6,end:10},frames);
  const raw=structuredClone(s.entities[0]);migrateIdentitySession(s);
  assert.deepEqual(s.entities[0].anchors,raw.anchors);assert.deepEqual(s.entities[0].bindings,raw.bindings);
  assert.deepEqual(s.entities[0].identityKeyframes.map(key=>key.frame),[0,12]);
  const output=exportReview(s,{video_sha256:'clip',width:500,height:200,frames},'test');
  assert.equal(output.settings.identityBindingMode,'forward_only_v1');
  assert.equal(output.entities[0].identityKeyframes.length,2);
  assert.equal(output.allFramesManuallyVerified,false);
});
