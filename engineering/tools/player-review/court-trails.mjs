import {project} from './court.mjs';
import {groundImagePoint} from './ground-position.mjs';

// A historical foot observation uses its own frame's mapping. Only the final
// rendering uses the current camera, so camera panning cannot become a run.
export function courtRelativeTrail(pointAt,frames,maps,current,cuts=[],options={}){
  const {durationSeconds=1.2,maxStepSeconds=.15,maxSpeedMetresPerSecond=16}=options;
  const map=maps[current],now=frames[current]?.time,result=[],cutSet=new Set(cuts);
  if(!map||!Number.isFinite(now))return result;
  let newer=null,depthSign=null;
  for(let frame=current;frame>=0;frame--){
    const time=frames[frame].time;
    if(!maps[frame]||!Number.isFinite(time)||now-time>durationSeconds)break;
    const p=pointAt(frame);
    if(!p||![p.x,p.y].every(Number.isFinite))break;
    if(newer){const dt=newer.time-time;
      if(cutSet.has(frame+1)||dt<=0||dt>maxStepSeconds||Math.hypot(newer.x-p.x,newer.y-p.y)/dt>maxSpeedMetresPerSecond)break;
    }
    const image=project(map.toImage,p.x,p.y),depth=map.toImage[6]*p.x+map.toImage[7]*p.y+map.toImage[8];
    if(!image||Math.abs(image.x)>50000||Math.abs(image.y)>50000||(depthSign!==null&&depthSign!==Math.sign(depth)))break;
    depthSign=Math.sign(depth);
    result.unshift({frame,time,...image,courtX:p.x,courtY:p.y,trackId:p.trackId??null,footMethod:p.footMethod,
      ...(p.source==='qwen_refined'?{positionSource:p.source,versionId:p.versionId,reviewRequired:true}:{} )});
    newer={...p,time};
  }
  return result;
}

export function playerCourtTrail(points,frames,maps,current,cuts=[],options={}){
  const boundaries=[...cuts],duration=options.durationSeconds??1.2;
  for(let frame=current;frame>=0&&frames[current]?.time-frames[frame].time<=duration;frame--){
    if(points?.[frame]?.source==='court_manual')boundaries.push(frame,frame+1);
  }
  return courtRelativeTrail(frame=>{
    const p=points?.[frame];
    return p&&(p.source==='court_manual'||(p.source==='projected'&&['manual','manual_range','tracked'].includes(p.imageSource))||
      (p.source==='qwen_refined'&&p.refinementState==='estimated'&&p.reviewRequired===true&&typeof p.versionId==='string'))?p:null;
  },frames,maps,current,boundaries,options);
}

export function temporaryCourtTrail(index,clip,session,maps,trackId,current,cuts=[],options={}){
  return courtRelativeTrail(frame=>{
    const box=index[frame]?.get(Number(trackId));if(!box)return null;
    const foot=groundImagePoint(session,{x:(box[0]+box[2])/2,y:box[3],box:box.slice(0,4),
      source:'tracked',trackId:Number(trackId),footMethod:'bbox_bottom_center'},frame,clip);
    const court=project(maps[frame].toCourt,foot.x,foot.y);
    return court?{...court,trackId:Number(trackId),footMethod:foot.footMethod}:null;
  },clip.frames,maps,current,cuts,options);
}
