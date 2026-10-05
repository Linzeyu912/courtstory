import test from 'node:test';
import assert from 'node:assert/strict';
import {makeV2Fixture} from './tactics-v2-fixture.mjs';
import {createCourtAnnotation,setAnnotationRange,courtCanvasPoint} from './tactics-court-editor.mjs';
import {validateDocument} from './tactics-document.mjs';
import {upsertTacticKeyframe} from './tactics-keyframes.mjs';
test('court editing stores a 3–5 second Bezier independent of video calibration',async()=>{
  const {document:d}=await makeV2Fixture();
  const p=courtCanvasPoint({left:0,top:0,width:286.512,height:152.4},{clientX:100,clientY:80});assert.ok(Math.abs(p.x-10)<1e-8);
  let next=createCourtAnnotation(d,{id:'route',type:'route',phaseId:'phase-1',range:{startFrame:30,endFrameExclusive:50},points:[{x:10,y:8},{x:18,y:6}]});
  await validateDocument(next);assert.equal(next.annotations.items[0].points.length,4);assert.equal(next.annotations.items[0].curve,'cubic_bezier');
  next=upsertTacticKeyframe(next,{frame:30,annotationIds:['route']});
  assert.throws(()=>setAnnotationRange(next,'route',{startFrame:35,endFrameExclusive:55}),/讲解点/);
  next=setAnnotationRange(next,'route',{startFrame:35,endFrameExclusive:55},{moveCue:true});await validateDocument(next);
  assert.equal(next.tacticKeyframes.items[0].frame,35);assert.equal(next.annotations.items[0].progressFrames[1].frame,55);
  assert.equal(d.annotations,undefined);
});
test('changing visibility alone preserves action progress and speed',async()=>{
  const {document:d}=await makeV2Fixture();const a=createCourtAnnotation(d,{id:'a',type:'route',phaseId:'phase-1',range:{startFrame:30,endFrameExclusive:50},points:[{x:10,y:8},{x:18,y:6}]});
  const b=setAnnotationRange(a,'a',{startFrame:30,endFrameExclusive:55},{scope:'visibility'});
  assert.deepEqual(b.annotations.items[0].progressFrames,a.annotations.items[0].progressFrames);
});
