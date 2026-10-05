// Source frames use a zero-based, half-open range. Output holds never enter this timebase.
export function validateFrameMapping(mapping,durationSeconds){
  if(!Array.isArray(mapping)||!mapping.length||mapping.some((p,i)=>p.frame!==i||!Number.isFinite(p.time)||p.time<0||i>0&&p.time<=mapping[i-1].time))throw new Error('素材帧时间映射无效。');
  if(!Number.isFinite(durationSeconds)||durationSeconds<=mapping.at(-1).time)throw new Error('素材片尾尚未解码确认。');
}
export function validateFrameRange(mapping,range){
  if(!Number.isSafeInteger(range?.startFrame)||!Number.isSafeInteger(range?.endFrameExclusive)||range.startFrame<0||range.endFrameExclusive>mapping.length||range.startFrame>=range.endFrameExclusive)throw new Error('时间范围为空、倒置或超出素材。');
  return range;
}
export function rangeFromSeconds(mapping,{startSeconds,endSeconds,durationSeconds}){
  validateFrameMapping(mapping,durationSeconds);
  if(![startSeconds,endSeconds].every(Number.isFinite)||startSeconds<mapping[0].time||endSeconds>durationSeconds||startSeconds>=endSeconds)throw new Error('开始与结束时间必须在素材内，且结束晚于开始。');
  const lowerBound=t=>{let a=0,b=mapping.length;while(a<b){const m=(a+b)>>1;if(mapping[m].time<t)a=m+1;else b=m;}return a;};
  return validateFrameRange(mapping,{startFrame:lowerBound(startSeconds),endFrameExclusive:lowerBound(endSeconds)});
}
export function rangeToSeconds(mapping,range,durationSeconds){
  validateFrameMapping(mapping,durationSeconds);validateFrameRange(mapping,range);
  return {startSeconds:mapping[range.startFrame].time,endSeconds:range.endFrameExclusive===mapping.length?durationSeconds:mapping[range.endFrameExclusive].time};
}
export function frameRangeToInclusive(mapping,range){validateFrameRange(mapping,range);return {start:range.startFrame,end:range.endFrameExclusive-1};}
export function sourceProgress(mapping,range,frame,durationSeconds){
  const {startSeconds,endSeconds}=rangeToSeconds(mapping,range,durationSeconds);
  return Math.max(0,Math.min(1,(mapping[frame].time-startSeconds)/(endSeconds-startSeconds)));
}
