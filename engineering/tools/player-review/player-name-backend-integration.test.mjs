import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyPlayerNameIdentities,nameIdentityAt} from './player-name-identity.mjs';

test('actual Python recognizer response applies through the browser consumer contract',()=>{
  const script=`
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path('engineering/scripts').resolve()))
from test_player_name_identity import FakeProvider, FakeRoster, FakeTactics, fixture
from player_name_identity import REPO_ROOT, recognize_player_names
session, clip = fixture()
session['entities'][0]['name'] = '白1号'
root = REPO_ROOT / 'tmp' / 'test-player-name-identity'
root.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(dir=root) as work:
    candidate = recognize_player_names(session, clip, 'fixture.mp4', FakeTactics(), FakeRoster(),
        season='2024-25', team_map={'A':'BOS','B':'NYK'}, provider=FakeProvider(), work_dir=work)
print(json.dumps({'session':session,'clip':clip,'candidate':candidate}))
`;
  const child=spawnSync(process.env.PYTHON||'python',['-c',script],{encoding:'utf8',cwd:fileURLToPath(new URL('../../../',import.meta.url)),maxBuffer:4*1024*1024});
  assert.equal(child.status,0,child.stderr||'Python name recognizer fixture failed');
  const fixture=JSON.parse(child.stdout);
  assert.equal(fixture.candidate.status,'ready');
  const actual=fixture.candidate.candidates.find(item=>item.entityId==='P1');
  assert.equal(actual.status,'candidate');assert.equal(actual.nameCandidate.name,'Double Zero');assert.equal(actual.jersey,'00');
  const result={purpose:'player_names',jobId:'fixture-job',sourceKey:'fixture-source',
    base:{videoHash:fixture.clip.video_sha256,trackingFingerprint:fixture.clip.tracking_fingerprint,
      trackingRevision:fixture.clip.tracking_revision,variant:'original'},candidate:fixture.candidate};
  const applied=applyPlayerNameIdentities(fixture.session,result,fixture.clip);
  assert.equal(applied.report.applied,1);
  const output=nameIdentityAt(applied.session,applied.session.entities[0],{frame:0,trackId:7},fixture.clip);
  assert.equal(output.name,'Double Zero');assert.equal(output.jersey,'00');assert.equal(output.identityVerified,false);
  assert.equal(applied.session.entities[0].name,'白1号','legacy team/jersey labels remain unchanged');
});
