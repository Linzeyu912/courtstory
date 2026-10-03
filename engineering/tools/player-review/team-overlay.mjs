// Presentation-only geometry: raw trajectories, manual edits and exports stay exact.
export const FIXED_TEAM_COLORS=Object.freeze({A:'#ee5568',B:'#4295ed'});
export function effectiveTeamGroup(entity) {
  const match=/^P([1-9]|10)$/.exec(entity.id);
  return match?(Number(match[1])<=5?'A':'B'):null;
}

// Legacy callers may confirm the existing row, but moving people uses roster swap.
export function setTeamGroup(session,entityId,group) {
  const entity=session.entities.find(item=>item.id===entityId&&item.role==='player');
  if(!entity||group!==effectiveTeamGroup(entity))
    throw new Error('上排为红队，下排为蓝队；请拖动交换球员来调整分队。');
  return entity;
}

export function teamOverlayStyle(entity,point,policy) {
  const group=effectiveTeamGroup(entity),tentative=point?.frameIdentityConfirmed!==true;
  const estimated=['interpolated','manual_path'].includes(point?.source);
  return {group,color:group?FIXED_TEAM_COLORS[group]:policy.pendingColor,
    dashed:tentative||estimated,
    label:`${entity.id.replace(/^P/,'')}${tentative?'?':''}${estimated?'~':''}`,
    footMethod:point?.footMethod==='human_image_anchor'?'human_image_anchor':policy.foot.method};
}

// Use the current visible P → T association, so swaps and frame corrections
// change candidate colors together with the player overlay.
export function candidateOverlayColor(proposal,annotations,policy) {
  const owners=annotations.filter(({entity,point})=>entity.role==='player'&&
    point.trackId===proposal.trackId&&effectiveTeamGroup(entity));
  if(owners.length===1)return FIXED_TEAM_COLORS[effectiveTeamGroup(owners[0].entity)];
  return owners.length>1||proposal.roleConflict?policy.candidateColor:'#acbbc9';
}

function smoothable(point) {
  return point?.source==='tracked'&&point.x!=null&&point.y!=null&&point.footMethod==='bbox_bottom_center'&&
    Array.isArray(point.box)&&point.box.length===4&&point.box.every(Number.isFinite)&&point.trackId!=null;
}
function identityToken(point) {
  return JSON.stringify([point.trackId,point.identitySource,point.identityStartFrame,
    point.identityOrder,point.modelSuggestionMethod]);
}

export function stabilizePoints(points,cuts,width,height,policy) {
  const output=points.map(point=>structuredClone(point));
  const limit=policy.filter.maximumCoordinateDeviationAt720*height/720;
  for(let index=1;index<points.length-1;index++) {
    const current=points[index],left=points[index-1],right=points[index+1];
    if(![left,current,right].every(smoothable)||cuts.some(cut=>cut>index-1&&cut<=index+1)||
       identityToken(left)!==identityToken(current)||identityToken(right)!==identityToken(current)||
       current.time-left.time<=0||right.time-current.time<=0||
       current.time-left.time>policy.filter.maximumFrameGapSeconds||right.time-current.time>policy.filter.maximumFrameGapSeconds)continue;
    const box=current.box.map((value,axis)=>{
      const median=[left.box[axis],value,right.box[axis]].sort((a,b)=>a-b)[1];
      const delta=Math.max(-limit,Math.min(limit,(median-value)*policy.filter.blend));
      return Math.max(0,Math.min(axis%2?height:width,value+delta));
    });
    if(box[2]<=box[0]||box[3]<=box[1]||box.every((value,axis)=>value===current.box[axis]))continue;
    output[index]={...current,box,x:(box[0]+box[2])/2,y:box[3],
      presentationMethod:policy.filter.method,presentationFootMethod:policy.foot.method,
      presentationSupportFrames:[index-1,index,index+1]};
  }
  return output;
}

export function presentationPoint(raw,stable,{stable:enabled=true,editing=false}={}) {
  return enabled&&!editing?stable||raw:raw;
}

export function frameSeekTime(frames,index) {
  if(!frames.length)return 0;
  const at=Math.max(0,Math.min(frames.length-1,Number.isFinite(index)?Math.trunc(index):0));
  const time=frames[at].time,next=frames[at+1]?.time;
  if(!Number.isFinite(time)||time<0)return 0;
  // A seek exactly at source PTS may truncate below that PTS in the browser,
  // decoding the previous frame. Land inside this frame instead; the decoder's
  // reported presentation time still decides which annotations are displayed.
  const inset=Number.isFinite(next)&&next>time?Math.min(2e-6,(next-time)/2):2e-6;
  return time+inset;
}

export function frameAtMediaTime(frames,time,fallback=0) {
  if(!Number.isFinite(time))return Math.max(0,Math.min(frames.length-1,fallback));
  // Browser media times can truncate source PTS to microseconds, while the
  // candidate JSON keeps nanoseconds. A sub-microsecond deficit still denotes
  // the same decoded frame. Keep the containing-frame lookup (not nearest)
  // so ordinary playback never chooses a frame half an interval too early.
  const timestampTolerance=1e-6+1e-9;
  let left=0,right=frames.length;
  while(left<right){const mid=Math.floor((left+right)/2);if(frames[mid].time<=time+timestampTolerance)left=mid+1;else right=mid;}
  return Math.max(0,Math.min(frames.length-1,left-1));
}

export function teamRoster(entities,policy) {
  const groups={A:[],B:[],pending:[],referees:[]};
  for(const entity of entities){
    if(entity.role!=='player'){groups.referees.push(entity);continue;}
    const group=effectiveTeamGroup(entity);
    (group?groups[group]:groups.pending).push(entity);
  }
  for(const group of Object.values(groups))group.sort((a,b)=>Number(a.id.slice(1))-Number(b.id.slice(1)));
  return groups;
}
