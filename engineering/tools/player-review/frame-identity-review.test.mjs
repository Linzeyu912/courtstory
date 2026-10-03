import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {blankSession,buildTrajectories,confirmFrameIdentity,correctFrameIdentity,confirmBinding,exportReview,isHumanIdentitySelected,playerDisplayState} from './trajectory.mjs';
import {confirmIdentity,confirmUntrackedFrame} from './identity-timeline.mjs';
import {teamOverlayStyle} from './team-overlay.mjs';

const policy=JSON.parse(readFileSync(new URL('./team-overlay-policy.json',import.meta.url),'utf8'));
const frames=Array.from({length:5},(_,frame)=>({frame,time:frame/25,
  tracks:[[10,10,30,80,1,.9,2],[50,10,70,80,2,.9,2]]}));
const bulk=entity=>entity.bindings=[{kind:'track',trackId:1,start:0,end:4,scope:'track_occurrences',
  order:3,selectionFrame:2,exclusive:false,origin:'human_track_assignment'}];
const styles=(entity,points)=>points.map(point=>teamOverlayStyle(entity,point,policy).dashed);

test('a whole-T click confirms only its selected observation and later reviewed frames accumulate independently',()=>{
  const session=blankSession('clip'),entity=session.entities[0];bulk(entity);
  entity.frameConfirmations=[{frame:2,trackId:1,identityScope:'track_occurrences',identityOrder:3,origin:'human_track_selection'}];
  let points=buildTrajectories(session,frames).P1;
  assert.deepEqual(points.map(point=>point.frameIdentityConfirmed),[false,false,true,false,false]);
  assert.deepEqual(styles(entity,points),[true,true,false,true,true]);
  confirmFrameIdentity(session,'P1',4,frames);points=buildTrajectories(session,frames).P1;
  assert.deepEqual(points.map(point=>point.identityConfirmed),[false,false,true,false,true]);
  assert.equal(session.entities[0].bindings[0].end,4);
  const output=exportReview(session,{video_sha256:'clip',width:100,height:100,frames},'test');
  assert.equal(output.allFramesManuallyVerified,false);
  assert.deepEqual(output.entities[0].trajectory.map(point=>point.identityConfirmed),[false,false,true,false,true]);
});

test('direct candidate selection and legacy explicit anchors are solid on their own frame only',()=>{
  const session=blankSession('clip'),entity=session.entities[0];
  confirmIdentity(session,'P1',1,{trackId:1,box:[10,10,30,80]},frames);
  let points=buildTrajectories(session,frames).P1;
  assert.deepEqual(styles(entity,points),[true,false,true,true,true]);
  delete entity.anchors[0].identityReviewOrder;delete entity.anchors[0].identityReviewSource;
  points=buildTrajectories(session,frames).P1;
  assert.equal(points[1].frameIdentityConfirmed,true);assert.equal(points[2].frameIdentityConfirmed,false);
  entity.anchors[0].identityConfirmed=false;
  assert.equal(buildTrajectories(session,frames).P1[1].frameIdentityConfirmed,false);
});

test('reviewing a model suggestion changes only that frame without promoting the whole model track',()=>{
  const session=blankSession('clip'),entity=session.entities[0];
  entity.modelBindings=[{kind:'track',trackId:1,start:0,end:4,method:'model'}];
  const model=structuredClone(entity.modelBindings);assert.equal(isHumanIdentitySelected(entity),false);
  confirmFrameIdentity(session,'P1',2,frames);
  assert.equal(isHumanIdentitySelected(entity),true);assert.deepEqual(entity.modelBindings,model);
  let points=buildTrajectories(session,frames).P1;
  assert.deepEqual(styles(entity,points),[true,true,false,true,true]);
  assert.equal(teamOverlayStyle(entity,points[2],policy).label,'1');
  assert.deepEqual(playerDisplayState(entity,points[2]),{status:'tracked',label:'当前帧人物已确认',identity:'human_locked'});
  assert.equal(points[2].identitySource,'model_suggestion');
  entity.modelBindings[0].trackId=2;
  points=buildTrajectories(session,frames).P1;
  assert.equal(points[2].frameIdentityConfirmed,false);assert.equal(isHumanIdentitySelected(entity),false);
});

