import {buildTrajectories,setPlayerVisibility} from './trajectory.mjs';
import {identityKeyframes,migrateIdentitySession,nextIdentityOrder} from './identity-timeline.mjs';

const observed=(record,trackId)=>record?.tracks?.some(box=>Number(box[4])===trackId);
const rangeContains=(range,frame)=>range.start<=frame&&frame<=range.end;
function uniqueBox(record,trackId){
  const matches=(record?.tracks||[]).filter(box=>Number(box[4])===trackId);
  const box=matches[0],evidence=record?.track_evidence?.[trackId];
  const conflict=Array.isArray(record?.role_conflicts)?record.role_conflicts.some(item=>item.trackIds?.some(id=>Number(id)===trackId)):record?.role_conflicts?.[trackId];
  return matches.length===1&&box.slice(0,4).every(Number.isFinite)&&box[2]>box[0]&&box[3]>box[1]&&!evidence?.identity_review_required&&!evidence?.role_conflict&&!conflict?box:null;
}
function continuousPerson(previous,current,trackId){
  const a=uniqueBox(previous,trackId),b=uniqueBox(current,trackId);if(!a||!b)return false;
  const elapsed=current.time-previous.time;if(!Number.isFinite(elapsed)||elapsed<=0||elapsed>.25)return false;
  const ah=a[3]-a[1],bh=b[3]-b[1],areaRatio=(b[2]-b[0])*bh/((a[2]-a[0])*ah);
  const distance=Math.hypot((a[0]+a[2]-b[0]-b[2])/2,(a[1]+a[3]-b[1]-b[3])/2);
  return areaRatio>=.4&&areaRatio<=2.5&&distance<=Math.max(ah,bh)*.65;
}

/** Clicking a visible person selects its current owner. Assignment is explicit. */
export function identityPersonSelection(trajectories,frame,trackId){
  const owners=Object.entries(trajectories).filter(([,points])=>{
    const point=points[frame];
    return point?.trackId===trackId&&point.x!=null&&!point.reviewExcluded&&!['conflict','out_of_view'].includes(point.source);
  }).map(([id])=>id);
  return {trackId,entityId:owners.length===1?owners[0]:null,owners};
}

/** Inclusive, observed run; never propagate a correction across a gap or boundary. */
export function identityQuickRange({session,clip,frame,trackId,entityId}){
  const last=clip.frames.length-1;
  if(!Number.isInteger(frame)||frame<0||frame>last)throw new Error('请先定位到视频中的一帧。');
  const boundaries=new Set([0,last+1,...(session.cuts||[]),...(clip.sourceCuts||[])]);
  for(const entity of session.entities||[]){
    const keys=identityKeyframes(entity);
    const related=entity.id===entityId||Number.isInteger(trackId)&&[...keys,...(entity.bindings||[]),...(entity.modelBindings||[]),...(entity.machineIdentityBindings||[]),...(entity.anchors||[]),...(entity.frameConfirmations||[])]
      .some(record=>record.trackId!=null&&Number(record.trackId)===trackId);
    if(!related)continue;
    for(const key of keys)boundaries.add(key.frame);
    for(const binding of entity.bindings||[]){
      if(binding.scope==='track_occurrences')continue;
      boundaries.add(binding.start);boundaries.add(binding.end+1);
    }
    for(const confirmation of entity.frameConfirmations||[]){boundaries.add(confirmation.frame);boundaries.add(confirmation.frame+1);}
    for(const visibility of entity.visibilityRanges||[]){boundaries.add(visibility.start);boundaries.add(visibility.end+1);}
  }
  let start=frame,end=frame;
  if(Number.isInteger(trackId)&&uniqueBox(clip.frames[frame],trackId)){
    while(start>0&&!boundaries.has(start)&&continuousPerson(clip.frames[start-1],clip.frames[start],trackId))start--;
    while(end<last&&!boundaries.has(end+1)&&continuousPerson(clip.frames[end],clip.frames[end+1],trackId))end++;
  }
  return {start,end,trackId:Number.isInteger(trackId)?trackId:null,
    reason:start===end?'仅当前画面':'当前连续出现的一段；遇到缺帧、突变、切镜或人工边界停止'};
}

