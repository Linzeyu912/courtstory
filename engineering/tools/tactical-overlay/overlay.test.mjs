import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTacticalOverlay as build} from './overlay.mjs';
import * as binding from './binding.mjs';
import * as fixtures from './fixtures/synthetic.mjs';
import {makePresentationDemo} from './fixtures/presentation-demo.mjs';
const options={maxSpeedMetresPerSecond:100};
async function setup(){assert.equal(typeof fixtures.makeBoundaryFixture,'function','synthetic boundary fixture required');return fixtures.makeBoundaryFixture();}
const run=({review,playDefinition},phaseId='S1',freezeFrame=1,extra={})=>build({review,playDefinition,phaseId,freezeFrame,options:{...options,...extra}});
const path=(m,id='A')=>{const result=m.paths.find(p=>p.actionId===id);assert.ok(result,`expected route for ${id}`);return result;};
const frames=(m,id='A')=>path(m,id).segments.map(s=>s.points.map(p=>p.frame));
const xy=p=>[Math.round(p.x*1e6)/1e6,Math.round(p.y*1e6)/1e6];

test('performed actions belong only to actors while screen participants retain explicit relationship states',async()=>{
  const input=await makePresentationDemo(),before=JSON.stringify(input);
  const m=await build({...input,phaseId:'setup',freezeFrame:12}),person=id=>m.roster.find(p=>p.id===id);
  assert.deepEqual(person('P1').actionStates.map(a=>[a.actionId,a.kind,a.temporalStatus]),[['carry','move','active']]);
  assert.deepEqual(person('P2').actionStates.map(a=>[a.actionId,a.kind,a.temporalStatus]),[['screen','screen','active'],['roll','roll','pending']]);
  assert.deepEqual(person('P6').actionStates.map(a=>[a.actionId,a.kind,a.temporalStatus]),[['defend','hold','active']]);
  assert.ok(!person('P1').roles.includes('screen'));assert.ok(!person('P6').roles.includes('screen'));
  for(const [id,role] of [['P1','beneficiary'],['P2','screener'],['P6','defender']]){
    assert.deepEqual(person(id).relationStates,[{relationId:'screen-relation',actionId:'screen',role,temporalStatus:'active',screenerId:'P2',beneficiaryId:'P1',defenderId:'P6'}]);
  }
  assert.deepEqual(m.actions.find(a=>a.actionId==='screen').participantIds,['P2','P1','P6']);
  assert.deepEqual(m.highlightedParticipantIds,['P1','P2','P3','P4','P5','P6']);
  assert.deepEqual(m.roster.map(p=>p.id),['P1','P2','P3','P4','P5','P6']);assert.equal(JSON.stringify(input),before);
});
async function rebound(f){f.playDefinition.sourceBinding=await binding.createSourceBinding(f.review);return f;}
function freezeDeep(o){Object.freeze(o);for(const v of Object.values(o))if(v&&typeof v==='object')freezeDeep(v);return o;}

