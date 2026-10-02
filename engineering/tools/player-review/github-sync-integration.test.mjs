import test from 'node:test';
import assert from 'node:assert/strict';
import * as trajectory from './trajectory.mjs';
import {confirmIdentity} from './identity-timeline.mjs';
import {editImageAnchor} from './image-edit.mjs';
import {setTeamGroup,stabilizePoints} from './team-overlay.mjs';
import {personProposals,personTrail,temporaryTrail,indexTemporaryTracks} from './tracking-display.mjs';
import {readFileSync} from 'node:fs';

const policy=JSON.parse(readFileSync(new URL('./team-overlay-policy.json',import.meta.url)));
const frames=Array.from({length:9},(_,frame)=>({frame,time:frame/30,
  tracks:[1,2,22].map((id,i)=>[frame+i*100,5,frame+i*100+20,frame===3?110:50,id,.8,2])}));
const trailFrames=frames.map(record=>({...record,tracks:record.tracks.map(box=>[...box.slice(0,3),50,...box.slice(4)])}));
const proposal=(id,frame)=>({trackId:id,box:frames[frame].tracks.find(box=>box[4]===id).slice(0,4)});

test('a source join protects raw trajectories and stable display even when an old draft lacks cuts',()=>{
  const session=trajectory.blankSession('joined');session.maxGapSeconds=1;
  confirmIdentity(session,'P1',0,proposal(1,0),frames);
  session.entities[1].modelBindings=[{start:0,end:8,kind:'track',trackId:2}];
  session.entities[2].anchors=[{frame:0,x:300,y:50,trackId:null},{frame:8,x:308,y:50,trackId:null}];
  const before=structuredClone(session);
  const points=trajectory.buildTrajectories(session,frames,[4]);
  assert.deepEqual(points.P1.slice(4).map(p=>p.source),Array(5).fill('missing'));
  assert.deepEqual(points.P2.slice(4).map(p=>p.source),Array(5).fill('missing'));
  assert.equal(points.P3[4].source,'missing','interpolation cannot span a source join');
  const display=stabilizePoints(points.P1,[4],1280,720,policy);
  assert.deepEqual(display[3],points.P1[3],'filter support cannot come from the next source segment');
  assert.deepEqual(session,before,'a read-only trajectory build does not rewrite an old draft');
});

test('scene object export coexists with exact manual coordinates and independent human identity/team evidence',()=>{
  const session=trajectory.blankSession('joined');
  session.entities[0].modelBindings=[{start:0,end:8,kind:'track',trackId:1}];
  confirmIdentity(session,'P2',0,proposal(2,0),frames);setTeamGroup(session,'P2','A');
  Object.assign(session.entities[1],{name:'人工姓名',team:'人工球队',jersey:'7'});
  const point=trajectory.buildTrajectories(session,frames).P2[1];
  session.entities[1].anchors.push(editImageAnchor(point,1,{x:112.25,y:40.75},1280,720));
  const records=structuredClone(frames);
  records[1].objects=[{kind:'basketball',box:[3,4,8,9],score:.72},
    {kind:'hoop',box:[10,20,40,30],score:.88},{kind:'unknown',box:[0,0,1,1]}];
  records[1].track_roles={2:'referee'};records[1].role_conflicts=[{trackIds:[1,2]}];
  const clip={video_sha256:'joined',source_video_sha256:'root-source',frames:records,
    width:1280,height:720,sourceCuts:[4],tracking_revision:'ebard',tracking_fingerprint:'ebard-raw-sha'};
  const before=structuredClone({session,clip});
  const output=trajectory.exportReview(session,clip,'review-time');
  assert.equal(output.selectionConfirmed,false);
  assert.deepEqual(output.settings.sourceCuts,[4]);assert.deepEqual(output.settings.cuts,[4]);
  assert.equal(output.trackingRevision,'ebard');assert.equal(output.trackingFingerprint,'ebard-raw-sha');
  assert.equal(output.sceneObjects.continuousTracking,false);assert.equal(output.sceneObjects.groundProjection,false);
  assert.deepEqual(output.sceneObjects.frames[1].objects.map(o=>[o.kind,o.groundPoint]),[['basketball',false],['hoop',false]]);
  assert.equal(personProposals(records[1]).length,3,'objects never consume player identity slots');
  const [proposed,human]=output.entities;
  assert.equal(proposed.identityConfirmed,false);assert.equal(human.identityConfirmed,true);
  assert.equal(human.teamGroup,'A');assert.equal(human.teamGroupSource,'human');assert.equal(human.jersey,'7');
  assert.deepEqual([human.trajectory[1].x,human.trajectory[1].y],[112.25,40.75]);
  assert.deepEqual({session,clip},before,'export does not mutate candidates or the saved human draft');
});

