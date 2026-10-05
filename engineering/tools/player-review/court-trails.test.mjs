import test from 'node:test';
import assert from 'node:assert/strict';
import {courtRelativeTrail,playerCourtTrail,temporaryCourtTrail} from './court-trails.mjs';
import {buildCourtTrajectories,exportCourtData,landmarks,project} from './court.mjs';
import {invertHomography} from './court-geometry.mjs';
import {indexTemporaryTracks} from './tracking-display.mjs';
import {groundImagePoint,selectGroundComparison} from './ground-position.mjs';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture(moving=false){
  const maps=Array.from({length:12},(_,i)=>{
    const toImage=[30+i*.7,2,300-i*9,1,24+i*.2,80+i*3,.001,.002,1];
    return {toImage,toCourt:invertHomography(toImage),supportFrames:[i],method:'test',supportHulls:[[[0,0],[29,0],[29,16],[0,16]]]};
  });
  const world=maps.map((_,i)=>({x:10+(moving?i*.1:0),y:7}));
  const frames=maps.map((m,i)=>{const p=project(m.toImage,world[i].x,world[i].y);
    return {frame:i,time:i*.1,tracks:[[p.x-20,p.y-120,p.x+20,p.y,1,.9,0]]};});
  const clip={video_sha256:'v',tracking_fingerprint:'f',width:1600,height:900,frames};
  const session={videoHash:'v',entities:[{id:'P1',courtAnchors:[]}],cuts:[]};
  const points=frames.map(f=>{const b=f.tracks[0];return {frame:f.frame,time:f.time,x:(b[0]+b[2])/2,y:b[3],box:b.slice(0,4),trackId:1,source:'tracked',footMethod:'bbox_bottom_center'};});
  return {maps,world,clip,session,points,index:indexTemporaryTracks(frames)};
}
test('a stationary player stays stationary during pan and zoom; source detections are unchanged',()=>{
  const f=fixture(),before=JSON.stringify(f.clip);
  assert.ok(Math.abs(f.points[0].x-f.points.at(-1).x)>10);
  const trail=temporaryCourtTrail(f.index,f.clip,f.session,f.maps,1,11);
  assert.equal(trail.length,12);
  for(const p of trail){close(p.courtX,10);close(p.courtY,7);close(p.x,f.points[11].x);close(p.y,f.points[11].y);}
  assert.equal(JSON.stringify(f.clip),before);
});
test('true court motion survives a moving camera and uses each historical frame mapping',()=>{
  const f=fixture(true),trail=temporaryCourtTrail(f.index,f.clip,f.session,f.maps,1,11);
  assert.equal(trail.length,12);close(trail.at(-1).courtX-trail[0].courtX,1.1);
  trail.forEach((p,i)=>{const expected=project(f.maps[11].toImage,f.world[i].x,f.world[i].y);close(p.x,expected.x);close(p.y,expected.y);});
});
test('unavailable calibration, cuts and impossible court jumps break the trail instead of freezing a matrix',()=>{
  const f=fixture();
  assert.deepEqual(temporaryCourtTrail(f.index,f.clip,f.session,f.maps,1,11,[9]).map(p=>p.frame),[9,10,11]);
  f.maps[8]=null;
  assert.deepEqual(temporaryCourtTrail(f.index,f.clip,f.session,f.maps,1,11).map(p=>p.frame),[9,10,11]);
  f.maps[11]=null;assert.deepEqual(temporaryCourtTrail(f.index,f.clip,f.session,f.maps,1,11),[]);
  const g=fixture();g.world[10].x=100;
  assert.deepEqual(courtRelativeTrail(i=>g.world[i],g.clip.frames,g.maps,11).map(p=>p.frame),[11]);
});

test('temporary court trails stop at missing detections, source time gaps and metre-speed jumps',()=>{
  const f=fixture(true);
  f.index[8].clear();
  assert.deepEqual(temporaryCourtTrail(f.index,f.clip,f.session,f.maps,1,11).map(p=>p.frame),[9,10,11]);
  assert.deepEqual(temporaryCourtTrail(f.index,f.clip,f.session,f.maps,1,8),[]);
  f.clip.frames[11].time=2;
  assert.deepEqual(temporaryCourtTrail(f.index,f.clip,f.session,f.maps,1,11).map(p=>p.frame),[11]);
  const g=fixture(true),box=g.index[11].get(1),jump=project(g.maps[11].toImage,25,7);
  g.index[11].set(1,[jump.x-20,jump.y-120,jump.x+20,jump.y,...box.slice(4)]);
  assert.deepEqual(temporaryCourtTrail(g.index,g.clip,g.session,g.maps,1,11).map(p=>p.frame),[11]);
});

