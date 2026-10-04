import test from 'node:test';
import assert from 'node:assert/strict';
import * as trajectory from './trajectory.mjs';
import * as imageEdit from './image-edit.mjs';
import {confirmIdentity,identityAt,identityReviewToken,identityInterval} from './identity-timeline.mjs';
import {buildCourtTrajectories} from './court.mjs';
import {automaticAnnotationPointVisible} from './automatic-annotations.mjs';
import {trackingReviewState} from './tracking-display.mjs';

const clip=()=>({video_sha256:'range-fixture',width:640,height:360,sourceCuts:[],frames:Array.from({length:20},(_,frame)=>({frame,time:frame*.1,tracks:[1,2,3].map(id=>[id*110+frame,50,id*110+40+frame,200+frame,id,.9,0])}))});
function fixture(){const c=clip(),s=trajectory.blankSession(c.video_sha256);const select=(id,f,t)=>confirmIdentity(s,id,f,{trackId:t,box:c.frames[f].tracks.find(b=>b[4]===t).slice(0,4)},c.frames);select('P1',0,1);select('P1',8,3);select('P2',0,2);select('P2',9,2);trajectory.confirmFrameIdentity(s,'P1',15,c.frames);trajectory.confirmFrameIdentity(s,'P2',16,c.frames);return {c,s,select};}
test('explicit range replaces every internal identity boundary and restores exact outside points and reviews',()=>{
  assert.equal(typeof trajectory.replaceIdentityRange,'function');const {c,s}=fixture(),original=structuredClone(s),before=trajectory.buildTrajectories(s,c.frames);
  const result=trajectory.replaceIdentityRange(s,{entityId:'P1',trackId:2,start:5,end:12},c.frames),after=trajectory.buildTrajectories(result.session,c.frames);
  assert.deepEqual(s,original,'preview must not mutate');assert(after.P1.slice(5,13).every(p=>p.trackId===2&&!p.frameIdentityConfirmed));
  for(const id of ['P1','P2'])for(const f of [...Array(5).keys(),13,14,15,16,17,18,19])assert.deepEqual(after[id][f],before[id][f],`${id} outside ${f}`);
  assert(after.P2.slice(5,13).every(p=>p.claimedBy==='P1'));assert.equal(result.preview.changed,8);assert.equal(result.preview.affectedPlayers.P2,8);
  assert.deepEqual(identityInterval(result.session,result.session.entities[0],6,c.frames.length),{start:6,end:12});
  assert.equal(identityReviewToken(identityAt(result.session.entities[0],15,[],c.frames[15])),identityReviewToken(identityAt(s.entities[0],15,[],c.frames[15])));
});
test('range identity leaves missing observations empty, splits cuts, permits a later single-frame correction and rejects invalid inputs atomically',()=>{
  assert.equal(typeof trajectory.replaceIdentityRange,'function');const {c,s}=fixture();c.frames[7].tracks=c.frames[7].tracks.filter(b=>b[4]!==2);s.cuts=[10];
  const r=trajectory.replaceIdentityRange(s,{entityId:'P1',trackId:2,start:5,end:12},c.frames),p=trajectory.buildTrajectories(r.session,c.frames).P1;
  assert.equal(p[7].x,null);assert.equal(r.preview.missing,1);assert.equal(p[10].trackId,2);assert.equal(r.preview.segments,2);
  trajectory.correctFrameIdentity(r.session,'P1',8,{trackId:1},c.frames);const corrected=trajectory.buildTrajectories(r.session,c.frames).P1;assert.equal(corrected[8].trackId,1);assert.equal(corrected[9].trackId,2);
  assert.throws(()=>trajectory.replaceIdentityRange(s,{entityId:'P1',trackId:99,start:0,end:10},c.frames));assert.throws(()=>trajectory.replaceIdentityRange(s,{entityId:'P1',trackId:1,start:11,end:3},c.frames));
});
test('relative box corrections preserve motion, interpolate two adjustments, expose provenance and remain reviewable one frame at a time',()=>{
  assert.equal(typeof imageEdit.correctImageRange,'function');const {c,s}=fixture(),before=trajectory.buildTrajectories(s,c.frames),original=structuredClone(s);
  const input={entityId:'P1',start:1,end:6,mode:'box',keyframes:[{frame:1,dx:10,dy:0,scaleX:1,scaleY:1},{frame:6,dx:20,dy:5,scaleX:1,scaleY:1}],preserveManual:true,operationId:'range-test'};
  const r=imageEdit.correctImageRange(s,input,c),after=trajectory.buildTrajectories(r.session,c.frames);assert.deepEqual(s,original);
  assert.equal(r.preview.changed,6);assert.equal(after.P1[3].x,before.P1[3].x+14);assert.equal(after.P1[6].y,before.P1[6].y+5);
  assert.equal(after.P1[3].source,'manual_range');assert.equal(after.P1[3].rangeCorrection.keyframe,false);assert.equal(after.P1[1].rangeCorrection.keyframe,true);
  assert.deepEqual(after.P1[3].detectorBox,before.P1[3].box);assert(after.P1.slice(1,7).every(p=>!p.frameIdentityConfirmed));
  assert.deepEqual(after.P1[7],before.P1[7]);trajectory.confirmFrameIdentity(r.session,'P1',3,c.frames);assert.equal(trajectory.buildTrajectories(r.session,c.frames).P1[3].frameIdentityConfirmed,true);
  const out=trajectory.exportReview(r.session,c,null);assert.equal(out.entities[0].trajectory[3].source,'manual_range');assert.equal(out.allFramesManuallyVerified,false);
});
test('range geometry skips missing, conflicts and later shots, protects human points unless explicitly replaced',()=>{
  assert.equal(typeof imageEdit.correctImageRange,'function');const {c,s}=fixture();s.cuts=[6];c.frames[3].tracks=c.frames[3].tracks.filter(b=>b[4]!==1);
  const point=trajectory.buildTrajectories(s,c.frames).P1[4];s.entities[0].anchors.push(imageEdit.editImageAnchor(point,4,{x:point.x+7},640,360));
  const input={entityId:'P1',start:1,end:7,mode:'foot',keyframes:[{frame:1,dx:5,dy:2}],preserveManual:true};
  const r=imageEdit.correctImageRange(s,input,c);assert.equal(r.preview.changed,3);assert.equal(r.preview.missing,1);assert.equal(r.preview.preservedManual,1);assert.equal(r.preview.shotSkipped,2);
  assert.deepEqual(r.session.entities[0].anchors.find(a=>a.frame===4),s.entities[0].anchors.find(a=>a.frame===4));
  const replaced=imageEdit.correctImageRange(s,{...input,preserveManual:false},c);assert.equal(replaced.preview.changed,4);
});
test('an empty tactical snapshot is permitted only through the explicit export option',()=>{
  const c=clip(),s=trajectory.blankSession(c.video_sha256);assert.throws(()=>trajectory.exportReview(s,c,null));
  const result=trajectory.exportReview(s,c,null,{allowEmpty:true});assert.deepEqual(result.entities,[]);assert.equal(result.selectionConfirmed,false);
});

