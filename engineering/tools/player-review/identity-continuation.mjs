import {replaceIdentityRange} from './trajectory.mjs';
import {identityAt,frameIdentityConfirmed} from './identity-timeline.mjs';
import {mergeSourceCuts} from './tracking-display.mjs';

const plainText=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const validBox=box=>Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&box[2]>box[0]&&box[3]>box[1];
const humanIdentity=(entity,identity,frame)=>identity&&(identity.identitySource!=='model_suggestion'||
  frameIdentityConfirmed(entity,{frame,x:0,y:0,trackId:identity.trackId,source:'tracked'},identity));

function source(clip){
  if(!plainText(clip?.video_sha256,256)||!clip.video_sha256||!plainText(clip?.tracking_fingerprint,256)||!clip.tracking_fingerprint||
      !Array.isArray(clip.frames)||!clip.frames.length)throw new Error('当前视频或跟踪版本不完整，不能建立身份参考。');
  return {videoHash:clip.video_sha256,trackingFingerprint:clip.tracking_fingerprint};
}

function observation(clip,frame,trackId){
  if(!Number.isInteger(frame)||frame<0||frame>=clip.frames.length||!Number.isInteger(trackId)||trackId<1)throw new Error('身份参考帧或临时编号不正确。');
  const record=clip.frames[frame],rows=record?.tracks?.filter(row=>Number(row[4])===trackId)||[];
  if(!Number.isFinite(record?.time)||rows.length!==1||!validBox(rows[0].slice(0,4)))throw new Error(`第 ${frame+1} 帧没有唯一有效的 T${trackId} 观测。`);
  return rows[0].slice(0,4);
}

export function createIdentityReference(clip,{frame,trackId,team='',jersey=''}={}){
  const binding=source(clip),box=observation(clip,frame,trackId);
  if(!plainText(team,40)||typeof jersey!=='string'||!/^\d{0,3}$/.test(jersey))throw new Error('球队 / 球衣描述限 40 字，号码须为 0–3 位数字。');
  return {version:1,...binding,frame,trackId,box,team:team.trim(),jersey:jersey.trim()};
}

function validateReference(session,reference,clip,entityId){
  const binding=source(clip);
  if(session?.videoHash!==binding.videoHash||reference?.version!==1||reference.videoHash!==binding.videoHash||
      reference.trackingFingerprint!==binding.trackingFingerprint)throw new Error('身份参考与当前视频或跟踪版本不匹配，请重新保存参考。');
  if(!/^P(?:[1-9]|10)$/.test(entityId)||!session.entities?.some(e=>e.id===entityId&&e.role==='player'))throw new Error('请选择固定球员 P1–P10。');
  const current=createIdentityReference(clip,reference);
  if(!validBox(reference.box)||current.box.some((n,i)=>n!==reference.box[i]))throw new Error('身份参考框与原始观测不同，请重新保存参考。');
  return current;
}

// The caller confirms this single frame in the same undo transaction. This
// helper intentionally does not establish a forward or whole-track identity.
export function saveReferenceToSession(session,{entityId,reference},clip){
  const validated=validateReference(session,reference,clip,entityId),copy=structuredClone(session);
  copy.entities.find(e=>e.id===entityId).identityReference=validated;
  return copy;
}

