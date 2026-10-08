import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildTrajectories} from '../../../engineering/tools/player-review/trajectory.mjs';
import {applyPlayerNameIdentities,nameIdentityAt} from '../../../engineering/tools/player-review/player-name-identity.mjs';
import {stabilizePoints} from '../../../engineering/tools/player-review/team-overlay.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const folder=path.resolve(root,process.argv[2]||'artifacts/player-name-identity-20261007/all-players-v3');
const out=path.resolve(root,process.argv[3]||'artifacts/player-name-optimization-20261007/full-tracking');
if(!folder.startsWith(path.join(root,'artifacts')+path.sep)||!out.startsWith(path.join(root,'artifacts')+path.sep))
  throw new Error('Replay inputs and outputs must stay in local artifacts.');
const sourceBytes=new Map();
const read=file=>{const bytes=fs.readFileSync(file);sourceBytes.set(file,bytes);return JSON.parse(bytes.toString('utf8'));};
const clip=read(path.join(folder,'input-clip.json')),original=read(path.join(folder,'input-session.json'));
const applied=applyPlayerNameIdentities(original,read(path.join(folder,'job.json')),clip),session=applied.session;
const policy=read(path.join(root,'engineering/tools/player-review/team-overlay-policy.json'));
const trajectories=buildTrajectories(session,clip.frames,clip.sourceCuts||[],clip);
const cuts=[...new Set([...(clip.sourceCuts||[]),...(session.cuts||[])])];
const entities=session.entities.filter(e=>e.role==='player').map(entity=>{
  const points=trajectories[entity.id],display=stabilizePoints(points,cuts,clip.width,clip.height,policy);
  return {id:entity.id,role:'player',observations:points.map((point,i)=>({
    frame:point.frame,trackId:point.trackId??null,x:display[i].x??null,y:display[i].y??null,
    box:display[i].box??null,source:point.source,
    nameIdentity:nameIdentityAt(session,entity,point,clip)
  }))};
});
fs.mkdirSync(out,{recursive:true});
const coverage=entities.map(entity=>{
  const located=entity.observations.filter(point=>point.x!==null&&point.y!==null),named=located.filter(point=>point.nameIdentity);
  const profile=session.entities.find(item=>item.id===entity.id).machinePlayerProfile||null;
  return {id:entity.id,visiblePositionFrames:located.length,namedPositionFrames:named.length,
    namedCoverage:located.length?named.length/located.length:0,unknownPositionFrames:located.length-named.length,
    names:[...new Set(named.map(point=>point.nameIdentity.name))],
    machineAcceptedFrames:named.filter(point=>point.nameIdentity.nameStatus==='machine_accepted').length,
    continuationFrames:named.filter(point=>point.nameIdentity.positionBindingStatus==='verified_continuation').length,
    positionNeedsReviewFrames:named.filter(point=>point.nameIdentity.positionBindingStatus==='needs_review').length,
    profileName:profile?.name||null,profileNameStatus:profile?.nameStatus||'unknown',profile};
});
const nameOverlay={nameIdentitySource:{videoSha256:clip.video_sha256,trackingFingerprint:clip.tracking_fingerprint,
  trackingRevision:clip.tracking_revision,width:clip.width,height:clip.height},
  nameDisplay:{enabled:true,groups:{A:true,B:true},players:{},showName:true,showJersey:true,showAnkleRing:true},
  playerNameIdentities:entities};
const sourceFilesUnchanged=[...sourceBytes].every(([file,bytes])=>bytes.equals(fs.readFileSync(file)));
if(!sourceFilesUnchanged)throw new Error('Replay input files changed during consumption; no result was published.');
fs.writeFileSync(path.join(out,'snapshot.json'),JSON.stringify({nameOverlay,cuts,
  frames:clip.frames.map(f=>({frame:f.frame,time:f.time})),identityIssues:session.entities.flatMap(e=>(e.machineNameIdentityConflicts||[]).map(x=>({entityId:e.id,...x}))) }));
fs.writeFileSync(path.join(out,'coverage.json'),JSON.stringify({sourceFolder:path.relative(root,folder),
  sourceFilesUnchanged,accuracyVerified:false,applicationReport:applied.report,players:coverage},null,2)+'\n');
fs.writeFileSync(path.join(out,'applied-session.json'),JSON.stringify(session,null,2)+'\n');
console.log(JSON.stringify({frames:clip.frames.length,players:entities.length,
  coverage:coverage.map(({profile,...counts})=>counts),out}));
