/** Private JSON bridge. The runner resolves registered assets; this module never reads client paths. */
import {pathToFileURL} from 'node:url';
import {createTacticsDocument,validateDocument} from '../player-review/tactics-document.mjs';
import {createAnnotation,projectAnnotations,playerFoot,sampleAnnotationCurve} from '../player-review/tactics-annotations.mjs';
import {createManualAnnotation} from '../player-review/tactics-manual-editor.mjs';
import {upsertTacticKeyframe} from '../player-review/tactics-keyframes.mjs';
import {compileProduction,renderProductionSvg} from '../player-review/tactics-production.mjs';
import {calibrationAt,project,COURT} from '../player-review/court.mjs';
import {SCHEMA_VERSION,TOOL_VERSION,clone,digest,equal,finite,integer,text,BridgeError,requireThat,exact,frameRange,frames,points,contains,bindSource,validateEvidence,validateInventory,locatable,withinParticipantLocation,participantLocatable} from './contracts.mjs';

const TYPES=['spotlight','screen','route'];
const INTENTS=['reference_frame','fixed_interval','declared_player_follow','court_projection'];
const SEMANTICS=['body_point','foot_candidate','ground_point'];
const RANGE=document=>({startFrame:document.playDefinition.startFrame,endFrameExclusive:document.playDefinition.endFrameExclusive});
const frameInfo=(document,assetFrame)=>({assetFrame,sourceFrame:document.review.sourceFrameMapping[assetFrame].sourceFrame,pts:document.review.sourceFrameMapping[assetFrame].time});
const asPoint=sample=>({x:sample.position[0],y:sample.position[1]});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const pixelTolerance=document=>8*document.review.height/720;
function distanceToPath(point,path){
  let best=Infinity;
  for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0;best=Math.min(best,distance(point,{x:a.x+t*dx,y:a.y+t*dy}));}
  return best;
}
const optionalShared=['calibration','cameraEvidence'];

async function nativeDocument(document){
  // Extra semantic/model fields belong in sidecars, including on native annotation records.
  exact(document,['schemaVersion','title','notes','review','playDefinition'],['annotations','production','presentation','tacticKeyframes','legacyTiming','archivedTactics'],'native document');
  await validateDocument(document);return document;
}

export async function createBaseline(request){
  exact(request,['operation','review','range'],['sourceRef','snapshotId'],'create_baseline');
  const document=await createTacticsDocument(request.review);
  requireThat(document.schemaVersion===2,'A decoded mediaEndTime is required for a V2 baseline');
  frameRange(request.range,document.review.sourceFrameMapping.length);
  document.playDefinition.startFrame=request.range.startFrame;document.playDefinition.endFrameExclusive=request.range.endFrameExclusive;
  Object.assign(document.playDefinition.phases[0],request.range,{freezeFrame:request.range.startFrame});
  await nativeDocument(document);
  const binding=document.playDefinition.sourceBinding;
  const sourceRef=request.sourceRef??{videoSha256:binding.videoSha256,trackingFingerprint:binding.trackingFingerprint,trackingRevision:binding.trackingRevision,frameMappingDigest:binding.frameMappingDigest,snapshotId:request.snapshotId,reviewDigest:binding.reviewDigest};
  await bindSource(document,sourceRef);
  return {document,documentDigest:digest(document),sourceBinding:binding,sourceRef:clone(sourceRef)};
}

function validateAnalysis(analysis,inventory,document){
  exact(analysis,['schemaVersion','analysisRevision','phases','annotationIntents'],['relations','sourceRef','summary','range','issues','unmetRequirements'],'playAnalysis');
  requireThat(analysis.schemaVersion===SCHEMA_VERSION,'Unsupported analysis schema','unsupported_schema');
  requireThat(analysis.analysisRevision===inventory.analysisRevision,'Frozen inventory revision changed','source_mismatch');
  requireThat(Array.isArray(analysis.phases)&&analysis.phases.length===inventory.phases.length,'Analysis phases differ from frozen inventory','source_mismatch');
  if(analysis.range!==undefined)requireThat(equal(analysis.range,RANGE(document)),'Analysis range differs from the requested range','source_mismatch');
  for(const key of ['issues','unmetRequirements'])if(analysis[key]!==undefined)requireThat(Array.isArray(analysis[key]),`${key} must be an array`);
  const count=document.review.sourceFrameMapping.length,actions=new Map();
  for(const [index,phase] of analysis.phases.entries()){
    exact(phase,['id','range','evidenceFrames','participants','actions'],['annotationIntents','title','summary'],'analysis phase');
    const frozen=inventory.phases[index];
    requireThat(phase.id===frozen.phaseId&&equal(phase.range,frozen.range)&&equal(phase.participants,frozen.participants),'Analysis participants differ from frozen inventory','source_mismatch');
    frames(phase.evidenceFrames,count,'analysis phase evidenceFrames');
    requireThat(Array.isArray(phase.actions),'Analysis actions must be an array');
    for(const action of phase.actions){
      exact(action,['actionId','playerId','kind','range','evidenceFrames','observationStatus'],['evidenceRefs','summary'],'observed action');
      requireThat(text(action.actionId)&&!actions.has(action.actionId)&&frozen.participants.some(p=>p.playerId===action.playerId),'Unknown/duplicate action actor');
      requireThat(['move','cut','roll','pop','screen','hold','space'].includes(action.kind)&&['observed','estimated','unknown'].includes(action.observationStatus),'Invalid action kind/status');
      frameRange(action.range,count,'action range',phase.range);frames(action.evidenceFrames,count,'action evidenceFrames');actions.set(action.actionId,{...action,phaseId:phase.id});
    }
  }
  requireThat(Array.isArray(analysis.annotationIntents)&&analysis.annotationIntents.length<=256,'Invalid annotation intent list');
  // Nested copies are optional for readers, but cannot become a conflicting second instructions list.
  for(const phase of analysis.phases)if(phase.annotationIntents!==undefined){
    requireThat(Array.isArray(phase.annotationIntents),'Phase intents must be an array');
    for(const intent of phase.annotationIntents)requireThat(analysis.annotationIntents.some(item=>equal(intent,item)),'Nested and global annotation intents differ');
  }
  if(analysis.relations!==undefined)requireThat(Array.isArray(analysis.relations),'relations must be an array');
  return actions;
}

