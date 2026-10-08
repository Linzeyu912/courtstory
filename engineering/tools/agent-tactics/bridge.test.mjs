import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createBaseline,buildPlayerAnnotations,checkParticipantCoverage,checkProjection,previewProjection,respond} from './bridge.mjs';
import {digest,clone} from './contracts.mjs';
import {compileProduction} from '../player-review/tactics-production.mjs';
import {validateDocument} from '../player-review/tactics-document.mjs';

export async function makeBridgeFixture({count=8,players=3,feet=false}={}){
  const mapping=Array.from({length:count},(_,frame)=>({frame,time:frame/30,sourceFrame:500+frame*2,sourceTime:10+frame/15}));
  const review={schemaVersion:2,videoSha256:'a'.repeat(64),sourceVideoSha256:'b'.repeat(64),trackingFingerprint:'fixture-detection-observations',trackingRevision:'fixture-v1',width:1280,height:720,mediaEndTime:count/30,settings:{cuts:[],sourceCuts:[]},sourceFrameMapping:mapping,
    entities:Array.from({length:players},(_,i)=>({id:`P${i+1}`,trajectory:feet?mapping.map(m=>({frame:m.frame,time:m.time,x:100+i*90+m.frame*12,y:300+i*10,source:'tracked',trackId:i+1})):[]}))};
  const range={startFrame:0,endFrameExclusive:count},baseline=await createBaseline({operation:'create_baseline',review,range,snapshotId:'fixture-snapshot'});
  const sourceRef=baseline.sourceRef;
  const playerEvidence={schemaVersion:'1.0',sourceRef,range,players:review.entities.map((e,i)=>({playerId:e.id,trackId:i+1,identityStatus:'anonymous_stable_candidate',identityEvidenceFrames:[0,count-1],teamCandidate:null,name:null,jerseyNumber:null,frames:mapping.map(m=>({assetFrame:m.frame,sourceFrame:m.sourceFrame,pts:m.time,position:[100+i*90+m.frame*12,300+i*10],bbox:[80+i*90,200,120+i*90,340],sourceSpace:'image_pixels',anchorSemantics:feet?'foot_candidate':'body_point',observationStatus:'observed',visibility:'visible',identityConfidence:null,locationConfidence:.9,sourceMethod:feet?'native_review':'detector_bbox_center',evidenceRef:`evidence-${e.id}-${m.frame}`}))}))};
  const participants=review.entities.map((e,i)=>({playerId:e.id,role:i===0?'ball_handler':i===1?'spacer':'help_defender',evidenceFrames:[0,count-1],visibleRanges:[range],locatableRanges:[range],positionStatus:'observed'}));
  const participantInventory={schemaVersion:'1.0',analysisRevision:1,phases:[{phaseId:'setup',range,participants}]};
  const intents=participants.map(p=>({intentId:`focus-${p.playerId}`,phaseId:'setup',playerId:p.playerId,type:'spotlight',displayIntent:'reference_frame',range,anchorFrame:0,sourceSpace:'image_pixels',anchorSemantics:feet?'foot_candidate':'body_point',evidenceFrames:[0],evidenceRefs:[`evidence-${p.playerId}-0`],actionId:null}));
  const playAnalysis={schemaVersion:'1.0',analysisRevision:1,phases:[{id:'setup',range,evidenceFrames:[0,count-1],participants,actions:[]}],annotationIntents:intents,relations:[]};
  return {operation:'build_player_annotations',document:baseline.document,sourceRef,playerEvidence,playAnalysis,participantInventory,fps:30,jobId:'test-agent-job'};
}
function checkRequest(input,built,operation='check_participant_coverage'){
  return {operation,candidate:built.candidate,sourceRef:input.sourceRef,playerEvidence:input.playerEvidence,participantInventory:input.participantInventory,annotationMap:built.annotationMap,renderPlan:built.renderPlan};
}
function rebindCandidate(request){
  const candidateDigest=digest(request.candidate);request.annotationMap.candidateDigest=candidateDigest;request.renderPlan.candidateDigest=candidateDigest;
  const plan=compileProduction(request.candidate,{fps:request.renderPlan.productionPlan.fps});request.renderPlan.productionPlan=plan;
  request.renderPlan.frames=plan.frames.map((state,outputFrame)=>({outputFrame,assetFrame:state.sourceFrame,sourceFrame:request.candidate.review.sourceFrameMapping[state.sourceFrame].sourceFrame,pts:request.candidate.review.sourceFrameMapping[state.sourceFrame].time,state:state.state,reveal:state.reveal,phaseId:state.phaseId}));
}
function routeFixture(input,{dashed=false,fixed=false}={}){
  const end=input.document.review.sourceFrameMapping.length-1,range=input.playerEvidence.range,anchorFrame=0,first=dashed?1:0;
  input.playAnalysis.phases[0].actions=[{actionId:'move-P1',playerId:'P1',kind:'move',range:{startFrame:first,endFrameExclusive:range.endFrameExclusive},evidenceFrames:[first,end],observationStatus:'observed'}];
  const source=input.playerEvidence.players[0].frames;
  input.playAnalysis.annotationIntents[0]={...input.playAnalysis.annotationIntents[0],intentId:'route-P1',type:'route',displayIntent:fixed?'fixed_interval':'reference_frame',points:[{x:source[first].position[0],y:source[first].position[1]},{x:source[end].position[0],y:source[end].position[1]}],evidenceFrames:[...new Set([anchorFrame,first,end])],evidenceRefs:[`evidence-P1-0`,`evidence-P1-${first}`,`evidence-P1-${end}`],actionId:'move-P1',style:{pattern:dashed?'dashed':'solid'},meaning:dashed?'later_observed_action':'current_action',cameraEvidenceRef:'camera-check'};
  input.cameraEvidence=[{ref:'camera-check',sourceRef:input.sourceRef,range,evidenceFrames:[...new Set([anchorFrame,first,end])],evidenceRefs:['field-line-check'],method:'stationary_camera_validation',maxResidualPixels:1,tolerancePixels:8,independentCheck:true,checkPointCount:4}];
  return input;
}

