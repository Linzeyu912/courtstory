import {exportCourtData,courtGaps} from './court.mjs';
import {IDENTITY_BINDING_MODE,identityAt,identityBoundaries,identityProvenance,resolveIdentityOwners,migrateIdentitySession,nextIdentityOrder} from './identity-timeline.mjs';
import {mergeSourceCuts} from './tracking-display.mjs';
import {exportSceneObjects} from './scene-objects.mjs';
export function blankSession(videoHash) {
  return { version: 1, videoHash, identityBindingMode:IDENTITY_BINDING_MODE, maxGapSeconds: 0.5, cuts: [], entities: Array.from({length:10}, (_,i) => ({id:`P${i+1}`, name:`球员 ${i+1}`, role:'player', anchors:[]})) };
}

export function buildTrajectories(session, frames) {
  const lookup = frames.map(frame => new Map(frame.tracks.map(box => [Number(box[4]), box])));
  const result = {};
  for (const entity of session.entities) {
    const anchors = [...entity.anchors].sort((a,b) => a.frame-b.frame);
    const boundaries = identityBoundaries(entity);
    const points = frames.map((record, frame) => {
      const manual = anchors.find(anchor => anchor.frame === frame);
      const identity = identityAt(entity,frame,session.cuts);
      if (identity?.kind==='out_of_view') return {frame,time:record.time,x:null,y:null,source:'out_of_view',...identityProvenance(identity)};
      // An old position tied to a replaced ID must not override a new identity.
      if (manual && (manual.trackId==null || (identity?.kind==='track' && Number(manual.trackId)===Number(identity.trackId)))) {
        return {frame,time:record.time,x:manual.x,y:manual.y,box:manual.box||null,
          source:manual.source==='manual_path'?'manual_path':'manual',trackId:manual.trackId??null,
          ...(manual.trackId!=null?identityProvenance(identity):{}),
          footMethod:manual.footMethod||(manual.box?'bbox_bottom_center':'human_image_anchor'),
          boxMethod:manual.boxMethod,detectorBox:manual.detectorBox,method:manual.method,
          ...(manual.footCandidate?{footCandidate:manual.footCandidate}:{}),
          ...(manual.groundContactConfirmed===false?{groundContactConfirmed:false}:{}),
          supportFrames:manual.supportFrames,reviewRequired:true};
      }
      if (identity?.kind==='track') {
        const box=lookup[frame].get(Number(identity.trackId));
        if (box) return {frame,time:record.time,x:(box[0]+box[2])/2,y:box[3],box:box.slice(0,4),
          source:'tracked',trackId:Number(identity.trackId),detectorScore:box[5],
          ...identityProvenance(identity),footMethod:'bbox_bottom_center'};
      }
      return {frame,time:record.time,source:'missing',x:null,y:null};
    });
    let left = -1;
    for (let right=0;right<points.length;right++) {
      if (points[right].x === null) continue;
      if (left >= 0 && right-left > 1) {
        const span = points[right].time-points[left].time;
        const gap = points.slice(left+1,right);
        const crossesCut = session.cuts.some(cut => cut > left && cut <= right);
        const crossesIdentity = boundaries.some(boundary=>boundary>left&&boundary<=right);
        const uncertain = gap.some(point => ['conflict','out_of_view'].includes(point.source));
        const travel = Math.hypot(points[right].x-points[left].x,points[right].y-points[left].y);
        // No extrapolation, no cuts, no identity conflicts; reject implausible jumps.
        if (span > 0 && span <= session.maxGapSeconds && !crossesCut && !crossesIdentity && !uncertain && travel/span <= 1800) {
          for (let frame=left+1;frame<right;frame++) {
            const fraction = (points[frame].time-points[left].time)/span;
            points[frame] = {frame,time:points[frame].time,x:points[left].x+(points[right].x-points[left].x)*fraction,
              y:points[left].y+(points[right].y-points[left].y)*fraction,box:null,source:'interpolated',
              supportFrames:[left,right],method:'linear_image_coordinates',footMethod:'interpolated_image_point',reviewRequired:true};
          }
        }
      }
      left = right;
    }
    result[entity.id] = points;
  }
  resolveIdentityOwners(result,session.entities,frames);
  for (const points of Object.values(result)) for (let frame=0;frame<points.length;frame++) {
    const point=points[frame];
    if(point.source==='interpolated' && point.supportFrames.some(index=>points[index].x==null)) {
      points[frame]={frame,time:point.time,x:null,y:null,source:point.supportFrames.some(index=>points[index].source==='conflict')?'conflict':'missing'};
    }
  }
  return result;
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

export function exportReview(session, clip, confirmedAt) {
  const sourceCuts=mergeSourceCuts([],clip.sourceCuts,clip.frames.length);
  session={...session,cuts:mergeSourceCuts(session.cuts,sourceCuts,clip.frames.length)};
  const trajectories = buildTrajectories(session, clip.frames);
  const entities = session.entities.filter(isSelected);
  if (!entities.length) throw new Error('Select at least one target before confirming');
  const {court,courtTrajectories}=exportCourtData(session,clip.frames,trajectories);
  if(clip.supportsCourtCalibration===false){court.template=null;court.applicability='unsupported_source_court';}
  return {schemaVersion:2,videoSha256:clip.video_sha256,coordinateSystem:'image_pixels',court,
    width:clip.width,height:clip.height,selectionConfirmed:true,confirmedAt,
    trackingRevision:clip.tracking_revision||'original',trackingFingerprint:clip.tracking_fingerprint||null,
    allFramesManuallyVerified:false,liveSelection:session.liveSelection||null,identitySelection:session.identitySelection||null,
    sourceVideoSha256:clip.source_video_sha256||clip.video_sha256,
    sourceFrameMapping:clip.frames.map(f=>({frame:f.frame,time:f.time,sourceFrame:f.source_frame??f.frame,sourceTime:f.source_time??f.time})),
    settings:{maxGapSeconds:session.maxGapSeconds,cuts:[...session.cuts],sourceCuts,identityBindingMode:IDENTITY_BINDING_MODE},
    sceneObjects:exportSceneObjects(session,clip.frames),
    entities:entities.map(entity => ({...entity,trajectory:trajectories[entity.id],unresolved:gapRanges(trajectories[entity.id]),unverifiedPathFrames:trajectories[entity.id].filter(p=>p.source==='manual_path').map(p=>p.frame),courtTrajectory:courtTrajectories[entity.id],courtUnresolved:courtGaps(courtTrajectories[entity.id])}))};
}

export function isSelected(entity){return Boolean(entity.anchors.length||entity.courtAnchors?.length||entity.identityKeyframes?.some(key=>key.kind==='track')||(entity.bindings||[]).some(item=>item.kind==='track'));}

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
