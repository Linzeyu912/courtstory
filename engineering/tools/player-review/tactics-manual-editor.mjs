// Interaction helpers for the existing annotation document, never a second renderer.
import {createAnnotation,updateAnnotation,sampleAnnotationCurve} from './tactics-annotations.mjs';
import {validateFrameRange} from './tactics-time-range.mjs';
import {validateTacticKeyframes} from './tactics-keyframes.mjs';
import {cubicBezier,productionCameraAt} from './tactics-authored-geometry.mjs';
import {project} from './court.mjs';

export function createManualAnnotation(document,input){
  const range=validateFrameRange(document.review.sourceFrameMapping,input.range);
  if(document.schemaVersion!==2)throw new Error('旧稿需显式迁移后才能使用新的秒级标注；旧内容会保留副本。');
  if((document.review.settings?.cuts??[]).some(c=>c>range.startFrame&&c<range.endFrameExclusive))throw new Error('区间跨镜头切换，请分段绘制。');
  const pattern=input.pattern??input.style?.pattern??'solid';let points=structuredClone(input.points);
  const cubic=input.type==='route'&&pattern!=='dots';
  if(cubic&&points.length===2){const [a,b]=points;points=[a,{x:a.x+(b.x-a.x)/3,y:a.y+(b.y-a.y)/3},{x:a.x+2*(b.x-a.x)/3,y:a.y+2*(b.y-a.y)/3},b];}
  return createAnnotation(document,{...input,...range,frame:input.frame??range.startFrame,points,
    timingMode:'manual',...(input.space==='video'?{videoMode:'fixed',referenceSize:{width:document.review.width,height:document.review.height}}:{}),
    style:{...(input.type==='route'?{pattern}:{}),...input.style},followEntity:input.followEntity??(input.type==='spotlight'&&!!input.entityId),
    actionRange:{...range},cueFrame:range.startFrame,displayMode:input.type==='route'&&pattern==='solid'?'remaining':'full',curve:cubic?'cubic_bezier':'polyline',
    progressFrames:[{frame:range.startFrame,t:0},{frame:range.endFrameExclusive,t:1}],meaning:input.type==='route'?(pattern==='solid'?'current_action':'pass'):input.type==='screen'?'screen':'focus'});
}