function validateIntent(intent,document,inventory,actions){
  exact(intent,['intentId','phaseId','playerId','type','displayIntent','range','anchorFrame','sourceSpace','anchorSemantics','evidenceFrames','evidenceRefs','actionId'],['points','style','meaning','cameraEvidenceRef','calibrationRef'],'annotation intent');
  requireThat(text(intent.intentId)&&TYPES.includes(intent.type)&&INTENTS.includes(intent.displayIntent)&&SEMANTICS.includes(intent.anchorSemantics),'Invalid annotation type/display/anchor semantics');
  const phase=inventory.phases.find(p=>p.phaseId===intent.phaseId);
  const participant=phase?.participants.find(p=>p.playerId===intent.playerId);
  requireThat(participant,'Intent must target a frozen phase participant');
  const count=document.review.sourceFrameMapping.length;
  frameRange(intent.range,count,'intent range',phase.range);
  requireThat(integer(intent.anchorFrame)&&contains(intent.range,intent.anchorFrame),'Intent anchorFrame must be inside its half-open display range');
  frames(intent.evidenceFrames,count,'intent evidenceFrames');
  const requireConfirmed=f=>requireThat(withinParticipantLocation(participant,f),'Intent uses a frame outside the frozen identity-confirmed location ranges','identity_conflict',{affectedRanges:[{startFrame:f,endFrameExclusive:f+1}]});
  requireConfirmed(intent.anchorFrame);for(const f of intent.evidenceFrames)requireConfirmed(f);
  requireThat(Array.isArray(intent.evidenceRefs)&&intent.evidenceRefs.length>0&&intent.evidenceRefs.every(text),'Intent evidenceRefs are required');
  requireThat(['image_pixels','court_meters'].includes(intent.sourceSpace),'Invalid intent sourceSpace');
  if(intent.points)points(intent.points,intent.type);
  if(intent.style){exact(intent.style,[],['angle','size','color','pattern'],'intent style');if(intent.style.pattern!==undefined)requireThat(intent.type==='route'&&['solid','dashed'].includes(intent.style.pattern),'Only current or later observed route patterns are supported');}
  if(intent.meaning!==undefined)requireThat(['current_action','later_observed_action','screen','focus'].includes(intent.meaning),'Unsupported annotation meaning');
  requireThat(intent.actionId===null||text(intent.actionId),'actionId must be null or an action ID');
  if(intent.actionId!==null){const action=actions.get(intent.actionId);requireThat(action&&action.playerId===intent.playerId&&action.phaseId===intent.phaseId,'Intent action is absent or bound to another person');for(const f of action.evidenceFrames)requireConfirmed(f);}
  if(intent.type==='route'){
    const action=actions.get(intent.actionId);
    requireThat(action&&['move','cut','roll','pop'].includes(action.kind)&&action.observationStatus==='observed'&&action.evidenceFrames.length>=2,'Routes require an observed movement action','projection_invalid');
    for(let f=action.range.startFrame;f<action.range.endFrameExclusive;f++)requireConfirmed(f);
    requireThat(intent.points,'Routes need explicit evidence-supported points');
    requireThat((intent.style?.pattern??'solid')!=='dashed'||intent.meaning==='later_observed_action','Dashed means later_observed_action, never pass, prediction or uncertainty','projection_invalid');
    requireThat((intent.style?.pattern??'solid')!=='solid'||intent.meaning===undefined||intent.meaning==='current_action','Solid routes represent current_action','projection_invalid');
    if(intent.meaning==='later_observed_action')requireThat(Math.min(...action.evidenceFrames)>intent.anchorFrame,'Later observed action must be evidenced after its reference frame','projection_invalid');
  }else if(intent.type==='screen'){
    const action=actions.get(intent.actionId);
    requireThat(action?.kind==='screen'&&action.observationStatus==='observed','Screen markers require an observed screen action','projection_invalid');
  }
  if(intent.displayIntent==='declared_player_follow'){
    requireThat(intent.type==='spotlight'&&intent.sourceSpace==='image_pixels'&&intent.anchorSemantics!=='body_point','Native player follow only supports declared foot/ground spotlight evidence','capability_unavailable');
    for(let f=intent.range.startFrame;f<intent.range.endFrameExclusive;f++)requireConfirmed(f);
  }
  if(intent.sourceSpace==='court_meters'||intent.displayIntent==='court_projection')requireThat(intent.sourceSpace==='court_meters'&&intent.displayIntent==='court_projection'&&intent.anchorSemantics!=='body_point','Court projection requires explicit metric ground coordinates','capability_unavailable');
  return participant;
}

