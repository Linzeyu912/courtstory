import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession,buildTrajectories,gapRanges,exportReview,addBinding,continuationSuggestions} from './trajectory.mjs';
const frames=Array.from({length:9},(_,frame)=>({frame,time:frame/10,tracks:[]}));
function scenario(anchors){const session=blankSession('sample');session.maxGapSeconds=.5;session.entities[0].anchors=anchors;return session;}
test('short gap uses both endpoints and keeps estimates distinct from manual points',()=>{
  const session=scenario([{frame:1,x:100,y:300,trackId:null},{frame:4,x:130,y:330,trackId:null}]);
  const points=buildTrajectories(session,frames).P1;
  assert.equal(points[1].source,'manual');assert.equal(points[2].source,'interpolated');
  assert.equal(points[2].x,110);assert.deepEqual(points[2].supportFrames,[1,4]);
  assert.equal(points[0].source,'missing');assert.equal(points[5].source,'missing');
});
test('long gaps and cuts stay unresolved',()=>{
  const session=scenario([{frame:0,x:100,y:100,trackId:null},{frame:8,x:180,y:100,trackId:null}]);
  assert.equal(buildTrajectories(session,frames).P1[4].source,'missing');
  session.maxGapSeconds=1;session.cuts=[4];
  assert.equal(buildTrajectories(session,frames).P1[3].source,'missing');
});
test('different temporary IDs join only from their respective identity confirmation frames',()=>{
  const records=structuredClone(frames);records[1].tracks=[[90,200,110,300,74,.9,0]];records[4].tracks=[[120,200,140,300,206,.9,0]];
  const session=scenario([{frame:0,x:100,y:300,trackId:74},{frame:4,x:130,y:300,trackId:206}]);
  const points=buildTrajectories(session,records).P1;
  assert.equal(points[1].trackId,74);assert.equal(points[4].trackId,206);assert.equal(points[2].source,'missing');
});
test('future identity anchors do not introduce a competing ID into earlier frames',()=>{
  const records=structuredClone(frames);records[2].tracks=[[90,200,110,300,74,.9,0],[390,200,410,300,206,.9,0]];
  const session=scenario([{frame:0,x:100,y:300,trackId:74},{frame:4,x:400,y:300,trackId:206}]);
  session.maxGapSeconds=0;
  const points=buildTrajectories(session,records).P1;assert.equal(points[2].trackId,74);assert.equal(points[2].source,'tracked');assert.equal(points[1].source,'missing');
});
test('duplicate human bindings invalidate interpolation supported by the conflict',()=>{
  const session=scenario([{frame:1,x:100,y:100,trackId:74},{frame:4,x:130,y:100,trackId:74}]);
  session.entities[1].anchors=[{frame:1,x:100,y:100,trackId:74},{frame:4,x:130,y:100,trackId:74}];
  const points=buildTrajectories(session,frames).P1;assert.equal(points[1].source,'conflict');assert.equal(points[2].source,'conflict');
});
test('implausible jumps remain gaps and ranges include edges',()=>{
  const session=scenario([{frame:1,x:10,y:100,trackId:null},{frame:4,x:1800,y:100,trackId:null}]);
  const points=buildTrajectories(session,frames).P1;assert.equal(points[2].source,'missing');assert.deepEqual(gapRanges(points),[{start:0,end:0},{start:2,end:3},{start:5,end:8}]);
});

test('a manual position correction does not discard the existing identity binding',()=>{
  const records=structuredClone(frames);records[3].tracks=[[90,200,110,300,74,.9,0]];
  const session=scenario([{frame:0,x:100,y:300,trackId:74},{frame:2,x:110,y:310,trackId:null}]);
  const points=buildTrajectories(session,records).P1;
  assert.equal(points[2].source,'manual');assert.equal(points[2].y,310);
  assert.equal(points[3].source,'tracked');assert.equal(points[3].trackId,74);
});

test('export preserves estimates and unresolved gaps without claiming every frame was checked',()=>{
  const clip={video_sha256:'sample',width:1920,height:1080,frames};
  assert.throws(()=>exportReview(blankSession('sample'),clip,'test-time'));
  const session=scenario([{frame:1,x:100,y:300,trackId:null},{frame:4,x:130,y:330,trackId:null}]);
  const output=exportReview(session,clip,'test-time');
  assert.equal(output.entities.length,1);assert.equal(output.entities[0].id,'P1');
  assert.equal(output.selectionConfirmed,true);assert.equal(output.allFramesManuallyVerified,false);
  assert.equal(output.entities[0].trajectory[2].source,'interpolated');
  assert.equal(output.entities[0].trajectory[2].reviewRequired,true);
  assert.deepEqual(output.entities[0].unresolved,[{start:0,end:0},{start:5,end:8}]);
});

