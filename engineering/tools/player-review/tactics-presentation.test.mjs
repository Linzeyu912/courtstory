import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createSourceBinding} from '../tactical-overlay/binding.mjs';
import {createTacticsDocument,validateDocument,splitPhase,removePhase,refreshSnapshot} from './tactics-document.mjs';
let api={};
try{api=await import('./tactics-presentation.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const fixture=async()=>{
  const f=await makePresentationDemo();
  // Reuse observed positions and interval evidence, without an invented action.
  f.playDefinition.actions=[];f.playDefinition.relations=[];
  f.playDefinition.reviewEvidence=f.playDefinition.reviewEvidence.filter(e=>e.domain!=='tactic');
  f.playDefinition.phases=[{phaseId:'phase-1',order:0,title:'future',startFrame:0,endFrameExclusive:61,freezeFrame:0,
    participantIds:f.playDefinition.participants.map(p=>p.id),actionIds:[],relationIds:[]}];
  return {schemaVersion:1,title:'fixture',notes:'',...f};
};
const build=async(d,phaseId='phase-1')=>{
  assert.equal(typeof api.buildPhaseRoutes,'function','phase routes API is required');
  return api.buildPhaseRoutes(d,phaseId);
};
const route=(m,id='P1')=>m.routes.find(r=>r.entityId===id);
const length=ps=>ps.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-ps[i].x,p.y-ps[i].y),0);
const rebind=async d=>{d.playDefinition.sourceBinding=await createSourceBinding(d.review);return d;};

test('phase participants get future routes without actions and generated routes never mutate a snapshot',async()=>{
  const d=await fixture(),before=structuredClone(d);d.playDefinition.phases[0].freezeFrame=12;
  const m=await build(d);assert.equal(m.routes.length,6);
  assert.equal(route(m).startFrame,12);assert.equal(route(m).endFrameExclusive,61);
  assert.ok(route(m).curve.length>2);assert.deepEqual(d,{...before,playDefinition:{...before.playDefinition,phases:d.playDefinition.phases}});
});

test('missing positions, cuts, identities, calibration gaps and speed jumps split routes and never bridge',async()=>{
  for(const [change,code] of [
    [d=>Object.assign(d.review.entities[0].trajectory[20],{source:'missing',x:null,y:null}),'missing_position'],
    [d=>Object.assign(d.review.entities[0].trajectory[20],{source:'conflict',x:null,y:null}),'identity_conflict'],
    [d=>Object.assign(d.review.entities[0].trajectory[20],{source:'out_of_view',x:null,y:null}),'out_of_view'],
    [d=>d.review.entities[0].trajectory[20].source='interpolated','estimated_point'],
    [d=>d.review.settings.cuts.push(20),'source_cut'],
    [d=>{d.review.entities[0].trajectory[20].trackId=99;d.playDefinition.reviewEvidence=d.playDefinition.reviewEvidence.filter(e=>e.domain!=='continuity');},'identity_boundary'],
    [d=>d.review.court.calibration.keyframes[20].status='invalid','calibration_unavailable'],
    [d=>d.review.entities[0].trajectory[20].x+=600,'suspicious_jump']
  ]){
    const d=await fixture();change(d);await rebind(d);const m=await build(d);
    assert.ok(m.breaks.some(b=>b.code===code),code);
    assert.ok(!m.routes.filter(r=>r.entityId==='P1').some(r=>r.startFrame<20&&r.endFrameExclusive>21),code);
  }
});

test('bounded smoothing reduces jitter, preserves endpoints and retains a decisive turn with frame anchors',async()=>{
  const d=await fixture();for(const p of d.review.entities[0].trajectory){p.x=(10+p.frame*.05)*40;p.y=(5+(p.frame%2?.03:-.03)+(p.frame>30?(p.frame-30)*.1:0))*40;}
  await rebind(d);const r=route(await build(d)),raw=r.sourcePoints;
  assert.ok(length(r.curve)<length(raw)*.93);
  assert.deepEqual([r.curve[0].x,r.curve[0].y],[raw[0].x,raw[0].y]);
  assert.deepEqual([r.curve.at(-1).x,r.curve.at(-1).y],[raw.at(-1).x,raw.at(-1).y]);
  for(const p of r.curve){
    const left=Math.min(Math.floor(p.time/.1+1e-8),59),t=(p.time-left*.1)/.1;
    const a=raw[left],b=raw[left+1],x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
    assert.ok(Math.hypot(p.x-x,p.y-y)<=.120001);
  }
  assert.ok(r.controlPoints.some(p=>p.frame>=29&&p.frame<=31),'turn retains a nearby frame anchor');
});

