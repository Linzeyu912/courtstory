import {courtLandmarks} from './court-geometry.mjs';
import {fitKeyframe,keyframePoints} from './court.mjs';

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
  points:(key.points||[]).map(point=>({...point,id:point.id||point.landmarkId,source:point.source||key.source||value?.source||'model'}))}));
}
export function calibrationGeometryFingerprint(key){
 return JSON.stringify({side:key.side,points:keyframePoints(key).map(point=>({id:point.id,image:point.image,role:point.role||'control',enabled:point.enabled!==false})).sort((a,b)=>a.id.localeCompare(b.id))});
}
function cameraReference(key){
 const camera=key.source==='camera_propagation'||keyframePoints(key).some(point=>point.enabled!==false&&point.role!=='check'&&point.source==='camera_propagation');
 return camera?(key.cameraSupportFrame??key.quality?.cameraSupportFrame??key.quality?.referenceFrame):null;
}
function staleCameraKey(key,referenceFrame){
 return {...key,status:'needs_review',invalidReason:'reference_changed',reviewRequired:true,
  quality:{...(key.quality||{}),invalidationReason:'reference_changed',changedReferenceFrame:referenceFrame,reason:'参考帧已修改，请重新生成这段镜头标定。'}};
}
export function invalidateCameraDependents(calibration,referenceFrame){
 let invalidated=0;
 calibration.keyframes=(calibration.keyframes||[]).map(key=>{if(key.frame===referenceFrame||cameraReference(key)!==referenceFrame)return key;invalidated++;return staleCameraKey(key,referenceFrame);});
 return invalidated;
}
export function acceptCourtCandidates(session,value,frameCount,videoHash){
 const keys=normalizeCourtCandidates(value,frameCount),old=session.courtCalibration?.keyframes||[];
 const manual=new Map(old.filter(key=>key.source==='human'||keyframePoints(key).some(point=>point.source==='human')).map(key=>[key.frame,key]));
 const incoming=new Map(keys.map(key=>[key.frame,key])),changedReferences=new Set([...manual].filter(([frame,key])=>incoming.has(frame)&&calibrationGeometryFingerprint(key)!==calibrationGeometryFingerprint(incoming.get(frame))).map(([frame])=>frame));
 const merged=new Map(old.map(key=>[key.frame,key]));let accepted=0,invalid=0,preserved=0;
 for(const key of keys){if(manual.has(key.frame)){preserved++;continue;}const reference=cameraReference(key);if(reference!==key.frame&&changedReferences.has(reference)){merged.set(key.frame,staleCameraKey(key,reference));invalid++;continue;}if(key.status==='invalid'||!fitKeyframe(key)){merged.set(key.frame,{...key,status:'invalid'});invalid++;continue;}merged.set(key.frame,{...key,status:'accepted_reference',reviewRequired:true});accepted++;}
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
 return {...structuredClone(key),side,source:'human',previousSource:key.previousSource||key.source,
  orientationChangedFrom:key.side,status:'needs_review',reviewRequired:true};
}
export function confirmCalibrationProjection(key,frame,reviewedAt){
 const reviewed={...structuredClone(key),status:key.source==='human'?'manual_confirmed':'accepted_reference',reviewRequired:true,projectionReviewedAt:reviewedAt};
 if(reviewed.invalidReason){reviewed.previousInvalidReason=reviewed.invalidReason;delete reviewed.invalidReason;}
 if(key.source==='camera_propagation'||keyframePoints(key).some(point=>point.enabled!==false&&point.role!=='check'&&point.source==='camera_propagation')){
  reviewed.cameraSupportFrame=frame;
  reviewed.quality={...(reviewed.quality||{}),cameraSupportFrame:frame,cameraSupportReviewSource:'human_projection_review'};
 }
 return reviewed;
}
