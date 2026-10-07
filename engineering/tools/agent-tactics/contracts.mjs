import {createHash} from 'node:crypto';
import {canonicalJSON,createSourceBinding} from '../tactical-overlay/binding.mjs';

export const SCHEMA_VERSION='1.0';
export const TOOL_VERSION='agent-tactics-bridge-v1.1';
export const clone=value=>structuredClone(value);
export const digest=value=>createHash('sha256').update(canonicalJSON(value)).digest('hex');
export const equal=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
export const finite=value=>typeof value==='number'&&Number.isFinite(value);
export const integer=value=>Number.isSafeInteger(value)&&value>=0;
export const text=value=>typeof value==='string'&&value.length>0&&value.length<=512;
export class BridgeError extends Error {
  constructor(reasonCode,message,details={}){super(message);this.reasonCode=reasonCode;this.details=details;}
}
export function requireThat(condition,message,reasonCode='invalid_input',details={}){
  if(!condition)throw new BridgeError(reasonCode,message,details);
}
export function exact(value,required,optional=[],label='object'){
  requireThat(value&&typeof value==='object'&&!Array.isArray(value),`${label} must be an object`);
  const unknown=Object.keys(value).filter(key=>!required.includes(key)&&!optional.includes(key));
  requireThat(required.every(key=>Object.hasOwn(value,key))&&!unknown.length,`${label} has missing or unknown fields`, 'invalid_input',{unknownFields:unknown});
}
export function frameRange(value,count,label='range',within=null){
  exact(value,['startFrame','endFrameExclusive'],[],label);
  requireThat(integer(value.startFrame)&&integer(value.endFrameExclusive)&&value.startFrame<value.endFrameExclusive&&value.endFrameExclusive<=count,`${label} must be an asset-frame half-open interval`);
  if(within)requireThat(value.startFrame>=within.startFrame&&value.endFrameExclusive<=within.endFrameExclusive,`${label} is outside its parent range`);
  return value;
}
export const contains=(range,frame)=>frame>=range.startFrame&&frame<range.endFrameExclusive;
export function frames(value,count,label,{empty=false}={}){
  requireThat(Array.isArray(value)&&(empty||value.length>0)&&value.length<=18000&&new Set(value).size===value.length&&value.every(f=>integer(f)&&f<count),`${label} must contain unique asset frames`);
}
export function position(value,label){
  requireThat(Array.isArray(value)&&value.length===2&&value.every(finite),`${label} must be a finite [x,y] position`);
}
export function points(value,type,label='points'){
  requireThat(Array.isArray(value)&&(type==='route'?value.length>=2&&value.length<=6:value.length===1),`${label} has an invalid point count`);
  for(const point of value){exact(point,['x','y'],[],label);requireThat(finite(point.x)&&finite(point.y),`${label} must be finite`);}
}
export async function bindSource(document,sourceRef){
  exact(sourceRef,['videoSha256','trackingFingerprint','trackingRevision','frameMappingDigest','snapshotId'],['reviewDigest','assetId','width','height','ptsDigest'],'sourceRef');
  const binding=await createSourceBinding(document.review);
  for(const key of ['videoSha256','trackingFingerprint','trackingRevision','frameMappingDigest'])requireThat(text(sourceRef[key])&&sourceRef[key]===binding[key],`sourceRef.${key} does not match the native review`,'source_mismatch');
  requireThat(text(sourceRef.snapshotId),'sourceRef.snapshotId is required');
  if(sourceRef.reviewDigest!==undefined)requireThat(sourceRef.reviewDigest===binding.reviewDigest,'sourceRef.reviewDigest changed','source_mismatch');
  for(const key of ['width','height'])if(sourceRef[key]!==undefined)requireThat(sourceRef[key]===document.review[key],`sourceRef.${key} changed`,'source_mismatch');
  return binding;
}
export function validateEvidence(evidence,document,sourceRef,range){
  exact(evidence,['schemaVersion','sourceRef','range','players'],['adapterVersion','rawTrackingDigest'],'playerEvidence');
  for(const key of ['adapterVersion','rawTrackingDigest'])if(evidence[key]!==undefined)requireThat(text(evidence[key]),`Invalid ${key}`);
  requireThat(evidence.schemaVersion===SCHEMA_VERSION,'Unsupported playerEvidence schema','unsupported_schema');
  requireThat(equal(evidence.sourceRef,sourceRef),'Player evidence source changed','source_mismatch');
  const mapping=document.review.sourceFrameMapping,count=mapping.length;
  frameRange(evidence.range,count,'playerEvidence.range');
  requireThat(range.startFrame>=evidence.range.startFrame&&range.endFrameExclusive<=evidence.range.endFrameExclusive,'Player evidence does not cover the requested range','source_mismatch');
  requireThat(Array.isArray(evidence.players)&&evidence.players.length<=100,'Invalid player evidence list');
  const ids=new Set(),index=new Map();
  for(const player of evidence.players){
    exact(player,['playerId','identityStatus','identityEvidenceFrames','frames'],['trackId','teamCandidate','name','jerseyNumber'],'playerEvidence.players[]');
    requireThat(text(player.playerId)&&!ids.has(player.playerId)&&text(player.identityStatus),'Duplicate/invalid player identity');ids.add(player.playerId);
    requireThat(document.review.entities.some(entity=>entity.id===player.playerId),'Evidence player is not in the derived native review','source_mismatch');
    frames(player.identityEvidenceFrames,count,'identityEvidenceFrames',{empty:true});
    requireThat(Array.isArray(player.frames)&&player.frames.length<=count,'Invalid evidence frames');
    const samples=new Map();
    for(const sample of player.frames){
      exact(sample,['assetFrame','sourceFrame','pts','position','sourceSpace','anchorSemantics','observationStatus','visibility','identityConfidence','locationConfidence','sourceMethod','evidenceRef'],['bbox','identityConflict'],'playerEvidence sample');
      if(sample.identityConflict!==undefined)requireThat(typeof sample.identityConflict==='boolean','identityConflict must be boolean');
      requireThat(integer(sample.assetFrame)&&sample.assetFrame<count&&!samples.has(sample.assetFrame),'Duplicate/invalid evidence assetFrame');
      const native=mapping[sample.assetFrame];
      requireThat(sample.sourceFrame===native.sourceFrame&&finite(sample.pts)&&Math.abs(sample.pts-native.time)<1e-7,'Evidence frame labels or PTS do not match the registered asset','source_mismatch');
      requireThat(['image_pixels','court_meters'].includes(sample.sourceSpace)&&['body_point','foot_candidate','ground_point'].includes(sample.anchorSemantics),'Invalid evidence coordinate semantics');
      requireThat(['observed','estimated','unknown'].includes(sample.observationStatus)&&['visible','occluded','out_of_view','unknown'].includes(sample.visibility),'Invalid evidence observation/visibility status');
      if(sample.position!==null)position(sample.position,'evidence position');
      if(sample.bbox!==undefined&&sample.bbox!==null)requireThat(Array.isArray(sample.bbox)&&sample.bbox.length===4&&sample.bbox.every(finite),'Invalid evidence bounding box');
      for(const key of ['identityConfidence','locationConfidence'])requireThat(sample[key]===null||finite(sample[key])&&sample[key]>=0&&sample[key]<=1,`Invalid ${key}`);
      requireThat(text(sample.sourceMethod)&&text(sample.evidenceRef),'Evidence provenance is required');
      requireThat(sample.sourceMethod!=='tapir'||sample.anchorSemantics==='body_point','TAPIR points cannot be promoted to native feet/ground','capability_unavailable');
      samples.set(sample.assetFrame,sample);
    }
    index.set(player.playerId,{...player,samples});
  }
  return index;
}
export function locatable(sample){return Boolean(sample&&!sample.identityConflict&&sample.observationStatus==='observed'&&sample.visibility==='visible'&&sample.position?.every(finite));}
// These frozen ranges are the analysis's identity-confirmed scope, not all detections
// carrying the same raw track ID. Raw coordinate validity cannot expand that scope.
export function withinParticipantLocation(participant,frame){return Boolean(participant?.visibleRanges.some(r=>contains(r,frame))&&participant?.locatableRanges.some(r=>contains(r,frame)));}
export function participantLocatable(participant,sample){return locatable(sample)&&withinParticipantLocation(participant,sample.assetFrame);}
export function validateInventory(inventory,document,range,evidenceIndex,sourceRef){
  exact(inventory,['analysisRevision','phases'],['schemaVersion','sourceRef','frozenBeforeGraphics','producerOperationId'],'participantInventory');
  if(inventory.sourceRef!==undefined)requireThat(equal(inventory.sourceRef,sourceRef),'Inventory source changed','source_mismatch');
  if(inventory.frozenBeforeGraphics!==undefined)requireThat(inventory.frozenBeforeGraphics===true,'Inventory must be frozen before graphics');
  if(inventory.producerOperationId!==undefined)requireThat(text(inventory.producerOperationId),'Invalid inventory producerOperationId');
  requireThat(integer(inventory.analysisRevision)&&inventory.analysisRevision>0,'analysisRevision must be positive');
  if(inventory.schemaVersion!==undefined)requireThat(inventory.schemaVersion===SCHEMA_VERSION,'Unsupported inventory schema','unsupported_schema');
  requireThat(Array.isArray(inventory.phases)&&inventory.phases.length>0&&inventory.phases.length<=40,'Invalid inventory phases');
  const count=document.review.sourceFrameMapping.length,phaseIds=new Set();let end=range.startFrame;
  for(const phase of inventory.phases){
    exact(phase,['phaseId','range','participants'],['evidenceFrames','title'],'inventory phase');
    requireThat(text(phase.phaseId)&&!phaseIds.has(phase.phaseId),'Duplicate inventory phase');phaseIds.add(phase.phaseId);
    frameRange(phase.range,count,'inventory phase range',range);requireThat(phase.range.startFrame===end,'Inventory phases must cover the requested range without gaps');end=phase.range.endFrameExclusive;
    if(phase.evidenceFrames)frames(phase.evidenceFrames,count,'phase evidenceFrames');
    requireThat(Array.isArray(phase.participants)&&phase.participants.length<=100,'Invalid phase participants');const ids=new Set();
    for(const participant of phase.participants){
      exact(participant,['playerId','role','evidenceFrames','visibleRanges','locatableRanges','positionStatus'],['unavailableRanges','evidenceRef','explanation'],'inventory participant');
      if(participant.explanation!==undefined)requireThat(typeof participant.explanation==='string'&&participant.explanation.length<=4000,'Invalid participant explanation');
      requireThat(text(participant.playerId)&&text(participant.role)&&text(participant.positionStatus)&&!ids.has(participant.playerId)&&evidenceIndex.has(participant.playerId),'Unknown/duplicate phase participant');ids.add(participant.playerId);
      frames(participant.evidenceFrames,count,'participant evidenceFrames');
      for(const key of ['visibleRanges','locatableRanges']){requireThat(Array.isArray(participant[key]),`${key} must be an array`);for(const r of participant[key])frameRange(r,count,key,phase.range);}
      const player=evidenceIndex.get(participant.playerId);
      for(const r of participant.visibleRanges)for(let f=r.startFrame;f<r.endFrameExclusive;f++){
        const sample=player.samples.get(f);
        requireThat(sample&&!sample.identityConflict&&sample.observationStatus==='observed'&&sample.visibility==='visible','Frozen visible range includes an unavailable or conflicted identity observation','tracking_gap',{affectedRanges:[{startFrame:f,endFrameExclusive:f+1}]});
      }
      for(const r of participant.locatableRanges)for(let f=r.startFrame;f<r.endFrameExclusive;f++)requireThat(participantLocatable(participant,player.samples.get(f)),'Frozen locatable range needs a visible observed location inside its confirmed visible range','tracking_gap',{affectedRanges:[{startFrame:f,endFrameExclusive:f+1}]});
      if(participant.unavailableRanges!==undefined){
        requireThat(Array.isArray(participant.unavailableRanges),'unavailableRanges must be an array');
        for(const unavailable of participant.unavailableRanges){
          exact(unavailable,['startFrame','endFrameExclusive','reason','evidenceFrames','evidenceRef'],[],'unavailable range');
          frameRange({startFrame:unavailable.startFrame,endFrameExclusive:unavailable.endFrameExclusive},count,'unavailable range',phase.range);
          requireThat(text(unavailable.reason)&&text(unavailable.evidenceRef),'Unavailable ranges need reasons and provenance');frames(unavailable.evidenceFrames,count,'unavailable evidenceFrames');
        }
      }
    }
  }
  requireThat(end===range.endFrameExclusive,'Inventory phases must cover the requested range');
  return digest(inventory);
}
