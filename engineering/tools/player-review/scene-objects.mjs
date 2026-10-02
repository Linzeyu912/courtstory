import {visibleObjects} from './tracking-display.mjs';

export const OBJECT_NAMES={basketball:'篮球',hoop:'篮筐'};
export function sceneObjectsAt(session,record,frame,{includeExcluded=false}={}){
  const objects=visibleObjects(record).map((object,index)=>({...object,id:`model:${index}`,point:[(object.box[0]+object.box[2])/2,(object.box[1]+object.box[3])/2],groundPoint:false}));
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
export function exportSceneObjects(session,frames){
  return {coordinateSystem:'image_pixels',continuousTracking:false,groundProjection:false,
    manualEdits:structuredClone(session.sceneObjectEdits||[]),
    frames:frames.map(record=>({frame:record.frame,time:record.time,objects:sceneObjectsAt(session,record,record.frame).map(object=>{
      const result={kind:object.kind,box:object.box?.slice(0,4)||null,score:object.score,source:object.source||'model',groundPoint:false};
      if(object.source==='human')Object.assign(result,{id:object.id,point:object.point.slice(),reviewRequired:true,detectorBox:object.detectorBox,detectorScore:object.detectorScore});
      return result;
    })}))};
}
