import test from 'node:test';
import assert from 'node:assert/strict';
import {trackingReviewState,REVIEW_COLORS,reviewedPersonTrail} from './tracking-display.mjs';
import {acceptCourtCandidates,normalizeCourtCandidates,confirmCalibrationProjection,isCalibrationProjectionConfirmed,calibrationReviewStates,reorientCalibrationKey,invalidateCameraDependents} from './calibration-guide.mjs';
import {blankSession,buildTrajectories,confirmFrameIdentity,exportReview} from './trajectory.mjs';
import {confirmIdentity} from './identity-timeline.mjs';

const frames=Array.from({length:5},(_,frame)=>({frame,time:frame/30,tracks:[[190,100,210,250,1,.9,2]]}));
const key=frame=>({frame,side:'left',source:'camera_propagation',status:'needs_review',quality:{referenceFrame:0},points:[[100,100],[400,120],[350,350],[50,330]].map((image,i)=>({id:'ABCD'[i],image,source:'camera_propagation'}))});
const candidates=frames.map((_,frame)=>key(frame));
const status=(session,input=candidates,cuts=[])=>calibrationReviewStates(session.courtCalibration,input,frames,cuts).map(item=>item.status);

test('a single reviewed person marker never paints the surrounding machine trail green',()=>{
 const points=frames.map((_,frame)=>({frame,x:frame,y:10,source:'tracked',frameIdentityConfirmed:frame===2}));
 const original=structuredClone(points),result=reviewedPersonTrail(points,points);
 assert.deepEqual(result.markers.map(point=>point.review.status),['machine','machine','human','machine','machine']);
 assert.deepEqual(result.segments.map(segment=>segment.status),Array(4).fill('machine'));
 assert.deepEqual(points,original);
 points[3].frameIdentityConfirmed=true;
 assert.deepEqual(reviewedPersonTrail(points,points).segments.map(segment=>segment.status),['machine','machine','human','machine']);
 assert.equal(reviewedPersonTrail([points[2]],points).markers[0].review.status,'human','an isolated confirmation remains visible');
});

test('reviewed trails preserve frame gaps and never color conflicts, estimates or unconfirmed edits green',()=>{
 const points=frames.map((_,frame)=>({frame,x:frame,y:10,source:'tracked',frameIdentityConfirmed:true}));
 assert.equal(reviewedPersonTrail([points[0],points[2]],points).segments.length,0);
 points[2].source='conflict';
 assert.deepEqual(reviewedPersonTrail(points,points).segments.map(segment=>[segment.from.frame,segment.to.frame]),[[0,1],[3,4]]);
 points[2]={...points[2],source:'manual',frameIdentityConfirmed:false};
 assert.deepEqual(reviewedPersonTrail(points,points).segments.map(segment=>segment.status),['human','pending','pending','human']);
 points[2]={...points[2],source:'manual_path',frameIdentityConfirmed:true};
 assert.equal(reviewedPersonTrail(points,points).markers[2].review.status,'pending');
});

test('machine blue and human green represent separate review states, even for manual or estimated positions',()=>{
 assert.equal(REVIEW_COLORS.machine,'#2563eb');assert.equal(REVIEW_COLORS.human,'#16834a');
 const point={x:200,y:250,source:'tracked',identitySource:'manual_range'};
 assert.equal(trackingReviewState(point).status,'machine');
 assert.equal(trackingReviewState({...point,frameIdentityConfirmed:true}).status,'human');
 assert.equal(trackingReviewState({...point,source:'manual'}).status,'pending');
 for(const source of ['interpolated','manual_path'])assert.equal(trackingReviewState({...point,source,frameIdentityConfirmed:true}).status,'pending');
 assert.equal(trackingReviewState({...point,source:'conflict',frameIdentityConfirmed:true}).status,'invalid');
 assert.equal(trackingReviewState({...point,reviewExcluded:true,frameIdentityConfirmed:true}).status,'missing');
});

test('tracking confirmation changes just the reviewed frame and survives export without confirming calibration',()=>{
 const session=blankSession('v');confirmIdentity(session,'P1',0,{trackId:1,box:frames[0].tracks[0].slice(0,4)},frames);
 const before=structuredClone(session);confirmFrameIdentity(session,'P1',2,frames);
 const points=buildTrajectories(session,frames).P1;
 assert.equal(trackingReviewState(points[2]).status,'human');
 assert.equal(trackingReviewState(points[1]).status,'machine');assert.equal(trackingReviewState(points[3]).status,'machine');
 assert.equal(trackingReviewState(buildTrajectories(before,frames).P1[2]).status,'machine');
 acceptCourtCandidates(session,{keyframes:candidates,maxKeyframeGapSeconds:0},frames.length,'v');
 assert.deepEqual(status(session),Array(5).fill('machine'));
 const output=exportReview(session,{video_sha256:'v',width:500,height:400,frames},'now');
 assert.equal(output.entities[0].trajectory[2].frameIdentityConfirmed,true);
});