test('fixed player tails stop at repeated identity confirmations and isolate precise manual position edits',()=>{
  assert.equal(typeof trajectory.reviewTrailCuts,'function');
  const session=trajectory.blankSession('clip'),entity=session.entities[0];
  entity.identityKeyframes=[{frame:0,kind:'track',trackId:1,order:1},{frame:3,kind:'track',trackId:1,order:2}];
  entity.anchors=[{frame:5,x:15.25,y:40.75,trackId:1,identityConfirmed:false,footMethod:'human_image_anchor'}];
  const points=trajectory.buildTrajectories(session,trailFrames).P1;
  const cuts=trajectory.reviewTrailCuts([entity],[8],frames.length);
  assert.deepEqual(personTrail(points,trailFrames,4,cuts).map(p=>p.frame),[3,4]);
  assert.deepEqual(personTrail(points,trailFrames,5,cuts).map(p=>p.frame),[5]);
  assert.deepEqual(personTrail(points,trailFrames,7,cuts).map(p=>p.frame),[6,7]);
  assert.deepEqual(personTrail(points,trailFrames,8,cuts).map(p=>p.frame),[8]);
  assert.deepEqual([points[5].x,points[5].y],[15.25,40.75]);
});

test('temporary tails respect relevant identity/manual boundaries without truncating unrelated people',()=>{
  assert.equal(typeof trajectory.reviewTrailCuts,'function');
  const session=trajectory.blankSession('clip'),[first,second]=session.entities;
  first.identityKeyframes=[{frame:0,kind:'track',trackId:1},{frame:3,kind:'track',trackId:22}];
  first.anchors=[{frame:5,x:20,y:50,trackId:22,identityConfirmed:false}];
  second.identityKeyframes=[{frame:4,kind:'track',trackId:2}];
  second.anchors=[{frame:4,x:120,y:50,trackId:2}];
  const index=indexTemporaryTracks(trailFrames),before=structuredClone(session);
  const cuts=trajectory.reviewTrailCuts(session.entities,[],frames.length,1);
  assert.deepEqual(cuts,[0,3,5,6]);
  assert.deepEqual(temporaryTrail(index,trailFrames,1,4,cuts).map(p=>p.frame),[3,4]);
  assert.deepEqual(temporaryTrail(index,trailFrames,1,7,cuts).map(p=>p.frame),[6,7]);
  assert.deepEqual(trajectory.reviewTrailCuts(session.entities,[8],frames.length,999),[8]);
  assert.deepEqual(session,before);
});

test('current model summaries parse both remote ByteTrack and local BoT-SORT metadata contracts',()=>{
  const remote=trajectory.trackingModelSummary({model:'BODD_yolov8n_0001.pt',tracker:'ByteTrack',
    detection_parameters:{conf:.07,iou:.5,device:0},tracker_parameters:{track_buffer:30}},'E-BARD');
  assert.equal(remote.tracker,'ByteTrack');assert.equal(remote.device,'0');
  assert.deepEqual(remote.details,['检测阈值 0.07','NMS 0.5','断轨保留 30 帧']);
  const local=trajectory.trackingModelSummary({model:'BODD_yolov8n_0001.pt',tracker:'BoT-SORT',
    config:{with_reid:true,gmc_method:'sparseOptFlow'},device:{name:'GPU',actual_model_parameter_device:'cuda:0'}},'team-stable');
  assert.equal(local.tracker,'BoT-SORT');assert.match(local.device,/cuda:0/);assert.match(local.details.join(' · '),/ReID 开启/);
});