test('confirmed court trails survive temporary ID changes but never bridge missing or estimated identities',()=>{
  const f=fixture(true);
  const points=f.world.map((p,i)=>({...p,frame:i,time:f.clip.frames[i].time,
    source:'projected',imageSource:i===10?'manual':'tracked',trackId:i>=10?22:1}));
  const trail=playerCourtTrail(points,f.clip.frames,f.maps,11);
  assert.equal(trail.at(-1).trackId,22);assert.ok(trail.some(p=>p.trackId===1));
  assert.ok(trail.at(-1).time-trail[0].time<=1.2);
  for(const imageSource of ['missing','conflict','interpolated','manual_path','out_of_view']){
    points[10].imageSource=imageSource;
    assert.deepEqual(playerCourtTrail(points,f.clip.frames,f.maps,11).map(p=>p.frame),[11]);
    assert.deepEqual(playerCourtTrail(points,f.clip.frames,f.maps,10),[]);
  }
});
test('person trails use the same unsmoothed court points as 2D; estimates and manual court boundaries are respected',()=>{
  const f=fixture(true),before=JSON.stringify(f.points);
  const court=buildCourtTrajectories(f.session,f.clip.frames,{P1:f.points},{clip:f.clip,maps:f.maps}).P1;
  const trail=playerCourtTrail(court,f.clip.frames,f.maps,11);
  for(const p of trail){close(p.courtX,court[p.frame].x);close(p.courtY,court[p.frame].y);}
  court[9]={...court[9],source:'court_estimated'};
  assert.deepEqual(playerCourtTrail(court,f.clip.frames,f.maps,11).map(p=>p.frame),[10,11]);
  f.session.entities[0].courtAnchors=[{frame:11,x:11.2,y:7}];
  const edited=buildCourtTrajectories(f.session,f.clip.frames,{P1:f.points},{clip:f.clip,maps:f.maps}).P1;
  const manualTrail=playerCourtTrail(edited,f.clip.frames,f.maps,11);
  assert.equal(manualTrail.length,1);close(manualTrail[0].courtX,11.2);
  assert.equal(JSON.stringify(f.points),before);
});
function withAnkles(){
  const f=fixture(),p=f.points[0];
  f.clip.feetCandidates={videoHash:'v',trackingFingerprint:'f',source:'pose-test',frames:[{frame:0,time:0,feet:[{trackId:1,
    left:{name:'left_ankle',x:p.x-8,y:p.y-6,score:.9},right:{name:'right_ankle',x:p.x+8,y:p.y-4,score:.8}}]}]};
  return f;
}
test('reliable two-ankle midpoint is shared by temporary trail, 2D position and export; manual correction wins',()=>{
  const f=withAnkles(),raw=JSON.stringify(f.points);
  const selected=groundImagePoint(f.session,f.points[0],0,f.clip);
  close(selected.y,f.points[0].y-5);assert.equal(selected.footMethod,'ankle_midpoint');assert.equal(selected.groundContactConfirmed,false);
  f.session.courtCalibration={keyframes:[{frame:0,side:'left',source:'human',image:landmarks().map(([x,y])=>{const p=project(f.maps[0].toImage,x,y);return [p.x,p.y];})}]};
  const court=exportCourtData(f.session,f.clip.frames,{P1:f.points},f.clip).courtTrajectories.P1;
  const temp=temporaryCourtTrail(f.index,f.clip,f.session,f.maps,1,0);
  close(temp[0].courtX,court[0].x);close(temp[0].courtY,court[0].y);assert.equal(court[0].footMethod,'ankle_midpoint');
  for(const source of ['manual','manual_range','manual_path'])assert.equal(groundImagePoint(f.session,{...f.points[0],source},0,f.clip).y,f.points[0].y);
  assert.equal(JSON.stringify(f.points),raw);
});
test('low-score, stale, mistimed, absent or toe-only candidates fall back to the original box bottom',()=>{
  const variants=[f=>f.clip.feetCandidates.frames[0].feet[0].left.score=.2,
    f=>f.clip.feetCandidates.trackingFingerprint='stale',f=>f.clip.feetCandidates.videoHash='other',
    f=>f.clip.feetCandidates.frames[0].time=.1,f=>f.clip.feetCandidates.frames[0].feet[0].right=null,
    f=>f.clip.feetCandidates.frames[0].feet[0].left.name='left_heel',f=>f.clip.feetCandidates.frames[0].feet[0].left.y=0];
  for(const edit of variants){const f=withAnkles();edit(f);assert.equal(groundImagePoint(f.session,f.points[0],0,f.clip).y,f.points[0].y);}
});
test('explicit comparison selection wins over automatic ankles and cannot leak into another tracking version',()=>{
  const f=withAnkles();
  selectGroundComparison(f.session,f.clip,{videoHash:'v',trackingFingerprint:'f',model:'comparison',frames:[{frame:0,time:0,people:[{trackId:1,anchor:[f.points[0].x,f.points[0].y-2],anchorMethod:'ankles'}]}]});
  const selected=groundImagePoint(f.session,f.points[0],0,f.clip);close(selected.y,f.points[0].y-2);
  f.clip.tracking_fingerprint='new';const fallback=groundImagePoint(f.session,f.points[0],0,f.clip);
  assert.equal(fallback.y,f.points[0].y);assert.equal(fallback.groundCandidateMissing,true);
});
