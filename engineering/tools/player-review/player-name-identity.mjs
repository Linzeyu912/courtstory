import {identityAt} from './identity-timeline.mjs';

const clone=value=>structuredClone(value);
const playerId=value=>/^P(?:[1-9]|10)$/.test(value||'');
const present=(clip,frame,trackId)=>Number.isInteger(frame)&&Number.isInteger(trackId)&&
  (clip.frames?.[frame]?.tracks||[]).some(row=>Number(row[4])===trackId&&row.slice(0,4).every(Number.isFinite));
const normalized=value=>typeof value==='string'?value.trim().normalize('NFKC').toLocaleLowerCase():'';
const hasManualName=entity=>entity?.nameIdentity?.source==='manual'&&typeof entity.nameIdentity.name==='string'&&entity.nameIdentity.name.trim();

function sourceMatches(base,clip){
  return typeof base?.videoHash==='string'&&base.videoHash&&typeof base?.trackingFingerprint==='string'&&
    base.trackingFingerprint&&base?.trackingRevision!=null&&base?.videoHash===clip.video_sha256&&
    base?.trackingFingerprint===clip.tracking_fingerprint&&
    base?.trackingRevision===clip.tracking_revision;
}

function recordMatchesSource(record,clip){
  return typeof record?.baseVideoHash==='string'&&record.baseVideoHash&&typeof record?.baseTrackingFingerprint==='string'&&
    record.baseTrackingFingerprint&&record?.baseTrackingRevision!=null&&record?.baseVideoHash===clip.video_sha256&&
    record?.baseTrackingFingerprint===clip.tracking_fingerprint&&
    record?.baseTrackingRevision===clip.tracking_revision;
}

function candidateName(item){
  const value=item?.nameCandidate;
  if(typeof value==='string')return value.trim();
  return typeof value?.name==='string'?value.name.trim():'';
}

function evidenceRows(item){
  const rows=Array.isArray(item.evidence)?item.evidence:
    Array.isArray(item.evidenceFrames)?item.evidenceFrames:[];
  return rows.filter(row=>Number.isInteger(row?.frame)&&Number.isInteger(Number(row.trackId)))
    .map(row=>({...row,trackId:Number(row.trackId)}));
}

function overlapsClaims(candidates,shadowed=()=>false){
  const byFrameTrack=new Map(),byFrameEntity=new Map(),byFrameName=new Map();
  for(const item of candidates)for(let frame=item.start;frame<=item.end;frame++){
    if(!present(item.clip,frame,item.trackId)||shadowed(item,frame))continue;
    const a=`${frame}:${item.trackId}`,b=`${frame}:${item.entityId}`;
    const owners=byFrameTrack.get(a)||new Set();owners.add(`${item.entityId}:${normalized(item.name)}`);byFrameTrack.set(a,owners);
    const tracks=byFrameEntity.get(b)||new Set();tracks.add(`${item.trackId}:${normalized(item.name)}`);byFrameEntity.set(b,tracks);
    const nameKey=`${frame}:${normalized(item.name)}`,sameName=byFrameName.get(nameKey)||new Set();
    sameName.add(item.entityId);byFrameName.set(nameKey,sameName);
  }
  return (item,frame)=>byFrameTrack.get(`${frame}:${item.trackId}`)?.size>1||
    byFrameEntity.get(`${frame}:${item.entityId}`)?.size>1||byFrameName.get(`${frame}:${normalized(item.name)}`)?.size>1;
}

