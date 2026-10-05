import {courtPreparationStatus,preparationDependencies} from './court-preparation.mjs';
import {exportCourtData,courtGaps} from './court.mjs';
import {buildBallCourtTrajectory} from './ball-court.mjs';
import {IDENTITY_BINDING_MODE,identityAt,identityKeyframes,identityBoundaries,identityProvenance,resolveIdentityOwners,migrateIdentitySession,nextIdentityOrder,entityTeamSide,normalizeTeamColorMetadata,frameIdentityConfirmed,identityReviewToken,anchorReviewSignature} from './identity-timeline.mjs';
import {mergeSourceCuts} from './tracking-display.mjs';
import {exportSceneObjects} from './scene-objects.mjs';
export function blankSession(videoHash) {
  return { version: 1, videoHash, identityBindingMode:IDENTITY_BINDING_MODE, maxGapSeconds: 0, cuts: [], entities: Array.from({length:10}, (_,i) => ({id:`P${i+1}`, name:`球员 ${i+1}`, role:'player', teamSide:i<5?'red':'blue', anchors:[]})) };
}

export function ensurePlayerSlots(session) {
  const original=session.entities||[],players=[],seen=new Set();
  for(let number=1;number<=10;number++){
    const id=`P${number}`,entity=original.find(item=>item.id===id);
    players.push(entity?{...entity,role:'player',anchors:entity.anchors||[]}:
      {id,name:`球员 ${number}`,role:'player',anchors:[]});
    if(entity)seen.add(entity);
  }
  const referees=original.filter(item=>item.role==='referee'&&!seen.has(item)&&!players.some(p=>p.id===item.id));
  const uniqueReferees=[];
  for(const item of referees)if(!uniqueReferees.some(r=>r.id===item.id)){uniqueReferees.push(item);seen.add(item);}
  const recovered=original.filter(item=>!seen.has(item));
  if(recovered.length)session.recoveredEntities=[...(session.recoveredEntities||[]),
    ...recovered.map(entity=>({reason:'outside_fixed_player_slots',entity:structuredClone(entity)}))];
  session.entities=[...players,...uniqueReferees];
  return session;
}

export function entityLabel(entityOrId) {
  const id=typeof entityOrId==='string'?entityOrId:entityOrId.id;
  return /^P(?:[1-9]|10)$/.test(id)?`球员 ${id.slice(1)}`:/^R\d+$/.test(id)?`裁判 ${id.slice(1)}`:id;
}

export function draftStorageKey(clip,variant='original',qa=false) {
  return `player-review:${clip.video_sha256}${clip.importSourceSha256?`:local:${clip.importSourceSha256}`:''}${variant==='original'?'':`:${clip.tracking_fingerprint||variant}`}${qa?':qa':''}`;
}

export function trackingModelSummary(metadata={},variant='') {
  const text=value=>typeof value==='string'||typeof value==='number'?String(value):
    value&&typeof value==='object'?[value.name,value.model_name,value.path,value.type,value.id].map(text).find(Boolean)||'':'';
  const model=[metadata.model_name,metadata.modelName,metadata.model,metadata.weights,metadata.weights_path].map(text).find(Boolean)||'未提供模型信息';
  const tracker=text(metadata.tracker)||text(metadata.tracker_type)||'未提供跟踪器信息';
  const config={...(metadata.tracker_parameters||{}),...(metadata.detection_parameters||{}),
    ...(metadata.tracker?.config||{}),...(metadata.tracker_config||{}),
    ...(metadata.config||{}),...(metadata.parameters||{}),...(metadata.inference||{}),...(metadata.detection||{})};
  const details=[];
  if(text(config.conf))details.push(`检测阈值 ${text(config.conf)}`);
  if(text(config.iou))details.push(`NMS ${text(config.iou)}`);
  const reid=config.with_reid??config.withReid??metadata.with_reid;
  if(reid!=null)details.push(`ReID ${reid?'开启':'关闭'}`);
  const gmc=config.gmc_method??config.gmc??metadata.gmc_method;
  if(text(gmc))details.push(`相机补偿 ${text(gmc)}`);
  if(text(config.track_buffer))details.push(`断轨保留 ${text(config.track_buffer)} 帧`);
  const sha=metadata.model_sha256||metadata.weights_sha256||metadata.weight_sha256;
  if(sha)details.push(`权重 SHA ${String(sha).slice(0,12)}`);
  const deviceInfo=metadata.device??metadata.runtime?.device??config.device;
  const device=[text(deviceInfo),text(deviceInfo?.actual_model_parameter_device)].filter((value,i,array)=>value&&array.indexOf(value)===i).join(' · ')||'未提供设备信息';
  return {model,tracker,device,variant,details};
}

