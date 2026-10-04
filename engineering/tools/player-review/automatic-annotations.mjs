// Annotation aliases are unverified hints over observed detector boxes.
// Team uncertainty never deletes an identity; disconnected tracks are candidates.
import {identityAt,identitySuggestionSummary,filterDismissedModelBindings,normalizeTeamColorMetadata,TEAM_COLOR_LAYOUT} from './identity-timeline.mjs';
import {mergeSourceCuts} from './tracking-display.mjs';

const playerId=id=>/^P(?:[1-9]|10)$/.test(id);
const number=id=>Number(id.slice(1));
const validBox=row=>Array.isArray(row)&&row.length>=4&&row.slice(0,4).every(Number.isFinite)
  &&row[2]>row[0]&&row[3]>row[1];
const rawFingerprint=clip=>clip.tracking_raw_fingerprint||null;
const frameBasis=frames=>frames.map(row=>[row.frame,row.time,row.source_frame_pts??null,
  row.source_time_base??null,row.source_frame??null,row.source_time??null]);

function role(clip,record,row){
  const classes=clip.trackingMetadata?.model_names||clip.trackingMetadata?.class_names||{};
  const named=classes[row[6]];
  const declared=record.track_roles?.[Number(row[4])]||clip.track_roles?.[Number(row[4])];
  if(declared==='referee'||named==='referee')return 'referee';
  if(declared)return declared;
  return named==='player'?'player':'person';
}

function roleConflict(record,id){
  return Array.isArray(record.role_conflicts)?record.role_conflicts.some(item=>
    item.trackIds?.some(value=>Number(value)===id)||Number(item.playerTrackId)===id||Number(item.refereeTrackId)===id)
    :Boolean(record.role_conflicts?.[id]);
}

function eligible(clip,record,row){
  return validBox(row)&&Number.isInteger(Number(row[4]))&&Number(row[4])>=0&&role(clip,record,row)==='player'
    &&!record.track_evidence?.[Number(row[4])]?.identity_review_required&&!roleConflict(record,Number(row[4]));
}

function observedBindings(clip,bindings,cuts,blocked=()=>false){
  const result=[],cutSet=new Set(cuts);
  for(const binding of bindings){
    for(let frame=binding.start;frame<=binding.end;frame++){
      const record=clip.frames[frame],id=Number(binding.trackId);
      const row=record?.tracks?.find(value=>Number(value[4])===id);
      if(!row||!eligible(clip,record,row)||blocked(id,frame))continue;
      const last=result.at(-1);
      if(last&&last.trackId===id&&last.end===frame-1&&!cutSet.has(frame))last.end=frame;
      else result.push({...binding,kind:'track',start:frame,end:frame,trackId:id,
        source:'model_suggestion',reviewRequired:true,identityConfirmed:false});
    }
  }
  return result;
}

function parsed(clip,suggestions,issues){
  if(!suggestions)return [];
  try{
    const summary=identitySuggestionSummary(suggestions,clip.frames);
    return summary.entities.map(item=>({...suggestions.entities.find(source=>source.id===item.id),...item}));
  }catch{issues.push('invalid_identity_suggestions');return [];}
}

function compatibleSupplement(clip,supplement){
  return supplement&&rawFingerprint(clip)&&supplement.video_sha256===clip.video_sha256
    &&supplement.tracking_raw_fingerprint===rawFingerprint(clip)
    &&JSON.stringify(supplement.frameMapping)===JSON.stringify(frameBasis(clip.frames))
    &&JSON.stringify(supplement.sourceCuts||[])===JSON.stringify(clip.sourceCuts||[]);
}

function commonFramePlan(clip){
  let seed=[];
  for(const record of clip.frames){
    const rows=record.tracks.filter(row=>eligible(clip,record,row));
    if(Math.min(rows.length,10)>Math.min(seed.length,10))seed=rows;
  }
  return seed.slice().sort((a,b)=>a[0]-b[0]||Number(a[4])-Number(b[4])).slice(0,10).map((row,index)=>({
    id:`P${index+1}`,sourcePlayerId:`P${index+1}`,bindings:[{start:0,end:clip.frames.length-1,
      trackId:Number(row[4]),method:'visible-common-frame-alias-v1'}]}));
}

