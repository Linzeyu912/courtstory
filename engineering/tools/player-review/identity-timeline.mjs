// Identity confirmations are time boundaries; position edits are independent.
export const IDENTITY_BINDING_MODE = 'forward_only_v1';
export const TEAM_COLOR_LAYOUT = 'fixed_red_blue_color_only_v1';

export function normalizeTeamColorMetadata(session) {
  delete session.teamRoles;
  for(const key of ['automaticAnnotation','modelSuggestionLoad']){
    const metadata=session[key];
    if(metadata&&typeof metadata==='object'&&'teamLayout' in metadata)
      session[key]={...metadata,teamLayout:TEAM_COLOR_LAYOUT};
  }
  return session;
}

// Row slots define the review team; model jersey-color groups remain evidence.
export function entityTeamSide(entity) {
  const number = /^P([1-9]|10)$/.exec(entity.id)?.[1];
  return number ? (Number(number)<=5?'red':'blue') : null;
}

export function identityKeyframes(entity) {
  if (Array.isArray(entity.identityKeyframes)) return entity.identityKeyframes;
  const keys = [];
  for (const anchor of [...(entity.anchors||[])].sort((a,b)=>a.frame-b.frame)) {
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
  normalizeTeamColorMetadata(session);
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

export function identityAt(entity, frame, cuts=[], availableTracks=null) {
  const records=availableTracks?.tracks??availableTracks;
  const present=records==null?null:new Set([...(records instanceof Map?records.keys():records)]
    .map(value=>Number(Array.isArray(value)?value[4]:value)));
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
    if(binding.scope==='track_occurrences')continue;
    if(binding.origin==='human_range_replacement')continue;
    consider({...binding,identitySource:binding.kind==='unassigned'?'human_unassigned':'manual_range'});
  }
  // A finite, deliberate range replacement shadows older boundaries only in
  // this interval. Outside it the exact old rule/token resumes unchanged.
  // A later single-frame or forward correction can still supersede the range.
  const replacement=(entity.bindings||[]).filter(b=>b.origin==='human_range_replacement'&&b.start<=frame&&b.end>=frame)
    .sort((a,b)=>(b.order||0)-(a.order||0))[0];
  if(replacement&&(!active||(replacement.order||0)>=(active.order||0)))active={...replacement,identitySource:'manual_range'};
  if(active&&active.kind!=='unassigned'&&cuts.some(cut=>cut>active.start&&cut<=frame))active=null;
  // A legacy forward claim can leave a real gap after its T disappears. An
  // explicitly reviewed range or a hand-edited position must remain protected.
  const manual=(entity.anchors||[]).find(anchor=>anchor.frame===frame&&
    (anchor.trackId==null||Number(anchor.trackId)===Number(active?.trackId)));
  const forwardGap=active?.identitySource==='manual_forward'&&active.kind==='track'&&
    present&&!present.has(Number(active.trackId))&&!manual;
  if(active&&!forwardGap)return active;
  const occurrences=(entity.bindings||[]).filter(binding=>binding.scope==='track_occurrences'&&
    binding.kind==='track'&&binding.start<=frame&&binding.end>=frame&&
    (!present||present.has(Number(binding.trackId))));
  // These claims apply to observations, not forward propagation. A cut added
  // after assignment breaks display trails without deleting later observations.
  if(occurrences.length){
    const ids=[...new Set(occurrences.map(binding=>Number(binding.trackId)))].sort((a,b)=>a-b);
    const latest=[...occurrences].sort((a,b)=>(b.order||0)-(a.order||0))[0];
    return {...latest,kind:ids.length>1?'conflict':'track',trackId:ids.length>1?null:ids[0],
      ...(ids.length>1?{candidateTrackIds:ids}:{}),identitySource:'manual_track_occurrences',exclusive:false};
  }
  if(active)return active;
  if (entity.identitySuggestionsDismissed) return null;
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
  const active=identityAt(entity,start,session.cuts);
  if(active?.origin==='human_range_replacement'){
    const newer=[...identityKeyframes(entity).map(key=>({...key,start:key.frame})),...(entity.bindings||[])].filter(record=>(record.order||0)>(active.order||0)).map(record=>record.start);
    return {start,end:Math.min(frameCount,active.end+1,...[...newer,...session.cuts].filter(frame=>frame>start))-1};
  }
  const boundaries = [...identityKeyframes(entity).map(key=>key.frame),
    ...(entity.bindings||[]).flatMap(binding=>binding.scope==='track_occurrences'?
      [binding.start,binding.end+1]:[binding.start]),...session.cuts];
  return {start,end:Math.min(frameCount,...boundaries.filter(frame=>frame>start))-1};
}

// Forward confirmation outranks whole-track assignments, so their observation
// boundaries cannot shorten its reported scope. Release uses the finer interval.
export function identityConfirmationInterval(session, entity, start, frameCount) {
  const boundaries = [...identityKeyframes(entity).map(key=>key.frame),
    ...(entity.bindings||[]).filter(binding=>binding.scope!=='track_occurrences').map(binding=>binding.start),
    ...session.cuts];
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
  Object.assign(entity.anchors.at(-1),{identityReviewOrder:key.order,identityReviewSource:'manual_forward'});
  session.identitySelection = null;
  return identityConfirmationInterval(session,entity,frame,frames.length);
}

export function identityReviewToken(identity) {
  return JSON.stringify(identity?[identity.identitySource,identity.kind,identity.trackId??null,
    identity.scope==='track_occurrences'?null:identity.start,
    identity.scope==='track_occurrences'?null:Number.isFinite(identity.end)?identity.end:null,identity.order||0]:null);
}

export function anchorReviewSignature(anchor) {
  return JSON.stringify(anchor?[anchor.frame,anchor.x,anchor.y,anchor.trackId??null,
    anchor.box||null,anchor.source||null]:null);
}

// A track assignment and a frame review are different facts. Reviews apply only
// to the observation and identity that were actually shown to the reviewer.
export function frameIdentityConfirmed(entity,point,identity) {
  if(!point||point.x==null||point.y==null||!['manual','tracked','manual_range'].includes(point.source)||
      point.reviewExcluded||['conflict','unassigned','out_of_view'].includes(identity?.kind))return false;
  const anchor=(entity.anchors||[]).find(item=>item.frame===point.frame);
  const scope=identity?.scope==='track_occurrences'?'track_occurrences':identity?.identitySource||'manual_position';
  for(const review of entity.frameConfirmations||[]){
    if(review.frame!==point.frame||review.trackId!==(point.trackId??null))continue;
    if(review.identityScope==='manual_position'){
      if(anchor&&review.anchorSignature===anchorReviewSignature(anchor)&&
          review.identityToken===identityReviewToken(identity))return true;
      continue;
    }
    if(review.identityScope!==scope||review.identityOrder!==(identity?.order||0)||
        review.trackId!==identity?.trackId)continue;
    if(review.identityToken!==undefined&&review.identityToken!==identityReviewToken(identity))continue;
    return true;
  }
  if(anchor?.identityConfirmed!==true||anchor.source==='manual_path'||
      (anchor.trackId??null)!==(point.trackId??null))return false;
  if(anchor.trackId!=null&&(identity?.kind!=='track'||Number(identity.trackId)!==Number(anchor.trackId)))return false;
  if(anchor.trackId==null&&identity?.kind==='track')return false;
  if(anchor.identityReviewOrder!==undefined&&anchor.identityReviewOrder!==(identity?.order||0))return false;
  if(anchor.identityReviewSource!==undefined&&anchor.identityReviewSource!==identity?.identitySource)return false;
  return true;
}

export function identityProvenance(identity) {
  return identity ? {identitySource:identity.identitySource,identityStartFrame:identity.start,
    identityOrder:identity.order||0,identityExclusive:Boolean(identity.exclusive),
    ...(Number.isFinite(identity.end)?{identityEndFrame:identity.end}:{}),
    ...(identity.origin?{identityOrigin:identity.origin}:{}),
    ...(identity.scope==='track_occurrences'?{associationScope:'track_occurrences',
      selectionFrame:identity.selectionFrame,identityConfirmed:false,reviewRequired:true,
      ...(identity.candidateTrackIds?{candidateTrackIds:[...identity.candidateTrackIds]}:{})}:{}),
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

// Rejected observations travel with the person during roster swaps. Keeping
// their original track/range prevents automatic aliases reappearing in an empty slot.
export function filterDismissedModelBindings(bindings,entities) {
  const dismissed=entities.flatMap(entity=>entity.dismissedModelBindings||[]);
  if(!dismissed.length)return bindings.map(binding=>({...binding}));
  return bindings.flatMap(binding=>{
    let ranges=[{...binding}];
    for(const blocked of dismissed){
      if(Number(blocked.trackId)!==Number(binding.trackId))continue;
      ranges=ranges.flatMap(range=>{
        if(blocked.end<range.start||blocked.start>range.end)return [range];
        return [...(blocked.start>range.start?[{...range,end:blocked.start-1}]:[]),
          ...(blocked.end<range.end?[{...range,start:blocked.end+1}]:[])];
      });
    }
    return ranges;
  });
}

export function adoptIdentitySuggestions(session,suggestions,frames) {
  // Finish validation before writing anything; no partial roster on failure.
  const summary=identitySuggestionSummary(suggestions,frames);
  normalizeTeamColorMetadata(session);
  for (const entity of session.entities) {
    if (entity.role!=='player'||entity.identitySuggestionsDismissed) continue;
    const item=summary.entities.find(value=>value.id===entity.id);
    if(!item)continue; // A partial proposal must not erase recovered associations.
    entity.modelBindings=filterDismissedModelBindings(item.bindings,session.entities);
    if(item?.teamHint)entity.modelTeamHint=item.teamHint;
    else delete entity.modelTeamHint;
    if(item?.teamGroup)entity.modelTeamGroup=item.teamGroup;
    else delete entity.modelTeamGroup;
  }
  // Model groups describe observed jerseys; fixed row teams are never overwritten.
  if(suggestions.teamGrouping)session.modelTeamGrouping=structuredClone(suggestions.teamGrouping);
  session.modelSuggestionLoad={version:1,method:summary.method,verified:false,
    playerCount:summary.playerCount,bindingCount:summary.bindingCount,teamLayout:TEAM_COLOR_LAYOUT};
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
      const explicit=group.filter(owner=>!['model_suggestion','manual_track_occurrences'].includes(owner.point.identitySource));
      const reviewed=group.filter(owner=>!explicit.includes(owner)&&owner.point.frameIdentityConfirmed);
      const bulk=group.filter(owner=>owner.point.identitySource==='manual_track_occurrences');
      // Explicit human corrections stay authoritative. A single frame review
      // wins over unreviewed propagation only at this frame; two reviewed
      // claims still conflict. Merely clicking later never resolves that tie.
      let eligible=explicit.length?explicit:reviewed.length?reviewed:bulk.length?bulk:group;
      if(eligible.some(owner=>owner.point.identityOrigin==='human_range_replacement')){
        const order=Math.max(...eligible.map(owner=>owner.point.identityOrder||0));eligible=eligible.filter(owner=>(owner.point.identityOrder||0)===order);
      }
      if(eligible.length===1&&eligible.length<group.length)winner=eligible[0];
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
            previousTrackId:owner.point.trackId,claimedBy:winner.id}:{}),
          ...(owner.point.associationScope==='track_occurrences'?{
            associationScope:'track_occurrences',selectionFrame:owner.point.selectionFrame,
            identityConfirmed:false,reviewRequired:true,
            ...(winner&&explicit.includes(winner)?{assignmentBlockedByHuman:true}:{}),
            ...(!winner?{candidateTrackIds:[owner.point.trackId]}:{})}:{})};
      }
    }
  }
}