// Resize in source PTS, not source frame counts. End-of-media is an explicit sentinel.
export function retimeProgress(document,keys,old,range){
  const m=document.review.sourceFrameMapping,time=f=>f===m.length?document.review.mediaEndTime:m[f].time;
  const first=time(old.startFrame),span=time(old.endFrameExclusive)-first,start=time(range.startFrame),duration=time(range.endFrameExclusive)-start;
  const result=keys.map((p,i)=>({t:p.t,frame:i===0?range.startFrame:i===keys.length-1?range.endFrameExclusive:m.findIndex(k=>k.time>=start+(time(p.frame)-first)/span*duration-1e-9)}));
  if(result.some((p,i)=>p.frame<range.startFrame||p.frame>range.endFrameExclusive||i&&p.frame<=result[i-1].frame))throw new Error('区间过短，校正点吸附到了同一帧；请延长区间或先删除相邻校正点。');
  return result;
}
export function setManualAnnotationRange(document,id,range,{detachCue=false,scope='linked'}={}){
  validateFrameRange(document.review.sourceFrameMapping,range);
  const a=document.annotations?.items.find(a=>a.id===id);if(!a)throw new Error('未找到标注。');
  if(!['linked','action','visibility'].includes(scope))throw new Error('时间编辑类型无效。');
  const p=document.playDefinition.phases.find(p=>p.phaseId===a.phaseId);
  if(range.startFrame<p.startFrame||range.endFrameExclusive>p.endFrameExclusive)throw new Error('区间不能越过所属阶段，请拆成另一条动作。');
  if((document.review.settings?.cuts??[]).some(c=>c>range.startFrame&&c<range.endFrameExclusive))throw new Error('区间跨镜头切换，请分段绘制。');
  let next=structuredClone(document),patch={};
  const start=scope==='visibility'?(a.actionRange??a).startFrame:range.startFrame;
  const conflicts=(next.tacticKeyframes?.items??[]).filter(k=>k.annotationIds.includes(id)&&(k.kind==='explanation'?k.frame>start:scope!=='action'&&(k.frame<range.startFrame||k.frame>=range.endFrameExclusive)));
  if(conflicts.length&&!detachCue)throw new Error('讲解暂停点晚于新的动作起点；取消修改，或勾选“解除冲突的暂停关联”后应用。');
  if(detachCue)for(const k of conflicts)k.annotationIds=k.annotationIds.filter(ref=>ref!==id);
  if(scope!=='action')Object.assign(patch,range);
  if(scope!=='visibility'){
    const old=a.actionRange??a,keys=a.authoredPath?.progressFrames??a.progressFrames??[{frame:old.startFrame,t:0},{frame:old.endFrameExclusive,t:1}];
    const progressFrames=retimeProgress(document,keys,old,range);
    if(a.authoredPath)patch.authoredPath={...a.authoredPath,progressFrames};else Object.assign(patch,{actionRange:{...range},progressFrames,cueFrame:range.startFrame});
  }
  if(a.timingMode!=='manual'&&scope!=='action'&&(a.anchorFrame<range.startFrame||a.anchorFrame>=range.endFrameExclusive))throw new Error('旧稿参考帧不在新区间，请通过高级区间控件明确移动讲解点。');
  next=updateAnnotation(next,id,patch);validateTacticKeyframes(next);return next;
}
export function duplicateAnnotation(document,id,newId=`annotation-${crypto.randomUUID()}`){
  const a=document.annotations?.items.find(a=>a.id===id);if(!a)throw new Error('先选择要复制的标注。');
  const next=structuredClone(document);if(next.annotations.items.some(a=>a.id===newId))throw new Error('标注 ID 已存在。');
  next.annotations.items.push({...structuredClone(a),id:newId,name:(a.name??'标注')+' 副本'});
  for(const k of next.tacticKeyframes?.items??[])if(k.annotationIds.includes(id))k.annotationIds.push(newId);
  return next;
}
export function correctAnnotationProgress(document,id,frame,progress,{remove=false}={}){
  const a=document.annotations?.items.find(a=>a.id===id),range=a?.actionRange??a;
  if(!a||a.type!=='route'||(a.style.pattern??'solid')!=='solid')throw new Error('先选择一条跑位路线。');
  if(!Number.isSafeInteger(frame)||frame<=range.startFrame||frame>=range.endFrameExclusive)throw new Error('请把播放头放在动作起止之间；端点固定为开始 0 和结束 1。');
  const keys=structuredClone(a.authoredPath?.progressFrames??a.progressFrames??[{frame:range.startFrame,t:0},{frame:range.endFrameExclusive,t:1}]);
  let result=keys.filter(p=>p.frame!==frame);
  if(!remove){
    if(!Number.isFinite(progress)||progress<0||progress>1)throw new Error('完成进度必须在 0—1 内。');
    result.push({frame,t:progress});result.sort((a,b)=>a.frame-b.frame);
    if(result.some((p,i)=>i&&p.t<result[i-1].t))throw new Error('移动进度不能倒退；请调整相邻校正点或拆成另一条动作。');
  }
  return updateAnnotation(document,id,a.authoredPath?{authoredPath:{...a.authoredPath,progressFrames:result}}:{progressFrames:result});
}
export function nearestRouteProgress(document,a,point,{frame=a.anchorFrame}={}){
  // The ordinary V2 renderer samples 96 Bezier segments and trims by arc length.
  let samples=sampleAnnotationCurve(a);
  if(a.authoredPath){
    const camera=document.production.cameras.find(c=>c.id===a.authoredPath.cameraId),cuts=document.review.settings?.cuts??[],ref=productionCameraAt(camera,a.anchorFrame,cuts),now=productionCameraAt(camera,frame,cuts);
    if(!ref||!now)throw new Error('当前画面缺少编排相机支持，请先调整相机或定位到支持画面。');
    const controls=a.points.map(p=>project(ref.toGround,p.x,p.y));
    samples=Array.from({length:601},(_,i)=>{const p=cubicBezier(controls,i/600);return project(now.toImage,p.x,p.y);});
  }
  const lengths=samples.slice(1).map((p,i)=>Math.hypot(p.x-samples[i].x,p.y-samples[i].y)),total=lengths.reduce((a,b)=>a+b,0);
  if(total<1e-6)throw new Error('路线起终点过近，请先调整形状。');
  let best={distance:Infinity},walked=0;
  for(let i=0;i<lengths.length;i++){
    const p=samples[i],q=samples[i+1],dx=q.x-p.x,dy=q.y-p.y,n=dx*dx+dy*dy,t=n?Math.max(0,Math.min(1,((point.x-p.x)*dx+(point.y-p.y)*dy)/n)):0;
    const hit={x:p.x+t*dx,y:p.y+t*dy},distance=Math.hypot(hit.x-point.x,hit.y-point.y);
    if(distance<best.distance)best={distance,point:hit,progress:a.authoredPath?(i+t)/lengths.length:(walked+t*lengths[i])/total};
    walked+=lengths[i];
  }
  return best;
}