function cameraProof(intent,request,document,action){
  if(intent.type!=='route'||intent.displayIntent==='court_projection')return;
  const proof=request.cameraEvidence?.find(item=>item.ref===intent.cameraEvidenceRef);
  requireThat(proof,'Cross-frame image routes require measured camera alignment evidence','geometry_unreliable');
  exact(proof,['ref','sourceRef','range','evidenceFrames','evidenceRefs','method','maxResidualPixels','tolerancePixels','independentCheck','checkPointCount'],[],'camera evidence');
  requireThat(equal(proof.sourceRef,request.sourceRef),'Camera evidence source changed','source_mismatch');
  frameRange(proof.range,document.review.sourceFrameMapping.length,'camera evidence range');
  frames(proof.evidenceFrames,document.review.sourceFrameMapping.length,'camera evidenceFrames');
  const checkedFrames=[intent.anchorFrame,...intent.evidenceFrames,...action.evidenceFrames];
  requireThat(proof.method==='stationary_camera_validation'&&proof.independentCheck===true&&integer(proof.checkPointCount)&&proof.checkPointCount>=4&&Array.isArray(proof.evidenceRefs)&&proof.evidenceRefs.length>0&&proof.evidenceRefs.every(text),'Unsupported or unverified camera evidence','geometry_unreliable');
  requireThat(finite(proof.maxResidualPixels)&&proof.maxResidualPixels>=0&&finite(proof.tolerancePixels)&&proof.tolerancePixels>0&&proof.tolerancePixels<=pixelTolerance(document)&&proof.maxResidualPixels<=proof.tolerancePixels,'Camera residual exceeds the policy tolerance','geometry_unreliable');
  requireThat(checkedFrames.every(f=>contains(proof.range,f)&&proof.evidenceFrames.includes(f)),'Camera evidence does not cover every route observation/reference frame','geometry_unreliable');
  requireThat(proof.range.startFrame<=intent.range.startFrame&&proof.range.endFrameExclusive>=intent.range.endFrameExclusive,'Camera evidence does not cover the displayed range','geometry_unreliable');
}

function geometryProof(intent,request,document){
  if(intent.displayIntent!=='court_projection')return null;
  const proof=request.calibration;
  requireThat(proof,'Court projection needs independent calibrated geometry','geometry_unreliable');
  exact(proof,['ref','sourceRef','range','sourceSpace','courtTemplateRef','units','origin','axes','independentChecks'],[],'calibration proof');
  requireThat(proof.ref===intent.calibrationRef&&equal(proof.sourceRef,request.sourceRef),'Calibration source/reference changed','source_mismatch');
  frameRange(proof.range,document.review.sourceFrameMapping.length,'calibration range');
  exact(proof.axes,['x','y'],[],'court axes');
  requireThat(proof.sourceSpace==='court_meters'&&proof.courtTemplateRef===COURT.template&&proof.units===COURT.units&&proof.origin===COURT.origin&&proof.axes.x==='toward_right_baseline'&&proof.axes.y==='toward_near_sideline','Only the explicit native NBA metric convention is supported','capability_unavailable');
  requireThat(proof.range.startFrame<=intent.range.startFrame&&proof.range.endFrameExclusive>=intent.range.endFrameExclusive,'Calibration does not cover the intent','geometry_unreliable');
  requireThat(Array.isArray(proof.independentChecks)&&proof.independentChecks.length>0,'Independent field-line/control holdout checks are required','geometry_unreliable');
  const checks=new Map();
  for(const check of proof.independentChecks){
    exact(check,['assetFrame','evidenceRef','residualPixels','pointCount'],[],'calibration independent check');
    requireThat(integer(check.assetFrame)&&text(check.evidenceRef)&&finite(check.residualPixels)&&check.residualPixels>=0&&check.residualPixels<=pixelTolerance(document)&&integer(check.pointCount)&&check.pointCount>=4,'Invalid independent calibration check','geometry_unreliable');checks.set(check.assetFrame,check);
  }
  for(let f=intent.range.startFrame;f<intent.range.endFrameExclusive;f++)requireThat(checks.has(f)&&calibrationAt(document.review.court?.calibration,f,document.review.sourceFrameMapping,document.review.settings?.cuts??[]),'Missing per-frame calibration or independent reprojection check','geometry_unreliable',{affectedRanges:[{startFrame:f,endFrameExclusive:f+1}]});
  return {sourceSpace:'court_meters',nativeSpace:'court',units:'metres',scaleX:1,scaleY:1,offsetX:0,offsetY:0,origin:COURT.origin};
}

