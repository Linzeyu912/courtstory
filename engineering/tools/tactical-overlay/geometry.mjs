import {calibrationAt,project,COURT} from '../player-review/court.mjs';
import {issue,evidenceQuality,participantQuality} from './validation.mjs';

export const MOVEMENT_KINDS=['move','cut','roll','pop'];
export function createGeometryContext(review,playDefinition,freezeFrame,options) {
  const frames=review.sourceFrameMapping,cuts=[...new Set([...(review.settings?.cuts??[]),...(review.settings?.sourceCuts??[])])].sort((a,b)=>a-b);
  const context={review,playDefinition,freezeFrame,options,frames,cuts,
    entityMap:new Map(review.entities.map(e=>[e.id,e])),
    pointMaps:new Map(review.entities.map(e=>[e.id,new Map(e.trajectory.map(p=>[p.frame,p]))])),
    courtPointMaps:new Map(review.entities.map(e=>[e.id,new Map((e.courtTrajectory??[]).map(p=>[p.frame,p]))]))};
  context.maps=frames.map((_,frame)=>evidenceQuality(context,'calibration',{},frame,frame+1).state==='invalid'?null:calibrationAt(review.court?.calibration,frame,frames,cuts));
  return context;
}
export function crossCutCompatible(c,frame) {
  const start=Math.min(frame,c.freezeFrame),end=Math.max(frame,c.freezeFrame)+1;
  if(!c.cuts.some(cut=>cut>start&&cut<end))return true;
  return typeof c.review.court?.referenceId==='string'&&c.review.court.referenceId.length>0&&
    evidenceQuality(c,'calibration',{},start,end).state==='reviewed';
}
const observed=source=>['tracked','manual','manual_range'].includes(source);
const pointReason=p=>!p?'missing_position':p.source==='conflict'?'identity_conflict':p.source==='out_of_view'?'out_of_view':
  ['interpolated','manual_path','court_estimated'].includes(p.source)?'estimated_point':!observed(p.source)||p.x===null||p.y===null?'missing_position':null;

function calibrationProvenance(c,mapping) {
  if(!mapping)return [];
  const keyframes=c.review.court?.calibration?.keyframes??[];
  return [...new Set(mapping.supportFrames)].map(frame=>{
    const key=keyframes.find(key=>key.frame===frame);
    const controls=key?.points?.filter(p=>p.enabled!==false&&p.role!=='check');
    return {source:key?.source??null,referenceFrame:key?.cameraSupportFrame??key?.quality?.cameraSupportFrame??key?.quality?.referenceFrame??null,
      side:key?.side??null,controlSources:[...new Set(controls?controls.map(p=>p.source??key.source??'reference'):[key?.source??'reference'])].sort(),
      propagationMethod:key?.quality?.method??key?.method??null};
  });
}
function samePropagatedReference(a,b) {
  const chain=provenance=>provenance.length&&provenance.every(p=>Number.isSafeInteger(p.referenceFrame)&&
    (p.source==='camera_propagation'||p.controlSources.every(source=>source==='camera_propagation')))&&
    provenance.every(p=>JSON.stringify(p)===JSON.stringify(provenance[0]));
  return chain(a)&&chain(b)&&JSON.stringify(a[0])===JSON.stringify(b[0]);
}

