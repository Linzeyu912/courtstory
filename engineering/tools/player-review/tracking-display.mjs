// Display helpers keep observed image trails separate from estimated trajectories.
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

// Suppressed detections require an explicit list selection. A small duplicate
// must not intercept a click intended for a live tracked observation.
export function pickPersonProposal(proposals,x,y) {
  if(!Array.isArray(proposals)||![x,y].every(Number.isFinite))return null;
  let selected=null,bestRank=Infinity,bestArea=Infinity;
  for(const proposal of proposals){
    if(!proposal||proposal.suppressed||proposal.sourcePartition==='suppressed_detections')continue;
    const box=proposal.box;
    if(!Array.isArray(box)||box.length<4||!box.slice(0,4).every(Number.isFinite))continue;
    const [x1,y1,x2,y2]=box;
    if(x2<=x1||y2<=y1||x<x1||x>x2||y<y1||y>y2)continue;
    const tracked=proposal.trackId!=null&&Number.isInteger(Number(proposal.trackId))&&Number(proposal.trackId)>0;
    const rank=tracked?0:1,area=(x2-x1)*(y2-y1);
    if(rank<bestRank||(rank===bestRank&&area<bestArea)){
      selected=proposal;bestRank=rank;bestArea=area;
    }
  }
  return selected;
}

export function visibleObjects(record) {
  return (record.objects||[]).filter(item=>['basketball','hoop'].includes(item.kind)
    && Array.isArray(item.box)&&item.box.length>=4&&item.box.slice(0,4).every(Number.isFinite)
    && item.box[2]>item.box[0]&&item.box[3]>item.box[1]);
}

function continuousTrail(pointAt,frames,current,cuts,options={}) {
  const {durationSeconds=1.2,maxStepSeconds=.15,maxSpeedPixelsPerSecond=1800}=options;
  const result=[];
  const cutSet=new Set(cuts);
  const now=frames[current]?.time;
  if(!Number.isFinite(now))return result;
  for(let index=current;index>=0;index--){
    const point=pointAt(index),time=frames[index].time;
    if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||now-time>durationSeconds)break;
    if(result.length){
      const newer=result[0],delta=newer.time-time;
      if(cutSet.has(index+1)||delta<=0||delta>maxStepSeconds
        ||Math.hypot(newer.x-point.x,newer.y-point.y)/delta>maxSpeedPixelsPerSecond)break;
    }
    result.unshift({frame:index,time,x:point.x,y:point.y,trackId:point.trackId??null});
  }
  return result;
}

export function personTrail(points,frames,current,cuts=[],options={}) {
  return continuousTrail(index=>{
    const point=points?.[index];
    return point&&['manual','tracked'].includes(point.source)?point:null;
  },frames,current,cuts,options);
}

export function indexTemporaryTracks(frames) {
  return frames.map(record=>new Map((record.tracks||[]).map(box=>[Number(box[4]),box])));
}

export function temporaryTrail(index,frames,trackId,current,cuts=[],options={}) {
  return continuousTrail(at=>{
    const box=index[at]?.get(Number(trackId));
    return box?{x:(box[0]+box[2])/2,y:box[3],trackId:Number(trackId)}:null;
  },frames,current,cuts,options);
}
