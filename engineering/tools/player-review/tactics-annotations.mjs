import {sourceProgress,validateFrameRange} from './tactics-time-range.mjs';
import {canonicalJSON} from '../tactical-overlay/binding.mjs';
import {createGeometryContext,observedPoint,crossCutCompatible} from '../tactical-overlay/geometry.mjs';
import {DEFAULT_OPTIONS,evidenceQuality} from '../tactical-overlay/validation.mjs';
import {COURT,project} from './court.mjs';
import {validateAuthoredPath,authoredBindingReason,authoredRouteGeometry,cubicBezier} from './tactics-authored-geometry.mjs';

// Authored illustrations are separate from observations and their review status.
export const ANNOTATION_LIMITS=Object.freeze({items:256,points:6,dots:160});
export const DEFAULT_SPOTLIGHT_COLOR='#ffffff';
export const ANNOTATION_REASONS=Object.freeze({phase_changed:'阶段已调整，请重新绑定',phase_missing:'原阶段已合并，请重新绑定',
  source_changed:'轨迹快照已更新，请重新绑定',entity_missing:'关联球员已移除',outside_time:'不在显示时间内',
  reference_frame_only:'仅在绘制的参考帧显示',completed:'这条路线已走完',calibration_unavailable:'当前帧无可用球场映射',
  court_reference_mismatch:'镜头已切换，请在当前镜头重新绘制',identity_conflict:'当前球员身份冲突，脚圈暂时隐藏',
  out_of_view:'球员已离开画面，脚圈暂时隐藏',missing_position:'当前没有球员脚点，脚圈暂时隐藏',
  estimated_point:'当前脚点仅为估计，脚圈暂时隐藏',anchor_position_unavailable:'绘制帧没有合法脚点，仅显示绘制位置',
  projection_unavailable:'当前无法投影到画面',outside_viewport:'图形完全位于视频画面之外',source_cut:'镜头已切换，脚圈暂时隐藏',
  camera_changed:'示意相机已修改，请核对后重新绑定路线',camera_missing:'未找到路线使用的示意相机',production_source_changed:'编排来源已变化，请重新绑定',production_camera_unavailable:'当前帧没有可用示意相机'});
