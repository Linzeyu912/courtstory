// Display helpers keep observed image trails separate from estimated trajectories.
export function mergeSourceCuts(cuts=[],sourceCuts=[],frameCount=Infinity) {
  return [...new Set([...cuts,...sourceCuts].filter(frame=>Number.isInteger(frame)&&frame>=0&&frame<frameCount))].sort((a,b)=>a-b);
}

export function toggleReviewCut(cuts,sourceCuts,frame,frameCount) {
  const merged=mergeSourceCuts(cuts,sourceCuts,frameCount);
  if(sourceCuts.includes(frame)||!Number.isInteger(frame)||frame<0||frame>=frameCount)return merged;
  return merged.includes(frame)?merged.filter(value=>value!==frame):mergeSourceCuts([...merged,frame],sourceCuts,frameCount);
}

export function personProposals(record, roles={}) {
  const hasConflict=id=>Array.isArray(record.role_conflicts)
    ?record.role_conflicts.some(item=>item.trackIds?.some(value=>Number(value)===Number(id)))
    :Boolean(record.role_conflicts?.[id]);
  return (record.tracks||[]).map(box=>({box:box.slice(0,4),trackId:Number(box[4]),score:box[5],
    role:record.track_roles?.[box[4]]||roles[box[4]]||'person',
    roleConflict:hasConflict(box[4])}))
    .concat((record.pending_detections||[]).map(box=>({box:box.slice(0,4),trackId:null,score:box[4],role:'person',roleConflict:false})));
}

export function proposalLabel(proposal) {
  const role=proposal.role==='referee'?'裁判候选':proposal.role==='player'?'球员候选':'人物候选';
  return `${proposal.trackId==null?'未编号':`T${proposal.trackId}`} · ${role}${proposal.roleConflict?' · 角色待核对':''}`;
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