test('a standalone manual point needs explicit identity review and a changed point invalidates that review',()=>{
  const session=blankSession('clip'),entity=session.entities[0];
  entity.anchors=[{frame:2,x:37,y:75,trackId:null,identityConfirmed:false,footMethod:'human_image_anchor'}];
  assert.equal(buildTrajectories(session,frames).P1[2].frameIdentityConfirmed,false);
  const review=confirmFrameIdentity(session,'P1',2,frames);
  assert.equal(review.identityScope,'manual_position');assert.equal(review.trackId,null);
  assert.equal(buildTrajectories(session,frames).P1[2].frameIdentityConfirmed,true);
  entity.anchors[0].x=38;
  assert.equal(buildTrajectories(session,frames).P1[2].frameIdentityConfirmed,false);
  assert.equal(entity.anchors[0].identityConfirmed,false,'a frame review does not rewrite coordinate provenance');
});

test('a new effective identity or binding order cannot inherit an earlier frame confirmation',()=>{
  const session=blankSession('clip'),entity=session.entities[0];bulk(entity);
  confirmFrameIdentity(session,'P1',2,frames);
  entity.bindings[0].order=4;
  assert.equal(buildTrajectories(session,frames).P1[2].frameIdentityConfirmed,false);
  confirmFrameIdentity(session,'P1',2,frames);
  confirmBinding(session,'P1',{kind:'track',trackId:2,start:1,end:4},frames);
  const point=buildTrajectories(session,frames).P1[2];
  assert.equal(point.trackId,2);assert.equal(point.frameIdentityConfirmed,false);
  const other=blankSession('clip');
  confirmIdentity(other,'P1',2,{trackId:1,box:[10,10,30,80]},frames);
  confirmBinding(other,'P1',{kind:'track',trackId:1,start:2,end:4},frames);
  assert.equal(buildTrajectories(other,frames).P1[2].frameIdentityConfirmed,false,
    'a fresh explicit correction cannot inherit an older anchor review even for the same numeric T');
});

test('estimated paths, missing observations and released identities never become solid or confirmable',()=>{
  for(const source of ['manual_path','interpolated']){
    const style=teamOverlayStyle({id:'P1'}, {source,frameIdentityConfirmed:true},policy);
    assert.equal(style.dashed,true);
  }
  const session=blankSession('clip'),entity=session.entities[0];bulk(entity);
  entity.anchors=[{frame:2,x:20,y:80,trackId:1,source:'manual_path',identityConfirmed:false}];
  assert.throws(()=>confirmFrameIdentity(session,'P1',2,frames),/估计/);
  entity.anchors=[];confirmFrameIdentity(session,'P1',2,frames);
  entity.bindings.push({kind:'unassigned',trackId:null,start:2,end:3,order:4});
  assert.equal(buildTrajectories(session,frames).P1[2].frameIdentityConfirmed,false);
  assert.throws(()=>confirmFrameIdentity(session,'P1',2,frames),/缺失/);
});

test('frame review cannot displace another explicitly assigned person and losing points remain unconfirmed',()=>{
  const session=blankSession('clip');bulk(session.entities[0]);
  session.entities[0].frameConfirmations=[{frame:2,trackId:1,identityScope:'track_occurrences',identityOrder:3,origin:'human_track_selection'}];
  confirmIdentity(session,'P2',0,{trackId:1,box:[10,10,30,80]},frames);
  const points=buildTrajectories(session,frames);
  assert.equal(points.P1[2].claimedBy,'P2');assert.equal(points.P1[2].frameIdentityConfirmed,false);
  assert.equal(points.P2[0].frameIdentityConfirmed,true);assert.equal(points.P2[2].frameIdentityConfirmed,false);
});