// A profile is an evidence summary, not permission to carry a name into an unbound T.
function updateMachineProfile(entity,clip){
  const bound=(entity.machineNameIdentities||[]).filter(item=>recordMatchesSource(item,clip));
  const latest=[...bound].sort((a,b)=>(b.appliedOrder||0)-(a.appliedOrder||0))[0];
  const records=bound.filter(item=>item.sourceKey===latest?.sourceKey&&item.jobId===latest?.jobId);
  const names=[...new Set(records.map(item=>item.name))];
  for(const record of records)record.entityAssociationAmbiguous=record.entityAssociationAmbiguous||names.length>1;
  entity.machinePlayerProfile={status:names.length===1?'candidate':names.length?'ambiguous':'unknown',
    identityVerified:false,name:names.length===1?names[0]:null,names,
    nameStatus:names.length===1&&records.some(item=>item.nameStatus==='machine_accepted')?'machine_accepted':
      names.length===1?'candidate':'unknown',
    ...(names.length===1?{playerId:records[0].playerId,playerIdNamespace:records[0].playerIdNamespace,
      season:records[0].season,team:records[0].team,jersey:records[0].jersey}:{}),
    baseVideoHash:clip.video_sha256,baseTrackingFingerprint:clip.tracking_fingerprint,
    baseTrackingRevision:clip.tracking_revision,
    candidates:names.map(name=>({name,bindings:records.filter(item=>item.name===name).map(item=>({
      trackId:item.trackId,start:item.start,end:item.end,evidenceMethod:item.evidenceMethod,
      sourceKey:item.sourceKey,jobId:item.jobId}))}))};
}

function supportedContinuation(raw,all,clip,profiles=[]){
  if(!['continuous_track','visual_same_person'].includes(raw.evidenceMethod))return true;
  const referenceIds=raw.continuity?.referenceEvidenceIds,targetIds=raw.continuity?.targetEvidenceIds;
  if(!Array.isArray(referenceIds)||!referenceIds.length||!Array.isArray(targetIds)||!targetIds.length)return false;
  const target=evidenceRows(raw).filter(row=>row.frame>=raw.start&&row.frame<=raw.end&&
    row.trackId===Number(raw.trackId)&&present(clip,row.frame,row.trackId));
  if(!targetIds.every(id=>target.some(row=>row.evidenceId===id)))return false;
  const name=normalized(candidateName(raw));
  const anchors=all.filter(item=>item.status==='candidate'&&normalized(candidateName(item))===name&&
    !['continuous_track','visual_same_person'].includes(item.evidenceMethod)).flatMap(evidenceRows)
    .concat(profiles.filter(item=>normalized(candidateName(item))===name).flatMap(evidenceRows));
  return referenceIds.every(id=>anchors.some(row=>row.evidenceId===id&&present(clip,row.frame,row.trackId)))&&
    (raw.evidenceMethod!=='continuous_track'||referenceIds.every(id=>anchors.some(row=>
      row.evidenceId===id&&row.trackId===Number(raw.trackId))));
}

