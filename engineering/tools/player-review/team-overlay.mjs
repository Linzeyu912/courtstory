// Presentation-only geometry: raw trajectories, manual edits and exports stay exact.
export function effectiveTeamGroup(entity) {
  if(entity.teamGroupSource==='human')return ['A','B'].includes(entity.teamGroup)?entity.teamGroup:null;
  return ['A','B'].includes(entity.teamGroup)?entity.teamGroup:
    ['A','B'].includes(entity.modelTeamGroup)?entity.modelTeamGroup:null;
}

export function setTeamGroup(session,entityId,group) {
  const entity=session.entities.find(item=>item.id===entityId&&item.role==='player');
  if(!entity||![null,'A','B'].includes(group))throw new Error('请选择有效的球队分组。');
  if(group&&session.entities.filter(item=>item!==entity&&item.role==='player'&&effectiveTeamGroup(item)===group).length>=5)
    throw new Error('每队最多五名球员。请先将另一名球员改为待确认，再调整分队；固定编号保留。');
  entity.teamGroup=group;entity.teamGroupSource='human';
  return entity;
}

export function teamOverlayStyle(entity,point,policy) {
  const group=effectiveTeamGroup(entity),tentative=point?.identitySource==='model_suggestion';
  const teamPending=!group||entity.teamGroupSource!=='human';
  const estimated=['interpolated','manual_path'].includes(point?.source);
  return {group,color:group?policy.teams[group].color:policy.pendingColor,
    dashed:tentative||estimated||teamPending,
    label:`${entity.id.replace(/^P/,'')}${tentative||teamPending?'?':''}${estimated?'~':''}`,
    footMethod:point?.footMethod==='human_image_anchor'?'human_image_anchor':policy.foot.method};
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

export function frameAtMediaTime(frames,time,fallback=0) {
  if(!Number.isFinite(time))return Math.max(0,Math.min(frames.length-1,fallback));
  let left=0,right=frames.length;
  while(left<right){const mid=Math.floor((left+right)/2);if(frames[mid].time<=time+1e-7)left=mid+1;else right=mid;}
  return Math.max(0,Math.min(frames.length-1,left-1));
}

export function teamRoster(entities,policy) {
  const groups={A:[],B:[],pending:[],referees:[]};
  const empty=[];
  for(const entity of entities){
    if(entity.role!=='player'){groups.referees.push(entity);continue;}
    const group=effectiveTeamGroup(entity);
    if(group)groups[group].push(entity);
    else if(!entity.selected&&entity.display?.identity!=='model_proposed')empty.push(entity);
    else groups.pending.push(entity);
  }
  for(const entity of empty){const slotGroup=Number(entity.id.slice(1))<=5?'A':'B';
    (groups[slotGroup].length<policy.capacity?groups[slotGroup]:groups.pending).push(entity);}
  for(const group of Object.values(groups))group.sort((a,b)=>Number(a.id.slice(1))-Number(b.id.slice(1)));
  return groups;
}
