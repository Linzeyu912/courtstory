export function emptyReview(clip, revision = 0) {
  return {clip_id:clip.clip_id, label_fingerprint:clip.label_fingerprint, video_sha256:clip.video_sha256,
    revision, status:'draft', evaluations:Object.fromEntries(clip.fields.map(f=>[f.key,
      {verdict:'pending',comment:'',issue_type:'label',observed_at_seconds:null}])),
    retention:{decision:'pending',reason:''},comments:''};
}
export function confirmRemaining(review) {
  return {...review,status:'draft',evaluations:Object.fromEntries(Object.entries(review.evaluations).map(([k,v])=>
    [k,v.verdict==='pending'?{...v,verdict:'correct'}:v]))};
}
export function setVerdict(review,key,verdict,at) {
  return {...review,status:'draft',evaluations:{...review.evaluations,[key]:{
    ...review.evaluations[key],verdict,observed_at_seconds:at}}};
}
export function completionProblem(review) {
  const pending=Object.values(review.evaluations).filter(v=>v.verdict==='pending').length;
  if(pending) return `还有 ${pending} 项未评价，可先点「其余标签正确」，再完成本段。`;
  if(review.retention.decision==='pending') return '请先选择这段视频要保留、丢弃，还是暂不确定。';
  return null;
}
export function issueCount(review) {
  return Object.values(review?.evaluations??{}).filter(v=>['incorrect','unsure'].includes(v.verdict)).length;
}
export function reviewed(summary) {return summary?.status==='completed'&&!summary.stale;}
export function reviewQueue(clips,sample,mode='sample') {
  if(mode==='all'||!sample)return clips;
  const byId=new Map(clips.map(c=>[c.clip_id,c]));
  return sample.clip_ids.map(id=>byId.get(id)).filter(Boolean);
}
export function appliedReview(clip,previous,receipt) {
  const review=emptyReview(clip,previous.revision);
  review.status=previous.status;review.retention=structuredClone(previous.retention);
  review.comments=previous.comments;
  const resolved=new Set(receipt.resolved_keys??[]);
  for(const field of clip.fields){
    const old=previous.evaluations[field.key];
    if(old)review.evaluations[field.key]=resolved.has(field.key)?{verdict:'correct',comment:'',issue_type:'label',observed_at_seconds:null}:structuredClone(old);
  }
  return review;
}
export function nextPending(clips,summaries,index) {
  for(let offset=1;offset<=clips.length;offset++) {
    const i=(index+offset)%clips.length;
    if(!reviewed(summaries[clips[i].clip_id]))return i;
  }
  return null;
}