function annotationPlan(clip,issues){
  const base=parsed(clip,clip.identitySuggestions,issues),plan=base.map(item=>({...item,recovered:false}));
  const supplement=clip.identitySupplement;
  if(supplement&&!compatibleSupplement(clip,supplement))issues.push('incompatible_identity_supplement');
  const source=compatibleSupplement(clip,supplement)?parsed(clip,supplement.identitySuggestions,issues):[];
  const claimedSources=new Set(base.map(item=>item.sourcePlayerId||item.id));
  const claimedTracks=new Set(base.flatMap(item=>item.bindings.map(binding=>binding.trackId)));
  const used=new Set(base.map(item=>item.id));
  for(const item of source.sort((a,b)=>number(a.id)-number(b.id))){
    if(claimedSources.has(item.id)||item.bindings.some(binding=>claimedTracks.has(binding.trackId)))continue;
    const id=Array.from({length:10},(_,index)=>`P${index+1}`).find(value=>!used.has(value));
    if(!id)break;
    plan.push({...item,id,sourcePlayerId:item.id,teamGroup:null,teamHint:null,recovered:true});used.add(id);
    item.bindings.forEach(binding=>claimedTracks.add(binding.trackId));
  }
  return plan.length?plan:commonFramePlan(clip);
}

function hasHumanEdits(entity){
  return Boolean(entity.anchors?.length||entity.courtAnchors?.length||entity.identityKeyframes?.length||entity.bindings?.length);
}

function recoveredColor(clip,item){
  const vote=clip.identitySuggestions?.unassignedTeamCandidates?.find(candidate=>candidate.sourcePlayerId===item.sourcePlayerId);
  if(!vote||['identity_conflict','conflicting_team_evidence','third_team_color_pending','team_capacity_exceeded'].includes(vote.reason))
    return {group:null,label:null,evidence:vote?.evidence||null};
  const entries=Object.entries(vote.evidence||{}).filter(([,count])=>Number.isFinite(count)&&count>0);
  if(entries.length!==1)return {group:null,label:null,evidence:vote.evidence};
  const label=entries[0][0],labels=clip.identitySuggestions?.teamGrouping?.labels||{};
  const groups=['A','B'].filter(group=>labels[group]===label);
  return {group:groups.length===1?groups[0]:null,label,evidence:vote.evidence};
}