export function buildTrajectories(session, frames, sourceCuts=[]) {
  session={...session,cuts:mergeSourceCuts(session.cuts,sourceCuts,frames.length)};
  const lookup = frames.map(frame => new Map(frame.tracks.map(box => [Number(box[4]), box])));
  const result = {};
  for (const entity of session.entities) {
    const anchors = [...entity.anchors].sort((a,b) => a.frame-b.frame);
    const boundaries = identityBoundaries(entity);
    const points = frames.map((record, frame) => {
      const manual = anchors.find(anchor => anchor.frame === frame);
      const visibility = playerVisibilityAt(entity,frame);
      const identity = identityAt(entity,frame,session.cuts,record);
      if (visibility?.state==='out_of_view') return {frame,time:record.time,x:null,y:null,
        source:'out_of_view',...identityProvenance(identity)};
      if (identity?.kind==='unassigned') return {frame,time:record.time,x:null,y:null,trackId:null,
        source:'missing',reviewExcluded:true,...identityProvenance(identity)};
      if (identity?.kind==='out_of_view') return {frame,time:record.time,x:null,y:null,source:'out_of_view',...identityProvenance(identity)};
      if (identity?.kind==='conflict') return {frame,time:record.time,x:null,y:null,trackId:null,
        source:'conflict',...identityProvenance(identity)};
      // An old position tied to a replaced ID must not override a new identity.
      const independentEdit=manual?.source!=='manual_range'&&manual?.identityConfirmed===false&&
        ['model_suggestion','manual_track_occurrences'].includes(identity?.identitySource);
      if (manual && (manual.trackId==null || independentEdit || (identity?.kind==='track' && Number(manual.trackId)===Number(identity.trackId)))) {
        return {frame,time:record.time,x:manual.x,y:manual.y,box:manual.box||null,
          source:['manual_path','manual_range'].includes(manual.source)?manual.source:'manual',trackId:independentEdit&&Number(manual.trackId)!==Number(identity.trackId)?null:manual.trackId??null,
          ...identityProvenance(identity),
          footMethod:manual.footMethod||(manual.box?'bbox_bottom_center':'human_image_anchor'),
          boxMethod:manual.boxMethod,detectorBox:manual.detectorBox,method:manual.method,
          ...(manual.footCandidate?{footCandidate:manual.footCandidate}:{}),
          ...(manual.groundContactConfirmed===false?{groundContactConfirmed:false}:{}),
          supportFrames:manual.supportFrames,...(manual.rangeCorrection?{rangeCorrection:structuredClone(manual.rangeCorrection)}:{}),reviewRequired:true};
      }
      if (visibility?.state==='occluded') return {frame,time:record.time,source:'missing',x:null,y:null,
        trackId:identity?.trackId??null,visibility:'occluded_waiting',...identityProvenance(identity)};
      if (identity?.kind==='track') {
        const box=lookup[frame].get(Number(identity.trackId));
        if (box) return {frame,time:record.time,x:(box[0]+box[2])/2,y:box[3],box:box.slice(0,4),
          source:'tracked',trackId:Number(identity.trackId),detectorScore:box[5],
          ...identityProvenance(identity),footMethod:'bbox_bottom_center'};
        return {frame,time:record.time,source:'missing',x:null,y:null,trackId:Number(identity.trackId),
          visibility:'occluded_waiting',...identityProvenance(identity)};
      }
      return {frame,time:record.time,source:'missing',x:null,y:null,...identityProvenance(identity)};
    });
    let left = -1;
    for (let right=0;right<points.length;right++) {
      if (points[right].x === null) continue;
      if (left >= 0 && right-left > 1) {
        const span = points[right].time-points[left].time;
        const gap = points.slice(left+1,right);
        const crossesCut = session.cuts.some(cut => cut > left && cut <= right);
        const crossesIdentity = boundaries.some(boundary=>boundary>left&&boundary<=right);
        const uncertain = gap.some(point => point.reviewExcluded || ['conflict','out_of_view'].includes(point.source));
        const travel = Math.hypot(points[right].x-points[left].x,points[right].y-points[left].y);
        // No extrapolation, no cuts, no identity conflicts; reject implausible jumps.
        if (span > 0 && span <= session.maxGapSeconds && !crossesCut && !crossesIdentity && !uncertain && travel/span <= 1800) {
          for (let frame=left+1;frame<right;frame++) {
            const fraction = (points[frame].time-points[left].time)/span;
            points[frame] = {frame,time:points[frame].time,x:points[left].x+(points[right].x-points[left].x)*fraction,
              y:points[left].y+(points[right].y-points[left].y)*fraction,box:null,source:'interpolated',
              ...identityProvenance(identityAt(entity,frame,session.cuts,frames[frame])),
              supportFrames:[left,right],method:'linear_image_coordinates',footMethod:'interpolated_image_point',reviewRequired:true};
          }
        }
      }
      left = right;
    }
    for(const point of points){
      const confirmed=frameIdentityConfirmed(entity,point,identityAt(entity,point.frame,session.cuts,frames[point.frame]));
      Object.assign(point,{frameIdentityConfirmed:confirmed,identityConfirmed:confirmed,identityReviewRequired:!confirmed});
    }
    result[entity.id] = points;
  }
  resolveIdentityOwners(result,session.entities,frames);
  for (const points of Object.values(result)) for (let frame=0;frame<points.length;frame++) {
    const point=points[frame];
    if(point.source==='interpolated' && point.supportFrames.some(index=>points[index].x==null)) {
      points[frame]={frame,time:point.time,x:null,y:null,source:point.supportFrames.some(index=>points[index].source==='conflict')?'conflict':'missing'};
    }
    if(points[frame].x==null||!['manual','tracked','manual_range'].includes(points[frame].source))
      Object.assign(points[frame],{frameIdentityConfirmed:false,identityConfirmed:false,identityReviewRequired:true});
  }
  for (const entity of session.entities) for (const point of result[entity.id]) {
    const visibility=playerVisibilityAt(entity,point.frame),outside=point.source==='out_of_view';
    point.observationState=outside?'out_of_view':visibility?.state==='occluded'?'occluded':
      ['manual','tracked'].includes(point.source)?'visible':'unknown';
    point.positionRequired=!outside;
    if(visibility)point.visibilitySource='human_range';
    if(outside)Object.assign(point,{identityReviewRequired:false,reviewRequired:false});
  }
  return result;
}

