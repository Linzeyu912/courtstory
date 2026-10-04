import {buildTrajectories} from './trajectory.mjs';
// Current-frame edits preserve the identity and keep the detector's original box.
export function editImageAnchor(point, frame, edit, width, height) {
  if (!point || point.x == null) throw new Error('先关联一个人物框，或在脚下补点。');
  const clamp=(value,max)=>Math.max(0,Math.min(max,value));
  const rawX=edit.x??point.x,rawY=edit.y??point.y;
  if (![rawX,rawY].every(Number.isFinite)) throw new Error('位置必须是有效数值。');
  const x=clamp(rawX,width), y=clamp(rawY,height);
  const box=edit.box??point.box;
  if(box && (box.length!==4 || !box.every(Number.isFinite) || box[0]<0 || box[1]<0 || box[2]>width || box[3]>height || box[2]-box[0]<2 || box[3]-box[1]<2)) throw new Error('人物框必须在画面内且宽高至少 2 像素。');
  const keepFootCandidate=point.footCandidate&&Math.abs(x-point.x)<1e-8&&Math.abs(y-point.y)<1e-8;
  return {frame,x,y,trackId:point.trackId??null,box:box?.slice()||null,identityConfirmed:false,
    footMethod:keepFootCandidate?point.footMethod:edit.box && point.footMethod==='bbox_bottom_center' && Math.abs(x-(box[0]+box[2])/2)<.01 && Math.abs(y-box[3])<.01?'bbox_bottom_center':'human_image_anchor',
    ...(keepFootCandidate?{footCandidate:structuredClone(point.footCandidate)}:{}),
    ...(point.footCandidate||point.groundContactConfirmed===false?{groundContactConfirmed:false}:{}),
    boxMethod:edit.box&&JSON.stringify(edit.box)!==JSON.stringify(point.box)?'human_image_box':point.boxMethod||'detector',
    detectorBox:point.detectorBox||point.box?.slice()||null};
}

export function dragImageEdit(point, kind, origin, target, width, height) {
  const clamp=(value,max)=>Math.max(0,Math.min(max,value));
  if(kind==='foot')return {x:clamp(target.x,width),y:clamp(target.y,height)};
  const b=point.box.slice(), dx=target.x-origin.x, dy=target.y-origin.y;
  if(kind==='box'){
    const sx=Math.max(-b[0],Math.min(width-b[2],dx)),sy=Math.max(-b[1],Math.min(height-b[3],dy));
    return {box:[b[0]+sx,b[1]+sy,b[2]+sx,b[3]+sy],x:clamp(point.x+sx,width),y:clamp(point.y+sy,height)};
  }
  const i=Number(kind.slice(-1));
  const ix=i===0||i===3?0:2,iy=i<2?1:3;
  b[ix]=ix===0?Math.max(0,Math.min(b[2]-2,target.x)):Math.min(width,Math.max(b[0]+2,target.x));
  b[iy]=iy===1?Math.max(0,Math.min(b[3]-2,target.y)):Math.min(height,Math.max(b[1]+2,target.y));
  return {box:b,...(point.footMethod==='bbox_bottom_center'?{x:(b[0]+b[2])/2,y:b[3]}:{})};
}

