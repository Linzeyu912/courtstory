import test from 'node:test';
import assert from 'node:assert/strict';
import {makeV2Fixture} from './tactics-v2-fixture.mjs';
import {createCourtAnnotation} from './tactics-court-editor.mjs';
import {projectCourtAnnotations,courtProjectionGaps} from './tactics-court-projection.mjs';
import {compileProduction,renderProductionSvg} from './tactics-production.mjs';
import {upsertTacticKeyframe} from './tactics-keyframes.mjs';
test('source ranges, court/video geometry, cue holds and decoded end use a single document',async()=>{
  let {document:d}=await makeV2Fixture();d=createCourtAnnotation(d,{id:'route',type:'route',phaseId:'phase-1',range:{startFrame:30,endFrameExclusive:50},points:[{x:10,y:8},{x:18,y:6}]});
  d=upsertTacticKeyframe(d,{frame:30,annotationIds:['route'],holdSeconds:2.5});
  const before=projectCourtAnnotations(d,{frame:29,view:'court'}),start=projectCourtAnnotations(d,{frame:30,view:'court'}),mid=projectCourtAnnotations(d,{frame:40,view:'video'}),end=projectCourtAnnotations(d,{frame:50,view:'court'});
  assert.equal(before.items[0].geometry,null);assert.ok(start.items[0].geometry.ribbon.length>4);assert.ok(mid.items[0].geometry);assert.equal(end.items[0].geometry,null);
  const plan=compileProduction(d);assert.equal(plan.totalFrames,183+75);assert.equal(plan.frames.filter(f=>f.state!=='source').length,75);assert.equal(plan.frames.filter(f=>f.state!=='source').every(f=>f.sourceFrame===30),true);
  assert.match(renderProductionSvg(d,plan.frames.find(f=>f.state==='hold')),/authored-ribbon/);
  d.review.court.calibration.keyframes=d.review.court.calibration.keyframes.filter(k=>k.frame!==40);
  assert.deepEqual(courtProjectionGaps(d).map(g=>[g.startFrame,g.endFrameExclusive]),[[40,41]]);
  assert.ok(projectCourtAnnotations(d,{frame:40,view:'court'}).items[0].geometry);assert.throws(()=>compileProduction(d),/投影缺口/);
});

test('V2 production uses the next PTS for single-frame interior ranges and decoded tail duration at EOF',async()=>{
  const {document:d}=await makeV2Fixture();
  function segment(startFrame,endFrameExclusive,mediaEndTime){const next=structuredClone(d);Object.assign(next.playDefinition,{startFrame,endFrameExclusive});Object.assign(next.playDefinition.phases[0],{startFrame,endFrameExclusive,freezeFrame:startFrame});next.review.mediaEndTime=mediaEndTime;return compileProduction(next);}
  assert.equal(segment(30,31,6.1).totalFrames,3);
  assert.equal(segment(60,61,6.31).totalFrames,9);
  assert.equal(segment(30,50,6.31).totalFrames,60);
});