function locatePoints(intent,evidenceIndex,document,action){
  const player=evidenceIndex.get(intent.playerId),sample=player.samples.get(intent.anchorFrame);
  requireThat(locatable(sample),'Annotation reference frame needs a visible observed location','tracking_gap');
  requireThat(sample.sourceSpace===intent.sourceSpace&&sample.anchorSemantics===intent.anchorSemantics,'Intent coordinate semantics differ from the actual observation','projection_invalid');
  requireThat(intent.evidenceFrames.includes(intent.anchorFrame)&&intent.evidenceRefs.includes(sample.evidenceRef),'Intent must cite its reference observation','projection_invalid');
  for(const f of intent.evidenceFrames){const sample=player.samples.get(f);requireThat(locatable(sample)&&sample.sourceSpace===intent.sourceSpace&&sample.anchorSemantics===intent.anchorSemantics,'Intent cites an unavailable/estimated/incompatible position','projection_invalid');}
  const actual=intent.points??[asPoint(sample)];
  const bound=intent.sourceSpace==='image_pixels'?{x:document.review.width,y:document.review.height}:{x:COURT.length,y:COURT.width};
  requireThat(actual.every(p=>p.x>=0&&p.y>=0&&p.x<=bound.x&&p.y<=bound.y),'Annotation points lie outside the declared coordinate space','projection_invalid');
  const tolerance=intent.sourceSpace==='image_pixels'?pixelTolerance(document):.12;
  if(intent.type!=='route')requireThat(distance(actual[0],asPoint(sample))<=tolerance,'Marker is not bound to the supplied participant location','projection_invalid');
  else {
    const samples=action.evidenceFrames.map(f=>player.samples.get(f));
    requireThat(samples.every(s=>locatable(s)&&s.sourceSpace===intent.sourceSpace&&s.anchorSemantics===intent.anchorSemantics&&contains(action.range,s.assetFrame)),'Route movement contains unknown, estimated or incompatible observations','projection_invalid');
    requireThat(samples.every(s=>intent.evidenceFrames.includes(s.assetFrame)),'Route must include each movement evidence frame','projection_invalid');
    const sorted=[...samples].sort((a,b)=>a.assetFrame-b.assetFrame),start=asPoint(sorted[0]),end=asPoint(sorted.at(-1));
    requireThat(distance(start,end)>tolerance&&distance(actual[0],start)<=tolerance&&distance(actual.at(-1),end)<=tolerance,'Route endpoints are unsupported or stationary','projection_invalid');
    // Handles are not observations: independently constrain the rendered curve to the complete
    // observed movement. Checking endpoints alone would admit arbitrarily fabricated detours.
    const observed=[];
    for(let f=action.range.startFrame;f<action.range.endFrameExclusive;f++){
      const record=player.samples.get(f);
      requireThat(locatable(record)&&record.sourceSpace===intent.sourceSpace&&record.anchorSemantics===intent.anchorSemantics,'A route cannot bridge an unknown or estimated movement interval','tracking_gap',{affectedRanges:[{startFrame:f,endFrameExclusive:f+1}]});
      observed.push(asPoint(record));
    }
    const curve=sampleAnnotationCurve({points:actual,curve:actual.length===4?'cubic_bezier':'polyline'});
    requireThat(curve.every(p=>distanceToPath(p,observed)<=tolerance)&&observed.every(p=>distanceToPath(p,curve)<=tolerance),'Rendered route leaves the observed movement corridor','projection_invalid');
    requireThat(!(document.review.settings?.cuts??[]).some(f=>f>Math.min(intent.anchorFrame,...action.evidenceFrames)&&f<=Math.max(intent.anchorFrame,...action.evidenceFrames)),'Routes cannot cross a camera cut','geometry_unreliable');
  }
  if(intent.displayIntent==='declared_player_follow'){
    for(let f=intent.range.startFrame;f<intent.range.endFrameExclusive;f++){
      const record=player.samples.get(f),foot=playerFoot(document,intent.playerId,f,{phaseId:intent.phaseId});
      requireThat(locatable(record)&&record.anchorSemantics!=='body_point'&&record.sourceMethod!=='tapir'&&record.sourceSpace==='image_pixels'&&foot.point&&distance(asPoint(record),foot.point)<=pixelTolerance(document),'Native follow needs compatible observed native feet for every displayed frame','tracking_gap',{affectedRanges:[{startFrame:f,endFrameExclusive:f+1}]});
    }
  }
  return actual;
}

function nativeInput(intent,actual,jobId){
  return {id:`ann-${intent.intentId}`,type:intent.type,entityId:intent.playerId,phaseId:intent.phaseId,frame:intent.anchorFrame,...intent.range,space:intent.sourceSpace==='court_meters'?'court':'video',points:actual,followEntity:intent.displayIntent==='declared_player_follow',style:intent.style??{},origin:{kind:'agent',jobId,sourceFrames:intent.evidenceFrames.slice(0,40),note:'Evidence-backed agent workflow; roles and provenance remain in sidecars.'},...(intent.displayIntent==='declared_player_follow'?{anchorMode:'player_foot',offset:{x:0,y:0}}:{})};
}

