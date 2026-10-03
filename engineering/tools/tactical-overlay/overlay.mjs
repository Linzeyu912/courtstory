import {canonicalJSON,createSourceBinding} from './binding.mjs';
import {validateInputs,issue,evidenceQuality,participantQuality,DEFAULT_OPTIONS,GEOMETRY_POLICY_VERSION} from './validation.mjs';
import {createGeometryContext,observedPoint,buildActionGeometry,buildScreenRelation,COURT} from './geometry.mjs';

const timeStatus=(a,frame)=>frame<a.startFrame?'pending':frame>=a.endFrameExclusive?'completed':'active';
const range=a=>({startFrame:a.startFrame,endFrameExclusive:a.endFrameExclusive});
function actionQuality(c,a) {
  return {identity:participantQuality(c,'identity',a.participantIds,a.startFrame,a.endFrameExclusive),
    position:participantQuality(c,'position',a.participantIds,a.startFrame,a.endFrameExclusive),
    calibration:evidenceQuality(c,'calibration',{},a.startFrame,a.endFrameExclusive),
    tactic:evidenceQuality(c,'tactic',{actionId:a.actionId},a.startFrame,a.endFrameExclusive)};
}
function qualityIssues(q,scope,ids,r) {
  return Object.entries(q).filter(([,v])=>!['reviewed','not_applicable'].includes(v.state)).map(([domain,v])=>issue(`${domain}_needs_review`,'warning',scope,ids,r,{state:v.state}));
}
const notApplicable=()=>({state:'not_applicable',reasons:[],evidence:[]});

