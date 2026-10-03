import {courtLandmarks} from './court-geometry.mjs';
import {fitKeyframe,keyframePoints,calibrationAt} from './court.mjs';

export const LANDMARK_HINTS={
 A:'沿篮下底线，找到它与远侧禁区长边的交点。',B:'沿罚球线，找到它与远侧禁区长边的交点。',
 C:'沿罚球线，找到它与近侧禁区长边的交点。',D:'沿篮下底线，找到它与近侧禁区长边的交点。',
 E:'找到篮下底线与远侧边线的球场外角。',F:'找到中线与远侧边线的交点。',
 G:'找到篮下底线与近侧边线的球场外角。',H:'找到中线与近侧边线的交点。',
 I:'找到底线与远侧三分直线的交点；不是三分弧顶。',J:'找到底线与近侧三分直线的交点；不是三分弧顶。'
};
export function normalizeCourtCandidates(value,frameCount){
 const keys=Array.isArray(value)?value:value?.keyframes||[];
 return keys.filter(key=>Number.isInteger(key.frame)&&key.frame>=0&&key.frame<frameCount&&['left','right'].includes(key.side)).map(key=>({...structuredClone(key),
  source:key.source||value?.source||'model',status:key.status==='invalid'?'invalid':'needs_review',reviewRequired:true,
  points:(key.points||[]).map(point=>({...point,id:point.id||point.landmarkId,source:point.source||key.source||value?.source||'model'}))})).map(clearCalibrationProjectionReview);
}
export function clearCalibrationProjectionReview(key){
 const next={...key};delete next.projectionReviewedAt;delete next.projectionReviewFingerprint;
 if(next.quality?.cameraSupportReviewSource){next.quality={...next.quality};delete next.quality.cameraSupportReviewSource;}
 return next;
}
export function calibrationGeometryFingerprint(key){
 return JSON.stringify({side:key.side,points:keyframePoints(key).map(point=>({id:point.id,image:point.image,role:point.role||'control',enabled:point.enabled!==false})).sort((a,b)=>a.id.localeCompare(b.id))});
}
function cameraReference(key){
 const camera=key.source==='camera_propagation'||keyframePoints(key).some(point=>point.enabled!==false&&point.role!=='check'&&point.source==='camera_propagation');
 return camera?(key.cameraSupportFrame??key.quality?.cameraSupportFrame??key.quality?.referenceFrame):null;
}
export function isHumanCalibrationKey(key){
 if(key.source==='human'||keyframePoints(key).some(point=>point.source==='human'))return true;
 const reviewed=Boolean(key.projectionReviewedAt)||key.quality?.cameraSupportReviewSource==='human_projection_review',reference=cameraReference(key);
 return reviewed&&(reference===null||reference===key.frame);
}
export function isCalibrationProjectionConfirmed(key){
 if(!key||!key.projectionReviewedAt||key.valid===false||key.invalidReason||['needs_review','invalid','failed'].includes(key.status))return false;
 const reference=cameraReference(key);
 return (reference===null||reference===key.frame)&&Boolean(fitKeyframe(key))&&
  (!key.projectionReviewFingerprint||key.projectionReviewFingerprint===calibrationGeometryFingerprint(key));
}
// Each result describes one frame's calibration, independently of player identity.
// Candidate adoption enables a preview; it never supplies human review evidence.
export function calibrationReviewStates(calibration,candidates,frames,cuts=[]){
 const saved=new Map((calibration?.keyframes||[]).map(key=>[key.frame,key]));
 const incoming=new Map((candidates||[]).map(key=>[key.frame,key]));
 const deleted=new Set(calibration?.deletedReferenceFrames||[]);
 return frames.map((_,frame)=>{
  const key=saved.get(frame)||incoming.get(frame);
  if(!key)return calibrationAt(calibration,frame,frames,cuts)?{status:'pending',label:'关键帧间估计，待人工确认'}:{status:'empty',label:'尚无标定结果'};
  const reference=cameraReference(key),hasReference=reference!==null;
  const changedReference=hasReference&&reference!==frame&&saved.has(reference)&&incoming.has(reference)&&
   calibrationGeometryFingerprint(saved.get(reference))!==calibrationGeometryFingerprint(incoming.get(reference));
  const brokenReference=hasReference&&(!Number.isInteger(reference)||reference<0||reference>=frames.length||
   cuts.some(cut=>cut>Math.min(reference,frame)&&cut<=Math.max(reference,frame)));
  const changedReview=key.projectionReviewFingerprint&&key.projectionReviewFingerprint!==calibrationGeometryFingerprint(key);
  if(deleted.has(frame)||deleted.has(reference)||changedReference||brokenReference||changedReview||key.invalidReason||key.valid===false||['invalid','failed'].includes(key.status))
   return {status:'invalid',label:'标定失效，需重新核对'};
  if(!fitKeyframe(key))return {status:key.source==='human'?'pending':'invalid',label:'参照点不足或无效'};
  if(saved.has(frame)&&isCalibrationProjectionConfirmed(key))return {status:'human',label:'本帧投影线已人工确认'};
  if(key.source==='human')return {status:'pending',label:'人工标定，待确认投影线'};
  return {status:'machine',label:'机器已生成标定，待人工确认'};
 });
}
function staleCameraKey(key,referenceFrame,reason='reference_changed'){
 const unreviewed=clearCalibrationProjectionReview(key);
 return {...unreviewed,status:'needs_review',invalidReason:reason,reviewRequired:true,
  quality:{...(unreviewed.quality||{}),invalidationReason:reason,changedReferenceFrame:referenceFrame,
   reason:reason==='reference_deleted'?'参考帧已删除，请重新建立并核对参考。':'参考帧已修改，请重新生成这段镜头标定。'}};
}
export function invalidateCameraDependents(calibration,referenceFrame,{referenceDeleted=false}={}){
 if(referenceDeleted)calibration.deletedReferenceFrames=[...new Set([...(calibration.deletedReferenceFrames||[]),referenceFrame])];
 let invalidated=0;
 calibration.keyframes=(calibration.keyframes||[]).map(key=>{if(key.frame===referenceFrame||cameraReference(key)!==referenceFrame)return key;invalidated++;return staleCameraKey(key,referenceFrame,referenceDeleted?'reference_deleted':'reference_changed');});
 return invalidated;
}
export function acceptCourtCandidates(session,value,frameCount,videoHash){
 const keys=normalizeCourtCandidates(value,frameCount),old=session.courtCalibration?.keyframes||[];
 const deletedReferences=new Set(session.courtCalibration?.deletedReferenceFrames||[]);
 const manual=new Map(old.filter(isHumanCalibrationKey).map(key=>[key.frame,key]));
 const incoming=new Map(keys.map(key=>[key.frame,key])),changedReferences=new Set([...manual].filter(([frame,key])=>incoming.has(frame)&&calibrationGeometryFingerprint(key)!==calibrationGeometryFingerprint(incoming.get(frame))).map(([frame])=>frame));
 const merged=new Map(old.map(key=>[key.frame,key]));let accepted=0,invalid=0,preserved=0;
 for(const key of keys){if(manual.has(key.frame)){preserved++;continue;}const reference=cameraReference(key);
  if(deletedReferences.has(key.frame)||deletedReferences.has(reference)){merged.set(key.frame,staleCameraKey(key,deletedReferences.has(key.frame)?key.frame:reference,'reference_deleted'));invalid++;continue;}
  if(reference!==key.frame&&changedReferences.has(reference)){merged.set(key.frame,staleCameraKey(key,reference));invalid++;continue;}
  if(key.status==='invalid'||!fitKeyframe(key)){merged.set(key.frame,{...key,status:'invalid'});invalid++;continue;}
  merged.set(key.frame,{...key,status:'accepted_reference',reviewRequired:true});accepted++;}
 session.courtCalibration={...(session.courtCalibration||{}),template:'NBA',videoHash,maxKeyframeGapSeconds:value?.maxKeyframeGapSeconds??session.courtCalibration?.maxKeyframeGapSeconds??1.2,keyframes:[...merged.values()].sort((a,b)=>a.frame-b.frame)};
 return {accepted,invalid,preserved};
}
export function calibrationGuideState(key,id='A'){
 const points=key?keyframePoints(key).filter(p=>p.enabled!==false&&p.role!=='check'):[],fit=key&&fitKeyframe(key);
 const landmark=courtLandmarks(key?.side).find(p=>p.id===id);
 return {count:points.length,ready:Boolean(fit),id,name:landmark?.name||id,hint:LANDMARK_HINTS[id]||'选择清楚可见的地面交点。',
  status:!fit?'select_points':key.status==='needs_review'?'check_projection':'preview',nextId:courtLandmarks(key?.side).find(p=>!points.some(point=>point.id===p.id))?.id||id};
}
export function reorientCalibrationKey(key,side){
 if(!['left','right'].includes(side))throw new Error('球篮方向无效。');
 return {...clearCalibrationProjectionReview(structuredClone(key)),side,source:'human',previousSource:key.previousSource||key.source,
  orientationChangedFrom:key.side,status:'needs_review',reviewRequired:true};
}
export function confirmCalibrationProjection(key,frame,reviewedAt){
 const reviewed={...structuredClone(key),status:key.source==='human'?'manual_confirmed':'accepted_reference',reviewRequired:true,projectionReviewedAt:reviewedAt,projectionReviewFingerprint:calibrationGeometryFingerprint(key)};
 if(reviewed.invalidReason){reviewed.previousInvalidReason=reviewed.invalidReason;delete reviewed.invalidReason;}
 if(key.source==='camera_propagation'||keyframePoints(key).some(point=>point.enabled!==false&&point.role!=='check'&&point.source==='camera_propagation')){
  reviewed.cameraSupportFrame=frame;
  reviewed.quality={...(reviewed.quality||{}),cameraSupportFrame:frame,cameraSupportReviewSource:'human_projection_review'};
 }
 return reviewed;
}
