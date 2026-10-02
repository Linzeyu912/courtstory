// A human-drawn image path proposes positions; its timing still needs review.
export function manualPathAnchors(path,start,end,frames,points,cuts=[]){
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>=frames.length||start>=end)throw new Error('路径至少覆盖两帧，起止帧必须有效。');
  if(cuts.some(cut=>cut>start&&cut<=end))throw new Error('路径不能跨过切镜；分段补齐。');
  if(!Array.isArray(path)||path.length<2||path.some(p=>![p.x,p.y].every(Number.isFinite)))throw new Error('请画一条有效路径。');
  const segments=path.slice(1).map((p,i)=>({a:path[i],b:p,length:Math.hypot(p.x-path[i].x,p.y-path[i].y)}));
  const total=segments.reduce((sum,s)=>sum+s.length,0),span=frames[end].time-frames[start].time;
  if(total<2||span<=0)throw new Error('路径太短或时间区间不正确。');
  const anchors=[];
  for(let frame=start;frame<=end;frame++){
    if(points[frame]?.source!=='missing')continue;
    let distance=(frames[frame].time-frames[start].time)/span*total;
    let segment=segments.at(-1);
    for(const candidate of segments){segment=candidate;if(distance<=candidate.length)break;distance-=candidate.length;}
    const t=segment.length?Math.max(0,Math.min(1,distance/segment.length)):0;
    anchors.push({frame,x:segment.a.x+(segment.b.x-segment.a.x)*t,y:segment.a.y+(segment.b.y-segment.a.y)*t,
      trackId:null,box:null,source:'manual_path',footMethod:'human_drawn_image_path',
      method:'uniform_time_along_drawn_path',supportFrames:[start,end],reviewRequired:true});
  }
  if(!anchors.length)throw new Error('这个区间没有缺失位置；已有位置、冲突和出画标记保留。');
  return anchors;
}