test('whole action is solid after freeze and next phase previews every action once',async()=>{
  const f=await setup(),before=JSON.stringify(f);freezeDeep(f);
  const m=await run(f);assert.equal(m.status,'partial');assert.deepEqual(m.actions.map(a=>[a.actionId,a.temporalStatus,a.renderability,a.coverage]),[['A','active','ready','complete'],['B','pending','ready','complete']]);
  assert.deepEqual(frames(m),[[0,1,2]]);assert.deepEqual(frames(m,'B'),[[2,3]]);
  assert.deepEqual(path(m).segments[0].points.map(p=>xy(p.freezePoint)),[[10,10],[20,10],[30,10]]);
  assert.equal(path(m).lineStyle,'solid');assert.equal(path(m,'B').lineStyle,'dashed');assert.equal(m.sourceTime,0.04);assert.equal(JSON.stringify(f),before);
  const next=await run(f,'S2',2);assert.deepEqual(next.actions.map(a=>a.temporalStatus),['active','active']);assert.equal(next.paths.filter(p=>p.actionId==='A').length,1);
  assert.equal((await run(f,'S2',3)).actions.find(a=>a.actionId==='A').temporalStatus,'completed');
  assert.equal((await run(f,'S1',0)).actions[0].temporalStatus,'active');
});
test('complete roster retains missing and stationary people with no invented coordinates',async()=>{
  const f=await setup(),m=await run(f);assert.deepEqual(m.roster.map(p=>p.id),['P1','P2','P3']);
  assert.deepEqual(m.highlightedParticipantIds,['P1','P2','P3']);assert.equal(m.roster[2].positionState,'missing');assert.equal(m.roster[2].position,null);assert.equal(m.roster[2].renderability,'unavailable');
  assert.deepEqual(m.issues,[{code:'entity_missing_from_review',severity:'warning',scope:'participant',phaseId:null,actionId:null,entityId:'P3',relationId:null,range:null,details:{}}]);
  assert.equal(m.markers.filter(x=>x.entityId==='P3').length,0);
  const current=await run(f,'S1',1,{previewNextPhase:false});assert.deepEqual(current.roster.map(p=>p.id),['P1','P2','P3']);assert.deepEqual(current.actions.map(a=>a.actionId),['A']);
});
test('stale snapshots and invalid references refuse all drawable outputs',async()=>{
  for(const [mutate,code] of [
    [f=>f.review.schemaVersion=3,'schema_unsupported'],[f=>f.review.confirmedAt='changed','source_binding_mismatch'],
    [f=>f.review.court.calibration.keyframes[0].points[0].image[0]+=1,'source_binding_mismatch'],
    [f=>f.review.sourceFrameMapping[0].sourceFrame=99,'source_binding_mismatch'],
    [f=>f.playDefinition.phases[0].actionIds=['absent'],'invalid_reference'],
    [f=>f.playDefinition.actions[0].actorId='P99','undeclared_participant'],
    [f=>f.playDefinition.actions[0].startFrame='0','invalid_input'],
    [f=>f.playDefinition.actions[0].endFrameExclusive=0,'invalid_input']]){
    const f=await setup();mutate(f);const m=await run(f);assert.equal(m.status,'refused',code);assert.ok(m.issues.some(i=>i.code===code),code);for(const key of ['roster','actions','paths','markers','relations','breaks','unavailableRanges'])assert.deepEqual(m[key],[]);
  }
  const f=await setup();assert.ok((await run(f,'S1',2)).issues.some(i=>i.code==='phase_frame_mismatch'));
  assert.equal((await run(f,'unknown',1)).status,'refused');assert.equal((await run(f,'S1',1,{maxStepSeconds:NaN})).status,'refused');
});
test('each source camera projects the same floor point into the frozen view',async()=>{
  const f=await setup();for(let frame=0;frame<4;frame++){
    const key=f.review.court.calibration.keyframes[frame];key.points.forEach(p=>p.image[0]+=frame*50);
    const p=f.review.entities[0].trajectory[frame];p.x=10+frame*50;p.y=10;
  }
  await rebound(f);const m=await run(f);assert.deepEqual(path(m).segments.flatMap(s=>s.points).map(p=>xy(p.freezePoint)),[[60,10],[60,10],[60,10]]);
  assert.ok(path(m).segments.every(s=>s.arrow===false));assert.deepEqual(m.markers.find(p=>p.kind==='freeze_position'&&p.entityId==='P1').position.freezePoint&&xy(m.roster[0].position.freezePoint),[60,10]);
});
test('invalid freeze calibration retains valid court geometry without using old pixels',async()=>{
  const f=await setup();f.review.court.calibration.keyframes[1].status='invalid';await rebound(f);const m=await run(f);
  assert.equal(m.videoOverlay.available,false);assert.equal(m.court2d.available,true);assert.equal(m.status,'partial');assert.ok(m.issues.some(i=>i.code==='freeze_calibration_unavailable'));
  assert.ok(path(m).segments.flatMap(s=>s.points).every(p=>p.freezePoint===null));assert.ok(m.unavailableRanges.some(r=>r.code==='calibration_unavailable'));
});
test('missing conflict out of view and estimated frames break rather than bridge',async()=>{
  for(const [source,code] of [['missing','missing_position'],['conflict','identity_conflict'],['out_of_view','out_of_view'],['manual_path','estimated_point'],['interpolated','estimated_point']]){
    const f=await setup();Object.assign(f.review.entities[0].trajectory[1],{source,x:source==='manual_path'?20:null,y:source==='manual_path'?10:null});await rebound(f);
    const m=await run(f);assert.deepEqual(frames(m),[[0],[2]],source);assert.equal(m.actions[0].coverage,'partial');assert.ok(m.issues.some(i=>i.code===code),code);assert.ok(m.unavailableRanges.some(r=>r.code===code));
    for(const s of path(m).segments)assert.ok([null,code].includes(s.breakBefore)&&[null,code].includes(s.breakAfter));
  }
});
test('cuts split even reviewed geometry and require explicit cross-cut floor reference',async()=>{
  const f=await setup();f.review.settings.cuts=[2];await rebound(f);let m=await run(f);assert.deepEqual(frames(m),[[0,1],[2]]);assert.ok(m.issues.some(i=>i.code==='source_cut'));assert.ok(path(m).segments[1].points[0].freezePoint);
  delete f.review.court.referenceId;await rebound(f);m=await run(f);assert.equal(path(m).segments[1].points[0].freezePoint,null);assert.ok(m.issues.some(i=>i.code==='court_reference_mismatch'));
});
test('same person changing tracks requires explicit reviewed continuity without filling gaps',async()=>{
  const f=await setup();f.review.entities[0].trajectory[2].trackId=9;
  f.playDefinition.reviewEvidence.find(e=>e.domain==='continuity'&&e.entityId==='P1').endFrameExclusive=2;await rebound(f);
  let m=await run(f);assert.deepEqual(frames(m),[[0,1],[2]]);assert.ok(m.issues.some(i=>i.code==='identity_boundary'));
  f.playDefinition.reviewEvidence.push({domain:'continuity',entityId:'P1',actionId:null,relationId:null,startFrame:1,endFrameExclusive:3,sourceFrames:[1,2],reviewer:'synthetic',method:'synthetic continuity',conclusion:'reviewed'});
  m=await run(f);assert.deepEqual(frames(m),[[0,1,2]]);
  f.review.entities[0].trajectory[1].source='missing';f.review.entities[0].trajectory[1].x=null;f.review.entities[0].trajectory[1].y=null;await rebound(f);m=await run(f);assert.deepEqual(frames(m),[[0],[2]]);
});
test('time reversal and suspicious jumps split the route and preserve point provenance',async()=>{
  const f=await setup();f.review.sourceFrameMapping[2].time=0.03;await rebound(f);let m=await run(f);assert.ok(m.issues.some(i=>i.code==='non_monotonic_time'));assert.deepEqual(frames(m),[[0,1],[2]]);
  const g=await setup();m=await run(g,'S1',1,{maxSpeedMetresPerSecond:12});assert.ok(m.issues.some(i=>i.code==='suspicious_jump'));assert.equal(m.actions[0].coverage,'partial');
  const p=path(m).segments[0].points[0];assert.equal(p.sourceFrame,0);assert.equal(p.entityId,'P1');assert.equal(p.imageSource,'manual');assert.deepEqual(p.calibration.supportFrames,[0,0]);
});
test('coarse identity confirmation never upgrades unreviewed interval quality or changes solid style',async()=>{
  const f=await setup();f.playDefinition.reviewEvidence=f.playDefinition.reviewEvidence.filter(e=>e.domain!=='identity');f.review.entities[0].identityConfirmed=true;await rebound(f);const m=await run(f);
  assert.equal(m.actions[0].quality.identity.state,'needs_review');assert.equal(m.actions[0].renderability,'warning');assert.equal(path(m).lineStyle,'solid');assert.ok(m.issues.some(i=>i.code==='identity_needs_review'));
});
test('presentation fixture keeps all roles and renders ground screen direction without inventing movement',async()=>{
  assert.equal(typeof fixtures.makePresentationFixture,'function');const f=await fixtures.makePresentationFixture();let m=await build({...f,phaseId:'setup',freezeFrame:2});
  assert.equal(m.status,'ok');assert.ok(m.roster.length>=6);assert.equal(m.paths.some(p=>['hold','screen','space'].includes(m.actions.find(a=>a.actionId===p.actionId).kind)),false);
  const r=m.relations[0];assert.equal(r.renderability,'ready');assert.ok(Math.abs(r.bar.court[0].x-r.bar.court[1].x)<1e-7);assert.ok(Math.abs(r.bar.freeze[0].y-r.bar.freeze[1].y)>1);
  f.playDefinition.relations[0].orientation=null;m=await build({...f,phaseId:'setup',freezeFrame:2});assert.equal(m.relations[0].bar,null);assert.ok(m.issues.some(i=>i.code==='screen_orientation_missing'));
});
test('malformed collections and calibration frame references return structured refusal without throwing',async()=>{
  for(const mutate of [f=>f.review.settings.cuts={},f=>f.playDefinition.actions.push(null),f=>f.review.court.calibration.keyframes[0].frame=-1,
    f=>f.review.entities[0].trajectory[0].source='predicted',f=>f.playDefinition.reviewEvidence[0].sourceFrames=[900]]){
    const f=await setup();mutate(f);const m=await run(f);assert.equal(m.status,'refused');assert.ok(m.issues.some(i=>i.code==='invalid_input'));
  }
});
test('explicit invalid identity evidence removes the affected observation instead of drawing an unsafe preview',async()=>{
  const f=await setup();f.playDefinition.reviewEvidence.push({domain:'identity',entityId:'P1',actionId:null,relationId:null,startFrame:1,endFrameExclusive:2,sourceFrames:[1],reviewer:'synthetic',method:'wrong person',conclusion:'invalid'});
  const m=await run(f);assert.equal(m.status,'partial');assert.equal(m.actions[0].quality.identity.state,'invalid');assert.deepEqual(frames(m),[[0],[2]]);assert.equal(m.roster[0].position,null);
});
test('an unobserved manual court anchor cannot enter routes but an explicitly observed reviewed anchor supports 2D',async()=>{
  const f=await setup(),e=f.review.entities[0];e.courtTrajectory=[{frame:1,time:.04,x:2,y:1,source:'court_manual'}];
  e.trajectory[1].source='missing';e.trajectory[1].x=null;e.trajectory[1].y=null;await rebound(f);let m=await run(f);assert.deepEqual(frames(m),[[0],[2]]);
  e.courtTrajectory[0].observation={frame:1,source:'manual',reviewer:'synthetic',method:'point from actual source frame'};await rebound(f);m=await run(f);
  assert.deepEqual(frames(m),[[0,1,2]]);assert.equal(path(m).segments[0].points[1].calibration.method,'observed_court_anchor');assert.equal(m.roster[0].positionState,'visible');
});
test('same inputs yield byte-stable output and exported court metadata is not elevated',async()=>{
  const f=await setup();assert.deepEqual(await run(f),await run(f));assert.equal((await run(f)).court2d.metricAccuracyValidated,false);
});
test('synthetic flags cannot disguise a synthetic snapshot as a real manifest',async()=>{
  const f=await setup();f.playDefinition.synthetic=false;assert.equal((await run(f)).status,'refused');
});
test('invalid calibration evidence disables the freeze view even if matrices compute',async()=>{
  const f=await setup();f.playDefinition.reviewEvidence.push({domain:'calibration',entityId:null,actionId:null,relationId:null,startFrame:1,endFrameExclusive:2,sourceFrames:[1],reviewer:'synthetic',method:'bad ground fit',conclusion:'invalid'});
  const m=await run(f);assert.equal(m.videoOverlay.available,false);assert.equal(m.court2d.available,true);assert.ok(path(m).segments.flatMap(s=>s.points).every(p=>p.freezePoint===null));
});
test('action review status and all screen participants constrain relation quality',async()=>{
  const f=await fixtures.makePresentationFixture();f.playDefinition.actions.find(a=>a.actionId==='carry').reviewStatus='needs_review';
  f.playDefinition.reviewEvidence=f.playDefinition.reviewEvidence.filter(e=>!(e.domain==='identity'&&e.entityId==='P6'));
  const m=await build({...f,phaseId:'setup',freezeFrame:2});assert.equal(m.actions.find(a=>a.actionId==='carry').quality.tactic.state,'needs_review');assert.equal(m.relations[0].renderability,'warning');assert.equal(m.relations[0].quality.identity.state,'needs_review');
});
test('malformed calibration controls and entity collections are refused before projection',async()=>{
  for(const mutate of [f=>f.review.entities[0].courtTrajectory={},f=>f.review.court.calibration.keyframes[0].points={},f=>f.review.court.calibration.keyframes[0].points[0].image='bad']){
    const f=await setup();mutate(f);const m=await run(f);assert.equal(m.status,'refused');assert.ok(m.issues.some(i=>i.code==='invalid_input'));
  }
});
test('camera updates within one propagated reference chain preserve an observed route without upgrading quality',async()=>{
  const f=await setup();
  f.playDefinition.reviewEvidence=f.playDefinition.reviewEvidence.filter(e=>!['continuity','calibration'].includes(e.domain));
  for(const key of f.review.court.calibration.keyframes){
    key.source='camera_propagation';key.quality={referenceFrame:0};
    for(const point of key.points){point.source='camera_propagation';point.image[0]+=key.frame*.5;}
  }
  for(const entity of f.review.entities)for(const p of entity.trajectory){p.source='tracked';p.x=10+p.frame*2;}
  await rebound(f);let m=await run(f);
  assert.deepEqual(frames(m),[[0,1,2]]);assert.equal(path(m).segments[0].arrow,true);
  assert.equal(m.actions[0].quality.calibration.state,'needs_review');assert.equal(m.status,'partial');
  assert.ok(!m.issues.some(i=>i.code==='calibration_boundary'));
  assert.deepEqual(path(m).segments[0].points.map(p=>p.calibration.provenance),[
    [{source:'camera_propagation',referenceFrame:0,side:'left',controlSources:['camera_propagation'],propagationMethod:null}],
    [{source:'camera_propagation',referenceFrame:0,side:'left',controlSources:['camera_propagation'],propagationMethod:null}],
    [{source:'camera_propagation',referenceFrame:0,side:'left',controlSources:['camera_propagation'],propagationMethod:null}]]);
  // A true reference change still splits without explicit boundary review.
  f.review.court.calibration.keyframes[2].quality.referenceFrame=1;await rebound(f);m=await run(f);
  assert.deepEqual(frames(m),[[0,1],[2]]);assert.ok(m.issues.some(i=>i.code==='calibration_boundary'));
  f.review.court.calibration.keyframes[2].quality.referenceFrame=0;f.review.court.calibration.keyframes[2].quality.method='new_camera_method';await rebound(f);m=await run(f);
  assert.deepEqual(frames(m),[[0,1],[2]]);assert.ok(m.issues.some(i=>i.code==='calibration_boundary'));
});
test('invalid tactic evidence with both action and relation IDs disables the screen bar and action',async()=>{
  const f=await fixtures.makePresentationFixture();f.playDefinition.reviewEvidence.push({domain:'tactic',entityId:null,
    actionId:'screen',relationId:'screen-relation',startFrame:0,endFrameExclusive:6,sourceFrames:[2],
    reviewer:'synthetic',method:'screen relation disproved',conclusion:'invalid'});
  const m=await build({...f,phaseId:'setup',freezeFrame:2});
  assert.equal(m.relations[0].quality.tactic.state,'invalid');assert.equal(m.relations[0].bar,null);
  assert.equal(m.relations[0].renderability,'unavailable');assert.equal(m.actions.find(a=>a.actionId==='screen').quality.tactic.state,'invalid');
  assert.equal(m.status,'partial');
});
test('reviewed tactic evidence with both IDs applies to its screen action and relation',async()=>{
  const f=await fixtures.makePresentationFixture();
  f.playDefinition.reviewEvidence=f.playDefinition.reviewEvidence.filter(e=>!(e.domain==='tactic'&&(e.actionId==='screen'||e.relationId==='screen-relation')));
  f.playDefinition.reviewEvidence.push({domain:'tactic',entityId:null,actionId:'screen',relationId:'screen-relation',
    startFrame:0,endFrameExclusive:6,sourceFrames:[2],reviewer:'synthetic',method:'screen reviewed with action',conclusion:'reviewed'});
  const m=await build({...f,phaseId:'setup',freezeFrame:2});assert.equal(m.status,'ok');
  assert.equal(m.actions.find(a=>a.actionId==='screen').quality.tactic.state,'reviewed');assert.equal(m.relations[0].quality.tactic.state,'reviewed');
});
test('malformed calibration gap policy refuses before a long-gap interpolation can produce a freeze mapping',async()=>{
  const f=await setup();f.review.court.calibration.keyframes=f.review.court.calibration.keyframes.filter(k=>k.frame===0||k.frame===3);
  for(let frame=0;frame<4;frame++)f.review.sourceFrameMapping[frame].time=f.review.sourceFrameMapping[frame].sourceTime=frame*5.5/3;
  for(const value of ['bad',null,false,-1]){
    f.review.court.calibration.maxKeyframeGapSeconds=value;await rebound(f);const m=await run(f);
    assert.equal(m.status,'refused');assert.ok(m.issues.some(i=>i.code==='invalid_input'&&i.details.field==='court.calibration.maxKeyframeGapSeconds'));
  }
  f.review.court.calibration.maxKeyframeGapSeconds=0;await rebound(f);
  const between=await run(f);assert.equal(between.status,'partial');assert.equal(between.videoOverlay.available,false);
  const exact=await run(f,'S1',0);assert.equal(exact.status,'partial');assert.equal(exact.videoOverlay.available,true);
});
test('consumed court dimensions and propagated support references refuse malformed numeric metadata',async()=>{
  for(const mutate of [f=>f.review.court.length='bad',f=>f.review.court.width=-1,
    f=>f.review.court.calibration.keyframes[0].quality={referenceFrame:'0'},
    f=>f.review.court.calibration.keyframes[0].quality={cameraSupportFrame:99}]){
    const f=await setup();mutate(f);await rebound(f);const m=await run(f);
    assert.equal(m.status,'refused');assert.ok(m.issues.some(i=>i.code==='invalid_input'));
  }
});
