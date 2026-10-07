import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession,buildTrajectories,confirmFrameIdentity} from './trajectory.mjs';
import {identityAt} from './identity-timeline.mjs';
import {initializeAutomaticAnnotations,automaticPlayerCandidates} from './automatic-annotations.mjs';
import {applyInitialIdentityReview,initialIdentitySlotBasis} from './identity-initial-review.mjs';

function fixture(){
  const clip={video_sha256:'video',tracking_fingerprint:'tracks',tracking_revision:'v1',width:600,height:300,sourceCuts:[],
    trackingMetadata:{player_class_id:2,model_names:{2:'player',3:'referee'}},
    frames:Array.from({length:12},(_,frame)=>({frame,time:frame/10,tracks:[
      [50+frame,40,90+frame,200,1,.9,2],[200+frame,40,240+frame,200,2,.9,2],[400+frame,40,440+frame,200,3,.9,2]]}))};
  const session=blankSession('video');
  session.entities[0].modelBindings=[{kind:'track',trackId:1,start:0,end:11}];
  session.entities[1].modelBindings=[{kind:'track',trackId:2,start:0,end:11}];
  const subject=(id,entityId,role)=>({subjectId:id,entityId,role,team:role==='player'?'紫色':'',jersey:'',confidence:.9,reason:'画面中球衣和外观有依据',evidenceFrames:[0,11]});
  const segment=(id,subjectId,entityId,trackId,role)=>({id,subjectId,entityId,trackId,role,start:0,end:11,confidence:.9,reason:'首尾画面可见且中间没有缺测',evidenceFrames:[0,11]});
  const result={jobId:'job-a',generationJobId:'job-a',purpose:'initial_review',sourceKey:'source-key',algoVersion:'initial-identity-review-v1',
    base:{videoHash:'video',trackingFingerprint:'tracks',trackingRevision:'v1',sessionDigest:'full-digest'},
    candidate:{schemaVersion:1,summary:'一个球员续接，另一观察为裁判。',identityVerified:false,reviewRequired:true,
      subjects:[subject('person-a','P1','player'),subject('person-b',null,'referee')],
      segments:[segment('a','person-a','P1',1,'player'),segment('b','person-b',null,2,'referee')],
      issues:[],slotBasis:initialIdentitySlotBasis(session)}};
  return {clip,session,result};
}
const basis=(session,result)=>{result.candidate.slotBasis=initialIdentitySlotBasis(session);};
const ranges=entity=>(entity.modelBindings??[]).map(({start,end})=>[start,end]);

test('applies finite model suggestions and role exclusions without creating any human review fact',()=>{
  const {clip,session,result}=fixture(),original=structuredClone(session),source=structuredClone(clip);
  const applied=applyInitialIdentityReview(session,result,clip),after=buildTrajectories(applied.session,clip.frames,clip.sourceCuts,clip);
  assert.deepEqual(session,original);assert.deepEqual(clip,source);
  assert.equal(applied.report.changedModelBindings,2);assert.equal(applied.report.excludedObservations,12);
  assert(after.P1.every(p=>p.identitySource==='model_suggestion'&&!p.frameIdentityConfirmed));
  assert(after.P2.every(p=>p.x===null));
  assert.equal(applied.session.initialIdentityReview.identityVerified,false);
  assert.deepEqual(applied.session.initialIdentityReview.exclusions.map(x=>[x.trackId,x.start,x.end,x.role]),[[2,0,11,'referee']]);
  for(const [index,entity] of applied.session.entities.entries()){
    for(const field of ['anchors','courtAnchors','bindings','identityKeyframes','frameConfirmations','visibilityRanges','name','team','jersey'])
      assert.deepEqual(entity[field],original.entities[index][field],`${entity.id}.${field}`);
  }
  assert.deepEqual(applyInitialIdentityReview(applied.session,result,clip).session,applied.session,'adoption is idempotent');
});

test('excluded referee stays excluded through automatic initializer refresh and candidate lists',()=>{
  const {clip,session,result}=fixture();
  clip.identitySuggestions={version:1,verified:false,method:'fixture',entities:[{id:'P2',bindings:[{trackId:2,start:0,end:11}]}]};
  const applied=applyInitialIdentityReview(session,result,clip);initializeAutomaticAnnotations(applied.session,clip);
  assert(!applied.session.entities.some(e=>(e.modelBindings??[]).some(b=>b.trackId===2)));
  const points=buildTrajectories(applied.session,clip.frames,clip.sourceCuts,clip);
  const candidates=automaticPlayerCandidates(clip,4,points,applied.session);
  assert(!candidates.some(p=>p.trackId===2));
});

test('human range ownership, foot coordinates and a reviewed model binding remain byte-for-byte unchanged',()=>{
  const {clip,session,result}=fixture();
  session.entities[0].anchors=[{frame:4,x:63.125,y:198.75,trackId:1,identityConfirmed:false}];
  session.entities[1].bindings=[{kind:'track',trackId:2,start:2,end:7,origin:'human_range_replacement',order:2}];
  confirmFrameIdentity(session,'P1',5,clip.frames);basis(session,result);
  const before=structuredClone(session),points=buildTrajectories(session,clip.frames,clip.sourceCuts,clip);
  const {session:after,report}=applyInitialIdentityReview(session,result,clip);
  assert.deepEqual(after.entities[0],before.entities[0],'model binding with reviewed token is not split');
  assert.deepEqual(after.entities[1].bindings,before.entities[1].bindings);
  assert.deepEqual(buildTrajectories(after,clip.frames,clip.sourceCuts,clip).P1,points.P1);
  assert(report.preservedHuman>0);assert(report.issues.some(i=>i.kind==='manual_conflict'));
  assert(after.initialIdentityReview.exclusions.every(r=>r.end<2||r.start>7));
});