/** Apply relative adjustments to each observed frame, never to a frozen box. */
export function correctImageRange(session,input,clip){
  const {entityId,start,end,mode,preserveManual=true}=input,{frames,width,height}=clip;
  if(!session.entities.some(e=>e.id===entityId)||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>=frames.length||start>end||!['box','foot'].includes(mode))throw new Error('请选择有效球员、时间段及框 / 脚点修正模式。');
  const keys=structuredClone(input.keyframes||[]).sort((a,b)=>a.frame-b.frame);
  if(keys.length<1||keys.length>2||new Set(keys.map(k=>k.frame)).size!==keys.length||keys.some(k=>!Number.isInteger(k.frame)||k.frame<start||k.frame>end||![k.dx,k.dy,k.scaleX??1,k.scaleY??1].every(Number.isFinite)||(k.scaleX??1)<=0||(k.scaleY??1)<=0))throw new Error('请在范围内设置一或两个有效修正关键帧。');
  const original=buildTrajectories(session,frames,clip.sourceCuts||[])[entityId],cuts=[...new Set([...(session.cuts||[]),...(clip.sourceCuts||[])])].sort((a,b)=>a-b);
  const shot=f=>cuts.filter(c=>c<=f).at(-1)??0;
  const legal=p=>p&&p.x!=null&&p.y!=null&&!p.reviewExcluded&&['tracked','manual','manual_range'].includes(p.source)&&
    (p.trackId==null?p.source==='manual'||p.rangeCorrection?.originalSource==='manual':frames[p.frame].tracks.some(b=>Number(b[4])===p.trackId));
  if(keys.some(k=>!legal(original[k.frame])||(mode==='box'&&!original[k.frame].box)))throw new Error('关键帧需要当前球员的有效原始位置；缺测或冲突帧不能用作修正依据。');
  const result=structuredClone(session),entity=result.entities.find(e=>e.id===entityId),operationId=input.operationId||`range-${crypto.randomUUID()}`;
  const preview={start,end,changed:0,missing:0,conflict:0,preservedManual:0,shotSkipped:0,identitySkipped:0,frames:[]},updates=[];
  for(let frame=start;frame<=end;frame++){
    const p=original[frame],sameShot=keys.filter(k=>shot(k.frame)===shot(frame));
    if(!sameShot.length){preview.shotSkipped++;continue;}
    if(['conflict','out_of_view'].includes(p?.source)||p?.reviewExcluded){preview.conflict++;continue;}
    if(!legal(p)||(mode==='box'&&!p.box)){preview.missing++;continue;}
    const matching=sameShot.filter(k=>original[k.frame].trackId===p.trackId);if(!matching.length){preview.identitySkipped++;continue;}
    const existing=entity.anchors.find(a=>a.frame===frame);if(preserveManual&&existing&&['manual','manual_range'].includes(p.source)){preview.preservedManual++;continue;}
    let a=matching[0],b=matching.at(-1),t=a===b?0:Math.max(0,Math.min(1,(frames[frame].time-frames[a.frame].time)/(frames[b.frame].time-frames[a.frame].time)));
    const value=(field,fallback=0)=>(a[field]??fallback)+((b[field]??fallback)-(a[field]??fallback))*t,dx=value('dx'),dy=value('dy');let edit;
    if(mode==='foot')edit={x:p.x+dx,y:p.y+dy};
    else{
      const box=p.box,bw=(box[2]-box[0])*value('scaleX',1),bh=(box[3]-box[1])*value('scaleY',1),w=Math.max(2,Math.min(width,bw)),h=Math.max(2,Math.min(height,bh));
      const x=Math.max(0,Math.min(width-w,(box[0]+box[2])/2+dx-w/2)),y=Math.max(0,Math.min(height-h,(box[1]+box[3])/2+dy-h/2));
      const shiftedX=x+w/2-(box[0]+box[2])/2,shiftedY=y+h-(box[3]);
      edit={box:[x,y,x+w,y+h],...(p.footMethod==='bbox_bottom_center'?{x:x+w/2,y:y+h}:{x:p.x+shiftedX,y:p.y+shiftedY})};
    }
    const anchor=editImageAnchor(p,frame,edit,width,height),rootSource=p.rangeCorrection?.originalSource||p.source;
    Object.assign(anchor,{source:'manual_range',identityConfirmed:false,reviewRequired:true,supportFrames:matching.map(k=>k.frame),rangeCorrection:{operationId,method:'relative_keyframe_interpolation',mode,supportFrames:matching.map(k=>k.frame),keyframe:keys.some(k=>k.frame===frame),originalSource:rootSource,originalTrackId:p.rangeCorrection?.originalTrackId??p.trackId??null}});
    updates.push(anchor);preview.frames.push(frame);preview.changed++;
  }
  const changed=new Set(preview.frames);entity.anchors=entity.anchors.filter(a=>!changed.has(a.frame)).concat(updates);
  entity.frameConfirmations=(entity.frameConfirmations||[]).filter(r=>!changed.has(r.frame));result.identitySelection=null;
  return {session:result,preview};
}