test('candidate adoption is blue; explicit projection confirmation is green only on that frame',()=>{
 const session=blankSession('v');assert.deepEqual(status(session),Array(5).fill('machine'));
 acceptCourtCandidates(session,{keyframes:candidates,maxKeyframeGapSeconds:0},frames.length,'v');
 assert.deepEqual(status(session),Array(5).fill('machine'));
 session.courtCalibration.keyframes[2]=confirmCalibrationProjection(session.courtCalibration.keyframes[2],2,'now');
 assert.deepEqual(status(session),['machine','machine','human','machine','machine']);
 const saved=JSON.parse(JSON.stringify(session));assert.deepEqual(status(saved),status(session));
 acceptCourtCandidates(saved,{keyframes:candidates,maxKeyframeGapSeconds:0},frames.length,'v');
 assert.deepEqual(status(saved),status(session),'batch adoption preserves explicit current-frame confirmation');
 confirmIdentity(saved,'P1',0,{trackId:1,box:frames[0].tracks[0].slice(0,4)},frames);
 const output=exportReview(saved,{video_sha256:'v',width:500,height:400,frames},'now');
 assert.ok(output.court.calibration.keyframes[2].projectionReviewFingerprint);
 assert.equal(output.court.metricAccuracyValidated,false);
});

test('machine candidate imports and propagated reference copies cannot inherit human green',()=>{
 const reviewed=confirmCalibrationProjection(key(0),0,'now');
 const imported=normalizeCourtCandidates({keyframes:[reviewed,{...reviewed,frame:1}]},frames.length);
 assert.ok(imported.every(item=>!item.projectionReviewedAt&&!item.projectionReviewFingerprint));
 const session=blankSession('v');acceptCourtCandidates(session,{keyframes:imported},frames.length,'v');
 assert.deepEqual(status(session,imported).slice(0,2),['machine','machine']);
 assert.equal(isCalibrationProjectionConfirmed({...reviewed,frame:1}),false);
});

test('manual edits, wrong-side changes, failed geometry, cuts and deleted references revoke review',()=>{
 const reviewed=confirmCalibrationProjection(key(2),2,'now');
 const changed=structuredClone(reviewed);changed.points[0].image[0]+=1;
 assert.equal(isCalibrationProjectionConfirmed(changed),false);
 assert.equal(isCalibrationProjectionConfirmed(reorientCalibrationKey(reviewed,'right')),false);
 assert.equal(isCalibrationProjectionConfirmed({...reviewed,status:'needs_review'}),false);
 assert.equal(isCalibrationProjectionConfirmed({...reviewed,points:[]}),false);
 const session=blankSession('v');acceptCourtCandidates(session,{keyframes:candidates,maxKeyframeGapSeconds:0},frames.length,'v');
 session.courtCalibration.keyframes[2]=reviewed;
 assert.deepEqual(status(session,candidates,[2]),['machine','machine','human','invalid','invalid']);
 invalidateCameraDependents(session.courtCalibration,0,{referenceDeleted:true});
 assert.deepEqual(status(session),['invalid','invalid','human','invalid','invalid']);
});

test('manual provenance, model acceptance and interpolated neighbors never imply explicit human review',()=>{
 const human={...key(0),source:'human',status:'manual_confirmed',points:key(0).points.map(p=>({...p,source:'human'}))};
 const session={courtCalibration:{keyframes:[human]}};
 assert.equal(status(session,[])[0],'pending');
 const first=confirmCalibrationProjection(human,0,'now'),last=confirmCalibrationProjection({...human,frame:4},4,'now');
 session.courtCalibration={keyframes:[first,last],maxKeyframeGapSeconds:1.2};
 assert.deepEqual(status(session,[]),['human','pending','pending','pending','human']);
 const legacy={...first};delete legacy.projectionReviewFingerprint;
 assert.equal(isCalibrationProjectionConfirmed(legacy),true,'legacy explicit review timestamps remain usable');
});