function validatedSegments(segments,clip){
  if(!Array.isArray(segments)||!segments.length||segments.length>200)throw new Error('请先选择有效的候选片段。');
  const ids=new Set();
  const result=segments.map(item=>{
    if(!item||!plainText(item.id,128)||!item.id||ids.has(item.id)||!Number.isInteger(item.trackId)||item.trackId<1||
      !Number.isInteger(item.start)||!Number.isInteger(item.end)||item.start<0||item.end>=clip.frames.length||item.start>item.end||
      !Number.isFinite(item.confidence)||item.confidence<0||item.confidence>1||!plainText(item.reason,2000)||!item.reason.trim()||
      !Array.isArray(item.evidenceFrames)||!item.evidenceFrames.length||item.evidenceFrames.length>100)throw new Error('候选片段格式或区间不正确，未采用任何片段。');
    ids.add(item.id);
    const originalStart=item.originalStart??item.start,originalEnd=item.originalEnd??item.end;
    if(!Number.isInteger(originalStart)||!Number.isInteger(originalEnd)||originalStart<0||originalEnd>=clip.frames.length||
      originalStart>item.start||originalEnd<item.end)throw new Error('只能在原候选范围内缩小区间。');
    for(const frame of item.evidenceFrames){
      if(frame<originalStart||frame>originalEnd)throw new Error('候选证据帧不属于原候选片段。');
      observation(clip,frame,item.trackId);
    }
    if(!clip.frames.slice(item.start,item.end+1).some(record=>record.tracks.some(row=>Number(row[4])===item.trackId)))throw new Error('候选片段内没有这个临时编号的观测。');
    return {...item};
  }).sort((a,b)=>a.start-b.start||a.end-b.end);
  if(result.some((item,i)=>i>0&&item.start<=result[i-1].end))throw new Error('所选候选片段时间重叠，请先缩小区间，不能同时采用。');
  return result;
}

function conflict(entity,frame){throw new Error(`第 ${frame+1} 帧与 ${entity.id} 的人工记录冲突；请先使用人工区间修正，未采用任何片段。`);}

/** Atomic, finite adoption. Model candidates cannot take human-owned tracks. */
export function applyIdentityCandidates(session,{entityId,reference,segments},clip){
  validateReference(session,reference,clip,entityId);
  const candidates=validatedSegments(segments,clip),cuts=mergeSourceCuts(session.cuts,clip.sourceCuts,clip.frames.length),cutSet=new Set(cuts);
  const selected=session.entities.find(e=>e.id===entityId),runs=[];
  const preview={start:candidates[0].start,end:candidates.at(-1).end,changed:0,missing:0,segments:0,preservedManual:0,affectedPlayers:{}};
  // Preflight all candidates before building even the first replacement.
  for(const candidate of candidates){
    let run=null;
    for(let frame=candidate.start;frame<=candidate.end;frame++){
      const present=clip.frames[frame].tracks.some(row=>Number(row[4])===candidate.trackId);
      if(!present){preview.missing++;run=null;continue;}
      observation(clip,frame,candidate.trackId);
      for(const other of session.entities){
        if(other.id===entityId)continue;
        const identity=identityAt(other,frame,cuts,clip.frames[frame]);
        if((humanIdentity(other,identity,frame)&&(identity.trackId===candidate.trackId||identity.candidateTrackIds?.includes(candidate.trackId)))||
            (other.anchors||[]).some(anchor=>anchor.frame===frame&&anchor.trackId===candidate.trackId))conflict(other,frame);
      }
      const own=identityAt(selected,frame,cuts,clip.frames[frame]),anchor=(selected.anchors||[]).find(a=>a.frame===frame);
      if(anchor&&(anchor.trackId!==candidate.trackId||anchor.source==='manual_path'))conflict(selected,frame);
      if(humanIdentity(selected,own,frame)&&(own.kind!=='track'||own.trackId!==candidate.trackId))conflict(selected,frame);
      // Existing compatible human rules and reviews already do this job. Keep
      // their original identity tokens instead of re-certifying or erasing them.
      if(humanIdentity(selected,own,frame)){preview.preservedManual++;run=null;continue;}
      if(!run||cutSet.has(frame)){run={trackId:candidate.trackId,start:frame,end:frame};runs.push(run);}
      else run.end=frame;
    }
  }
  let draft=structuredClone(session);
  for(const run of runs){
    const result=replaceIdentityRange(draft,{entityId,...run},clip.frames,clip.sourceCuts);
    draft=result.session;preview.changed+=result.preview.changed;preview.segments+=result.preview.segments;
    for(const [id,count] of Object.entries(result.preview.affectedPlayers))preview.affectedPlayers[id]=(preview.affectedPlayers[id]||0)+count;
  }
  return {session:draft,preview};
}