export function playerVisibilityAt(entity,frame) {
  return (entity.visibilityRanges||[]).find(range=>range.start<=frame&&range.end>=frame)||null;
}

// Store non-overlapping, inclusive frame ranges without changing identity or
// deleting observations. Undo and restoring normal recording reveal originals.
export function setPlayerVisibility(session,entityId,start,end,state,frames) {
  const entity=session.entities.find(item=>item.id===entityId);
  if(!entity)throw new Error('请先选择球员。');
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||start>end||end>=frames.length)
    throw new Error('状态区间的起止帧不正确。');
  if(!['visible','occluded','out_of_view'].includes(state))throw new Error('球员画面状态不正确。');
  const ranges=(entity.visibilityRanges||[]).flatMap(range=>{
    if(range.end<start||range.start>end)return [range];
    return [...(range.start<start?[{...range,end:start-1}]:[]),...(range.end>end?[{...range,start:end+1}]:[])];
  });
  ranges.push({start,end,state,origin:'human_visibility_review'});
  entity.visibilityRanges=ranges.sort((a,b)=>a.start-b.start);
  return {start,end,state};
}

// Display trails may not imply continuity across an identity change or a
// manually corrected image point. T trails only use boundaries of related P/Rs.
export function reviewTrailCuts(entities,cuts=[],frameCount=Infinity,trackId=null) {
  const related=trackId==null?entities:entities.filter(entity=>[
    ...identityKeyframes(entity),...(entity.bindings||[]),...(entity.modelBindings||[]),...(entity.anchors||[])
  ].some(item=>item.trackId!=null&&Number(item.trackId)===Number(trackId)));
  const boundaries=related.flatMap(entity=>[...identityBoundaries(entity),
    ...(entity.anchors||[]).flatMap(anchor=>[anchor.frame,anchor.frame+1])]);
  return mergeSourceCuts(cuts,boundaries,frameCount);
}

