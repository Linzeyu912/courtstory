import test from 'node:test';
import assert from 'node:assert/strict';
import {makeV2Fixture} from './tactics-v2-fixture.mjs';
import {createCourtAnnotation} from './tactics-court-editor.mjs';
import {upsertTacticKeyframe,removeTacticKeyframe,compileTacticKeyframes} from './tactics-keyframes.mjs';
import {removeAnnotation} from './tactics-annotations.mjs';
test('same-frame cues share a single hold, cue deletion retains drawings and drawing deletion cleans references',async()=>{
  let {document:d}=await makeV2Fixture();for(const id of ['a','b'])d=createCourtAnnotation(d,{id,type:'screen',phaseId:'phase-1',range:{startFrame:30,endFrameExclusive:50},points:[{x:10,y:8}]});
  d=upsertTacticKeyframe(d,{id:'cue-a',frame:30,annotationIds:['a'],holdSeconds:2.5});d=upsertTacticKeyframe(d,{id:'cue-b',frame:30,annotationIds:['b'],holdSeconds:1});
  const cues=compileTacticKeyframes(d);assert.equal(cues.length,1);assert.equal(cues[0].holdSeconds,2.5);assert.equal(cues[0].annotationIds.length,2);
  const without=removeTacticKeyframe(d,'cue-a');assert.equal(without.annotations.items.length,2);
  const removed=removeAnnotation(d,'a');assert.equal(removed.tacticKeyframes.items.length,1);assert.equal(d.annotations.items.length,2);
});