export async function buildPlayerAnnotations(request){
  exact(request,['operation','document','sourceRef','playerEvidence','playAnalysis','participantInventory'],['fps','jobId','profile',...optionalShared],'build_player_annotations');
  requireThat(request.profile===undefined||request.profile==='richer_players_v1','Unsupported annotation profile','capability_unavailable');
  await nativeDocument(request.document);await bindSource(request.document,request.sourceRef);
  let document=clone(request.document);const range=RANGE(document),evidenceIndex=validateEvidence(request.playerEvidence,document,request.sourceRef,range);
  const inventoryDigest=validateInventory(request.participantInventory,document,range,evidenceIndex,request.sourceRef),actions=validateAnalysis(request.playAnalysis,request.participantInventory,document);
  if(request.playAnalysis.sourceRef)requireThat(equal(request.playAnalysis.sourceRef,request.sourceRef),'Analysis source changed','source_mismatch');
  requireThat(!document.annotations?.items.length&&!document.production&&!document.tacticKeyframes?.items.length&&!document.playDefinition.actions.length&&!document.playDefinition.relations.length,'Build requires a fresh derived baseline; existing user drawings must remain preserved','version_conflict');
  document.playDefinition.phases=request.participantInventory.phases.map((phase,order)=>({phaseId:phase.phaseId,order,title:phase.title??`阶段 ${order+1}`,...phase.range,freezeFrame:phase.range.startFrame,participantIds:phase.participants.map(p=>p.playerId),actionIds:[],relationIds:[]}));
  await nativeDocument(document);
  const entries=[],ids=new Set(),transforms=[],cueGroups=new Map(),warnings=[];
  const jobId=request.jobId??'agent-tactics';requireThat(text(jobId),'jobId is required');
  for(const intent of request.playAnalysis.annotationIntents){
    validateIntent(intent,document,request.participantInventory,actions);requireThat(!ids.has(intent.intentId),'Duplicate intentId');ids.add(intent.intentId);
    const action=actions.get(intent.actionId);cameraProof(intent,request,document,action);const transform=geometryProof(intent,request,document);
    if(transform)transforms.push({intentId:intent.intentId,...transform});
    const actual=locatePoints(intent,evidenceIndex,document,action),input=nativeInput(intent,actual,jobId);
    const meaning=intent.meaning??(intent.type==='route'?'current_action':intent.type==='screen'?'screen':'focus');
    if(intent.displayIntent==='fixed_interval'){
      // Factory computes the native legal fixed/manual/referenceSize fields. Correct dashed semantics
      // are then supplied to createAnnotation, never through the human-edit update interface.
      const draft=createManualAnnotation(document,{...input,range:intent.range,pattern:intent.style?.pattern??'solid'});
      const normalized=draft.annotations.items.at(-1);
      const actionRange=clone(action?.range??normalized.actionRange);
      document=createAnnotation(document,{...input,points:normalized.points,style:normalized.style,timingMode:normalized.timingMode,videoMode:normalized.videoMode,referenceSize:normalized.referenceSize,actionRange,cueFrame:normalized.cueFrame,displayMode:normalized.displayMode,curve:normalized.curve,progressFrames:[{frame:actionRange.startFrame,t:0},{frame:actionRange.endFrameExclusive,t:1}],meaning});
    }else if(intent.displayIntent==='court_projection'){
      let actualPoints=actual;
      if(intent.type==='route'&&actual.length===2&&(intent.style?.pattern??'solid')==='solid'){const [a,b]=actual;actualPoints=[a,{x:a.x+(b.x-a.x)/3,y:a.y+(b.y-a.y)/3},{x:a.x+2*(b.x-a.x)/3,y:a.y+2*(b.y-a.y)/3},b];}
      document=createAnnotation(document,{...input,points:actualPoints,followEntity:false,actionRange:clone(action?.range??intent.range),cueFrame:intent.anchorFrame,displayMode:intent.type==='route'?'remaining':'full',curve:intent.type==='route'&&actualPoints.length===4?'cubic_bezier':'polyline',progressFrames:[{frame:(action?.range??intent.range).startFrame,t:0},{frame:(action?.range??intent.range).endFrameExclusive,t:1}],meaning});
    }else {
      const range=action?.range??intent.range;
      document=createAnnotation(document,{...input,actionRange:clone(range),cueFrame:intent.anchorFrame,displayMode:'full',curve:intent.type==='route'&&actual.length===4?'cubic_bezier':'polyline',progressFrames:[{frame:range.startFrame,t:0},{frame:range.endFrameExclusive,t:1}],meaning});
    }
    const annotationId=input.id;
    entries.push({...clone(intent),annotationIds:[annotationId],points:clone(actual)});
    const key=`${intent.phaseId}:${intent.anchorFrame}`,group=cueGroups.get(key)??{phaseId:intent.phaseId,frame:intent.anchorFrame,annotationIds:[],routes:0,spotlights:0};
    group.annotationIds.push(annotationId);if(intent.type==='route')group.routes++;if(intent.type==='spotlight')group.spotlights++;cueGroups.set(key,group);
  }
  for(const group of cueGroups.values()){
    requireThat(group.routes<=3,'More than three primary routes share one cue; split supported actions into phases','coverage_incomplete');
    if(group.spotlights>6)warnings.push({reasonCode:'readability_review_required',phaseId:group.phaseId,assetFrame:group.frame,spotlights:group.spotlights});
    document=upsertTacticKeyframe(document,{id:`cue-${group.phaseId}-${group.frame}`,frame:group.frame,annotationIds:group.annotationIds,freeze:true,holdSeconds:1.5});
  }
  await nativeDocument(document);
  const candidateDigest=digest(document),productionPlan=compileProduction(document,{fps:request.fps??30});
  const sampled=new Set();
  for(const state of productionPlan.frames){
    const key=`${state.sourceFrame}:${state.state}:${state.reveal}`;if(sampled.has(key))continue;sampled.add(key);
    const scene=projectAnnotations(document,{phaseId:state.phaseId,frame:state.sourceFrame,reveal:state.reveal,freeze:state.state!=='source'});
    const visible=scene.items.filter(item=>visibility(item,document).visible),routes=visible.filter(item=>item.type==='route');
    requireThat(routes.length<=3,'More than three primary routes are visible in the actual production frame; split supported display intervals','coverage_incomplete',{affectedRanges:[{startFrame:state.sourceFrame,endFrameExclusive:state.sourceFrame+1}],annotationIds:routes.map(a=>a.id)});
  }
  const common={schemaVersion:SCHEMA_VERSION,toolVersion:TOOL_VERSION,sourceRef:clone(request.sourceRef),candidateDigest,analysisRevision:request.participantInventory.analysisRevision,inventoryDigest};
  const annotationMap={...common,entries,coordinateTransforms:transforms,relations:clone(request.playAnalysis.relations??[]),actions:[...actions.values()]};
  // Native production.sourceFrame is an asset index. Expose the original source label separately.
  const renderPlan={...common,productionPlan,frames:productionPlan.frames.map((state,outputFrame)=>({outputFrame,...frameInfo(document,state.sourceFrame),state:state.state,reveal:state.reveal,phaseId:state.phaseId})),cameraEvidence:clone(request.cameraEvidence??[]),calibration:clone(request.calibration??null),warnings};
  return {candidate:document,candidateDigest,annotationMap,renderPlan,inventoryDigest,warnings};
}

