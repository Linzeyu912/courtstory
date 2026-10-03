import {canonicalJSON,createSourceBinding} from '../tactical-overlay/binding.mjs';
import {createGeometryContext,buildActionGeometry,crossCutCompatible} from '../tactical-overlay/geometry.mjs';
import {DEFAULT_OPTIONS,validateInputs} from '../tactical-overlay/validation.mjs';
import {COURT,project} from './court.mjs';

export const PRESENTATION_POLICY='future-route-v1';
export const PRESENTATION_LIMITS=Object.freeze({routes:1000,controlPoints:128,simplifyMetres:.08,smoothingMetres:.12,maxAnchorSeconds:.5});
const copy=value=>structuredClone(value);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.length>0&&v.length<=256;
const frame=v=>Number.isSafeInteger(v)&&v>=0;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const fields=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(k=>keys.includes(k));
const phaseSource=p=>({phaseId:p.phaseId,startFrame:p.startFrame,endFrameExclusive:p.endFrameExclusive,freezeFrame:p.freezeFrame});
const idFor=(phaseId,entityId,start,end)=>`${encodeURIComponent(phaseId)}:${encodeURIComponent(entityId)}:${start}-${end}`;

/** Validate stored edits independently of current phases: outdated edits remain importable. */
export function validatePresentation(presentation){
  if(presentation===undefined)return [];
  const errors=[],bad=field=>errors.push({code:'invalid_presentation',severity:'fatal',details:{field}});
  try{canonicalJSON(presentation);}catch{bad('finite_json');return errors;}
  if(!fields(presentation,['schemaVersion','routes'])||presentation.schemaVersion!==1||!Array.isArray(presentation.routes)||presentation.routes.length>PRESENTATION_LIMITS.routes){bad('presentation');return errors;}
  const seen=new Set();
  for(const r of presentation.routes){
    if(!fields(r,['routeId','phaseId','entityId','source','controlPoints'])||!text(r.routeId)||seen.has(r.routeId)||!text(r.phaseId)||!text(r.entityId)){bad('route_identifiers');continue;}seen.add(r.routeId);
    const s=r.source,p=s?.phase,b=s?.sourceBinding;
    if(!fields(s,['policy','sourceBinding','phase','startFrame','endFrameExclusive','options','geometryDigest'])||s.policy!==PRESENTATION_POLICY||
      !fields(b,['digestVersion','videoSha256','sourceVideoSha256','trackingFingerprint','trackingRevision','frameMappingDigest','reviewDigest'])||b.digestVersion!=='canonical-json-v1'||
      !['videoSha256','sourceVideoSha256','trackingFingerprint','trackingRevision'].every(k=>text(b[k]))||
      !['reviewDigest','frameMappingDigest'].every(k=>typeof b[k]==='string'&&/^[a-f0-9]{64}$/.test(b[k]))||
      !/^[a-f0-9]{64}$/.test(s.geometryDigest??'')){bad('source_binding');continue;}
    if(!fields(p,['phaseId','startFrame','endFrameExclusive','freezeFrame'])||p.phaseId!==r.phaseId||!frame(p.startFrame)||!frame(p.freezeFrame)||!frame(p.endFrameExclusive)||
      p.freezeFrame<p.startFrame||p.freezeFrame>=p.endFrameExclusive||!frame(s.startFrame)||!frame(s.endFrameExclusive)||
      s.startFrame<p.freezeFrame||s.endFrameExclusive>p.endFrameExclusive||s.endFrameExclusive-s.startFrame<2||
      r.routeId!==idFor(r.phaseId,r.entityId,s.startFrame,s.endFrameExclusive)){bad('source_range');continue;}
    if(!object(s.options)||Object.keys(s.options).length!==Object.keys(DEFAULT_OPTIONS).length||
      Object.keys(s.options).some(k=>!Object.hasOwn(DEFAULT_OPTIONS,k))||typeof s.options.previewNextPhase!=='boolean'||
      ['maxStepSeconds','maxSpeedMetresPerSecond','stationaryThresholdMetres','screenWidthMetres'].some(k=>!finite(s.options[k])||s.options[k]<0||(k!=='stationaryThresholdMetres'&&s.options[k]===0))){bad('source_options');continue;}
    if(!validControls(r.controlPoints,s.startFrame,s.endFrameExclusive))bad('control_points');
  }
  return errors;
}
function validControls(points,start,end){
  return Array.isArray(points)&&points.length>=2&&points.length<=PRESENTATION_LIMITS.controlPoints&&
    points[0]?.frame===start&&points.at(-1)?.frame===end-1&&points.every((p,i)=>fields(p,['frame','x','y'])&&frame(p.frame)&&p.frame>=start&&p.frame<end&&
      (!i||p.frame>points[i-1].frame)&&finite(p.x)&&finite(p.y)&&p.x>=0&&p.x<=COURT.length&&p.y>=0&&p.y<=COURT.width);
}
function assertPresentation(presentation){
  const issues=validatePresentation(presentation);
  if(issues.length)throw new Error(`展示修正无效：${issues.map(i=>i.details.field).join('、')}`);
}
async function digest(value){
  const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJSON(value)));
  return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
}

