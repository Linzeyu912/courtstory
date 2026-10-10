import {project} from './court.mjs';

const clamp=x=>Math.max(0,Math.min(1,x));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const observed=p=>p&&(['tracked','manual'].includes(p.source)||p.source==='manual_range'&&p.rangeCorrection?.method==='relative_keyframe_interpolation'&&['tracked','manual'].includes(p.rangeCorrection.originalSource))&&Number.isFinite(p.x)&&Number.isFinite(p.y);

/** Presentation-only denoising: retain the measured endpoints and meaningful bends. */
export function simplifyTrackedRoute(points,tolerance){
  if(points.length<3)return points;
  const filtered=points.map((p,i)=>i===0||i===points.length-1?p:{x:(points[i-1].x+2*p.x+points[i+1].x)/4,y:(points[i-1].y+2*p.y+points[i+1].y)/4});
  const simplify=list=>{
    const a=list[0],b=list.at(-1),dx=b.x-a.x,dy=b.y-a.y,n=dx*dx+dy*dy;
    let furthest=0,index=0;
    for(let i=1;i<list.length-1;i++){
      const p=list[i],t=n?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/n):0;
      const d=Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
      if(d>furthest){furthest=d;index=i;}
    }
    return furthest>tolerance?[...simplify(list.slice(0,index+1)).slice(0,-1),...simplify(list.slice(index))]:[a,b];
  };
  return simplify(filtered);
}

/** Sample measured positions in the current camera, never translate a destination with the player. */
export function trackedRoutePoints(context,a,frame,foot){
  const current=foot(context,a.entityId,frame);
  if(!current.point)return {reason:current.reason};
  if(context.cuts.some(c=>c>Math.min(a.anchorFrame,frame)&&c<=Math.max(a.anchorFrame,frame)))return {reason:'source_cut'};
  const mapping=context.maps[frame],ground=Boolean(mapping);
  if(a.space==='court'&&!ground)return {reason:'calibration_unavailable'};
  const start=Math.max(frame,a.actionRange?.startFrame??a.startFrame),end=a.actionRange?.endFrameExclusive??a.endFrameExclusive;
  const points=[];let previous=null,lastSample=-Infinity;
  for(let f=start;f<end;f++){
    if(f>start&&context.cuts.includes(f))break;
    const result=foot(context,a.entityId,f),observation=context.pointMaps.get(a.entityId)?.get(f);
    if(!result.point)break; // Do not draw across occlusion, identity conflicts or unobserved gaps.
    if(previous&&observation.trackId!==previous.trackId)break;
    let p=result.point;
    if(ground){
      const source=context.maps[f];if(!source)break;
      p=project(source.toCourt,p.x,p.y);if(!p)break;
      if(a.space==='video')p=project(mapping.toImage,p.x,p.y);
      if(!p)break;
    }
    const time=context.frames[f].time;
    // Absolute sampling buckets keep future bends stable as the source advances.
    const bucket=Math.floor(time/.12);
    if(!points.length||bucket>lastSample){points.push(p);lastSample=bucket;}
    previous={trackId:observation.trackId,point:p};
  }
  if(previous&&(!points.length||distance(points.at(-1),previous.point)>1e-6))points.push(previous.point);
  // Keep the render workload bounded without changing the stored observations.
  const sampled=points.length>24?Array.from({length:24},(_,i)=>points[Math.round(i*(points.length-1)/23)]):points;
  if(sampled.length<2)return {reason:'completed'};
  const length=sampled.slice(1).reduce((n,p,i)=>n+distance(p,sampled[i]),0);
  const tolerance=Math.max(a.space==='court'?.08:6*(context.review?.height??1080)/1080,length*.025);
  return {points:simplifyTrackedRoute(sampled,tolerance),trackingSpace:ground?'court':'video'};
}

/** One deterministic presentation clock is shared by the browser and exported frames. */
export function annotationReveal(a,annotations,reveal){
  const screens=annotations.filter(b=>b.type==='screen'&&b.anchorFrame===a.anchorFrame);
  if(a.type==='position'||a.type==='spotlight')return clamp(reveal/.25);
  if(a.type==='screen')return clamp((reveal-.08)/.3);
  if(!screens.length)return clamp((reveal-.12)/.88);
  const rolling=screens.some(b=>b.entityId&&b.entityId===a.entityId);
  return rolling?clamp((reveal-.58)/.42):clamp((reveal-.28)/.5);
}

/** Bind only when the Agent's visible anchor agrees with an existing observation. */
export function canFollowAnnotation(review,a){
  if(!a.entityId)return false;
  const p=review.entities.find(e=>e.id===a.entityId)?.trajectory.find(p=>p.frame===a.anchorFrame);
  if(!observed(p))return false;
  const tolerance=Math.max(48*review.height/1080,Array.isArray(p.box)?(p.box[2]-p.box[0])*.75:0);
  if(distance(p,a.points[0])>tolerance)return false;
  if(a.type==='route'){
    const trajectory=review.entities.find(e=>e.id===a.entityId).trajectory;
    // An observed position alone must not replace an authored later-action route.
    return trajectory.some(q=>q.frame>=a.startFrame&&q.frame<a.endFrameExclusive&&observed(q)&&distance(p,q)>8*review.height/1080);
  }
  return true;
}