async function checkContext(request,label){
  exact(request,['operation','candidate','sourceRef','playerEvidence','participantInventory','annotationMap','renderPlan'],['frameSelection',...optionalShared],label);
  const document=request.candidate;await nativeDocument(document);await bindSource(document,request.sourceRef);
  const range=RANGE(document),evidenceIndex=validateEvidence(request.playerEvidence,document,request.sourceRef,range),inventoryDigest=validateInventory(request.participantInventory,document,range,evidenceIndex,request.sourceRef),candidateDigest=digest(document);
  for(const artifact of [request.annotationMap,request.renderPlan]){
    requireThat(artifact.schemaVersion===SCHEMA_VERSION&&artifact.candidateDigest===candidateDigest&&artifact.inventoryDigest===inventoryDigest&&artifact.analysisRevision===request.participantInventory.analysisRevision&&equal(artifact.sourceRef,request.sourceRef),'Quality artifact version/source changed','source_mismatch');
  }
  const plan=compileProduction(document,{fps:request.renderPlan.productionPlan.fps});
  requireThat(equal(plan,request.renderPlan.productionPlan),'Render plan differs from native production','source_mismatch');
  const expectedFrames=plan.frames.map((state,outputFrame)=>({outputFrame,...frameInfo(document,state.sourceFrame),state:state.state,reveal:state.reveal,phaseId:state.phaseId}));
  requireThat(equal(request.renderPlan.frames,expectedFrames),'Render plan asset/source labels changed','source_mismatch');
  const sceneCache=new Map(),scenes=[];
  for(const [outputFrame,state] of plan.frames.entries()){
    const key=`${state.sourceFrame}:${state.phaseId}:${state.state}:${state.reveal}`;
    let scene=sceneCache.get(key);if(!scene){scene=projectAnnotations(document,{phaseId:state.phaseId,frame:state.sourceFrame,reveal:state.reveal,freeze:document.schemaVersion===2&&state.state!=='source'});sceneCache.set(key,scene);}
    scenes.push({outputFrame,state,scene});
  }
  return {document,range,evidenceIndex,candidateDigest,inventoryDigest,scenes,plan};
}

function geometryPoints(geometry){return [...(geometry.curve??[]),...(geometry.ribbon??[]),...(geometry.arrow??[]),...(geometry.ring??[]),...(geometry.paths?.flat()??[]),...(geometry.center?[geometry.center]:[])];}
function visibility(item,document){
  if(!item?.video)return {visible:false,reason:item?.hiddenReason??'annotation_absent'};
  if(item.hiddenReason)return {visible:false,reason:item.hiddenReason};
  const geometry=item.video,p=geometryPoints(geometry);
  if(!p.length||p.some(p=>!finite(p.x)||!finite(p.y)))return {visible:false,reason:'nonfinite_geometry'};
  if((geometry.opacity??1)<=0)return {visible:false,reason:'zero_opacity'};
  const margin=(geometry.strokeWidth??0)/2;
  if(Math.max(...p.map(p=>p.x))<-margin||Math.min(...p.map(p=>p.x))>document.review.width+margin||Math.max(...p.map(p=>p.y))<-margin||Math.min(...p.map(p=>p.y))>document.review.height+margin)return {visible:false,reason:'outside_viewport'};
  return {visible:true,reason:null};
}

function unavailableParticipant(participant,phase,player){
  const inPhase=[...player.samples.values()].filter(s=>contains(phase.range,s.assetFrame));
  if(inPhase.some(locatable))return null;
  const declared=participant.unavailableRanges??[];
  if(declared.length){
    const usable=declared.every(r=>r.evidenceFrames.every(f=>{const s=player.samples.get(f);return s&&contains(r,f)&&!locatable(s)&&['occluded','out_of_view','unknown'].includes(s.visibility);}));
    const all=Array.from({length:phase.range.endFrameExclusive-phase.range.startFrame},(_,i)=>i+phase.range.startFrame).every(f=>declared.some(r=>contains(r,f)));
    if(usable&&all)return clone(declared);
  }
  const full=inPhase.length===phase.range.endFrameExclusive-phase.range.startFrame&&inPhase.every(s=>['occluded','out_of_view','unknown'].includes(s.visibility)&&s.evidenceRef);
  if(full)return [{...phase.range,reason:'unlocatable_entire_phase',evidenceFrames:inPhase.map(s=>s.assetFrame),evidenceRef:inPhase[0].evidenceRef}];
  return null;
}

export async function checkParticipantCoverage(request){
  const context=await checkContext(request,'check_participant_coverage'),{document,evidenceIndex,scenes}=context;
  const phases=[],missing=[],unavailable=[],wrongBindings=[];
  for(const phase of request.participantInventory.phases){
    const rows=[];
    for(const participant of phase.participants){
      const entries=request.annotationMap.entries.filter(e=>e.phaseId===phase.phaseId&&e.playerId===participant.playerId),annotationIds=[...new Set(entries.flatMap(e=>e.annotationIds))],visibleAssetFrames=new Set(),hiddenReasons=new Set(),wrong=[];
      for(const id of annotationIds){const a=document.annotations?.items.find(a=>a.id===id);if(!a||a.entityId!==participant.playerId||a.phaseId!==phase.phaseId)wrong.push(id);}
      const player=evidenceIndex.get(participant.playerId);
      for(const {state,scene} of scenes){
        if(state.phaseId!==phase.phaseId||!contains(phase.range,state.sourceFrame))continue;
        for(const id of annotationIds){
          if(wrong.includes(id))continue;
          const v=visibility(scene.items.find(a=>a.id===id),document);
          const sample=player.samples.get(state.sourceFrame);
          if(v.visible&&participantLocatable(participant,sample))visibleAssetFrames.add(state.sourceFrame);else if(v.reason)hiddenReasons.add(v.reason);else hiddenReasons.add(locatable(sample)?'identity_not_confirmed_in_inventory':'evidence_not_locatable');
        }
      }
      const unavailableRanges=unavailableParticipant(participant,phase,player);
      const status=wrong.length?'wrong_binding':visibleAssetFrames.size?'covered':unavailableRanges&&!annotationIds.length?'unavailable':'missing';
      const row={playerId:participant.playerId,role:participant.role,evidenceFrames:clone(participant.evidenceFrames),annotationIds,actionIds:[...new Set(entries.map(e=>e.actionId).filter(Boolean))],status,visibleAssetFrames:[...visibleAssetFrames].sort((a,b)=>a-b),hiddenReasons:[...hiddenReasons].sort(),...(unavailableRanges?{unavailableRanges}:{}),evidenceRef:participant.evidenceRef??player.samples.get(participant.evidenceFrames[0])?.evidenceRef??null};
      if(status==='missing'){if(!annotationIds.length)row.hiddenReasons.push('no_annotation');missing.push({phaseId:phase.phaseId,...row});}
      if(status==='unavailable')unavailable.push({phaseId:phase.phaseId,...row});
      if(status==='wrong_binding')wrongBindings.push({phaseId:phase.phaseId,...row,wrongAnnotationIds:wrong});
      rows.push(row);
    }
    const counts={expected:rows.length,locatableExpected:rows.filter(r=>r.status!=='unavailable').length,covered:rows.filter(r=>r.status==='covered').length,unavailable:rows.filter(r=>r.status==='unavailable').length,missing:rows.filter(r=>r.status==='missing'||r.status==='wrong_binding').length};
    phases.push({phaseId:phase.phaseId,phaseRange:clone(phase.range),rows,counts,coveredOfExpected:[counts.covered,counts.expected],coveredOfLocatableExpected:[counts.covered,counts.locatableExpected]});
  }
  return {schemaVersion:SCHEMA_VERSION,toolVersion:TOOL_VERSION,candidateDigest:context.candidateDigest,sourceRef:clone(request.sourceRef),analysisRevision:request.participantInventory.analysisRevision,inventoryDigest:context.inventoryDigest,pass:missing.length===0&&wrongBindings.length===0,phases,missing,unavailable,wrongBindings,reviewRequired:true};
}