const copy=v=>structuredClone(v),object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v),frame=v=>Number.isSafeInteger(v)&&v>=0&&v<=10000000;
const text=v=>typeof v==='string'&&v.length>0&&v.length<=256;
const fields=(v,required,optional=[])=>object(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const same=(a,b)=>canonicalJSON(a)===canonicalJSON(b),distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const phaseSnapshot=p=>({phaseId:p.phaseId,startFrame:p.startFrame,endFrameExclusive:p.endFrameExclusive,freezeFrame:p.freezeFrame});
const sourceSnapshot=d=>({videoSha256:d.review.videoSha256,trackingFingerprint:d.review.trackingFingerprint,reviewDigest:d.playDefinition.sourceBinding.reviewDigest});
const inCourt=p=>p.x>=0&&p.x<=COURT.length&&p.y>=0&&p.y<=COURT.width;

/** Stale phase/source bindings are status, not corruption: old drawings stay recoverable. */
export function validateAnnotations(annotations,document){
  if(annotations===undefined)return [];
  const issues=[],bad=field=>issues.push({code:'invalid_annotation',severity:'fatal',details:{field}});
  try{canonicalJSON(annotations);}catch{bad('finite_json');return issues;}
  if(!fields(annotations,['schemaVersion','items'])||annotations.schemaVersion!==1||!Array.isArray(annotations.items)||annotations.items.length>ANNOTATION_LIMITS.items){bad('annotations');return issues;}
  const ids=new Set();
  for(const a of annotations.items){
    if(!fields(a,['id','type','phaseId','entityId','startFrame','endFrameExclusive','anchorFrame','space','points','style','followEntity','phaseSnapshot','sourceBinding'],['anchorMode','offset','origin','authoredPath','actionRange','cueFrame','progressFrames','displayMode','curve','meaning','preparationBinding','timingMode','videoMode','referenceSize','name'])||
      !text(a.id)||ids.has(a.id)||!text(a.phaseId)||a.entityId!==null&&!text(a.entityId)||!['route','screen','spotlight','position'].includes(a.type)||!['court','video'].includes(a.space)){
      bad('annotation_identifiers');continue;
    }
    ids.add(a.id);const p=a.phaseSnapshot,s=a.sourceBinding;
    if(!fields(p,['phaseId','startFrame','endFrameExclusive','freezeFrame'])||p.phaseId!==a.phaseId||
      ![p.startFrame,p.endFrameExclusive,p.freezeFrame,a.startFrame,a.endFrameExclusive,a.anchorFrame].every(frame)||
      p.startFrame>=p.endFrameExclusive||p.freezeFrame<p.startFrame||p.freezeFrame>=p.endFrameExclusive||
      a.startFrame<p.startFrame||a.endFrameExclusive>p.endFrameExclusive||a.startFrame>=a.endFrameExclusive||
      (a.timingMode==='manual'?(a.anchorFrame<p.startFrame||a.anchorFrame>=p.endFrameExclusive):(a.anchorFrame<a.startFrame||a.anchorFrame>=a.endFrameExclusive)))bad('annotation_range');
    if(a.timingMode!==undefined&&(a.timingMode!=='manual'||document?.schemaVersion!==2||!a.actionRange))bad('annotation_timing_mode');
    if(a.name!==undefined&&(typeof a.name!=='string'||a.name.length>120))bad('annotation_name');
    if(a.videoMode!==undefined&&(a.videoMode!=='fixed'||a.space!=='video'||a.timingMode!=='manual'||!fields(a.referenceSize,['width','height'])||a.referenceSize.width!==document.review.width||a.referenceSize.height!==document.review.height))bad('annotation_video_mode');
    if(a.referenceSize!==undefined&&a.videoMode!=='fixed')bad('annotation_reference_size');
    if(!fields(s,['videoSha256','trackingFingerprint','reviewDigest'])||!text(s.videoSha256)||!text(s.trackingFingerprint)||!/^[a-f0-9]{64}$/.test(s.reviewDigest??''))bad('annotation_source');
    const bounds=a.space==='court'?{x:COURT.length,y:COURT.width}:{x:document?.review?.width??65536,y:document?.review?.height??65536};
    if(!Array.isArray(a.points)||(a.type==='route'?(a.points.length<2||a.points.length>ANNOTATION_LIMITS.points):a.points.length!==1)||
      a.points.some(p=>!fields(p,['x','y'])||!finite(p.x)||!finite(p.y)||p.x<0||p.y<0||p.x>bounds.x||p.y>bounds.y))bad('annotation_points');
    if(!fields(a.style,['angle','size','color'],['pattern'])||!finite(a.style.angle)||Math.abs(a.style.angle)>360||!finite(a.style.size)||a.style.size<.5||a.style.size>3||!/^#[a-f0-9]{6}$/i.test(a.style.color))bad('annotation_style');
    if(a.style?.pattern!==undefined&&(a.type!=='route'||!['solid','dashed','dots'].includes(a.style.pattern)))bad('annotation_pattern');
    const observedLaterPolyline=a.style?.pattern==='dashed'&&a.meaning==='later_observed_action'&&
      (a.curve===undefined||a.curve==='polyline')&&Array.isArray(a.points)&&a.points.length>=2&&a.points.length<=ANNOTATION_LIMITS.points;
    const manualCubic=a.timingMode==='manual'&&a.style?.pattern==='dashed'&&a.curve==='cubic_bezier'&&a.points?.length===4;
    if(['dashed','dots'].includes(a.style?.pattern)&&(!Array.isArray(a.points)||(a.points.length!==2&&!observedLaterPolyline&&!manualCubic)||
      !object(a.points[0])||!object(a.points[1])||distance(a.points[0],a.points[1])<=1e-6))bad('annotation_straight_points');
    if(typeof a.followEntity!=='boolean'||a.followEntity&&(a.type!=='spotlight'||!a.entityId))bad('annotation_follow');
    if(a.anchorMode!==undefined&&!['manual_offset','player_foot','court_player_foot'].includes(a.anchorMode))bad('annotation_anchor_mode');
    if(a.anchorMode==='player_foot'&&(a.type!=='spotlight'||a.space!=='video'||!a.entityId||!a.followEntity))bad('annotation_foot_anchor');
    if(a.anchorMode==='court_player_foot'&&(a.type!=='spotlight'||a.space!=='court'||!a.entityId||!a.followEntity))bad('annotation_court_foot');
    if(a.actionRange!==undefined){
      try{validateFrameRange(document.review.sourceFrameMapping,a.actionRange);}catch{bad('annotation_action_range');}
      if(!['remaining','full'].includes(a.displayMode)||!['polyline','cubic_bezier'].includes(a.curve)||a.curve==='cubic_bezier'&&(a.type!=='route'||a.points.length!==4)||!['current_action','later_observed_action','pass','screen','focus','position'].includes(a.meaning)||!frame(a.cueFrame)||(a.timingMode==='manual'?(a.cueFrame<p.startFrame||a.cueFrame>=p.endFrameExclusive):(a.cueFrame<a.startFrame||a.cueFrame>=a.endFrameExclusive)))bad('annotation_v2');
      const keys=a.progressFrames;
      if(!Array.isArray(keys)||keys.length<2||keys.length>80||keys.some((k,i)=>!fields(k,['frame','t'])||!frame(k.frame)||!finite(k.t)||k.t<0||k.t>1||k.frame<a.actionRange.startFrame||k.frame>a.actionRange.endFrameExclusive||i&&(k.frame<=keys[i-1].frame||k.t<keys[i-1].t))||keys[0].frame!==a.actionRange.startFrame||keys[0].t!==0||keys.at(-1).frame!==a.actionRange.endFrameExclusive||keys.at(-1).t!==1)bad('annotation_progress');
    }
    if(a.offset!==undefined&&(!fields(a.offset,['x','y'])||!finite(a.offset.x)||!finite(a.offset.y)||Math.abs(a.offset.x)>bounds.x||Math.abs(a.offset.y)>bounds.y))bad('annotation_offset');
    if(a.origin!==undefined&&(!fields(a.origin,['kind','jobId','sourceFrames','note'])||!['agent','human_modified'].includes(a.origin.kind)||!text(a.origin.jobId)||typeof a.origin.note!=='string'||a.origin.note.length>2000||!Array.isArray(a.origin.sourceFrames)||a.origin.sourceFrames.length>40||a.origin.sourceFrames.some(f=>!frame(f)||f>=document.review.sourceFrameMapping.length)))bad('annotation_origin');
    if(!validateAuthoredPath(a))bad('annotation_authored_path');
  }
  return issues;
}
function assertAnnotations(annotations,document){
  const issues=validateAnnotations(annotations,document);
  if(issues.length)throw new Error(`画布标注无效：${issues.map(i=>i.details.field).join('、')}`);
}
function activePhase(document,id){
  const p=document.playDefinition.phases.find(p=>p.phaseId===id);
  if(!p)throw new Error('未找到绘制阶段，请选择当前阶段。');return p;
}
function assertEntity(document,id){
  if(id!==null&&!document.playDefinition.participants.some(p=>p.id===id))throw new Error('请选择当前草稿中的球员。');
}
export function createAnnotation(document,input){
  assertAnnotations(document.annotations,document);
  const p=activePhase(document,input.phaseId),id=input.id??`annotation-${crypto.randomUUID()}`,entityId=input.entityId??null;
  assertEntity(document,entityId);
  if(document.annotations?.items.some(a=>a.id===id))throw new Error('该标注已存在。');
  const annotation={id,type:input.type,phaseId:p.phaseId,entityId,startFrame:input.startFrame??input.frame,
    endFrameExclusive:input.endFrameExclusive??p.endFrameExclusive,anchorFrame:input.frame,space:input.space,points:copy(input.points),
    style:{angle:0,size:1,color:input.type==='spotlight'?DEFAULT_SPOTLIGHT_COLOR:input.type==='screen'||input.type==='route'&&input.style?.pattern==='dots'?'#ffd45c':'#19a9e1',...input.style},
    followEntity:input.followEntity??(input.type==='spotlight'&&entityId!==null),phaseSnapshot:phaseSnapshot(p),sourceBinding:sourceSnapshot(document)};
  // Normalize historical Agent palette defaults only at creation; saved colors
  // and deliberate custom colors continue to be read and edited unchanged.
  if(input.type==='spotlight'&&input.origin?.kind==='agent'&&['#ffd45c','#ffd34e'].includes(annotation.style.color.toLowerCase()))annotation.style.color=DEFAULT_SPOTLIGHT_COLOR;
  if(input.anchorMode!==undefined)annotation.anchorMode=input.anchorMode;
  if(input.anchorMode==='player_foot'){annotation.space='video';annotation.offset=copy(input.offset??{x:0,y:0});}
  for(const key of ['actionRange','cueFrame','progressFrames','displayMode','curve','meaning','preparationBinding','timingMode','videoMode','referenceSize','name'])if(input[key]!==undefined)annotation[key]=copy(input[key]);
  if(input.origin)annotation.origin=copy(input.origin);
  if(input.authoredPath)annotation.authoredPath=copy(input.authoredPath);
  const annotations={schemaVersion:1,items:[...(document.annotations?.items??[]),annotation]};assertAnnotations(annotations,document);
  const result=copy(document);result.annotations=copy(annotations);return result;
}
export function updateAnnotation(document,id,patch){
  assertAnnotations(document.annotations,document);
  const previous=document.annotations?.items.find(a=>a.id===id);if(!previous)throw new Error('未找到要修改的画布标注。');
  if(!fields(patch,[],['phaseId','entityId','frame','startFrame','endFrameExclusive','points','style','followEntity','space','anchorMode','offset','authoredPath','actionRange','cueFrame','progressFrames','displayMode','curve','meaning','preparationBinding','timingMode','videoMode','referenceSize','name']))throw new Error('画布标注修改字段不正确。');
  if(Object.hasOwn(patch,'space')&&patch.space!==previous.space&&patch.anchorMode!=='player_foot')throw new Error('修改控制点时不能更换坐标空间，请重新绘制。');
  const a={...copy(previous),...copy(patch),style:{...previous.style,...patch.style}};delete a.frame;
  if(Object.hasOwn(patch,'entityId'))assertEntity(document,a.entityId);
  if(a.entityId===null||patch.followEntity===false){a.followEntity=false;if(['player_foot','court_player_foot'].includes(a.anchorMode))a.anchorMode='manual_offset';}
  if(a.anchorMode==='player_foot'){
    a.space='video';a.followEntity=true;
    if(Object.hasOwn(patch,'entityId')||patch.anchorMode==='player_foot')a.offset={x:0,y:0};
  }
  if(a.origin)a.origin.kind='human_modified';
  // An explicit frame/phase rebind is required to reactivate stale drawings.
  if(Object.hasOwn(patch,'frame')||Object.hasOwn(patch,'phaseId')){
    const p=activePhase(document,a.phaseId);a.anchorFrame=patch.frame??p.freezeFrame;
    a.startFrame=patch.startFrame??a.anchorFrame;a.endFrameExclusive=patch.endFrameExclusive??p.endFrameExclusive;
    a.phaseSnapshot=phaseSnapshot(p);a.sourceBinding=sourceSnapshot(document);
  }
  const annotations={schemaVersion:1,items:document.annotations.items.map(item=>item.id===id?a:item)};assertAnnotations(annotations,document);
  const result=copy(document);result.annotations=copy(annotations);return result;
}
export function removeAnnotation(document,id){
  const result=copy(document);
  if(result.annotations){result.annotations.items=result.annotations.items.filter(a=>a.id!==id);if(!result.annotations.items.length)delete result.annotations;}
  if(result.tacticKeyframes){for(const k of result.tacticKeyframes.items)k.annotationIds=k.annotationIds.filter(ref=>ref!==id);result.tacticKeyframes.items=result.tacticKeyframes.items.filter(k=>k.annotationIds.length||k.kind==='explanation');}
  return result;
}
export function annotationStatus(document,{phaseId}={}){
  const result={active:[],pending:[],stale:[]};
  for(const original of document.annotations?.items??[]){
    const p=document.playDefinition.phases.find(p=>p.phaseId===original.phaseId);
    const reason=!p?'phase_missing':!same(original.phaseSnapshot,phaseSnapshot(p))?'phase_changed':
      !same(original.sourceBinding,sourceSnapshot(document))?'source_changed':
      original.entityId&&!document.playDefinition.participants.some(p=>p.id===original.entityId)?'entity_missing':authoredBindingReason(document,original);
    if(reason)result.stale.push({id:original.id,original,reason});
    else if(!phaseId||original.phaseId===phaseId)result.active.push(original);else result.pending.push(original);
  }
  return result;
}

const contextCache=new WeakMap();
function geometryContext(document,phaseId,model){
  if(model?.context?.review===document.review&&model.phaseId===phaseId)return model.context;
  // UI models are built from a cloned snapshot. Their matching binding is sufficient.
  if(model?.context&&model.phaseId===phaseId&&same(model.sourceBinding,document.playDefinition.sourceBinding))return model.context;
  let phases=contextCache.get(document);if(!phases){phases=new Map();contextCache.set(document,phases);}
  if(!phases.has(phaseId)){const p=activePhase(document,phaseId);phases.set(phaseId,createGeometryContext(document.review,document.playDefinition,p.freezeFrame,DEFAULT_OPTIONS));}
  return phases.get(phaseId);
}
/** Input is video pixel coordinates after accounting for the fitted picture's letterboxing. */
export function annotationPointFromVideo(model,frameNumber,point){
  if(!frame(frameNumber)||!model?.context?.frames?.[frameNumber]||!finite(point?.x)||!finite(point?.y)||
    point.x<0||point.y<0||point.x>model.width||point.y>model.height)throw new Error('请在当前视频画面内绘制。');
  const mapping=model.context.maps[frameNumber],court=mapping&&project(mapping.toCourt,point.x,point.y);
  return court&&inCourt(court)?{space:'court',point:court}:{space:'video',point:{x:point.x,y:point.y}};
}
function smooth(points){
  if(points.length===2)return Array.from({length:49},(_,i)=>({x:points[0].x+(points[1].x-points[0].x)*i/48,y:points[0].y+(points[1].y-points[0].y)*i/48}));
  const result=[];
  for(let i=0;i<points.length-1;i++){
    const p0=points[Math.max(0,i-1)],p1=points[i],p2=points[i+1],p3=points[Math.min(points.length-1,i+2)];
    // A restrained Hermite curve follows a few authored intent points, never the detector's jitter.
    for(let n=0;n<24;n++){
      const t=n/24,t2=t*t,t3=t2*t;
      const value=k=>(2*t3-3*t2+1)*p1[k]+(t3-2*t2+t)*.35*(p2[k]-p0[k])+(-2*t3+3*t2)*p2[k]+(t3-t2)*.35*(p3[k]-p1[k]);
      result.push({x:value('x'),y:value('y')});
    }
  }
  result.push(copy(points.at(-1)));return result;
}
export function sampleAnnotationCurve(a,reveal=1){return a.curve==='cubic_bezier'?Array.from({length:97},(_,i)=>cubicBezier(a.points,reveal*i/96)):smooth(a.points);}
function trimCurve(points,progress){
  if(progress<=0)return points;
  if(progress>=1)return null;
  const distances=points.slice(1).map((p,i)=>distance(p,points[i])),length=distances.reduce((a,b)=>a+b,0),target=length*progress;
  if(length<1e-9)return null;
  let walked=0;
  for(let i=0;i<distances.length;i++){
    if(walked+distances[i]>=target&&distances[i]>0){const t=(target-walked)/distances[i],a=points[i],b=points[i+1];return [{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},...points.slice(i+1)];}
    walked+=distances[i];
  }
  return null;
}
function equallySpacedDots(curve,spacing){
  const distances=curve.slice(1).map((point,index)=>distance(point,curve[index])),length=distances.reduce((sum,n)=>sum+n,0);
  const count=Math.min(ANNOTATION_LIMITS.dots,Math.max(2,Math.floor(length/spacing)+1)),result=[];
  let index=0,walked=0;
  for(let i=0;i<count;i++){
    if(i===count-1){result.push(copy(curve.at(-1)));break;}
    const target=length*i/(count-1);
    while(index<distances.length-1&&walked+distances[index]<target){walked+=distances[index];index++;}
    const t=distances[index]>0?(target-walked)/distances[index]:0,a=curve[index],b=curve[index+1];
    result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  }
  return result;
}

function clipToViewport(a,b,width,height,padding=0){
  let enter=0,leave=1;
  for(const [axis,bound] of [['x',width],['y',height]]){
    const delta=b[axis]-a[axis];
    if(delta===0){if(a[axis]<-padding||a[axis]>bound+padding)return null;continue;}
    const first=(-padding-a[axis])/delta,last=(bound+padding-a[axis])/delta;
    enter=Math.max(enter,Math.min(first,last));leave=Math.min(leave,Math.max(first,last));
    if(enter>leave)return null;
  }
  return [enter,leave];
}
const viewportCorners=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
const viewportDistance=(p,width,height)=>Math.hypot(Math.max(0,-p.x,p.x-width),Math.max(0,-p.y,p.y-height));
function paintedSegmentVisible(a,b,width,height,radius){
  return !!clipToViewport(a,b,width,height)||viewportDistance(a,width,height)<=radius||viewportDistance(b,width,height)<=radius||
    viewportCorners(width,height).some(p=>segmentDistance(p,a,b)<=radius);
}
function paintedPathVisible(points,width,height,radius,dash){
  if(!points?.length)return false;
  if(!dash)return points.slice(1).some((b,i)=>paintedSegmentVisible(points[i],b,width,height,radius));
  const period=dash.reduce((total,n)=>total+n,0);let phase=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],length=distance(a,b),clip=clipToViewport(a,b,width,height,radius);
    if(clip&&length>0){
      // Skip all offscreen dash cycles instead of walking arbitrarily long projections.
      const start=clip[0]*length,span=Math.min((clip[1]-clip[0])*length,Math.hypot(width+2*radius,height+2*radius));
      let local=(phase+start%period)%period,index=0,position=0;
      while(local>=dash[index]){local-=dash[index];index=(index+1)%dash.length;}
      let remaining=dash[index]-local;
      while(position<=span){
        const step=Math.min(remaining,span-position),point=offset=>({x:a.x+(b.x-a.x)*((start+offset)/length),y:a.y+(b.y-a.y)*((start+offset)/length)});
        if(index%2===0&&paintedSegmentVisible(point(position),point(position+step),width,height,radius))return true;
        if(position+step>=span)break;
        position+=step;index=(index+1)%dash.length;remaining=dash[index];
      }
    }
    phase=(phase+length%period)%period;
  }
  return false;
}
function paintedPolygonVisible(points,width,height,radius){
  if(!points?.length)return false;
  const closed=[...points,points[0]];
  if(paintedPathVisible(closed,width,height,radius))return true;
  // SVG polygons have fill as well as stroke: an enclosing ring/arrow can be visible
  // even when all its vertices and boundary segments are outside the viewport.
  return viewportCorners(width,height).some(point=>{
    let winding=0;
    for(let i=1;i<closed.length;i++){
      const a=closed[i-1],b=closed[i],cross=(b.x-a.x)*(point.y-a.y)-(point.x-a.x)*(b.y-a.y);
      if(a.y<=point.y&&b.y>point.y&&cross>0)winding++;
      else if(a.y>point.y&&b.y<=point.y&&cross<0)winding--;
    }
    return winding!==0;
  });
}
function annotationIntersectsViewport(item,width,height){
  const g=item.video,unit=height/1080,outline=g.strokeWidth+3*unit;
  if(item.type==='route'){
    if(g.ribbon)return g.opacity>0&&paintedPolygonVisible(g.ribbon,width,height,g.strokeWidth);
    if(g.pattern==='dots')return g.dots.some(p=>viewportDistance(p,width,height)<=g.dotRadius+.75*unit);
    return paintedPathVisible(g.curve,width,height,outline/2,g.pattern==='dashed'?g.dashArray:null)||
      paintedPolygonVisible(g.arrow,width,height,.75*unit);
  }
  if(item.type==='screen'||item.type==='position')return g.paths.some(path=>paintedPathVisible(path,width,height,(outline+(item.type==='screen'?g.strokeWidth*.4:0))/2));
  return paintedPolygonVisible(g.ring,width,height,outline/2);
}

