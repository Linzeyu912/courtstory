// Presentation-only geometry: raw trajectories, manual edits and exports stay exact.
export const FIXED_TEAM_COLORS=Object.freeze({A:'#ee5568',B:'#4295ed'});
export const DEFAULT_NAME_DISPLAY=Object.freeze({enabled:false,groups:{A:true,B:true},players:{},showName:true,showJersey:true,showAnkleRing:true});

export function normalizeNameDisplay(value={},entities=[]) {
  const players={};
  for(const entity of entities)if(entity.role==='player')players[entity.id]=value.players?.[entity.id]!==false;
  return {enabled:value.enabled===true,groups:{A:value.groups?.A!==false,B:value.groups?.B!==false},players,
    showName:value.showName!==false,showJersey:value.showJersey!==false,showAnkleRing:value.showAnkleRing!==false};
}

export function nameDisplaySelected(entity,settings) {
  if(!entity||entity.role!=='player'||settings?.enabled!==true)return false;
  const group=effectiveTeamGroup(entity);
  return (group==null||settings.groups?.[group]!==false)&&settings.players?.[entity.id]!==false;
}

export function nameIdentityLabel(identity,entity,settings) {
  const number=String(entity?.id||'').replace(/^P/,'');
  const name=identity?.name?.trim();
  const jersey=identity?.jersey==null?'':String(identity.jersey).trim();
  const verified=identity?.identityVerified===true||identity?.identitySource==='player_profile_confirmed';
  const accepted=identity?.nameStatus==='machine_accepted';
  const namePart=settings?.showName!==false?(name?(accepted?`P${number} ${name}${identity.positionBindingStatus==='needs_review'?'~':''}`:verified?name:`${name}?`):`P${number} · pending`):'';
  const jerseyPart=settings?.showJersey!==false&&jersey?`#${jersey}`:'';
  return [namePart,jerseyPart].filter(Boolean).join(' · ');
}
export function effectiveTeamGroup(entity) {
  const match=/^P([1-9]|10)$/.exec(entity.id);
  return match?(Number(match[1])<=5?'A':'B'):null;
}

// Layout changes presentation only; the actual feet and identities stay exact.
export function layoutNameLabels(items,width,height,scale=1){
  const placed=[],pad=5*scale;
  for(const item of items){
    const center=item.x-item.width/2;
    const step=item.height+12*scale;
    const bases=[item.y+item.height+12*scale,item.y+item.height+12*scale+step,
      item.y+item.height+12*scale+2*step,item.y-18*scale,item.y-18*scale-step];
    let choice;
    for(const shift of [0,-.6*item.width,.6*item.width,-1.2*item.width,1.2*item.width]){
      const x=Math.max(pad,Math.min(width-item.width-pad,center+shift));
      for(const proposed of bases){
      const y=Math.max(item.height+pad,Math.min(height-pad,proposed));
      const rect={left:x-pad,top:y-item.height-pad,right:x+item.width+pad,bottom:y+pad};
      const candidate={...item,textX:x,textY:y,rect};choice??=candidate;
      if(!placed.some(p=>rect.left<p.rect.right&&rect.right>p.rect.left&&rect.top<p.rect.bottom&&rect.bottom>p.rect.top)){
        choice=candidate;break;
      }
      }
      if(choice&&!placed.some(p=>choice.rect.left<p.rect.right&&choice.rect.right>p.rect.left&&choice.rect.top<p.rect.bottom&&choice.rect.bottom>p.rect.top))break;
    }
    placed.push(choice);
  }
  return placed;
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