export async function checkProjection(request){
  const context=await checkContext(request,'check_projection'),{document,evidenceIndex,scenes}=context;
  const invalid=[],hidden=new Map(),visibleCounts=new Map(),previousCenters=new Map();
  const add=(annotationId,assetFrame,reason)=>{const key=`${annotationId}:${assetFrame}:${reason}`;if(!invalid.some(i=>i.key===key))invalid.push({key,annotationId,startFrame:assetFrame,endFrameExclusive:assetFrame+1,reason});};
  const proofRequest={...request,cameraEvidence:request.cameraEvidence??request.renderPlan.cameraEvidence,calibration:request.calibration??request.renderPlan.calibration};
  const actions=new Map(request.annotationMap.actions.map(a=>[a.actionId,a]));
  for(const entry of request.annotationMap.entries){
    const {annotationIds,...intent}=entry;
    try{validateIntent(intent,document,request.participantInventory,actions);cameraProof(intent,proofRequest,document,actions.get(intent.actionId));geometryProof(intent,proofRequest,document);locatePoints(intent,evidenceIndex,document,actions.get(intent.actionId));}
    catch(error){for(const id of annotationIds)add(id,intent.anchorFrame,error.reasonCode??'projection_invalid');}
    for(const id of annotationIds){
      const a=document.annotations?.items.find(a=>a.id===id);
      if(!a||a.entityId!==intent.playerId||a.phaseId!==intent.phaseId){add(id,intent.anchorFrame,'wrong_binding');continue;}
      if(a.type!==intent.type||a.startFrame!==intent.range.startFrame||a.endFrameExclusive!==intent.range.endFrameExclusive||a.anchorFrame!==intent.anchorFrame)add(id,intent.anchorFrame,'annotation_timing_or_type_changed');
      if(!a.origin||a.origin.kind!=='agent')add(id,intent.anchorFrame,'agent_origin_missing');
      if(!equal(a.points,intent.points)&&!(a.points.length===4&&intent.points.length===2&&equal(a.points[0],intent.points[0])&&equal(a.points.at(-1),intent.points.at(-1))))add(id,intent.anchorFrame,'annotation_points_changed');
      if(intent.displayIntent==='reference_frame'&&(a.followEntity||a.videoMode==='fixed'||a.space!=='video'))add(id,intent.anchorFrame,'display_intent_mismatch');
      if(intent.displayIntent==='fixed_interval'&&(a.videoMode!=='fixed'||a.timingMode!=='manual'||a.followEntity))add(id,intent.anchorFrame,'display_intent_mismatch');
      if(intent.displayIntent==='declared_player_follow'&&(!a.followEntity||a.anchorMode!=='player_foot'))add(id,intent.anchorFrame,'display_intent_mismatch');
      if(intent.displayIntent==='court_projection'&&(a.space!=='court'||a.followEntity))add(id,intent.anchorFrame,'display_intent_mismatch');
      if(a.style.pattern==='dashed'&&a.meaning!=='later_observed_action')add(id,intent.anchorFrame,'invalid_dashed_semantics');
    }
  }
  for(const annotation of document.annotations?.items??[])if(!request.annotationMap.entries.some(e=>e.annotationIds.includes(annotation.id)))add(annotation.id,annotation.anchorFrame,'unmapped_annotation');
  for(const {state,scene} of scenes){
    const visibleRoutes=scene.items.filter(item=>item.type==='route'&&visibility(item,document).visible);
    if(visibleRoutes.length>3)for(const item of visibleRoutes)add(item.id,state.sourceFrame,'route_density_exceeded');
    for(const item of scene.items){
      const f=state.sourceFrame,v=visibility(item,document),annotation=item.original;
      if(!v.visible){
        if(!hidden.has(item.id))hidden.set(item.id,new Map());const rows=hidden.get(item.id);rows.set(`${f}:${v.reason}`,{assetFrame:f,reason:v.reason});
        if(!['outside_time','reference_frame_only','completed','zero_opacity'].includes(v.reason))add(item.id,f,v.reason);
        continue;
      }
      visibleCounts.set(item.id,(visibleCounts.get(item.id)??0)+1);
      if(annotation.followEntity){
        const sample=evidenceIndex.get(annotation.entityId)?.samples.get(f);
        const participant=request.participantInventory.phases.find(p=>p.phaseId===annotation.phaseId)?.participants.find(p=>p.playerId===annotation.entityId);
        if(!participantLocatable(participant,sample)||sample.anchorSemantics==='body_point'||sample.sourceMethod==='tapir')add(item.id,f,'incompatible_follow_evidence');
        if(annotation.anchorMode==='court_player_foot'){
          const prepared=document.review.courtPreparation?.preparedByPlayer?.[annotation.entityId]?.[f];
          if(!prepared||!['tracked','manual','court_manual','projected'].includes(prepared.source)||prepared.groundObservationUsable===false)add(item.id,f,'estimated_court_follow');
        }
        const current=item.video.center,previous=previousCenters.get(item.id);
        if(current&&previous&&f!==previous.frame){const dt=document.review.sourceFrameMapping[f].time-document.review.sourceFrameMapping[previous.frame].time;if(dt>0&&distance(current,previous.center)/dt>Math.hypot(document.review.width,document.review.height)*2)add(item.id,f,'suspicious_jump');}
        if(current)previousCenters.set(item.id,{frame:f,center:current});
      }
    }
  }
  for(const a of document.annotations?.items??[])if(!visibleCounts.has(a.id))add(a.id,a.anchorFrame,'all_frames_hidden');
  const hiddenReasons=[...hidden].map(([annotationId,values])=>({annotationId,frames:[...values.values()]}));
  return {schemaVersion:SCHEMA_VERSION,toolVersion:TOOL_VERSION,candidateDigest:context.candidateDigest,sourceRef:clone(request.sourceRef),analysisRevision:request.participantInventory.analysisRevision,inventoryDigest:context.inventoryDigest,pass:invalid.length===0,invalidRanges:invalid.map(({key,...row})=>row),hiddenReasons,checkedOutputFrames:context.plan.totalFrames,visibleAnnotationCount:visibleCounts.size,reviewRequired:true};
}