export function initializeAutomaticAnnotations(session,clip){
  const issues=[],addedPlayerIds=[],recoveredPlayerIds=[];
  if(session.videoHash!==clip.video_sha256||!Array.isArray(clip.frames))
    return {playerCount:0,addedPlayerIds,recoveredPlayerIds,issues:['incompatible_annotation_video']};
  normalizeTeamColorMetadata(session);
  if(session.automaticAnnotation?.trackingRawFingerprint&&
      session.automaticAnnotation.trackingRawFingerprint!==rawFingerprint(clip))
    return {playerCount:0,addedPlayerIds,recoveredPlayerIds,issues:['incompatible_annotation_detector']};
  const players=session.entities.filter(entity=>entity.role==='player'&&playerId(entity.id));
  const cuts=mergeSourceCuts(session.cuts,clip.sourceCuts,clip.frames.length);
  const occupied=new Set(players.filter(entity=>entity.identitySuggestionsDismissed||entity.modelBindings?.length||hasHumanEdits(entity)).map(entity=>entity.id));
  const ownership=clip.frames.map((_,frame)=>new Set(players.flatMap(entity=>{
    const identity=identityAt(entity,frame,cuts,clip.frames[frame]);
    return identity?.kind==='track'?[Number(identity.trackId)]:identity?.candidateTrackIds||[];
  })));
  const plan=annotationPlan(clip,issues);
  // Retain grouped IDs first, so recovery cannot take their still-empty slots.
  const reserved=new Set(plan.filter(item=>!item.recovered).map(item=>item.id));
  for(const item of plan){
    let entity=players.find(value=>value.id===item.id);
    // A release/clear is a deliberate empty state, including after save/reload.
    // Do not recycle its suggestion into another empty slot.
    if(entity?.identitySuggestionsDismissed||(entity?.bindings||[]).some(binding=>binding.kind==='unassigned'))continue;
    if(occupied.has(item.id)){
      if(entity.modelBindings?.length&&!hasHumanEdits(entity))continue;
      entity=players.find(value=>!occupied.has(value.id)&&!reserved.has(value.id));
    }
    if(!entity)continue;
    const bindings=observedBindings(clip,filterDismissedModelBindings(item.bindings,players),cuts,(id,frame)=>ownership[frame].has(id));
    if(!bindings.length)continue;
    entity.modelBindings=bindings;
    const color=item.recovered?recoveredColor(clip,item):{group:item.teamGroup,label:item.teamHint,evidence:item.teamEvidence};
    if(color.evidence)entity.automaticTeamEvidence=structuredClone(color.evidence);
    if(color.group){entity.modelTeamGroup=color.group;entity.modelTeamHint=color.label;}
    occupied.add(entity.id);addedPlayerIds.push(entity.id);
    if(item.recovered)recoveredPlayerIds.push(entity.id);
    for(const binding of bindings)for(let frame=binding.start;frame<=binding.end;frame++)ownership[frame].add(binding.trackId);
  }
  const playerCount=players.filter(entity=>entity.modelBindings?.length||hasHumanEdits(entity)).length;
  if(addedPlayerIds.length){
    session.automaticAnnotation={version:1,method:'observed-player-aliases-v1',verified:false,
      videoHash:clip.video_sha256,trackingRawFingerprint:rawFingerprint(clip),
      trackingFingerprint:clip.tracking_fingerprint||null,teamLayout:TEAM_COLOR_LAYOUT};
    session.modelSuggestionLoad={version:1,method:'automatic-visible-annotations-v1',verified:false,playerCount,
      bindingCount:players.reduce((count,entity)=>count+(entity.modelBindings?.length||0),0),teamLayout:TEAM_COLOR_LAYOUT};
  }
  return {playerCount,addedPlayerIds,recoveredPlayerIds,issues};
}

export function automaticAnnotationPointVisible(clip,frame,point){
  if(!point||![point.x,point.y].every(Number.isFinite)||point.reviewExcluded||
      ['interpolated','conflict','missing','out_of_view'].includes(point.source))return false;
  // Explicit review releases only this visible observation from model gating.
  // The detector's risk evidence remains intact for the diagnostic display.
  if(point.frameIdentityConfirmed===true)return ['manual','tracked','manual_range'].includes(point.source);
  if(point.source==='manual_range')return ['tracked','manual'].includes(point.rangeCorrection?.originalSource);
  if(['manual_forward','manual_range','manual_track_occurrences'].includes(point.identitySource))return true;
  if(point.identitySource==='model_suggestion'){
    const record=clip.frames?.[frame],row=record?.tracks?.find(value=>Number(value[4])===Number(point.trackId));
    return Boolean(row&&point.trackId!=null&&eligible(clip,record,row));
  }
  // Legacy human image marks remain editable; they do not become model locks.
  return ['manual','manual_path'].includes(point.source);
}

export function automaticPlayerCandidates(clip,frame,trajectories={}){
  const record=clip.frames?.[frame];if(!record)return [];
  const owned=new Set(Object.values(trajectories).map(points=>points?.[frame])
    .filter(point=>point?.trackId!=null&&automaticAnnotationPointVisible(clip,frame,point)).map(point=>Number(point.trackId)));
  const result=(record.tracks||[]).filter(row=>validBox(row)&&role(clip,record,row)==='player'&&!owned.has(Number(row[4])))
    .map(row=>({box:row.slice(0,4),trackId:Number(row[4]),score:row[5],role:'player',
      roleConflict:roleConflict(record,Number(row[4])),
      identityReviewRequired:Boolean(record.track_evidence?.[Number(row[4])]?.identity_review_required),
      reason:roleConflict(record,Number(row[4]))?'role_conflict':'unmatched_identity'}));
  return result;
}
