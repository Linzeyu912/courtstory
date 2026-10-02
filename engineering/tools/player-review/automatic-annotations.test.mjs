import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {blankSession,buildTrajectories,draftStorageKey,exportReview,confirmFrameIdentity} from './trajectory.mjs';
import {adoptIdentitySuggestions,confirmIdentity} from './identity-timeline.mjs';
import {setTeamGroup,effectiveTeamGroup} from './team-overlay.mjs';
import {feetForPoint} from './feet-candidates.mjs';
import {trackingDiagnostic} from './tracking-diagnostics.mjs';

const api=await import('./automatic-annotations.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
const initialize=(session,clip)=>{
  assert.equal(typeof api.initializeAutomaticAnnotations,'function','automatic initializer is required');
  return api.initializeAutomaticAnnotations(session,clip);
};
const candidates=(clip,frame,points)=>{
  assert.equal(typeof api.automaticPlayerCandidates,'function','visible candidate helper is required');
  return api.automaticPlayerCandidates(clip,frame,points);
};
const sha=value=>createHash('sha256').update(value).digest('hex');
const basis=frames=>frames.map(row=>[row.frame,row.time,row.source_frame_pts??null,
  row.source_time_base??null,row.source_frame??null,row.source_time??null]);
const proposal=(id,trackId,end=3,extra={})=>({id,bindings:[{start:0,end,trackId}],...extra});
const suggestions=entities=>({version:1,verified:false,method:'conservative-common-frame-segments',entities});
function fixture(){
  const frames=Array.from({length:4},(_,frame)=>({frame,time:frame/25,
    tracks:[1,2,3].map((id,index)=>[index*100,2,index*100+30,80,id,.7,2])}));
  const identitySuggestions={...suggestions([proposal('P6',1,3,{sourcePlayerId:'P2',teamGroup:'B',teamHint:'white'})]),
    teamGrouping:{version:1,verified:false,layout:'reserved_5_plus_5_v1',labels:{A:'dark',B:'white'}}};
  const clip={video_sha256:'video',tracking_raw_fingerprint:'raw',tracking_fingerprint:'rich',
    variant:'team-stable',width:500,height:100,frames,sourceCuts:[],identitySuggestions,
    trackingMetadata:{player_class_id:2,model_names:{2:'player',3:'referee'}}};
  clip.identitySupplement={variant:'optimized',video_sha256:clip.video_sha256,
    tracking_raw_fingerprint:'raw',frameMapping:basis(frames),sourceCuts:[],
    identitySuggestions:suggestions([proposal('P1',2),proposal('P2',1),proposal('P3',3)])};
  return clip;
}

test('fresh initialization preserves grouped P6 and recovers other identities without inheriting its model team hint',()=>{
  const clip=fixture(),session=blankSession('video'),before=structuredClone(clip);
  const result=initialize(session,clip),points=buildTrajectories(session,clip.frames);
  assert.equal(result.playerCount,3);
  assert.equal(points.P6[0].trackId,1);
  assert.equal(points.P1[0].trackId,2);assert.equal(points.P2[0].trackId,3);
  assert.equal(effectiveTeamGroup(session.entities[5]),'B');
  assert.equal(effectiveTeamGroup(session.entities[0]),'A');assert.equal(session.entities[0].modelTeamGroup,undefined);
  assert.equal(points.P1[0].identityConfirmed,false);
  assert.equal(Object.hasOwn(session,'teamRoles'),false);
  assert.equal(session.automaticAnnotation.teamLayout,'fixed_red_blue_color_only_v1');
  assert.equal(session.modelSuggestionLoad.teamLayout,'fixed_red_blue_color_only_v1');
  assert.equal(exportReview(session,clip,'test').selectionConfirmed,false);
  assert.deepEqual(clip,before,'source metadata, hashes and raw frames remain unchanged');
});

test('model-only draft recovery is idempotent and never replaces already assigned P identities',()=>{
  const clip=fixture(),session=blankSession('video');
  adoptIdentitySuggestions(session,clip.identitySuggestions,clip.frames);
  const originalP6=structuredClone(session.entities[5]);
  initialize(session,clip);const first=structuredClone(session);
  session.teamRoles={red:'offense',blue:'defense'};
  session.automaticAnnotation.teamLayout='fixed_red_offense_blue_defense_v1';
  session.modelSuggestionLoad.teamLayout='fixed_red_offense_blue_defense_v1';
  const again=initialize(session,clip);
  assert.deepEqual(session,first);assert.deepEqual(session.entities[5],originalP6);
  assert.deepEqual(again.addedPlayerIds,[]);
});

test('human name, team, manual coordinates and deliberate untracked state survive automatic recovery',()=>{
  const clip=fixture(),session=blankSession('video');
  const p1=session.entities[0];Object.assign(p1,{name:'human',team:'team',jersey:'7',
    identityKeyframes:[{frame:0,kind:'untracked',trackId:null,origin:'human_selection'}],
    anchors:[{frame:1,x:111.25,y:77.75,trackId:null,identityConfirmed:false}]});
  Object.assign(p1,{teamGroup:null,teamGroupSource:'human'});
  const human=structuredClone(p1),key=draftStorageKey(clip,'team-stable');
  initialize(session,clip);
  assert.deepEqual(p1,human);assert.equal(draftStorageKey(clip,'team-stable'),key);
  assert.equal(buildTrajectories(session,clip.frames).P1[0].x,null);
  assert.deepEqual([buildTrajectories(session,clip.frames).P1[1].x,buildTrajectories(session,clip.frames).P1[1].y],[111.25,77.75]);
});

test('a human owner is not duplicated by a recovered model association',()=>{
  const clip=fixture(),session=blankSession('video');
  confirmIdentity(session,'P4',0,{trackId:2,box:clip.frames[0].tracks[1].slice(0,4)},clip.frames);
  initialize(session,clip);const points=buildTrajectories(session,clip.frames);
  for(let frame=0;frame<clip.frames.length;frame++){
    const owners=Object.values(points).filter(point=>point[frame].x!=null&&point[frame].trackId===2);
    assert.equal(owners.length,1);assert.equal(points.P4[frame].trackId,2);
  }
});

test('supplements from other videos, raw detectors, frame PTS or source cuts cannot supply T aliases',()=>{
  for(const mutate of [s=>s.video_sha256='other',s=>s.tracking_raw_fingerprint='other',
    s=>s.frameMapping[1][1]=1,s=>s.frameMapping[1][2]=999,s=>s.sourceCuts=[2]]){
    const clip=fixture();mutate(clip.identitySupplement);
    const session=blankSession('video'),result=initialize(session,clip);
    assert.equal(result.playerCount,1);assert(result.issues.includes('incompatible_identity_supplement'));
    assert.equal(buildTrajectories(session,clip.frames).P6[0].trackId,1);
  }
});

test('automatic bindings use only visible boxes and split at gaps, identity conflicts and cuts',()=>{
  const clip=fixture();clip.identitySupplement=null;
  clip.identitySuggestions=suggestions([proposal('P1',1)]);clip.sourceCuts=[2];
  clip.frames[1].tracks=clip.frames[1].tracks.filter(row=>row[4]!==1);
  clip.frames[2].track_evidence={'1':{identity_review_required:true}};
  const session=blankSession('video');session.maxGapSeconds=10;initialize(session,clip);
  assert.deepEqual(session.entities[0].modelBindings.map(({start,end})=>[start,end]),[[0,0],[3,3]]);
  const points=buildTrajectories(session,clip.frames,clip.sourceCuts).P1;
  assert.equal(points[1].x,null);assert.equal(points[2].x,null);assert.equal(points[3].trackId,1);
  const unresolved=candidates(clip,2,{P1:points});
  assert(unresolved.some(row=>row.trackId===1&&row.identityReviewRequired));
});

test('declared player-only common-frame seeding excludes referees, generic spectators and role conflicts',()=>{
  const clip=fixture();clip.identitySuggestions=null;clip.identitySupplement=null;
  clip.frames.forEach(row=>{
    row.tracks.push([330,2,360,80,40,.8,3],[370,2,390,80,50,.8,0]);
    row.track_roles={40:'referee',50:'person'};
    row.role_conflicts=[{trackIds:[3,40]}];
    row.objects=[{kind:'basketball',box:[1,1,2,2],score:.8}];
  });
  const session=blankSession('video');initialize(session,clip);
  const ids=session.entities.flatMap(e=>(e.modelBindings||[]).map(b=>b.trackId));
  assert.deepEqual([...new Set(ids)].sort((a,b)=>a-b),[1,2]);
  const raw=candidates(clip,0,buildTrajectories(session,clip.frames));
  assert.deepEqual(raw.map(item=>item.trackId),[3]);assert.equal(raw[0].roleConflict,true);
  const generic={...clip,trackingMetadata:{model_names:{0:'person',2:'car'}},
    frames:clip.frames.map(row=>({...row,track_roles:{},tracks:[[1,2,20,80,1,.9,0]]}))};
  const genericSession=blankSession('video');
  assert.equal(initialize(genericSession,generic).playerCount,0);
  assert.deepEqual(candidates(generic,0,{}),[]);
});

test('model votes remain separate evidence and cannot recolor fixed row teams',()=>{
  const clip=fixture();clip.identitySuggestions.unassignedTeamCandidates=[
    {sourcePlayerId:'P1',trackIds:[2],evidence:{dark:1},reason:'insufficient_team_evidence'},
    {sourcePlayerId:'P3',trackIds:[3],evidence:{dark:2,white:9},reason:'conflicting_team_evidence'}];
  const session=blankSession('video');initialize(session,clip);
  assert.equal(effectiveTeamGroup(session.entities[0]),'A');
  assert.equal(effectiveTeamGroup(session.entities[1]),'A');assert.equal(session.entities[1].modelTeamGroup,undefined);
  assert.equal(session.entities[0].teamGroupSource,undefined);
  const human=session.entities[0];human.teamGroup='B';human.teamGroupSource='human';
  initialize(session,clip);assert.equal(effectiveTeamGroup(human),'A');assert.equal(human.teamGroup,'B');
});

const repo=new URL('../../../',import.meta.url);
const json=path=>JSON.parse(readFileSync(new URL(path,repo)));
const samplePath=(id,variant,suffix)=>{
  const shared=`data/videos/tactics/acceptance/tracks/basketball-20261002/${id}-${variant}.${suffix}`;
  if(existsSync(new URL(shared,repo)))return shared;
  return variant==='team-stable'?`artifacts/player-team-overlay-20261002/r3/${id}-team-stable.${suffix}`:
    `artifacts/player-tracking-workbench-20261002/${id==='nba-lal-min-005'?'':`${id}_`}optimized.${suffix}`;
};
const hasActualSamples=['004','005','006','nba-lal-min-005'].every(id=>
  ['team-stable','optimized'].every(variant=>['json','meta.json'].every(suffix=>
    existsSync(new URL(samplePath(id,variant,suffix),repo)))));
function actualClip(id){
  const raw=readFileSync(new URL(samplePath(id,'team-stable','json'),repo));
  const m=json(samplePath(id,'team-stable','meta.json'));
  const frames=JSON.parse(raw),clip={video_sha256:m.video_sha256,frames,width:m.width,height:m.height,
    trackingMetadata:m,identitySuggestions:m.identitySuggestions,variant:'team-stable',sourceCuts:[],
    tracking_raw_fingerprint:sha(raw),tracking_fingerprint:'existing-rich-fingerprint'};
  const originalRaw=readFileSync(new URL(samplePath(id,'optimized','json'),repo));
  assert.equal(sha(originalRaw),sha(raw),'supplement must use byte-identical detector output');
  clip.identitySupplement={variant:'optimized',video_sha256:m.video_sha256,tracking_raw_fingerprint:sha(originalRaw),
    frameMapping:basis(JSON.parse(originalRaw)),sourceCuts:[],
    identitySuggestions:json(samplePath(id,'optimized','meta.json')).identitySuggestions};
  return clip;
}

test('all four immutable samples regain 636 visible P observations without collisions or hidden positions',
  {skip:hasActualSamples?false:'shared tracking snapshots and optional local artifacts are unavailable'},()=>{
  const expected={'004':[5,943,1231],'005':[9,1084,1195],'006':[8,1815,2026],'nba-lal-min-005':[8,1146,1172]};
  for(const [id,[beforeCount,beforeObs,afterObs]] of Object.entries(expected)){
    const clip=actualClip(id),source=JSON.stringify(clip),session=blankSession(clip.video_sha256);
    adoptIdentitySuggestions(session,clip.identitySuggestions,clip.frames);
    const before=structuredClone(session.entities.filter(e=>e.modelBindings?.length));
    assert.equal(before.length,beforeCount);
    const count=points=>Object.values(points).reduce((n,rows)=>n+rows.filter(p=>p.x!=null).length,0);
    assert.equal(count(buildTrajectories(session,clip.frames)),beforeObs);
    assert.equal(initialize(session,clip).playerCount,10);
    assert.equal(count(buildTrajectories(session,clip.frames)),afterObs);
    for(const entity of before)assert.deepEqual(session.entities.find(e=>e.id===entity.id),entity);
    const points=buildTrajectories(session,clip.frames);
    for(let f=0;f<clip.frames.length;f++){
      const visible=Object.values(points).map(rows=>rows[f]).filter(p=>p.x!=null);
      assert.equal(new Set(visible.map(p=>p.trackId)).size,visible.length,'one raw track cannot be two P identities');
      for(const p of visible){
        assert(clip.frames[f].tracks.some(row=>row[4]===p.trackId&&row[6]===2));
        assert(!clip.frames[f].track_evidence?.[p.trackId]?.identity_review_required);
        assert.equal(p.identityConfirmed,false);
      }
    }
    assert.equal(JSON.stringify(clip),source);
  }
});

test('004 late unmatched player detections remain visible once and cannot be forced into an occupied P',
  {skip:hasActualSamples?false:'shared tracking snapshots and optional local artifacts are unavailable'},()=>{
  const clip=actualClip('004'),session=blankSession(clip.video_sha256);initialize(session,clip);
  const points=buildTrajectories(session,clip.frames);
  for(const [frame,mapped,unmapped] of [[0,10,0],[70,6,3],[177,3,3]]){
    const visible=Object.values(points).filter(rows=>rows[frame].x!=null);
    const pending=candidates(clip,frame,points).filter(row=>row.trackId!=null);
    assert.equal(visible.length,mapped,`mapped at ${frame}`);assert.equal(pending.length,unmapped,`unmapped at ${frame}`);
    assert.equal(new Set([...visible.map(rows=>rows[frame].trackId),...pending.map(row=>row.trackId)]).size,mapped+unmapped);
  }
  assert.deepEqual(candidates(clip,177,points).filter(row=>row.trackId!=null).map(row=>row.trackId).sort((a,b)=>a-b),[29,39,46]);
});

test('ten seeded identities do not recycle a missing person number for a new disconnected track',()=>{
  const clip=fixture();clip.identitySuggestions=null;clip.identitySupplement=null;
  clip.frames=Array.from({length:3},(_,frame)=>({frame,time:frame/25,tracks:
    (frame===0?Array.from({length:10},(_,index)=>index+1):[1,2,3,40]).map(id=>[id*10,2,id*10+5,80,id,.8,2])}));
  const session=blankSession('video');assert.equal(initialize(session,clip).playerCount,10);
  const points=buildTrajectories(session,clip.frames);
  assert.equal(points.P4[1].x,null);
  assert(!Object.values(points).some(rows=>rows[1].trackId===40));
  assert.deepEqual(candidates(clip,1,points).map(row=>row.trackId),[40]);
  const before=structuredClone(session);initialize(session,clip);assert.deepEqual(session,before);
});

test('recovered identity keeps its fixed row color even when model votes favor the other team',()=>{
  const clip=fixture();clip.frames.forEach(record=>record.tracks=Array.from({length:6},(_,i)=>[i*50,2,i*50+30,80,i+1,.8,2]));
  clip.identitySuggestions={...suggestions(Array.from({length:5},(_,i)=>proposal(`P${i+1}`,i+1,3,
    {sourcePlayerId:`P${i+1}`,teamGroup:'A',teamHint:'dark'}))),
    teamGrouping:{version:1,verified:false,layout:'reserved_5_plus_5_v1',labels:{A:'dark',B:'white'}},
    unassignedTeamCandidates:[{sourcePlayerId:'P6',trackIds:[6],evidence:{dark:1},reason:'insufficient_team_evidence'}]};
  clip.identitySupplement.frameMapping=basis(clip.frames);
  clip.identitySupplement.identitySuggestions=suggestions(Array.from({length:6},(_,i)=>proposal(`P${i+1}`,i+1)));
  const session=blankSession('video');assert.equal(initialize(session,clip).playerCount,6);
  const p6=session.entities[5];assert.equal(buildTrajectories(session,clip.frames).P6[0].trackId,6);
  assert.equal(effectiveTeamGroup(p6),'B');assert.equal(p6.modelTeamGroup,'A');assert.deepEqual(p6.automaticTeamEvidence,{dark:1});
});

test('automatic aliases keep a same-detector feet profile valid and reject another detector namespace',()=>{
  const clip=fixture();clip.feetCandidates={videoHash:'video',trackingFingerprint:'raw',
    frames:[{frame:0,feet:[{trackId:2,left:{x:105,y:80},right:{x:115,y:80}}]}]};
  const session=blankSession('video');initialize(session,clip);
  const point=buildTrajectories(session,clip.frames).P1[0];
  assert.equal(feetForPoint(clip,0,point)?.trackId,2);
  assert.equal(clip.tracking_fingerprint,'rich');assert.equal(clip.tracking_raw_fingerprint,'raw');
  const before=structuredClone(session),changed={...clip,tracking_raw_fingerprint:'another-detector'};
  const result=initialize(session,changed);
  assert(result.issues.includes('incompatible_annotation_detector'));assert.deepEqual(session,before);
  assert.equal(feetForPoint(changed,0,point),null);
});

test('simple candidates retain low-score tracked players while weak or duplicate unindexed boxes stay in raw advanced data',()=>{
  const clip=fixture(),record=clip.frames[0];record.tracks[0][5]=.05;
  record.pending_detections=[[350,2,380,80,.49,2],[350,2,380,80,.9,2],
    [0,2,30,80,.9,2],[400,2,430,80,.9,3]];
  const raw=structuredClone(record),session=blankSession('video');initialize(session,clip);
  const points=buildTrajectories(session,clip.frames);
  assert.equal(points.P6[0].trackId,1,'low detector score does not erase a tracked identity');
  const simple=candidates(clip,0,points);
  assert.deepEqual(simple.map(row=>[row.trackId,row.score,row.box[0]]),[[null,.9,350]]);
  assert(candidates(clip,0,{}).some(row=>row.trackId===1&&row.score===.05),'unmatched tracked boxes are also not thresholded');
  assert.deepEqual(record,raw,'all low-score and duplicate raw detections remain available to advanced review');
});

test('known conflict in an existing model draft becomes a grey detection without rewriting its saved identity',()=>{
  assert.equal(typeof api.automaticAnnotationPointVisible,'function');
  for(const defect of ['identity','role']){
    const clip=fixture(),record=clip.frames[0],session=blankSession('video');
    adoptIdentitySuggestions(session,clip.identitySuggestions,clip.frames);
    if(defect==='identity')record.track_evidence={'1':{identity_review_required:true}};
    else record.role_conflicts=[{trackIds:[1,99]}];
    const preserved=structuredClone(session.entities[5]);initialize(session,clip);
    const points=buildTrajectories(session,clip.frames),point=points.P6[0];
    assert.equal(point.identitySource,'model_suggestion');
    assert.equal(api.automaticAnnotationPointVisible(clip,0,point),false);
    assert(candidates(clip,0,points).some(row=>row.trackId===1));
    assert.deepEqual(session.entities[5],preserved);
    const edited={...point,source:'manual',x:11.25,y:72.75,identityConfirmed:false};
    assert.equal(api.automaticAnnotationPointVisible(clip,0,edited),false,'position editing does not confirm a conflicted identity');
    confirmIdentity(session,'P6',0,{trackId:1,box:record.tracks[0].slice(0,4)},clip.frames);
    const human=buildTrajectories(session,clip.frames);
    assert.equal(api.automaticAnnotationPointVisible(clip,0,human.P6[0]),true);
    assert(!candidates(clip,0,human).some(row=>row.trackId===1));
    assert.equal(api.automaticAnnotationPointVisible(clip,0,{...human.P6[0],x:null}),false);
  }
});

test('a reviewed risk-marked model observation becomes visible only on that frame and keeps diagnostic warnings',()=>{
  for(const defect of ['identity','role']){
    const clip=fixture(),session=blankSession('video');
    adoptIdentitySuggestions(session,clip.identitySuggestions,clip.frames);
    for(const record of clip.frames.slice(0,2)){
      if(defect==='identity')record.track_evidence={'1':{identity_review_required:true}};
      else record.role_conflicts=[{trackIds:[1,99]}];
    }
    const source=structuredClone(clip),model=structuredClone(session.entities[5].modelBindings);
    assert.equal(api.automaticAnnotationPointVisible(clip,0,buildTrajectories(session,clip.frames).P6[0]),false);
    confirmFrameIdentity(session,'P6',0,clip.frames);
    const points=buildTrajectories(session,clip.frames),point=points.P6[0];
    assert.equal(point.identitySource,'model_suggestion');assert.equal(point.frameIdentityConfirmed,true);
    assert.equal(api.automaticAnnotationPointVisible(clip,0,point),true);
    assert.equal(api.automaticAnnotationPointVisible(clip,1,points.P6[1]),false);
    assert(!candidates(clip,0,points).some(candidate=>candidate.trackId===1));
    assert.match(trackingDiagnostic(clip.frames[0],point).label,/人工确认.*风险提示/);
    assert.match(trackingDiagnostic(clip.frames[0],point).detail,defect==='identity'?/模型标记身份待核对/:/人物角色冲突/);
    for(const source of ['conflict','missing','out_of_view','interpolated','manual_path'])
      assert.equal(api.automaticAnnotationPointVisible(clip,0,{...point,source}),false,source);
    assert.equal(api.automaticAnnotationPointVisible(clip,0,{...point,x:NaN}),false);
    assert.deepEqual(clip,source);assert.deepEqual(session.entities[5].modelBindings,model);
  }
});


test('clear suppresses automatic and explicit reload without recycling its rejected model track',()=>{
  const clip=fixture(),session=blankSession('video');initialize(session,clip);
  const p6=session.entities[5];p6.modelBindings=[];p6.identitySuggestionsDismissed=true;
  delete p6.modelTeamGroup;delete p6.modelTeamHint;
  const cleared=JSON.parse(JSON.stringify(session));
  initialize(cleared,clip);adoptIdentitySuggestions(cleared,clip.identitySuggestions,clip.frames);
  assert.deepEqual(cleared.entities[5].modelBindings,[]);
  assert.equal(cleared.entities[5].identitySuggestionsDismissed,true);
  for(const rows of Object.values(buildTrajectories(cleared,clip.frames)))
    assert(rows.every(point=>point.trackId!==1||point.x==null));
  assert(!exportReview(cleared,clip,'test').entities.some(entity=>entity.id==='P6'));
});

test('release takes priority over stale and reloaded model bindings in image and court exports',()=>{
  const clip=fixture(),session=blankSession('video');initialize(session,clip);
  const p6=session.entities[5],before=structuredClone(session);
  p6.bindings=[{kind:'unassigned',start:1,end:2,trackId:null,order:1,exclusive:true,origin:'human_release'}];
  p6.courtAnchors=[{frame:1,x:4,y:6}];session.maxGapSeconds=1;
  session.cuts=[2]; // Even a later cut cannot reopen an explicitly cancelled range.
  initialize(session,clip);adoptIdentitySuggestions(session,clip.identitySuggestions,clip.frames);
  const loaded=JSON.parse(JSON.stringify(session));initialize(loaded,clip);
  const output=exportReview(loaded,clip,'test'),entity=output.entities.find(row=>row.id==='P6');
  for(const frame of [1,2]){
    assert.equal(entity.trajectory[frame].x,null);assert.equal(entity.trajectory[frame].reviewExcluded,true);
    assert.equal(entity.courtTrajectory[frame].x,null);assert.equal(entity.courtTrajectory[frame].reviewExcluded,true);
  }
  assert.equal(entity.trajectory[0].trackId,1);
  assert.equal(buildTrajectories(before,clip.frames).P6[1].trackId,1,'undo snapshot retains the original model association');
});

test('automatic refresh after exchanging players keeps model and profile evidence with the person',()=>{
  const clip=fixture(),session=blankSession('video');initialize(session,clip);
  const before=structuredClone(session);
  const originalP6=session.entities[5],originalP1=session.entities[0];
  Object.assign(originalP6,{name:'confirmed',playerProfile:{normalizedNameKey:'person'},ratingReference:{edition:'NBA 2K25'}});
  session.entities[0]={...originalP6,id:'P1',teamSide:'red'};
  session.entities[5]={...originalP1,id:'P6',teamSide:'blue'};
  const loaded=JSON.parse(JSON.stringify(session));initialize(loaded,clip);
  assert.equal(buildTrajectories(loaded,clip.frames).P1[0].trackId,1);
  assert.equal(buildTrajectories(loaded,clip.frames).P6[0].trackId,2);
  assert.equal(loaded.entities[0].playerProfile.normalizedNameKey,'person');
  assert.equal(effectiveTeamGroup(loaded.entities[0]),'A');assert.equal(loaded.entities[0].modelTeamGroup,'B');
  const exported=exportReview(loaded,clip,'test').entities.find(entity=>entity.id==='P1');
  assert.equal(exported.teamSide,'red');assert.equal(exported.ratingReference.edition,'NBA 2K25');
  assert.equal(buildTrajectories(before,clip.frames).P6[0].trackId,1,'undo state was not mutated');
});


test('cleared and released model observations cannot move into an empty slot after a roster swap',()=>{
  for(const clearAll of [true,false]){
    const clip=fixture(),session=blankSession('video');initialize(session,clip);
    const source=session.entities[5];
    source.dismissedModelBindings=source.modelBindings.map(binding=>({...binding,start:clearAll?0:1,end:clearAll?3:2}));
    if(clearAll){source.modelBindings=[];source.identitySuggestionsDismissed=true;}
    else {
      source.modelBindings=[{...source.modelBindings[0],start:0,end:0},{...source.modelBindings[0],start:3,end:3}];
      source.bindings=[{kind:'unassigned',start:1,end:2,trackId:null,order:1,exclusive:true,origin:'human_release'}];
    }
    session.entities[5]={...session.entities[8],id:'P6',teamSide:'blue'};
    session.entities[8]={...source,id:'P9',teamSide:'blue'};
    const loaded=JSON.parse(JSON.stringify(session));initialize(loaded,clip);
    const points=buildTrajectories(loaded,clip.frames);
    for(const frame of clearAll?[0,1,2,3]:[1,2])
      assert(!Object.values(points).some(rows=>rows[frame].trackId===1&&rows[frame].x!=null),`rejected track is absent after swap at ${frame}`);
    if(!clearAll){assert.equal(points.P9[0].trackId,1);assert.equal(points.P9[3].trackId,1);}
    adoptIdentitySuggestions(loaded,clip.identitySuggestions,clip.frames);
    for(const frame of clearAll?[0,1,2,3]:[1,2])
      assert(!Object.values(buildTrajectories(loaded,clip.frames)).some(rows=>rows[frame].trackId===1&&rows[frame].x!=null));
  }
});