/** Derive displayability from the same exact-frame geometry used by the editor. */
export function annotationPresentation(document,{annotationIds}={}){
  assertAnnotations(document.annotations,document);
  const selected=annotationIds===undefined?null:new Set(annotationIds),status=annotationStatus(document);
  const stale=new Map(status.stale.map(item=>[item.id,item.reason])),scenes=new Map(),grouped=new Map(),items=[];
  for(const a of document.annotations?.items??[]){
    if(selected&&!selected.has(a.id))continue;
    const mode=a.type!=='spotlight'&&a.space==='video'&&!a.followEntity&&!a.authoredPath&&a.videoMode!=='fixed'||a.endFrameExclusive-a.startFrame===1?'reference_frame':'timeline';
    let reason=stale.get(a.id)??null,visible=false;
    if(!reason){
      if(!scenes.has(a.phaseId))scenes.set(a.phaseId,new Map());
      const phaseScenes=scenes.get(a.phaseId);
      if(!phaseScenes.has(a.anchorFrame)){
        const scene=projectAnnotations(document,{phaseId:a.phaseId,frame:a.anchorFrame,editing:true});
        phaseScenes.set(a.anchorFrame,new Map(scene.items.map(item=>[item.id,item])));
      }
      const projected=phaseScenes.get(a.anchorFrame).get(a.id);
      if(projected?.video){
        visible=annotationIntersectsViewport(projected,document.review.width,document.review.height);
        reason=visible?null:'outside_viewport';
      }else reason=projected?.hiddenReason??'projection_unavailable';
    }
    items.push({id:a.id,phaseId:a.phaseId,frame:a.anchorFrame,mode,visible,reason});
    if(!visible)continue;
    if(!grouped.has(a.phaseId))grouped.set(a.phaseId,new Map());
    const frames=grouped.get(a.phaseId);
    if(!frames.has(a.anchorFrame))frames.set(a.anchorFrame,{phaseId:a.phaseId,frame:a.anchorFrame,annotationIds:[]});
    frames.get(a.anchorFrame).annotationIds.push(a.id);
  }
  const pausePoints=document.playDefinition.phases.flatMap(p=>[...(grouped.get(p.phaseId)?.values()??[])].sort((a,b)=>a.frame-b.frame));
  return {items,pausePoints};
}
export function annotationPausePoints(document){
  return annotationPresentation(document).pausePoints;
}
function routePatternGeometry(geometry,pattern,size,space,height){
  const result={...geometry,pattern},unit=space==='court'?1:height/1080;
  if(pattern==='dots'){
    delete result.arrow;
    result.dotRadius=(space==='court'?.16:8)*size*unit;
    result.dots=equallySpacedDots(result.curve,(space==='court'?.6:30)*size*unit);
  }else if(pattern==='dashed')result.dashArray=[space==='court'?.6:30*unit,space==='court'?.45:24*unit].map(n=>n*size);
  return result;
}
function routeGeometry(curve,size,space,height,pattern='solid'){
  if(!curve||curve.length<2)return null;
  const end=curve.at(-1);let previous=curve.length-2;while(previous>0&&distance(curve[previous],end)<1e-7)previous--;
  const d=distance(curve[previous],end);if(d<1e-7)return null;
  const ux=(end.x-curve[previous].x)/d,uy=(end.y-curve[previous].y)/d;
  const length=curve.slice(1).reduce((total,p,i)=>total+distance(p,curve[i]),0),unit=space==='court'?1:height/1080;
  const head=Math.min((space==='court'?.7:46)*size*unit,length*.6),half=Math.min((space==='court'?.4:25)*size*unit,length*.4);
  return routePatternGeometry({curve,arrow:[{x:end.x-ux*head-uy*half,y:end.y-uy*head+ux*half},end,{x:end.x-ux*head+uy*half,y:end.y-uy*head-ux*half}],strokeWidth:(space==='court'?.18:12)*size*unit},pattern,size,space,height);
}
function markerGeometry(a,center,height){
  const unit=a.space==='court'?1:height/1080,size=a.style.size,angle=a.style.angle*Math.PI/180;
  if(a.type==='position'){
    const half=(a.space==='court'?.18:14)*unit*size;
    return {center,paths:[[{x:center.x-half,y:center.y},{x:center.x+half,y:center.y}],
      [{x:center.x,y:center.y-half},{x:center.x,y:center.y+half}]],strokeWidth:(a.space==='court'?.06:4)*unit*size};
  }
  if(a.type==='spotlight'){
    const radius=(a.space==='court'?.46:39)*unit*size,ry=a.space==='court'?radius:radius*.38;
    return {center,ring:Array.from({length:49},(_,i)=>({x:center.x+Math.cos(i/48*Math.PI*2)*radius,y:center.y+Math.sin(i/48*Math.PI*2)*ry})),strokeWidth:(a.space==='court'?.08:5)*unit*size};
  }
  const half=(a.space==='court'?.55:43)*unit*size,cap=half*.28,ux=Math.cos(angle),uy=Math.sin(angle);
  const ends=[-1,1].map(sign=>({x:center.x+ux*half*sign,y:center.y+uy*half*sign}));
  return {center,paths:[ends,...ends.map(end=>[{x:end.x-uy*cap,y:end.y+ux*cap},{x:end.x+uy*cap,y:end.y-ux*cap}])],strokeWidth:(a.space==='court'?.13:8)*unit*size};
}
function mapGeometry(geometry,mapping,height,size,type){
  const mapped={...geometry},point=p=>project(mapping.toImage,p.x,p.y),list=points=>points.map(point);
  if(geometry.curve)mapped.curve=list(geometry.curve);
  if(geometry.arrow)mapped.arrow=list(geometry.arrow);
  if(geometry.paths)mapped.paths=geometry.paths.map(list);
  if(geometry.ribbon)mapped.ribbon=list(geometry.ribbon);
  if(geometry.ring)mapped.ring=list(geometry.ring);
  if(geometry.center)mapped.center=point(geometry.center);
  if([...(mapped.curve??[]),...(mapped.arrow??[]),...(mapped.paths?.flat()??[]),...(mapped.ring??[]),...(geometry.center?[mapped.center]:[])].some(p=>!p||!finite(p.x)||!finite(p.y)))return null;
  mapped.strokeWidth=(type==='route'?12:type==='screen'?8:5)*(height/1080)*size;
  // Re-sample after projection so perspective cannot stretch the dot spacing
  // or turn small passing markers into large ellipses on the video surface.
  return type==='route'?routePatternGeometry(mapped,geometry.pattern??'solid',size,'video',height):mapped;
}
function rawFoot(context,entityId,frameNumber){
  if(evidenceQuality(context,'identity',{entityId},frameNumber,frameNumber+1).state==='invalid')return {reason:'identity_conflict'};
  if(evidenceQuality(context,'position',{entityId},frameNumber,frameNumber+1).state==='invalid')return {reason:'missing_position'};
  const p=context.pointMaps.get(entityId)?.get(frameNumber);
  const observed=p&&(['tracked','manual'].includes(p.source)||p.source==='manual_range'&&p.rangeCorrection?.method==='relative_keyframe_interpolation'&&['tracked','manual'].includes(p.rangeCorrection.originalSource));
  const reason=!p?'missing_position':p.source==='conflict'?'identity_conflict':p.source==='out_of_view'?'out_of_view':
    ['interpolated','manual_path','court_estimated'].includes(p.source)?'estimated_point':!observed||!finite(p.x)||!finite(p.y)?'missing_position':null;
  return reason?{reason}:{point:{x:p.x,y:p.y},reason:null};
}
export function playerFoot(document,entityId,frameNumber,{phaseId,model}={}){
  return rawFoot(geometryContext(document,phaseId??document.playDefinition.phases[0].phaseId,model),entityId,frameNumber);
}
export function playersAtVideoPoint(document,frameNumber,point,{phaseId,model}={}){
  const context=geometryContext(document,phaseId??document.playDefinition.phases[0].phaseId,model);
  return document.playDefinition.participants.filter(person=>{
    const p=context.pointMaps.get(person.id)?.get(frameNumber),b=p?.box;
    return rawFoot(context,person.id,frameNumber).point&&Array.isArray(b)&&b.length===4&&point.x>=b[0]&&point.x<=b[2]&&point.y>=b[1]&&point.y<=b[3];
  });
}
function followingCenter(a,context,currentFrame){
  if(a.anchorMode==='court_player_foot'){
    const point=context.review.courtPreparation?.preparedByPlayer[a.entityId]?.[currentFrame]??context.courtPointMaps.get(a.entityId)?.get(currentFrame);
    return point&&Number.isFinite(point.x)&&Number.isFinite(point.y)?{point:{x:point.x+(a.offset?.x??0),y:point.y+(a.offset?.y??0)}}:{reason:point?.source==='out_of_view'?'out_of_view':'missing_position'};
  }
  if(a.anchorMode==='player_foot'){
    if(context.cuts.some(cut=>cut>Math.min(currentFrame,a.anchorFrame)&&cut<=Math.max(currentFrame,a.anchorFrame)))return {reason:'source_cut'};
    const foot=rawFoot(context,a.entityId,currentFrame);
    return foot.point?{point:{x:foot.point.x+(a.offset?.x??0),y:foot.point.y+(a.offset?.y??0)},reason:null}:foot;
  }
  if(!a.followEntity||currentFrame===a.anchorFrame)return {point:a.points[0],reason:null};
  if(context.cuts.some(cut=>cut>Math.min(currentFrame,a.anchorFrame)&&cut<=Math.max(currentFrame,a.anchorFrame)))return {reason:'source_cut'};
  const locate=f=>a.space==='court'?observedPoint({...context,freezeFrame:a.anchorFrame},a.entityId,f):rawFoot(context,a.entityId,f);
  const initial=locate(a.anchorFrame),current=locate(currentFrame);
  if(!initial.point)return {reason:'anchor_position_unavailable'};
  if(!current.point)return {reason:current.reason??'missing_position'};
  const p=a.space==='court'?initial.point.courtPoint:initial.point,q=a.space==='court'?current.point.courtPoint:current.point;
  return {point:{x:q.x+a.points[0].x-p.x,y:q.y+a.points[0].y-p.y},reason:null};
}
export function projectAnnotations(document,{phaseId,frame:currentFrame,model,selectedId,editing=false,reference=false,reveal=1,freeze=false}={}){
  assertAnnotations(document.annotations,document);
  const status=annotationStatus(document,{phaseId}),context=geometryContext(document,phaseId,model);
  if(!frame(currentFrame)||!context.frames[currentFrame])throw new Error('当前帧超出视频范围。');
  const width=document.review.width,height=document.review.height,items=[],mapping=context.maps[currentFrame];
  for(const a of status.active){
    const item={id:a.id,type:a.type,entityId:a.entityId,original:a,selected:a.id===selectedId,video:null,court:null,handles:[],hiddenReason:null};items.push(item);
    const early=(document.tacticKeyframes?.items??[]).filter(k=>k.kind==='explanation'&&k.annotationIds.includes(a.id)).map(k=>k.frame);
    const visibleStart=Math.min(a.startFrame,...early);
    if(!(reference&&a.id===selectedId)&&(currentFrame<visibleStart||currentFrame>=a.endFrameExclusive)){item.hiddenReason='outside_time';continue;}
    if(a.authoredPath){
      // A new explanation cue must not erase or redraw earlier unfinished routes.
      const result=authoredRouteGeometry(document,a,currentFrame,{reveal:editing||a.anchorFrame!==currentFrame?1:reveal,editing});
      item.video=result.geometry??null;item.hiddenReason=result.reason??null;
      if(item.video&&currentFrame===a.anchorFrame)item.handles=a.points.map((p,index)=>({...p,index}));
      continue;
    }
    if(a.type!=='spotlight'&&a.space==='video'&&a.videoMode!=='fixed'&&!a.followEntity&&currentFrame!==a.anchorFrame){item.hiddenReason='reference_frame_only';continue;}
    let geometry;
    if(a.type==='route'){
      const start=context.frames[a.startFrame].time,end=context.frames[a.endFrameExclusive-1].time;
      const explaining=freeze&&(a.timingMode==='manual'?currentFrame<=(a.actionRange??a).startFrame&&document.tacticKeyframes?.items.some(k=>k.frame===currentFrame&&k.annotationIds.includes(a.id)):(a.cueFrame===currentFrame||document.tacticKeyframes?.items.some(k=>k.frame===currentFrame&&k.annotationIds.includes(a.id))));
      const progress=reference&&a.id===selectedId||editing&&a.timingMode!=='manual'||explaining||a.displayMode==='full'?0:a.actionRange?annotationProgress(document,a,currentFrame):end<=start?0:(context.frames[currentFrame].time-start)/(end-start);
      const curve=sampleAnnotationCurve(a,explaining?reveal:1);
      const full=routeGeometry(curve,a.style.size,a.space,height,a.style.pattern??'solid');
      geometry=routeGeometry(trimCurve(curve,progress),a.style.size,a.space,height,a.style.pattern??'solid');
      if(a.timingMode==='manual'&&geometry&&(a.style.pattern??'solid')==='solid'){
        // Keep the destination head unchanged; fade the whole remaining mark before it becomes a hook.
        geometry.arrow=full.arrow;
        const length=geometry.curve.slice(1).reduce((sum,p,i)=>sum+distance(p,geometry.curve[i]),0),head=distance(full.arrow[1],{x:(full.arrow[0].x+full.arrow[2].x)/2,y:(full.arrow[0].y+full.arrow[2].y)/2});
        const fade=(a.space==='court'?.55:36*height/1080)*a.style.size;
        geometry.opacity=progress>0?.94*Math.max(0,Math.min(1,(length-2*head)/fade)):.94;
        if(geometry.opacity<=0)geometry=null;
      }
      if(!geometry){item.hiddenReason='completed';continue;}
    }else{
      const center=followingCenter(a,context,currentFrame);
      if(!center.point){item.hiddenReason=center.reason;continue;}
      geometry=markerGeometry(a,center.point,height);
      if(a.timingMode==='manual'&&freeze&&early.includes(currentFrame))geometry.opacity=reveal;
    }
    if(a.space==='court'){
      if(a.curve==='cubic_bezier'&&(a.style.pattern??'solid')==='solid')geometry=wideRouteGeometry(geometry,a.style.size,'court',height);
      item.court=geometry;
      if(a.actionRange)item.handles=a.points.map((p,index)=>({...p,index,space:'court'}));
      if(!mapping){item.hiddenReason='calibration_unavailable';continue;}
      if(!crossCutCompatible({...context,freezeFrame:a.anchorFrame},currentFrame)){item.hiddenReason='court_reference_mismatch';continue;}
      item.video=mapGeometry(geometry,mapping,height,a.style.size,a.type);
    }else{
      item.video=a.timingMode==='manual'&&a.curve==='cubic_bezier'&&(a.style.pattern??'solid')==='solid'?wideRouteGeometry(geometry,a.style.size,'video',height):geometry;
      // A valid mapping shapes the circle on the floor; its center remains the
      // observed image foot. Missing mapping never removes an image foot circle.
      if(a.anchorMode==='player_foot'&&mapping){
        const center=project(mapping.toCourt,geometry.center.x,geometry.center.y);
        if(center&&finite(center.x)&&finite(center.y)){
          const court=markerGeometry({...a,space:'court'},center,height),video=mapGeometry(court,mapping,height,a.style.size,a.type);
          if(video){video.center=geometry.center;item.video=video;item.court=court;}
        }
      }
    }
    if(!item.video){item.hiddenReason='projection_unavailable';continue;}
    if(a.type==='spotlight'&&a.entityId){
      const observation=context.pointMaps.get(a.entityId)?.get(currentFrame),box=observation?.box;
      if(rawFoot(context,a.entityId,currentFrame).point&&Array.isArray(box)&&box.length===4&&box.every(finite)&&box[2]>box[0]&&box[3]>box[1]){
        const dx=item.video.center.x-observation.x,dy=item.video.center.y-observation.y;
        item.video.subjectBounds={left:box[0]+dx,top:box[1]+dy,right:box[2]+dx,bottom:box[3]+dy};
      }
    }
    const handles=a.type==='spotlight'?[geometry.center]:a.points;
    if(!a.actionRange||a.space!=='court')item.handles=handles.map((p,index)=>({...a.space==='court'?project(mapping.toImage,p.x,p.y):p,index})).filter(p=>finite(p.x)&&finite(p.y));
  }
  return {width,height,frame:currentFrame,phaseId,items,stale:status.stale};
}

