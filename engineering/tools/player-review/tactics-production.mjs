import {rangeToSeconds} from './tactics-time-range.mjs';
import {compileTacticKeyframes,explanationTiming} from './tactics-keyframes.mjs';
import {courtProjectionGaps} from './tactics-court-projection.mjs';
import {canonicalJSON,createSourceBinding} from '../tactical-overlay/binding.mjs';
import {validQuad} from './court.mjs';
import {createAnnotation,updateAnnotation,annotationStatus,annotationPausePoints,projectAnnotations,renderAnnotationsSVG} from './tactics-annotations.mjs';
import {validateDocument,reindexPhases} from './tactics-document.mjs';
import {DEFAULT_RIBBON,productionPhaseSnapshot,productionSourceSnapshot,productionEqual,productionCameraDigest,productionCameraAt,sha256} from './tactics-authored-geometry.mjs';
export {DEFAULT_RIBBON,productionPhaseSnapshot,productionCameraDigest};
export const DEFAULT_PRODUCTION_CUE=Object.freeze({settleFrames:5,drawFrames:0,holdFrames:40});
export function productionCue(document,{phaseId,frame}){
  const explicit=document.production?.timeline.cues.find(c=>c.phaseId===phaseId&&c.frame===frame);
  return {phaseId,frame,...Object.fromEntries(Object.keys(DEFAULT_PRODUCTION_CUE).map(k=>[k,explicit?.[k]??DEFAULT_PRODUCTION_CUE[k]]))};
}
const clone=v=>structuredClone(v),finite=n=>typeof n==='number'&&Number.isFinite(n),frame=n=>Number.isSafeInteger(n)&&n>=0;
const exact=(o,keys,optional=[])=>o&&typeof o==='object'&&!Array.isArray(o)&&keys.every(k=>Object.hasOwn(o,k))&&Object.keys(o).every(k=>keys.includes(k)||optional.includes(k));
const snapshotValid=s=>exact(s,['phaseId','startFrame','endFrameExclusive','freezeFrame'])&&typeof s.phaseId==='string'&&[s.startFrame,s.endFrameExclusive,s.freezeFrame].every(frame)&&s.startFrame<=s.freezeFrame&&s.freezeFrame<s.endFrameExclusive;
const phaseFor=(d,id)=>{const p=d.playDefinition.phases.find(p=>p.phaseId===id);if(!p)throw new Error('未找到编排阶段。');return p;};
const mediaSnapshot=d=>({version:1,videoSha256:d.review.videoSha256,width:d.review.width,height:d.review.height,
  frameMappingDigest:sha256(canonicalJSON(d.review.sourceFrameMapping)),phaseDigest:sha256(canonicalJSON(d.playDefinition.phases.map(productionPhaseSnapshot))),cutsDigest:sha256(canonicalJSON(d.review.settings?.cuts??[]))});
const emptyProduction=d=>({schemaVersion:1,sourceBinding:productionSourceSnapshot(d),mediaBinding:mediaSnapshot(d),cameras:[],timeline:{timebaseFps:30,cues:[],endHoldFrames:0}});
const fail=issues=>{if(issues.length)throw new Error(`视频编排无效：${issues.map(i=>i.details.field).join('、')}`);};

/** Preserve evidence before refresh replaces review. This never makes stale routes active. */
export async function preserveProductionMediaBinding(document){
  const d=clone(document);
  if(d.production&&!d.production.mediaBinding&&productionEqual(d.production.sourceBinding,await createSourceBinding(d.review)))d.production.mediaBinding=mediaSnapshot(d);
  return d;
}

