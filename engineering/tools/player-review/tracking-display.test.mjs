import test from 'node:test';
import assert from 'node:assert/strict';
import {personProposals,proposalLabel,pickPersonProposal,visibleObjects,personTrail,indexTemporaryTracks,temporaryTrail,mergeSourceCuts,toggleReviewCut} from './tracking-display.mjs';
import {blankSession,buildTrajectories} from './trajectory.mjs';
import {confirmIdentity} from './identity-timeline.mjs';

const frames=Array.from({length:50},(_,frame)=>({frame,time:frame/30,tracks:[[frame,5,frame+10,30,1,.8,2]]}));
const points=frames.map(f=>({frame:f.frame,time:f.time,x:f.frame+5,y:30,source:'tracked',trackId:1}));

test('ball and hoop candidates never enter person selection; role conflicts remain visible',()=>{
  const frame={tracks:[[1,2,10,20,7,.91,3]],track_roles:{7:'referee'},role_conflicts:{7:[3]},
    objects:[{kind:'basketball',box:[3,4,8,9],groundPoint:false},{kind:'hoop',box:[10,20,40,30],groundPoint:false},{kind:'unknown',box:[0,0,1,1]},{kind:'hoop',box:[1,2,0,3]}]};
  const people=personProposals(frame);
  assert.equal(people.length,1);assert.equal(people[0].role,'referee');assert.match(proposalLabel(people[0]),/T7 · 裁判候选 · 角色待核对/);
  assert.equal(personProposals({...frame,role_conflicts:[{trackIds:[7,8],iou:.8}]})[0].roleConflict,true);
  assert.deepEqual(visibleObjects(frame).map(o=>o.kind),['basketball','hoop']);
});

test('all detector partitions remain selectable evidence without assigning suppressed boxes a T',()=>{
  const record={tracks:[[1,2,10,20,7,.91,2]],pending_detections:[[20,2,30,20,.01,2]],
    suppressed_detections:[[1,2,11,21,.65,2]],track_evidence:{7:{raw_detection_index:2,source:'detection'}},
    detection_indices:{tracks:[2],pending_detections:[0],suppressed_detections:[1]}};
  const original=structuredClone(record),people=personProposals(record,{7:'player'});
  assert.equal(people.length,3,'even very low confidence pending and suppressed records stay available');
  assert.deepEqual(people.map(p=>[p.sourcePartition,p.sourceIndex,p.detectionIndex,p.detectionObserved,p.suppressed,p.trackId]),[
    ['tracks',0,2,true,false,7],['pending_detections',0,0,true,false,null],['suppressed_detections',0,1,true,true,null]]);
  assert.equal(people[0].evidenceSource,'detection');assert.equal(people[0].classId,2);
  assert.match(proposalLabel(people[0]),/检测已跟踪/);
  assert.match(proposalLabel(people[1]),/检测未跟踪/);
  assert.match(proposalLabel(people[2]),/检测已抑制/);
  assert.deepEqual(record,original);
});

test('legacy track geometry has limited detector evidence and partition indices never impersonate raw indices',()=>{
  const record={tracks:[[1,2,10,20,7,.91,0]],pending_detections:[[20,2,30,20,.5,0]],
    suppressed_detections:[[1,2,11,21,.65,0]]};
  const proposals=personProposals(record);
  assert.equal(proposals[0].detectionObserved,false);assert.match(proposalLabel(proposals[0]),/检测证据有限/);
  assert.ok(proposals.every(p=>p.detectionIndex===null));
  assert.ok(proposals.slice(1).every(p=>p.detectionObserved&&p.trackId===null));
  assert.equal(personProposals(record,{}, {schema_version:1,raw_coordinates:true})[0].detectionObserved,true);
  assert.deepEqual(personProposals(null),[]);
  assert.deepEqual(personProposals({tracks:[null,[1,2,10,20,7,NaN,0]],pending_detections:[[]]}),[]);
});

test('a suppressed duplicate cannot steal the real sample 004 frame 32 click from T7',()=>{
  const proposals=personProposals({tracks:[
    [117.72728,316.363647,212.72728,502.727295,7,.8,2],
    [39.318184,293.636383,167.72728,460.909119,8,.8,2]],
    pending_detections:[],suppressed_detections:[[106.25,290,172.840912,461.363647,.6,2]]});
  const before=structuredClone(proposals),point=[139.545456,375.6818235];
  assert.equal(pickPersonProposal(proposals,...point).trackId,7);
  assert.equal(pickPersonProposal(proposals.filter(p=>p.suppressed),...point),null,
    'suppressed-only hits must direct the user to the explicit list selection');
  assert.equal(pickPersonProposal([{...proposals[2],suppressed:false}],...point),null,
    'source partition also protects older proposals without the boolean flag');
  assert.deepEqual(proposals,before);
});

