import {identityAt,frameIdentityConfirmed,filterDismissedModelBindings} from './identity-timeline.mjs';

const copy=value=>structuredClone(value);
const lists=['modelBindings','anchors','courtAnchors','bindings','identityKeyframes','frameConfirmations','visibilityRanges','dismissedModelBindings'];
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
export function initialIdentitySlotBasis(session){
  return Object.fromEntries(session.entities.filter(e=>e.role==='player').map(e=>[e.id,{
    ...Object.fromEntries(lists.map(k=>[k,copy(e[k]??[])])),
    ...Object.fromEntries(['name','team','jersey'].map(k=>[k,e[k]??''])),
    identityReference:copy(e.identityReference??null),identitySuggestionsDismissed:e.identitySuggestionsDismissed??false}]));
}
const observed=(clip,frame,track)=>{
  const rows=(clip.frames[frame]?.tracks??[]).filter(r=>r[4]===track);
  return rows.length===1&&rows[0].slice(0,4).every(Number.isFinite)&&rows[0][2]>rows[0][0]&&rows[0][3]>rows[0][1]?rows[0]:null;
};
const risk=(clip,frame,track)=>{
  const e=clip.frames[frame]?.track_evidence?.[track];return e?.color_conflict===true||e?.identity_review_required===true;
};
function validate(result,clip){
  const b=result?.base,c=result?.candidate;
  if(result?.purpose!=='initial_review'||typeof result.jobId!=='string'||!result.jobId||typeof result.sourceKey!=='string'||!result.sourceKey||
    result.algoVersion!=='initial-identity-review-v1'||b?.videoHash!==clip.video_sha256||b?.trackingFingerprint!==clip.tracking_fingerprint||b?.trackingRevision!==clip.tracking_revision||
    c?.schemaVersion!==1||c.identityVerified!==false||c.reviewRequired!==true||!Array.isArray(c.subjects)||!Array.isArray(c.segments)||!Array.isArray(c.issues)||!c.slotBasis)
    throw new Error('初检结果与当前视频、跟踪版本或候选合同不符，未修改草稿。');
  const people=new Map();for(const p of c.subjects){
    if(!p||typeof p.subjectId!=='string'||people.has(p.subjectId)||!['player','referee','other','uncertain'].includes(p.role)||
      p.entityId!==null&&!/^P(?:[1-9]|10)$/.test(p.entityId)||typeof p.reason!=='string'||!p.reason.trim())throw new Error('初检人物说明不完整。');
    people.set(p.subjectId,p);
  }
  const ids=new Set();for(const s of c.segments){
    const p=people.get(s?.subjectId);
    if(!s||!p||typeof s.id!=='string'||!s.id||ids.has(s.id)||s.role!==p.role||s.entityId!==p.entityId||
      !Number.isInteger(s.trackId)||s.trackId<1||!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start<0||s.end>=clip.frames.length||s.start>s.end||
      !Number.isFinite(s.confidence)||s.confidence<0||s.confidence>1||typeof s.reason!=='string'||!s.reason.trim()||!Array.isArray(s.evidenceFrames)||
      !s.evidenceFrames.includes(s.start)||!s.evidenceFrames.includes(s.end)||s.evidenceFrames.some(f=>!Number.isInteger(f)||f<s.start||f>s.end||!observed(clip,f,s.trackId)))
      throw new Error('初检片段缺少真实起止证据，未修改草稿。');
    ids.add(s.id);
  }
}
function ranges(frames,cuts){
  const result=[];for(const frame of [...new Set(frames)].sort((a,b)=>a-b)){
    const last=result.at(-1);if(last&&last.end===frame-1&&!cuts.has(frame))last.end=frame;
    else result.push({start:frame,end:frame});
  }return result;
}
function subtract(binding,blocked,cuts){
  const kept=[];for(let f=binding.start;f<=binding.end;f++)if(!blocked.has(f))kept.push(f);
  return ranges(kept,cuts).map(range=>({...copy(binding),...range}));
}