export function gapRanges(points) {
  const ranges=[];
  let start=null;
  for (let i=0;i<=points.length;i++) {
    const missing=i<points.length && ['missing','conflict'].includes(points[i].source);
    if (missing && start===null) start=i;
    if (!missing && start!==null) { ranges.push({start,end:i-1}); start=null; }
  }
  return ranges;
}

export function exportReview(session, clip, confirmedAt, {allowEmpty=false}={}) {
  const sourceCuts=mergeSourceCuts([],clip.sourceCuts,clip.frames.length);
  session=normalizeTeamColorMetadata({...session,cuts:mergeSourceCuts(session.cuts,sourceCuts,clip.frames.length)});
  const trajectories = buildTrajectories(session, clip.frames, sourceCuts);
  const entities = session.entities.filter(hasAssociation);
  if (!entities.length&&!allowEmpty) throw new Error('Select at least one target before confirming');
  const prepared=session.courtPreparation&&courtPreparationStatus(session.courtPreparation,preparationDependencies(session,clip)).current?session.courtPreparation:null;
  const {court,courtTrajectories,...coordinateData}=exportCourtData(session,clip.frames,trajectories,clip);
  if(clip.supportsCourtCalibration===false){court.template=null;court.applicability='unsupported_source_court';}
  return {schemaVersion:2,...(Number.isFinite(clip.mediaEndTime)?{mediaEndTime:clip.mediaEndTime}:{}),videoSha256:clip.video_sha256,coordinateSystem:'image_pixels',court,...coordinateData,
    ...(prepared?{courtPreparation:structuredClone(prepared),coordinatePolicy:{...coordinateData.coordinatePolicy,displaySmoothingApplied:prepared.smoothingPatches.length>0,preparedCourtRevision:prepared.revision}}:{}),
    teamIdentities:session.teamIdentities||null,
    ballStateEdits:session.ballStateEdits||[],ballGroundAnchors:session.ballGroundAnchors||[],
    ballCourtTrajectory:buildBallCourtTrajectory(session,clip.frames,trajectories,courtTrajectories,clip),
    width:clip.width,height:clip.height,selectionConfirmed:entities.length>0&&entities.every(isHumanIdentitySelected),confirmedAt,
    trackingRevision:clip.tracking_revision||clip.variant||'original',trackingFingerprint:clip.tracking_fingerprint||null,
    trackingMetadata:clip.trackingMetadata||null,modelSuggestionLoad:session.modelSuggestionLoad||null,
    allFramesManuallyVerified:false,liveSelection:session.liveSelection||null,identitySelection:session.identitySelection||null,
    sourceVideoSha256:clip.source_video_sha256||clip.video_sha256,
    sourceFrameMapping:clip.frames.map(f=>({frame:f.frame,time:f.time,sourceFrame:f.source_frame??f.frame,sourceTime:f.source_time??f.time})),
    settings:{maxGapSeconds:session.maxGapSeconds,cuts:[...session.cuts],sourceCuts,identityBindingMode:IDENTITY_BINDING_MODE},
    sceneObjects:exportSceneObjects(session,clip.frames,session.cuts,clip),
    entities:entities.map(entity => ({...entity,teamSide:entityTeamSide(entity),identityConfirmed:isHumanIdentitySelected(entity),trajectory:trajectories[entity.id],unresolved:gapRanges(trajectories[entity.id]),unverifiedPathFrames:trajectories[entity.id].filter(p=>p.source==='manual_path').map(p=>p.frame),courtTrajectory:prepared?.preparedByPlayer[entity.id]??courtTrajectories[entity.id],courtUnresolved:courtGaps(courtTrajectories[entity.id])}))};
}