/** Low-priority T occurrence assignment. Human corrections and review tokens survive. */
export function assignIdentityTrackOccurrences(session,{entityId,trackId,start,end,selectionFrame},clip){
  const frames=clip.frames;
  if(!session.entities.some(entity=>entity.id===entityId&&entity.role==='player')||!Number.isInteger(trackId)||trackId<1||
    !Number.isInteger(start)||!Number.isInteger(end)||start<0||end>=frames.length||start>end)throw new Error('请选择球员、有效临时编号和起止区间。');
  const observations=frames.flatMap((record,index)=>index>=start&&index<=end&&observed(record,trackId)?[index]:[]);
  if(!observations.length)throw new Error('所选时间段没有这个临时编号的观测。');
  const before=buildTrajectories(session,frames,clip.sourceCuts||[],clip),draft=structuredClone(session);
  migrateIdentitySession(draft);
  const entity=draft.entities.find(entity=>entity.id===entityId),cuts=new Set([...(session.cuts||[]),...(clip.sourceCuts||[])]);
  const excluded=session.entities.flatMap(item=>item.dismissedModelBindings||[]).filter(item=>Number(item.trackId)===trackId);
  const protectedFrames=new Set(observations.filter(at=>{
    const point=before[entityId][at];
    return point.frameIdentityConfirmed||point.reviewExcluded||['manual','manual_range','manual_path','out_of_view'].includes(point.source)||
      ['manual_range','human_unassigned'].includes(point.identitySource)||
      point.identitySource==='manual_forward'&&observed(frames[at],point.trackId)||
      (entity.visibilityRanges||[]).some(range=>rangeContains(range,at)&&range.state!=='visible')||
      excluded.some(range=>rangeContains(range,at))||
      Object.entries(before).some(([id,points])=>id!==entityId&&points[at]?.trackId===trackId&&points[at].x!=null&&(points[at].identityExclusive||points[at].frameIdentityConfirmed||points[at].source==='manual'));
  }));
  entity.bindings||=[];
  const existing=entity.bindings.filter(binding=>binding.scope==='track_occurrences'&&binding.trackId===trackId);
  const missing=observations.filter(at=>!protectedFrames.has(at)&&!existing.some(binding=>rangeContains(binding,at)));
  const ranges=[];
  for(const at of missing){
    const previous=ranges.at(-1);
    if(previous&&previous.end===at-1&&!cuts.has(at)&&continuousPerson(frames[at-1],frames[at],trackId))previous.end=at;
    else ranges.push({start:at,end:at});
  }
  if(ranges.length){
    const order=nextIdentityOrder(draft);
    entity.bindings.push(...ranges.map(range=>({kind:'track',trackId,...range,scope:'track_occurrences',origin:'human_track_assignment',
      selectionFrame:Number.isInteger(selectionFrame)?selectionFrame:observations[0],order,exclusive:false,reviewRequired:true})));
    draft.identitySelection=null;
  }
  const after=buildTrajectories(draft,frames,clip.sourceCuts||[],clip);
  const preview={start,end,observationCount:observations.length,changed:0,missing:0,conflicts:0,preservedHuman:protectedFrames.size,segments:ranges.length,affectedPlayers:{}};
  for(const at of observations){
    const point=after[entityId][at];
    if(point.source==='conflict')preview.conflicts++;
    if(!protectedFrames.has(at)&&point.trackId===trackId&&point.x!=null)preview.changed++;
    else if(!protectedFrames.has(at)&&point.x==null)preview.missing++;
    for(const id of Object.keys(after))if(id!==entityId&&after[id][at].claimedBy===entityId&&before[id][at].x!=null)preview.affectedPlayers[id]=(preview.affectedPlayers[id]||0)+1;
  }
  return {session:draft,preview};
}

/** Human exclusion is finite and undoable; records outside the interval survive. */
export function excludeIdentityPersonRange(session,{trackId,start,end,entityId},clip){
  if(!Number.isInteger(trackId)||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>=clip.frames.length||start>end||
    !clip.frames.slice(start,end+1).some(record=>observed(record,trackId)))throw new Error('请先选择画面中的人和有效时间段。');
  const draft=structuredClone(session),before=buildTrajectories(session,clip.frames,clip.sourceCuts||[],clip),order=nextIdentityOrder(draft);
  const dismissed={kind:'track',trackId,start,end,reason:'human_not_player'};
  let changed=0,recorded=false;
  for(const entity of draft.entities.filter(entity=>entity.role==='player')){
    const points=before[entity.id]||[];
    const affected=[];
    for(let f=start;f<=end;f++)if(points[f]?.trackId===trackId||points[f]?.candidateTrackIds?.includes(trackId))affected.push(f);
    const hasModel=(entity.modelBindings||[]).some(binding=>binding.trackId===trackId&&binding.start<=end&&binding.end>=start);
    if(!affected.length&&!hasModel)continue;
    recorded=true;entity.dismissedModelBindings||=[];
    entity.dismissedModelBindings.push({...dismissed});
    // Keep the original model range: frame confirmations include its start/end
    // in their identity token. A finite human exclusion shadows only this span.
    entity.bindings||=[];
    for(let i=0;i<affected.length;){
      const from=affected[i];let to=from;
      while(i+1<affected.length&&affected[i+1]===to+1)to=affected[++i];
      const cuts=[from,...new Set([...(entity.identityKeyframes||[]).map(key=>key.frame),...(entity.bindings||[]).flatMap(binding=>[binding.start,binding.end+1])].filter(at=>at>from&&at<=to)),to+1].sort((a,b)=>a-b);
      for(let j=0;j<cuts.length-1;j++)entity.bindings.push({kind:'unassigned',trackId:null,start:cuts[j],end:cuts[j+1]-1,order,exclusive:true,origin:'human_release',reason:'human_not_player'});
      changed+=to-from+1;i++;
    }
  }
  // An unassigned detector box can also be rejected without inventing an owner.
  if(!recorded){
    const keeper=draft.entities.find(entity=>entity.id===entityId&&entity.role==='player');
    if(!keeper)throw new Error('请先选择一个球员槽位以保存排除记录。');
    keeper.dismissedModelBindings||=[];keeper.dismissedModelBindings.push({...dismissed});
  }
  draft.identitySelection=null;
  return {session:draft,preview:{start,end,changed,excludedTrackId:trackId,excludedObservations:clip.frames.slice(start,end+1).filter(record=>observed(record,trackId)).length}};
}

