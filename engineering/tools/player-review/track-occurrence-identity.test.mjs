import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession,buildTrajectories,exportReview,isHumanIdentitySelected,playerDisplayState,reviewTrailCuts} from './trajectory.mjs';
import {confirmIdentity,identityAt,identityInterval,identityConfirmationInterval} from './identity-timeline.mjs';
import {initializeAutomaticAnnotations,automaticAnnotationPointVisible} from './automatic-annotations.mjs';
import {personTrail} from './tracking-display.mjs';
import {pathSegments} from './court.mjs';

const records=ids=>ids.map((values,frame)=>({frame,time:frame/25,
  tracks:values.map(id=>[id*20,10,id*20+15,80,id,.8,2])}));
const bulk=(entity,trackId,start,end,selectionFrame=start,order=1)=>{
  entity.bindings||=[];
  entity.bindings.push({kind:'track',trackId,start,end,scope:'track_occurrences',
    origin:'human_track_assignment',selectionFrame,order,exclusive:false,reviewRequired:true});
};
const confirm=(session,frames,id,frame,trackId)=>confirmIdentity(session,id,frame,
  {trackId,box:frames[frame].tracks.find(box=>box[4]===trackId).slice(0,4)},frames);

test('a whole-track assignment covers earlier and later observations without filling its gaps',()=>{
  const frames=records([[1],[1],[],[1],[1]]),session=blankSession('video'),entity=session.entities[0];
  bulk(entity,1,0,1,3);bulk(entity,1,3,4,3);
  const points=buildTrajectories(session,frames).P1;
  assert.deepEqual(points.map(point=>point.x!=null),[true,true,false,true,true]);
  assert.equal(points[0].associationScope,'track_occurrences');
  assert.equal(points[0].selectionFrame,3);
  assert.equal(points[0].identityConfirmed,false);assert.equal(points[0].reviewRequired,true);
  assert.equal(isHumanIdentitySelected(entity),true);
  assert.equal(playerDisplayState(entity,points[0]).label,'整段归并 · 待逐帧核对');
  assert.deepEqual(entity.anchors,[],'track assignment does not manufacture hand-edited points');
});

test('several temporary IDs accumulate in one player and leave unrelated frames empty',()=>{
  const frames=records([[1],[1],[2],[2],[],[3]]),session=blankSession('video'),entity=session.entities[0];
  bulk(entity,1,0,1,1);bulk(entity,2,2,3,3,2);bulk(entity,3,5,5,5,3);
  const points=buildTrajectories(session,frames).P1;
  assert.deepEqual(points.map(point=>point.trackId??null),[1,1,2,2,null,3]);
  assert.equal(points[4].source,'missing');
});

test('a new whole-track claim fills legacy forward gaps but protects its existing observations',()=>{
  const frames=records([[1],[1,2],[2],[1,2]]),session=blankSession('video');
  confirm(session,frames,'P1',0,1);bulk(session.entities[0],2,1,3,2);
  const points=buildTrajectories(session,frames).P1;
  assert.deepEqual(points.map(point=>point.trackId),[1,1,2,1]);
  assert.equal(points[2].identitySource,'manual_track_occurrences');
  assert.equal(points[3].identitySource,'manual_forward');
  assert.equal(identityAt(session.entities[0],2,[],new Set([2])).trackId,2);
  assert.equal(identityAt(session.entities[0],2,[],new Map([['2',[]]])).trackId,2);
});

test('legacy hand-edited positions survive absent detections when another T is assigned',()=>{
  const frames=records([[1],[2],[2]]),session=blankSession('video'),entity=session.entities[0];
  confirm(session,frames,'P1',0,1);
  entity.anchors.push({frame:1,x:777,y:88,trackId:1,identityConfirmed:false});
  bulk(entity,2,1,2,2);
  const points=buildTrajectories(session,frames).P1;
  assert.equal(points[1].source,'manual');assert.equal(points[1].x,777);
  assert.equal(points[1].trackId,1);assert.equal(points[2].trackId,2);
});