const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const coordinates=points=>points.map(p=>`${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
function spotlightBounds(g){
  const c=g.center,r=Math.max(g.strokeWidth,...g.ring.map(p=>Math.abs(p.x-c.x)));
  return g.subjectBounds??{left:c.x-r,top:c.y-r*4,right:c.x+r,bottom:c.y+r*.2};
}
export function renderAnnotationsSVG(scene,{space='video',width=scene.width,height=scene.height}={}){
  if(!['video','court'].includes(space)||!finite(width)||!finite(height)||width<=0||height<=0)throw new Error('画布标注显示尺寸不正确。');
  const viewBox=space==='court'?`0 0 ${COURT.length} ${COURT.width}`:`0 0 ${scene.width} ${scene.height}`,parts=[];
  const spotlights=scene.items.filter(item=>{
    if(item.type!=='spotlight'||!item.video||(item.video.opacity??1)<=0)return false;
    const b=spotlightBounds(item.video);
    return b.right>0&&b.left<scene.width&&b.bottom>0&&b.top<scene.height;
  });
  if(space==='video'&&spotlights.length){
    // One shared dim layer: overlapping focus areas never accumulate darkness.
    // This mask is presentation-only; persisted geometry and hit targets stay intact.
    const id=`focus-mask-${scene.frame}-${spotlights.map(item=>Array.from(item.id,c=>c.codePointAt(0).toString(16)).join('-')).join('_')}`;
    const openings=spotlights.map(item=>{
      const g=item.video,b=spotlightBounds(g);
      return `<ellipse data-part="spotlight-opening" cx="${(b.left+b.right)/2}" cy="${(b.top+b.bottom)/2}" rx="${(b.right-b.left)*.9}" ry="${(b.bottom-b.top)*.8}" fill="url(#${id}-edge)" opacity="${g.opacity??1}"/>`;
    }).join('');
    parts.push(`<defs><radialGradient id="${id}-edge"><stop offset="0" stop-color="#000000"/><stop offset=".65" stop-color="#000000"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${scene.width}" height="${scene.height}"><rect width="${scene.width}" height="${scene.height}" fill="#ffffff"/>${openings}</mask></defs><rect data-part="spotlight-dim" width="${scene.width}" height="${scene.height}" fill="#000000" fill-opacity="${.3*Math.max(...spotlights.map(item=>item.video.opacity??1))}" mask="url(#${id})" pointer-events="none"/>`);
  }
  for(const item of scene.items){
    const g=item[space];if(!g)continue;
    const color=item.original.style.color,stroke=g.strokeWidth,outline=stroke+(space==='court'?.07:3*(scene.height/1080));
    parts.push(`<g data-annotation-id="${escape(item.id)}" data-type="${item.type}" ${g.ribbon?'':`opacity="${g.opacity??1}"`} fill="none" stroke-linecap="round" stroke-linejoin="round">`);
    if(item.type==='route'){
      if(g.ribbon){
        // Draw the full fill over the inner half of a doubled edge, matching the
        // authored raster pipeline. Group opacity composites both layers once.
        const polygon=coordinates(g.ribbon);
        parts.push(`<g data-part="authored-ribbon" opacity="${g.opacity}"><polygon points="${polygon}" fill="none" stroke="${g.edgeColor}" stroke-width="${2*g.strokeWidth}"/><polygon points="${polygon}" fill="${color}" stroke="none"/></g>`);
      }else if(g.pattern==='dots'){
        parts.push(...g.dots.map(point=>`<circle data-part="route-dot" cx="${point.x.toFixed(4)}" cy="${point.y.toFixed(4)}" r="${g.dotRadius}" fill="${color}" stroke="#5a4105" stroke-opacity=".88" stroke-width="${space==='court'?.03:1.5*(scene.height/1080)}"/>`));
      }else{
        const line=coordinates(g.curve),arrow=coordinates(g.arrow),dash=g.pattern==='dashed'?` stroke-dasharray="${g.dashArray.map(n=>n.toFixed(4)).join(' ')}"`:'';
        parts.push(`<polyline points="${line}" stroke="#ffffff" stroke-opacity=".88" stroke-width="${outline}"${dash}/><polyline data-part="route" points="${line}" stroke="${color}" stroke-width="${stroke}"${dash}/>`);
        parts.push(`<polygon data-part="arrow" points="${arrow}" fill="${color}" stroke="#ffffff" stroke-opacity=".88" stroke-width="${space==='court'?.035:1.5*(scene.height/1080)}"/>`);
      }
    }else if(item.type==='position'){
      parts.push(...g.paths.map(path=>`<polyline data-part="position-mark" points="${coordinates(path)}" stroke="#ffffff" stroke-width="${outline}"/><polyline points="${coordinates(path)}" stroke="${color}" stroke-width="${stroke}"/>`));
    }else if(item.type==='screen'){
      const paths=g.paths.map(path=>coordinates(path));
      parts.push(...paths.map(points=>`<polyline points="${points}" stroke="#493611" stroke-opacity=".7" stroke-width="${outline+stroke*.4}"/>`));
      parts.push(...paths.map(points=>`<polyline data-part="screen-bar" points="${points}" stroke="${color}" stroke-width="${stroke}"/>`));
    }else{
      const ring=coordinates(g.ring);
      // Keep the existing projected foot ring and editing geometry. These SVG
      // gradients also rasterize in the export pipeline, without CSS.
      const id=`spotlight-${space}-${scene.frame}-${Array.from(item.id,c=>c.codePointAt(0).toString(16)).join('-')}`;
      const cx=g.center.x,cy=g.center.y,rx=Math.max(stroke,...g.ring.map(p=>Math.abs(p.x-cx)));
      const ry=Math.max(stroke,...g.ring.map(p=>Math.abs(p.y-cy))),rise=rx*2;
      parts.push(`<defs><linearGradient id="${id}-light" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset=".2" stop-color="#ffffff" stop-opacity=".02"/><stop offset=".6" stop-color="#ffffff" stop-opacity=".1"/><stop offset="1" stop-color="#ffffff" stop-opacity=".18"/></linearGradient><linearGradient id="${id}-sides"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset=".25" stop-color="#ffffff"/><stop offset=".75" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient><mask id="${id}-feather" maskUnits="userSpaceOnUse" x="${cx-rx*1.15}" y="${cy-rise}" width="${rx*2.3}" height="${rise}"><rect x="${cx-rx*1.15}" y="${cy-rise}" width="${rx*2.3}" height="${rise}" fill="url(#${id}-sides)"/></mask><radialGradient id="${id}-floor"><stop offset="0" stop-color="#ffffff" stop-opacity=".08"/><stop offset=".6" stop-color="#ffffff" stop-opacity=".04"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>`);
      parts.push(`<rect data-part="spotlight-soft-light" x="${cx-rx*1.15}" y="${cy-rise}" width="${rx*2.3}" height="${rise}" fill="url(#${id}-light)" mask="url(#${id}-feather)" pointer-events="none"/>`);
      parts.push(`<ellipse data-part="spotlight-halo" cx="${cx}" cy="${cy}" rx="${rx*1.4}" ry="${ry*1.65}" fill="url(#${id}-floor)" pointer-events="none"/>`);
      parts.push(`<polygon data-part="spotlight" points="${ring}" fill="#ffffff" fill-opacity=".025"/>`);
    }
    parts.push('</g>');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" aria-label="战术画布标注">${parts.join('')}</svg>`;
}
function segmentDistance(point,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,n=dx*dx+dy*dy,t=n?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/n)):0;
  return distance(point,{x:a.x+dx*t,y:a.y+dy*t});
}
function polygonContains(point,polygon){
  let winding=0;
  for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],cross=(b.x-a.x)*(point.y-a.y)-(point.x-a.x)*(b.y-a.y);
    if(a.y<=point.y&&b.y>point.y&&cross>0)winding++;else if(a.y>point.y&&b.y<=point.y&&cross<0)winding--;
  }
  return winding!==0;
}
export function hitTestAnnotation(scene,point,tolerance=16){
  if(!finite(point?.x)||!finite(point?.y)||!finite(tolerance)||tolerance<0)return null;
  const items=[...scene.items].reverse();
  for(const item of items.filter(i=>i.selected))for(const h of item.handles??[])if(distance(point,h)<=tolerance)return {id:item.id,index:h.index};
  for(const item of items){
    const g=item.video;if(!g)continue;
    if(g.ribbon&&polygonContains(point,g.ribbon))return {id:item.id,index:null};
    const paths=[...(g.curve?[g.curve]:[]),...(g.arrow?[g.arrow]:[]),...(g.paths??[]),...(g.ring?[g.ring]:[]),...(g.ribbon?[[...g.ribbon,g.ribbon[0]]]:[])];
    if(paths.some(path=>path.slice(1).some((p,i)=>segmentDistance(point,path[i],p)<=tolerance)))return {id:item.id,index:null};
  }
  return null;
}