/** Apply unverified name proposals in their own lane; human roster data is never rewritten. */
export function applyPlayerNameIdentities(session,result,clip){
  if(!session||!Array.isArray(session.entities)||!clip||!Array.isArray(clip.frames)||
    result?.purpose!=='player_names'||typeof result.jobId!=='string'||!result.jobId||
    typeof result.sourceKey!=='string'||!result.sourceKey||!sourceMatches(result.base,clip)||
    result.candidate?.verified===true||!Array.isArray(result.candidate?.candidates))
    throw new Error('姓名候选与当前视频或跟踪版本不符，未修改草稿。');
  if(session.videoHash!==clip.video_sha256)throw new Error('草稿不属于当前视频。');
  const conflictIssues=(result.candidate.issues||[]).filter(issue=>issue?.kind==='identity_conflict'&&
    playerId(issue.entityId)&&session.entities.some(entity=>entity.id===issue.entityId&&entity.role==='player'));
  const associationIssues=(result.candidate.issues||[]).filter(issue=>issue?.kind==='association_conflict'&&
    playerId(issue.entityId)&&Number.isInteger(Number(issue.trackId))&&Number.isInteger(issue.start)&&
    Number.isInteger(issue.end)&&issue.start>=0&&issue.end>=issue.start&&issue.end<clip.frames.length&&
    evidenceRows(issue).some(row=>row.trackId===Number(issue.trackId)&&row.frame>=issue.start&&
      row.frame<=issue.end&&present(clip,row.frame,row.trackId))&&
    evidenceRows({evidence:issue.referenceEvidence}).some(row=>present(clip,row.frame,row.trackId)));
  const conflictEntities=new Set(conflictIssues.map(issue=>issue.entityId));
  const profiles=(result.candidate.playerProfiles||[]).filter(item=>item?.status==='reference_candidate'&&
    item.verified!==true&&playerId(item.entityId)&&candidateName(item)&&item.nameCandidate?.lookupStatus==='unique_candidate'&&
    evidenceRows(item).some(row=>row.targetConfirmed!==false&&present(clip,row.frame,row.trackId)));
  const prepared=[];
  for(const raw of result.candidate.candidates){
    const name=candidateName(raw),entity=session.entities.find(item=>item.id===raw?.entityId&&item.role==='player');
    if(raw?.status!=='candidate'||!entity||!name||!Number.isInteger(raw.start)||!Number.isInteger(raw.end)||
      raw.start<0||raw.end>=clip.frames.length||raw.start>raw.end||!Number.isInteger(Number(raw.trackId)))continue;
    if(entity.playerProfile?.status==='confirmed'&&entity.playerProfile.evidence?.videoSha256===clip.video_sha256||hasManualName(entity))continue;
    const trackId=Number(raw.trackId),evidence=evidenceRows(raw);
    const supported=evidence.some(row=>row.frame>=raw.start&&row.frame<=raw.end&&row.trackId===trackId&&present(clip,row.frame,trackId));
    if(!supported||!supportedContinuation(raw,result.candidate.candidates,clip,profiles))continue;
    let seen=0;for(let frame=raw.start;frame<=raw.end;frame++)if(present(clip,frame,trackId))seen++;
    if(!seen)continue;
    prepared.push({raw,entity,clip,entityId:entity.id,trackId,start:raw.start,end:raw.end,name,evidence});
  }
  const corrections=prepared.filter(item=>item.raw.bindingCorrection===true);
  const shadowed=(item,frame)=>item.raw.bindingCorrection!==true&&corrections.some(correction=>
    correction.start<=frame&&correction.end>=frame&&present(clip,frame,correction.trackId)&&
    (correction.trackId===item.trackId&&correction.entityId!==item.entityId||
      correction.entityId===item.entityId&&(correction.trackId!==item.trackId||normalized(correction.name)!==normalized(item.name))));
  const conflicted=overlapsClaims(prepared,shadowed),next=clone(session),report={applied:0,skipped:0,
    conflicts:0,conflictFrames:0,alreadyApplied:false,identityConflictEntities:[...conflictEntities]};
  const sequence=()=>{next.nameIdentitySequence=(next.nameIdentitySequence||0)+1;return next.nameIdentitySequence;};
  report.associationReleasedSegments=0;
  for(const issue of associationIssues){
    const entity=next.entities.find(item=>item.id===issue.entityId&&item.role==='player');if(!entity)continue;
    if(entity.machineNameIdentityConflicts?.some(item=>item.kind==='association_conflict'&&item.jobId===result.jobId&&
      item.sourceKey===result.sourceKey&&item.segments?.some(segment=>segment.trackId===Number(issue.trackId)&&
        segment.start===issue.start&&segment.end===issue.end)))continue;
    const segments=[{trackId:Number(issue.trackId),start:issue.start,end:issue.end}];
    const evidence=evidenceRows(issue),stamp={sourceKey:result.sourceKey,jobId:result.jobId,
      baseVideoHash:result.base.videoHash,baseTrackingFingerprint:result.base.trackingFingerprint,
      baseTrackingRevision:result.base.trackingRevision};
    const order=sequence();entity.machineNameIdentityConflicts??=[];
    entity.machineNameIdentityConflicts.push({...stamp,kind:'association_conflict',segments,blockedSegments:segments,
      evidence:clone(evidence),referenceEvidence:clone(issue.referenceEvidence),reason:String(issue.reason||'可见身份与本槽位的可靠参照不同。'),
      appliedOrder:order});
    const old=[...(entity.bindings||[]).filter(item=>item.origin==='ai_visual_reference'),
      ...(entity.machineIdentityBindings||[]).filter(item=>item.kind==='track'&&recordMatchesSource(item,clip))]
      .filter(item=>Number(item.trackId)===Number(issue.trackId)&&item.start<=issue.end&&item.end>=issue.start);
    for(const previous of old){
      const start=Math.max(previous.start,issue.start),end=Math.min(previous.end,issue.end);
      entity.machineIdentityBindings??=[];
      if(entity.machineIdentityBindings.some(item=>item.kind==='unassigned'&&item.sourceKey===result.sourceKey&&
        item.jobId===result.jobId&&item.start===start&&item.end===end&&item.previousTrackId===Number(issue.trackId)))continue;
      entity.machineIdentityBindings.push({...stamp,kind:'unassigned',trackId:null,start,end,
        previousTrackId:Number(issue.trackId),origin:'machine_association_conflict',evidenceMethod:'foreign_identity_evidence',
        evidence:clone(evidence),referenceEvidence:clone(issue.referenceEvidence),appliedOrder:order,
        identityVerified:false,reviewRequired:true});report.associationReleasedSegments++;
    }
  }
  for(const issue of conflictIssues){
    const entity=next.entities.find(item=>item.id===issue.entityId);entity.machineNameIdentityConflicts??=[];
    if(entity.machineNameIdentityConflicts.some(item=>item.sourceKey===result.sourceKey&&item.jobId===result.jobId&&item.reason===String(issue.reason||'同一球员的姓名证据冲突。')))continue;
    const segments=(Array.isArray(issue.segments)?issue.segments:[]).filter(segment=>Number.isInteger(segment.start)&&
      Number.isInteger(segment.end)&&segment.start>=0&&segment.end>=segment.start&&Number.isInteger(Number(segment.trackId)))
      .map(segment=>({trackId:Number(segment.trackId),start:segment.start,end:segment.end,jersey:String(segment.jersey??'')}));
    if(!segments.length)continue;
    entity.machineNameIdentityConflicts.push({kind:'identity_conflict',reason:String(issue.reason||'同一球员的姓名证据冲突。'),
      segments,blockedSegments:clone(issue.blockedSegments||issue.ambiguousSegments||[]),
      sourceKey:result.sourceKey,jobId:result.jobId,baseVideoHash:result.base.videoHash,
      baseTrackingFingerprint:result.base.trackingFingerprint,baseTrackingRevision:result.base.trackingRevision,
      appliedOrder:sequence()});
  }
  const additions=new Map();
  for(const item of prepared){
    const blocked=conflictIssues.filter(issue=>issue.entityId===item.entityId)
      .flatMap(issue=>issue.blockedSegments||issue.ambiguousSegments||[]);
    const ranges=[];let start=null,conflictCount=0;
    for(let frame=item.start;frame<=item.end+1;frame++){
      const replaced=frame<=item.end&&shadowed(item,frame);
      const ambiguous=frame<=item.end&&(replaced||conflicted(item,frame)||blocked.some(segment=>
        (segment.trackId==null||Number(segment.trackId)===item.trackId)&&segment.start<=frame&&segment.end>=frame));
      if(ambiguous&&!replaced)conflictCount++;
      if(frame<=item.end&&!ambiguous){start??=frame;}
      else if(start!==null){ranges.push({start,end:frame-1});start=null;}
    }
    if(conflictCount){report.conflicts++;report.conflictFrames+=conflictCount;}
    if(!ranges.length){report.skipped++;continue;}
    const raw=item.raw,candidate=raw.nameCandidate&&typeof raw.nameCandidate==='object'?raw.nameCandidate:{};
    const record={schemaVersion:1,name:item.name,playerId:raw.playerId??candidate.player_id??null,
      playerIdNamespace:candidate.namespace??null,season:raw.season??candidate.season??null,
      team:raw.team??candidate.team??null,jersey:String(raw.jersey??candidate.jersey??''),
      start:item.start,end:item.end,trackId:item.trackId,method:raw.method||result.candidate.method||'player_name_agent',
      evidenceMethod:raw.evidenceMethod||'direct_jersey',continuity:clone(raw.continuity||null),
      referenceEvidence:clone(raw.referenceEvidence||[]),
      slotReferenceEvidence:clone(raw.slotReferenceEvidence||[]),
      bindingCorrection:raw.bindingCorrection===true||typeof raw.evidenceMethod==='string',
      originalEntityId:raw.originalEntityId||null,
      sourceEntityId:raw.sourceEntityId||raw.originalEntityId||null,
      reason:typeof raw.reason==='string'?raw.reason:'',evidence:item.evidence.map(row=>clone(row)),
      sourceKey:result.sourceKey,jobId:result.jobId,identityVerified:false,reviewRequired:true,
      nameStatus:raw.nameStatus==='machine_accepted'||typeof raw.evidenceMethod==='string'?'machine_accepted':'candidate',
      entityAssociationAmbiguous:raw.entityAssociationAmbiguous===true||raw.positionBindingStatus==='needs_review'||
        conflictEntities.has(item.entityId)&&typeof raw.evidenceMethod!=='string',
      baseVideoHash:result.base.videoHash,baseTrackingFingerprint:result.base.trackingFingerprint,
      baseTrackingRevision:result.base.trackingRevision,baseVariant:result.base.variant??null,
      appliedOrder:0};
    const list=additions.get(item.entityId)||[];list.push(...ranges.map(range=>({...record,...range})));additions.set(item.entityId,list);
  }
  for(const [id,records] of additions){
    const entity=next.entities.find(item=>item.id===id);entity.machineNameIdentities??=[];
    if(entity.machineNameIdentities.some(item=>item.sourceKey===result.sourceKey&&item.jobId===result.jobId)){
      report.alreadyApplied=true;continue;
    }
    for(const record of records){record.appliedOrder=sequence();entity.machineNameIdentities.push(record);report.applied++;}
    updateMachineProfile(entity,clip);
  }
  for(const profile of profiles){
    const entity=next.entities.find(item=>item.id===profile.entityId&&item.role==='player');
    if(!entity||hasManualName(entity)||entity.playerProfile?.status==='confirmed'&&
      entity.playerProfile.evidence?.videoSha256===clip.video_sha256)continue;
    const name=candidateName(profile),records=(entity.machineNameIdentities||[]).filter(item=>
      item.jobId===result.jobId&&item.sourceKey===result.sourceKey&&recordMatchesSource(item,clip));
    if(records.some(item=>normalized(item.name)!==normalized(name))){
      entity.machinePlayerProfile.referenceCandidate=clone(profile);continue;
    }
    entity.machinePlayerProfile={status:'candidate',nameStatus:'machine_accepted',identityVerified:false,name,names:[name],
      playerId:profile.playerId??profile.nameCandidate.player_id,playerIdNamespace:profile.nameCandidate.namespace,
      team:profile.team??profile.nameCandidate.team,season:profile.season??profile.nameCandidate.season,
      jersey:String(profile.jersey??profile.nameCandidate.jersey??''),evidence:clone(evidenceRows(profile)),
      referenceMethod:'canonical_source_reference',sourceKey:result.sourceKey,jobId:result.jobId,
      baseVideoHash:result.base.videoHash,baseTrackingFingerprint:result.base.trackingFingerprint,
      baseTrackingRevision:result.base.trackingRevision,candidates:[{name,bindings:records.map(item=>({
        trackId:item.trackId,start:item.start,end:item.end,evidenceMethod:item.evidenceMethod}))}]};
  }
  report.correctedBindings=0;
  for(const entity of next.entities){
    for(const record of (entity.machineNameIdentities||[]).filter(item=>item.sourceKey===result.sourceKey&&
      item.jobId===result.jobId&&item.bindingCorrection)){
      entity.machineIdentityBindings??=[];
      if(entity.machineIdentityBindings.some(item=>item.sourceKey===record.sourceKey&&item.jobId===record.jobId&&
        item.trackId===record.trackId&&item.start===record.start&&item.end===record.end&&item.kind==='track'))continue;
      const binding={kind:'track',trackId:record.trackId,start:record.start,end:record.end,
        origin:'machine_name_correction',evidenceMethod:record.evidenceMethod,evidence:clone(record.evidence),
        continuity:clone(record.continuity),referenceEvidence:clone(record.referenceEvidence),
        slotReferenceEvidence:clone(record.slotReferenceEvidence),originalEntityId:record.originalEntityId,
        sourceEntityId:record.sourceEntityId,
        identityVerified:false,reviewRequired:true,sourceKey:record.sourceKey,jobId:record.jobId,
        baseVideoHash:record.baseVideoHash,baseTrackingFingerprint:record.baseTrackingFingerprint,
        baseTrackingRevision:record.baseTrackingRevision,appliedOrder:record.appliedOrder,method:record.method};
      entity.machineIdentityBindings.push(binding);report.correctedBindings++;
      // Release only competing machine references in the exact repaired span.
      for(const other of next.entities){
        if(other.id===entity.id||other.role!=='player')continue;
        const competing=[...(other.bindings||[]).filter(item=>item.origin==='ai_visual_reference'),
          ...(other.machineIdentityBindings||[]).filter(item=>item.kind==='track'&&recordMatchesSource(item,clip))]
          .filter(item=>Number(item.trackId)===record.trackId&&item.start<=record.end&&item.end>=record.start);
        for(const previous of competing){
          other.machineIdentityBindings??=[];
          const start=Math.max(previous.start,record.start),end=Math.min(previous.end,record.end);
          if(other.machineIdentityBindings.some(item=>item.jobId===record.jobId&&item.sourceKey===record.sourceKey&&
            item.kind==='unassigned'&&item.start===start&&item.end===end))continue;
          other.machineIdentityBindings.push({...binding,kind:'unassigned',trackId:null,start,end,
            claimedBy:entity.id,previousTrackId:record.trackId});
        }
      }
    }
  }
  report.skipped+=result.candidate.candidates.filter(item=>item.status==='candidate').length-prepared.length;
  return {session:next,report};
}

