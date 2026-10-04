export function selectGroundComparison(session,clip,data){
  if(!data){delete session.groundComparison;return;}
  if(data.videoHash!==clip.video_sha256||data.trackingFingerprint!==(clip.tracking_raw_fingerprint||clip.tracking_fingerprint)||!Array.isArray(data.frames))throw new Error('脚部候选与当前视频或跟踪版本不匹配。');
  const seen=new Set();
  const frames=data.frames.map(record=>{
    if(!Number.isInteger(record.frame)||seen.has(record.frame)||!clip.frames[record.frame]||!Number.isFinite(record.time)||Math.abs(clip.frames[record.frame].time-record.time)>.003)throw new Error('脚部候选时间不匹配。');
    seen.add(record.frame);
    if(!Array.isArray(record.people)||record.people.some(p=>!Number.isInteger(p.trackId)||(p.anchor!=null&&(!Array.isArray(p.anchor)||p.anchor.length!==2||!p.anchor.every(Number.isFinite)))))throw new Error('脚部候选坐标格式不正确。');
    return {frame:record.frame,time:record.time,people:record.people.map(p=>({trackId:p.trackId,anchor:p.anchor,
      anchorMethod:p.anchorMethod,contactState:'unknown',wrists:p.wrists||null}))};
  });
  session.groundComparison={model:data.model,videoHash:data.videoHash,trackingFingerprint:data.trackingFingerprint,frames};
}
const indices=new WeakMap();
export function groundObservation(session,point,frame){
  const data=session.groundComparison;
  if(!data||data.videoHash!==session.videoHash||point?.trackId==null||point.source!=='tracked')return null;
  let index=indices.get(data);if(!index){index=new Map(data.frames.map(r=>[r.frame,new Map(r.people.map(p=>[p.trackId,p]))]));indices.set(data,index);}
  return index.get(frame)?.get(point.trackId)||null;
}
const feetIndices=new WeakMap();
function ankleMidpoint(clip,point,frame){
  const data=clip?.feetCandidates;
  if(!data||point.trackId==null||data.videoHash!==clip.video_sha256||
    data.trackingFingerprint!==(clip.tracking_raw_fingerprint||clip.tracking_fingerprint))return null;
  let index=feetIndices.get(data);
  if(!index){index=new Map((data.frames||[]).map(r=>[r.frame,r]));feetIndices.set(data,index);}
  const record=index.get(frame),time=clip.frames?.[frame]?.time;
  if(!record||!Number.isFinite(time)||!Number.isFinite(record.time)||Math.abs(record.time-time)>.003)return null;
  const feet=record.feet?.find(p=>Number(p.trackId)===Number(point.trackId));
  const ankle=side=>{
    const foot=feet?.[side],name=`${side}_ankle`;
    const candidates=[foot,...(foot?.landmarks||[]),...(feet?.[side+'Landmarks']||[])];
    return candidates.find(p=>{
      if(!p||(p.sourceLandmark||p.name)!==name||![p.x,p.y,p.score].every(Number.isFinite)||p.score<.5)return false;
      if(p.x<0||p.y<0||p.x>=clip.width||p.y>=clip.height)return false;
      const b=point.box;
      return !b||(p.x>=b[0]-.2*(b[2]-b[0])&&p.x<=b[2]+.2*(b[2]-b[0])&&p.y>=(b[1]+b[3])/2&&p.y<=b[3]+.1*(b[3]-b[1]));
    });
  };
  const left=ankle('left'),right=ankle('right');
  return left&&right?{x:(left.x+right.x)/2,y:(left.y+right.y)/2,source:data.source,
    scores:[left.score,right.score],landmarks:['left_ankle','right_ankle']}:null;
}
export function groundImagePoint(session,point,frame,clip=null){
  // Manual positions win. A toe/heel proposal is not silently relabelled as an ankle.
  if(point?.source!=='tracked')return {...point};
  const observation=groundObservation(session,point,frame);
  const matched=!clip||(session.groundComparison?.trackingFingerprint===(clip.tracking_raw_fingerprint||clip.tracking_fingerprint)&&session.videoHash===clip.video_sha256);
  if(!matched||!observation?.anchor||observation.anchor.length!==2||!observation.anchor.every(Number.isFinite)){
    const ankles=!session.groundComparison&&ankleMidpoint(clip,point,frame);
    if(ankles)return {...point,x:ankles.x,y:ankles.y,rawImagePoint:[point.x,point.y],
      footMethod:'ankle_midpoint',groundContactConfirmed:false,groundModel:ankles.source,
      footCandidate:{source:ankles.source,method:'ankle_midpoint',scores:ankles.scores,landmarks:ankles.landmarks,contactState:'unknown'}};
    return {...point,groundContactConfirmed:false,...(session.groundComparison?{groundCandidateMissing:true}:{})};
  }
  return {...point,x:observation.anchor[0],y:observation.anchor[1],rawImagePoint:[point.x,point.y],
    footMethod:'pose_ground_proposal',groundContactConfirmed:false,groundModel:session.groundComparison.model,
    footCandidate:{source:session.groundComparison.model,method:observation.anchorMethod,contactState:'unknown'}};
}