test('overlapping replacements preserve the first range outside the new range, then permit forward correction',()=>{
  const {s,c}=fixture(),one=trajectory.replaceIdentityRange(s,{entityId:'P1',trackId:2,start:3,end:14},c.frames).session;
  const two=trajectory.replaceIdentityRange(one,{entityId:'P1',trackId:1,start:6,end:10},c.frames).session,before=trajectory.buildTrajectories(one,c.frames),after=trajectory.buildTrajectories(two,c.frames);
  for(const f of [0,1,2,3,4,5,11,12,13,14,15,16,17,18,19])for(const id of ['P1','P2'])assert.deepEqual(after[id][f],before[id][f]);
  assert(after.P1.slice(6,11).every(p=>p.trackId===1));
  confirmIdentity(two,'P1',7,{trackId:3,box:c.frames[7].tracks[2].slice(0,4)},c.frames);
  assert.equal(trajectory.buildTrajectories(two,c.frames).P1[7].trackId,3);
});

test('repeated geometry corrections retain original source, are visible pending review, and preserve court provenance',()=>{
  const {s,c}=fixture(),input={entityId:'P1',start:1,end:6,mode:'foot',keyframes:[{frame:1,dx:4,dy:2}],preserveManual:false};
  const one=imageEdit.correctImageRange(s,input,c).session,two=imageEdit.correctImageRange(one,input,c).session,p=trajectory.buildTrajectories(two,c.frames);
  assert.equal(p.P1[3].rangeCorrection.originalSource,'tracked');assert.equal(p.P1[3].rangeCorrection.originalTrackId,1);
  assert.equal(automaticAnnotationPointVisible(c,3,p.P1[3]),true);assert.equal(trackingReviewState(p.P1[3]).status,'pending');
  assert.deepEqual(buildCourtTrajectories(two,c.frames,p).P1[3].rangeCorrection,p.P1[3].rangeCorrection);
  trajectory.confirmFrameIdentity(two,'P1',3,c.frames);assert.equal(trackingReviewState(trajectory.buildTrajectories(two,c.frames).P1[3]).status,'human');
  assert.equal(trajectory.buildTrajectories(two,c.frames).P1[4].frameIdentityConfirmed,false);
});

test('relative correction can use a human-only point but never copies through a new identity',()=>{
  const {s,c}=fixture();s.entities[0].anchors.push({frame:2,x:150,y:190,trackId:null,source:'manual',identityConfirmed:false});
  const input={entityId:'P1',start:2,end:2,mode:'foot',keyframes:[{frame:2,dx:4,dy:2}],preserveManual:false};
  const one=imageEdit.correctImageRange(s,input,c).session,two=imageEdit.correctImageRange(one,input,c).session;
  assert.equal(trajectory.buildTrajectories(two,c.frames).P1[2].rangeCorrection.originalSource,'manual');
  const r=imageEdit.correctImageRange(s,{entityId:'P1',start:1,end:10,mode:'box',keyframes:[{frame:1,dx:2,dy:1}],preserveManual:true},c);
  assert.equal(r.preview.identitySkipped,3);assert.deepEqual(trajectory.buildTrajectories(r.session,c.frames).P1[8],trajectory.buildTrajectories(s,c.frames).P1[8]);
});

test('a conflicted observation remains conflicted during range geometry preview',()=>{
  const c=clip(),s=trajectory.blankSession(c.video_sha256);
  s.entities[0].bindings=[{kind:'track',trackId:1,start:0,end:19,scope:'track_occurrences',order:1}];
  s.entities[1].bindings=[{kind:'track',trackId:1,start:3,end:3,scope:'track_occurrences',order:2}];
  const before=trajectory.buildTrajectories(s,c.frames),r=imageEdit.correctImageRange(s,{entityId:'P1',start:1,end:5,mode:'box',keyframes:[{frame:1,dx:5,dy:2}]},c);
  assert.equal(r.preview.conflict,1);assert.equal(r.preview.changed,4);
  assert.deepEqual(trajectory.buildTrajectories(r.session,c.frames).P1[3],before.P1[3]);
});