export function isSelected(entity){return Boolean(entity.anchors?.length||entity.courtAnchors?.length||entity.identityKeyframes?.some(key=>key.kind==='track')||(entity.bindings||[]).some(item=>item.kind==='track'));}

export function isHumanIdentitySelected(entity) {
  return Boolean(identityKeyframes(entity).some(key=>key.kind==='track'||key.origin==='human_selection')||
    (entity.bindings||[]).some(binding=>binding.kind==='track')||(entity.anchors||[]).some(anchor=>anchor.identityConfirmed!==false&&anchor.source!=='manual_path')||
    (entity.frameConfirmations||[]).some(review=>{
      const anchor=(entity.anchors||[]).find(item=>item.frame===review.frame),identity=identityAt(entity,review.frame,[]);
      return frameIdentityConfirmed(entity,{frame:review.frame,x:anchor?.x??0,y:anchor?.y??0,
        trackId:review.trackId,source:anchor?'manual':'tracked'},identity);
    }));
}

export function confirmFrameIdentity(session,entityId,frame,frames,sourceCuts=[]) {
  const entity=session.entities.find(item=>item.id===entityId);
  if(!entity||!Number.isInteger(frame)||!frames[frame])throw new Error('人物确认帧不正确。');
  const point=buildTrajectories(session,frames,sourceCuts)[entityId][frame];
  if(point.x==null||point.y==null||!['manual','tracked','manual_range'].includes(point.source)||point.reviewExcluded)
    throw new Error('请先选定当前帧可见的人物；缺失、冲突和估计位置不能确认。');
  const cuts=mergeSourceCuts(session.cuts,sourceCuts,frames.length),identity=identityAt(entity,frame,cuts,frames[frame]);
  const manualPosition=point.trackId==null,anchor=(entity.anchors||[]).find(item=>item.frame===frame);
  if(manualPosition&&!anchor)throw new Error('当前帧没有可确认的人工位置。');
  const review={frame,trackId:point.trackId??null,origin:'human_frame_review',
    identityScope:manualPosition?'manual_position':identity.scope==='track_occurrences'?'track_occurrences':identity.identitySource,
    identityOrder:identity?.order||0,identityToken:identityReviewToken(identity),
    ...(manualPosition?{anchorSignature:anchorReviewSignature(anchor)}:{})};
  entity.frameConfirmations=(entity.frameConfirmations||[]).filter(item=>item.frame!==frame);
  entity.frameConfirmations.push(review);entity.frameConfirmations.sort((a,b)=>a.frame-b.frame);
  session.identitySelection=null;
  return review;
}

// A deliberate correction resolves ownership only on the frame being reviewed.
// Keep the accumulated tracks and neighboring human evidence for later review.
export function correctFrameIdentity(session,entityId,frame,proposal,frames,sourceCuts=[]) {
  const trackId=proposal?.trackId;
  if(!Number.isInteger(frame)||!frames[frame]||!Number.isInteger(trackId)||trackId<1||
      !frames[frame].tracks.some(row=>Number(row[4])===trackId))throw new Error('请选择当前帧有效的临时编号。');
  const copy=structuredClone(session),entity=copy.entities.find(item=>item.id===entityId);
  if(!entity)throw new Error('请先选择球员。');
  confirmBinding(copy,entityId,{kind:'track',trackId,start:frame,end:frame,origin:'human_frame_correction'},frames);
  // An old standalone point or an estimate must not hide the newly chosen box.
  entity.anchors=entity.anchors.filter(anchor=>anchor.frame!==frame||
    (anchor.trackId===trackId&&anchor.source!=='manual_path'));
  confirmFrameIdentity(copy,entityId,frame,frames,sourceCuts);
  Object.assign(session,copy);
  return {start:frame,end:frame};
}