/** Pure deterministic async adapter from saved schema 2 to frozen-frame manifest v1. */
export async function buildTacticalOverlay(input={}) {
  const {review,playDefinition:p,phaseId,freezeFrame,options={}}=input;
  const refused=issues=>({schemaVersion:1,geometryPolicyVersion:GEOMETRY_POLICY_VERSION,phaseId:typeof phaseId==='string'?phaseId:null,
    freezeFrame:Number.isSafeInteger(freezeFrame)?freezeFrame:null,status:'refused',issues,
    roster:[],highlightedParticipantIds:[],actions:[],paths:[],markers:[],relations:[],breaks:[],unavailableRanges:[]});
  const issues=validateInputs({review,playDefinition:p,phaseId,freezeFrame,options});
  if(issues.some(i=>i.severity==='fatal'))return refused(issues);
  let sourceBinding;
  try {sourceBinding=await createSourceBinding(review);}catch(e){return refused([issue('invalid_input','fatal','manifest',{},null,{reason:e.message})]);}
  const differences=Object.keys(sourceBinding).filter(key=>p.sourceBinding[key]!==sourceBinding[key]);
  if(differences.length)return refused([issue('source_binding_mismatch','fatal','manifest',{},null,{fields:differences})]);
  const config={...DEFAULT_OPTIONS,...options},c=createGeometryContext(review,p,freezeFrame,config);
  const phases=[...p.phases].sort((a,b)=>a.order-b.order),selected=phases.findIndex(s=>s.phaseId===phaseId);
  const displayed=phases.slice(selected,selected+(config.previewNextPhase?2:1));
  const actionIds=new Set(displayed.flatMap(s=>s.actionIds)),relationIds=new Set(displayed.flatMap(s=>s.relationIds));
  // Referenced relationships also require their screen action and all relationship participants.
  const displayedRelations=p.relations.filter(r=>relationIds.has(r.id));for(const r of displayedRelations)actionIds.add(r.actionId);
  const displayedActions=p.actions.filter(a=>actionIds.has(a.actionId));
  const highlighted=new Set([...displayed.flatMap(s=>s.participantIds),...displayedActions.flatMap(a=>a.participantIds),
    ...displayedRelations.flatMap(r=>[r.screenerId,r.beneficiaryId,r.defenderId].filter(Boolean))]);
  const paths=[],markers=[],breaks=[],unavailableRanges=[],actions=[];
  const roster=p.participants.map(participant=>{
    const e=c.entityMap.get(participant.id),raw=c.pointMaps.get(participant.id)?.get(freezeFrame);
    const performed=displayedActions.filter(a=>a.actorId===participant.id);
    const relationStates=displayedRelations.flatMap(r=>[
      ['screener',r.screenerId],['beneficiary',r.beneficiaryId],['defender',r.defenderId]
    ].filter(([,id])=>id===participant.id).map(([role])=>({relationId:r.id,actionId:r.actionId,role,
      temporalStatus:timeStatus(r,freezeFrame),screenerId:r.screenerId,beneficiaryId:r.beneficiaryId,defenderId:r.defenderId??null})));
    const item={...structuredClone(participant),id:participant.id,highlighted:highlighted.has(participant.id),
      roles:[...new Set([participant.role,...performed.map(a=>a.kind)].filter(Boolean))],
      actionStates:performed.map(a=>({actionId:a.actionId,kind:a.kind,temporalStatus:timeStatus(a,freezeFrame)})),relationStates,
      positionState:'missing',position:null,renderability:'unavailable',quality:{identity:notApplicable(),position:notApplicable(),calibration:notApplicable(),tactic:notApplicable()}};
    if(!e){issues.push(issue('entity_missing_from_review','warning','participant',{entityId:participant.id}));return item;}
    const found=observedPoint(c,participant.id,freezeFrame);item.position=found.point;
    item.positionState=raw?.source==='out_of_view'?'offscreen':found.point||raw&&Number.isFinite(raw.x)&&Number.isFinite(raw.y)&&['manual','tracked'].includes(raw.source)?'visible':'missing';
    item.quality={identity:evidenceQuality(c,'identity',{entityId:participant.id},freezeFrame,freezeFrame+1),
      position:evidenceQuality(c,'position',{entityId:participant.id},freezeFrame,freezeFrame+1),
      calibration:evidenceQuality(c,'calibration',{},freezeFrame,freezeFrame+1),tactic:notApplicable()};
    const qIssues=qualityIssues(item.quality,'participant',{entityId:participant.id},{startFrame:freezeFrame,endFrameExclusive:freezeFrame+1});issues.push(...qIssues);
    if(found.reason)issues.push(issue(found.reason,'warning','participant',{entityId:participant.id},{startFrame:freezeFrame,endFrameExclusive:freezeFrame+1}));
    item.renderability=!found.point?'unavailable':qIssues.length||!found.point.freezePoint?'warning':'ready';
    if(found.point)markers.push({kind:'freeze_position',entityId:participant.id,actionId:null,position:found.point,renderability:item.renderability,quality:structuredClone(item.quality)});
    return item;
  });
  if(!c.maps[freezeFrame])issues.push(issue('freeze_calibration_unavailable','warning','manifest',{}, {startFrame:freezeFrame,endFrameExclusive:freezeFrame+1}));
  for(const original of displayedActions){
    const a={...structuredClone(original),temporalStatus:timeStatus(original,freezeFrame)},quality=actionQuality(c,a);
    const result=buildActionGeometry(c,a);issues.push(...result.issues,...qualityIssues(quality,'action',{actionId:a.actionId,entityId:a.actorId},range(a)));
    let renderability=result.coverage==='none'?'unavailable':Object.values(quality).some(q=>q.state==='invalid')?'unavailable':
      result.coverage!=='complete'||Object.values(quality).some(q=>q.state==='needs_review')||!c.maps[freezeFrame]?'warning':'ready';
    a.quality=quality;a.renderability=renderability;a.coverage=result.coverage;actions.push(a);
    paths.push(...result.paths.map(path=>({...path,renderability,quality:structuredClone(quality)})));
    markers.push(...result.markers.map(marker=>({...marker,renderability,quality:structuredClone(quality)})));breaks.push(...result.breaks);unavailableRanges.push(...result.unavailableRanges);
  }
  const relations=displayedRelations.map(r=>{const result=buildScreenRelation(c,r,timeStatus(r,freezeFrame));issues.push(...result.issues);return result.relation;});
  const m=c.frames[freezeFrame];
  const hasCourt=paths.some(p=>p.segments.some(s=>s.points.length))||markers.some(m=>m.position?.courtPoint)||relations.some(r=>r.bar);
  const partial=issues.some(i=>i.severity==='warning')||roster.some(p=>p.renderability!=='ready')||actions.some(a=>a.renderability!=='ready'||a.coverage!=='complete')||relations.some(r=>r.renderability!=='ready');
  return {schemaVersion:1,geometryPolicyVersion:GEOMETRY_POLICY_VERSION,synthetic:review.synthetic===true&&p.synthetic===true,
    sourceBinding,playId:p.playId,playRevision:p.revision,phaseId,freezeFrame,sourceFrame:m.sourceFrame,sourceTime:m.sourceTime,time:m.time,
    status:partial?'partial':'ok',issues,roster,highlightedParticipantIds:p.participants.filter(p=>highlighted.has(p.id)).map(p=>p.id),
    actions,paths,markers,relations,breaks,unavailableRanges,geometryPolicy:config,
    videoOverlay:{available:Boolean(c.maps[freezeFrame]),width:review.width,height:review.height,coordinateSystem:'image_pixels',freezeFrame,
      calibration:c.maps[freezeFrame]?{method:c.maps[freezeFrame].method,supportFrames:c.maps[freezeFrame].supportFrames,referenceOnly:c.maps[freezeFrame].referenceOnly}:null},
    court2d:{available:Boolean(hasCourt),coordinateSystem:'court_metres',length:review.court?.length??COURT.length,width:review.court?.width??COURT.width,
      template:review.court?.template??null,metricAccuracyValidated:review.court?.metricAccuracyValidated===true},
    styleHints:{units:'CSS px',lineWidth:6,arrowHeadSize:18,outlineWidth:2,completedOpacity:0.3,screenWidthMetres:config.screenWidthMetres}};
}
