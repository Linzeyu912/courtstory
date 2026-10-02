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
