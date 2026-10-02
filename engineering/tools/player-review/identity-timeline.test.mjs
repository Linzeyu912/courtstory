import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession,buildTrajectories,addBinding,confirmBinding,exportReview} from './trajectory.mjs';
import {confirmIdentity,migrateIdentitySession,nextIdentityOrder,identityInterval} from './identity-timeline.mjs';
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

const release=(session,frame)=>{
  const entity=session.entities[0],range=identityInterval(session,entity,frame,frames.length);
  entity.bindings||=[];
  const binding={kind:'unassigned',trackId:null,...range,order:nextIdentityOrder(session),exclusive:true,origin:'human_release',identitySource:'human'};
  entity.bindings.push(binding);
  return binding;
};

test('released identity hides old tracked and manual points only until the next confirmation',()=>{
  const s=blankSession('clip');s.maxGapSeconds=30;select(s,'P1',0,10);select(s,'P1',12,70);
  s.entities[0].anchors.push({frame:7,x:30,y:90,trackId:10,identityConfirmed:false},
    {frame:8,x:40,y:80,trackId:null,footMethod:'human_image_anchor'});
  const before=buildTrajectories(s,frames).P1,anchors=structuredClone(s.entities[0].anchors),binding=release(s,6);
  assert.equal(binding.end,11);
  const after=buildTrajectories(s,frames).P1;
  assert.deepEqual(after.slice(0,6),before.slice(0,6));
  assert.deepEqual(after.slice(12),before.slice(12));
  for(const point of after.slice(6,12)){
    assert.equal(point.source,'missing');assert.equal(point.x,null);assert.equal(point.y,null);assert.equal(point.trackId,null);
    assert.equal(point.reviewExcluded,true);assert.equal(point.identitySource,'human_unassigned');
    assert.equal(point.identityStartFrame,6);assert.equal(point.identityEndFrame,11);
    assert.equal(point.identityOrder,binding.order);assert.equal(point.identityExclusive,true);assert.equal(point.identityOrigin,'human_release');
  }
  assert.deepEqual(s.entities[0].anchors,anchors);
});

test('a same-frame higher order or a later confirmation can restore a released identity',()=>{
  for(const reconfirmAt of [6,9]){
    const s=blankSession('clip');select(s,'P1',0,10);select(s,'P1',12,70);const binding=release(s,6);
    select(s,'P1',reconfirmAt,60);const points=buildTrajectories(s,frames).P1;
    assert(points.slice(6,reconfirmAt).every(point=>point.reviewExcluded&&point.x===null));
    assert(points.slice(reconfirmAt,12).every(point=>point.trackId===60&&!point.reviewExcluded));
    assert(points[reconfirmAt].identityOrder>binding.order);
    assert.equal(points[12].trackId,70);assert.equal(points[5].trackId,10);
  }
});

test('release intervals preserve a subsequent range and stop at camera cuts',()=>{
  const s=blankSession('clip');s.cuts=[18];select(s,'P1',0,10);
  confirmBinding(s,'P1',{kind:'track',trackId:60,start:10,end:24},frames);
  select(s,'P1',20,70);
  const before=buildTrajectories(s,frames).P1;
  assert.deepEqual(release(s,6).end,9);assert.deepEqual(release(s,14).end,17);
  const points=buildTrajectories(s,frames).P1;
  assert(points.slice(6,10).every(point=>point.reviewExcluded));
  assert.deepEqual(points.slice(10,14),before.slice(10,14));
  assert(points.slice(14,18).every(point=>point.reviewExcluded));
  assert.deepEqual(points.slice(18),before.slice(18));
  assert.equal(points[18].source,'missing');assert.equal(points[18].reviewExcluded,undefined);assert.equal(points[20].trackId,70);
});

test('team metadata migration normalizes fixed sides without replacing real team descriptions or roles',()=>{
  const s=blankSession('clip');assert.equal(s.teamRoles,null);
  assert.deepEqual(s.entities.map(entity=>entity.teamSide),Array(5).fill('red').concat(Array(5).fill('blue')));
  for(const entity of s.entities)delete entity.teamSide;
  delete s.teamRoles;s.entities[0].team='白色球衣';s.entities[0].jersey='15';s.entities[1].teamSide='blue';
  s.entities.push({id:'R1',role:'referee',name:'裁判',teamSide:'red',anchors:[]});
  migrateIdentitySession(s);
  assert.equal(s.teamRoles,null);assert.equal(s.entities[0].teamSide,'red');assert.equal(s.entities[1].teamSide,'red');
  assert.equal(s.entities[5].teamSide,'blue');assert.equal(s.entities[10].teamSide,null);
  assert.equal(s.entities[0].team,'白色球衣');assert.equal(s.entities[0].jersey,'15');
  s.teamRoles={red:'offense',blue:'defense'};migrateIdentitySession(s);
  assert.deepEqual(s.teamRoles,{red:'offense',blue:'defense'});
});