test('source-only cached candidate cannot relabel an edited target P slot or steal a changed owner',()=>{
  for(const edit of ['target','other-owner']){
    const {clip,session,result}=fixture();
    if(edit==='target')session.entities[0].modelBindings=[{kind:'track',trackId:3,start:0,end:11}];
    else session.entities[2].modelBindings=[{kind:'track',trackId:1,start:0,end:11}];
    const before=structuredClone(session),applied=applyInitialIdentityReview(session,{...result,jobId:'rebased-cache',generationJobId:'job-a'},clip);
    assert.deepEqual(applied.session.entities[0],before.entities[0]);
    assert.deepEqual(applied.session.entities[2],before.entities[2]);
    assert(applied.report.issues.some(i=>i.kind==='slot_basis_changed'),edit);
  }
});

test('human dismissal and explicit unassigned state prevent automatic resurrection',()=>{
  for(const kind of ['dismissed','unassigned','disabled']){
    const {clip,session,result}=fixture(),p=session.entities[0];
    if(kind==='dismissed')p.dismissedModelBindings=[{kind:'track',trackId:1,start:0,end:11}];
    if(kind==='unassigned')p.bindings=[{kind:'unassigned',trackId:null,start:0,end:11,origin:'human_release',order:1}];
    if(kind==='disabled')p.identitySuggestionsDismissed=true;
    basis(session,result);const before=structuredClone(p),applied=applyInitialIdentityReview(session,result,clip);
    assert.deepEqual(applied.session.entities[0],before,kind);
    assert(applied.report.issues.some(i=>['manual_conflict','manual_exclusion'].includes(i.kind)));
  }
});

test('unknown role, low confidence and unresolved subjects leave old machine suggestions intact and report uncertainty',()=>{
  for(const kind of ['role','confidence','entity']){
    const {clip,session,result}=fixture();result.candidate.segments=result.candidate.segments.slice(0,1);
    if(kind==='role'){result.candidate.subjects[0].role='uncertain';result.candidate.segments[0].role='uncertain';}
    if(kind==='confidence')result.candidate.segments[0].confidence=.4;
    if(kind==='entity'){result.candidate.subjects[0].entityId=null;result.candidate.segments[0].entityId=null;}
    const applied=applyInitialIdentityReview(session,result,clip);
    assert.deepEqual(applied.session.entities,session.entities);assert.equal(applied.report.changedModelBindings,0);
    assert(applied.report.issues.some(i=>i.kind==='identity_uncertain'));
  }
});

test('missing or risk observations stay empty and no new binding crosses a source cut',()=>{
  const {clip,session,result}=fixture();clip.sourceCuts=[6];
  clip.frames[3].tracks=clip.frames[3].tracks.filter(row=>row[4]!==1);
  clip.frames[8].track_evidence={1:{identity_review_required:true,role_evidence:{role:'referee'}}};
  const applied=applyInitialIdentityReview(session,result,clip);
  // Existing source records can remain, but every newly authored suggestion is bounded.
  const added=applied.session.entities[0].modelBindings.filter(b=>b.origin==='agent_initial_review');
  assert.deepEqual(added.map(b=>[b.start,b.end]),[[0,2],[4,5],[6,7],[9,11]]);
  assert(!added.some(b=>b.start<=3&&3<=b.end||b.start<=8&&8<=b.end||b.start<6&&6<=b.end));
  assert(applied.report.issues.some(i=>i.kind==='observation_gap'));
});

test('conflicting subject or same-P simultaneous boxes are never selected silently',()=>{
  for(const kind of ['subject','same-slot']){
    const {clip,session,result}=fixture();
    result.candidate.subjects.push({...result.candidate.subjects[0],subjectId:'another',entityId:kind==='subject'?'P3':'P1'});
    result.candidate.segments.push({...result.candidate.segments[0],id:'another',subjectId:'another',entityId:kind==='subject'?'P3':'P1',trackId:kind==='subject'?1:3});
    const applied=applyInitialIdentityReview(session,result,clip);
    assert.deepEqual(applied.session.entities[0],session.entities[0]);
    assert(applied.report.issues.some(i=>i.kind==='identity_conflict'));
  }
});

test('source or evidence mismatch fails atomically before changing any draft fields',()=>{
  for(const mutate of [r=>r.base.videoHash='other',r=>r.base.trackingFingerprint='other',r=>r.base.trackingRevision='other',
    r=>r.candidate.segments[0].evidenceFrames=[0],r=>r.candidate.segments[0].trackId=99,r=>r.candidate.identityVerified=true]){
    const {clip,session,result}=fixture(),before=structuredClone(session);mutate(result);
    assert.throws(()=>applyInitialIdentityReview(session,result,clip));assert.deepEqual(session,before);
  }
});

test('note-only cache rebase can retain valid P mapping while preserving the current note',()=>{
  const {clip,session,result}=fixture();session.note='new reviewer note';
  const applied=applyInitialIdentityReview(session,{...result,jobId:'rebased',generationJobId:'job-a'},clip);
  assert.equal(applied.session.note,session.note);assert.equal(applied.report.changedModelBindings,2);
  assert.equal(identityAt(applied.session.entities[0],5,[],clip.frames[5]).identitySource,'model_suggestion');
});