test('a coordinate edit over a model proposal remains independent of a new whole-track claim',()=>{
  const frames=records([[1,2]]),session=blankSession('video'),entity=session.entities[0];
  entity.identityKeyframes=[];
  entity.modelBindings=[{kind:'track',trackId:1,start:0,end:0}];
  entity.anchors=[{frame:0,x:888,y:99,trackId:1,identityConfirmed:false}];bulk(entity,2,0,0);
  const point=buildTrajectories(session,frames).P1[0];
  assert.equal(point.source,'manual');assert.equal(point.x,888);assert.equal(point.trackId,null);
});

test('a legacy standalone foot or box edit keeps exact geometry and detector evidence after whole-track assignment',()=>{
  const frames=records([[2]]),session=blankSession('video'),entity=session.entities[0];
  const anchor={frame:0,x:321.125,y:76.75,trackId:1,identityConfirmed:false,
    box:[300,10,345,80],detectorBox:[290,8,349,84],boxMethod:'human_box_resize',
    footMethod:'human_image_anchor',groundContactConfirmed:false};
  entity.anchors=[anchor];bulk(entity,2,0,0);
  const before=structuredClone(session),point=buildTrajectories(session,frames).P1[0];
  assert.equal(point.source,'manual');assert.equal(point.trackId,null);
  assert.deepEqual([point.x,point.y],[anchor.x,anchor.y]);
  assert.deepEqual(point.box,anchor.box);assert.deepEqual(point.detectorBox,anchor.detectorBox);
  assert.equal(point.boxMethod,anchor.boxMethod);assert.equal(point.groundContactConfirmed,false);
  assert.deepEqual(session,before,'rendering preserves the saved human edit');
});

test('explicit range corrections, cancellation and out-of-view records outrank whole-track claims',()=>{
  for(const kind of ['track','unassigned','out_of_view']){
    const frames=records([[2],[2]]),session=blankSession('video'),entity=session.entities[0];
    bulk(entity,2,0,1);
    entity.bindings.push({kind,trackId:kind==='track'?1:null,start:0,end:1,order:2,exclusive:true});
    const point=buildTrajectories(session,frames).P1[0];
    assert.equal(point.x,null,kind);
    assert.equal(point.source,kind==='out_of_view'?'out_of_view':'missing',kind);
    if(kind==='unassigned')assert.equal(point.reviewExcluded,true);
  }
});

test('two assigned T IDs visible in the same frame remain a reviewable conflict',()=>{
  const frames=records([[1],[1,2],[2]]),session=blankSession('video'),entity=session.entities[0];
  bulk(entity,1,0,1);bulk(entity,2,1,2,2,9);
  const points=buildTrajectories(session,frames).P1;
  assert.equal(points[0].trackId,1);assert.equal(points[2].trackId,2);
  assert.equal(points[1].source,'conflict');assert.equal(points[1].x,null);
  assert.deepEqual(points[1].candidateTrackIds,[1,2]);assert.equal(points[1].reviewRequired,true);
});

test('duplicate claims of the same T for one player do not create a false conflict',()=>{
  const frames=records([[1]]),session=blankSession('video'),entity=session.entities[0];
  bulk(entity,1,0,0);bulk(entity,1,0,0,0,2);
  assert.equal(buildTrajectories(session,frames).P1[0].trackId,1);
});

test('two players claiming the same whole track cannot silently evict each other',()=>{
  const frames=records([[1],[1]]),session=blankSession('video');
  bulk(session.entities[0],1,0,1,0,1);bulk(session.entities[1],1,0,1,1,99);
  const points=buildTrajectories(session,frames);
  for(const id of ['P1','P2'])for(const point of points[id]){
    assert.equal(point.source,'conflict');assert.equal(point.x,null);
    assert.equal(point.reviewRequired,true);assert.deepEqual(point.candidateTrackIds,[1]);
  }
});

test('existing explicit human ownership wins over a later whole-track assignment',()=>{
  const frames=records([[1],[1],[1]]),session=blankSession('video');
  confirm(session,frames,'P1',0,1);bulk(session.entities[1],1,1,2,2,99);
  const points=buildTrajectories(session,frames);
  assert(points.P1.every(point=>point.x!=null));
  assert.equal(points.P2[1].source,'missing');assert.equal(points.P2[1].claimedBy,'P1');
  assert.equal(points.P2[1].assignmentBlockedByHuman,true);
});