test('native factory builds editable multi-player candidate and leaves baseline unchanged',async()=>{
  const input=await makeBridgeFixture(),before=digest(input.document),built=await buildPlayerAnnotations(input);
  assert.equal(digest(input.document),before);assert.equal(built.candidate.annotations.items.length,3);await validateDocument(built.candidate);
  assert.ok(built.candidate.annotations.items.every(a=>a.origin.kind==='agent'&&!a.followEntity&&!('role' in a)));
  assert.ok(built.candidate.annotations.items.every(a=>a.startFrame===a.anchorFrame&&a.endFrameExclusive===a.anchorFrame+1));
  assert.ok(built.renderPlan.productionPlan.frames.some(f=>f.state==='hold'));
  const coverage=await checkParticipantCoverage(checkRequest(input,built));assert.equal(coverage.pass,true);assert.equal(coverage.phases[0].counts.covered,3);
  const projection=await checkProjection(checkRequest(input,built,'check_projection'));assert.equal(projection.pass,true,JSON.stringify(projection.invalidRanges));
});
test('ten declared native participants with one actual annotation fail independent coverage',async()=>{
  const input=await makeBridgeFixture({players:10});input.playAnalysis.annotationIntents=input.playAnalysis.annotationIntents.slice(0,1);
  const built=await buildPlayerAnnotations(input),result=await checkParticipantCoverage(checkRequest(input,built));
  assert.equal(built.candidate.playDefinition.participants.length,10);assert.equal(result.pass,false);assert.equal(result.missing.length,9);assert.deepEqual(result.phases[0].coveredOfExpected,[1,10]);
});
test('static off-ball player and relevant defender need their own visible markers',async()=>{
  const input=await makeBridgeFixture();for(const player of input.playerEvidence.players.slice(1))for(const f of player.frames)f.position=clone(player.frames[0].position);
  const built=await buildPlayerAnnotations(input),result=await checkParticipantCoverage(checkRequest(input,built));
  assert.deepEqual(result.phases[0].rows.map(r=>[r.role,r.status]),[['ball_handler','covered'],['spacer','covered'],['help_defender','covered']]);
});
test('sparse confirmed cues retain participants without upgrading other same-ID detections',async()=>{
  const input=await makeBridgeFixture();
  for(const participant of input.participantInventory.phases[0].participants)Object.assign(participant,{evidenceFrames:[0],visibleRanges:[{startFrame:0,endFrameExclusive:1}],locatableRanges:[{startFrame:0,endFrameExclusive:1}]});
  const before=digest(input.participantInventory),built=await buildPlayerAnnotations(input),result=await checkParticipantCoverage(checkRequest(input,built));
  assert.equal(result.pass,true);assert.equal(result.phases[0].counts.expected,3);
  assert.ok(result.phases[0].rows.every(r=>r.visibleAssetFrames.length===1&&r.visibleAssetFrames[0]===0));
  assert.equal(digest(input.participantInventory),before);assert.equal(input.playerEvidence.players[0].frames.length,8);
});
test('cue and cited positional evidence must remain inside frozen identity-confirmed ranges',async()=>{
  for(const moveCue of [false,true]){
    const input=await makeBridgeFixture(),person=input.participantInventory.phases[0].participants[0],intent=input.playAnalysis.annotationIntents[0];
    Object.assign(person,{evidenceFrames:[0],visibleRanges:[{startFrame:0,endFrameExclusive:1}],locatableRanges:[{startFrame:0,endFrameExclusive:1}]});
    intent.evidenceFrames=moveCue?[7]:[0,7];intent.evidenceRefs=['evidence-P1-0','evidence-P1-7'];if(moveCue)intent.anchorFrame=7;
    const result=await respond(input);assert.equal(result.ok,false);assert.equal(result.error.reasonCode,'identity_conflict');assert.match(result.error.message,/frozen identity-confirmed/);
  }
});
test('follow and route cannot cross unconfirmed identity frames with valid raw coordinates',async()=>{
  for(const follow of [false,true]){
    const input=follow?await makeBridgeFixture({feet:true}):routeFixture(await makeBridgeFixture()),person=input.participantInventory.phases[0].participants[0];
    if(follow)input.playAnalysis.annotationIntents[0].displayIntent='declared_player_follow';
    person.visibleRanges=[{startFrame:0,endFrameExclusive:3},{startFrame:4,endFrameExclusive:8}];person.locatableRanges=clone(person.visibleRanges);
    const result=await respond(input);assert.equal(result.ok,false);assert.equal(result.error.reasonCode,'identity_conflict');assert.deepEqual(result.error.affectedRanges,[{startFrame:3,endFrameExclusive:4}]);
  }
});
test('coverage and projection reject visible cue outside its frozen confirmed identity scope',async()=>{
  const input=await makeBridgeFixture(),built=await buildPlayerAnnotations(input),request=checkRequest(input,built),person=request.participantInventory.phases[0].participants[0];
  Object.assign(person,{evidenceFrames:[7],visibleRanges:[{startFrame:7,endFrameExclusive:8}],locatableRanges:[{startFrame:7,endFrameExclusive:8}]});
  // Simulate a consistently rebound but semantically wrong producer, not a stale digest.
  request.annotationMap.inventoryDigest=digest(request.participantInventory);request.renderPlan.inventoryDigest=digest(request.participantInventory);
  const coverage=await checkParticipantCoverage(request);
  assert.equal(coverage.pass,false);assert.equal(coverage.phases[0].rows[0].status,'missing');assert.deepEqual(coverage.phases[0].rows[0].visibleAssetFrames,[]);
  assert.ok(coverage.phases[0].rows[0].hiddenReasons.includes('identity_not_confirmed_in_inventory'));assert.equal(coverage.phases[0].counts.expected,3);
  const projection=await checkProjection({...request,operation:'check_projection'});assert.equal(projection.pass,false);assert.ok(projection.invalidRanges.some(r=>r.reason==='identity_conflict'));
});
test('unconfirmed same-ID detections cannot excuse a participant as unavailable',async()=>{
  const input=await makeBridgeFixture(),person=input.participantInventory.phases[0].participants[2];
  Object.assign(person,{visibleRanges:[],locatableRanges:[],positionStatus:'unknown'});input.playAnalysis.annotationIntents=input.playAnalysis.annotationIntents.filter(i=>i.playerId!=='P3');
  const result=await checkParticipantCoverage(checkRequest(input,await buildPlayerAnnotations(input)));
  assert.equal(result.pass,false);assert.equal(result.phases[0].rows[2].status,'missing');assert.equal(result.unavailable.length,0);assert.deepEqual(result.phases[0].coveredOfExpected,[2,3]);
});
test('frozen locatable ranges cannot exceed confirmed visibility or actual observations',async()=>{
  for(const noObservation of [false,true]){
    const input=await makeBridgeFixture(),person=input.participantInventory.phases[0].participants[0];
    if(noObservation)input.playerEvidence.players[0].frames.splice(3,1);else person.visibleRanges=[{startFrame:0,endFrameExclusive:1}];
    const result=await respond(input);assert.equal(result.ok,false);assert.equal(result.error.reasonCode,'tracking_gap');
  }
});
test('unknown bridge, intent, evidence and native annotation fields are rejected',async()=>{
  for(const edit of [r=>r.unknown=true,r=>r.playAnalysis.annotationIntents[0].followEntity=true,r=>r.playerEvidence.players[0].frames[0].groundTruth=true]){
    const input=await makeBridgeFixture();edit(input);assert.equal((await respond(input)).ok,false);
  }
  const input=await makeBridgeFixture(),built=await buildPlayerAnnotations(input),request=checkRequest(input,built,'check_projection');request.candidate.annotations.items[0].role='shooter';
  assert.equal((await respond(request)).ok,false);
});
test('body and TAPIR points cannot be promoted into native player foot follow',async()=>{
  const input=await makeBridgeFixture();input.playAnalysis.annotationIntents[0].displayIntent='declared_player_follow';
  assert.equal((await respond(input)).error.reasonCode,'capability_unavailable');
  const tapir=await makeBridgeFixture({feet:true});tapir.playerEvidence.players[0].frames[0].sourceMethod='tapir';assert.equal((await respond(tapir)).error.reasonCode,'capability_unavailable');
});
test('native declared feet follow is independently checked and uses real trajectory',async()=>{
  const input=await makeBridgeFixture({feet:true});input.playAnalysis.annotationIntents[0].displayIntent='declared_player_follow';const built=await buildPlayerAnnotations(input);
  assert.equal(built.candidate.annotations.items[0].anchorMode,'player_foot');assert.equal((await checkProjection(checkRequest(input,built,'check_projection'))).pass,true);
  input.playerEvidence.players[0].frames[3].observationStatus='estimated';assert.equal((await respond(input)).error.reasonCode,'tracking_gap');
});
test('unsupported movement or camera-free cross-frame route is refused',async()=>{
  const input=routeFixture(await makeBridgeFixture());delete input.cameraEvidence;
  assert.equal((await respond(input)).error.reasonCode,'geometry_unreliable');
  const missing=routeFixture(await makeBridgeFixture());missing.playAnalysis.phases[0].actions[0].observationStatus='unknown';
  assert.equal((await respond(missing)).error.reasonCode,'projection_invalid');
});
test('cubic handles cannot invent a detour beyond observed player movement',async()=>{
  const input=routeFixture(await makeBridgeFixture()),intent=input.playAnalysis.annotationIntents[0];
  intent.points=[intent.points[0],{x:1270,y:0},{x:1270,y:720},intent.points[1]];
  const result=await respond(input);assert.equal(result.ok,false);assert.equal(result.error.reasonCode,'projection_invalid');assert.match(result.error.message,/observed movement corridor/);
});
test('route cannot interpolate through a missing observed movement frame',async()=>{
  const input=routeFixture(await makeBridgeFixture());input.playerEvidence.players[0].frames[3].observationStatus='unknown';
  const result=await respond(input);assert.equal(result.ok,false);assert.equal(result.error.reasonCode,'tracking_gap');
});
test('different anchor cues still cannot overlap four primary routes in production',async()=>{
  const input=await makeBridgeFixture({players:4}),end=7,range=input.playerEvidence.range;
  input.playAnalysis.phases[0].actions=[];
  input.playAnalysis.annotationIntents=input.playAnalysis.annotationIntents.map((original,index)=>{
    const records=input.playerEvidence.players[index].frames,actionId=`move-${original.playerId}`;
    input.playAnalysis.phases[0].actions.push({actionId,playerId:original.playerId,kind:'move',range:{startFrame:index,endFrameExclusive:8},evidenceFrames:[index,end],observationStatus:'observed'});
    return {...original,intentId:`route-${original.playerId}`,type:'route',displayIntent:'fixed_interval',anchorFrame:index,actionId,evidenceFrames:[index,end],evidenceRefs:[records[index].evidenceRef,records[end].evidenceRef],points:[{x:records[index].position[0],y:records[index].position[1]},{x:records[end].position[0],y:records[end].position[1]}],cameraEvidenceRef:'camera-all'};
  });
  input.cameraEvidence=[{ref:'camera-all',sourceRef:input.sourceRef,range,evidenceFrames:Array.from({length:8},(_,i)=>i),evidenceRefs:['actual-stationary-camera-check'],method:'stationary_camera_validation',maxResidualPixels:1,tolerancePixels:8,independentCheck:true,checkPointCount:4}];
  const result=await respond(input);assert.equal(result.ok,false);assert.equal(result.error.reasonCode,'coverage_incomplete');assert.match(result.error.message,/actual production frame/);
});
test('fixed manual dashed uses later observed semantics and preserves agent origin',async()=>{
  const input=routeFixture(await makeBridgeFixture(),{dashed:true,fixed:true}),built=await buildPlayerAnnotations(input),a=built.candidate.annotations.items[0];
  assert.equal(a.meaning,'later_observed_action');assert.equal(a.videoMode,'fixed');assert.equal(a.origin.kind,'agent');
  assert.equal((await checkProjection(checkRequest(input,built,'check_projection'))).pass,true);
  input.playAnalysis.annotationIntents[0].meaning='current_action';assert.equal((await respond(input)).error.reasonCode,'projection_invalid');
});
test('screen requires an actual observed screening action',async()=>{
  const input=await makeBridgeFixture();input.playAnalysis.annotationIntents[1].type='screen';
  assert.equal((await respond(input)).error.reasonCode,'projection_invalid');
  input.playAnalysis.phases[0].actions.push({actionId:'screen-P2',playerId:'P2',kind:'screen',range:input.playerEvidence.range,evidenceFrames:[0,7],observationStatus:'observed'});
  input.playAnalysis.annotationIntents[1].actionId='screen-P2';const built=await buildPlayerAnnotations(input);
  assert.equal(built.candidate.annotations.items[1].type,'screen');assert.equal((await checkProjection(checkRequest(input,built,'check_projection'))).pass,true);
});
test('all-hidden route is missing, never an unavailable participant exemption',async()=>{
  const input=routeFixture(await makeBridgeFixture()),built=await buildPlayerAnnotations(input),request=checkRequest(input,built);
  const a=request.candidate.annotations.items[0];a.points=[clone(a.points[0]),clone(a.points[0])];request.annotationMap.entries[0].points=clone(a.points);rebindCandidate(request);
  const result=await checkParticipantCoverage(request);assert.equal(result.pass,false);assert.equal(result.phases[0].rows[0].status,'missing');
  const projected=await checkProjection({...request,operation:'check_projection'});assert.equal(projected.pass,false);assert.ok(projected.invalidRanges.some(r=>r.reason==='all_frames_hidden'));
});
test('native wrong-player binding cannot satisfy coverage',async()=>{
  const input=await makeBridgeFixture(),built=await buildPlayerAnnotations(input),request=checkRequest(input,built);request.candidate.annotations.items[0].entityId='P2';rebindCandidate(request);
  const result=await checkParticipantCoverage(request);assert.equal(result.pass,false);assert.equal(result.wrongBindings[0].playerId,'P1');
});
test('one occluded cue cannot excuse another locatable part of the phase',async()=>{
  const input=await makeBridgeFixture();input.playAnalysis.annotationIntents=input.playAnalysis.annotationIntents.filter(i=>i.playerId!=='P3');
  input.playerEvidence.players[2].frames[0].visibility='occluded';input.playerEvidence.players[2].frames[0].position=null;
  Object.assign(input.participantInventory.phases[0].participants[2],{visibleRanges:[{startFrame:1,endFrameExclusive:8}],locatableRanges:[{startFrame:1,endFrameExclusive:8}]});
  const result=await checkParticipantCoverage(checkRequest(input,await buildPlayerAnnotations(input)));
  assert.equal(result.phases[0].rows[2].status,'missing');assert.equal(result.unavailable.length,0);
});
test('entire phase occlusion is unavailable with evidence, never counted covered',async()=>{
  const input=await makeBridgeFixture();input.playAnalysis.annotationIntents=input.playAnalysis.annotationIntents.filter(i=>i.playerId!=='P3');
  for(const frame of input.playerEvidence.players[2].frames)Object.assign(frame,{position:null,visibility:'occluded',observationStatus:'unknown'});
  Object.assign(input.participantInventory.phases[0].participants[2],{visibleRanges:[],locatableRanges:[],positionStatus:'unknown'});
  const result=await checkParticipantCoverage(checkRequest(input,await buildPlayerAnnotations(input)));
  assert.equal(result.phases[0].rows[2].status,'unavailable');assert.deepEqual(result.phases[0].coveredOfExpected,[2,3]);assert.deepEqual(result.phases[0].coveredOfLocatableExpected,[2,2]);
});
test('nonidentity source labels remain separate from asset indexes in previews',async()=>{
  const input=await makeBridgeFixture(),built=await buildPlayerAnnotations(input),result=await previewProjection({...checkRequest(input,built,'preview_projection'),frameSelection:[0,7]});
  assert.equal(result.previews[0].assetFrame,0);assert.equal(result.previews[0].sourceFrame,500);assert.equal(result.previews[0].frameState.sourceFrame,0);assert.equal(result.previews[1].sourceFrame,514);
  assert.match(result.previews[0].svg,/data-annotation-id="ann-focus-P3"/);assert.equal(result.previews[0].frameState.state,'hold');
  const bad=clone(input);bad.playerEvidence.players[0].frames[0].assetFrame=500;assert.equal((await respond(bad)).ok,false);
});
test('half-open end is never treated as an observed source frame',async()=>{
  const input=await makeBridgeFixture(),built=await buildPlayerAnnotations(input);
  assert.ok(built.renderPlan.frames.every(f=>f.assetFrame<8));
  const response=await respond({...checkRequest(input,built,'preview_projection'),frameSelection:[8]});assert.equal(response.ok,false);
});
test('downsampled preview keeps exact omitted asset frames and marks them unencoded',async()=>{
  const input=await makeBridgeFixture();input.fps=15;const built=await buildPlayerAnnotations(input),result=await previewProjection({...checkRequest(input,built,'preview_projection'),frameSelection:[7]});
  assert.equal(result.previews[0].assetFrame,7);assert.equal(result.previews[0].sourceFrame,514);assert.equal(result.previews[0].outputFrame,null);assert.equal(result.previews[0].frameState.state,'source');
});
test('identity conflict is never accepted as a locatable observation',async()=>{
  const input=await makeBridgeFixture();input.playerEvidence.players[0].frames[0].identityConflict=true;
  assert.equal((await respond(input)).error.reasonCode,'tracking_gap');
});
test('candidate and frozen inventory edits invalidate existing quality inputs',async()=>{
  const input=await makeBridgeFixture(),built=await buildPlayerAnnotations(input),request=checkRequest(input,built);request.participantInventory=clone(request.participantInventory);request.participantInventory.phases[0].participants.pop();
  assert.equal((await respond(request)).error.reasonCode,'source_mismatch');
});
test('build protects an existing nonempty editable document',async()=>{
  const input=await makeBridgeFixture(),built=await buildPlayerAnnotations(input);input.document=built.candidate;assert.equal((await respond(input)).error.reasonCode,'version_conflict');
});
test('missing court calibration never turns finite coordinates into valid projection',async()=>{
  const input=await makeBridgeFixture(),intent=input.playAnalysis.annotationIntents[0];Object.assign(intent,{displayIntent:'court_projection',sourceSpace:'court_meters',anchorSemantics:'ground_point',calibrationRef:'missing'});
  assert.equal((await respond(input)).error.reasonCode,'geometry_unreliable');
});
test('stdin/stdout bridge provides a structured error without a shell protocol',()=>{
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./bridge.mjs',import.meta.url))],{input:JSON.stringify({operation:'unknown'}),encoding:'utf8'}),result=JSON.parse(child.stdout);
  assert.equal(result.ok,false);assert.equal(result.error.reasonCode,'capability_unavailable');
});