test('media-time clipping removes travelled curve and endpoint ring at actual arrival without refitting',async()=>{
  const m=await build(await fixture()),r=route(m),before=structuredClone(r.curve);
  const clipped=api.clipRoute(r,1.25);assert.equal(clipped.curve[0].time,1.25);
  assert.ok(clipped.curve.every(p=>p.time>=1.25));assert.equal(clipped.curve.at(-1).time,3.5);
  assert.equal(api.clipRoute(r,3.5),null);assert.deepEqual(r.curve,before);
  const scene=api.projectPhaseRoutes(m,{frame:35,mediaTime:3.5,selectedEntityId:'P1'});assert.equal(scene.routes.length,0);
  assert.equal(api.projectPhaseRoutes(m,{frame:34,mediaTime:3.49,selectedEntityId:'P1'}).routes.length,1,'endpoint remains until actual arrival');
});

test('unknown presentation fields and oversized IDs cannot carry unbounded hidden payloads',async()=>{
  const d=await fixture(),r=route(await build(d)),edited=api.updateRouteControlPoints(d,r,[{frame:0,x:17,y:10},{frame:60,x:21,y:9}]);
  for(const mutate of [
    p=>p.hidden='extra',p=>p.routes[0].hidden='extra',p=>p.routes[0].source.hidden='extra',
    p=>p.routes[0].controlPoints[0].hidden='extra',p=>p.routes[0].source.phase.hidden='extra',
    p=>p.routes[0].source.sourceBinding.hidden='extra',p=>p.routes[0].routeId='x'.repeat(257)
  ]){const p=structuredClone(edited.presentation);mutate(p);assert.ok(api.validatePresentation(p).length);}
});

test('video drawing uses projected court chevrons with a light outline and preserves source aspect when resized',async()=>{
  const m=await build(await fixture()),scene=api.projectPhaseRoutes(m,{frame:0,selectedEntityId:'P1'});
  const svg=api.renderPresentationSVG(scene,{width:640,height:360});
  assert.match(svg,/viewBox="0 0 1280 720"/);assert.match(svg,/stroke="#fff/);
});

test('manual controls persist separately, use frame times, stay immutable and restore to the source',async()=>{
  const d=await fixture(),m=await build(d),r=route(m),original=structuredClone(d);
  const controls=[{frame:r.startFrame,x:17,y:10.8},{frame:20,x:20,y:12},{frame:r.endFrameExclusive-1,x:21.2,y:8.8}];
  const edited=api.updateRouteControlPoints(d,r,controls);await validateDocument(edited);
  assert.deepEqual(d,original);assert.deepEqual(edited.review,d.review);assert.deepEqual(edited.playDefinition,d.playDefinition);
  const updated=route(await build(edited));assert.equal(updated.manual,true);
  assert.ok(updated.curve.some(p=>p.time===2&&p.x===20&&p.y===12));
  assert.deepEqual(api.restoreRoute(edited,r.routeId),d);
});

test('snapshot refresh, split, merge and geometry policy changes preserve edits as stale without applying them',async()=>{
  const d=await fixture(),r=route(await build(d)),edited=api.updateRouteControlPoints(d,r,[{frame:0,x:18,y:11},{frame:60,x:22,y:9}]);
  const review=structuredClone(d.review);review.entities[0].name='new source';
  for(const changed of [await refreshSnapshot(edited,review),splitPhase(edited,'phase-1',30),removePhase(splitPhase(edited,'phase-1',30),'phase-1')]){
    await validateDocument(changed);assert.equal(changed.presentation.routes.length,1);
    const models=await Promise.all(changed.playDefinition.phases.map(p=>build(changed,p.phaseId)));
    assert.ok(models.every(m=>m.routes.every(r=>!r.manual)));assert.ok(models.some(m=>m.presentation.stale.length===1));
  }
  const altered=await api.buildPhaseRoutes(edited,'phase-1',{maxSpeedMetresPerSecond:10});
  assert.equal(route(altered).manual,false);assert.equal(altered.presentation.stale.length,1);
});

test('unsafe controls and forged source models are rejected before replacing any edit',async()=>{
  const d=await fixture(),r=route(await build(d)),valid=[{frame:0,x:17,y:10},{frame:60,x:21,y:9}];
  for(const controls of [[...valid].reverse(),[{frame:0,x:NaN,y:1},valid[1]],[valid[0],{frame:61,x:2,y:2}],
    [valid[0],{frame:30,x:29,y:2},valid[1]],Array.from({length:129},(_,i)=>({frame:i,x:1,y:1}))]){
    assert.throws(()=>api.updateRouteControlPoints(d,r,controls));
  }
  assert.throws(()=>api.updateRouteControlPoints(d,{...r,source:{...r.source,sourceBinding:{...r.source.sourceBinding,reviewDigest:'0'.repeat(64)}}},valid));
});

test('current-frame perspective projects a court ring and chevrons and supports selected or all participants',async()=>{
  const d=await fixture();const matrix=[40,7,100,3,28,70,.006,.009,1];
  const project=p=>{const w=matrix[6]*p.x+matrix[7]*p.y+1;return {x:(matrix[0]*p.x+matrix[1]*p.y+100)/w,y:(matrix[3]*p.x+matrix[4]*p.y+70)/w};};
  for(const key of d.review.court.calibration.keyframes){for(const p of key.points){const q=project({x:p.image[0]/40,y:p.image[1]/40});p.image=[q.x,q.y];}}
  for(const e of d.review.entities)for(const p of e.trajectory){Object.assign(p,project({x:p.x/40,y:p.y/40}));}
  await rebind(d);const m=await build(d),scene=api.projectPhaseRoutes(m,{frame:10,mediaTime:1,selectedEntityId:'P1'});
  assert.equal(scene.routes.length,1);const drawn=scene.routes[0];assert.ok(drawn.court.chevrons.length);
  assert.equal(drawn.court.ring.length,33);assert.equal(drawn.video.ring.length,33);
  for(let i=0;i<33;i++){const q=project(drawn.court.ring[i]),p=drawn.video.ring[i];assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<1e-5);}
  const a=api.courtToVideo(m,10,{x:20,y:9}),b=api.videoToCourt(m,10,a);assert.ok(Math.hypot(b.x-20,b.y-9)<1e-6);
  assert.ok(api.projectPhaseRoutes(m,{frame:10,mediaTime:1,selectedEntityId:'P1',showAll:true}).routes.length>1);
  assert.match(api.renderPresentationSVG(scene,{space:'video',width:1280,height:720}),/<svg/);
});