export function hasAssociation(entity){return isSelected(entity)||Boolean(entity.visibilityRanges?.length)||Boolean(!entity.identitySuggestionsDismissed&&entity.modelBindings?.length);}

export function playerDisplayState(entity,point) {
  const identity=point?.frameIdentityConfirmed?'human_locked':point?.identitySource==='model_suggestion'?'model_proposed':
    ['manual_forward','manual_range','manual_track_occurrences'].includes(point?.identitySource)?'human_locked':'unassigned';
  if(point?.reviewExcluded)return {status:'unassigned',label:'已取消关联',identity:'unassigned'};
  if(point?.source==='out_of_view')return {status:'out_of_view',label:'镜头外 · 无需补点',identity};
  if(point?.source==='conflict')return {status:'conflict',label:'身份冲突',identity};
  if(['interpolated','manual_path'].includes(point?.source))return {status:'estimated',label:'估计 · 待复核',identity};
  if(point?.source==='manual_range'&&point.x!=null)return {status:'manual_range',label:point.frameIdentityConfirmed?'当前帧人物已确认 · 区间修正':'区间修正 · 当前帧待核对',identity};
  if(point?.x!=null)return {status:point.source==='manual'?'manual':'tracked',
    label:point.frameIdentityConfirmed?'当前帧人物已确认':point.source==='manual'?'人工位置 · 人物待核对':point.associationScope==='track_occurrences'?
      '整段归并 · 待逐帧核对':identity==='model_proposed'?'模型建议 · 待确认':'模型跟踪',identity};
  if(point?.observationState==='occluded')return {status:'occluded_waiting',label:'遮挡 / 漏识别 · 待恢复',identity};
  if(point?.visibility==='occluded_waiting')return {status:'occluded_waiting',label:'遮挡 / 断轨待续接',identity};
  return {status:'missing',label:'位置未知',identity};
}

export function trackCatalog(frames){
  const map=new Map();
  for(const frame of frames)for(const box of frame.tracks){
    const id=Number(box[4]);
    if(!map.has(id))map.set(id,{id,start:frame.frame,end:frame.frame,count:0,observations:[]});
    const item=map.get(id);item.end=frame.frame;item.count++;
    item.observations.push({frame:frame.frame,time:frame.time,box:box.slice(0,4)});
  }
  return [...map.values()].sort((a,b)=>a.id-b.id);
}

export function addBinding(entity,binding,frames){
  const {start,end}=binding;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>=frames.length||start>end)throw new Error('起止帧不正确');
  if(binding.kind!=='out_of_view'&&!frames.slice(start,end+1).some(frame=>frame.tracks.some(box=>Number(box[4])===Number(binding.trackId))))throw new Error('这个区间没有所选临时编号');
  entity.bindings ||= [];
  entity.bindings.push({...binding,trackId:binding.kind==='out_of_view'?null:Number(binding.trackId),identitySource:'human'});
}

export function confirmBinding(session,entityId,binding,frames){
  const entity=session.entities.find(item=>item.id===entityId);
  if(!entity)throw new Error('请先选择球员。');
  // Validate before changing the session or its confirmation order.
  const copy=structuredClone(entity);addBinding(copy,binding,frames);
  migrateIdentitySession(session);
  Object.assign(copy.bindings.at(-1),{exclusive:true,order:nextIdentityOrder(session)});
  entity.bindings=copy.bindings;session.identitySelection=null;
}

