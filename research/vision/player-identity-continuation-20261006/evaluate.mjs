/** Replays a real result through the existing frontend, only in private memory. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {applyIdentityCandidates} from '../../../engineering/tools/player-review/identity-continuation.mjs';
import {buildTrajectories} from '../../../engineering/tools/player-review/trajectory.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const cache=path.join(root,'artifacts/player-identity-continuation-20261006');
const read=name=>JSON.parse(fs.readFileSync(path.join(cache,name),'utf8'));
const clip=read('clip.json');
const request=read('continuation-request.json');
const response=read('continuation-response.json');
assert.equal(request.qa,true);
assert.equal(response.status,'ready');
assert.equal(response.base.qa,true);
const before=structuredClone(request.session);
// Reproduce the seed T2 fallback. This is a QA simulation, not user confirmation.
before.entities[0].modelBindings=[{kind:'track',trackId:2,start:0,end:621}];
const snapshot=JSON.stringify(before);
const applied=applyIdentityCandidates(before,{entityId:'P1',reference:request.reference,
  segments:response.candidate.segments},clip);
assert.equal(JSON.stringify(before),snapshot,'the caller session must remain unchanged');
const baseline=buildTrajectories(before,clip.frames,clip.sourceCuts).P1;
const continued=buildTrajectories(applied.session,clip.frames,clip.sourceCuts).P1;
const {start,end}=request.range;
const usable=rows=>rows.slice(start,end+1).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
const original=usable(baseline),final=usable(continued);
const gaps=[];
for(let frame=start;frame<=end;frame++){
  const p=continued[frame];
  if(p.x===null){
    if(gaps.at(-1)?.end===frame-1)gaps.at(-1).end=frame;
    else gaps.push({start:frame,end:frame});
  }
}
assert.equal(original.length,52);
assert.equal(final.length,156);
assert.deepEqual(gaps,[{start:622,end:646}]);
assert.equal(continued[647].trackId,39);
assert.equal(continued[750].trackId,39);
assert.equal(continued[751].x,null,'candidate must not extend beyond the selected range');
assert.equal(continued.slice(start,end+1).filter(p=>p.frameIdentityConfirmed).length,0,
  'adoption replay must not certify every frame');
assert.equal(baseline[569].trackId,continued[569].trackId);
const result={testContext:'qa_only_in_memory_not_user_draft',entityId:'P1',
  videoHash:clip.video_sha256,trackingFingerprint:clip.tracking_fingerprint,
  range:request.range,rangeFrameCount:end-start+1,beforePositionFrames:original.length,
  afterPositionFrames:final.length,addedPositionFrames:final.length-original.length,
  afterPositionCoverage:final.length/(end-start+1),unknownRanges:gaps,
  beforeTrackIds:[...new Set(original.map(p=>p.trackId))],
  afterTrackIds:[...new Set(final.map(p=>p.trackId))],
  autoCertifiedFrames:0,candidates:response.candidate.segments,
  note:'Pixel foot positions are real source bbox bottom midpoints. Court calibration was absent; no 2D metric-coordinate accuracy is claimed.',
  assertions:['caller unchanged','finite source observations','gap preserved','T2 to T39 resumed',
    'outside-range unchanged','no automatically confirmed frames']};
fs.writeFileSync(path.join(here,'evaluation.json'),JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify(result,null,2));
