import {COURT} from './court.mjs';
import {preparationDigest,validateCourtPreparation} from './court-preparation.mjs';
import {previewCourtSmoothing,adoptCourtSmoothing} from './court-smoothing.mjs';
import {validateFrameRange} from './tactics-time-range.mjs';
import {fitGroundSegment,GROUND_FIT_METHOD} from './ground-trajectory-fit.mjs';

const copy=value=>structuredClone(value);
const finite=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y);
const text=(value,label,max=2000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`${label}无效。`);return value;};
export function groundSourceBinding(preparation){
  return {videoSha256:preparation.videoSha256,dependencyDigest:preparation.dependencyDigest,frameMappingDigest:preparation.dependencies.mapping,courtTemplate:{...COURT}};
}
function evidence(frames,preparation){
  if(!Array.isArray(frames)||frames.some(f=>!Number.isSafeInteger(f)||f<0||f>=preparation.frameMapping.length))throw new Error('地面修正证据帧无效。');
  return [...new Set(frames)].sort((a,b)=>a-b);
}
function normalize(preparation,input){
  validateCourtPreparation(preparation);validateFrameRange(preparation.frameMapping,input.range);
  if(!Array.isArray(input.entityIds)||!input.entityIds.length||new Set(input.entityIds).size!==input.entityIds.length||input.entityIds.some(id=>!preparation.rawByPlayer[id]))throw new Error('地面修正球员无效。');
  if(input.schemaVersion!==undefined&&input.schemaVersion!==1)throw new Error('地面修正候选版本无效。');
  const sourceBinding=groundSourceBinding(preparation),baseDigest=preparationDigest(preparation);
  if(input.baseDigest!==undefined&&input.baseDigest!==baseDigest)throw new Error('地面修正来源已变化，请重新运行。');
  if(input.sourceBinding!==undefined&&preparationDigest(input.sourceBinding)!==preparationDigest(sourceBinding))throw new Error('地面修正来源绑定不匹配。');
  const inScope=(id,frame)=>input.entityIds.includes(id)&&frame>=input.range.startFrame&&frame<input.range.endFrameExclusive;
  if(!Array.isArray(input.anchors??[])||!Array.isArray(input.unknownRanges??[]))throw new Error('地面修正锚点或未知区间无效。');
  const seen=new Set(),anchors=(input.anchors??[]).map(a=>{
    if(!Number.isSafeInteger(a.frame)||!inScope(a.entityId,a.frame)||![a.x,a.y].every(Number.isFinite)||Math.abs(a.x)>COURT.length*10||Math.abs(a.y)>COURT.width*10)throw new Error('地面锚点球员、范围或坐标无效。');
    const key=`${a.entityId}:${a.frame}`;if(seen.has(key))throw new Error('地面锚点重复。');seen.add(key);
    const raw=preparation.rawByPlayer[a.entityId][a.frame];
    if(raw.locked&&(raw.x!==a.x||raw.y!==a.y))throw new Error('模型不能修改人工锁定的位置。');
    if(!finite(raw))throw new Error('缺失或排除的地面观测不能直接变为模型轨迹。');
    const support=evidence(a.evidenceFrames,preparation);if(!support.length)throw new Error('地面锚点必须引用证据帧。');
    const out={entityId:a.entityId,frame:a.frame,x:a.x,y:a.y,evidenceFrames:support,basis:text(a.basis,'地面定位依据'),turn:a.turn===true};
    if(a.uncertainty!==undefined)out.uncertainty=text(a.uncertainty,'定位不确定性');
    return out;
  }).sort((a,b)=>input.entityIds.indexOf(a.entityId)-input.entityIds.indexOf(b.entityId)||a.frame-b.frame);
  const unknownRanges=(input.unknownRanges??[]).map(r=>{
    validateFrameRange(preparation.frameMapping,r);
    if(!input.entityIds.includes(r.entityId)||r.startFrame<input.range.startFrame||r.endFrameExclusive>input.range.endFrameExclusive)throw new Error('未知区间超出修正范围。');
    if(preparation.rawByPlayer[r.entityId].slice(r.startFrame,r.endFrameExclusive).some(p=>p.locked))throw new Error('未知区间不能覆盖人工锁定的位置。');
    const support=evidence(r.evidenceFrames,preparation);if(!support.length)throw new Error('未知区间必须引用证据帧。');
    return {entityId:r.entityId,startFrame:r.startFrame,endFrameExclusive:r.endFrameExclusive,reason:text(r.reason,'未知区间原因'),evidenceFrames:support};
  }).sort((a,b)=>input.entityIds.indexOf(a.entityId)-input.entityIds.indexOf(b.entityId)||a.startFrame-b.startFrame);
  for(let i=1;i<unknownRanges.length;i++)if(unknownRanges[i].entityId===unknownRanges[i-1].entityId&&unknownRanges[i].startFrame<unknownRanges[i-1].endFrameExclusive)throw new Error('未知区间不能重叠。');
  if(anchors.some(a=>unknownRanges.some(r=>r.entityId===a.entityId&&a.frame>=r.startFrame&&a.frame<r.endFrameExclusive)))throw new Error('模型锚点不能位于未知区间。');
  if(!Number.isSafeInteger(input.revision)||input.revision<1)throw new Error('模型候选修订无效。');
  if(!['complete','partial'].includes(input.completion??'partial'))throw new Error('模型候选完成状态无效。');
  if(input.fit?.method!==undefined&&input.fit.method!==GROUND_FIT_METHOD)throw new Error('地面拟合算法无效。');
  const frames=evidence(input.evidenceFrames??anchors.flatMap(a=>a.evidenceFrames).concat(unknownRanges.flatMap(r=>r.evidenceFrames)),preparation);
  if([...anchors,...unknownRanges].some(a=>a.evidenceFrames.some(f=>!frames.includes(f))))throw new Error('模型候选证据索引不完整。');
  return {schemaVersion:1,jobId:text(input.jobId,'模型任务编号',200),model:text(input.model??'qwen3.8-max','模型名称',200),revision:input.revision,baseDigest,sourceBinding,entityIds:[...input.entityIds],range:{startFrame:input.range.startFrame,endFrameExclusive:input.range.endFrameExclusive},anchors,unknownRanges,evidenceFrames:frames,completion:input.completion??'partial',fit:{method:GROUND_FIT_METHOD}};
}
export function previewGroundTrajectory(preparation,input){
  const candidate=normalize(preparation,input),pointsByPlayer={},diff={changed:0,maxDisplacement:0},issues=[];
  const versionId=`${candidate.jobId}:${candidate.revision}`;
  for(const id of candidate.entityIds){
    const raw=preparation.rawByPlayer[id],points=copy(preparation.preparedByPlayer[id]);
    const breaks=new Set((preparation.breaksByPlayer[id]??[]).map(b=>b.frame)),unknown=candidate.unknownRanges.filter(r=>r.entityId===id),anchors=candidate.anchors.filter(a=>a.entityId===id);
    for(const r of unknown)for(let f=r.startFrame;f<r.endFrameExclusive;f++)points[f]={...points[f],x:null,y:null,source:'missing',versionId,reviewRequired:true,groundObservationUsable:false,groundEstimationBasis:r.reason,evidenceFrames:r.evidenceFrames,refinementState:'unknown',refinementSource:'qwen_refined'};
    let start=candidate.range.startFrame;
    while(start<candidate.range.endFrameExclusive){
      if(!finite(raw[start])||!finite(points[start])){issues.push({entityId:id,frame:start,reason:points[start].refinementState??raw[start].source});start++;continue;}
      let end=start+1;
      while(end<candidate.range.endFrameExclusive&&finite(raw[end])&&finite(points[end])&&!breaks.has(end))end++;
      const local=anchors.filter(a=>a.frame>=start&&a.frame<end);
      if(local.length){
        const knots=new Map(local.map(a=>[a.frame,{...a,time:preparation.frameMapping[a.frame].time}]));
        // Preserve continuity where this range joins unchanged neighbours. At
        // genuine clip/cut/gap edges a supplied model endpoint may move.
        const movableLeft=start===0||breaks.has(start)||!finite(points[start-1])||!finite(raw[start-1]);
        const movableRight=end===raw.length||breaks.has(end)||!finite(points[end])||!finite(raw[end]);
        for(let f=start;f<end;f++)if(raw[f].locked||f===start||f===end-1){
          const requested=knots.get(f);
          const movable=(f!==start||movableLeft)&&(f!==end-1||movableRight);
          if(requested&&!raw[f].locked&&movable)continue;
          if(requested&&(requested.x!==points[f].x||requested.y!==points[f].y))throw new Error(`地面锚点 ${id}/${f} 是与未修改轨迹衔接的边界，必须保留当前位置。`);
          knots.set(f,{frame:f,time:points[f].time,x:points[f].x,y:points[f].y,locked:raw[f].locked});
        }
        const sorted=[...knots.values()].sort((a,b)=>a.frame-b.frame),fitted=fitGroundSegment(sorted,preparation.frameMapping.slice(start,end));
        fitted.forEach((value,i)=>{
          const f=start+i;if(!value||raw[f].locked||(f===start&&!movableLeft)||(f===end-1&&!movableRight))return;
          const supporting=sorted.filter(k=>value.supportFrames.includes(k.frame)),support=evidence(supporting.flatMap(k=>k.evidenceFrames??[]),preparation);
          if(!support.length)return;
          points[f]={...points[f],x:value.x,y:value.y,outsideCourt:value.x<0||value.x>COURT.length||value.y<0||value.y>COURT.width,source:'qwen_refined',versionId,reviewRequired:true,groundObservationUsable:false,groundEstimationBasis:supporting.map(k=>k.basis??'continuity_or_manual_constraint').join('; '),evidenceFrames:support,fitSupportFrames:value.supportFrames,refinementState:'estimated',preparedSmoothed:false};
          if(value.x<0||value.x>COURT.length||value.y<0||value.y>COURT.width)issues.push({entityId:id,frame:f,reason:'outside_court_estimate'});
        });
      }
      start=end;
    }
    for(let f=candidate.range.startFrame;f<candidate.range.endFrameExclusive;f++){
      const before=preparation.preparedByPlayer[id][f],after=points[f];
      if(before.x!==after.x||before.y!==after.y){diff.changed++;if(finite(before)&&finite(after))diff.maxDisplacement=Math.max(diff.maxDisplacement,Math.hypot(before.x-after.x,before.y-after.y));}
    }
    pointsByPlayer[id]=points;
  }
  return {candidate:{...candidate,pointsByPlayer},diff,issues};
}
export function adoptGroundTrajectory(preparation,candidate){
  const expected=previewGroundTrajectory(preparation,candidate).candidate;
  if(preparationDigest(candidate)!==preparationDigest(expected))throw new Error('地面修正候选与共享拟合结果不一致。');
  const next=copy(preparation);
  next.operations??=next.smoothingPatches.map(patch=>({type:'smoothing',patch:copy(patch)}));
  next.operations.push({type:'qwen_ground_fit',candidate:copy(candidate)});
  for(const id of candidate.entityIds)for(let f=candidate.range.startFrame;f<candidate.range.endFrameExclusive;f++)next.preparedByPlayer[id][f]=copy(candidate.pointsByPlayer[id][f]);
  next.revision++;
  return validateCourtPreparation(next);
}
export function replayCourtPreparation(preparation,operationsOrPatches=[]){
  if(!Array.isArray(operationsOrPatches))throw new Error('准备操作记录无效。');
  let next=copy(preparation);
  const ordered=operationsOrPatches.some(op=>typeof op.type==='string');
  for(const operation of operationsOrPatches){
    if(operation.type==='qwen_ground_fit')next=adoptGroundTrajectory(next,operation.candidate);
    else if(operation.type==='smoothing'||!ordered)next=adoptCourtSmoothing(next,previewCourtSmoothing(next,operation.patch??operation).candidate);
    else throw new Error('准备操作类型无效。');
  }
  return next;
}
export function isGroundRefinedPoint(preparation,entityId,point){
  if(point?.source!=='qwen_refined'||point.reviewRequired!==true||!finite(point)||point.time!==preparation?.frameMapping?.[point.frame]?.time)return false;
  const stored=preparation.preparedByPlayer?.[entityId]?.[point.frame];
  if(!stored||preparationDigest(stored)!==preparationDigest(point))return false;
  return (preparation.operations??[]).some(op=>{
    const c=op.candidate;
    return op.type==='qwen_ground_fit'&&c&&point.versionId===`${c.jobId}:${c.revision}`&&Array.isArray(c.entityIds)&&c.entityIds.includes(entityId)&&point.frame>=c.range?.startFrame&&point.frame<c.range?.endFrameExclusive&&c.sourceBinding?.videoSha256===preparation.videoSha256&&c.sourceBinding?.dependencyDigest===preparation.dependencyDigest&&c.pointsByPlayer?.[entityId]?.[point.frame]?.source==='qwen_refined';
  });
}
