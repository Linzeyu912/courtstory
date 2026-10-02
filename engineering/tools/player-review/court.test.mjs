import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {COURT,landmarks,project,homography,validQuad,keyframePoints,fitKeyframe,calibrationAt,buildCourtTrajectories,courtGaps,pathSegments,addCourtAnchor,addEvent,convexHull,insideHull,footPointSensitivity} from './court.mjs';
import {courtLandmarks,courtMarkings,fitHomography} from './court-geometry.mjs';
import {blankSession,buildTrajectories,exportReview} from './trajectory.mjs';
import {confirmIdentity,nextIdentityOrder} from './identity-timeline.mjs';
const image=[[448,536],[934,570],[809,697],[230,653]];
const frames=Array.from({length:5},(_,i)=>({frame:i,time:i*.1,tracks:[[380+i,500,420+i,600,1,.9,0]]}));
const calibration={maxKeyframeGapSeconds:1.2,keyframes:[{frame:0,side:'left',source:'reference',image},{frame:4,side:'left',source:'reference',image:image.map(([x,y])=>[x+20,y+10])}]};
const setup=()=>{const s=blankSession('test');s.courtCalibration=structuredClone(calibration);s.entities[0].anchors=[{frame:0,x:400,y:600,trackId:1}];return s;};
test('perspective mapping fits four ground corners and round-trips interior points',()=>{
  for(const side of ['left','right']){const floor=landmarks(side),h=homography(image,floor),inverse=homography(floor,image);image.forEach(([x,y],i)=>{const p=project(h,x,y);assert.ok(Math.hypot(p.x-floor[i][0],p.y-floor[i][1])<1e-8);});const p=project(h,610,611),q=project(inverse,p.x,p.y);assert.ok(Math.hypot(q.x-610,q.y-611)<1e-7);}
});
test('degenerate, crossed or non-finite calibration is rejected',()=>{
  for(const quad of [[[0,0],[1,0],[2,0],[3,0]],[[0,0],[1,1],[1,0],[0,1]],[[0,0],[1,0],[NaN,1],[0,1]]]){assert.equal(validQuad(quad),false);assert.equal(homography(quad,landmarks()),null);}assert.equal(project([1,0,0,0,1,0,0,0,0],2,3),null);
});
test('moving-camera keyframes interpolate landmarks, without extrapolating or crossing cuts',()=>{
  const mid=calibrationAt(calibration,2,frames);assert.ok(Math.hypot(mid.image[0][0]-458,mid.image[0][1]-541)<1e-7);assert.equal(mid.method,'interpolated_landmarks');assert.equal(mid.referenceOnly,true);assert.equal(calibrationAt(calibration,2,frames,[2]),null);assert.ok(calibrationAt(calibration,4,frames,[2]));
  const one={keyframes:[calibration.keyframes[0]]};assert.equal(calibrationAt(one,1,frames),null);
  const tooFar={...calibration,maxKeyframeGapSeconds:.3};assert.equal(calibrationAt(tooFar,2,frames),null);
  const swapped=structuredClone(calibration);swapped.keyframes[1].side='right';assert.equal(calibrationAt(swapped,2,frames),null);
});
test('missing identity and missing calibration remain distinct and never become coordinates',()=>{
  const s=setup();s.courtCalibration=null;const input=buildTrajectories(s,frames);input.P1[2]={...input.P1[2],source:'missing',x:null,y:null};const p=buildCourtTrajectories(s,frames,input).P1;assert.equal(p[1].source,'uncalibrated');assert.equal(p[2].source,'missing');assert.equal(p[2].x,null);assert.deepEqual(courtGaps(p).map(g=>g.reason),['uncalibrated','missing','uncalibrated']);
});
test('court correction preserves image trajectory and only changes its own frame',()=>{
  const s=setup(),input=buildTrajectories(s,frames),snapshot=JSON.stringify(input);addCourtAnchor(s.entities[0],2,7,5);const p=buildCourtTrajectories(s,frames,input).P1;assert.equal(p[2].source,'court_manual');assert.equal(p[2].x,7);assert.equal(p[1].source,'projected');assert.equal(JSON.stringify(input),snapshot);assert.throws(()=>addCourtAnchor(s.entities[0],2,-1,5));
  input.P1[2].source='conflict';assert.equal(buildCourtTrajectories(s,frames,input).P1[2].source,'conflict');input.P1[2].source='out_of_view';assert.equal(buildCourtTrajectories(s,frames,input).P1[2].x,null);
});
test('paths break across unavailable frames and camera cuts',()=>{
  const p=[0,1,2,3,4].map(frame=>({frame,x:frame,y:2}));p[2].x=null;assert.deepEqual(pathSegments(p).map(a=>a.map(p=>p.frame)),[[0,1],[3,4]]);assert.deepEqual(pathSegments(p,[4]).map(a=>a.map(p=>p.frame)),[[0,1],[3],[4]]);
});
test('export keeps identity, events, calibration provenance and unresolved court intervals',()=>{
  const s=setup(),e=s.entities[0];e.team='IND';e.jersey='0';addCourtAnchor(e,2,7,5);addEvent(e,2,'传球','人工核对',frames);s.cuts=[3];const out=exportReview(s,{video_sha256:'test',width:1920,height:1080,frames},'2026-10-01');assert.equal(out.schemaVersion,2);assert.equal(out.entities[0].events[0].source,'human');assert.equal(out.entities[0].events[0].time,.2);assert.equal(out.entities[0].team,'IND');assert.equal(out.entities[0].courtTrajectory[2].source,'court_manual');assert.equal(out.court.metricAccuracyValidated,false);assert.ok(out.entities[0].courtUnresolved.length);assert.equal(out.entities[0].trajectory.length,5);assert.equal(out.court.units,'metres');assert.equal(out.allFramesManuallyVerified,false);
});
test('clip reference calibrates every sample frame with finite reversible coordinates',()=>{
  const profile=JSON.parse(fs.readFileSync(new URL('../../research/vision-player-refinement/clip001-court-reference.json',import.meta.url),'utf8'));
  const clipFrames=Array.from({length:243},(_,frame)=>({time:.033+frame/29.97003}));for(let frame=0;frame<243;frame++){const map=calibrationAt(profile,frame,clipFrames);assert.ok(map);const p=project(map.toImage,5,7),q=project(map.toCourt,p.x,p.y);assert.ok(Math.hypot(q.x-5,q.y-7)<1e-7);assert.equal(map.reviewRequired,true);}assert.equal(COURT.length,28.6512);
});
test('named points use the key dimensions and match a wider court independently',()=>{
  const truth=[91,8,250,4,31,410,.019,.005,1],catalog=courtLandmarks();
  const points=catalog.map(p=>{const q=project(truth,p.x,p.y);return {id:p.id,image:[q.x,q.y],source:'human'};});
  const fit=fitKeyframe({side:'left',points});assert.ok(fit.fitRmsePixels<1e-7);
  const heldout=[13,14],q=project(truth,...heldout),back=project(fit.toCourt,q.x,q.y);assert.ok(Math.hypot(back.x-heldout[0],back.y-heldout[1])<1e-7);
  assert.equal(catalog.find(p=>p.id==='B').x,5.7912);assert.equal(catalog.find(p=>p.id==='F').x,COURT.length/2);
  const arc=courtMarkings().find(l=>l.id==='left_three').points;assert.deepEqual(arc[0],[0,.9144]);assert.ok(arc.some(p=>Math.abs(p[0]-8.8392)<1e-8));
});
test('disabled, duplicate and degenerate named controls cannot silently corrupt mapping',()=>{
  const points=keyframePoints(calibration.keyframes[0]);points.push({id:'E',image:[-500,900],enabled:false});
  const fit=fitKeyframe({side:'left',points});assert.equal(fit.points.length,4);assert.ok(fit.fitRmsePixels<1e-7);
  assert.equal(fitKeyframe({side:'left',points:[...points,points[0]]}),null);
  points[0].enabled=false;assert.equal(fitKeyframe({side:'left',points}),null);
  assert.equal(fitHomography([[0,0],[0,1],[0,2],[0,3]],image),null);
});
test('mixed control sets interpolate while keeping estimated controls unconfirmed',()=>{
  const first=structuredClone(calibration.keyframes[0]),last=structuredClone(calibration.keyframes[1]);
  first.points=keyframePoints(first).map(p=>({...p,source:'human'}));
  const fit=fitKeyframe(first),e=project(fit.toImage,0,0);first.points.push({id:'E',image:[e.x,e.y],source:'human'});
  last.points=keyframePoints(last).map(p=>({...p,source:'interpolated_seed'}));
  const c={keyframes:[first,last]};assert.equal(calibrationAt(c,0,frames).referenceOnly,false);
  const mid=calibrationAt(c,2,frames);assert.equal(mid.referenceOnly,true);assert.equal(mid.controlCount,4);
  assert.ok(Math.hypot(mid.image[0][0]-458,mid.image[0][1]-541)<1e-7);
});
test('expanded clip profile remains invertible for all frames and carries reference provenance',()=>{
  const profile=JSON.parse(fs.readFileSync(new URL('../../research/vision-player-refinement/clip001-court-expanded.json',import.meta.url),'utf8'));
  const clipFrames=Array.from({length:243},(_,frame)=>({time:.033+frame/29.97003}));
  for(let frame=0;frame<243;frame++){const map=calibrationAt(profile,frame,clipFrames);assert.ok(map);assert.equal(map.referenceOnly,true);for(const p of [[0,0],[14.3256,15.24],[28.6512,0]]){const q=project(map.toImage,...p),back=project(map.toCourt,q.x,q.y);assert.ok(Math.hypot(back.x-p[0],back.y-p[1])<1e-7);}}
});
test('held-out points report error without influencing the calibration',()=>{
  const points=keyframePoints(calibration.keyframes[0]),baseline=fitKeyframe({side:'left',points});
  const check={id:'F',image:[1754,507],role:'check',source:'human'};
  const first=fitKeyframe({side:'left',points:[...points,check]});assert.deepEqual(first.toImage,baseline.toImage);
  assert.ok(first.fitRmsePixels<1e-7);assert.ok(first.checkResiduals[0].pixels>80);assert.ok(first.checkResiduals[0].metres>1);
  check.image=[1800,650];const changed=fitKeyframe({side:'left',points:[...points,check]});assert.deepEqual(changed.toImage,baseline.toImage);assert.notEqual(changed.checkResiduals[0].pixels,first.checkResiduals[0].pixels);
  assert.equal(fitKeyframe({side:'left',points:points.map((p,i)=>({...p,role:i?'control':'check'}))}),null);
});
test('coverage and pixel sensitivity expose extrapolation and local scale',()=>{
  const hull=convexHull([[0,0],[3,0],[3,2],[0,2],[1,1],[0,0]]);assert.equal(hull.length,4);
  assert.equal(insideHull(hull,2,1),true);assert.equal(insideHull(hull,3,2),true);assert.equal(insideHull(hull,4,1),false);
  const estimate=footPointSensitivity([.02,0,2,0,.05,4,0,0,1],100,200,5);assert.ok(Math.abs(estimate.approxMaxMetres-.25)<1e-12);assert.equal(estimate.excludesCalibrationError,true);
  assert.equal(footPointSensitivity([1,0,0,0,1,0,0,0,0],10,10),null);
  const s=setup(),input=buildTrajectories(s,frames),map=calibrationAt(s.courtCalibration,0,frames);
  const outside=project(map.toImage,10,12);input.P1[0]={...input.P1[0],...outside};
  const output=buildCourtTrajectories(s,frames,input).P1[0];assert.equal(output.calibrationSupport,'outside_controls');assert.ok(output.sensitivity.approxMaxMetres>0);
});
test('court export distinguishes a human identity selection from a human foot correction',()=>{
  const s=setup();s.entities[0].anchors=[{frame:0,x:400,y:600,trackId:1,box:[380,500,420,600]},{frame:2,x:402,y:590,trackId:null}];
  const out=exportReview(s,{video_sha256:'test',width:1920,height:1080,frames},'test');
  const e=out.entities[0];assert.equal(e.trajectory[0].source,'manual');assert.equal(e.trajectory[0].footMethod,'bbox_bottom_center');assert.equal(e.courtTrajectory[0].footMethod,'bbox_bottom_center');assert.equal(e.courtTrajectory[2].footMethod,'human_image_anchor');assert.equal(e.courtTrajectory[1].footMethod,'bbox_bottom_center');
});

