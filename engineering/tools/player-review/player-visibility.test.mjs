import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession,buildTrajectories,exportReview,gapRanges,hasAssociation,isHumanIdentitySelected,
  playerVisibilityAt,setPlayerVisibility,confirmFrameIdentity} from './trajectory.mjs';
import {buildCourtTrajectories,courtGaps,pathSegments} from './court.mjs';
import {manualPathAnchors} from './manual-path.mjs';
import {trackingReviewState} from './tracking-display.mjs';
import {trackingDiagnostic} from './tracking-diagnostics.mjs';

function fixture(){
  const frames=Array.from({length:7},(_,frame)=>({frame,time:frame/10,tracks:[[10+frame,10,30+frame,80,1,.9]]}));
  const session=blankSession('visibility');
  session.entities[0].identityKeyframes=[{frame:0,kind:'track',trackId:1}];
  return {frames,session,entity:session.entities[0]};
}

test('offscreen intervals suppress image and court positions, interpolation and repair counts; preserve source evidence',()=>{
  const {frames,session,entity}=fixture();session.maxGapSeconds=1;
  entity.anchors=[{frame:2,x:25,y:80,trackId:1}];entity.courtAnchors=[{frame:3,x:8,y:5}];
  const evidence=structuredClone({frames,anchors:entity.anchors,identity:entity.identityKeyframes});
  setPlayerVisibility(session,'P1',1,4,'out_of_view',frames);
  const image=buildTrajectories(session,frames),court=buildCourtTrajectories(session,frames,image);
  for(let frame=1;frame<=4;frame++){
    const point=image.P1[frame];
    assert.equal(point.source,'out_of_view');assert.equal(point.x,null);assert.equal(point.y,null);
    assert.equal(point.observationState,'out_of_view');assert.equal(point.positionRequired,false);
    assert.equal(point.identityReviewRequired,false);assert.equal(point.frameIdentityConfirmed,false);
    assert.equal(court.P1[frame].x,null);assert.equal(court.P1[frame].source,'out_of_view');
    assert.equal(trackingReviewState(point).status,'out_of_view');
    assert.match(trackingDiagnostic(frames[frame],point).detail,/不计入待恢复缺口/);
  }
  assert.deepEqual(gapRanges(image.P1),[]);
  assert(courtGaps(court.P1).every(gap=>gap.end<1||gap.start>4));
  assert.deepEqual(pathSegments(image.P1).map(segment=>segment.map(point=>point.frame)),[[0],[5,6]]);
  assert.throws(()=>manualPathAnchors([{x:1,y:1},{x:40,y:20}],1,4,frames,image.P1),/没有缺失位置/);
  assert.throws(()=>confirmFrameIdentity(session,'P1',2,frames),/缺失、冲突和估计/);
  assert.deepEqual({frames,anchors:entity.anchors,identity:entity.identityKeyframes},evidence);
  const output=exportReview(session,{video_sha256:'visibility',width:100,height:100,frames},null);
  assert.deepEqual(output.entities[0].visibilityRanges,entity.visibilityRanges);
  assert.deepEqual(output.entities[0].unresolved,[]);
  assert.equal(output.entities[0].courtTrajectory[3].x,null);
});

test('an unseen player can be marked offscreen before their first observation without claiming an identity',()=>{
  const {frames,session}=fixture();
  setPlayerVisibility(session,'P2',0,3,'out_of_view',frames);
  const entity=session.entities[1],points=buildTrajectories(session,frames).P2;
  assert(hasAssociation(entity));assert.equal(isHumanIdentitySelected(entity),false);
  assert.equal(points[0].x,null);assert.equal(points[0].source,'out_of_view');
  assert.equal(points[4].source,'missing');assert.equal(points[4].observationState,'unknown');
  assert.deepEqual(gapRanges(points),[{start:4,end:6}]);
  const reloaded=JSON.parse(JSON.stringify(session));
  assert.deepEqual(buildTrajectories(reloaded,frames).P2,points);
});

