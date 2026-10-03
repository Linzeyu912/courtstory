import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createTacticsDocument,validateDocument,splitPhase,removePhase,upsertAction,removeAction,reviewAction,refreshSnapshot} from './tactics-document.mjs';

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
