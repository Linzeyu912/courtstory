import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyPlayerNameIdentities,nameIdentityAt} from '../../../engineering/tools/player-review/player-name-identity.mjs';
import {buildTrajectories} from '../../../engineering/tools/player-review/trajectory.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const label=process.argv[2]||'all-players-v3';
if(!/^[a-z0-9-]+$/.test(label))throw new Error('Use a simple probe label');
const folder=path.join(root,'artifacts/player-name-identity-20261007',label);
const read=name=>JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'));
const session=read('input-session.json'),clip=read('input-clip.json'),job=read('job.json');
const before=JSON.stringify(session),result=applyPlayerNameIdentities(session,job,clip);
const trajectories=buildTrajectories(result.session,clip.frames,clip.sourceCuts||[],clip);
const players=result.session.entities.filter(e=>e.role==='player').map(entity=>{
  const observations=(trajectories[entity.id]||[]).map(point=>({frame:point.frame,trackId:point.trackId,
    x:point.x??null,y:point.y??null,nameIdentity:nameIdentityAt(result.session,entity,point,clip)}));
  return {id:entity.id,names:[...new Set(observations.filter(o=>o.nameIdentity).map(o=>o.nameIdentity.name))],
    namedVisibleFrames:observations.filter(o=>o.nameIdentity&&o.x!==null&&o.y!==null).length,
    observations};
});
const summary={report:result.report,sourceChanged:before!==JSON.stringify(session),
  identityIssues:job.candidate.issues||[],players:players.map(({observations,...rest})=>rest),
  accuracyVerified:false};
fs.writeFileSync(path.join(folder,'applied-session.json'),JSON.stringify(result.session,null,2)+'\n');
fs.writeFileSync(path.join(folder,'application-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(folder,'name-overlay.json'),JSON.stringify({
  nameIdentitySource:{videoSha256:clip.video_sha256,trackingFingerprint:clip.tracking_fingerprint,
    trackingRevision:clip.tracking_revision,width:clip.width,height:clip.height},
  nameDisplay:{enabled:true,groups:{A:true,B:true},players:{},showName:true,showJersey:true,showAnkleRing:true},
  playerNameIdentities:players.map(({id,observations})=>({id,observations}))
},null,2)+'\n');
console.log(JSON.stringify(summary));
