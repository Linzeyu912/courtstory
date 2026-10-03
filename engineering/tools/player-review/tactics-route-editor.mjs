import {COURT} from './court.mjs';
import {extractRouteControlPoints,previewRouteControlPoints,videoToCourt} from './tactics-presentation.mjs';

const inside=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=COURT.length&&p.y>=0&&p.y<=COURT.width;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
/** Validate first, then reject work whose document/phase/revision has changed. */
export async function commitWhenCurrent({next,stamp,getStamp,validate,apply}){
  await validate(next);const current=getStamp();
  if(Object.keys(stamp).some(key=>stamp[key]!==current[key]))return false;
  await apply(next);return true;
}
/** CSS scaling, viewBox letterboxing and scroll offsets are all handled by SVG CTM. */
export function screenToCourt(svg,event,{space,model,frame}){
  try{
    const matrix=svg.getScreenCTM();if(!matrix)return null;
    const cursor=svg.createSVGPoint();cursor.x=event.clientX;cursor.y=event.clientY;
    const p=cursor.matrixTransform(matrix.inverse());
    const court=space==='court'?{x:p.x,y:p.y}:videoToCourt(model,frame,p);
    return inside(court)?{x:court.x,y:court.y}:null;
  }catch{return null;}
}
/** The editor survives scene refreshes. Only final commands enter the document save chain. */
export function createRouteEditor({getStamp,commitControls,onPreview=()=>{},onSelection=()=>{}}){
  let route=null,controls=[],selectedPoint=0,drag=null;
  const preview=()=>onPreview(route?previewRouteControlPoints(route,controls):null);
  const requireRoute=()=>{if(!route)throw new Error('先选择一条有效路线。');};
  const submit=async(next,stamp=getStamp())=>{
    requireRoute();const r=route;controls=next;preview();onSelection();
    const rollback=()=>{if(route===r){controls=extractRouteControlPoints(r);selectedPoint=Math.min(selectedPoint,controls.length-1);onPreview(null);onSelection();}};
    try{const accepted=await commitControls(r,next,stamp);if(accepted===false)rollback();return accepted;}catch(error){rollback();throw error;}
  };
  return {
    get route(){return route;},get controls(){return structuredClone(controls);},get selectedPoint(){return selectedPoint;},get dragging(){return !!drag;},
    select(next){drag=null;route=next;controls=next?extractRouteControlPoints(next):[];selectedPoint=0;onSelection();},
    selectPoint(index){if(Number.isInteger(index)&&controls[index]){selectedPoint=index;onSelection();}},
    begin(index,pointerId){requireRoute();if(!controls[index])return false;selectedPoint=index;drag={pointerId,index,stamp:getStamp(),before:structuredClone(controls)};onSelection();return true;},
    move(point,pointerId){if(!drag||drag.pointerId!==pointerId||!inside(point))return false;controls[drag.index]={...controls[drag.index],x:point.x,y:point.y};preview();return true;},
    async end(pointerId){if(!drag||drag.pointerId!==pointerId)return false;const saved=drag;drag=null;if(equal(saved.before,controls))return false;return submit(structuredClone(controls),saved.stamp);},
    cancel(){if(drag){controls=drag.before;drag=null;onPreview(null);onSelection();}},
    async insert(frame){
      requireRoute();if(controls.length>=128)throw new Error('每段最多 128 个控制点。');
      const source=route.sourcePoints.find(p=>p.frame===frame);
      if(!source||controls.some(p=>p.frame===frame)||frame<=route.startFrame||frame>=route.endFrameExclusive-1)throw new Error('选择段内尚未使用的合法帧。');
      const curve=previewRouteControlPoints(route,controls).curve;let p=curve.at(-1);
      for(let i=1;i<curve.length;i++)if(curve[i].time>=source.time){const a=curve[i-1],b=curve[i],t=(source.time-a.time)/(b.time-a.time);p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};break;}
      const next=[...controls,{frame,x:p.x,y:p.y}].sort((a,b)=>a.frame-b.frame);selectedPoint=next.findIndex(p=>p.frame===frame);return submit(next);
    },
    async remove(){requireRoute();if(selectedPoint===0||selectedPoint===controls.length-1)throw new Error('路线端点不能删除。');const next=controls.filter((_,i)=>i!==selectedPoint);selectedPoint=Math.min(selectedPoint,next.length-1);return submit(next);}
  };
}
