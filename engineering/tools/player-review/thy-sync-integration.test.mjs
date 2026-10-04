import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession,buildTrajectories,exportReview,setPlayerVisibility} from './trajectory.mjs';
import {correctImageRange} from './image-edit.mjs';
import {selectGroundComparison} from './ground-position.mjs';
import {adoptJerseyReading} from './identity-ocr.mjs';
import {createIdentityReference,saveReferenceToSession,applyIdentityCandidates} from './identity-continuation.mjs';

function fixture(){
  const clip={video_sha256:'sync-video',tracking_fingerprint:'sync-tracks',width:1000,height:700,sourceCuts:[],
    frames:Array.from({length:16},(_,frame)=>({frame,time:frame/10,tracks:[
      [100+frame,20,140+frame,180,2,.9,0],[400+frame,30,450+frame,200,62,.9,0]]}))};
  const session=blankSession(clip.video_sha256);
  session.entities[0].modelBindings=[{kind:'track',trackId:2,start:0,end:15}];
  const image=[[100,100],[400,120],[350,350],[50,330]];
  session.courtCalibration={maxKeyframeGapSeconds:2,keyframes:[0,15].map(frame=>({frame,side:'left',source:'human',image}))};
  return {clip,session};
}

test('THY foot range corrections outrank pose candidates and preserve visibility and exported provenance',()=>{
  const {clip,session}=fixture();
  setPlayerVisibility(session,'P1',3,4,'out_of_view',clip.frames);
  selectGroundComparison(session,clip,{videoHash:session.videoHash,trackingFingerprint:clip.tracking_fingerprint,model:'fixture-pose',
    frames:clip.frames.map(f=>({frame:f.frame,time:f.time,people:[{trackId:2,anchor:[900,600]}]}))});
  const before=structuredClone(session),source=structuredClone(clip.frames);
  const result=correctImageRange(session,{entityId:'P1',start:1,end:6,mode:'foot',keyframes:[{frame:1,dx:4,dy:7}]},clip);
  assert.equal(result.preview.changed,4);
  assert.deepEqual(session,before);
  const image=buildTrajectories(result.session,clip.frames).P1;
  assert.equal(image[1].source,'manual_range');
  assert.equal(image[1].y,187);
  const exported=exportReview(result.session,clip,null),person=exported.entities.find(e=>e.id==='P1');
  assert.deepEqual(person.courtTrajectory[1].imagePoint,[125,187]);
  assert.deepEqual(person.courtTrajectory[1].rangeCorrection,image[1].rangeCorrection);
  assert.deepEqual(person.courtTrajectory[0].imagePoint,[900,600]);
  for(const frame of [3,4]){
    assert.equal(person.courtTrajectory[frame].x,null);
    assert.equal(person.courtTrajectory[frame].positionRequired,false);
  }
  assert.deepEqual(person.visibilityRanges,before.entities[0].visibilityRanges);
  assert.equal(exported.coordinatePolicy.displaySmoothingApplied,false);
  assert.deepEqual(clip.frames,source);
});

test('OCR on a stable player survives reference-based continuation and manual visibility records',()=>{
  const {clip,session}=fixture();
  const candidate={value:'00',evidence:[{frame:2,trackId:2}]};
  adoptJerseyReading(session,'P1',candidate,{mode:'jersey',videoSha256:session.videoHash,candidates:[candidate],engine:'fixture'});
  const reference=createIdentityReference(clip,{frame:2,trackId:2,team:'purple',jersey:'00'});
  const saved=saveReferenceToSession(session,{entityId:'P1',reference},clip);
  setPlayerVisibility(saved,'P1',9,9,'out_of_view',clip.frames);
  const original=structuredClone(saved);
  const result=applyIdentityCandidates(saved,{entityId:'P1',reference,segments:[{
    id:'continued',trackId:62,start:8,end:12,confidence:.8,reason:'same jersey',evidenceFrames:[8,10,12]}]},clip);
  const person=result.session.entities[0],points=buildTrajectories(result.session,clip.frames).P1;
  assert.equal(person.jersey,'00');
  assert.deepEqual(person.jerseyEvidence,original.entities[0].jerseyEvidence);
  assert.deepEqual(person.identityReference,reference);
  assert.deepEqual(person.visibilityRanges,original.entities[0].visibilityRanges);
  assert.equal(points[8].trackId,62);assert.equal(points[8].frameIdentityConfirmed,false);
  assert.equal(points[9].source,'out_of_view');assert.equal(points[9].x,null);
  assert.equal(points[13].trackId,2);
  assert.deepEqual(saved,original);
});

test('an empty tactics draft can still export without inventing selected players or court coordinates',()=>{
  const {clip}=fixture(),session=blankSession(clip.video_sha256);
  const output=exportReview(session,clip,null,{allowEmpty:true});
  assert.equal(output.selectionConfirmed,false);assert.deepEqual(output.entities,[]);
  assert.equal(output.courtMappings.length,clip.frames.length);
  assert(output.ballCourtTrajectory.every(point=>point.x==null));
  assert.throws(()=>exportReview(session,clip,null),/Select at least one target/);
});
