// Identity confirmations are time boundaries; position edits are independent.
import {effectiveTeamGroup} from './team-overlay.mjs';
export const IDENTITY_BINDING_MODE = 'forward_only_v1';

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
  for (const entity of session.entities) {
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
    consider({...binding,identitySource:'manual_range'});
  }
  if (active && !cuts.some(cut=>cut>active.start&&cut<=frame)) return active;
  // Model proposals are a separate fallback lane. They never outrank any
  // active human confirmation, including a deliberate untracked/exit state.
  active = null;
  for (const binding of entity.modelBindings||[]) {
    if (cuts.some(cut=>cut>binding.start&&cut<=frame)) continue;
    consider({...binding,identitySource:'model_suggestion',exclusive:false});
  }
  return active;
}

export function identityBoundaries(entity) {
  return [...identityKeyframes(entity).map(key=>key.frame),
    ...(entity.bindings||[]).flatMap(binding=>[binding.start,binding.end+1]),
    ...(entity.modelBindings||[]).flatMap(binding=>[binding.start,binding.end+1])];
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
  const preserved=proposal.preservePosition?entity.anchors.find(item=>item.frame===frame&&
    item.identityConfirmed===false&&Number(item.trackId)===trackId):null;
  entity.anchors = entity.anchors.filter(item=>item.frame!==frame);
  entity.anchors.push(preserved?{...preserved,identityConfirmed:true}:
    {frame,x:(proposal.box[0]+proposal.box[2])/2,y:proposal.box[3],
      trackId,box:proposal.box.slice(),footMethod:'bbox_bottom_center',identityConfirmed:true});
  session.identitySelection = null;
  return identityInterval(session,entity,frame,frames.length);
}

export function identityProvenance(identity) {
  return identity ? {identitySource:identity.identitySource,identityStartFrame:identity.start,
    identityOrder:identity.order||0,identityExclusive:Boolean(identity.exclusive),
    ...(identity.identitySource==='model_suggestion'?{identityConfirmed:false,
      reviewRequired:true,modelSuggestionMethod:identity.method}: {})} : {};
}

export function identitySuggestionSummary(suggestions,frames) {
  if (!suggestions || suggestions.version!==1 || suggestions.verified!==false ||
      !Array.isArray(suggestions.entities)) throw new Error('模型建议格式不正确，未载入。');
  if(suggestions.teamGrouping&&(suggestions.teamGrouping.version!==1||suggestions.teamGrouping.verified!==false||
      suggestions.teamGrouping.layout!=='reserved_5_plus_5_v1'))throw new Error('分队建议须保持待确认，未载入。');
  const seen=new Set(),entities=[],teamCounts={A:0,B:0};
  for (const item of suggestions.entities) {
    if (!/^P(?:[1-9]|10)$/.test(item?.id) || seen.has(item.id) || !Array.isArray(item.bindings)) {
      throw new Error('模型建议须使用不重复的球员 1–10，未载入。');
    }
    seen.add(item.id);
    if(item.teamGroup!=null){
      if(!['A','B'].includes(item.teamGroup)||++teamCounts[item.teamGroup]>5||
          (item.teamGroup==='A')!==(Number(item.id.slice(1))<=5))
        throw new Error('分队建议须每队最多五人，并使用 1–5 / 6–10 槽位，未载入。');
    }
    const bindings=item.bindings.map(binding=>{
      const {start,end,trackId}=binding;
      if (!Number.isInteger(start)||!Number.isInteger(end)||!Number.isInteger(trackId)||
          start<0||end>=frames.length||start>end||trackId<0||
          !frames.slice(start,end+1).some(record=>record.tracks.some(box=>Number(box[4])===trackId))) {
        throw new Error('模型建议区间或临时编号不匹配，未载入。');
      }
      return {kind:'track',start,end,trackId,source:'model_suggestion',
        reviewRequired:true,identityConfirmed:false,method:String(suggestions.method||'model')};
    });
    entities.push({id:item.id,teamHint:typeof item.teamHint==='string'?item.teamHint:null,
      teamGroup:item.teamGroup||null,bindings});
  }
  return {method:String(suggestions.method||'model'),entities,
    playerCount:entities.filter(item=>item.bindings.length).length,
    bindingCount:entities.reduce((n,item)=>n+item.bindings.length,0)};
}

export function adoptIdentitySuggestions(session,suggestions,frames) {
  // Finish validation before writing anything; no partial roster on failure.
  const summary=identitySuggestionSummary(suggestions,frames);
  for (const entity of session.entities) {
    if (entity.role!=='player') continue;
    const item=summary.entities.find(value=>value.id===entity.id);
    entity.modelBindings=item?.bindings.map(binding=>({...binding}))||[];
    if(item?.teamHint)entity.modelTeamHint=item.teamHint;
    else delete entity.modelTeamHint;
    if(item?.teamGroup)entity.modelTeamGroup=item.teamGroup;
    else delete entity.modelTeamGroup;
  }
  // Existing human group choices keep priority; excess new hints remain unassigned.
  const teamCounts={A:0,B:0};
  for(const entity of session.entities.filter(e=>e.role==='player'&&e.teamGroupSource==='human')){
    const group=effectiveTeamGroup(entity);if(group)teamCounts[group]++;
  }
  for(const entity of session.entities.filter(e=>e.role==='player'&&e.teamGroupSource!=='human')){
    const group=effectiveTeamGroup(entity);if(group&&++teamCounts[group]>5)delete entity.modelTeamGroup;
  }
  if(suggestions.teamGrouping)session.modelTeamGrouping=structuredClone(suggestions.teamGrouping);
  session.modelSuggestionLoad={version:1,method:summary.method,verified:false,
    playerCount:summary.playerCount,bindingCount:summary.bindingCount};
  return summary;
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
      const human=group.filter(owner=>owner.point.identitySource!=='model_suggestion');
      if (human.length===1 && human.length<group.length) winner=human[0];
      const eligible=human.length?human:group;
      if (!winner && eligible.some(owner=>owner.point.identityExclusive)) {
        const start = Math.max(...eligible.map(owner=>owner.point.identityStartFrame??-1));
        const latest = eligible.filter(owner=>(owner.point.identityStartFrame??-1)===start);
        const order = Math.max(...latest.map(owner=>owner.point.identityOrder||0));
        const final = latest.filter(owner=>(owner.point.identityOrder||0)===order);
        if (final.length === 1) winner = final[0];
      }
      for (const owner of group) {
        if (owner === winner) continue;
        result[owner.id][frame] = {frame,time:frames[frame].time,x:null,y:null,
          source:winner?'missing':'conflict',...(owner.point.identitySource==='model_suggestion'?{
            identityConfirmed:false,reviewRequired:true}:{}),...(winner?{identitySource:'reassigned',
            previousTrackId:owner.point.trackId,claimedBy:winner.id}:{})};
      }
    }
  }
}