export function addMissingIdentityPoint(session,{entityId,frame,x,y},clip){
  if(!Number.isInteger(frame)||!clip.frames[frame]||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>clip.width||y<0||y>clip.height)throw new Error('请在视频画面内点击这个人的脚下。');
  const draft=structuredClone(session),entity=draft.entities.find(entity=>entity.id===entityId&&entity.role==='player');
  if(!entity)throw new Error('请选择要补位置的球员编号。');
  entity.bindings||=[];
  entity.bindings.push({kind:'untracked',trackId:null,start:frame,end:frame,origin:'human_missing_point',order:nextIdentityOrder(draft),exclusive:true,reviewRequired:true});
  entity.anchors=(entity.anchors||[]).filter(anchor=>anchor.frame!==frame);
  entity.anchors.push({frame,x,y,trackId:null,box:null,footMethod:'human_image_anchor',identityConfirmed:false,groundContactConfirmed:false});
  entity.frameConfirmations=(entity.frameConfirmations||[]).filter(item=>item.frame!==frame);
  setPlayerVisibility(draft,entityId,frame,frame,'visible',clip.frames);
  draft.identitySelection=null;
  return draft;
}

export function initialIdentityReviewView(review={},session={}){
  const job=review.job,candidate=job?.candidate||{},record=session.initialIdentityReview;
  const applied=Boolean(review.applied||record&&(record.jobId===job?.jobId||!job));
  const report=job?.applicationReport||(applied?record?.report:null);
  const issueRows=[...new Map((report?.issues||candidate.issues||record?.issues||[]).map(issue=>[JSON.stringify([issue.kind,issue.entityId,issue.trackId,issue.start,issue.end,issue.reason]),issue])).values()];
  const issues=issueRows.map((issue,index)=>({...issue,id:`${issue.id||'issue'}:${index}`,
    label:({wrong_person:'人物可能认错',referee:'可能是裁判',not_player:'可能不是球员',role_conflict:'球员 / 裁判待分辨',role_uncertain:'球员 / 裁判待分辨',role_mismatch:'裁判 / 其他人误入球员',unresolved:'这段人物尚未核对',unsampled:'短暂人物未抽样',missing:'可能漏人',missing_player:'可能漏人',identity_break:'身份可能断开',identity_uncertain:'身份待核对',team_uncertain:'所属球队待核对',continuation:'身份可能断开',uncertain:'需要看画面确认',manual_conflict:'与人工记录不同',slot_basis_changed:'当前球员已被人工修改',manual_exclusion:'保留人工排除',observation_gap:'缺测或身份风险，未延伸',identity_conflict:'同一画面有不同身份判断'})[issue.kind]||'需要看画面确认'}));
  const roles=(candidate.subjects||[]).reduce((counts,subject)=>({...counts,[subject.role]:(counts[subject.role]||0)+1}),{});
  return {job,applied,issues,roles,report,summary:candidate.summary||record?.summary||'',
    ready:job?.status==='ready',busy:Boolean(review.busy),stale:Boolean(review.stale||!applied&&job?.applicationReport),
    stage:job?.progress?.stage||job?.status||'idle',completed:job?.progress?.completed,total:job?.progress?.total};
}

export function issueReviewFrame(issue,frameCount){
  const frames=[...(issue.evidenceFrames||[]),issue.start].filter(Number.isInteger);
  return Math.max(0,Math.min(frameCount-1,frames.find(frame=>rangeContains(issue,frame))??frames[0]??0));
}