/** Explicit recovery only; independent authored illustrations do not re-confirm tracked players. */
export async function rebindIndependentProduction(document,{referenceDocument=null}={}){
  await validateDocument(document);if(!document.production)throw new Error('没有可重新绑定的成片编排。');
  const d=clone(document),old=d.production.sourceBinding;
  let proof=d.production.mediaBinding;
  if(!proof){
    if(!referenceDocument?.review||!productionEqual(old,await createSourceBinding(referenceDocument.review)))throw new Error('缺少与原编排一致的来源凭据，请保留原稿，或移除编排后重新制作。');
    proof=mediaSnapshot(referenceDocument);
  }
  if(!productionEqual(proof,mediaSnapshot(d))||old.videoSha256!==d.review.videoSha256||old.sourceVideoSha256!==d.playDefinition.sourceBinding.sourceVideoSha256||old.frameMappingDigest!==proof.frameMappingDigest)throw new Error('视频、尺寸、帧映射、阶段或切镜已变化，不能重新绑定此视频编排。');
  for(const item of [...d.production.cameras,...d.production.timeline.cues]){
    const phase=phaseFor(d,item.phaseId);if(!productionEqual(item.phaseSnapshot,productionPhaseSnapshot(phase)))throw new Error('编排阶段已变化，不能自动重新绑定。');
    if(item.keyframes&&item.digest!==productionCameraDigest(item))throw new Error('示意相机已变化，请先核对相机。');
  }
  const targets=(d.annotations?.items??[]).filter(a=>a.authoredPath&&a.entityId===null),cuts=d.review.settings?.cuts??[];
  const oldNonTargets=new Set(annotationStatus(d).stale.filter(a=>!targets.some(t=>t.id===a.id)).map(a=>a.id));
  for(const a of targets){
    const camera=d.production.cameras.find(c=>c.id===a.authoredPath.cameraId),phase=phaseFor(d,a.phaseId);
    const sourceMatches=[old,d.playDefinition.sourceBinding].some(b=>productionEqual(a.sourceBinding,{videoSha256:b.videoSha256,trackingFingerprint:b.trackingFingerprint,reviewDigest:b.reviewDigest}));
    if(a.space!=='video'||a.followEntity||!productionEqual(a.phaseSnapshot,productionPhaseSnapshot(phase))||!sourceMatches)throw new Error('独立路线的参考阶段或来源已变化。');
    if(!camera||camera.phaseId!==a.phaseId||camera.digest!==productionCameraDigest(camera)||camera.digest!==a.authoredPath.cameraDigest||
      !productionCameraAt(camera,a.anchorFrame,cuts)||!productionCameraAt(camera,a.startFrame,cuts)||!productionCameraAt(camera,a.endFrameExclusive-1,cuts)||cuts.some(c=>c>Math.min(a.startFrame,a.anchorFrame)&&c<=Math.max(a.endFrameExclusive-1,a.anchorFrame)))throw new Error('路线的示意相机或完整显示区间已变化，请先核对相机。');
    a.sourceBinding={videoSha256:d.review.videoSha256,trackingFingerprint:d.review.trackingFingerprint,reviewDigest:d.playDefinition.sourceBinding.reviewDigest};
  }
  d.production.sourceBinding=productionSourceSnapshot(d);d.production.mediaBinding=clone(proof);
  const after=annotationStatus(d);
  if(after.active.some(a=>oldNonTargets.has(a.id)))throw new Error('恢复会影响非独立图形，请分别核对其人物与来源。');
  await validateDocument(d);return d;
}

