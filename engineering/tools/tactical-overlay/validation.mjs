import {canonicalJSON} from './binding.mjs';

export const GEOMETRY_POLICY_VERSION='tactical-geometry-v1';
export const DEFAULT_OPTIONS={previewNextPhase:true,maxStepSeconds:0.2,maxSpeedMetresPerSecond:12,stationaryThresholdMetres:0.10,screenWidthMetres:0.8};
export function issue(code,severity='warning',scope='manifest',ids={},range=null,details={}) {
  return {code,severity,scope,phaseId:null,actionId:null,entityId:null,relationId:null,...ids,range,details};
}
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.length>0;
const frame=v=>Number.isSafeInteger(v)&&v>=0;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const kinds=['move','cut','roll','pop','hold','space','screen'];
const sources=['human_video_review','upstream_supplied'];
const states=['reviewed','needs_review','invalid'];

/** Structural failures are returned before any geometry is evaluated. */
export function validateInputs({review,playDefinition:p,phaseId,freezeFrame,options={}}) {
  const out=[];
  const bad=(field,value)=>out.push(issue('invalid_input','fatal','manifest',{},null,{field,value:value??null}));
  try {canonicalJSON(review);canonicalJSON(p);canonicalJSON(options);} catch(e){return [issue('invalid_input','fatal','manifest',{},null,{reason:e.message})];}
  if(!object(review)||!object(p)||!object(options))return [issue('invalid_input','fatal')];
  if((review.synthetic===true)!==(p.synthetic===true))bad('synthetic',null);
  if(review.schemaVersion!==2||p.schemaVersion!==1)out.push(issue('schema_unsupported','fatal','manifest',{},null,{reviewSchema:review.schemaVersion??null,playSchema:p.schemaVersion??null}));
  if(!Array.isArray(review.sourceFrameMapping)||!review.sourceFrameMapping.length||!Array.isArray(review.entities)) {bad('review',null);return out;}
  const count=review.sourceFrameMapping.length;
  const range=(item,field,min=0,max=count)=>{
    if(!object(item)||!frame(item.startFrame)||!frame(item.endFrameExclusive)||item.startFrame<min||item.endFrameExclusive>max||item.startFrame>=item.endFrameExclusive){bad(field,null);return false;}return true;
  };
  if(!frame(freezeFrame)||freezeFrame>=count)bad('freezeFrame',freezeFrame);
  if(!text(phaseId))bad('phaseId',phaseId);
  for(const dimension of ['width','height'])if(!finite(review[dimension])||review[dimension]<=0)bad(`review.${dimension}`,review[dimension]);
  for(const field of ['videoSha256','sourceVideoSha256','trackingFingerprint','trackingRevision'])if(!text(review[field]))out.push(issue('source_binding_mismatch','fatal','manifest',{},null,{field,reason:'missing_source_identifier'}));
  if(!review.synthetic)for(const field of ['videoSha256','sourceVideoSha256'])if(text(review[field])&&!/^[a-f0-9]{64}$/i.test(review[field]))bad(`review.${field}`,review[field]);
  review.sourceFrameMapping.forEach((m,i)=>{if(!object(m)||m.frame!==i||!frame(m.frame)||!frame(m.sourceFrame)||!finite(m.time)||!finite(m.sourceTime))bad(`sourceFrameMapping[${i}]`,null);});
  for(const list of [review.settings?.cuts,review.settings?.sourceCuts])if(list!==undefined&&!Array.isArray(list))bad('review.settings.cuts',null);
  const cuts=[...(Array.isArray(review.settings?.cuts)?review.settings.cuts:[]),...(Array.isArray(review.settings?.sourceCuts)?review.settings.sourceCuts:[])];
  if(cuts.some(c=>!frame(c)||c>=count))bad('review.settings.cuts',null);
  for(const dimension of ['length','width'])if(review.court?.[dimension]!==undefined&&(!finite(review.court[dimension])||review.court[dimension]<=0))bad(`court.${dimension}`,review.court[dimension]);
  const entities=new Set();
  for(const e of review.entities){
    if(!object(e)||!text(e.id)||entities.has(e.id)||!Array.isArray(e.trajectory)){bad('review.entities',null);continue;}entities.add(e.id);
    if(e.courtTrajectory!==undefined&&!Array.isArray(e.courtTrajectory)){bad(`entity.${e.id}.courtTrajectory`,null);continue;}
    for(const list of [e.trajectory,e.courtTrajectory??[]]){
      const seen=new Set();
      for(const point of list){
        if(!object(point)||!frame(point.frame)||point.frame>=count||seen.has(point.frame)){bad(`entity.${e.id}.trajectory.frame`,null);continue;}seen.add(point.frame);
        if(!((point.x===null&&point.y===null)||(finite(point.x)&&finite(point.y))))bad(`entity.${e.id}.trajectory.coordinates`,null);
        if(!finite(point.time))bad(`entity.${e.id}.trajectory.time`,null);
        if(!['manual','manual_range','tracked','missing','conflict','out_of_view','interpolated','manual_path','projected','court_manual','court_estimated','uncalibrated'].includes(point.source))bad(`entity.${e.id}.trajectory.source`,null);
        if(point.source==='manual_range'&&(!object(point.rangeCorrection)||!['tracked','manual'].includes(point.rangeCorrection.originalSource)||!text(point.rangeCorrection.operationId)||!Array.isArray(point.rangeCorrection.supportFrames)||!point.rangeCorrection.supportFrames.length||point.rangeCorrection.supportFrames.some(f=>!frame(f)||f>=count)))bad(`entity.${e.id}.trajectory.rangeCorrection`,null);
      }
    }
  }
  if(review.court?.calibration){
    const calibration=review.court.calibration;
    if(!object(calibration)||!Array.isArray(calibration.keyframes))bad('court.calibration',null);
    else {
      if(calibration.maxKeyframeGapSeconds!==undefined&&(!finite(calibration.maxKeyframeGapSeconds)||calibration.maxKeyframeGapSeconds<0))bad('court.calibration.maxKeyframeGapSeconds',calibration.maxKeyframeGapSeconds);
      for(const key of calibration.keyframes){
      if(!object(key)||!frame(key.frame)||key.frame>=count)bad('court.calibration.keyframes.frame',null);
      if(key?.cameraSupportFrame!==undefined&&(!frame(key.cameraSupportFrame)||key.cameraSupportFrame>=count))bad('court.calibration.cameraSupportFrame',null);
      for(const reference of ['cameraSupportFrame','referenceFrame'])if(key?.quality?.[reference]!==undefined&&(!frame(key.quality[reference])||key.quality[reference]>=count))bad(`court.calibration.quality.${reference}`,key.quality[reference]);
      if(key?.points!==undefined){
        if(!Array.isArray(key.points)||key.points.some(p=>!object(p)||!text(p.id)||!Array.isArray(p.image)||p.image.length!==2||p.image.some(v=>!finite(v))))bad('court.calibration.points',null);
      }else if(key?.image!==undefined&&(!Array.isArray(key.image)||key.image.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!finite(v)))))bad('court.calibration.image',null);
      }
    }
  }
  if(!text(p.playId)||(!text(p.revision)&&!Number.isSafeInteger(p.revision)))bad('playId/revision',null);
  const playRange=range(p,'playDefinition.range');
  for(const field of ['participants','actions','phases','relations','reviewEvidence'])if(!Array.isArray(p[field]))bad(`playDefinition.${field}`,null);
  if(out.some(i=>i.code==='invalid_input'))return out;
  const index=(array,key,name)=>{const set=new Set();for(const item of array){if(!object(item)||!text(item[key])||set.has(item[key]))bad(name,null);else set.add(item[key]);}return set;};
  const participants=index(p.participants,'id','participants.id'),actions=index(p.actions,'actionId','actions.actionId'),relations=index(p.relations,'id','relations.id');
  index(p.phases,'phaseId','phases.phaseId');
  if(out.some(i=>i.code==='invalid_input'))return out;
  const participant=(id,field)=>{if(!participants.has(id))out.push(issue('undeclared_participant','fatal','manifest',{entityId:typeof id==='string'?id:null},null,{field}));};
  const ref=(id,set,field)=>{if(!set.has(id))out.push(issue('invalid_reference','fatal','manifest',{},null,{field,id:id??null}));};
  const refs=(items,set,field)=>{if(!Array.isArray(items)||new Set(items).size!==items.length){bad(field,null);return;}for(const id of items)ref(id,set,field);};
  for(const a of p.actions){
    if(!object(a))continue;range(a,`action.${a.actionId}.range`,p.startFrame,p.endFrameExclusive);participant(a.actorId,'actorId');
    if(!Array.isArray(a.participantIds)||!a.participantIds.includes(a.actorId))bad('action.participantIds',null);else for(const id of a.participantIds)participant(id,'participantIds');
    if(!kinds.includes(a.kind)||!sources.includes(a.source)||!states.includes(a.reviewStatus))bad('action.kind/source/reviewStatus',null);
  }
  const phases=[...p.phases].sort((a,b)=>(a?.order??0)-(b?.order??0));let end=p.startFrame;const orders=new Set();
  for(const s of phases){
    if(!object(s))continue;range(s,`phase.${s.phaseId}.range`,p.startFrame,p.endFrameExclusive);
    if(!Number.isSafeInteger(s.order)||orders.has(s.order)||s.startFrame!==end||!text(s.title)||!frame(s.freezeFrame)||s.freezeFrame<s.startFrame||s.freezeFrame>=s.endFrameExclusive)bad('phase.order/coverage/freezeFrame',null);
    orders.add(s.order);end=s.endFrameExclusive;
    refs(s.actionIds,actions,'phase.actionIds');refs(s.relationIds,relations,'phase.relationIds');
    if(!Array.isArray(s.participantIds))bad('phase.participantIds',null);else for(const id of s.participantIds)participant(id,'phase.participantIds');
  }
  if(!phases.length||end!==p.endFrameExclusive)bad('phases.coverage',null);
  const phase=p.phases.find(s=>s?.phaseId===phaseId);
  if(!phase)out.push(issue('invalid_reference','fatal','phase',{phaseId:typeof phaseId==='string'?phaseId:null}));
  else if(frame(freezeFrame)&&(freezeFrame<phase.startFrame||freezeFrame>=phase.endFrameExclusive))out.push(issue('phase_frame_mismatch','fatal','phase',{phaseId},null,{freezeFrame}));
  for(const r of p.relations){
    if(!object(r))continue;range(r,`relation.${r.id}.range`,p.startFrame,p.endFrameExclusive);ref(r.actionId,actions,'relation.actionId');
    for(const field of ['screenerId','beneficiaryId'])participant(r[field],`relation.${field}`);if(r.defenderId!==null)participant(r.defenderId,'relation.defenderId');
    if(!sources.includes(r.source)||!states.includes(r.reviewStatus))bad('relation.source/reviewStatus',null);
    if(r.position!==null&&(!object(r.position)||!finite(r.position.x)||!finite(r.position.y)||!frame(r.position.frame)||r.position.frame<r.startFrame||r.position.frame>=r.endFrameExclusive))bad('relation.position',null);
    if(r.orientation!==null&&(!object(r.orientation)||!finite(r.orientation.x)||!finite(r.orientation.y)||Math.hypot(r.orientation.x,r.orientation.y)<1e-9))bad('relation.orientation',null);
    const action=p.actions.find(a=>a.actionId===r.actionId);
    if(action&&(action.kind!=='screen'||action.actorId!==r.screenerId||r.startFrame<action.startFrame||r.endFrameExclusive>action.endFrameExclusive))bad('relation.screen_action',null);
  }
  for(const e of p.reviewEvidence){
    if(!object(e)){bad('reviewEvidence',null);continue;}range(e,'reviewEvidence.range');
    if(!['identity','position','calibration','tactic','continuity'].includes(e.domain)||!states.includes(e.conclusion))bad('reviewEvidence.domain/conclusion',null);
    for(const [key,set] of [['entityId',participants],['actionId',actions],['relationId',relations]])if(e[key]!==null)ref(e[key],set,`reviewEvidence.${key}`);
    if(!Array.isArray(e.sourceFrames)||e.sourceFrames.some(f=>!frame(f)||f>=count)||typeof e.reviewer!=='string'||typeof e.method!=='string')bad('reviewEvidence.sourceFrames/reviewer/method',null);
    if(e.conclusion==='reviewed'&&(!e.reviewer.trim()||!e.method.trim()||!e.sourceFrames.length))bad('reviewEvidence.reviewed',null);
    if(['identity','position','continuity'].includes(e.domain)&&!text(e.entityId))bad('reviewEvidence.entityId',null);
    if(e.domain==='tactic'&&e.actionId===null&&e.relationId===null)bad('reviewEvidence.tactic_reference',null);
  }
  for(const key of Object.keys(options))if(!(key in DEFAULT_OPTIONS))bad(`options.${key}`,null);
  if(options.previewNextPhase!==undefined&&typeof options.previewNextPhase!=='boolean')bad('options.previewNextPhase',null);
  for(const key of ['maxStepSeconds','maxSpeedMetresPerSecond','stationaryThresholdMetres','screenWidthMetres'])if(options[key]!==undefined&&(!finite(options[key])||options[key]<0||(key!=='stationaryThresholdMetres'&&options[key]===0)))bad(`options.${key}`,null);
  if(!object(p.sourceBinding)||p.sourceBinding.digestVersion!=='canonical-json-v1')out.push(issue('source_binding_mismatch','fatal','manifest',{},null,{reason:'missing_or_unsupported_binding'}));
  return out;
}