/** Saved preparation points are authoritative estimates; raw observations still reproject through H. */
export function observedPoint(c,entityId,frame) {
  const raw=c.pointMaps.get(entityId)?.get(frame),courtRaw=c.courtPointMaps.get(entityId)?.get(frame);
  if(evidenceQuality(c,'identity',{entityId},frame,frame+1).state==='invalid')return {point:null,reason:'identity_conflict'};
  if(evidenceQuality(c,'position',{entityId},frame,frame+1).state==='invalid')return {point:null,reason:'missing_position'};
  if(c.review.courtPreparation){
    const p=c.review.courtPreparation.preparedByPlayer[entityId]?.[frame],mapping=c.maps[frame],freeze=c.maps[c.freezeFrame];
    if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))return {point:null,reason:p?.source??'missing_position'};
    const courtPoint={x:p.x,y:p.y};
    return {reason:null,projectionReason:crossCutCompatible(c,frame)?null:'court_reference_mismatch',point:{frame,time:c.frames[frame].time,sourceFrame:c.frames[frame].sourceFrame,sourceTime:c.frames[frame].sourceTime,entityId,trackId:raw?.trackId??null,imageSource:raw?.source??p.source,
      imagePoint:mapping&&project(mapping.toImage,p.x,p.y),rawImagePoint:raw&&Number.isFinite(raw.x)&&Number.isFinite(raw.y)?{x:raw.x,y:raw.y}:null,
      courtPoint,freezePoint:freeze&&project(freeze.toImage,p.x,p.y),footMethod:p.footMethod??null,
      positionSource:p.source,groundContactConfirmed:p.source==='qwen_refined'?false:p.groundContactConfirmed??null,
      ...(p.source==='qwen_refined'?{reviewRequired:true,refinement:{versionId:p.versionId,state:p.refinementState,
        basis:p.groundEstimationBasis,evidenceFrames:[...(p.evidenceFrames??[])],fitSupportFrames:[...(p.fitSupportFrames??[])]}}:{}),
      identity:{source:raw?.identitySource??null,startFrame:raw?.identityStartFrame??null,order:raw?.identityOrder??null,exclusive:raw?.identityExclusive??false},
      calibration:{method:mapping?.method??'unavailable',supportFrames:mapping?.supportFrames??[],referenceOnly:mapping?.referenceOnly??true,provenance:calibrationProvenance(c,mapping)},preparedRevision:c.review.courtPreparation.revision}};
  }
  let reason=pointReason(raw),courtPoint=null,imagePoint=null;
  // A court anchor requires an explicit original-frame observation and a reviewed ground-point interval.
  const manualCourt=courtRaw?.source==='court_manual'&&courtRaw.observation?.frame===frame&&observed(courtRaw.observation?.source)&&
    Number.isFinite(courtRaw.x)&&Number.isFinite(courtRaw.y)&&evidenceQuality(c,'position',{entityId},frame,frame+1).state==='reviewed';
  if(['identity_conflict','out_of_view','estimated_point'].includes(reason))return {point:null,reason};
  if(reason&&!manualCourt)return {point:null,reason};
  if(!reason)imagePoint={x:raw.x,y:raw.y};
  const mapping=c.maps[frame];
  if(evidenceQuality(c,'calibration',{},frame,frame+1).state==='invalid'&&!manualCourt)return {point:null,reason:'calibration_unavailable'};
  if(manualCourt)courtPoint={x:courtRaw.x,y:courtRaw.y};
  else courtPoint=mapping&&project(mapping.toCourt,raw.x,raw.y);
  if(!courtPoint)return {point:null,reason:'calibration_unavailable'};
  const compatible=crossCutCompatible(c,frame),freeze=c.maps[c.freezeFrame];
  const freezePoint=freeze&&compatible?project(freeze.toImage,courtPoint.x,courtPoint.y):null;
  const m=c.frames[frame];
  return {reason:null,projectionReason:!compatible?'court_reference_mismatch':null,point:{frame,time:m.time,sourceFrame:m.sourceFrame,sourceTime:m.sourceTime,
    entityId,trackId:raw?.trackId??null,imageSource:raw?.source??courtRaw.observation.source,imagePoint,courtPoint,freezePoint,
    footMethod:raw?.footMethod??'human_court_anchor',groundContactConfirmed:raw?.groundContactConfirmed??null,
    identity:{source:raw?.identitySource??null,startFrame:raw?.identityStartFrame??null,order:raw?.identityOrder??null,exclusive:raw?.identityExclusive??false},
    calibration:{method:manualCourt?'observed_court_anchor':mapping.method,supportFrames:mapping?.supportFrames??[],referenceOnly:mapping?.referenceOnly??true,
      referenceId:c.review.court?.referenceId??null,quality:structuredClone(mapping?.quality??null),provenance:calibrationProvenance(c,mapping),reviewRequired:true},
    observationEvidence:manualCourt?structuredClone(courtRaw.observation):null}};
}