test('tracked boxes outrank pending boxes; the smallest box wins only within the same priority',()=>{
  const pendingSmall={box:[4,4,6,6],trackId:null,sourcePartition:'pending_detections'};
  const pendingLarge={box:[0,0,10,10],trackId:null,sourcePartition:'pending_detections'};
  const trackLarge={box:[0,0,30,30],trackId:1,sourcePartition:'tracks'};
  const trackSmall={box:[0,0,20,20],trackId:2,sourcePartition:'tracks'};
  assert.equal(pickPersonProposal([pendingSmall,trackLarge,trackSmall],5,5),trackSmall);
  assert.equal(pickPersonProposal([pendingLarge,pendingSmall],5,5),pendingSmall);
  assert.equal(pickPersonProposal([pendingSmall,trackLarge],5,5),trackLarge);
  assert.equal(pickPersonProposal([trackSmall,{...trackSmall,trackId:3}],5,5),trackSmall,'equal areas retain list order');
});

test('candidate hit testing rejects empty, malformed and out-of-frame targets',()=>{
  assert.equal(pickPersonProposal(null,5,5),null);
  assert.equal(pickPersonProposal([],5,5),null);
  const candidates=[null,{box:null},{box:[0,0,NaN,10]},{box:[10,10,0,0]},{box:[0,0,10,10],trackId:1}];
  assert.equal(pickPersonProposal(candidates,20,20),null);
  assert.equal(pickPersonProposal(candidates,NaN,5),null);
  assert.equal(pickPersonProposal(candidates,10,10),candidates.at(-1),'box edges remain clickable');
});

test('temporary tails stop at missing observations, cuts, time gaps and implausible jumps',()=>{
  const data=structuredClone(frames);data[44].tracks=[];
  let index=indexTemporaryTracks(data);
  assert.deepEqual(temporaryTrail(index,data,1,49).map(p=>p.frame),[45,46,47,48,49]);
  assert.deepEqual(temporaryTrail(index,data,1,49,[48]).map(p=>p.frame),[48,49]);
  assert.equal(temporaryTrail(index,data,1,44).length,0);
  data[48].time=data[47].time+.001;data[49].time=data[48].time+.001;
  data[49].tracks[0][0]=1000;data[49].tracks[0][2]=1010;index=indexTemporaryTracks(data);
  assert.deepEqual(temporaryTrail(index,data,1,49).map(p=>p.frame),[49]);
  data[49].time=3;
  assert.equal(temporaryTrail(index,data,1,49).length,1);
});

test('fixed player tails retain a continuous confirmed identity across temporary ID changes',()=>{
  const confirmed=structuredClone(points);confirmed[48].trackId=22;confirmed[48].source='manual';confirmed[49].trackId=22;
  const tail=personTrail(confirmed,frames,49);
  assert.equal(tail.at(-1).trackId,22);assert.ok(tail.some(p=>p.trackId===1));
  assert.ok(tail.at(-1).time-tail[0].time<=1.2);
  for(const source of ['missing','conflict','interpolated','manual_path','out_of_view']){
    confirmed[48].source=source;
    assert.deepEqual(personTrail(confirmed,frames,49).map(p=>p.frame),[49]);
    assert.equal(personTrail(confirmed,frames,48).length,0);
  }
});

test('loading or undoing an old draft restores source joins; only manual cuts can be removed',()=>{
  const clipFrames=frames.slice(0,4).map((record,i)=>({...record,source_frame:i<2?i:i+98}));
  const sourceCuts=[2],session=blankSession('joined-source');
  session.entities[0].anchors=[{frame:0,x:5,y:30,trackId:1}];
  // Both the old stored draft and an old undo snapshot can lack the fixed join.
  for(const restored of [[],[1,1,NaN,-1,99]]){
    session.cuts=mergeSourceCuts(restored,sourceCuts,clipFrames.length);
    assert.ok(session.cuts.includes(2));
    session.cuts=toggleReviewCut(session.cuts,sourceCuts,2,clipFrames.length);
    assert.ok(session.cuts.includes(2));
    if(session.cuts.includes(1))session.cuts=toggleReviewCut(session.cuts,sourceCuts,1,clipFrames.length);
    assert.deepEqual(session.cuts,[2]);
    const trajectory=buildTrajectories(session,clipFrames).P1;
    assert.deepEqual(trajectory.map(p=>p.source),['manual','tracked','missing','missing']);
    assert.deepEqual(temporaryTrail(indexTemporaryTracks(clipFrames),clipFrames,1,3,session.cuts).map(p=>p.frame),[2,3]);
  }
  // A new identity confirmation can resume P1 after the join, without drawing across it.
  confirmIdentity(session,'P1',2,{box:[2,5,12,30],trackId:1},clipFrames);
  assert.deepEqual(personTrail(buildTrajectories(session,clipFrames).P1,clipFrames,3,session.cuts).map(p=>p.frame),[2,3]);
  assert.deepEqual(toggleReviewCut([2],sourceCuts,1,4),[1,2]);
});
