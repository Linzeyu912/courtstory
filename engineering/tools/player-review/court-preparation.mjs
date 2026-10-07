import {buildTrajectories} from './trajectory.mjs';
import {buildCourtTrajectories,calibrationAt} from './court.mjs';
import {canonicalJSON} from '../tactical-overlay/binding.mjs';
import {sha256} from './tactics-authored-geometry.mjs';
import {validateFrameMapping} from './tactics-time-range.mjs';
import {identityRoleDependency} from './identity-role-guard.mjs';

const clean=value=>JSON.parse(JSON.stringify(value));
export const preparationDigest=value=>sha256(canonicalJSON(value));
export function preparationDependencies(session,clip){
  const entities=session.entities.map(e=>Object.fromEntries(['id','bindings','modelBindings','identityKeyframes','frameConfirmations','identityReference','identitySuggestionsDismissed','visibilityRanges','anchors','courtAnchors','positionCorrections'].map(k=>[k,e[k]??null])));
  return {tracking:clip.tracking_fingerprint,identities:preparationDigest(clean(entities)),
    roles:preparationDigest(identityRoleDependency(session,clip)),
    calibration:preparationDigest(session.courtCalibration??null),cuts:preparationDigest([session.cuts??[],clip.sourceCuts??[]]),
    mapping:preparationDigest(clip.frames.map(f=>[f.frame,f.time,f.source_frame??f.frame,f.source_time??f.time])),
    ground:preparationDigest(clean([session.groundComparison??null,clip.feetCandidates??null])),
    parameters:preparationDigest({maxGapSeconds:session.maxGapSeconds??0,algorithm:'conservative-time-median-v1'})};
}
export function buildCourtPreparation({session,clip,maps}){
  const frameMapping=clip.frames.map(f=>({frame:f.frame,time:f.time,sourceFrame:f.source_frame??f.frame,sourceTime:f.source_time??f.time}));
  validateFrameMapping(frameMapping,clip.mediaEndTime);
  const image=buildTrajectories(session,clip.frames,clip.sourceCuts??[],clip),raw=clean(buildCourtTrajectories(session,clip.frames,image,{clip,maps})),breaksByPlayer={};
  for(const [id,points] of Object.entries(raw)){
    breaksByPlayer[id]=[];
    for(const p of points){
      const observed=image[id][p.frame],prev=image[id][p.frame-1];
      p.locked=p.source==='court_manual'||['manual','manual_range','manual_path'].includes(p.imageSource)||p.footMethod?.startsWith('human_')===true;
      let reason=!(Number.isFinite(p.x)&&Number.isFinite(p.y))?p.source:null;
      if((session.cuts??[]).includes(p.frame)||(clip.sourceCuts??[]).includes(p.frame))reason='source_cut';
      if(prev&&(prev.trackId!==observed.trackId||prev.identityStartFrame!==observed.identityStartFrame||prev.identityOrder!==observed.identityOrder))reason??='identity_boundary';
      if(reason)breaksByPlayer[id].push({frame:p.frame,reason});
    }
  }
  const dependencies=preparationDependencies(session,clip);
  return {schemaVersion:1,revision:1,videoSha256:clip.video_sha256,dependencies,dependencyDigest:preparationDigest(dependencies),frameMapping,mediaEndTime:clip.mediaEndTime,
    rawByPlayer:raw,preparedByPlayer:structuredClone(raw),breaksByPlayer,smoothingPatches:[],
    maps:clean(maps??clip.frames.map((_,i)=>calibrationAt(session.courtCalibration,i,clip.frames,[...(session.cuts??[]),...(clip.sourceCuts??[])])))};
}
export function courtPreparationStatus(preparation,dependencies){
  const reasons=!preparation?['not_prepared']:Object.keys(dependencies).filter(k=>dependencies[k]!==preparation.dependencies[k]);
  return {current:reasons.length===0,reasons,affectedRanges:reasons.length&&preparation?[{startFrame:0,endFrameExclusive:preparation.frameMapping.length}]:[]};
}
export function preparedPoint(preparation,entityId,frame){
  const p=preparation?.preparedByPlayer[entityId]?.[frame];
  return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?p:null;
}
export function validateCourtPreparation(p){
  canonicalJSON(p);validateFrameMapping(p.frameMapping,p.mediaEndTime);
  if(p.schemaVersion!==1||!Number.isSafeInteger(p.revision)||p.revision<1||typeof p.videoSha256!=='string'||p.dependencyDigest!==preparationDigest(p.dependencies)||!Array.isArray(p.smoothingPatches)||p.operations!==undefined&&!Array.isArray(p.operations))throw new Error('2D 准备版本无效。');
  const ids=Object.keys(p.rawByPlayer);
  if(ids.join('|')!==Object.keys(p.preparedByPlayer).join('|'))throw new Error('2D 球员引用无效。');
  for(const id of ids)for(const points of [p.rawByPlayer[id],p.preparedByPlayer[id]]){
    if(points.length!==p.frameMapping.length||points.some((point,i)=>point.frame!==i||point.time!==p.frameMapping[i].time||!((point.x===null&&point.y===null)||(Number.isFinite(point.x)&&Number.isFinite(point.y)))))throw new Error('2D 逐帧位置无效。');
  }
  for(const id of ids)for(let i=0;i<p.rawByPlayer[id].length;i++)if(p.rawByPlayer[id][i].locked&&preparationDigest(p.rawByPlayer[id][i])!==preparationDigest(p.preparedByPlayer[id][i]))throw new Error('2D 准备不能改写人工锁定点。');
  return p;
}
