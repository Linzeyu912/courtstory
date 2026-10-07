import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createTacticsDocument,validateDocument,splitPhase,removePhase,upsertAction,removeAction,reviewAction,refreshSnapshot} from './tactics-document.mjs';
import {createAnnotation,annotationStatus} from './tactics-annotations.mjs';

async function anonymousAgentFixture(){
  let d=await fixture();
  d=createAnnotation(d,{id:'observed-route',type:'route',phaseId:'phase-1',entityId:null,frame:12,space:'video',points:[{x:400,y:500},{x:600,y:450}],origin:{kind:'agent',jobId:'real-source-job',sourceFrames:[12,20],note:'observed route'}});
  return d;
}
test('name-only refresh preserves active anonymous source-video Agent drawings without changing their evidence',async()=>{
  const d=await anonymousAgentFixture(),before=structuredClone(d),review=structuredClone(d.review);review.entities[0].name='corrected same player';
  const next=await refreshSnapshot(d,review);await validateDocument(next);
  assert.equal(annotationStatus(next).active.length,1);
  const {sourceBinding,...drawing}=next.annotations.items[0],{sourceBinding:oldBinding,...oldDrawing}=d.annotations.items[0];
  assert.notEqual(sourceBinding.reviewDigest,oldBinding.reviewDigest);assert.deepEqual(drawing,oldDrawing);assert.deepEqual(d,before);
});
test('refresh never resurrects stale, owned, court or manually modified graphics',async()=>{
  for(const patch of [{sourceBinding:{reviewDigest:'0'.repeat(64)}},{phaseSnapshot:{freezeFrame:1}},{entityId:'P1'},{space:'court',points:[{x:10,y:10},{x:12,y:10}]},{origin:{kind:'human_modified'}},{preparationBinding:{revision:99}}]){
    const d=await anonymousAgentFixture(),a=d.annotations.items[0];
    for(const [key,value] of Object.entries(patch))a[key]=['sourceBinding','phaseSnapshot','origin'].includes(key)?{...a[key],...value}:value;
    const review=structuredClone(d.review);review.entities[0].name='corrected';const next=await refreshSnapshot(d,review);
    assert.equal(annotationStatus(next).active.length,0,JSON.stringify(patch));
  }
});
test('anonymous Agent refresh requires unchanged original source, complete PTS, dimensions, media end and cuts',async()=>{
  const changes=[r=>r.videoSha256='other',r=>r.sourceVideoSha256='other-root',r=>r.width++,r=>r.trackingFingerprint='other-model',r=>r.sourceFrameMapping[2].sourceTime+=.01,r=>r.sourceFrameMapping[2].sourceFrame++,r=>r.mediaEndTime=(r.mediaEndTime??7)+.1,r=>r.settings.cuts=[10],r=>r.settings.sourceCuts=[10]];
  for(const change of changes){
    const d=await anonymousAgentFixture(),review=structuredClone(d.review);review.settings??={};change(review);
    try{const next=await refreshSnapshot(d,review);assert.equal(annotationStatus(next).active.length,0);}catch(error){assert.match(error.message,/视频|尺寸|模型/);}
  }
});
test('an apparently active drawing cannot borrow an unverified old document binding during refresh',async()=>{
  const d=await anonymousAgentFixture();d.review.entities[0].name='changed outside explicit refresh';
  assert.equal(annotationStatus(d).active.length,1);
  const review=structuredClone(d.review);review.entities[0].name='changed again';
  assert.equal(annotationStatus(await refreshSnapshot(d,review)).active.length,0);
});

