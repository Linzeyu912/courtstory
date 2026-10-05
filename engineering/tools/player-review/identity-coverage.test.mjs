import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './court-preparation.test.mjs';
import {buildIdentityCoverage,planContinuationWindows} from './identity-coverage.mjs';
test('out-of-view is not a repair gap and continuation never spans a cut',()=>{
  const {session,clip}=fixture();session.entities[0].bindings=[];session.entities[0].visibilityRanges=[{start:0,end:3,state:'out_of_view',source:'human'}];session.cuts=[10];
  const coverage=buildIdentityCoverage(session,clip.frames);
  const windows=planContinuationWindows(coverage,{entityId:'P1',range:{startFrame:0,endFrameExclusive:21},windowSeconds:.24,overlapSeconds:.08});
  assert.ok(windows.length);assert.ok(windows.every(w=>!(w.startFrame<10&&w.endFrameExclusive>10)));
});
