import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './court-preparation.test.mjs';
import {buildCourtPreparation} from './court-preparation.mjs';
import {previewCourtSmoothing,adoptCourtSmoothing} from './court-smoothing.mjs';
test('adoption changes only the chosen interval, preserves raw/locks/gaps, rejects stale candidates',()=>{
  const p=buildCourtPreparation(fixture());p.rawByPlayer.P1[5].x+=.08;p.rawByPlayer.P1[6].locked=true;
  p.preparedByPlayer=structuredClone(p.rawByPlayer);
  const {candidate}=previewCourtSmoothing(p,{entityIds:['P1'],range:{startFrame:2,endFrameExclusive:12}});
  const next=adoptCourtSmoothing(p,candidate);
  assert.deepEqual(next.rawByPlayer,p.rawByPlayer);assert.deepEqual(next.preparedByPlayer.P1[6],p.rawByPlayer.P1[6]);
  assert.deepEqual(next.preparedByPlayer.P1.slice(12),p.preparedByPlayer.P1.slice(12));
  assert.throws(()=>adoptCourtSmoothing(next,candidate));assert.equal(p.revision,1);
});
test('turns, pauses and identity boundaries remain fixed',()=>{
  const p=buildCourtPreparation(fixture());p.rawByPlayer.P1[7].x=8;p.rawByPlayer.P1[8].x=7.6;p.rawByPlayer.P1[9].x=7.2;
  p.breaksByPlayer.P1.push({frame:7,reason:'identity_boundary'});p.preparedByPlayer=structuredClone(p.rawByPlayer);
  const next=adoptCourtSmoothing(p,previewCourtSmoothing(p,{entityIds:['P1'],range:{startFrame:0,endFrameExclusive:21}}).candidate);
  assert.equal(next.preparedByPlayer.P1[7].x,8);
});
