import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createTacticsDocument,validateDocument} from './tactics-document.mjs';
import {createAnnotation} from './tactics-annotations.mjs';
import * as annotations from './tactics-annotations.mjs';
import {DEFAULT_RIBBON} from './tactics-authored-geometry.mjs';
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

test('adoption rejects every invisible new drawing even when existing human and another new drawing are visible',async()=>{
  let doc=await setup();doc=createAnnotation(doc,{id:'human',type:'screen',entityId:null,phaseId:'phase-1',frame:0,space:'video',points:[{x:300,y:300}]});
  const bad=structuredClone(result);bad.phases[0].freezeFrame=0;
  bad.phases[0].annotations.push({...structuredClone(bad.phases[0].annotations[0]),points:[{x:400,y:400},{x:400,y:400}]});
  const before=structuredClone(doc);
  await assert.rejects(()=>agent.adoptAgentCandidate(doc,bad,{jobId:'zero-route',scope:'phase',phaseId:'phase-1'}),/第 2 个图形.*completed/);
  assert.deepEqual(doc,before);
});

test('a following Agent spotlight needs a real foot at its own anchor even if later positions exist',async()=>{
  const {review}=await makePresentationDemo();review.entities[0].trajectory=review.entities[0].trajectory.filter(p=>p.frame!==12);
  const doc=await createTacticsDocument(review),bad=structuredClone(result);
  bad.phases[0].annotations[0]={...bad.phases[0].annotations[0],type:'spotlight',points:[{x:600,y:400}]};
  await assert.rejects(()=>agent.adoptAgentCandidate(doc,bad,{jobId:'missing-foot',scope:'play',phaseId:'phase-1'}),/第 1 个图形.*missing_position/);
});

test('single-frame court and following drawings produce presentation cues without moving the phase freeze',async()=>{
  const doc=await setup(),candidate=structuredClone(result),annotation=candidate.phases[0].annotations[0];
  candidate.phases[0].freezeFrame=0;
  candidate.phases[0].annotations=[
    {...annotation,type:'screen',entityId:null,space:'court',anchorFrame:12,startFrame:12,endFrameExclusive:13,points:[{x:18,y:10}]},
    {...annotation,type:'spotlight',anchorFrame:20,startFrame:20,endFrameExclusive:21,points:[{x:600,y:400}]}];
  const adopted=await agent.adoptAgentCandidate(doc,candidate,{jobId:'single-frames',scope:'phase',phaseId:'phase-1'});
  assert.equal(typeof annotations.annotationPresentation,'function');const report=annotations.annotationPresentation(adopted);
  assert.equal(adopted.playDefinition.phases[0].freezeFrame,0);
  assert.deepEqual(report.pausePoints.map(p=>p.frame),[12,20]);
  assert.ok(report.items.every(i=>i.visible&&i.mode==='reference_frame'));
});

test('Agent adoption rejects a finite court drawing whose projected paint is entirely outside the viewport',async()=>{
  const {review}=await makePresentationDemo();
  for(const key of review.court.calibration.keyframes)for(const point of key.points)point.image[0]+=1000;
  const doc=await createTacticsDocument(review),candidate=structuredClone(result);
  candidate.phases[0].annotations[0]={...candidate.phases[0].annotations[0],type:'screen',entityId:null,space:'court',anchorFrame:20,points:[{x:26,y:7}]};
  await assert.rejects(()=>agent.adoptAgentCandidate(doc,candidate,{jobId:'offscreen',scope:'play',phaseId:'phase-1'}),/第 1 个图形.*outside_viewport/);
});

const v2=()=>{const candidate=structuredClone(result);candidate.schemaVersion=2;
  candidate.production={cameras:[{id:'view',phaseIndex:0,approximate:true,groundQuad:[[0,0],[10,0],[10,10],[0,10]],keyframes:[{frame:0,quad:[[100,100],[1100,100],[1100,650],[100,650]],evidenceFrames:[0]},{frame:60,quad:[[120,100],[1120,100],[1120,650],[120,650]],evidenceFrames:[60]}]}],timeline:{timebaseFps:30,cues:[{phaseIndex:0,frame:12,settleFrames:5,drawFrames:21,holdFrames:49,easing:'smoothstep'}],endHoldFrames:18}};
  candidate.phases[0].annotations[0].points=[{x:250,y:500},{x:450,y:300},{x:650,y:300},{x:850,y:500}];
  candidate.phases[0].annotations[0].authoredPath={version:1,curve:'cubic_bezier',cameraId:'view',progressFrames:[{frame:12,t:0},{frame:30,t:1}],ribbon:structuredClone(DEFAULT_RIBBON)};return candidate;
};
test('Agent V2 binds approximate production cameras on host and preserves V1 strict compatibility',async()=>{
  const doc=await setup(),candidate=v2(),adopted=await agent.adoptAgentCandidate(doc,candidate,{jobId:'v2',scope:'play',phaseId:'phase-1'});
  assert.equal(adopted.production.cameras[0].id,'v2-camera-view');assert.equal(adopted.production.cameras[0].origin.kind,'agent');
  assert.equal(adopted.annotations.items[0].authoredPath.cameraDigest,adopted.production.cameras[0].digest);assert.deepEqual(adopted.review,doc.review);
  assert.ok(annotations.projectAnnotations(adopted,{phaseId:'v2-phase-0',frame:20}).items[0].video.ribbon);await validateDocument(adopted);
  for(const change of [c=>delete c.production,c=>delete c.phases[0].annotations[0].authoredPath,c=>c.production.cameras[0].approximate=false,c=>c.phases[0].annotations[0].authoredPath.cameraDigest='0'.repeat(64),c=>c.production.cameras[0].phaseIndex=2,
    c=>c.production.cameras[0].keyframes=[{...c.production.cameras[0].keyframes[0],frame:12}],c=>c.phases[0].annotations[0].authoredPath.progressFrames[1].t=.5]){const bad=v2();change(bad);await assert.rejects(agent.adoptAgentCandidate(doc,bad,{jobId:'bad-v2',scope:'play',phaseId:'phase-1'}));}
  const nullable=structuredClone(result);nullable.schemaVersion=2;nullable.production=null;nullable.phases[0].annotations[0].authoredPath=null;
  assert.equal((await agent.adoptAgentCandidate(doc,nullable,{jobId:'v2-null',scope:'play',phaseId:'phase-1'})).annotations.items.length,1);
});
