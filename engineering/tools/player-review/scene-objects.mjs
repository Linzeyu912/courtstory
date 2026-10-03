import {visibleObjects} from './tracking-display.mjs';

export const OBJECT_NAMES={basketball:'篮球',hoop:'篮筐'};
const objectPoint=object=>object.point||[(object.box[0]+object.box[2])/2,(object.box[1]+object.box[3])/2];
export function sceneObjectsAt(session,record,frame,{includeExcluded=false}={}){
  const objects=visibleObjects(record).map((object,index)=>({...object,id:`model:${index}`,point:objectPoint(object),groundPoint:false}));
  for(const edit of (session.sceneObjectEdits||[]).filter(item=>item.frame===frame)){
    const index=objects.findIndex(object=>object.id===edit.id),old=objects[index];
    if(edit.action==='exclude'){if(old)objects[index]={...old,excluded:true,reviewSource:'human'};continue;}
    const object={...old,...edit,source:'human',groundPoint:false,reviewRequired:true};
    if(index>=0)objects[index]=object;else objects.push(object);
  }
  return includeExcluded?objects:objects.filter(object=>!object.excluded);
}
export function updateSceneObject(session,frame,object,edit,width,height){
  if(!Number.isInteger(frame)||frame<0||!OBJECT_NAMES[object.kind])throw new Error('对象或帧无效。');
  const value={frame,id:object.id,kind:object.kind,action:'upsert',source:'human',groundPoint:false,reviewRequired:true};
  if(edit.action==='exclude')value.action='exclude';
  else{
    const box=edit.box===undefined?object.box:edit.box;
    if(box!=null&&(!Array.isArray(box)||box.length!==4||box.some(v=>!Number.isFinite(v))||box[0]<0||box[1]<0||box[2]>width||box[3]>height||box[2]<=box[0]||box[3]<=box[1]))throw new Error('对象框应在画面内，右下坐标应大于左上坐标。');
    const point=edit.point||(box?[(box[0]+box[2])/2,(box[1]+box[3])/2]:object.point);
    if(!Array.isArray(point)||point.length!==2||point.some(v=>!Number.isFinite(v))||point[0]<0||point[1]<0||point[0]>width||point[1]>height)throw new Error('对象标记应在画面内。');
    Object.assign(value,{box:box?.slice()||null,point:point.slice(),detectorBox:object.detectorBox||object.box?.slice()||null,detectorScore:object.detectorScore??object.score??null});
  }
  session.sceneObjectEdits=(session.sceneObjectEdits||[]).filter(item=>item.frame!==frame||item.id!==object.id);
  session.sceneObjectEdits.push(value);return value;
}
function preferredCandidate(a,b){
  const manualA=a.source==='human',manualB=b.source==='human';
  if(manualA!==manualB)return manualA?-1:1;
  return (Number(b.score)||0)-(Number(a.score)||0);
}
export function buildBasketballTrajectory(session,frames,cuts=[],dimensions={}){
  const cutSet=new Set(cuts),width=dimensions.width||1920,height=dimensions.height||1080,scale=Math.max(.67,width/1920);
  const observations=frames.map((record,frame)=>sceneObjectsAt(session,record,frame)
    .filter(object=>object.kind==='basketball')
    .map(object=>{const [x,y]=objectPoint(object);return {frame,time:record.time,x,y,score:Number.isFinite(object.score)?object.score:null,
      source:object.source==='human'?'human_observation':'model_observation',candidateId:object.id,reviewRequired:true,groundPoint:false};})
    .filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y))
    .sort(preferredCandidate));
  let previous=null,last=null,segment=-1;
  const trajectory=frames.map((record,frame)=>{
    const candidates=observations[frame];
    if(cutSet.has(frame)){previous=null;last=null;}
    if(!candidates.length)return {frame,time:record.time,x:null,y:null,source:'missing',reviewRequired:true,groundPoint:false};
    let chosen=candidates[0],gapFrames=last?frame-last.frame:null;
    if(last&&gapFrames<=10&&record.time-last.time<=.35&&!cutSet.has(frame)){
      const dt=record.time-last.time,priorDt=previous?last.time-previous.time:0;
      const vx=previous&&priorDt>0?(last.x-previous.x)/priorDt:0,vy=previous&&priorDt>0?(last.y-previous.y)/priorDt:0;
      const predicted={x:last.x+vx*dt,y:last.y+vy*dt};
      const diagonal=Math.hypot(width,height),gate=Math.max(48*scale,Math.min(diagonal*.85,dt*2400*scale));
      const ranked=candidates.map((point,index)=>({index,distance:Math.hypot(point.x-predicted.x,point.y-predicted.y),
        cost:Math.hypot(point.x-predicted.x,point.y-predicted.y)-(point.source==='human_observation'?30*scale:0)-(point.score||0)*12*scale}))
        .sort((a,b)=>a.cost-b.cost);
      if(ranked[0].distance<=gate)chosen=candidates[ranked[0].index];
      else{previous=null;last=null;}
    }else if(last){previous=null;last=null;}
    if(!last)segment++;
    const point={...chosen,segment,gapBefore:last?Math.max(0,frame-last.frame-1):0,
      linkMethod:'nearest_motion_candidate_v1'};
    previous=last;last=point;
    return point;
  });
  return trajectory;
}
export function exportSceneObjects(session,frames,cuts=[],dimensions={}){
  const basketballTrajectory=buildBasketballTrajectory(session,frames,cuts,dimensions);
  return {coordinateSystem:'image_pixels',continuousTracking:false,groundProjection:false,
    basketballTrajectoryMethod:'nearest_motion_candidate_v1',basketballTrajectoryReviewed:false,
    basketballTrajectory,
    manualEdits:structuredClone(session.sceneObjectEdits||[]),
    frames:frames.map(record=>({frame:record.frame,time:record.time,objects:sceneObjectsAt(session,record,record.frame).map(object=>{
      const result={kind:object.kind,box:object.box?.slice(0,4)||null,score:object.score,source:object.source||'model',groundPoint:false};
      if(object.source==='human')Object.assign(result,{id:object.id,point:object.point.slice(),reviewRequired:true,detectorBox:object.detectorBox,detectorScore:object.detectorScore});
      return result;
    })}))};
}
