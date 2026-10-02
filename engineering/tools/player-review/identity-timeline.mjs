// Identity confirmations are time boundaries; position edits are independent.
export const IDENTITY_BINDING_MODE = 'forward_only_v1';

export function entityTeamSide(entity) {
  const number = /^P([1-9]|10)$/.exec(entity.id)?.[1];
  return number ? (Number(number)<=5?'red':'blue') : null;
}

export function identityKeyframes(entity) {
  if (Array.isArray(entity.identityKeyframes)) return entity.identityKeyframes;
  const keys = [];
  for (const anchor of [...entity.anchors].sort((a,b)=>a.frame-b.frame)) {
    if (anchor.trackId == null || anchor.identityConfirmed === false) continue;
    const trackId = Number(anchor.trackId);
    // Old drafts did not distinguish selections from edits. Repeated IDs do
    // not create extra boundaries; keep the original anchors as evidence.
    if (keys.at(-1)?.trackId === trackId) continue;
    keys.push({frame:anchor.frame,kind:'track',trackId,origin:'legacy_anchor'});
  }
  return keys;
}

export function migrateIdentitySession(session) {
  session.teamRoles ??= null;
  for (const entity of session.entities) {
    entity.teamSide = entityTeamSide(entity);
    entity.identityKeyframes ??= identityKeyframes(entity).map(key=>({...key}));
  }
  session.identityBindingMode = IDENTITY_BINDING_MODE;
  return session;
}

export function nextIdentityOrder(session) {
  const orders = session.entities.flatMap(entity=>[
    ...identityKeyframes(entity),...(entity.bindings||[])
  ]).map(item=>item.order||0);
  session.identitySequence = Math.max(session.identitySequence||0,...orders)+1;
  return session.identitySequence;
}

export function identityAt(entity, frame, cuts=[]) {
  let active = null;
  const consider = event => {
    if (event.start > frame || event.end < frame) return;
    if (!active || event.start > active.start ||
        (event.start === active.start && (event.order||0) >= (active.order||0))) active = event;
  };
  for (const key of identityKeyframes(entity)) {
    consider({...key,start:key.frame,end:Infinity,identitySource:'manual_forward'});
  }
  for (const binding of entity.bindings||[]) {
    consider({...binding,identitySource:binding.kind==='unassigned'?'human_unassigned':'manual_range'});
  }
  if (active && cuts.some(cut=>cut>active.start&&cut<=frame)) return null;
  return active;
}

export function identityBoundaries(entity) {
  return [...identityKeyframes(entity).map(key=>key.frame),
    ...(entity.bindings||[]).flatMap(binding=>[binding.start,binding.end+1])];
}

export function identityInterval(session, entity, start, frameCount) {
  const boundaries = [...identityKeyframes(entity).map(key=>key.frame),
    ...(entity.bindings||[]).map(binding=>binding.start),...session.cuts];
  return {start,end:Math.min(frameCount,...boundaries.filter(frame=>frame>start))-1};
}

export function confirmIdentity(session, entityId, frame, proposal, frames) {
  const entity = session.entities.find(item=>item.id===entityId);
  if (!entity || !Number.isInteger(frame) || !frames[frame]) throw new Error('身份确认帧不正确。');
  if (proposal.trackId != null && !frames[frame].tracks.some(box=>Number(box[4])===Number(proposal.trackId))) {
    throw new Error('当前帧没有所选临时编号。');
  }
  migrateIdentitySession(session);
  const trackId = proposal.trackId == null ? null : Number(proposal.trackId);
  const key = {frame,kind:trackId==null?'untracked':'track',trackId,
    order:nextIdentityOrder(session),exclusive:true,origin:'human_selection'};
  entity.identityKeyframes = entity.identityKeyframes.filter(item=>item.frame!==frame);
  entity.identityKeyframes.push(key);
  entity.identityKeyframes.sort((a,b)=>a.frame-b.frame);
  entity.anchors = entity.anchors.filter(item=>item.frame!==frame);
  entity.anchors.push({frame,x:(proposal.box[0]+proposal.box[2])/2,y:proposal.box[3],
    trackId,box:proposal.box.slice(),footMethod:'bbox_bottom_center',identityConfirmed:true});
  session.identitySelection = null;
  return identityInterval(session,entity,frame,frames.length);
}

export function identityProvenance(identity) {
  return identity ? {identitySource:identity.identitySource,identityStartFrame:identity.start,
    identityOrder:identity.order||0,identityExclusive:Boolean(identity.exclusive),
    ...(Number.isFinite(identity.end)?{identityEndFrame:identity.end}:{}),
    ...(identity.origin?{identityOrigin:identity.origin}:{})} : {};
}

// A new human claim releases a competing owner only where both use this ID.
// A later confirmation is a new boundary, including for the competing player.
export function resolveIdentityOwners(result, entities, frames) {
  for (let frame=0;frame<frames.length;frame++) {
    const owners = new Map();
    for (const entity of entities) {
      const point = result[entity.id][frame];
      if (point.trackId == null || point.x == null) continue;
      const key = String(point.trackId);
      if (!owners.has(key)) owners.set(key,[]);
      owners.get(key).push({id:entity.id,point});
    }
    for (const group of owners.values()) {
      if (group.length < 2) continue;
      let winner = null;
      if (group.some(owner=>owner.point.identityExclusive)) {
        const start = Math.max(...group.map(owner=>owner.point.identityStartFrame??-1));
        const latest = group.filter(owner=>(owner.point.identityStartFrame??-1)===start);
        const order = Math.max(...latest.map(owner=>owner.point.identityOrder||0));
        const final = latest.filter(owner=>(owner.point.identityOrder||0)===order);
        if (final.length === 1) winner = final[0];
      }
      for (const owner of group) {
        if (owner === winner) continue;
        result[owner.id][frame] = {frame,time:frames[frame].time,x:null,y:null,
          source:winner?'missing':'conflict',...(winner?{identitySource:'reassigned',
            previousTrackId:owner.point.trackId,claimedBy:winner.id}:{})};
      }
    }
  }
}
