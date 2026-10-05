// Display helpers keep observed image trails separate from estimated trajectories.
export const REVIEW_COLORS=Object.freeze({machine:'#2563eb',human:'#16834a',pending:'#b97812',missing:'#db737c',invalid:'#ad3156',out_of_view:'#8c98a8',empty:'#e8edf2'});
export function trackingReviewState(point){
  if(point?.reviewExcluded)return {status:'missing',label:'已取消关联'};
  if(point?.source==='out_of_view')return {status:'out_of_view',label:'镜头外 · 无需补点'};
  if(point?.source==='conflict')return {status:'invalid',label:'身份冲突'};
  if(point?.x==null||point?.y==null)return {status:'missing',label:point?.observationState==='occluded'?'遮挡 / 漏识别 · 待恢复':'位置未知 · 待核对'};
  if(['interpolated','manual_path'].includes(point.source))return {status:'pending',label:'估计位置，待核对'};
  if(point.frameIdentityConfirmed===true)return {status:'human',label:'本帧人物已人工确认'};
  if(point.source==='manual_range')return {status:'pending',label:'区间修正，当前帧待核对'};
  if(point.source==='manual')return {status:'pending',label:'人工修改，人物待确认'};
  return {status:'machine',label:'机器已跟踪，待人工确认'};
}

// A reviewed observation colors its own marker. A connecting segment is green
// only when both adjacent observations have explicit current-frame reviews.
export function reviewedPersonTrail(trail,points){
  const markers=trail.map(point=>({...point,review:trackingReviewState(points?.[point.frame])}));
  const segments=[];
  for(let i=1;i<markers.length;i++){
    const from=markers[i-1],to=markers[i];
    if(to.frame!==from.frame+1)continue;
    const states=[from.review.status,to.review.status];
    if(states.some(status=>['missing','invalid','out_of_view'].includes(status)))continue;
    segments.push({from,to,status:states.every(status=>status==='human')?'human':states.includes('pending')?'pending':'machine'});
  }
  return {markers,segments};
}

export function mergeSourceCuts(cuts=[],sourceCuts=[],frameCount=Infinity) {
  return [...new Set([...cuts,...sourceCuts].filter(frame=>Number.isInteger(frame)&&frame>=0&&frame<frameCount))].sort((a,b)=>a-b);
}

export function toggleReviewCut(cuts,sourceCuts,frame,frameCount) {
  const merged=mergeSourceCuts(cuts,sourceCuts,frameCount);
  if(sourceCuts.includes(frame)||!Number.isInteger(frame)||frame<0||frame>=frameCount)return merged;
  return merged.includes(frame)?merged.filter(value=>value!==frame):mergeSourceCuts([...merged,frame],sourceCuts,frameCount);
}

export function personProposals(record={}, roles={}, detectorEvidence=null) {
  record ||= {};
  const hasConflict=id=>Array.isArray(record.role_conflicts)
    ?record.role_conflicts.some(item=>item.trackIds?.some(value=>Number(value)===Number(id)))
    :Boolean(record.role_conflicts?.[id]);
  const rawCoordinates=detectorEvidence?.schema_version===1&&detectorEvidence.raw_coordinates===true;
  return ['tracks','pending_detections','suppressed_detections'].flatMap(sourcePartition=>{
    const rows=record[sourcePartition];
    if(!Array.isArray(rows))return [];
    return rows.flatMap((row,sourceIndex)=>{
      const tracked=sourcePartition==='tracks';
      if(!Array.isArray(row)||row.length!==(tracked?7:6)||!row.every(Number.isFinite)||row[2]<=row[0]||row[3]<=row[1])return [];
      if(row[tracked?5:4]<0||row[tracked?5:4]>1||!Number.isInteger(row[tracked?6:5])||row[tracked?6:5]<0)return [];
      const trackId=tracked?Number(row[4]):null;
      if(tracked&&(!Number.isInteger(trackId)||trackId<=0))return [];
      const evidence=tracked?record.track_evidence?.[trackId]:null;
      const rawIndex=tracked?evidence?.raw_detection_index:record.detection_indices?.[sourcePartition]?.[sourceIndex];
      const detectionIndex=Number.isInteger(rawIndex)&&rawIndex>=0?rawIndex:null;
      return [{box:row.slice(0,4),trackId,score:row[tracked?5:4],classId:row[tracked?6:5],
        role:tracked?(record.track_roles?.[trackId]||roles[trackId]||'person'):'person',
        roleConflict:tracked&&hasConflict(trackId),sourcePartition,sourceIndex,detectionIndex,
        detectionObserved:!tracked||detectionIndex!==null||rawCoordinates,
        suppressed:sourcePartition==='suppressed_detections',
        evidenceSource:typeof evidence?.source==='string'?evidence.source:null}];
    });
  });
}

export function proposalLabel(proposal) {
  const role=proposal.role==='referee'?'裁判候选':proposal.role==='player'?'球员候选':'人物候选';
  const status=proposal.suppressed?'检测已抑制':proposal.trackId==null?'检测未跟踪':`T${proposal.trackId}`;
  const evidence=proposal.trackId!=null?(proposal.detectionObserved?' · 检测已跟踪':' · 检测证据有限'):'';
  return `${status} · ${role}${proposal.roleConflict?' · 角色待核对':''}${evidence}`;
}

// Raw detector partitions remain available for provenance checks. The workbench
// only offers observations that already have a tracker ID.
export function trackedPersonProposals(record,roles={},detectorEvidence=null) {
  return personProposals(record,roles,detectorEvidence).filter(proposal=>proposal.trackId!=null);
}

export function pickPersonProposal(proposals,x,y) {
  if(!Array.isArray(proposals)||![x,y].every(Number.isFinite))return null;
  let selected=null,bestArea=Infinity;
  for(const proposal of proposals){
    if(!proposal||proposal.trackId==null||proposal.suppressed||
      (proposal.sourcePartition&&proposal.sourcePartition!=='tracks'))continue;
    const box=proposal.box;
    if(!Array.isArray(box)||box.length<4||!box.slice(0,4).every(Number.isFinite))continue;
    const [x1,y1,x2,y2]=box;
    if(x2<=x1||y2<=y1||x<x1||x>x2||y<y1||y>y2)continue;
    if(!Number.isInteger(Number(proposal.trackId))||Number(proposal.trackId)<=0)continue;
    const area=(x2-x1)*(y2-y1);
    if(area<bestArea){
      selected=proposal;bestArea=area;
    }
  }
  return selected;
}

export function visibleObjects(record) {
  return (record.objects||[]).filter(item=>['basketball','hoop'].includes(item.kind)
    && Array.isArray(item.box)&&item.box.length>=4&&item.box.slice(0,4).every(Number.isFinite)
    && item.box[2]>item.box[0]&&item.box[3]>item.box[1]);
}

export function indexTemporaryTracks(frames) {
  return frames.map(record=>new Map((record.tracks||[]).map(box=>[Number(box[4]),box])));
}