test('one reviewed bulk observation wins only on that frame while two reviewed claimants stay conflicted',()=>{
  const session=blankSession('clip');bulk(session.entities[0]);bulk(session.entities[1]);
  const review={frame:2,trackId:1,identityScope:'track_occurrences',identityOrder:3,origin:'human_track_selection'};
  session.entities[0].frameConfirmations=[review];
  let points=buildTrajectories(session,frames);
  assert.equal(points.P1[2].frameIdentityConfirmed,true);assert.equal(points.P2[2].claimedBy,'P1');
  assert.equal(points.P1[1].source,'conflict');assert.equal(points.P2[1].source,'conflict');
  session.entities[1].frameConfirmations=[{...review}];points=buildTrajectories(session,frames);
  for(const id of ['P1','P2']){
    assert.equal(points[id][2].source,'conflict');assert.equal(points[id][2].frameIdentityConfirmed,false);
  }
});

test('splitting the same bulk assignment at a new cut preserves its frame review',()=>{
  const session=blankSession('clip'),entity=session.entities[0];bulk(entity);
  confirmFrameIdentity(session,'P1',3,frames);
  const original=entity.bindings[0];session.cuts=[2];
  entity.bindings=[{...original,end:1},{...original,start:2}];
  assert.equal(buildTrajectories(session,frames).P1[3].frameIdentityConfirmed,true);
  assert.equal(buildTrajectories(session,frames).P1[2].frameIdentityConfirmed,false);
});

test('an untracked fallback confirms only its own frame and preserves earlier and later tracked identities',()=>{
  const session=blankSession('clip'),entity=session.entities[0];
  confirmIdentity(session,'P1',0,{trackId:1,box:[10,10,30,80]},frames);
  const before=buildTrajectories(session,frames).P1,keys=structuredClone(entity.identityKeyframes),raw=structuredClone(frames);
  assert.deepEqual(confirmUntrackedFrame(session,'P1',2,{trackId:null,box:[51,12,71,81],sourcePartition:'suppressed_detections'},frames),
    {start:2,end:2});
  const points=buildTrajectories(session,frames).P1;
  assert.equal(points[2].source,'manual');assert.equal(points[2].trackId,null);
  assert.equal(points[2].frameIdentityConfirmed,true);assert.deepEqual(points[2].box,[51,12,71,81]);
  assert.deepEqual(points.slice(0,2),before.slice(0,2));assert.deepEqual(points.slice(3),before.slice(3));
  assert.deepEqual(entity.identityKeyframes,keys);assert.deepEqual(frames,raw);
});

test('an untracked fallback can repair a conflicting frame without resolving or removing neighboring conflicts',()=>{
  const session=blankSession('clip'),entity=session.entities[0];bulk(entity);
  entity.bindings.push({...entity.bindings[0],trackId:2,order:4});
  assert.equal(buildTrajectories(session,frames).P1[2].source,'conflict');
  confirmUntrackedFrame(session,'P1',2,{trackId:null,box:[51,12,71,81]},frames);
  const points=buildTrajectories(session,frames).P1;
  assert.equal(points[2].frameIdentityConfirmed,true);assert.equal(points[2].trackId,null);
  assert.equal(points[1].source,'conflict');assert.equal(points[3].source,'conflict');
  const before=structuredClone(session);
  assert.throws(()=>confirmUntrackedFrame(session,'P1',3,{trackId:2,box:[51,12,71,81]},frames));
  assert.deepEqual(session,before);
});

