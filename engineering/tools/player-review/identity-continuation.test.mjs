import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession,buildTrajectories,confirmBinding,confirmFrameIdentity} from './trajectory.mjs';

const core=await import('./identity-continuation.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
function fixture(){
  const clip={video_sha256:'warriors-source',tracking_fingerprint:'raw-v1',width:1000,height:700,sourceCuts:[],
    frames:Array.from({length:16},(_,frame)=>({frame,time:frame/10,tracks:[
      [100+frame,20,140+frame,180,2,.9,0],[400+frame,30,450+frame,200,62,.9,0]]}))};
  const session=blankSession(clip.video_sha256);
  return {clip,session};
}
function reference(clip){assert.equal(typeof core.createIdentityReference,'function');return core.createIdentityReference(clip,{frame:2,trackId:2,team:'紫色球衣',jersey:'10'});}
const segment=(patch={})=>({id:'later-purple',trackId:62,start:8,end:12,confidence:.84,reason:'紫衣与背号 10 的抽样画面相符',evidenceFrames:[8,10,12],...patch});
function apply(session,ref,segments,clip){assert.equal(typeof core.applyIdentityCandidates,'function');return core.applyIdentityCandidates(session,{entityId:'P1',reference:ref,segments},clip);}

test('reference captures the exact observed box and rejects missing tracks, invalid source and nonfinite coordinates',()=>{
  const {clip}=fixture(),ref=reference(clip);
  assert.deepEqual(ref,{version:1,videoHash:'warriors-source',trackingFingerprint:'raw-v1',frame:2,trackId:2,box:[102,20,142,180],team:'紫色球衣',jersey:'10'});
  assert.throws(()=>core.createIdentityReference(clip,{frame:2,trackId:99,team:'紫',jersey:'10'}));
  assert.throws(()=>core.createIdentityReference({...clip,tracking_fingerprint:''},{frame:2,trackId:2,team:'紫',jersey:'10'}));
  assert.throws(()=>core.createIdentityReference(clip,{frame:2,trackId:2,team:'紫'.repeat(41),jersey:'10'}));
  assert.throws(()=>core.createIdentityReference(clip,{frame:2,trackId:2,team:'紫',jersey:'A10'}));
  clip.frames[2].tracks[0][0]=NaN;assert.throws(()=>reference(clip));
});

test('bounded adoption follows T62 only in the accepted interval and never expands T2 after it changes person',()=>{
  const {clip,session}=fixture(),ref=reference(clip);
  session.entities[0].modelBindings=[{kind:'track',trackId:2,start:0,end:15}];
  const original=structuredClone(session),before=buildTrajectories(session,clip.frames);
  const result=apply(session,ref,[segment()],clip),after=buildTrajectories(result.session,clip.frames);
  assert.deepEqual(session,original,'the caller retains a complete undo snapshot');
  assert(after.P1.slice(8,13).every(p=>p.trackId===62&&p.identityReviewRequired&&!p.frameIdentityConfirmed));
  for(const frame of [0,1,2,3,4,5,6,7,13,14,15])assert.deepEqual(after.P1[frame],before.P1[frame]);
  assert.equal(result.preview.changed,5);assert.equal(result.preview.segments,1);
  assert(result.session.entities[0].bindings.every(b=>b.reviewRequired&&b.start>=8&&b.end<=12));
});

test('adoption splits missing observations and camera cuts while preserving the gap and outside session records',()=>{
  const {clip,session}=fixture(),ref=reference(clip);
  clip.frames[10].tracks=clip.frames[10].tracks.filter(row=>row[4]!==62);clip.sourceCuts=[12];
  session.entities[0].events=[{frame:1,type:'pass'}];
  const r=apply(session,ref,[segment({end:14,evidenceFrames:[8,12,14]})],clip);
  assert.deepEqual(r.session.entities[0].bindings.map(b=>[b.start,b.end]),[[8,9],[11,11],[12,14]]);
  const points=buildTrajectories(r.session,clip.frames,clip.sourceCuts).P1;
  assert.equal(points[10].x,null);assert.equal(points[15].x,null);
  assert.equal(r.preview.missing,1);assert.equal(r.preview.segments,3);
  assert.deepEqual(r.session.entities[0].events,session.entities[0].events);
});

test('reference source or box mismatches reject adoption before any mutation',()=>{
  const {clip,session}=fixture(),ref=reference(clip),before=structuredClone(session);
  for(const invalid of [{...ref,videoHash:'other'},{...ref,trackingFingerprint:'raw-v2'},{...ref,box:[0,0,1,1]}])assert.throws(()=>apply(session,invalid,[segment()],clip));
  assert.throws(()=>apply({...session,videoHash:'other'},ref,[segment()],clip));assert.deepEqual(session,before);
});

test('malformed, overlapping or duplicate candidate segments fail atomically',()=>{
  const {clip,session}=fixture(),ref=reference(clip),before=structuredClone(session);
  for(const segments of [[],[segment({start:-1})],[segment({end:16})],[segment({trackId:99})],[segment({confidence:NaN})],
    [segment({evidenceFrames:[99]})],[segment(),segment({id:'other',start:11,end:14})],
    [segment({end:9,evidenceFrames:[8]}),segment({start:11})]])assert.throws(()=>apply(session,ref,segments,clip));
  assert.deepEqual(session,before);
});

test('other player manual ownership, including nonexclusive whole-track claims, cannot be stolen by Agent adoption',()=>{
  for(const scope of [undefined,'track_occurrences']){
    const {clip,session}=fixture(),ref=reference(clip);
    session.entities[1].bindings=[{kind:'track',trackId:62,start:9,end:10,origin:'human_selection',scope,order:1}];
    const before=structuredClone(session);assert.throws(()=>apply(session,ref,[segment()],clip),/P2|球员 2/);assert.deepEqual(session,before);
  }
});

test('other player manual anchors are protected even when no active identity currently exposes them',()=>{
  const {clip,session}=fixture(),ref=reference(clip);
  session.entities[1].anchors.push({frame:9,x:421,y:201,trackId:62,identityConfirmed:false});
  assert.throws(()=>apply(session,ref,[segment()],clip),/P2|球员 2/);
});

test('own incompatible human identity and independent point corrections reject the complete batch',()=>{
  for(const field of ['identity','point']){
    const {clip,session}=fixture(),ref=reference(clip);
    if(field==='identity')confirmBinding(session,'P1',{kind:'track',trackId:2,start:10,end:10},clip.frames);
    else session.entities[0].anchors.push({frame:10,x:500,y:500,trackId:null,identityConfirmed:false});
    const before=structuredClone(session);
    assert.throws(()=>apply(session,ref,[segment({id:'first',start:3,end:4,evidenceFrames:[3]}),segment()],clip),/人工|冲突/);
    assert.deepEqual(session,before);
  }
});

test('compatible human-reviewed frames retain their exact identity and confirmation while surrounding candidates remain pending',()=>{
  const {clip,session}=fixture(),ref=reference(clip);
  confirmBinding(session,'P1',{kind:'track',trackId:62,start:10,end:10},clip.frames);confirmFrameIdentity(session,'P1',10,clip.frames);
  const before=buildTrajectories(session,clip.frames),r=apply(session,ref,[segment()],clip),after=buildTrajectories(r.session,clip.frames);
  assert.deepEqual(after.P1[10],before.P1[10]);assert.equal(after.P1[10].frameIdentityConfirmed,true);
  assert.equal(after.P1[9].frameIdentityConfirmed,false);assert.equal(r.preview.preservedManual,1);
});

test('saving a reference clones the session without silently binding the entire temporary track',()=>{
  const {clip,session}=fixture(),ref=reference(clip),before=structuredClone(session);
  assert.equal(typeof core.saveReferenceToSession,'function');const next=core.saveReferenceToSession(session,{entityId:'P1',reference:ref},clip);
  assert.deepEqual(session,before);assert.deepEqual(next.entities[0].identityReference,ref);
  assert.deepEqual(buildTrajectories(next,clip.frames),buildTrajectories(session,clip.frames));
  ref.box[0]=999;assert.equal(next.entities[0].identityReference.box[0],102);
});

test('frame reviews over model suggestions protect both other ownership and own incompatible corrections',()=>{
  for(const id of ['P1','P2']){
    const {clip,session}=fixture(),ref=reference(clip),entity=session.entities.find(e=>e.id===id);
    entity.modelBindings=[{kind:'track',trackId:id==='P1'?2:62,start:0,end:15}];
    confirmFrameIdentity(session,id,10,clip.frames);const original=structuredClone(session);
    assert.throws(()=>apply(session,ref,[segment()],clip),/人工|冲突/);assert.deepEqual(session,original);
  }
});

test('compatible frame review over a model suggestion survives accepted surrounding frames',()=>{
  const {clip,session}=fixture(),ref=reference(clip);
  session.entities[0].modelBindings=[{kind:'track',trackId:62,start:0,end:15}];confirmFrameIdentity(session,'P1',10,clip.frames);
  const before=buildTrajectories(session,clip.frames),result=apply(session,ref,[segment()],clip);
  assert.deepEqual(buildTrajectories(result.session,clip.frames).P1[10],before.P1[10]);
});

test('Warriors frame 380 T2 reference adopts frame 853 T62 without inheriting frame 853 T2',()=>{
  const {clip,session}=fixture();
  clip.frames=Array.from({length:1489},(_,frame)=>({frame,time:frame/60,tracks:[
    [640.9,214.2,690.9,329.5,2,.9,0],...(frame>=853?[[377.3,320,450,491.8,62,.9,0]]:[])]}));
  clip.frames[853].tracks[0]=[777.3,479.1,855.5,617.3,2,.9,0];
  const ref=core.createIdentityReference(clip,{frame:380,trackId:2,team:'紫衣',jersey:'10'});
  const result=apply(session,ref,[segment({start:853,end:855,evidenceFrames:[853,855]})],clip),points=buildTrajectories(result.session,clip.frames).P1;
  assert.equal(points[380].x,null);assert.equal(points[852].x,null);assert.equal(points[856].x,null);
  assert.equal(points[853].trackId,62);assert.deepEqual(points[853].box,[377.3,320,450,491.8]);
});
