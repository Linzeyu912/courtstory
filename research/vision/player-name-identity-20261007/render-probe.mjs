import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyPlayerNameIdentities,nameIdentityAt} from '../../../engineering/tools/player-review/player-name-identity.mjs';
import {buildTrajectories,exportReview} from '../../../engineering/tools/player-review/trajectory.mjs';
import {createTacticsDocument} from '../../../engineering/tools/player-review/tactics-document.mjs';
import {nameDisplaySelected,nameIdentityLabel} from '../../../engineering/tools/player-review/team-overlay.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const DATA=path.join(ROOT,'artifacts/player-name-identity-20261007/all-players-v2');
const OUT=path.join(ROOT,'artifacts/player-name-identity-20261007/render');
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const write=async(file,value)=>writeFile(file,JSON.stringify(value));

await mkdir(OUT,{recursive:true});
const [inputSession,clip,job]=await Promise.all([
  read(path.join(DATA,'input-session.json')),
  read(path.join(DATA,'input-clip.json')),
  read(path.join(DATA,'job.json'))
]);
if(job.purpose!=='player_names'||job.status!=='ready')throw new Error('真实姓名识别任务不是 ready。');
const p9=job.candidate?.candidates?.filter(item=>item.entityId==='P9'&&item.status==='candidate'&&
  (item.nameCandidate?.name||item.nameCandidate)==='Cooper Flagg');
if(!p9?.length)throw new Error('真实任务中没有 Cooper Flagg 姓名候选。');

const {session}=applyPlayerNameIdentities(inputSession,job,clip);
const trajectories=buildTrajectories(session,clip.frames,clip.sourceCuts||[],clip);
const selected=p9.find(item=>item.start<=502&&item.end>=502)||p9[0];
const center=(clip.frames[selected.start].time+clip.frames[selected.end].time)/2;
const windowSeconds=3;
const nearestFrame=time=>clip.frames.reduce((best,item)=>Math.abs(item.time-time)<Math.abs(clip.frames[best].time-time)?item.frame:best,0);
const frameStart=Math.max(selected.start,nearestFrame(center-windowSeconds/2));
const frameEndExclusive=Math.min(selected.end+1,nearestFrame(center+windowSeconds/2));
if(frameEndExclusive-frameStart<2)throw new Error('候选区间不足以提供 QA 视频窗口。');

const entities=session.entities.filter(entity=>entity.role==='player');
const nameDisplay={enabled:true,groups:{A:true,B:true},players:Object.fromEntries(entities.map(entity=>[entity.id,entity.id==='P9'])),
  showName:true,showJersey:true,showAnkleRing:true};
const playerNameIdentities=entities.map(entity=>({id:entity.id,observations:(trajectories[entity.id]||[]).map(point=>({
  frame:point.frame,trackId:point.trackId??null,x:point.x??null,y:point.y??null,
  nameIdentity:nameIdentityAt(session,entity,point,clip)
}))}));
const nameOverlay={nameDisplay,nameIdentitySource:{videoSha256:clip.video_sha256,
  trackingFingerprint:clip.tracking_fingerprint,trackingRevision:clip.tracking_revision,
  width:clip.width,height:clip.height},playerNameIdentities};

const p9Entity=entities.find(entity=>entity.id==='P9');
const visible=playerNameIdentities.find(entity=>entity.id==='P9').observations.filter(item=>item.frame>=frameStart&&
  item.frame<frameEndExclusive&&item.nameIdentity?.name==='Cooper Flagg'&&item.nameIdentity.identityVerified===false&&
  item.trackId===selected.trackId&&Number.isFinite(item.x)&&Number.isFinite(item.y));
if(!visible.length)throw new Error('窗口中没有 nameIdentityAt 确认的当前可见 Cooper Flagg T 位置。');
const checkedLabel=nameIdentityLabel(visible[Math.floor(visible.length/2)].nameIdentity,p9Entity,nameDisplay);
if(checkedLabel!=='Cooper Flagg? · #32')throw new Error(`显示文本不符合未确认候选规则：${checkedLabel}`);
if(!nameDisplaySelected(p9Entity,nameDisplay))throw new Error('P9 当前姓名显示设置意外被过滤。');

const review=exportReview(session,clip,'2026-10-07T00:00:00.000Z',{allowEmpty:true});
const document=await createTacticsDocument(review);
document.playDefinition.startFrame=frameStart;
document.playDefinition.endFrameExclusive=frameEndExclusive;
document.playDefinition.phases[0].startFrame=frameStart;
document.playDefinition.phases[0].endFrameExclusive=frameEndExclusive;
document.playDefinition.phases[0].freezeFrame=frameStart;
const manifest={case:'all-players-v2',jobId:job.jobId,videoSha256:clip.video_sha256,
  trackingFingerprint:clip.tracking_fingerprint,trackingRevision:clip.tracking_revision,
  frameStart,frameEndExclusive,sourceTimeStart:clip.frames[frameStart].time,
  sourceTimeEnd:clip.frames[frameEndExclusive-1].time,windowSeconds,
  entityId:'P9',trackId:selected.trackId,name:'Cooper Flagg',jersey:'32',identityVerified:false,
  nameIdentityCount:visible.length,label:checkedLabel,fps:30};
await write(path.join(OUT,'render-input.json'),{manifest,clipSummary:{video_sha256:clip.video_sha256,
  tracking_fingerprint:clip.tracking_fingerprint,tracking_revision:clip.tracking_revision,
  width:clip.width,height:clip.height,frames:clip.frames.length},document,nameOverlay});
console.log(JSON.stringify(manifest,null,2));
