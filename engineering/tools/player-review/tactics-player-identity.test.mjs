import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createSourceBinding} from '../tactical-overlay/binding.mjs';
const helpers=await import('./tactics-player-identity.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});

async function fixture(){
  const d={schemaVersion:1,title:'identity',notes:'',...await makePresentationDemo()};
  for(const entity of d.review.entities)for(const point of entity.trajectory)point.box=[point.x-20,point.y-80,point.x+20,point.y];
  const e=d.review.entities[0],p=e.trajectory[12];
  e.identityReference={version:1,videoHash:d.review.videoSha256,trackingFingerprint:d.review.trackingFingerprint,frame:12,trackId:1,box:p.box.slice(),team:'紫色球衣',jersey:'00'};
  d.playDefinition.sourceBinding=await createSourceBinding(d.review);return d;
}

test('labels use only source-matched clip references, preserve jersey 00, and never infer from NBA metadata or team colors',async()=>{
  assert.equal(typeof helpers.tacticsPlayerLabel,'function');const d=await fixture(),e=d.review.entities[0];
  assert.equal(helpers.tacticsPlayerLabel(d.review,'P1'),'紫色球衣 00 号 · 球员 1');
  e.playerProfile={status:'confirmed',name:'An NBA name',jersey_number:'30'};e.jersey='30';e.team='Warriors';e.teamSide='blue';
  e.identityReference.trackingFingerprint='old';
  assert.equal(helpers.tacticsPlayerLabel(d.review,'P1'),'球员 1 · 身份待确认');
  delete e.identityReference;assert.equal(helpers.tacticsPlayerLabel(d.review,'P1'),'球员 1 · 身份待确认');
});

test('current crops use exact observed bounds and frame review does not inherit from reference identity',async()=>{
  assert.equal(typeof helpers.tacticsPlayerInspection,'function');const d=await fixture();
  const inspection=helpers.tacticsPlayerInspection(d,'P1',13);
  assert.deepEqual(inspection.current.box,d.review.entities[0].trajectory[13].box);
  assert.equal(inspection.current.frame,13);assert.equal(inspection.current.reviewed,false);
  d.review.entities[0].trajectory[13].frameIdentityConfirmed=true;
  assert.equal(helpers.tacticsPlayerInspection(d,'P1',13).current.reviewed,true);
});

test('missing and conflicted current frames fall back to an explicitly identified reference or nearest observed frame',async()=>{
  assert.equal(typeof helpers.tacticsPlayerInspection,'function');const d=await fixture(),e=d.review.entities[0];
  e.trajectory[20]={frame:20,time:2,source:'conflict',x:null,y:null,box:[0,0,40,80]};
  let i=helpers.tacticsPlayerInspection(d,'P1',20);assert.equal(i.current,null);assert.equal(i.target.frame,12);assert.equal(i.target.kind,'reference');
  delete e.identityReference;i=helpers.tacticsPlayerInspection(d,'P1',20);
  assert.equal(i.target.frame,19);assert.equal(i.target.kind,'observation');
  for(const p of e.trajectory){p.source='missing';p.x=null;p.y=null;}
  i=helpers.tacticsPlayerInspection(d,'P1',20);assert.equal(i.current,null);assert.equal(i.target,null);
});

test('reference source mismatches and invalid rectangles cannot provide a deceptive preview',async()=>{
  assert.equal(typeof helpers.tacticsPlayerInspection,'function');const d=await fixture(),e=d.review.entities[0];
  e.identityReference.videoHash='another-video';for(const p of e.trajectory)p.box=[NaN,0,20,80];
  const i=helpers.tacticsPlayerInspection(d,'P1',12);assert.equal(i.reference,null);assert.equal(i.current,null);assert.equal(i.target,null);
});

test('fallback targets remain reachable inside a phase while labels may still use an earlier saved reference',async()=>{
  const d=await fixture(),e=d.review.entities[0];
  d.playDefinition.phases=d.playDefinition.phases.slice(-1);
  for(const p of e.trajectory)if(p.frame>=d.playDefinition.phases[0].startFrame){p.source='missing';p.x=null;p.y=null;}
  const i=helpers.tacticsPlayerInspection(d,'P1',42);
  assert.equal(i.reference.frame,12);assert.equal(i.current,null);assert.equal(i.target,null);
});
