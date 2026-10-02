import test from 'node:test';
import assert from 'node:assert/strict';
import {personProposals,proposalLabel,visibleObjects,personTrail,indexTemporaryTracks,temporaryTrail,mergeSourceCuts,toggleReviewCut} from './tracking-display.mjs';
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