test('scene object export preserves per-frame evidence without becoming player or ground trajectories',()=>{
  const records=structuredClone(frames);
  records[3].objects=[{kind:'basketball',box:[20,30,28,38],score:.73,source:'model',groundPoint:false},
    {kind:'hoop',box:[80,50,120,68],score:.91,source:'model',groundPoint:false}];
  const session=scenario([{frame:0,x:100,y:300,trackId:null}]);
  const exported=exportReview(session,{video_sha256:'sample',width:1920,height:1080,frames:records},'test-time');
  assert.equal(exported.sceneObjects.coordinateSystem,'image_pixels');
  assert.equal(exported.sceneObjects.continuousTracking,false);assert.equal(exported.sceneObjects.groundProjection,false);
  assert.deepEqual(exported.sceneObjects.frames[3],{frame:3,time:.3,objects:records[3].objects});
  assert.deepEqual(exported.sceneObjects.frames[4].objects,[]);
  assert.equal(exported.entities.length,1);assert.equal(exported.entities[0].id,'P1');
  assert.equal(exported.entities[0].trajectory[3].source,'missing');
  assert.equal(exported.entities[0].courtTrajectory[3].x,null);
  exported.sceneObjects.frames[3].objects[0].box[0]=999;
  assert.equal(records[3].objects[0].box[0],20);
});

test('direct export restores immutable source cuts without rewriting the supplied draft',()=>{
  const records=frames.slice(0,4).map((record,i)=>({...record,source_frame:i<2?i:i+98,tracks:[[90,200,110,300,1,.9,2]]}));
  const session=scenario([{frame:0,x:100,y:300,trackId:1}]);session.cuts=[];
  const exported=exportReview(session,{video_sha256:'joined',width:1920,height:1080,frames:records,sourceCuts:[2]},'test-time');
  assert.deepEqual(exported.settings.cuts,[2]);assert.deepEqual(exported.settings.sourceCuts,[2]);
  assert.deepEqual(exported.entities[0].trajectory.map(p=>p.source),['manual','tracked','missing','missing']);
  assert.deepEqual(session.cuts,[]);
  assert.equal(exported.sourceFrameMapping[2].sourceFrame,100);
});

test('manual range reconnects an ID without changing earlier frames or unrelated people',()=>{
  const records=structuredClone(frames);
  records[1].tracks=[[90,200,110,300,10,.9,0]];
  for(let frame=4;frame<=8;frame++)records[frame].tracks=[[110,200,130,300,33,.9,0],[400,200,440,300,10,.9,0]];
  const session=scenario([{frame:0,x:100,y:300,trackId:10}]);
  const original=buildTrajectories(session,records).P1;
  assert.equal(original[5].trackId,10);
  addBinding(session.entities[0],{kind:'track',trackId:33,start:4,end:7},records);
  const points=buildTrajectories(session,records).P1;
  assert.equal(points[1].trackId,10);assert.equal(points[5].trackId,33);
  assert.equal(points[5].x,120);assert.equal(points[8].trackId,10);
  assert.equal(points[5].identitySource,'manual_range');assert.equal(session.entities[1].anchors.length,0);
  session.entities[0].bindings=[];assert.deepEqual(buildTrajectories(session,records).P1,original);
});

test('out-of-view is preserved, never interpolated, and can be overridden on reentry',()=>{
  const session=scenario([{frame:0,x:100,y:300,trackId:10}]);
  addBinding(session.entities[0],{kind:'out_of_view',start:2,end:8},frames);
  const records=structuredClone(frames);records[7].tracks=[[100,200,120,300,33,.8,0]];
  addBinding(session.entities[0],{kind:'track',trackId:33,start:7,end:8},records);
  const points=buildTrajectories(session,records).P1;
  assert.equal(points[5].source,'out_of_view');assert.equal(points[1].source,'missing');
  assert.equal(points[7].trackId,33);assert.equal(points[8].source,'missing');
  assert.deepEqual(gapRanges(points),[{start:1,end:1},{start:8,end:8}]);
});

