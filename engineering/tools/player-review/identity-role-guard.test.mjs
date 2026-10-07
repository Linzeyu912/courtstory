import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession,buildTrajectories,confirmFrameIdentity,exportReview} from './trajectory.mjs';
import {buildCourtPreparation,preparationDependencies,courtPreparationStatus} from './court-preparation.mjs';
import {currentInitialRoleExclusions} from './identity-role-guard.mjs';
import {automaticAnnotationPointVisible} from './automatic-annotations.mjs';

function fixture(){
  const clip={video_sha256:'video',tracking_fingerprint:'raw-tracking-unchanged',tracking_revision:'detector',width:1000,height:720,mediaEndTime:.9,sourceCuts:[],trackingMetadata:{model_names:{0:'player',1:'referee'}},
    frames:Array.from({length:9},(_,frame)=>({frame,time:frame/10,tracks:[[100+frame,80,150+frame,180,1,.9,0]],track_roles:{1:'player'}}))};
  const session=blankSession('video');session.maxGapSeconds=1;
  session.entities[0].modelBindings=[{kind:'track',trackId:1,start:0,end:8,identityConfirmed:false,reviewRequired:true}];
  return {clip,session};
}

test('source role conflicts block machine coordinates in raw trajectories, export and 2D without mutating bindings',()=>{
  const {clip,session}=fixture(),old=structuredClone(session);
  clip.frames[4].track_evidence={1:{identity_review_required:true,role_conflict:true}};
  // The legacy three-argument path still honors evidence stored in each frame.
  const legacy=buildTrajectories(session,clip.frames,clip.sourceCuts).P1[4];
  assert.equal(legacy.x,null);assert.equal(legacy.source,'missing');assert.equal(legacy.identityRisk,'role_conflict');
  assert.equal(legacy.frameIdentityConfirmed,false);
  const review=exportReview(session,clip,null,{allowEmpty:true});
  assert.equal(review.entities[0].trajectory[4].x,null);
  const map={toCourt:[.01,0,0,0,.01,0,0,0,1],method:'test',supportFrames:[],referenceOnly:true,quality:{},supportHulls:[]};
  const prepared=buildCourtPreparation({session,clip,maps:clip.frames.map(()=>map)});
  assert.equal(prepared.preparedByPlayer.P1[4].x,null);
  assert.deepEqual(session,old,'role gating changes derived coordinates only');
});

test('explicit role, duplicate observations and model class referee all block machine points',()=>{
  for(const kind of ['declared','duplicate','class','conflict']){
    const {clip,session}=fixture();
    if(kind==='declared')clip.frames[4].track_roles[1]='referee';
    if(kind==='duplicate')clip.frames[4].tracks.push([110,80,160,180,1,.8,0]);
    if(kind==='class')clip.frames[4].tracks[0][6]=1;
    if(kind==='conflict')clip.frames[4].role_conflicts=[{playerTrackId:1,refereeTrackId:3}];
    const point=buildTrajectories(session,clip.frames,[],clip).P1[4];
    assert.equal(point.x,null,kind);assert.equal(point.roleConflict,true,kind);
  }
});

test('valid frame confirmations, explicit human bindings and manual foot edits keep priority without retokenizing',()=>{
  const {clip,session}=fixture();confirmFrameIdentity(session,'P1',4,clip.frames,[],clip);
  const before=structuredClone(session.entities[0]);clip.frames[4].track_evidence={1:{role_conflict:true}};
  let points=buildTrajectories(session,clip.frames,[],clip).P1;
  assert.equal(points[4].frameIdentityConfirmed,true);assert.equal(points[4].x,129);
  assert.deepEqual(session.entities[0],before);
  const withReview=preparationDependencies(session,clip),withoutReview=structuredClone(session);withoutReview.entities[0].frameConfirmations=[];
  assert.notEqual(withReview.identities,preparationDependencies(withoutReview,clip).identities);
  clip.frames[3].track_evidence={1:{role_conflict:true}};
  session.entities[0].anchors.push({frame:3,x:90,y:250,trackId:null,identityConfirmed:false,footMethod:'human_image_anchor'});
  points=buildTrajectories(session,clip.frames,[],clip).P1;assert.equal(points[3].x,90);assert.equal(points[3].source,'manual');
  assert.equal(points[3].frameIdentityConfirmed,false);
  assert.equal(automaticAnnotationPointVisible(clip,3,points[3],session),true);
  session.entities[0].bindings=[{kind:'track',trackId:1,start:1,end:2,origin:'human_range_replacement',order:1,exclusive:true}];
  clip.frames[2].track_evidence={1:{role_conflict:true}};
  assert.equal(buildTrajectories(session,clip.frames,[],clip).P1[2].x,127);
});

test('bounded initial exclusions require the full current source stamp and never become interpolated coordinates',()=>{
  const {clip,session}=fixture();
  session.initialIdentityReview={version:1,videoHash:clip.video_sha256,trackingFingerprint:clip.tracking_fingerprint,trackingRevision:clip.tracking_revision,exclusions:[{trackId:1,start:3,end:5,role:'referee'}]};
  const points=buildTrajectories(session,clip.frames,[],clip).P1;
  assert(points.slice(3,6).every(point=>point.x===null&&point.identityRisk==='initial_review_non_player'));
  assert.equal(points[2].source,'tracked');assert.equal(points[6].source,'tracked');
  for(const field of ['videoHash','trackingFingerprint','trackingRevision']){
    const stale=structuredClone(session);stale.initialIdentityReview[field]='other';
    assert.deepEqual(currentInitialRoleExclusions(stale,clip),[]);assert.equal(buildTrajectories(stale,clip.frames,[],clip).P1[4].source,'tracked');
  }
});

test('role policy and actual role evidence invalidate prepared data even when the tracking fingerprint stays stable',()=>{
  const {clip,session}=fixture(),before=preparationDependencies(session,clip);
  clip.frames[4].track_evidence={1:{role_conflict:true}};
  const after=preparationDependencies(session,clip);
  assert.equal(before.tracking,after.tracking);assert.equal(before.identities,after.identities);assert.notEqual(before.roles,after.roles);
  assert.equal(courtPreparationStatus({dependencies:before,frameMapping:clip.frames},after).current,false);
  const legacy={...before};delete legacy.roles;
  assert.equal(courtPreparationStatus({dependencies:legacy,frameMapping:clip.frames},before).current,false);
  const noExclusions=preparationDependencies(session,clip);
  session.initialIdentityReview={version:1,videoHash:clip.video_sha256,trackingFingerprint:clip.tracking_fingerprint,trackingRevision:clip.tracking_revision,exclusions:[{trackId:1,start:3,end:5,role:'other'}]};
  assert.notEqual(preparationDependencies(session,clip).roles,noExclusions.roles);
});