function activeTrack(session,entity,frame,trackId,clip){
  if(!present(clip,frame,trackId))return null;
  const identity=identityAt(entity,frame,[...(session.cuts||[]),...(clip.sourceCuts||[])],clip.frames[frame],clip);
  return identity?.kind==='track'&&Number(identity.trackId)===trackId?identity:null;
}

function ownNameAt(session,entity,frame,trackId,clip){
  if(!activeTrack(session,entity,frame,trackId,clip))return null;
  const profile=entity.playerProfile?.status==='confirmed'&&typeof entity.playerProfile.name==='string'&&
    entity.playerProfile.evidence?.videoSha256===clip.video_sha256?entity.playerProfile:null;
  const manual=entity.nameIdentity?.source==='manual'&&typeof entity.nameIdentity.name==='string'?entity.nameIdentity:null;
  const name=manual?.name||profile?.name;
  if(name)return {name,jersey:String(manual?.jersey??profile?.jersey_number??entity.jersey??''),team:manual?.team??profile?.team_abbreviation??entity.team??null,
    start:frame,end:frame,trackId,identitySource:'manual_name',identityVerified:true,reviewRequired:false,
    nameStatus:'human_confirmed',positionBindingStatus:'observed'};
  const matches=(entity.machineNameIdentities||[]).filter(item=>item.identityVerified!==true&&item.start<=frame&&item.end>=frame&&
    Number(item.trackId)===trackId&&typeof item.name==='string'&&item.name.trim()&&recordMatchesSource(item,clip))
    .sort((a,b)=>(b.appliedOrder||0)-(a.appliedOrder||0));
  const chosen=matches[0];if(!chosen)return null;
  const blocked=(entity.machineNameIdentityConflicts||[]).some(issue=>recordMatchesSource(issue,clip)&&
    (issue.blockedSegments||[]).some(segment=>(segment.trackId==null||Number(segment.trackId)===trackId)&&segment.start<=frame&&segment.end>=frame)&&
    (issue.jobId===chosen.jobId||(issue.appliedOrder||0)>=(chosen.appliedOrder||0)));
  if(blocked)return null;
  return {name:chosen.name,jersey:String(chosen.jersey||''),team:chosen.team||null,start:chosen.start,end:chosen.end,
    trackId,playerId:chosen.playerId||null,playerIdNamespace:chosen.playerIdNamespace||null,
    season:chosen.season||null,method:chosen.method,reason:chosen.reason,sourceKey:chosen.sourceKey,jobId:chosen.jobId,
    identitySource:'machine_name_suggestion',identityVerified:false,reviewRequired:true,
    nameStatus:chosen.nameStatus||'candidate',evidenceMethod:chosen.evidenceMethod||'direct_jersey',
    positionBindingStatus:chosen.entityAssociationAmbiguous?'needs_review':
      ['continuous_track','visual_same_person'].includes(chosen.evidenceMethod)?'verified_continuation':'observed',
    entityAssociationAmbiguous:chosen.entityAssociationAmbiguous===true};
}

