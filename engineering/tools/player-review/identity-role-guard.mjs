// Shared downstream gate for machine identity evidence. No session is mutated.
export const IDENTITY_ROLE_POLICY='machine-role-evidence-v1';

export function currentInitialRoleExclusions(session,clip){
  const review=session?.initialIdentityReview;
  if(!clip||review?.version!==1||![review.videoHash,review.trackingFingerprint,review.trackingRevision].every(value=>typeof value==='string'&&value)||
    review.videoHash!==session.videoHash||review.videoHash!==clip.video_sha256||review.trackingFingerprint!==clip.tracking_fingerprint||
    review.trackingRevision!==clip.tracking_revision||!Array.isArray(review.exclusions))return [];
  return review.exclusions.filter(item=>['referee','other'].includes(item.role)&&Number.isInteger(item.trackId)&&item.trackId>0&&
    Number.isInteger(item.start)&&Number.isInteger(item.end)&&item.start>=0&&item.end>=item.start&&item.end<clip.frames.length);
}

export function machineIdentityRoleRisk(record,trackId,frame,{clip=null,exclusions=[]}={}){
  const id=Number(trackId),rows=(record.tracks||[]).filter(row=>Number(row[4])===id),evidence=record.track_evidence?.[id];
  const conflict=Array.isArray(record.role_conflicts)?record.role_conflicts.some(item=>item.trackIds?.some(value=>Number(value)===id)||Number(item.playerTrackId)===id||Number(item.refereeTrackId)===id):Boolean(record.role_conflicts?.[id]);
  if(conflict||evidence?.role_conflict||evidence?.identity_review_required)return 'role_conflict';
  if(rows.length>1)return 'ambiguous_observation';
  const declared=record.track_roles?.[id]||clip?.track_roles?.[id];
  const classes=clip?.trackingMetadata?.model_names||clip?.trackingMetadata?.class_names||{};
  const named=classes[rows[0]?.[6]];
  if(['referee','other'].includes(declared)||['referee','other'].includes(named))return 'non_player';
  if(exclusions.some(item=>item.trackId===id&&item.start<=frame&&frame<=item.end))return 'initial_review_non_player';
  return null;
}

export function identityRoleDependency(session,clip){
  return {policy:IDENTITY_ROLE_POLICY,
    classes:clip.trackingMetadata?.model_names||clip.trackingMetadata?.class_names||{},roles:clip.track_roles||{},
    frames:clip.frames.map(record=>({roles:record.track_roles||{},conflicts:record.role_conflicts||[],
      evidence:Object.fromEntries(Object.entries(record.track_evidence||{}).filter(([,value])=>value.identity_review_required||value.role_conflict).map(([id,value])=>[id,{identity_review_required:!!value.identity_review_required,role_conflict:!!value.role_conflict}]))})),
    exclusions:currentInitialRoleExclusions(session,clip).map(({trackId,start,end,role})=>({trackId,start,end,role}))};
}