/** Structural validation preserves stale records for explicit recovery instead of rebinding implicitly. */
export function validateProduction(document){
  const p=document.production;if(p===undefined)return [];
  const issues=[],bad=field=>issues.push({code:'invalid_production',severity:'fatal',details:{field}});
  try{canonicalJSON(p);}catch{bad('finite_json');return issues;}
  if(!exact(p,['schemaVersion','sourceBinding','cameras','timeline'],['mediaBinding'])||p.schemaVersion!==1||!exact(p.sourceBinding,Object.keys(document.playDefinition.sourceBinding))||Object.values(p.sourceBinding).some(v=>typeof v!=='string')||!Array.isArray(p.cameras)||p.cameras.length>40){bad('production');return issues;}
  if(p.mediaBinding!==undefined){const m=p.mediaBinding;if(!exact(m,['version','videoSha256','width','height','frameMappingDigest','phaseDigest','cutsDigest'])||m.version!==1||!frame(m.width)||!m.width||!frame(m.height)||!m.height||typeof m.videoSha256!=='string'||!m.videoSha256.length||!['frameMappingDigest','phaseDigest','cutsDigest'].every(k=>/^[a-f0-9]{64}$/.test(m[k]))||m.videoSha256!==p.sourceBinding.videoSha256||m.frameMappingDigest!==p.sourceBinding.frameMappingDigest)bad('production_media_binding');}
  const n=document.review.sourceFrameMapping.length,ids=new Set(),cuts=document.review.settings?.cuts??[];
  for(const c of p.cameras){
    if(!exact(c,['id','phaseId','phaseSnapshot','approximate','groundQuad','keyframes','digest'],['origin'])||typeof c.id!=='string'||!c.id.length||c.id.length>256||ids.has(c.id)||c.approximate!==true||typeof c.phaseId!=='string'||!snapshotValid(c.phaseSnapshot)||c.phaseId!==c.phaseSnapshot.phaseId||!validQuad(c.groundQuad)||c.groundQuad.flat().some(v=>Math.abs(v)>1000)||!/^[a-f0-9]{64}$/.test(c.digest??'')||!Array.isArray(c.keyframes)||!c.keyframes.length||c.keyframes.length>120){bad('production_camera');continue;}
    ids.add(c.id);
    for(const [i,k] of c.keyframes.entries()){
      if(!exact(k,['frame','quad','evidenceFrames'])||!frame(k.frame)||k.frame<c.phaseSnapshot.startFrame||k.frame>=c.phaseSnapshot.endFrameExclusive||k.frame>=n||i&&k.frame<=c.keyframes[i-1].frame||!validQuad(k.quad)||k.quad.flat().some(v=>Math.abs(v)>65536)||!Array.isArray(k.evidenceFrames)||!k.evidenceFrames.length||k.evidenceFrames.length>40||k.evidenceFrames.some(f=>!frame(f)||f>=n)){bad('production_camera_keyframe');continue;}
      if(i){const previous=c.keyframes[i-1];if(!validQuad(previous.quad))continue;
        if(cuts.some(cut=>cut>previous.frame&&cut<=k.frame))bad('production_camera_cut');
        // Check every source frame: two valid endpoint quadrilaterals need not interpolate safely.
        for(let f=previous.frame;f<=k.frame;f++)if(!productionCameraAt(c,f,cuts)){bad('production_camera_interpolation');break;}
      }
    }
    if(c.origin!==undefined&&(!exact(c.origin,['kind','jobId','sourceFrames','note'])||!['agent','human_modified'].includes(c.origin.kind)||typeof c.origin.jobId!=='string'||!Array.isArray(c.origin.sourceFrames)||c.origin.sourceFrames.some(f=>!frame(f)||f>=n)||typeof c.origin.note!=='string'||c.origin.note.length>2000))bad('production_camera_origin');
  }
  const t=p.timeline;
  if(!exact(t,['timebaseFps','cues','endHoldFrames'])||!finite(t.timebaseFps)||t.timebaseFps<1||t.timebaseFps>120||!Array.isArray(t.cues)||t.cues.length>256||!frame(t.endHoldFrames)||t.endHoldFrames>3600){bad('production_timeline');return issues;}
  const cueIds=new Set();
  for(const c of t.cues){const key=`${c.phaseId}:${c.frame}`;
    if(!exact(c,['phaseId','frame','settleFrames','drawFrames','holdFrames','easing','phaseSnapshot'])||!snapshotValid(c.phaseSnapshot)||c.phaseId!==c.phaseSnapshot.phaseId||!frame(c.frame)||c.frame<c.phaseSnapshot.startFrame||c.frame>=c.phaseSnapshot.endFrameExclusive||c.frame>=n||!['settleFrames','drawFrames','holdFrames'].every(k=>frame(c[k])&&c[k]<=3600)||c.easing!=='smoothstep'||cueIds.has(key))bad('production_cue');cueIds.add(key);
  }
  return issues;
}
export function updateProductionCamera(document,id,patch,{rebindRoutes=false}={}){
  if(typeof id!=='string'||!id.length||!exact(patch,[],['id','phaseId','phaseSnapshot','approximate','groundQuad','keyframes','digest','origin']))throw new Error('相机修改字段不正确。');
  const d=clone(document);d.production??=emptyProduction(d);const old=d.production.cameras.find(c=>c.id===id);
  if(patch.id!==undefined&&patch.id!==id)throw new Error('相机编号不可更换。');
  const phase=phaseFor(d,patch.phaseId??old?.phaseId),camera={...old,...clone(patch),id,phaseId:phase.phaseId,phaseSnapshot:productionPhaseSnapshot(phase),approximate:patch.approximate??old?.approximate??true};
  if(camera.origin)camera.origin.kind='human_modified';camera.digest=productionCameraDigest(camera);
  if(old)d.production.cameras=d.production.cameras.map(c=>c.id===id?camera:c);else d.production.cameras.push(camera);
  // A camera adjustment can rebind its geometry, but only explicit media recovery may replace its source proof.
  if(rebindRoutes){for(const a of d.annotations?.items??[])if(a.authoredPath?.cameraId===id){a.authoredPath.cameraDigest=camera.digest;if(a.origin)a.origin.kind='human_modified';}}
  fail(validateProduction(d));return d;
}
export function updateProductionCue(document,input){
  if(!exact(input,['phaseId','frame','settleFrames','drawFrames','holdFrames']))throw new Error('冻结编排字段不正确。');
  const d=clone(document);d.production??=emptyProduction(d);const phase=phaseFor(d,input.phaseId),cue={...clone(input),easing:'smoothstep',phaseSnapshot:productionPhaseSnapshot(phase)};
  const list=d.production.timeline.cues,index=list.findIndex(c=>c.phaseId===cue.phaseId&&c.frame===cue.frame);if(index>=0)list[index]=cue;else list.push(cue);
  list.sort((a,b)=>a.frame-b.frame);fail(validateProduction(d));return d;
}
export function updateAuthoredProgress(document,id,progressFrames){
  const a=document.annotations?.items.find(a=>a.id===id);if(!a?.authoredPath)throw new Error('未找到可编排路线。');
  return updateAnnotation(document,id,{authoredPath:{...clone(a.authoredPath),progressFrames:clone(progressFrames)}});
}

