import {canonicalJSON} from '../tactical-overlay/binding.mjs';
import {createGeometryContext,observedPoint,crossCutCompatible} from '../tactical-overlay/geometry.mjs';
import {DEFAULT_OPTIONS,evidenceQuality} from '../tactical-overlay/validation.mjs';
import {COURT,project} from './court.mjs';

// Authored illustrations are separate from observations and their review status.
export const ANNOTATION_LIMITS=Object.freeze({items:256,points:6});
export const ANNOTATION_REASONS=Object.freeze({phase_changed:'阶段已调整，请重新绑定',phase_missing:'原阶段已合并，请重新绑定',
  source_changed:'轨迹快照已更新，请重新绑定',entity_missing:'关联球员已移除',outside_time:'不在显示时间内',
  reference_frame_only:'仅在绘制的参考帧显示',completed:'这条路线已走完',calibration_unavailable:'当前帧无可用球场映射',
  court_reference_mismatch:'镜头已切换，请在当前镜头重新绘制',identity_conflict:'当前球员身份冲突，脚圈暂时隐藏',
  out_of_view:'球员已离开画面，脚圈暂时隐藏',missing_position:'当前没有球员脚点，脚圈暂时隐藏',
  estimated_point:'当前脚点仅为估计，脚圈暂时隐藏',anchor_position_unavailable:'绘制帧没有合法脚点，仅显示绘制位置',
  projection_unavailable:'当前无法投影到画面',source_cut:'镜头已切换，脚圈暂时隐藏'});
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
    if(!fields(a,['id','type','phaseId','entityId','startFrame','endFrameExclusive','anchorFrame','space','points','style','followEntity','phaseSnapshot','sourceBinding'])||
      !text(a.id)||ids.has(a.id)||!text(a.phaseId)||a.entityId!==null&&!text(a.entityId)||!['route','screen','spotlight'].includes(a.type)||!['court','video'].includes(a.space)){
      bad('annotation_identifiers');continue;
    }
    ids.add(a.id);const p=a.phaseSnapshot,s=a.sourceBinding;
    if(!fields(p,['phaseId','startFrame','endFrameExclusive','freezeFrame'])||p.phaseId!==a.phaseId||
      ![p.startFrame,p.endFrameExclusive,p.freezeFrame,a.startFrame,a.endFrameExclusive,a.anchorFrame].every(frame)||
      p.startFrame>=p.endFrameExclusive||p.freezeFrame<p.startFrame||p.freezeFrame>=p.endFrameExclusive||
      a.startFrame<p.startFrame||a.endFrameExclusive>p.endFrameExclusive||a.startFrame>=a.endFrameExclusive||
      a.anchorFrame<a.startFrame||a.anchorFrame>=a.endFrameExclusive)bad('annotation_range');
    if(!fields(s,['videoSha256','trackingFingerprint','reviewDigest'])||!text(s.videoSha256)||!text(s.trackingFingerprint)||!/^[a-f0-9]{64}$/.test(s.reviewDigest??''))bad('annotation_source');
    const bounds=a.space==='court'?{x:COURT.length,y:COURT.width}:{x:document?.review?.width??65536,y:document?.review?.height??65536};
    if(!Array.isArray(a.points)||(a.type==='route'?(a.points.length<2||a.points.length>ANNOTATION_LIMITS.points):a.points.length!==1)||
      a.points.some(p=>!fields(p,['x','y'])||!finite(p.x)||!finite(p.y)||p.x<0||p.y<0||p.x>bounds.x||p.y>bounds.y))bad('annotation_points');
    if(!fields(a.style,['angle','size','color'])||!finite(a.style.angle)||Math.abs(a.style.angle)>360||!finite(a.style.size)||a.style.size<.5||a.style.size>3||!/^#[a-f0-9]{6}$/i.test(a.style.color))bad('annotation_style');
    if(typeof a.followEntity!=='boolean'||a.followEntity&&(a.type!=='spotlight'||!a.entityId))bad('annotation_follow');
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
    style:{angle:0,size:1,color:input.type==='screen'?'#ffd45c':input.type==='spotlight'?'#ffd45c':'#19a9e1',...input.style},
    followEntity:input.followEntity??(input.type==='spotlight'&&entityId!==null),phaseSnapshot:phaseSnapshot(p),sourceBinding:sourceSnapshot(document)};
  const annotations={schemaVersion:1,items:[...(document.annotations?.items??[]),annotation]};assertAnnotations(annotations,document);
  const result=copy(document);result.annotations=copy(annotations);return result;
}
export function updateAnnotation(document,id,patch){
  assertAnnotations(document.annotations,document);
  const previous=document.annotations?.items.find(a=>a.id===id);if(!previous)throw new Error('未找到要修改的画布标注。');
  if(!fields(patch,[],['phaseId','entityId','frame','startFrame','endFrameExclusive','points','style','followEntity','space']))throw new Error('画布标注修改字段不正确。');
  if(Object.hasOwn(patch,'space')&&patch.space!==previous.space)throw new Error('修改控制点时不能更换坐标空间，请重新绘制。');
  const a={...copy(previous),...copy(patch),style:{...previous.style,...patch.style}};delete a.frame;
  if(Object.hasOwn(patch,'entityId'))assertEntity(document,a.entityId);
  if(a.entityId===null)a.followEntity=false;
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
  return result;
}
export function annotationStatus(document,{phaseId}={}){
  const result={active:[],pending:[],stale:[]};
  for(const original of document.annotations?.items??[]){
    const p=document.playDefinition.phases.find(p=>p.phaseId===original.phaseId);
    const reason=!p?'phase_missing':!same(original.phaseSnapshot,phaseSnapshot(p))?'phase_changed':
      !same(original.sourceBinding,sourceSnapshot(document))?'source_changed':
      original.entityId&&!document.playDefinition.participants.some(p=>p.id===original.entityId)?'entity_missing':null;
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
function routeGeometry(curve,size,space,height){
  if(!curve||curve.length<2)return null;
  const end=curve.at(-1);let previous=curve.length-2;while(previous>0&&distance(curve[previous],end)<1e-7)previous--;
  const d=distance(curve[previous],end);if(d<1e-7)return null;
  const ux=(end.x-curve[previous].x)/d,uy=(end.y-curve[previous].y)/d;
  const length=curve.slice(1).reduce((total,p,i)=>total+distance(p,curve[i]),0),unit=space==='court'?1:height/1080;
  const head=Math.min((space==='court'?.7:46)*size*unit,length*.6),half=Math.min((space==='court'?.4:25)*size*unit,length*.4);
  return {curve,arrow:[{x:end.x-ux*head-uy*half,y:end.y-uy*head+ux*half},end,{x:end.x-ux*head+uy*half,y:end.y-uy*head-ux*half}],strokeWidth:(space==='court'?.18:12)*size*unit};
}
function markerGeometry(a,center,height){
  const unit=a.space==='court'?1:height/1080,size=a.style.size,angle=a.style.angle*Math.PI/180;
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
  if(geometry.ring)mapped.ring=list(geometry.ring);
  if(geometry.center)mapped.center=point(geometry.center);
  if([...(mapped.curve??[]),...(mapped.arrow??[]),...(mapped.paths?.flat()??[]),...(mapped.ring??[]),...(geometry.center?[mapped.center]:[])].some(p=>!p||!finite(p.x)||!finite(p.y)))return null;
  mapped.strokeWidth=(type==='route'?12:type==='screen'?8:5)*(height/1080)*size;return mapped;
}
function rawFoot(context,entityId,frameNumber){
  if(evidenceQuality(context,'identity',{entityId},frameNumber,frameNumber+1).state==='invalid')return {reason:'identity_conflict'};
  if(evidenceQuality(context,'position',{entityId},frameNumber,frameNumber+1).state==='invalid')return {reason:'missing_position'};
  const p=context.pointMaps.get(entityId)?.get(frameNumber);
  const reason=!p?'missing_position':p.source==='conflict'?'identity_conflict':p.source==='out_of_view'?'out_of_view':
    ['interpolated','manual_path','court_estimated'].includes(p.source)?'estimated_point':!['tracked','manual'].includes(p.source)||!finite(p.x)||!finite(p.y)?'missing_position':null;
  return reason?{reason}:{point:{x:p.x,y:p.y},reason:null};
}
function followingCenter(a,context,currentFrame){
  if(!a.followEntity||currentFrame===a.anchorFrame)return {point:a.points[0],reason:null};
  if(context.cuts.some(cut=>cut>Math.min(currentFrame,a.anchorFrame)&&cut<=Math.max(currentFrame,a.anchorFrame)))return {reason:'source_cut'};
  const locate=f=>a.space==='court'?observedPoint({...context,freezeFrame:a.anchorFrame},a.entityId,f):rawFoot(context,a.entityId,f);
  const initial=locate(a.anchorFrame),current=locate(currentFrame);
  if(!initial.point)return {reason:'anchor_position_unavailable'};
  if(!current.point)return {reason:current.reason??'missing_position'};
  const p=a.space==='court'?initial.point.courtPoint:initial.point,q=a.space==='court'?current.point.courtPoint:current.point;
  return {point:{x:q.x+a.points[0].x-p.x,y:q.y+a.points[0].y-p.y},reason:null};
}
export function projectAnnotations(document,{phaseId,frame:currentFrame,model,selectedId,editing=false}={}){
  assertAnnotations(document.annotations,document);
  const status=annotationStatus(document,{phaseId}),context=geometryContext(document,phaseId,model);
  if(!frame(currentFrame)||!context.frames[currentFrame])throw new Error('当前帧超出视频范围。');
  const width=document.review.width,height=document.review.height,items=[],mapping=context.maps[currentFrame];
  for(const a of status.active){
    const item={id:a.id,type:a.type,entityId:a.entityId,original:a,selected:a.id===selectedId,video:null,court:null,handles:[],hiddenReason:null};items.push(item);
    if(currentFrame<a.startFrame||currentFrame>=a.endFrameExclusive){item.hiddenReason='outside_time';continue;}
    if(a.space==='video'&&!a.followEntity&&currentFrame!==a.anchorFrame){item.hiddenReason='reference_frame_only';continue;}
    let geometry;
    if(a.type==='route'){
      const start=context.frames[a.startFrame].time,end=context.frames[a.endFrameExclusive-1].time;
      const progress=editing||end<=start?0:(context.frames[currentFrame].time-start)/(end-start);
      geometry=routeGeometry(trimCurve(smooth(a.points),progress),a.style.size,a.space,height);
      if(!geometry){item.hiddenReason='completed';continue;}
    }else{
      const center=followingCenter(a,context,currentFrame);
      if(!center.point){item.hiddenReason=center.reason;continue;}
      geometry=markerGeometry(a,center.point,height);
    }
    if(a.space==='court'){
      item.court=geometry;
      if(!mapping){item.hiddenReason='calibration_unavailable';continue;}
      if(!crossCutCompatible({...context,freezeFrame:a.anchorFrame},currentFrame)){item.hiddenReason='court_reference_mismatch';continue;}
      item.video=mapGeometry(geometry,mapping,height,a.style.size,a.type);
    }else item.video=geometry;
    if(!item.video){item.hiddenReason='projection_unavailable';continue;}
    const handles=a.type==='spotlight'?[geometry.center]:a.points;
    item.handles=handles.map((p,index)=>({...a.space==='court'?project(mapping.toImage,p.x,p.y):p,index})).filter(p=>finite(p.x)&&finite(p.y));
  }
  return {width,height,frame:currentFrame,phaseId,items,stale:status.stale};
}

const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const coordinates=points=>points.map(p=>`${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
export function renderAnnotationsSVG(scene,{space='video',width=scene.width,height=scene.height}={}){
  if(!['video','court'].includes(space)||!finite(width)||!finite(height)||width<=0||height<=0)throw new Error('画布标注显示尺寸不正确。');
  const viewBox=space==='court'?`0 0 ${COURT.length} ${COURT.width}`:`0 0 ${scene.width} ${scene.height}`,parts=[];
  for(const item of scene.items){
    const g=item[space];if(!g)continue;
    const color=item.original.style.color,stroke=g.strokeWidth,outline=stroke+(space==='court'?.07:3*(scene.height/1080));
    parts.push(`<g data-annotation-id="${escape(item.id)}" data-type="${item.type}" fill="none" stroke-linecap="round" stroke-linejoin="round">`);
    if(item.type==='route'){
      const line=coordinates(g.curve),arrow=coordinates(g.arrow);
      parts.push(`<polyline points="${line}" stroke="#ffffff" stroke-opacity=".88" stroke-width="${outline}"/><polyline data-part="route" points="${line}" stroke="${color}" stroke-width="${stroke}"/>`);
      parts.push(`<polygon data-part="arrow" points="${arrow}" fill="${color}" stroke="#ffffff" stroke-opacity=".88" stroke-width="${space==='court'?.035:1.5*(scene.height/1080)}"/>`);
    }else if(item.type==='screen'){
      const paths=g.paths.map(path=>coordinates(path));
      parts.push(...paths.map(points=>`<polyline points="${points}" stroke="#493611" stroke-opacity=".7" stroke-width="${outline+stroke*.4}"/>`));
      parts.push(...paths.map(points=>`<polyline data-part="screen-bar" points="${points}" stroke="${color}" stroke-width="${stroke}"/>`));
    }else{
      const ring=coordinates(g.ring);
      parts.push(`<polygon data-part="spotlight" points="${ring}" fill="${color}" fill-opacity=".1" stroke="#251d0d" stroke-opacity=".4" stroke-width="${outline}"/><polyline points="${ring}" stroke="${color}" stroke-width="${stroke}"/>`);
    }
    parts.push('</g>');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" aria-label="战术画布标注">${parts.join('')}</svg>`;
}
function segmentDistance(point,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,n=dx*dx+dy*dy,t=n?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/n)):0;
  return distance(point,{x:a.x+dx*t,y:a.y+dy*t});
}
export function hitTestAnnotation(scene,point,tolerance=16){
  if(!finite(point?.x)||!finite(point?.y)||!finite(tolerance)||tolerance<0)return null;
  const items=[...scene.items].reverse();
  for(const item of items)for(const h of item.handles??[])if(distance(point,h)<=tolerance)return {id:item.id,index:h.index};
  for(const item of items){
    const g=item.video;if(!g)continue;
    const paths=[...(g.curve?[g.curve]:[]),...(g.arrow?[g.arrow]:[]),...(g.paths??[]),...(g.ring?[g.ring]:[])];
    if(paths.some(path=>path.slice(1).some((p,i)=>segmentDistance(point,path[i],p)<=tolerance)))return {id:item.id,index:null};
  }
  return null;
}