/** Time-aware simplification removes sub-tolerance wobble without changing retained frame anchors. */
function simplify(points){
  if(points.length<3)return points;
  const kept=new Set([0,points.length-1]),stack=[[0,points.length-1]];
  while(stack.length){
    const [a,b]=stack.pop();if(b-a<=1)continue;
    let worst=-1,index=-1;
    for(let i=a+1;i<b;i++){
      const t=(points[i].time-points[a].time)/(points[b].time-points[a].time);
      const error=distance(points[i],{x:points[a].x+(points[b].x-points[a].x)*t,y:points[a].y+(points[b].y-points[a].y)*t});
      if(error>worst){worst=error;index=i;}
    }
    if(worst>PRESENTATION_LIMITS.simplifyMetres||points[b].time-points[a].time>PRESENTATION_LIMITS.maxAnchorSeconds){
      if(worst<=PRESENTATION_LIMITS.simplifyMetres)index=Math.floor((a+b)/2);
      kept.add(index);stack.push([a,index],[index,b]);
    }
  }
  return [...kept].sort((a,b)=>a-b).map(i=>points[i]);
}
function interpolate(a,b,time){
  const t=(time-a.time)/(b.time-a.time);
  return {frame:a.frame+(b.frame-a.frame)*t,time,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
}
function atTime(points,time){
  if(time<=points[0].time)return {...points[0]};
  if(time>=points.at(-1).time)return {...points.at(-1)};
  let lo=0,hi=points.length-1;
  while(hi-lo>1){const m=(lo+hi)>>1;if(points[m].time<=time)lo=m;else hi=m;}
  return time===points[lo].time?{...points[lo]}:interpolate(points[lo],points[hi],time);
}
function tangents(points,key){
  const slopes=points.slice(1).map((p,i)=>(p[key]-points[i][key])/(p.time-points[i].time));
  return points.map((_,i)=>{
    if(!i)return slopes[0];if(i===points.length-1)return slopes.at(-1);
    const a=slopes[i-1],b=slopes[i];if(a*b<=0)return 0;
    const h0=points[i].time-points[i-1].time,h1=points[i+1].time-points[i].time;
    const w0=2*h1+h0,w1=h1+2*h0;return (w0+w1)/(w0/a+w1/b);
  });
}
function smooth(anchors,reference){
  if(anchors.length<2)return anchors.map(p=>({...p}));
  const tx=tangents(anchors,'x'),ty=tangents(anchors,'y'),result=[];
  for(let i=0;i<anchors.length-1;i++){
    const a=anchors[i],b=anchors[i+1],h=b.time-a.time;
    const steps=Math.max(4,Math.ceil(h/.025));
    for(let n=0;n<steps;n++){
      if(n===0){result.push({...a});continue;}
      const t=n/steps,t2=t*t,t3=t2*t,time=a.time+h*t;
      const cubic=(key,ts)=>(2*t3-3*t2+1)*a[key]+(t3-2*t2+t)*h*ts[i]+(-2*t3+3*t2)*b[key]+(t3-t2)*h*ts[i+1];
      let x=cubic('x',tx),y=cubic('y',ty);const raw=atTime(reference,time),delta=distance({x,y},raw);
      if(delta>PRESENTATION_LIMITS.smoothingMetres){const s=PRESENTATION_LIMITS.smoothingMetres/delta;x=raw.x+(x-raw.x)*s;y=raw.y+(y-raw.y)*s;}
      result.push({frame:a.frame+(b.frame-a.frame)*t,time,x,y});
    }
  }
  result.push({...anchors.at(-1)});return result;
}
function controlsFor(points){
  const simple=simplify(points),count=PRESENTATION_LIMITS.controlPoints;
  const limited=simple.length<=count?simple:Array.from({length:count},(_,i)=>simple[Math.round(i*(simple.length-1)/(count-1))]);
  return limited.map(({frame,x,y})=>({frame,x,y}));
}
function curveFor(points,manual){
  const anchors=manual?points:simplify(points),curve=smooth(anchors,points);
  // Stationary trailing observations carry no further route: completion follows arrival.
  let last=points.length-1;
  while(last>0&&distance(points[last-1],points.at(-1))<1e-7)last--;
  const arrival=points[last].time;
  return curve.filter(p=>p.time<arrival).concat({...points[last]});
}

/** Build once per document/phase change. Playback consumes cached curves, never refits them. */
export async function buildPhaseRoutes(document,phaseId,options={}){
  assertPresentation(document?.presentation);
  const {review,playDefinition:play}=document??{},phase=play?.phases?.find(p=>p.phaseId===phaseId);
  const issues=validateInputs({review,playDefinition:play,phaseId,freezeFrame:phase?.freezeFrame,options});
  if(issues.some(i=>i.severity==='fatal'))throw new Error(`路线来源无效：${issues.map(i=>i.details?.field??i.code).join('、')}`);
  const binding=await createSourceBinding(review);
  if(!same(binding,play.sourceBinding))throw new Error('轨迹快照已变化，请更新战术绑定后重新核对。');
  const config={...DEFAULT_OPTIONS,...options},context=createGeometryContext(review,play,phase.freezeFrame,config),routes=[],breaks=[];
  for(const entityId of [...new Set(phase.participantIds)]){
    const geometry=buildActionGeometry(context,{actionId:`presentation:${entityId}`,actorId:entityId,kind:'move',temporalStatus:'active',
      startFrame:phase.freezeFrame,endFrameExclusive:phase.endFrameExclusive});
    breaks.push(...geometry.breaks);issues.push(...geometry.issues);
    for(const segment of geometry.segments){
      if(segment.points.length<2)continue;
      const startFrame=segment.points[0].frame,endFrameExclusive=segment.points.at(-1).frame+1;
      const source={policy:PRESENTATION_POLICY,sourceBinding:copy(binding),phase:phaseSource(phase),startFrame,endFrameExclusive,
        options:copy(config),geometryDigest:await digest({points:segment.points,breakBefore:segment.breakBefore,breakAfter:segment.breakAfter})};
      const sourcePoints=segment.points.map(p=>({frame:p.frame,time:p.time,x:p.courtPoint.x,y:p.courtPoint.y}));
      routes.push({routeId:idFor(phaseId,entityId,startFrame,endFrameExclusive),phaseId,entityId,startFrame,endFrameExclusive,
        source,sourcePoints,controlPoints:controlsFor(sourcePoints),curve:curveFor(sourcePoints,false),manual:false,
        breakBefore:segment.breakBefore,breakAfter:segment.breakAfter});
    }
  }
  const status=presentationStatus(document,routes,{phaseId,options:config});
  for(const route of routes){
    const edit=status.applied.find(r=>r.routeId===route.routeId);
    if(!edit)continue;
    route.manual=true;route.controlPoints=copy(edit.controlPoints);
    const timed=edit.controlPoints.map(p=>({...p,time:review.sourceFrameMapping[p.frame].time}));
    route.curve=curveFor(timed,true);
  }
  return {schemaVersion:1,phaseId,phase:copy(phaseSource(phase)),sourceBinding:binding,routes,breaks,issues,presentation:status,
    width:review.width,height:review.height,context};
}

/** Applied/stale/pending distinguish other phases from edits that no longer match geometry. */
export function presentationStatus(document,routes,{phaseId,options={...DEFAULT_OPTIONS}}={}){
  assertPresentation(document.presentation);
  const result={applied:[],stale:[],pending:[]};
  for(const edit of document.presentation?.routes??[]){
    const phase=document.playDefinition.phases.find(p=>p.phaseId===edit.phaseId),route=routes.find(r=>r.routeId===edit.routeId);
    let reason=null;
    if(!same(edit.source.sourceBinding,document.playDefinition.sourceBinding))reason='source_changed';
    else if(!phase||!same(edit.source.phase,phaseSource(phase))||!phase.participantIds.includes(edit.entityId))reason='phase_changed';
    else if(!same(edit.source.options,{...DEFAULT_OPTIONS,...options}))reason='policy_changed';
    else if(route&&!same(edit.source,route.source))reason='geometry_changed';
    else if(!route&&(edit.phaseId===phaseId||!phaseId))reason='route_unavailable';
    if(reason)result.stale.push({...copy(edit),reason});else if(route)result.applied.push(copy(edit));else result.pending.push(copy(edit));
  }
  return result;
}

/** Replace one route's controls. End frame anchors stay fixed; x/y may be edited in court metres. */
export function updateRouteControlPoints(document,route,controlPoints){
  assertPresentation(document.presentation);
  const phase=document.playDefinition.phases.find(p=>p.phaseId===route?.phaseId);
  if(!phase||!phase.participantIds.includes(route.entityId)||!same(route.source?.phase,phaseSource(phase))||
    !same(route.source?.sourceBinding,document.playDefinition.sourceBinding))throw new Error('路线来源已变化，请重新选择有效路线。');
  const edit={routeId:route.routeId,phaseId:route.phaseId,entityId:route.entityId,source:copy(route.source),controlPoints:copy(controlPoints)};
  const d=copy(document);d.presentation??={schemaVersion:1,routes:[]};
  const index=d.presentation.routes.findIndex(r=>r.routeId===route.routeId);
  if(index<0)d.presentation.routes.push(edit);else d.presentation.routes[index]=edit;
  assertPresentation(d.presentation);return d;
}
export function restoreRoute(document,routeId){
  const d=copy(document);
  if(d.presentation){d.presentation.routes=d.presentation.routes.filter(r=>r.routeId!==routeId);if(!d.presentation.routes.length)delete d.presentation;}
  return d;
}
export function extractRouteControlPoints(route){return copy(route.controlPoints);}

/** Pointer-move preview: one curve only, no document clone, hashing or persistence. */
export function previewRouteControlPoints(route,controlPoints){
  if(!validControls(controlPoints,route.startFrame,route.endFrameExclusive))throw new Error('展示修正无效：control_points');
  const times=new Map(route.sourcePoints.map(p=>[p.frame,p.time]));
  const timed=controlPoints.map(p=>{
    if(!times.has(p.frame))throw new Error('控制帧不在合法路线段内。');
    return {...p,time:times.get(p.frame)};
  });
  return {...route,manual:true,controlPoints:copy(controlPoints),curve:curveFor(timed,true)};
}

/** mediaTime is the video's local currentTime, not sourceTime and not wall-clock time. */
export function clipRoute(route,mediaTime){
  if(!finite(mediaTime))throw new Error('媒体时间必须为有限秒数。');
  const points=route.curve;
  if(points.length<2||mediaTime>=points.at(-1).time)return null;
  const curve=mediaTime<=points[0].time?copy(points):[atTime(points,mediaTime),...points.filter(p=>p.time>mediaTime).map(copy)];
  return {...route,curve};
}
export function courtToVideo(model,frameNumber,point){
  const mapping=frame(frameNumber)?model.context.maps[frameNumber]:null;
  return mapping?project(mapping.toImage,point?.x,point?.y):null;
}
export function videoToCourt(model,frameNumber,point){
  const mapping=frame(frameNumber)?model.context.maps[frameNumber]:null;
  return mapping?project(mapping.toCourt,point?.x,point?.y):null;
}
function courtDecoration(curve){
  const chevrons=[];let travelled=0,next=.7;
  for(let i=1;i<curve.length;i++){
    const a=curve[i-1],b=curve[i],n=distance(a,b);if(n<1e-9)continue;
    while(next<=travelled+n){
      const t=(next-travelled)/n,tip={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},ux=(b.x-a.x)/n,uy=(b.y-a.y)/n;
      chevrons.push([{x:tip.x-ux*.28-uy*.16,y:tip.y-uy*.28+ux*.16},tip,{x:tip.x-ux*.28+uy*.16,y:tip.y-uy*.28-ux*.16}]);next+=.9;
    }
    travelled+=n;
  }
  const end=curve.at(-1),ring=Array.from({length:33},(_,i)=>({x:end.x+.3*Math.cos(i/32*Math.PI*2),y:end.y+.3*Math.sin(i/32*Math.PI*2)}));
  return {curve:curve.map(({x,y})=>({x,y})),chevrons,ring};
}
function projectDecoration(court,mapping){
  const map=list=>list.map(p=>project(mapping.toImage,p.x,p.y));
  const video={curve:map(court.curve),chevrons:court.chevrons.map(map),ring:map(court.ring)};
  return [...video.curve,...video.chevrons.flat(),...video.ring].every(Boolean)?video:null;
}
/** Selection defaults to the first phase participant; showAll opts into every available route. */
export function projectPhaseRoutes(model,{frame:currentFrame,mediaTime,selectedEntityId,showAll=false}={}){
  if(!frame(currentFrame)||!model.context.frames[currentFrame])throw new Error('当前帧超出来源范围。');
  const time=mediaTime??model.context.frames[currentFrame].time;
  if(!finite(time))throw new Error('媒体时间必须为有限秒数。');
  const selected=selectedEntityId??model.context.playDefinition.phases.find(p=>p.phaseId===model.phaseId).participantIds[0];
  const mapping=model.context.maps[currentFrame],currentContext={...model.context,freezeFrame:currentFrame};
  const routes=[];
  for(const original of model.routes){
    if(!showAll&&original.entityId!==selected)continue;
    const remaining=clipRoute(original,time);if(!remaining)continue;
    const travel=original.curve.slice(1).reduce((n,p,i)=>n+distance(p,original.curve[i]),0);
    if(travel<=model.context.options.stationaryThresholdMetres)continue;
    const court=courtDecoration(remaining.curve),compatible=crossCutCompatible(currentContext,original.startFrame)&&crossCutCompatible(currentContext,original.endFrameExclusive-1);
    const video=mapping&&compatible?projectDecoration(court,mapping):null;
    routes.push({routeId:original.routeId,entityId:original.entityId,manual:original.manual,selected:original.entityId===selected,
      remaining,court,video,projectionReason:!mapping?'calibration_unavailable':!compatible?'court_reference_mismatch':!video?'projection_unavailable':null});
  }
  return {frame:currentFrame,mediaTime:time,width:model.width,height:model.height,videoAvailable:!!mapping,routes};
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function renderPresentationSVG(scene,{space='video',width=scene.width,height=scene.height}={}){
  if(!['video','court'].includes(space)||!finite(width)||!finite(height)||width<=0||height<=0)throw new Error('检查绘图空间及尺寸。');
  const view=space==='court'?`0 0 ${COURT.length} ${COURT.width}`:`0 0 ${scene.width} ${scene.height}`;
  const line=points=>points.map(p=>`${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' '),parts=[];
  for(const route of scene.routes){
    const geometry=route[space];if(!geometry)continue;
    const color=route.selected?'#ffca59':'#75d6ff',stroke=space==='court'?.065:3,outline=space==='court'?.13:6;
    const paths=[geometry.curve,...geometry.chevrons,geometry.ring].map(points=>`<polyline points="${line(points)}"/>`).join('');
    parts.push(`<g data-route-id="${escape(route.routeId)}" data-manual="${route.manual}" opacity="${route.selected?1:.45}" fill="none" stroke-linecap="round" stroke-linejoin="round">`);
    parts.push(`<g stroke="#ffffff" stroke-opacity=".85" stroke-width="${outline}">${paths}</g><g stroke="${color}" stroke-width="${stroke}">${paths}</g></g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${view}" aria-label="未来路线">${parts.join('')}</svg>`;
}