function continuity(c,entityId,a,b) {
  return evidenceQuality(c,'continuity',{entityId},a,b+1).state==='reviewed'&&evidenceQuality(c,'identity',{entityId},a,b+1).state==='reviewed';
}
function boundaryReason(c,entityId,prev,next) {
  if(c.cuts.includes(next.frame))return 'source_cut';
  const delta=next.time-prev.time;
  if(delta<=0||next.sourceTime<=prev.sourceTime)return 'non_monotonic_time';
  if(delta>c.options.maxStepSeconds||Math.hypot(next.courtPoint.x-prev.courtPoint.x,next.courtPoint.y-prev.courtPoint.y)/delta>c.options.maxSpeedMetresPerSecond)return 'suspicious_jump';
  const reviewed=continuity(c,entityId,prev.frame,next.frame);
  if((prev.trackId!==next.trackId||prev.identity.source!==next.identity.source||prev.identity.startFrame!==next.identity.startFrame||prev.identity.order!==next.identity.order)&&!reviewed)return 'identity_boundary';
  if((prev.imageSource==='manual'||next.imageSource==='manual'||prev.calibration.method==='observed_court_anchor'||next.calibration.method==='observed_court_anchor')&&!reviewed)return 'identity_boundary';
  const sameChain=samePropagatedReference(prev.calibration.provenance,next.calibration.provenance);
  const changed=prev.calibration.referenceOnly!==next.calibration.referenceOnly||
    !sameChain&&(prev.calibration.method!==next.calibration.method||prev.calibration.supportFrames.join(',')!==next.calibration.supportFrames.join(',')||
      JSON.stringify(prev.calibration.provenance)!==JSON.stringify(next.calibration.provenance));
  if(changed&&!reviewed)return 'calibration_boundary';
  return null;
}
function range(startFrame,endFrameExclusive){return {startFrame,endFrameExclusive};}
export function buildActionGeometry(c,action) {
  const paths=[],markers=[],breaks=[],issues=[],unavailableRanges=[];
  const ids={actionId:action.actionId,entityId:action.actorId};
  let segments=[],segment=null,previous=null,waitingReason=null,validCount=0;
  const note=(code,start,end,unavailable=false)=>{
    const r=range(start,end),record={code,...ids,range:r};breaks.push(record);issues.push(issue(code,'warning','segment',ids,r));if(unavailable)unavailableRanges.push(record);
  };
  for(let frame=action.startFrame;frame<action.endFrameExclusive;frame++){
    const {point,reason,projectionReason}=observedPoint(c,action.actorId,frame);
    if(!point){
      if(segment){segment.breakAfter=reason;segments.push(segment);segment=null;}
      waitingReason=reason;previous=null;note(reason,frame,frame+1,true);continue;
    }
    validCount++;
    if(projectionReason)note(projectionReason,frame,frame+1,true);
    const boundary=previous&&boundaryReason(c,action.actorId,previous,point);
    if(boundary){if(segment){segment.breakAfter=boundary;segments.push(segment);segment=null;}waitingReason=boundary;note(boundary,frame-1,frame+1);}
    if(!segment)segment={breakBefore:waitingReason,breakAfter:null,points:[],arrow:false};
    waitingReason=null;segment.points.push(point);previous=point;
  }
  if(segment)segments.push(segment);
  for(const s of segments){
    let travel=0;for(let i=1;i<s.points.length;i++)travel+=Math.hypot(s.points[i].courtPoint.x-s.points[i-1].courtPoint.x,s.points[i].courtPoint.y-s.points[i-1].courtPoint.y);
    s.arrow=MOVEMENT_KINDS.includes(action.kind)&&travel>c.options.stationaryThresholdMetres;
  }
  const coverage=validCount===0?'none':validCount===action.endFrameExclusive-action.startFrame&&!breaks.length?'complete':'partial';
  if(MOVEMENT_KINDS.includes(action.kind))paths.push({actionId:action.actionId,entityId:action.actorId,temporalStatus:action.temporalStatus,
    lineStyle:action.temporalStatus==='pending'?'dashed':'solid',opacity:action.temporalStatus==='completed'?0.3:1,coverage,segments});
  else {
    const frozen=observedPoint(c,action.actorId,c.freezeFrame).point;
    if(frozen)markers.push({kind:'static_role',entityId:action.actorId,actionId:action.actionId,role:action.kind,temporalStatus:action.temporalStatus,position:frozen});
  }
  if(action.temporalStatus==='pending'){
    const first=segments[0]?.points[0];if(first)markers.push({kind:'future_action_start',entityId:action.actorId,actionId:action.actionId,role:action.kind,temporalStatus:'pending',position:first});
  }
  return {paths,markers,breaks,issues,unavailableRanges,coverage,validCount,segments};
}

