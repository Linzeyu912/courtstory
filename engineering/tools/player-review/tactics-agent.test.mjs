import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createTacticsDocument,validateDocument} from './tactics-document.mjs';
const agent=await import('./tactics-agent.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const setup=async()=>{const {review}=await makePresentationDemo();return createTacticsDocument(review);};
const result={summary:'P1 向篮下切入',issues:[],phases:[{title:'切入',startFrame:0,endFrameExclusive:61,freezeFrame:12,reason:'观察到切入',evidenceFrames:[12,20],actions:[],annotations:[{type:'route',entityId:'P1',space:'video',anchorFrame:12,startFrame:12,endFrameExclusive:30,points:[{x:600,y:400},{x:720,y:320}],angle:0,size:1.5,color:'#26baff',explanation:'概括未来切入',evidenceFrames:[12,20]}]}]};
test('Agent data creates editable bound drawings without changing the observation snapshot or approving evidence',async()=>{
  assert.equal(typeof agent.adoptAgentCandidate,'function');const doc=await setup(),before=structuredClone(doc);
  const adopted=await agent.adoptAgentCandidate(doc,result,{jobId:'job-one',scope:'play',phaseId:'phase-1'});
  assert.equal(adopted.annotations.items.length,1);assert.equal(adopted.annotations.items[0].origin.kind,'agent');
  assert.deepEqual(adopted.review,before.review);assert.deepEqual(adopted.playDefinition.reviewEvidence,[]);
  assert.equal(adopted.playDefinition.phases[0].freezeFrame,12);await validateDocument(adopted);
  const repeated=await agent.adoptAgentCandidate(adopted,result,{jobId:'job-one',scope:'play',phaseId:'phase-1'});
  assert.deepEqual(repeated,adopted);
});
test('Agent schema rejects foreign identities, out of range time, unknown command fields and uncalibrated court geometry',async()=>{
  assert.equal(typeof agent.adoptAgentCandidate,'function');const doc=await setup();
  for(const change of [r=>r.command='run',r=>r.phases[0].annotations[0].entityId='stranger',r=>r.phases[0].annotations[0].endFrameExclusive=62,r=>r.phases[0].annotations[0].points.push({x:-1,y:1})]){
    const bad=structuredClone(result);change(bad);await assert.rejects(()=>agent.adoptAgentCandidate(doc,bad,{jobId:'bad',scope:'play',phaseId:'phase-1'}));
  }
  doc.review.court.calibration={keyframes:[]};const bad=structuredClone(result);bad.phases[0].annotations[0].space='court';
  await assert.rejects(()=>agent.adoptAgentCandidate(doc,bad,{jobId:'bad',scope:'play',phaseId:'phase-1'}));
});
test('Agent append preserves existing phase settings and detects unsaved document edits through a content digest',async()=>{
  assert.equal(typeof agent.documentDigest,'function');const doc=await setup(),before=await agent.documentDigest(doc);
  doc.notes='unsaved edit';assert.notEqual(await agent.documentDigest(doc),before);
  const appended=structuredClone(result);appended.phases[0].freezeFrame=doc.playDefinition.phases[0].freezeFrame;
  const adopted=await agent.adoptAgentCandidate(doc,appended,{jobId:'append',scope:'phase',phaseId:'phase-1'});
  assert.deepEqual(adopted.playDefinition.phases,doc.playDefinition.phases);assert.equal(adopted.notes,'unsaved edit');
});
test('phase append rejects a different candidate freeze rather than previewing a frame adoption will never use',async()=>{
  const doc=await setup();
  await assert.rejects(()=>agent.adoptAgentCandidate(doc,result,{jobId:'freeze-mismatch',scope:'phase',phaseId:'phase-1'}),/暂停/);
});