export async function previewProjection(request){
  const context=await checkContext(request,'preview_projection');
  let selection=request.frameSelection;
  if(selection!==undefined){frames(selection,context.document.review.sourceFrameMapping.length,'frameSelection');requireThat(selection.length<=40,'Preview extraction is limited to 40 frames');}
  else selection=[...new Set([...request.participantInventory.phases.flatMap(p=>[p.range.startFrame,p.range.endFrameExclusive-1]),...request.annotationMap.entries.flatMap(e=>[e.anchorFrame,...e.evidenceFrames.slice(0,2)])])].sort((a,b)=>a-b).slice(0,40);
  const previews=[];
  for(const assetFrame of selection){
    requireThat(contains(context.range,assetFrame),'Preview frame is outside this run');
    // Choose an actual fully revealed production hold, otherwise the actual production source frame.
    const matching=context.scenes.filter(s=>s.state.sourceFrame===assetFrame);let chosen=matching.find(s=>s.state.state==='hold'&&s.state.reveal===1)??matching.find(s=>s.state.reveal===1)??matching[0];
    if(!chosen){
      // Downsampling may omit an asset frame. Still inspect its exact image using the native
      // source-playback state; outputFrame:null explicitly distinguishes it from an encoded frame.
      const phaseId=context.document.playDefinition.phases.find(p=>contains(p,assetFrame)).phaseId,state={sourceFrame:assetFrame,sourceTime:context.document.review.sourceFrameMapping[assetFrame].time,state:'source',reveal:1,phaseId};
      chosen={outputFrame:null,state,scene:projectAnnotations(context.document,{phaseId,frame:assetFrame,reveal:1,freeze:false})};
    }
    previews.push({...frameInfo(context.document,assetFrame),outputFrame:chosen.outputFrame,frameState:clone(chosen.state),svg:renderProductionSvg(context.document,chosen.state),visibleAnnotationIds:chosen.scene.items.filter(a=>visibility(a,context.document).visible).map(a=>a.id)});
  }
  return {schemaVersion:SCHEMA_VERSION,toolVersion:TOOL_VERSION,candidateDigest:context.candidateDigest,sourceRef:clone(request.sourceRef),analysisRevision:request.participantInventory.analysisRevision,inventoryDigest:context.inventoryDigest,previews,requiresExactSourceComposite:true,reviewRequired:true};
}

export async function dispatch(request){
  const operations={create_baseline:createBaseline,build_player_annotations:buildPlayerAnnotations,check_participant_coverage:checkParticipantCoverage,check_projection:checkProjection,preview_projection:previewProjection};
  requireThat(request&&Object.hasOwn(operations,request.operation),'Unsupported bridge operation','capability_unavailable');
  return operations[request.operation](request);
}
export async function respond(request){
  try{return {ok:true,result:await dispatch(request)};}
  catch(error){return {ok:false,error:{reasonCode:error.reasonCode??'invalid_input',message:error.message,retryable:false,affectedRanges:error.details?.affectedRanges??[],evidenceRefs:[],suggestedAction:'Check the cited evidence, source snapshot and tool contract.',...(error.details?{details:error.details}:{})}};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const chunks=[];let bytes=0;for await(const chunk of process.stdin){bytes+=chunk.length;requireThat(bytes<=50*1024*1024,'Bridge input exceeds 50 MiB');chunks.push(chunk);}const input=Buffer.concat(chunks).toString('utf8');process.stdout.write(JSON.stringify(await respond(JSON.parse(input))));}
  catch(error){process.stdout.write(JSON.stringify({ok:false,error:{reasonCode:'invalid_input',message:error.message,retryable:false,affectedRanges:[],evidenceRefs:[],suggestedAction:'Send a valid bounded JSON request.'}}));process.exitCode=1;}
}