export function buildScreenRelation(c,relation,temporalStatus) {
  const ids={relationId:relation.id,actionId:relation.actionId,entityId:relation.screenerId},issues=[];
  const q={identity:participantQuality(c,'identity',[relation.screenerId,relation.beneficiaryId,relation.defenderId].filter(Boolean),relation.startFrame,relation.endFrameExclusive),
    position:evidenceQuality(c,'position',{entityId:relation.screenerId},relation.startFrame,relation.endFrameExclusive),
    calibration:evidenceQuality(c,'calibration',{},relation.startFrame,relation.endFrameExclusive),
    tactic:evidenceQuality(c,'tactic',{relationId:relation.id,actionId:relation.actionId},relation.startFrame,relation.endFrameExclusive)};
  let bar=null;
  if(!relation.orientation)issues.push(issue('screen_orientation_missing','warning','relation',ids,range(relation.startFrame,relation.endFrameExclusive)));
  else if(!relation.position)issues.push(issue('missing_position','warning','relation',ids,range(relation.startFrame,relation.endFrameExclusive)));
  else {
    const {x,y,frame}=relation.position,m=c.frames[frame],n=Math.hypot(relation.orientation.x,relation.orientation.y),half=c.options.screenWidthMetres/2;
    const dx=relation.orientation.x/n*half,dy=relation.orientation.y/n*half,court=[{x:x-dx,y:y-dy},{x:x+dx,y:y+dy}];
    const freeze=c.maps[c.freezeFrame],compatible=crossCutCompatible(c,frame),original=c.maps[frame];
    const video=original&&freeze&&compatible?court.map(p=>project(freeze.toImage,p.x,p.y)):null;
    if(!compatible)issues.push(issue('court_reference_mismatch','warning','relation',ids,range(frame,frame+1)));
    if(!original)issues.push(issue('calibration_unavailable','warning','relation',ids,range(frame,frame+1)));
    bar={court,freeze:video?.every(Boolean)?video:null,widthMetres:c.options.screenWidthMetres,displayConvention:true,
      sourceFrame:m.sourceFrame,sourceTime:m.sourceTime,frame,time:m.time,orientation:structuredClone(relation.orientation),
      calibrationFrames:original?.supportFrames??[],referenceId:c.review.court?.referenceId??null};
  }
  for(const [domain,quality] of Object.entries(q))if(quality.state!=='reviewed')issues.push(issue(`${domain==='tactic'?'tactic':domain}_needs_review`,'warning','relation',ids,range(relation.startFrame,relation.endFrameExclusive),{state:quality.state}));
  const invalid=Object.values(q).some(q=>q.state==='invalid');
  if(invalid)bar=null;
  return {relation:{...structuredClone(relation),relationId:relation.id,temporalStatus,quality:q,bar,
    renderability:!bar?'unavailable':issues.length||!bar.freeze?'warning':'ready'},issues};
}
export {COURT};