const fixture=async()=>createTacticsDocument((await makePresentationDemo()).review);
test('a new tactical document binds the complete snapshot and starts without invented actions',async()=>{
  const d=await fixture();await validateDocument(d);assert.equal(d.playDefinition.actions.length,0);
  assert.equal(d.playDefinition.participants.length,d.review.entities.length);
});
test('phase split and merge cover every frame and keep overlapping complete actions',async()=>{
  let d=await fixture();const n=d.review.sourceFrameMapping.length,actorId=d.playDefinition.participants[0].id;
  d=upsertAction(d,{actorId,kind:'move',startFrame:0,endFrameExclusive:n});
  d=splitPhase(d,'phase-1',10);await validateDocument(d);
  assert.equal(d.playDefinition.phases[0].endFrameExclusive,d.playDefinition.phases[1].startFrame);
  assert.equal(d.playDefinition.phases[1].actionIds.length,1);
  d=removePhase(d,'phase-1');await validateDocument(d);assert.equal(d.playDefinition.phases[0].startFrame,0);
});
test('changing an action retracts its review and relation evidence without changing source tracks',async()=>{
  let d=await fixture();const before=structuredClone(d.review),[actor,beneficiary]=d.playDefinition.participants;
  d=upsertAction(d,{actorId:actor.id,kind:'screen',beneficiaryId:beneficiary.id,startFrame:0,endFrameExclusive:5});
  const id=d.playDefinition.actions[0].actionId;
  d=reviewAction(d,id,'manual-reviewer',true);assert.equal(d.playDefinition.reviewEvidence.length,1);
  d=upsertAction(d,{actionId:id,actorId:actor.id,kind:'move',startFrame:1,endFrameExclusive:6});
  await validateDocument(d);assert.equal(d.playDefinition.reviewEvidence.length,0);assert.equal(d.playDefinition.relations.length,0);assert.deepEqual(d.review,before);
});
test('deleting a reviewed action removes its relations and references in every phase',async()=>{
  let d=await fixture();d=upsertAction(d,{actorId:d.playDefinition.participants[0].id,kind:'move',startFrame:0,endFrameExclusive:5});
  d=reviewAction(d,d.playDefinition.actions[0].actionId,'reviewer',true);
  d=removeAction(d,d.playDefinition.actions[0].actionId);await validateDocument(d);assert.deepEqual(d.playDefinition.phases[0].actionIds,[]);assert.equal(d.playDefinition.reviewEvidence.length,0);
});
test('invalid ranges, repeated relationship participants and unnamed reviews do not mutate drafts',async()=>{
  const d=await fixture(),before=structuredClone(d),actorId=d.playDefinition.participants[0].id;
  assert.throws(()=>splitPhase(d,'phase-1',0));
  assert.throws(()=>upsertAction(d,{actorId,kind:'move',startFrame:9,endFrameExclusive:4}));
  assert.throws(()=>upsertAction(d,{actorId,kind:'screen',beneficiaryId:actorId,startFrame:0,endFrameExclusive:4}));
  assert.throws(()=>reviewAction(d,'no-action','',true));assert.deepEqual(d,before);
});
test('review or calibration changes reject the old binding and explicit refresh resets review evidence',async()=>{
  let d=await fixture();d=upsertAction(d,{actorId:d.playDefinition.participants[0].id,kind:'move',startFrame:0,endFrameExclusive:5});
  d=reviewAction(d,d.playDefinition.actions[0].actionId,'reviewer',true);
  const review=structuredClone(d.review);review.entities[0].name='corrected name';
  await assert.rejects(validateDocument({...d,review}));
  const refreshed=await refreshSnapshot(d,review);await validateDocument(refreshed);
  assert.equal(refreshed.playDefinition.reviewEvidence.length,0);assert.equal(refreshed.playDefinition.actions[0].reviewStatus,'needs_review');
});
test('source changes cannot rebind a plan to another model or frame mapping',async()=>{
  const d=await fixture();await assert.rejects(refreshSnapshot(d,{...d.review,trackingFingerprint:'another-model'}));
  const review=structuredClone(d.review);review.sourceFrameMapping[0].sourceTime+=1;await assert.rejects(refreshSnapshot(d,review));
});

test('optional presentation data rejects malformed edits instead of accepting unsafe imported coordinates',async()=>{
  const d=await fixture();
  for(const presentation of [null,{schemaVersion:2,routes:[]},{schemaVersion:1,routes:[{routeId:'unsafe',controlPoints:[{frame:0,x:Infinity,y:1}]}]}]){
    await assert.rejects(validateDocument({...d,presentation}),/展示修正/);
  }
  await validateDocument({...d,presentation:{schemaVersion:1,routes:[]}});
});

test('explicit V1 migration keeps its source geometry and legacy output timing with a separate backup',async()=>{
  const {migrateTacticsDocument}=await import('./tactics-document.mjs'),{createAnnotation,annotationStatus}=await import('./tactics-annotations.mjs'),{compileProduction}=await import('./tactics-production.mjs');
  const old=createAnnotation(await fixture(),{id:'old-route',type:'route',phaseId:'phase-1',entityId:null,frame:12,space:'court',points:[{x:18,y:10},{x:22,y:9}]}),before=structuredClone(old);
  const {document:migrated,backup}=await migrateTacticsDocument(old,6.2);
  assert.deepEqual(old,before);assert.deepEqual(backup,before);assert.equal(migrated.legacyTiming,true);await validateDocument(migrated);
  assert.equal(annotationStatus(migrated).stale.length,0);assert.deepEqual(migrated.annotations.items[0].points,old.annotations.items[0].points);
  assert.deepEqual(compileProduction(migrated).frames,compileProduction(old).frames);
});
