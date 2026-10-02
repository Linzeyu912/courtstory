import {editImageAnchor} from './image-edit.mjs';
export function feetForPoint(clip,frame,point){
 const source=clip.feetCandidates;
 if(!source||point?.trackId==null||source.videoHash!==clip.video_sha256||source.trackingFingerprint!==(clip.tracking_raw_fingerprint||clip.tracking_fingerprint))return null;
 const candidate=source.frames?.find(item=>item.frame===frame)?.feet?.find(item=>Number(item.trackId)===Number(point.trackId));
 return candidate?{...candidate,source:source.source,contactState:'unknown',groundPoint:false}:null;
}
export function footCandidateAnchor(point,frame,candidate,side,width,height){
 const foot=candidate?.[side];if(!foot||![foot.x,foot.y,foot.score].every(Number.isFinite))throw new Error('当前帧没有可用的这只脚候选。');
 if(foot.x<0||foot.y<0||foot.x>width||foot.y>height)throw new Error('脚部候选超出画面，请人工点选。');
 return {...editImageAnchor(point,frame,{x:foot.x,y:foot.y},width,height),footMethod:'pose_candidate_human_adopted',
  footCandidate:{source:candidate.source,side,score:foot.score,landmark:foot.sourceLandmark||foot.name||null,contactState:'unknown',groundPoint:false},groundContactConfirmed:false};
}