test('P8 can explicitly correct overlapping whole-T claims on one frame and obtain a solid blue box',()=>{
  const ids=[2,7,8,9,10,12,55],records=frames.map(record=>({...record,
    tracks:ids.map(id=>[id*10,10,id*10+8,80,id,.9,2])}));
  const session=blankSession('clip'),entity=session.entities[7];
  for(const item of session.entities)item.identityKeyframes=[];
  entity.bindings=ids.map((id,index)=>({kind:'track',trackId:id,start:0,end:4,
    scope:'track_occurrences',order:index+1,exclusive:false,origin:'human_track_assignment'}));
  const before=structuredClone(session),raw=structuredClone(records);
  assert(buildTrajectories(session,records).P8.every(point=>point.source==='conflict'));
  assert.deepEqual(correctFrameIdentity(session,'P8',2,{trackId:8},records),{start:2,end:2});
  const points=buildTrajectories(session,records).P8,style=teamOverlayStyle(entity,points[2],policy);
  assert.equal(points[2].trackId,8);assert.deepEqual(points[2].box,[80,10,88,80]);
  assert.equal(points[2].frameIdentityConfirmed,true);assert.equal(style.dashed,false);
  assert.equal(style.group,'B');
  for(const index of [0,1,3,4])assert.equal(points[index].source,'conflict');
  assert.deepEqual(session.entities[7].bindings.slice(0,ids.length),before.entities[7].bindings);
  assert.deepEqual(session.entities.slice(0,7),before.entities.slice(0,7));
  assert.deepEqual(records,raw);
  const restored=JSON.parse(JSON.stringify(session));
  assert.deepEqual(buildTrajectories(restored,records),buildTrajectories(session,records));
});

test('explicit single-frame ownership correction releases a competing player only on that frame',()=>{
  const session=blankSession('clip');
  confirmIdentity(session,'P7',0,{trackId:1,box:[10,10,30,80]},frames);
  bulk(session.entities[7]);const before=buildTrajectories(session,frames),saved=structuredClone(session);
  assert.equal(before.P8[2].claimedBy,'P7');
  correctFrameIdentity(session,'P8',2,{trackId:1},frames);
  const after=buildTrajectories(session,frames);
  assert.equal(after.P8[2].frameIdentityConfirmed,true);assert.equal(after.P7[2].claimedBy,'P8');
  for(const id of ['P7','P8'])for(const index of [0,1,3,4])assert.deepEqual(after[id][index],before[id][index]);
  assert.deepEqual(session.entities[6],saved.entities[6],'the competing player keeps its stored evidence');
  assert.deepEqual(buildTrajectories(saved,frames),before,'undo restores prior ownership');
});

test('single-frame correction preserves same-track manual geometry and replaces unrelated or estimated points',()=>{
  for(const [trackId,source,preserve] of [[1,undefined,true],[2,undefined,false],[null,undefined,false],[1,'manual_path',false]]){
    const session=blankSession('clip'),entity=session.entities[7];bulk(entity);
    entity.anchors=[{frame:2,x:55,y:75,box:[50,10,60,80],trackId,source,identityConfirmed:false}];
    entity.courtAnchors=[{frame:2,x:4,y:5}];const saved=structuredClone(entity);
    correctFrameIdentity(session,'P8',2,{trackId:1},frames);
    const point=buildTrajectories(session,frames).P8[2];
    assert.equal(point.trackId,1);assert.equal(point.frameIdentityConfirmed,true);
    assert.equal(point.x,preserve?55:20);assert.equal(point.source,preserve?'manual':'tracked');
    assert.deepEqual(session.entities[7].courtAnchors,saved.courtAnchors);
    assert.deepEqual(entity,saved,'edits are committed from a copy after validation');
  }
});

test('single-frame correction can be changed again and invalid requests leave the draft intact',()=>{
  const session=blankSession('clip');bulk(session.entities[7]);
  correctFrameIdentity(session,'P8',2,{trackId:1},frames);
  correctFrameIdentity(session,'P8',2,{trackId:2},frames);
  const points=buildTrajectories(session,frames).P8;
  assert.deepEqual(points.map(point=>point.trackId),[1,1,2,1,1]);
  assert.deepEqual(points.map(point=>point.frameIdentityConfirmed),[false,false,true,false,false]);
  assert.equal(session.entities[7].frameConfirmations.length,1);
  const before=structuredClone(session);
  for(const [id,frame,proposal] of [['P11',2,{trackId:1}],['P8',8,{trackId:1}],['P8',2,{trackId:99}],['P8',2,{trackId:null}]]){
    assert.throws(()=>correctFrameIdentity(session,id,frame,proposal,frames));assert.deepEqual(session,before);
  }
});