test('occlusion remains a recovery gap by default, can use bounded estimates, and never bridges offscreen or cuts',()=>{
  const {frames,session}=fixture();
  setPlayerVisibility(session,'P1',2,3,'occluded',frames);
  let points=buildTrajectories(session,frames).P1;
  assert.deepEqual(gapRanges(points),[{start:2,end:3}]);
  assert.equal(points[2].observationState,'occluded');
  assert.match(trackingReviewState(points[2]).label,/待恢复/);
  assert.match(trackingDiagnostic(frames[2],points[2]).label,/待恢复追踪/);
  session.maxGapSeconds=.5;
  points=buildTrajectories(session,frames).P1;
  assert.equal(points[2].source,'interpolated');assert.deepEqual(points[2].supportFrames,[1,4]);
  assert.equal(points[2].observationState,'occluded');assert.equal(points[2].frameIdentityConfirmed,false);
  session.cuts=[3];assert.equal(buildTrajectories(session,frames).P1[2].x,null);
  session.cuts=[];setPlayerVisibility(session,'P1',3,3,'out_of_view',frames);
  points=buildTrajectories(session,frames).P1;
  assert.equal(points[2].x,null);assert.equal(points[3].source,'out_of_view');
});

test('normal recording restores only the chosen interval, including legacy exit records, without inventing missing positions',()=>{
  const {frames,session,entity}=fixture();
  setPlayerVisibility(session,'P1',1,5,'out_of_view',frames);
  setPlayerVisibility(session,'P1',3,4,'visible',frames);
  assert.deepEqual(entity.visibilityRanges.map(({start,end,state})=>[start,end,state]),[[1,2,'out_of_view'],[3,4,'visible'],[5,5,'out_of_view']]);
  const points=buildTrajectories(session,frames).P1;
  assert.equal(points[2].source,'out_of_view');assert.equal(points[3].source,'tracked');assert.equal(points[5].source,'out_of_view');
  entity.visibilityRanges=[];entity.bindings=[{kind:'out_of_view',start:1,end:6,trackId:null}];
  setPlayerVisibility(session,'P1',3,4,'visible',frames);
  assert.equal(buildTrajectories(session,frames).P1[3].source,'tracked');
  confirmFrameIdentity(session,'P1',3,frames);
  assert.equal(buildTrajectories(session,frames).P1[3].frameIdentityConfirmed,true);
  frames[3].tracks=[];
  assert.equal(buildTrajectories(session,frames).P1[3].x,null);
  assert.equal(buildTrajectories(session,frames).P1[3].observationState,'unknown');
  assert.equal(playerVisibilityAt(entity,3).state,'visible');
});

test('a missing observation is not automatically classified as offscreen; invalid edits are atomic',()=>{
  const {frames,session}=fixture();frames[2].tracks=[];
  const point=buildTrajectories(session,frames).P1[2];
  assert.equal(point.source,'missing');assert.equal(point.observationState,'unknown');
  const before=structuredClone(session);
  for(const [start,end,state] of [[-1,2,'out_of_view'],[4,2,'occluded'],[1,7,'visible'],[1,2,'wrong'],[1.5,2,'visible']])
    assert.throws(()=>setPlayerVisibility(session,'P1',start,end,state,frames));
  assert.deepEqual(session,before);
});

test('normal visibility never cancels a deliberate identity release and existing manual recovery evidence is retained',()=>{
  const {frames,session,entity}=fixture();
  entity.bindings=[{kind:'unassigned',start:1,end:3,trackId:null}];
  setPlayerVisibility(session,'P1',1,2,'visible',frames);
  assert.equal(buildTrajectories(session,frames).P1[1].reviewExcluded,true);
  entity.bindings=[];setPlayerVisibility(session,'P1',2,3,'occluded',frames);
  entity.anchors=[{frame:2,x:23,y:80,trackId:null,identityConfirmed:false}];
  const point=buildTrajectories(session,frames).P1[2];
  assert.equal(point.source,'manual');assert.equal(point.observationState,'occluded');
});