/** Read the name for one visible P/T observation; unknown or conflicting observations stay unnamed. */
export function nameIdentityAt(session,entity,pointOrFrame,clip){
  const frame=typeof pointOrFrame==='number'?pointOrFrame:pointOrFrame?.frame;
  const trackId=typeof pointOrFrame==='number'||pointOrFrame?.trackId==null?null:
    Number.isInteger(Number(pointOrFrame.trackId))?Number(pointOrFrame.trackId):null;
  if(!session||!entity||session.videoHash!==clip?.video_sha256||!Number.isInteger(frame)||frame<0||frame>=clip?.frames?.length||!playerId(entity.id))return null;
  if(typeof pointOrFrame==='object'&&pointOrFrame&&('x' in pointOrFrame||'y' in pointOrFrame)&&
    (!Number.isFinite(pointOrFrame.x)||!Number.isFinite(pointOrFrame.y)))return null;
  const identity=identityAt(entity,frame,[...(session.cuts||[]),...(clip.sourceCuts||[])],clip.frames[frame],clip);
  const currentTrack=trackId??(identity?.kind==='track'?Number(identity.trackId):null);
  if(!Number.isInteger(currentTrack)||!activeTrack(session,entity,frame,currentTrack,clip))return null;
  const chosen=ownNameAt(session,entity,frame,currentTrack,clip);if(!chosen)return null;
  const key=normalized(chosen.name);
  for(const other of session.entities){
    if(other.id===entity.id||other.role!=='player')continue;
    const otherIdentity=identityAt(other,frame,[...(session.cuts||[]),...(clip.sourceCuts||[])],clip.frames[frame],clip);
    if(otherIdentity?.kind!=='track'||!Number.isInteger(Number(otherIdentity.trackId)))continue;
    if(Number(otherIdentity.trackId)===currentTrack&&chosen.identityVerified!==true&&
      ['machine_name_binding','model_suggestion'].includes(identity?.identitySource)&&
      !['machine_name_binding','model_suggestion'].includes(otherIdentity.identitySource)&&
      otherIdentity.origin!=='ai_visual_reference')return null;
    const otherName=ownNameAt(session,other,frame,Number(otherIdentity.trackId),clip);
    if(otherName&&(normalized(otherName.name)===key||Number(otherIdentity.trackId)===currentTrack)&&
      !(chosen.identityVerified===true&&otherName.identityVerified!==true))return null;
  }
  return {...chosen,...(chosen.identitySource==='manual_name'&&identity?.identitySource?{trackIdentitySource:identity.identitySource}:{})};
}