export function evidenceQuality(context,domain,ids,startFrame,endFrameExclusive) {
  const matches=context.playDefinition.reviewEvidence.filter(e=>e.domain===domain&&
    (domain==='tactic'
      ?(e.actionId!==null&&e.actionId===ids.actionId)||(e.relationId!==null&&e.relationId===ids.relationId)
      :(e.entityId===null||e.entityId===ids.entityId)&&(e.actionId===null||e.actionId===ids.actionId)&&(e.relationId===null||e.relationId===ids.relationId)));
  const invalid=matches.filter(e=>e.conclusion==='invalid'&&e.startFrame<endFrameExclusive&&e.endFrameExclusive>startFrame);
  const reviewed=matches.filter(e=>e.conclusion==='reviewed'&&e.startFrame<=startFrame&&e.endFrameExclusive>=endFrameExclusive);
  const declaration=domain==='tactic'?(ids.relationId?context.playDefinition.relations.find(r=>r.id===ids.relationId):context.playDefinition.actions.find(a=>a.actionId===ids.actionId)):null;
  const state=invalid.length||declaration?.reviewStatus==='invalid'?'invalid':reviewed.length&&declaration?.reviewStatus!=='needs_review'?'reviewed':'needs_review';
  return {state,reasons:state==='reviewed'?[]:[state==='invalid'?'explicit_invalid_evidence':'reviewed_interval_evidence_missing'],evidence:structuredClone(invalid.length?invalid:reviewed.length?reviewed:matches)};
}

export function participantQuality(context,domain,participants,startFrame,endFrameExclusive) {
  const values=participants.map(entityId=>evidenceQuality(context,domain,{entityId},startFrame,endFrameExclusive));
  return {state:values.some(q=>q.state==='invalid')?'invalid':values.some(q=>q.state==='needs_review')?'needs_review':'reviewed',
    reasons:[...new Set(values.flatMap(q=>q.reasons))],evidence:values.flatMap(q=>q.evidence)};
}
