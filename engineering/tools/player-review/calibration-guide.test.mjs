import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeCourtCandidates,acceptCourtCandidates,calibrationGuideState,reorientCalibrationKey,confirmCalibrationProjection,invalidateCameraDependents} from './calibration-guide.mjs';
import {calibrationAt,buildCourtTrajectories} from './court.mjs';
import {blankSession,buildTrajectories,exportReview} from './trajectory.mjs';
const image=[[100,100],[400,120],[350,350],[50,330]],frames=Array.from({length:5},(_,frame)=>({frame,time:frame/30,tracks:[[190,100,210,250,1,.9,2]]}));
const key=frame=>({frame,side:'left',source:'optical_flow',status:'needs_review',points:image.map((image,i)=>({id:'ABCD'[i],image,source:'optical_flow'}))});
test('candidate previews require explicit acceptance and retain reference provenance in 2D export',()=>{
 const session=blankSession('v');session.entities[0].anchors=[{frame:0,x:200,y:250,trackId:1}];session.courtCalibration={keyframes:[key(0),key(4)]};assert.equal(calibrationAt(session.courtCalibration,2,frames),null);
 const result=acceptCourtCandidates(session,{keyframes:[key(0),key(4)]},5,'v');assert.equal(result.accepted,2);const output=exportReview(session,{video_sha256:'v',width:500,height:400,frames},'now');
 assert.equal(output.entities[0].courtTrajectory[2].source,'projected');assert.equal(output.entities[0].courtTrajectory[2].referenceCalibration,true);assert.equal(output.court.metricAccuracyValidated,false);assert.equal(output.court.calibration.keyframes[0].status,'accepted_reference');
});
test('failed candidate frames block interpolation and adopting candidates preserves human keys',()=>{
 const session=blankSession('v'),human={...key(0),source:'human',status:'manual_confirmed',points:key(0).points.map(p=>({...p,source:'human'}))};session.courtCalibration={keyframes:[human]};
 const result=acceptCourtCandidates(session,{keyframes:[key(0),{...key(2),status:'invalid',points:[]},key(4)]},5,'v');
 assert.deepEqual(result,{accepted:1,invalid:1,preserved:1});assert.deepEqual(session.courtCalibration.keyframes[0],human);
 for(const frame of [1,2,3])assert.equal(calibrationAt(session.courtCalibration,frame,frames),null);assert.ok(calibrationAt(session.courtCalibration,4,frames));
});
test('guide recognizes named ground points, rejects degenerate calibration, and accepts schema aliases',()=>{
 const normalized=normalizeCourtCandidates({source:'model',keyframes:[{...key(1),points:key(1).points.map(({id,...p})=>({...p,landmarkId:id}))},{...key(8)}]},5);
 assert.equal(normalized.length,1);assert.equal(normalized[0].points[0].id,'A');assert.equal(calibrationGuideState(normalized[0],'C').ready,true);assert.match(calibrationGuideState(normalized[0],'C').hint,/罚球线/);
 const bad={...key(1),points:key(1).points.map((p,i)=>({...p,image:[i,0]}))};assert.equal(calibrationGuideState(bad).ready,false);
});
test('dense camera candidates preserve a zero interpolation allowance',()=>{
 const session=blankSession('v');acceptCourtCandidates(session,{maxKeyframeGapSeconds:0,keyframes:[key(0),key(4)]},5,'v');
 assert.equal(session.courtCalibration.maxKeyframeGapSeconds,0);assert.equal(calibrationAt(session.courtCalibration,2,frames),null);assert.ok(calibrationAt(session.courtCalibration,0,frames));
});
test('changing the basket side persists geometry and requires renewed review',()=>{
 const original={...key(0),status:'accepted_reference'},changed=reorientCalibrationKey(original,'right');
 assert.equal(changed.side,'right');assert.equal(changed.status,'needs_review');assert.deepEqual(changed.points,original.points);assert.equal(changed.previousSource,'optical_flow');assert.equal(original.side,'left');
 assert.equal(calibrationAt({keyframes:[changed]},0,frames),null);changed.status='manual_confirmed';assert.equal(calibrationAt({keyframes:[changed]},0,frames).side,'right');
});
test('later camera cuts invalidate propagated keys across their dependency anchor',()=>{
 const propagated={...key(4),source:'camera_propagation',status:'accepted_reference',quality:{referenceFrame:0},points:key(4).points.map(p=>({...p,source:'camera_propagation'}))};
 assert.ok(calibrationAt({keyframes:[propagated]},4,frames));assert.equal(calibrationAt({keyframes:[propagated]},4,frames,[2]),null);
 const cropped={...propagated,cameraSupportFrame:2,quality:{referenceFrame:70,sourceReferenceFrame:70}};
 assert.ok(calibrationAt({keyframes:[cropped]},4,frames,[2]));assert.equal(calibrationAt({keyframes:[cropped]},4,frames,[3]),null);
 for(const bad of [-1,70,1.5])assert.equal(calibrationAt({keyframes:[{...propagated,cameraSupportFrame:bad}]},4,frames),null);
 const reoriented=reorientCalibrationKey(propagated,'right');reoriented.status='manual_confirmed';assert.equal(calibrationAt({keyframes:[reoriented]},4,frames,[2]),null);
 const manual={...reoriented,points:reoriented.points.map(p=>({...p,source:'human'}))};assert.ok(calibrationAt({keyframes:[manual]},4,frames,[2]));
});
test('explicit projection review can anchor the current camera frame without rewriting its origin',()=>{
 const pending={...key(4),source:'camera_propagation',status:'accepted_reference',cameraSupportFrame:0,quality:{referenceFrame:70,sourceReferenceFrame:70},points:key(4).points.map(p=>({...p,source:'camera_propagation',reviewRequired:true}))};
 assert.equal(calibrationAt({keyframes:[pending]},4,frames,[2]),null);
 const reviewed=confirmCalibrationProjection(pending,4,'now');assert.ok(calibrationAt({keyframes:[reviewed]},4,frames,[2]));
 assert.equal(reviewed.cameraSupportFrame,4);assert.equal(reviewed.quality.cameraSupportFrame,4);assert.equal(reviewed.quality.referenceFrame,70);assert.equal(reviewed.quality.sourceReferenceFrame,70);assert.deepEqual(reviewed.points,pending.points);assert.equal(pending.cameraSupportFrame,0);assert.equal(reviewed.reviewRequired,true);
});
test('real 005 camera dependents stay stale after a reference edit until a matching profile is generated',()=>{
 const profile=JSON.parse(fs.readFileSync(new URL('../../../data/workbench/court-candidates-005.json',import.meta.url),'utf8'));
 const videoFrames=Array.from({length:143},(_,frame)=>({frame,time:frame/30})),session=blankSession(profile.videoHash),reference=profile.referenceFrame;
 acceptCourtCandidates(session,profile,videoFrames.length,profile.videoHash);
 const cameraKeys=session.courtCalibration.keyframes.filter(k=>k.frame!==reference&&k.source==='camera_propagation'&&k.status==='accepted_reference'),dependent=cameraKeys[0],independent=cameraKeys.at(-1);
 assert.ok(cameraKeys.length>2);assert.ok(calibrationAt(session.courtCalibration,dependent.frame,videoFrames));
 const makeHuman=key=>({...structuredClone(key),source:'human',status:'manual_confirmed',points:key.points.map(p=>({...p,source:'human'}))});
 const manualReference=makeHuman(session.courtCalibration.keyframes.find(k=>k.frame===reference)),manualIndependent=makeHuman(independent),changed=reorientCalibrationKey(manualReference,manualReference.side==='left'?'right':'left');
 session.courtCalibration.keyframes=session.courtCalibration.keyframes.map(k=>k.frame===reference?changed:k.frame===independent.frame?manualIndependent:k);
 invalidateCameraDependents(session.courtCalibration,reference);
 assert.equal(session.courtCalibration.keyframes.find(k=>k.frame===dependent.frame).invalidReason,'reference_changed');assert.equal(calibrationAt(session.courtCalibration,dependent.frame,videoFrames),null);
 assert.deepEqual(session.courtCalibration.keyframes.find(k=>k.frame===independent.frame),manualIndependent);assert.ok(calibrationAt(session.courtCalibration,independent.frame,videoFrames));
 acceptCourtCandidates(session,profile,videoFrames.length,profile.videoHash);assert.equal(calibrationAt(session.courtCalibration,dependent.frame,videoFrames),null);
 const regenerated=structuredClone(profile);regenerated.keyframes=regenerated.keyframes.map(k=>k.frame===reference?structuredClone(changed):{...k,side:changed.side});
 acceptCourtCandidates(session,regenerated,videoFrames.length,profile.videoHash);assert.ok(calibrationAt(session.courtCalibration,dependent.frame,videoFrames));assert.equal(calibrationAt(session.courtCalibration,dependent.frame,videoFrames).side,changed.side);
 assert.deepEqual(session.courtCalibration.keyframes.find(k=>k.frame===independent.frame),manualIndependent);
});