test('whole-track human assignments supersede model proposals without marking frames verified',()=>{
  const frames=records([[1]]),session=blankSession('video');
  session.entities[0].modelBindings=[{kind:'track',trackId:1,start:0,end:0}];
  bulk(session.entities[1],1,0,0);
  const points=buildTrajectories(session,frames);
  assert.equal(points.P2[0].trackId,1);assert.equal(points.P1[0].claimedBy,'P2');
  const output=exportReview(session,{video_sha256:'video',width:500,height:100,frames},'test');
  assert.equal(output.allFramesManuallyVerified,false);
  assert.equal(output.entities.find(entity=>entity.id==='P2').trajectory[0].identityConfirmed,false);
});

test('cut boundaries split whole-track observations and cancellation ends with the occurrence segment',()=>{
  const frames=records([[1],[1],[1],[1],[],[2]]),session=blankSession('video'),entity=session.entities[0];
  session.cuts=[2];bulk(entity,1,0,1,3);bulk(entity,1,2,3,3);bulk(entity,2,5,5);
  const points=buildTrajectories(session,frames).P1;
  assert(points.slice(0,4).every(point=>point.x!=null));
  assert.deepEqual(identityInterval(session,entity,2,frames.length),{start:2,end:3});
  assert.equal(points[4].source,'missing');
});

test('adding a camera cut preserves every assigned observation while splitting image and 2D paths',()=>{
  const frames=records([[1],[1],[1],[1],[1]]),session=blankSession('video'),entity=session.entities[0];
  bulk(entity,1,0,4,3);
  const before=buildTrajectories(session,frames).P1;
  session.cuts=[2];
  const points=buildTrajectories(session,frames).P1;
  assert.deepEqual(points,before,'a new cut does not erase already assigned observations');
  assert(points.every(point=>point.trackId===1&&point.x!=null));
  const cuts=reviewTrailCuts([entity],session.cuts,frames.length);
  assert.deepEqual(personTrail(points,frames,4,cuts).map(point=>point.frame),[2,3,4]);
  assert.deepEqual(pathSegments(points,cuts).map(segment=>segment.map(point=>point.frame)),[[0,1],[2,3,4]]);
  assert.deepEqual(identityInterval(session,entity,0,frames.length),{start:0,end:1});
  assert.deepEqual(identityInterval(session,entity,2,frames.length),{start:2,end:4});
});

test('forward confirmation reports its full actual scope rather than ending at lower-priority bulk boundaries',()=>{
  const frames=records(Array.from({length:6},()=>[1,2,3])),session=blankSession('video'),entity=session.entities[0];
  bulk(entity,1,0,2);bulk(entity,2,3,5);
  const interval=confirm(session,frames,'P1',1,3),points=buildTrajectories(session,frames).P1;
  assert.deepEqual(interval,{start:1,end:5});
  assert.deepEqual(identityConfirmationInterval(session,entity,1,frames.length),interval);
  assert(points.slice(interval.start,interval.end+1).every(point=>point.trackId===3));
  assert.equal(points[0].trackId,1);
  assert.deepEqual(identityInterval(session,entity,1,frames.length),{start:1,end:2},
    'release retains its finer observation-segment boundary');
  entity.bindings.push({kind:'track',trackId:2,start:4,end:5,exclusive:true,order:99});
  assert.deepEqual(identityConfirmationInterval(session,entity,1,frames.length),{start:1,end:3});
  assert.deepEqual(buildTrajectories(session,frames).P1.map(point=>point.trackId),[1,3,3,3,2,2]);
});

test('automatic recovery respects accumulated assignments and preserves conflicting observations for review',()=>{
  const frames=records([[1,2]]),session=blankSession('video'),entity=session.entities[0];
  bulk(entity,1,0,0);bulk(entity,2,0,0);
  const clip={video_sha256:'video',frames,sourceCuts:[],trackingMetadata:{model_names:{2:'player'}}};
  const before=structuredClone(entity);
  initializeAutomaticAnnotations(session,clip);
  assert.deepEqual(entity,before);
  assert.equal(session.entities.slice(1).some(item=>item.modelBindings?.length),false);
  entity.bindings.pop();
  assert.equal(automaticAnnotationPointVisible(clip,0,buildTrajectories(session,frames).P1[0]),true);
});