export function compileProduction(document,{fps=30}={}){
  const v2Timing=document.schemaVersion===2&&!document.legacyTiming;
  if(!finite(fps)||fps<1||fps>120)throw new Error('导出帧率不正确。');fail(validateProduction(document));
  if(document.schemaVersion===2){const gaps=courtProjectionGaps(document);if(gaps.length)throw new Error('实拍投影缺口：'+gaps.map(g=>`${g.annotationId} [${g.startFrame},${g.endFrameExclusive})`).join('、'));}
  const production=document.production,phases=document.playDefinition.phases,mapping=document.review.sourceFrameMapping;
  if(production&&!productionEqual(production.sourceBinding,productionSourceSnapshot(document)))throw new Error('编排来源已变化，请重新绑定。');
  if(annotationStatus(document).stale.length)throw new Error('含失效图形，请重新绑定后导出。');
  for(const a of document.annotations?.items??[])if(a.authoredPath){
    const camera=production.cameras.find(c=>c.id===a.authoredPath.cameraId),cuts=document.review.settings?.cuts??[];
    if(!productionCameraAt(camera,a.startFrame,cuts)||!productionCameraAt(camera,a.endFrameExclusive-1,cuts)||cuts.some(c=>c>a.startFrame&&c<a.endFrameExclusive))throw new Error(`路线 ${a.id} 的示意相机不能覆盖完整显示区间。`);
  }
  for(const c of [...(production?.cameras??[]),...(production?.timeline.cues??[])]){const phase=phases.find(p=>p.phaseId===c.phaseId);if(!phase||!productionEqual(c.phaseSnapshot,productionPhaseSnapshot(phase)))throw new Error('编排阶段已变化，请重新绑定。');}
  const timeline=production?.timeline??{timebaseFps:30,cues:[],endHoldFrames:0},explicit=new Map(timeline.cues.map(c=>[`${c.phaseId}:${c.frame}`,c]));
  // Ordinary reference-only annotations also receive a stable explanatory hold.
  const points=v2Timing?[]:annotationPausePoints(document),all=v2Timing?[]:[...phases.map(p=>({phaseId:p.phaseId,frame:p.freezeFrame})),...points];
  for(const cue of compileTacticKeyframes(document)){
    const key=`${cue.phaseId}:${cue.frame}`,previous=explicit.get(key),timing=cue.kind==='explanation'?explanationTiming(cue.holdSeconds,timeline.timebaseFps):{settleFrames:0,drawFrames:Math.min(15,Math.round(cue.holdSeconds*timeline.timebaseFps)),holdFrames:Math.max(0,Math.round(cue.holdSeconds*timeline.timebaseFps)-15)};
    // Same source frame is one hold even when an old authored cue is present.
    explicit.set(key,{...cue,...(previous&&previous.settleFrames+previous.drawFrames+previous.holdFrames>=timing.settleFrames+timing.drawFrames+timing.holdFrames?previous:timing)});
  }
  for(const c of all)if(!explicit.has(`${c.phaseId}:${c.frame}`))explicit.set(`${c.phaseId}:${c.frame}`,productionCue(document,c));
  const frames=[],start=document.playDefinition.startFrame,end=document.playDefinition.endFrameExclusive,first=mapping[start].time;
  const step=end-start>1?mapping[end-1].time-mapping[end-2].time:1/fps,duration=v2Timing?rangeToSeconds(mapping,{startFrame:start,endFrameExclusive:end},document.review.mediaEndTime).endSeconds-first:mapping[end-1].time-first+step,total=Math.max(1,Math.round(duration*fps)),seen=new Set();let local=start;
  const add=(f,state,reveal)=>{const phase=phases.find(p=>f>=p.startFrame&&f<p.endFrameExclusive);frames.push({sourceFrame:f,sourceTime:mapping[f].time,assetFrame:f,reviewTimeSeconds:mapping[f].time,state,reveal,phaseId:phase.phaseId});if(frames.length>108000)throw new Error('导出时长超出一小时限制。');};
  const addCue=cue=>{
    seen.add(`${cue.phaseId}:${cue.frame}`);const scale=fps/timeline.timebaseFps,settle=Math.round(cue.settleFrames*scale),draw=Math.round(cue.drawFrames*scale),hold=Math.round(cue.holdFrames*scale);
    for(let n=0;n<settle+draw+hold;n++){const u=draw?Math.max(0,Math.min(1,(n-settle)/draw)):1;add(cue.frame,n<settle?'settle':n<settle+draw?'draw':'hold',n<settle?0:u*u*(3-2*u));}
  };
  for(let i=0;i<total;i++){
    const time=first+i/fps;while(local+1<end&&mapping[local+1].time<=time+1e-7)local++;
    // Include cues skipped by a lower output frame rate at their precise source frame.
    for(const cue of [...explicit.values()].filter(c=>!seen.has(`${c.phaseId}:${c.frame}`)&&c.frame<=local).sort((a,b)=>a.frame-b.frame)){
      addCue(cue);
    }
    add(local,'source',1);
  }
  for(const cue of [...explicit.values()].filter(c=>!seen.has(`${c.phaseId}:${c.frame}`)).sort((a,b)=>a.frame-b.frame))addCue(cue);
  for(let i=0;i<Math.round(timeline.endHoldFrames*fps/timeline.timebaseFps);i++)add(end-1,'hold',1);
  return {schemaVersion:1,engineVersion:'authored-production-v1',fps,width:document.review.width,height:document.review.height,totalFrames:frames.length,frames};
}
export function sampleProduction(plan,index){if(!frame(index)||index>=plan.frames.length)throw new Error('成片帧超出范围。');return clone(plan.frames[index]);}
/** Media-owned joint timelines still render ordinary native annotations. */
export function validateProductionSnapshot(document,plan){
  if(!plan||!Array.isArray(plan.frames)||plan.frames.length!==plan.totalFrames||!plan.frames.length||plan.frames.length>18000||
     !Number.isSafeInteger(plan.fps)||plan.fps<1||plan.fps>120||plan.width!==document.review.width||plan.height!==document.review.height)throw new Error('成片快照尺寸或时间线无效。');
  const mapping=document.review.sourceFrameMapping,play=document.playDefinition;let previous=-1;
  for(const state of plan.frames){
    const f=state.sourceFrame,phase=play.phases.find(p=>f>=p.startFrame&&f<p.endFrameExclusive);
    if(!frame(f)||f<play.startFrame||f>=play.endFrameExclusive||f<previous||state.assetFrame!==f||
       state.sourceTime!==mapping[f]?.time||state.reviewTimeSeconds!==mapping[f]?.time||state.phaseId!==phase?.phaseId||
       !['source','settle','draw','hold'].includes(state.state)||!finite(state.reveal)||state.reveal<0||state.reveal>1)throw new Error('成片快照源帧或图形状态无效。');
    previous=f;
  }
  return plan;
}
export function renderProductionSvg(document,frameState){
  if(!frame(frameState?.sourceFrame)||!finite(frameState.reveal)||frameState.reveal<0||frameState.reveal>1)throw new Error('成片显示状态无效。');
  return renderAnnotationsSVG(projectAnnotations(document,{phaseId:frameState.phaseId,frame:frameState.sourceFrame,reveal:frameState.reveal,production:true,freeze:document.schemaVersion===2&&frameState.state!=='source'}));
}

