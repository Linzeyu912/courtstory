import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession} from './trajectory.mjs';
import {buildCourtPreparation,preparationDependencies,courtPreparationStatus,validateCourtPreparation} from './court-preparation.mjs';
export function fixture(){
  const frames=Array.from({length:21},(_,frame)=>({frame,time:frame*.04,tracks:[[90+frame,40,110+frame,80,1,.9,0]]}));
  const clip={video_sha256:'a'.repeat(64),tracking_fingerprint:'b'.repeat(64),frames,mediaEndTime:.91,width:640,height:480};
  const session=blankSession(clip.video_sha256);session.entities[0].bindings=[{kind:'track',trackId:1,start:0,end:20}];
  const maps=frames.map(()=>({toCourt:[.05,0,0,0,.05,0,0,0,1],toImage:[20,0,0,0,20,0,0,0,1],method:'test',supportFrames:[0],supportHulls:[],referenceOnly:true,quality:null}));
  return {session,clip,maps};
}
test('prepared data preserves raw points, manual locks, null gaps and frame mappings',()=>{
  const f=fixture();f.session.entities[0].anchors=[{frame:2,x:100,y:70}];f.maps[4]=null;
  const p=buildCourtPreparation(f);validateCourtPreparation(p);
  assert.equal(p.rawByPlayer.P1[2].locked,true);assert.equal(p.rawByPlayer.P1[4].x,null);
  assert.deepEqual(p.preparedByPlayer,p.rawByPlayer);assert.equal(p.mediaEndTime,.91);
  assert.deepEqual(JSON.parse(JSON.stringify(p)),p);
});
test('dependencies invalidate calibration and identity, but ignore a player display name',()=>{
  const f=fixture(),p=buildCourtPreparation(f);f.session.entities[0].name='renamed';
  assert.equal(courtPreparationStatus(p,preparationDependencies(f.session,f.clip)).current,true);
  f.session.entities[0].bindings[0].end=19;
  assert.equal(courtPreparationStatus(p,preparationDependencies(f.session,f.clip)).current,false);
});
test('bounded machine association invalidates prepared coordinates while name-only proposals do not',()=>{
  const f=fixture(),p=buildCourtPreparation(f),entity=f.session.entities[0];
  entity.machineNameIdentities=[{name:'Machine Name',trackId:1,start:2,end:6}];
  entity.machinePlayerProfile={status:'candidate',name:'Machine Name'};
  assert.equal(courtPreparationStatus(p,preparationDependencies(f.session,f.clip)).current,true);
  entity.machineIdentityBindings=[{kind:'track',trackId:1,start:2,end:6,
    baseVideoHash:f.clip.video_sha256,baseTrackingFingerprint:f.clip.tracking_fingerprint,
    baseTrackingRevision:f.clip.tracking_revision,evidenceMethod:'direct_jersey'}];
  assert.deepEqual(courtPreparationStatus(p,preparationDependencies(f.session,f.clip)).reasons,['identities']);
});