test('released identities suppress existing court anchors and export nulls until reconfirmed',()=>{
  const s=setup(),entity=s.entities[0];
  confirmIdentity(s,'P1',0,{trackId:1,box:frames[0].tracks[0].slice(0,4)},frames);
  confirmIdentity(s,'P1',4,{trackId:1,box:frames[4].tracks[0].slice(0,4)},frames);
  entity.anchors.push({frame:2,x:402,y:590,trackId:null});addCourtAnchor(entity,2,7,5);addCourtAnchor(entity,4,9,6);
  const before=buildCourtTrajectories(s,frames,buildTrajectories(s,frames)).P1;
  entity.bindings=[{kind:'unassigned',trackId:null,start:1,end:3,order:nextIdentityOrder(s),exclusive:true,origin:'human_release',identitySource:'human'}];
  const output=exportReview(s,{video_sha256:'test',width:1920,height:1080,frames},'now').entities[0];
  assert.deepEqual(output.courtTrajectory[0],before[0]);assert.deepEqual(output.courtTrajectory[4],before[4]);
  for(const point of output.courtTrajectory.slice(1,4)){
    assert.equal(point.source,'missing');assert.equal(point.x,null);assert.equal(point.y,null);assert.equal(point.reviewExcluded,true);
    assert.equal(point.identitySource,'human_unassigned');assert.equal(point.identityStartFrame,1);assert.equal(point.identityEndFrame,3);
    assert.equal(point.identityOrigin,'human_release');assert.equal(point.identityOrder,entity.bindings[0].order);
  }
  assert.equal(entity.courtAnchors.find(anchor=>anchor.frame===2).x,7);
  confirmIdentity(s,'P1',2,{trackId:1,box:frames[2].tracks[0].slice(0,4)},frames);
  const restored=buildCourtTrajectories(s,frames,buildTrajectories(s,frames)).P1;
  assert.equal(restored[1].reviewExcluded,true);assert.equal(restored[2].source,'court_manual');assert.equal(restored[2].x,7);
  assert.equal(restored[3].source,'projected');assert.deepEqual(restored[4],before[4]);
});