test('missing current-frame calibration returns court preview and null video geometry instead of stale projection',async()=>{
  const d=await fixture();d.review.court.calibration.keyframes[10].status='invalid';await rebind(d);
  const m=await build(d),scene=api.projectPhaseRoutes(m,{frame:10,mediaTime:1,selectedEntityId:'P1'});
  assert.equal(scene.videoAvailable,false);assert.ok(scene.routes.length>0);assert.ok(scene.routes.every(r=>r.video===null));
  assert.equal(api.videoToCourt(m,10,{x:400,y:200}),null);assert.equal(api.courtToVideo(m,10,{x:10,y:5}),null);
});

test('a new actionless tracked snapshot can use one unreviewed propagated reference chain without inventing audit evidence',async()=>{
  const f=await makePresentationDemo();
  for(const key of f.review.court.calibration.keyframes){key.source='camera_propagation';key.quality={referenceFrame:0};key.points.forEach(p=>p.source='camera_propagation');}
  f.review.entities.forEach(e=>e.trajectory.forEach(p=>p.source='tracked'));
  const d=await createTacticsDocument(f.review),m=await build(d);
  assert.ok(route(m).curve.length>2);assert.deepEqual(d.playDefinition.reviewEvidence,[]);
});

test('synchronous drag preview rebuilds only one curve and preserves source time anchors without a document write',async()=>{
  const r=route(await build(await fixture())),before=structuredClone(r);
  assert.equal(typeof api.previewRouteControlPoints,'function');
  const controls=[{frame:0,x:17,y:10},{frame:20,x:20,y:12},{frame:60,x:21,y:9}];
  const preview=api.previewRouteControlPoints(r,controls);
  assert.equal(preview.manual,true);assert.ok(preview.curve.some(p=>p.time===2&&p.x===20&&p.y===12));
  assert.deepEqual(r,before);assert.deepEqual(preview.source,r.source);
  assert.throws(()=>api.previewRouteControlPoints(r,[{frame:0,x:NaN,y:1},controls.at(-1)]));
});