/** Explicit source-locked migration: these become ordinary editable annotations, never a second routes list. */
export async function importAuthoredProduction(document,legacyConfig){
  await validateDocument(document);const old=clone(legacyConfig),d=clone(document),count=d.review.sourceFrameMapping.length;
  if(old.schemaVersion!==1||old.sourceSha256!==d.review.videoSha256||old.width!==d.review.width||old.height!==d.review.height||old.timeline?.sourceFrames!==count)throw new Error('旧编排与当前视频来源或尺寸不符。');
  if(d.annotations?.items.length||d.production||d.playDefinition.phases.length>1||d.playDefinition.actions.length||d.playDefinition.relations.length||d.presentation?.routes?.length)throw new Error('当前已有人工图形或编排，请在空白草稿导入，避免覆盖。');
  if(!Array.isArray(old.routes)||!old.routes.length||!Array.isArray(old.timeline.freezeFrames)||!old.timeline.freezeFrames.length||!finite(old.fps))throw new Error('旧编排格式不正确。');
  const freezes=old.timeline.freezeFrames,starts=[0,...freezes.slice(1)],play=d.playDefinition;
  play.phases=starts.map((start,i)=>({phaseId:`authored-phase-${i+1}`,order:i,title:`阶段 ${i+1}`,startFrame:start,endFrameExclusive:starts[i+1]??count,freezeFrame:freezes[i],participantIds:play.participants.map(p=>p.id),actionIds:[],relationIds:[]}));reindexPhases(play);
  d.production=emptyProduction(d);d.production.timeline.timebaseFps=old.fps;d.production.timeline.endHoldFrames=old.timeline.endHoldFrames;
  for(const [index,phase] of play.phases.entries()){
    const from=phase.startFrame,to=phase.endFrameExclusive-1,source={...old.camera,keyframes:old.camera.keyframes};
    const keyframes=[...new Set([from,...source.keyframes.filter(k=>k.frame>=from&&k.frame<=to).map(k=>k.frame),to])].sort((a,b)=>a-b).map(frame=>{const map=productionCameraAt(source,frame);if(!map)throw new Error('旧相机不能覆盖阶段。');return {frame,quad:map.quad,evidenceFrames:[frame]};});
    const camera={id:`authored-camera-${index+1}`,phaseId:phase.phaseId,phaseSnapshot:productionPhaseSnapshot(phase),approximate:true,groundQuad:clone(old.camera.groundQuad),keyframes};camera.digest=productionCameraDigest(camera);d.production.cameras.push(camera);
    const settle=old.timeline.freezeReveal.settleFrames,draw=old.timeline.freezeReveal.drawFrames;
    d.production.timeline.cues.push({phaseId:phase.phaseId,frame:phase.freezeFrame,settleFrames:settle,drawFrames:draw,holdFrames:old.timeline.insertedHoldFrames-settle-draw,easing:'smoothstep',phaseSnapshot:productionPhaseSnapshot(phase)});
  }
  fail(validateProduction(d));let result=d;const hex=rgb=>'#'+rgb.map(n=>n.toString(16).padStart(2,'0')).join(''),s=old.style;
  for(const route of old.routes){const phase=play.phases[route.phase-1],camera=d.production.cameras[route.phase-1];if(!phase)throw new Error('旧路线阶段无效。');
    result=createAnnotation(result,{id:route.id,type:'route',entityId:null,phaseId:phase.phaseId,frame:route.refFrame,startFrame:route.visibleFromFrame,endFrameExclusive:route.endFrame,space:'video',points:route.controlPoints.map(([x,y])=>({x,y})),style:{color:hex(s.fillRgb)},authoredPath:{version:1,curve:'cubic_bezier',cameraId:camera.id,cameraDigest:camera.digest,progressFrames:route.progressFrames.map(([frame,t])=>({frame,t})),ribbon:{bodyWidth:s.bodyWidthMetres,headLength:s.arrowLengthMetres,headWidth:s.arrowWidthMetres,fadeRemaining:s.fadeRemainingMetres,edgeColor:hex(s.edgeRgb),edgePixels:s.edgePixels,opacity:s.opacity}}});
  }
  await validateDocument(result);return result;
}
