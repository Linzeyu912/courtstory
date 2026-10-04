import {playerFoot} from './tactics-annotations.mjs';

const validBox=box=>Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&box[2]>box[0]&&box[3]>box[1];
const slotLabel=id=>/^P(?:[1-9]|10)$/.test(id)?`球员 ${id.slice(1)}`:/^R\d+$/.test(id)?`裁判 ${id.slice(1)}`:id;

function savedReference(review,entity){
  const ref=entity?.identityReference;
  if(!ref||ref.version!==1||ref.videoHash!==review.videoSha256||ref.trackingFingerprint!==review.trackingFingerprint||
    !Number.isInteger(ref.frame)||ref.frame<0||!review.sourceFrameMapping?.[ref.frame]||!Number.isInteger(ref.trackId)||ref.trackId<1||!validBox(ref.box)||
    typeof ref.team!=='string'||!ref.team.trim()||ref.team.length>40||/[\u0000-\u001f\u007f]/.test(ref.team)||typeof ref.jersey!=='string'||!/^\d{1,3}$/.test(ref.jersey))return null;
  return ref;
}

/** NBA profiles and display team colors are not video identity evidence. */
export function tacticsPlayerLabel(review,id){
  const ref=savedReference(review,review.entities?.find(entity=>entity.id===id));
  return ref?`${ref.team.trim()} ${ref.jersey} 号 · ${slotLabel(id)}`:`${slotLabel(id)} · 身份待确认`;
}

function boundedBox(review,box){
  if(!validBox(box)||!Number.isFinite(review.width)||!Number.isFinite(review.height))return null;
  const clipped=[Math.max(0,box[0]),Math.max(0,box[1]),Math.min(review.width,box[2]),Math.min(review.height,box[3])];
  return validBox(clipped)?clipped:null;
}

/** Read-only inspection targets; finding a person never changes a P binding. */
export function tacticsPlayerInspection(document,entityId,frame,{phaseId,model}={}){
  const review=document.review,entity=review.entities.find(item=>item.id===entityId),reference=savedReference(review,entity);
  const result={label:tacticsPlayerLabel(review,entityId),reference,current:null,target:null};
  if(!entity)return result;
  const reachable=at=>document.playDefinition.phases.some(phase=>at>=phase.startFrame&&at<phase.endFrameExclusive);
  const records=new Map((entity.trajectory||[]).map(point=>[point.frame,point]));
  function observation(at){
    const point=records.get(at),box=boundedBox(review,point?.box);
    if(!reachable(at)||!box||point.reviewExcluded||!playerFoot(document,entityId,at,{phaseId,model}).point)return null;
    return {frame:at,box,trackId:point.trackId??null,reviewed:point.frameIdentityConfirmed===true,kind:'observation'};
  }
  result.current=observation(frame);
  if(result.current){result.target=result.current;return result;}
  const referenceBox=reference&&boundedBox(review,reference.box);
  if(referenceBox&&reachable(reference.frame)){result.target={frame:reference.frame,box:referenceBox,trackId:reference.trackId,reviewed:true,kind:'reference'};return result;}
  const nearest=[...records.keys()].sort((a,b)=>Math.abs(a-frame)-Math.abs(b-frame)||a-b);
  for(const at of nearest){const point=observation(at);if(point){result.target=point;break;}}
  return result;
}