test('range binding detects cross-player conflicts and does not bridge a camera cut',()=>{
  const records=structuredClone(frames);
  for(const record of records)record.tracks=[[90,200,110,300,33,.9,0]];
  const session=blankSession('sample');
  addBinding(session.entities[0],{kind:'track',trackId:33,start:0,end:8},records);
  addBinding(session.entities[1],{kind:'track',trackId:33,start:2,end:3},records);
  session.cuts=[5];const points=buildTrajectories(session,records).P1;
  assert.equal(points[2].source,'conflict');assert.equal(points[4].source,'tracked');assert.equal(points[5].source,'missing');
});

test('continuation suggestions are nearby candidates, never applied automatically',()=>{
  const records=structuredClone(frames);
  records[1].tracks=[[90,200,110,300,10,.9,0]];
  records[3].tracks=[[110,200,130,300,33,.9,0],[1600,200,1650,300,50,.9,0]];
  records[4].tracks=records[3].tracks;
  const session=scenario([{frame:0,x:100,y:300,trackId:10,box:[90,200,110,300]}]);
  const points=buildTrajectories(session,records).P1;
  assert.equal(points[3].source,'missing');
  const suggestions=continuationSuggestions(points,records);
  assert.deepEqual(suggestions.map(item=>item.id),[33]);assert.equal(suggestions[0].start,3);
  assert.equal(session.entities[0].bindings,undefined);
  assert.equal(continuationSuggestions(points,records,[2]).length,0);
  records[1].team_hints={'10':'white'};records[3].team_hints={'33':'yellow'};
  assert.equal(continuationSuggestions(points,records).length,0);
});

test('range validation rejects reversed ranges and a track absent from the selected frames',()=>{
  const session=blankSession('sample');
  assert.throws(()=>addBinding(session.entities[0],{kind:'track',trackId:33,start:6,end:3},frames));
  assert.throws(()=>addBinding(session.entities[0],{kind:'track',trackId:33,start:0,end:3},frames));
  assert.equal(session.entities[0].bindings,undefined);
});

test('automatic interpolation keeps a released gap empty and retains its evidence',()=>{
  const session=scenario([{frame:1,x:100,y:300,trackId:null},{frame:4,x:130,y:330,trackId:null}]);
  assert.equal(buildTrajectories(session,frames).P1[2].source,'interpolated');
  session.entities[0].bindings=[{kind:'unassigned',trackId:null,start:2,end:3,order:1,exclusive:true,origin:'human_release',identitySource:'human'}];
  const output=exportReview(session,{video_sha256:'sample',width:1920,height:1080,frames},'now');
  const points=output.entities[0].trajectory;
  assert.equal(points[1].source,'manual');assert.equal(points[4].source,'manual');
  for(const point of points.slice(2,4)){
    assert.equal(point.source,'missing');assert.equal(point.x,null);assert.equal(point.reviewExcluded,true);
    assert.equal(point.identitySource,'human_unassigned');assert.equal(point.identityOrigin,'human_release');
  }
});

test('export retains color groups and human data without inferred team roles or mutating legacy drafts',()=>{
  const session=blankSession('sample');
  for(const entity of session.entities)delete entity.teamSide;
  for(const index of [0,5])session.entities[index].anchors=[{frame:0,x:100+index,y:300,trackId:null}];
  session.entities[0].team='实际队名';session.entities[0].jersey='30';
  const clip={video_sha256:'sample',width:1920,height:1080,frames},before=structuredClone(session);
  let output=exportReview(session,clip,'now');
  assert.equal(Object.hasOwn(output,'teamRoles'),false);assert.deepEqual(output.entities.map(entity=>entity.teamSide),['red','blue']);
  assert.equal(output.entities[0].team,'实际队名');assert.equal(output.entities[0].jersey,'30');
  assert.deepEqual(session,before);
  session.teamRoles={red:'defense',blue:'offense'};session.entities[0].teamSide='blue';
  session.modelSuggestionLoad={verified:false,teamLayout:'fixed_red_offense_blue_defense_v1',playerCount:2};
  const legacy=structuredClone(session);
  output=exportReview(session,clip,'now');
  assert.equal(Object.hasOwn(output,'teamRoles'),false);assert.equal(output.entities[0].teamSide,'red');
  assert.deepEqual(output.modelSuggestionLoad,{verified:false,teamLayout:'fixed_red_blue_color_only_v1',playerCount:2});
  assert.deepEqual(session,legacy);
});