/** Pure preview/application: the finite override preserves every outside rule. */
export function replaceIdentityRange(session,{entityId,trackId,start,end},frames,sourceCuts=[]){
  if(!session.entities.some(e=>e.id===entityId)||!Number.isInteger(trackId)||trackId<1||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>=frames.length||start>end)throw new Error('请选择球员、有效临时编号和起止区间。');
  if(!frames.slice(start,end+1).some(f=>f.tracks.some(b=>Number(b[4])===trackId)))throw new Error('所选时间段没有这个临时编号的观测。');
  const before=buildTrajectories(session,frames,sourceCuts),draft=structuredClone(session),entity=draft.entities.find(e=>e.id===entityId);
  migrateIdentitySession(draft);const order=nextIdentityOrder(draft),cuts=mergeSourceCuts(draft.cuts,sourceCuts,frames.length);
  const boundaries=[start,...cuts.filter(f=>f>start&&f<=end),end+1];entity.bindings||=[];
  for(let i=0;i<boundaries.length-1;i++)entity.bindings.push({kind:'track',trackId,start:boundaries[i],end:boundaries[i+1]-1,origin:'human_range_replacement',order,exclusive:true,reviewRequired:true});
  // A point from the replaced person, or a missing-position sketch, must not
  // obscure the newly selected observation. Undo retains the complete input.
  entity.anchors=entity.anchors.filter(a=>a.frame<start||a.frame>end||(a.trackId===trackId&&a.source!=='manual_path'));
  entity.frameConfirmations=(entity.frameConfirmations||[]).filter(a=>a.frame<start||a.frame>end);draft.identitySelection=null;
  const after=buildTrajectories(draft,frames,sourceCuts),preview={start,end,changed:0,missing:0,segments:boundaries.length-1,affectedPlayers:{}};
  for(let f=start;f<=end;f++){
    if(after[entityId][f].x==null)preview.missing++;else preview.changed++;
    for(const id of Object.keys(after))if(id!==entityId&&after[id][f].claimedBy===entityId&&before[id][f].x!=null)preview.affectedPlayers[id]=(preview.affectedPlayers[id]||0)+1;
  }
  return {session:draft,preview};
}

export function continuationSuggestions(points,frames,cuts=[]){
  const last=[...points].reverse().find(point=>point.x!==null&&point.box&&point.trackId!=null);
  if(!last)return [];
  const used=new Set(points.filter(point=>point.trackId!=null).map(point=>Number(point.trackId)));
  const height=Math.max(40,last.box[3]-last.box[1]);
  const recentTeam=(id,start,end)=>{
    const hints=frames.slice(Math.max(0,start),Math.min(frames.length,end+1)).map(frame=>frame.team_hints?.[id]).filter(Boolean);
    const yellow=hints.filter(hint=>hint==='yellow').length,white=hints.filter(hint=>hint==='white').length;
    return hints.length&&Math.max(yellow,white)/hints.length>=.75?(yellow>white?'yellow':'white'):null;
  };
  const oldTeam=recentTeam(last.trackId,last.frame-15,last.frame);
  const result=[];
  for(const item of trackCatalog(frames)){
    if(used.has(item.id))continue;
    const next=item.observations.find(point=>point.frame>=last.frame-3&&point.frame>0&&point.time-last.time<=1);
    if(!next||cuts.some(cut=>cut>Math.min(last.frame,next.frame)&&cut<=Math.max(last.frame,next.frame)))continue;
    const newTeam=recentTeam(item.id,next.frame,next.frame+15);
    if(oldTeam&&newTeam&&oldTeam!==newTeam)continue;
    const box=next.box,x=(box[0]+box[2])/2,y=box[3];
    const distance=Math.hypot(x-last.x,y-last.y)/height;
    if(distance>1.8)continue;
    result.push({id:item.id,start:Math.max(next.frame,last.frame+1),end:item.end,
      gapSeconds:next.time-last.time,distanceInHeights:distance,score:distance+Math.max(0,next.time-last.time),fromId:last.trackId,fromFrame:last.frame});
  }
  return result.filter(item=>item.start<=item.end).sort((a,b)=>a.score-b.score).slice(0,3);
}