export function annotationProgress(document,a,frame){
  const m=document.review.sourceFrameMapping,keys=a.progressFrames;
  const time=f=>f===m.length?document.review.mediaEndTime:m[f].time,now=time(frame);
  if(now<=time(keys[0].frame))return 0;if(now>=time(keys.at(-1).frame))return 1;
  const i=keys.findIndex(k=>time(k.frame)>=now),l=keys[i-1],r=keys[i];return l.t+(r.t-l.t)*(now-time(l.frame))/(time(r.frame)-time(l.frame));
}
function wideRouteGeometry(g,size,space='court',height=1080){
  if(!g)return g;const points=g.curve,tip=points.at(-1),base={x:(g.arrow[0].x+g.arrow[2].x)/2,y:(g.arrow[0].y+g.arrow[2].y)/2},head=Math.hypot(tip.x-base.x,tip.y-base.y),half=(space==='court'?.14:9*height/1080)*size;
  let remaining=0,index=points.length-1;while(index>0&&remaining<head){remaining+=Math.hypot(points[index].x-points[index-1].x,points[index].y-points[index-1].y);index--;}
  const curve=[...points.slice(0,index+1),base];
  const normals=curve.map((p,i)=>{const a=curve[Math.max(0,i-1)],b=curve[Math.min(curve.length-1,i+1)],d=Math.hypot(b.x-a.x,b.y-a.y)||1;return {x:-(b.y-a.y)/d,y:(b.x-a.x)/d};});
  const side=sign=>curve.map((p,i)=>({x:p.x+normals[i].x*half*sign,y:p.y+normals[i].y*half*sign}));
  return {...g,ribbon:[...side(1),...g.arrow,...side(-1).reverse()],edgeColor:'#093444',opacity:g.opacity??.94,strokeWidth:space==='court'?.04:2.1*height/1080};
}
