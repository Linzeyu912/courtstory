import {buildTrajectories,playerVisibilityAt} from './trajectory.mjs';
import {identityBoundaries} from './identity-timeline.mjs';

function context(session,entityId,clip){
  const entity=session.entities.find(item=>item.id===entityId&&item.role==='player');
  if(!entity)throw new Error('请选择要补位置的球员编号。');
  const points=buildTrajectories(session,clip.frames,clip.sourceCuts||[],clip)[entityId];
  const boundaries=new Set([...(session.cuts||[]),...(clip.sourceCuts||[]),...identityBoundaries(entity)]);
  // Duplicate legacy anchors may be hidden by the first stale track anchor.
  // Only explicitly unconfirmed track positions can be superseded by a repair.
  const protectedFrames=new Set(entity.anchors.filter(anchor=>anchor.trackId==null||anchor.identityConfirmed!==false).map(anchor=>anchor.frame));
  const blocked=frame=>{
    const point=points[frame],visibility=playerVisibilityAt(entity,frame);
    if(!point)return '画面超出视频范围';
    if(point.reviewExcluded||point.roleConflict||point.source==='conflict')return '存在身份冲突或人工排除';
    if(visibility?.state==='occluded'||point.source==='out_of_view')return '已标记遮挡或出画';
    if(point.source!=='missing'||point.x!=null||protectedFrames.has(frame))return '已有位置记录';
    return null;
  };
  return {entity,points,boundaries,blocked};
}

/** A short suggestion is only a review range, never an automatic tracking claim. */
export function suggestMissingPlayerRange(session,{entityId,frame},clip){
  const {boundaries,blocked}=context(session,entityId,clip);
  if(!Number.isInteger(frame)||!clip.frames[frame])throw new Error('请先定位到视频中的一帧。');
  const problem=blocked(frame);
  if(problem)throw new Error(`当前球员${problem}；请选择漏人的球员编号，或先处理该记录。`);
  let end=frame;
  while(end+1<clip.frames.length&&!boundaries.has(end+1)&&!blocked(end+1)&&
    clip.frames[end+1].time>clip.frames[end].time&&clip.frames[end+1].time-clip.frames[end].time<=.25&&
    clip.frames[end+1].time-clip.frames[frame].time<=2+1e-6)end++;
  return {start:frame,end,reason:'建议先补这段（最多 2 秒）；切镜、遮挡、身份边界和已有位置处停止'};
}

/** Explicit image keyframes interpolate missing positions; no detector boxes or confirmed identities. */
export function previewMissingPlayerRange(session,{entityId,keyframes,allowSingleFrame=false},clip){
  if(!Array.isArray(keyframes)||keyframes.length<(allowSingleFrame===true?1:2))throw new Error('先点起点脚下，再到结束画面点同一人的脚下。');
  for(let i=0;i<keyframes.length;i++){
    const key=keyframes[i];
    if(!Number.isInteger(key.frame)||!clip.frames[key.frame]||![key.x,key.y].every(Number.isFinite)||
      key.x<0||key.x>clip.width||key.y<0||key.y>clip.height||i>0&&key.frame<=keyframes[i-1].frame)
      throw new Error('起终点必须按时间顺序位于视频画面内。');
  }
  const {blocked,boundaries}=context(session,entityId,clip),start=keyframes[0].frame,end=keyframes.at(-1).frame;
  for(let frame=start;frame<=end;frame++){
    const problem=blocked(frame);
    if(problem)throw new Error(`第 ${frame+1} 帧${problem}，请在它之前结束，分段补位置。`);
    if(frame>start&&(boundaries.has(frame)||clip.frames[frame].time<=clip.frames[frame-1].time||clip.frames[frame].time-clip.frames[frame-1].time>.25))
      throw new Error(`第 ${frame+1} 帧有切镜、身份边界或时间缺口，请分段补位置。`);
  }
  const draft=structuredClone(session),entity=draft.entities.find(item=>item.id===entityId);
  let index=0;
  for(let frame=start;frame<=end;frame++){
    while(index+1<keyframes.length-1&&frame>keyframes[index+1].frame)index++;
    const a=keyframes[index],b=keyframes[index+1]||a,fraction=a.frame===b.frame?0:(clip.frames[frame].time-clip.frames[a.frame].time)/(clip.frames[b.frame].time-clip.frames[a.frame].time);
    const clicked=keyframes.some(key=>key.frame===frame);
    const supersededAnchors=entity.anchors.filter(anchor=>anchor.frame===frame);
    entity.anchors=entity.anchors.filter(anchor=>anchor.frame!==frame);
    entity.anchors.push({frame,x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction,
      trackId:null,box:null,source:clicked?'manual':'manual_path',identityConfirmed:false,groundContactConfirmed:false,
      footMethod:clicked?'human_image_anchor':'interpolated_image_point',method:'human_keyframe_time_interpolation',
      supportFrames:[a.frame,b.frame],reviewRequired:true,
      ...(supersededAnchors.length?{supersededAnchors}:{})});
  }
  draft.identitySelection=null;
  return {session:draft,preview:{start,end,changed:end-start+1,estimated:end-start+1-keyframes.length,keyframes:keyframes.length}};
}