/** Machine-only, atomic application. Human rules and their identity tokens win. */
export function applyInitialIdentityReview(session,result,clip){
  validate(result,clip);
  if(session.videoHash!==clip.video_sha256)throw new Error('草稿不属于当前视频。');
  const generationJobId=result.generationJobId??result.jobId;
  const report={changedModelBindings:0,excludedObservations:0,preservedHuman:0,issues:copy(result.candidate.issues)};
  if(session.initialIdentityReview?.generationJobId===generationJobId&&session.initialIdentityReview?.sourceKey===result.sourceKey)
    return {session:copy(session),report:{...report,alreadyApplied:true}};
  const next=copy(session),people=new Map(next.entities.map(e=>[e.id,e])),basis=initialIdentitySlotBasis(session);
  const cuts=new Set([...(session.cuts??[]),...(clip.sourceCuts??[])]),count=clip.frames.length;
  const changedSlots=new Set([...people.values()].filter(e=>e.role==='player'&&stable(basis[e.id])!==stable(result.candidate.slotBasis[e.id])).map(e=>e.id));
  const issues=new Map();const addIssue=(kind,s,reason)=>{
    const key=`${kind}:${s.id??s.entityId??s.trackId}`;
    if(!issues.has(key))issues.set(key,{id:`apply-${issues.size+1}`,kind,entityId:s.entityId??null,trackId:s.trackId??null,
      start:s.start??0,end:s.end??count-1,reason,evidenceFrames:copy(s.evidenceFrames??[])});
  };
  const protections=new Map(),frozen=new Map();
  for(const e of session.entities){
    const set=new Set();for(let f=0;f<count;f++){
      const identity=identityAt(e,f,[...cuts],clip.frames[f]);
      if(identity&&identity.identitySource!=='model_suggestion'||
        frameIdentityConfirmed(e,{frame:f,x:0,y:0,trackId:identity?.trackId??null,source:'tracked'},identity)||
        (e.anchors??[]).some(a=>a.frame===f)||(e.courtAnchors??[]).some(a=>a.frame===f)||
        (e.frameConfirmations??[]).some(a=>a.frame===f)||(e.visibilityRanges??[]).some(r=>r.start<=f&&f<=r.end))set.add(f);
    }
    // Splitting a reviewed model binding would change its confirmation token.
    // Keep the entire original record when any of its frames has human evidence.
    const retained=new Set();for(const [i,b] of (e.modelBindings??[]).entries())if([...set].some(f=>b.start<=f&&f<=b.end)){
      retained.add(i);for(let f=b.start;f<=b.end;f++)set.add(f);
    }
    protections.set(e.id,set);frozen.set(e.id,retained);
  }
  const claims=new Map();
  for(const s of result.candidate.segments){
    if(s.confidence<.75||s.role==='uncertain'||s.role==='player'&&!s.entityId){addIssue('identity_uncertain',s,'证据不足以自动关联，保留候选供人工核对。');continue;}
    if(s.role==='player'&&changedSlots.has(s.entityId)){addIssue('slot_basis_changed',s,'此球员槽位已与初检时不同，未把缓存身份套入当前人工稿。');continue;}
    if(s.role==='player'&&(!people.has(s.entityId)||people.get(s.entityId).identitySuggestionsDismissed)){
      addIssue('manual_exclusion',s,'此槽位已人工排除，未自动恢复。');continue;
    }
    for(let f=s.start;f<=s.end;f++){
      if(!observed(clip,f,s.trackId)||risk(clip,f,s.trackId)){addIssue('observation_gap',s,'缺测或身份风险处保持空缺，未延伸关联。');continue;}
      const key=`${f}:${s.trackId}`,list=claims.get(key)??[];list.push(s);claims.set(key,list);
    }
  }
  const targets=new Map();for(const [key,list] of claims){
    const unique=new Set(list.map(s=>`${s.subjectId}:${s.entityId}:${s.role}`));
    if(unique.size>1){for(const s of list)addIssue('identity_conflict',s,'同一观察存在不同人物或角色判断，未自动选择。');continue;}
    const s=list[0],f=Number(key.split(':')[0]);
    if(s.role==='player'){
      const target=`${f}:${s.entityId}`,other=targets.get(target);targets.set(target,other&&other.trackId!==s.trackId?{conflict:true,segments:[...(other.segments??[other]),s]}:other??s);
    }
  }
  const removals=new Map(next.entities.map(e=>[e.id,new Map()])),additions=new Map(),exclusions=new Map();
  for(const [key,list] of claims){
    const s=list[0],f=Number(key.split(':')[0]);
    if(new Set(list.map(s=>`${s.subjectId}:${s.entityId}:${s.role}`)).size>1)continue;
    if(s.role==='player'&&targets.get(`${f}:${s.entityId}`)?.conflict){addIssue('identity_conflict',s,'同一球员槽位在本帧对应多个框，未自动关联。');continue;}
    if(session.entities.some(e=>changedSlots.has(e.id)&&(e.modelBindings??[]).some(b=>b.trackId===s.trackId&&b.start<=f&&f<=b.end))){
      addIssue('slot_basis_changed',s,'该观察在当前草稿中的球员归属已变化，未用缓存结果替换。');continue;
    }
    const blocked=session.entities.some(e=>{
      if(!protections.get(e.id).has(f))return false;
      const identity=identityAt(e,f,[...cuts],clip.frames[f]);
      return e.id===s.entityId||identity?.trackId===s.trackId||identity?.candidateTrackIds?.includes(s.trackId)||
        (e.anchors??[]).some(a=>a.frame===f&&a.trackId===s.trackId);
    });
    if(blocked){report.preservedHuman++;addIssue('manual_conflict',s,'相关观察已有人工身份、位置或画面状态，保留原记录。');continue;}
    const dismissed=filterDismissedModelBindings([{kind:'track',trackId:s.trackId,start:f,end:f}],session.entities);
    if(!dismissed.length){addIssue('manual_exclusion',s,'该观察已被人工排除，未自动恢复。');continue;}
    for(const e of next.entities){
      const map=removals.get(e.id),frames=map.get(s.trackId)??new Set();frames.add(f);map.set(s.trackId,frames);
      if(e.id===s.entityId)for(const b of e.modelBindings??[]){const own=map.get(b.trackId)??new Set();own.add(f);map.set(b.trackId,own);}
    }
    const store=s.role==='player'?additions:exclusions;
    const group=store.get(s.id)??{segment:s,frames:[]};group.frames.push(f);store.set(s.id,group);
  }
  for(const e of next.entities){
    const before=copy(e.modelBindings??[]),map=removals.get(e.id);
    if(before.some(b=>map.get(b.trackId)?.size))e.modelBindings=before.flatMap((b,i)=>frozen.get(e.id).has(i)||!map.has(b.trackId)?[b]:subtract(b,map.get(b.trackId),cuts));
  }
  for(const {segment:s,frames} of additions.values()){
    const e=people.get(s.entityId);e.modelBindings??=[];
    for(const range of ranges(frames,cuts))e.modelBindings.push({kind:'track',trackId:s.trackId,...range,
      source:'model_suggestion',origin:'agent_initial_review',method:result.algoVersion,jobId:result.jobId,
      reviewRequired:true,identityConfirmed:false,confidence:s.confidence,reason:s.reason,evidenceFrames:copy(s.evidenceFrames)});
  }
  for(const e of next.entities)if(stable(e.modelBindings??[])!==stable(session.entities.find(p=>p.id===e.id).modelBindings??[]))report.changedModelBindings++;
  const excluded=[];for(const {segment:s,frames} of exclusions.values())for(const range of ranges(frames,cuts)){
    excluded.push({trackId:s.trackId,...range,role:s.role,reason:s.reason,evidenceFrames:copy(s.evidenceFrames)});
    report.excludedObservations+=range.end-range.start+1;
  }
  report.issues.push(...issues.values());
  next.initialIdentityReview={version:1,jobId:result.jobId,generationJobId,sourceKey:result.sourceKey,algoVersion:result.algoVersion,
    videoHash:clip.video_sha256,trackingFingerprint:clip.tracking_fingerprint,trackingRevision:clip.tracking_revision,
    identityVerified:false,reviewRequired:true,exclusions:excluded,subjects:copy(result.candidate.subjects),
    summary:result.candidate.summary,issues:copy(report.issues),report:copy(report)};
  return {session:next,report};
}
