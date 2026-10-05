import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {buildTacticalOverlay} from './overlay.mjs';
import {makeCandidateFixture} from './fixtures/005-candidate/generate.mjs';
import {makePresentationDemo} from './fixtures/presentation-demo.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const sourcePaths=[
  'data/videos/tactics/acceptance/clips/005_SAS_pick_roll.mp4',
  'data/videos/tactics/acceptance/tracks/005-ebard.json',
  'research/vision/vision-player-refinement/feet-candidates-005.json',
  'research/vision/vision-player-refinement/court-candidates-005.json'
];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=()=>Promise.all(sourcePaths.map(async p=>hash(await readFile(path.join(root,p)))));

test('005 candidate preserves locked source bytes, uncertain quality and literal identity gaps',async()=>{
  const before=await hashes();
  const {review,playDefinition,audit}=await makeCandidateFixture();
  assert.deepEqual(await hashes(),before);
  assert.equal(review.videoSha256,'1f7bd135ad8cde5ab877612e596f93200281b6902aac8084fad19a544d20b85d');
  assert.equal(review.trackingFingerprint,'e2d1b8c50a4714afc9e3ae7628dde6dda7259e127f1f3fe42cfaf9b97caaa12e');
  assert.equal(review.synthetic,false);
  assert.equal(review.allFramesManuallyVerified,false);
  assert.equal(review.selectionConfirmed,false);
  assert.equal(review.court.metricAccuracyValidated,false);
  assert.deepEqual(audit.sourceCalibrationCounts,{needs_review:139,invalid:4});
  assert.deepEqual(audit.invalidCalibrationFrames,[108,109,110,111]);
  assert.equal(review.court.calibration.keyframes.filter(k=>k.originalStatus==='needs_review'&&k.status==='accepted_reference'&&k.reviewRequired).length,139);
  assert.equal(review.court.calibration.keyframes.filter(k=>k.status==='invalid').length,4);
  assert.equal(review.court.calibration.maxKeyframeGapSeconds,0);
  assert.deepEqual(playDefinition.participants.map(p=>p.id),['P1','P2','P3','P4','P5','P6']);
  assert.equal(playDefinition.actions.length,14);
  assert.ok(playDefinition.reviewEvidence.every(e=>e.conclusion==='needs_review'&&e.method==='assistant_visual_inspection'));
  assert.ok(playDefinition.actions.every(a=>a.source==='upstream_supplied'&&a.reviewStatus==='needs_review'));
  const points=id=>review.entities.find(e=>e.id===id).trajectory;
  for(const [id,missing] of [['P1',[108,142]],['P2',[31,32,38,45]],['P3',[80,81,82,83]],['P4',[108,142]],['P5',[111,127,136,142]]]){
    for(const frame of missing)assert.equal(points(id)[frame].source,'missing',`${id} f${frame} stays missing`);
  }
  assert.equal(points('P5')[128].trackId,15);
  assert.equal(points('P5')[135].trackId,15);
  assert.equal(points('P1')[15].x,1436.4500122070312);
  assert.equal(points('P2')[40].y,733.2432861328125);
  assert.ok(review.entities.every(e=>!e.identityConfirmed&&e.trajectory.filter(p=>p.source==='tracked').every(p=>p.groundContactConfirmed===false&&p.footMethod==='bbox_bottom_center')));
  assert.equal(audit.sampledFrames.length,60);
  assert.equal(review.sourceFrameMapping[40].time,1.3333333333333333);
});

test('005 candidate renders three bound phases with whole observed actions and preserved unavailable spans',async()=>{
  const fixture=await makeCandidateFixture();
  const manifests=await Promise.all(fixture.playDefinition.phases.map(phase=>buildTacticalOverlay({...fixture,phaseId:phase.phaseId,freezeFrame:phase.freezeFrame})));
  assert.deepEqual(manifests.map(m=>m.freezeFrame),[15,40,90]);
  for(const m of manifests){
    assert.equal(m.status,'partial');assert.equal(m.videoOverlay.available,true);assert.equal(m.roster.length,6);
    assert.ok(m.actions.every(a=>Object.values(a.quality).every(q=>q.state==='needs_review')));
  }
  const first=manifests[0],carry=first.paths.find(p=>p.actionId==='a1_receive_and_turn');
  assert.equal(carry.lineStyle,'solid');
  assert.ok(carry.segments.flatMap(s=>s.points).some(p=>p.frame===52));
  const roll=first.paths.find(p=>p.actionId==='a6_roll_receive');
  assert.equal(roll.lineStyle,'dashed');
  assert.equal(roll.segments[0].points[0].frame,47);
  assert.ok(first.issues.some(i=>i.code==='screen_orientation_missing'));
  assert.equal(first.relations[0].bar,null);
  const third=manifests[2],cut=third.paths.find(p=>p.actionId==='a12_follow_inside');
  assert.equal(cut.temporalStatus,'active');
  const action=third.actions.find(a=>a.actionId==='a12_follow_inside');
  assert.deepEqual([action.startFrame,action.endFrameExclusive],[79,143]);
  assert.ok(cut.segments.every(s=>!(s.points[0].frame<111&&s.points.at(-1).frame>=128)));
  assert.ok(third.unavailableRanges.some(r=>r.code==='calibration_unavailable'&&r.range.startFrame===108));
  assert.ok(cut.segments.every(s=>s.points.every(p=>p.frame<108||p.frame>111)));
  assert.ok(third.breaks.some(b=>b.code==='suspicious_jump'));
});

test('synthetic visual demo has metre-scale continuous arrows and an oriented screen without changing geometry guards',async()=>{
  const fixture=await makePresentationDemo();
  const phase=fixture.playDefinition.phases[0];
  const m=await buildTacticalOverlay({...fixture,phaseId:phase.phaseId,freezeFrame:phase.freezeFrame});
  assert.equal(m.status,'ok');assert.equal(m.synthetic,true);assert.equal(m.roster.length,6);
  assert.equal(m.geometryPolicy.maxSpeedMetresPerSecond,12);
  assert.ok(m.relations[0].bar);
  assert.equal(m.relations[0].bar.widthMetres,.8);
  const paths=m.paths.filter(p=>p.segments.some(s=>s.arrow));
  assert.ok(paths.some(p=>p.temporalStatus==='active'));
  assert.ok(paths.some(p=>p.temporalStatus==='pending'));
  for(const p of paths){
    const s=p.segments.find(s=>s.arrow),first=s.points[0].courtPoint,last=s.points.at(-1).courtPoint;
    assert.ok(Math.hypot(last.x-first.x,last.y-first.y)>=3,`${p.actionId} meaningful distance`);
  }
  assert.ok(m.markers.some(p=>p.entityId==='P5'&&p.kind==='static_role'));
  assert.ok(!m.paths.some(p=>p.entityId==='P5'));
});
