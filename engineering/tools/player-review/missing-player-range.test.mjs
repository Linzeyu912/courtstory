import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession,buildTrajectories} from './trajectory.mjs';
import {suggestMissingPlayerRange,previewMissingPlayerRange} from './missing-player-range.mjs';
import {automaticAnnotationPointVisible} from './automatic-annotations.mjs';

function fixture(){
  const clip={width:100,height:100,sourceCuts:[],frames:Array.from({length:41},(_,frame)=>({frame,time:frame/10,tracks:[]}))};
  return {clip,session:blankSession('video')};
}
const input={entityId:'P1',keyframes:[{frame:2,x:10,y:20},{frame:8,x:70,y:80}]};
test('missing range suggests a short continuous interval, clipped at known cut and identity boundaries',()=>{
  const {session,clip}=fixture();
  assert.equal(suggestMissingPlayerRange(session,{entityId:'P1',frame:2},clip).end,22);
  clip.sourceCuts=[7];assert.equal(suggestMissingPlayerRange(session,{entityId:'P1',frame:2},clip).end,6);
  clip.sourceCuts=[];session.entities[0].bindings=[{kind:'untracked',start:5,end:10,order:1}];
  assert.equal(suggestMissingPlayerRange(session,{entityId:'P1',frame:2},clip).end,4);
});
test('two endpoint clicks create an immutable preview with time interpolation, no boxes, no track or confirmed identities',()=>{
  const {session,clip}=fixture(),before=structuredClone(session);
  const result=previewMissingPlayerRange(session,input,clip),points=buildTrajectories(result.session,clip.frames).P1;
  assert.deepEqual(session,before);assert.equal(result.preview.changed,7);
  assert(Math.abs(points[5].x-40)<1e-8);assert(Math.abs(points[5].y-50)<1e-8);
  assert(points.slice(2,9).every(p=>p.box===null&&p.trackId===null&&!p.identityConfirmed));
  assert.equal(points[2].source,'manual');assert.equal(points[8].source,'manual');
  assert(points.slice(3,8).every(p=>p.source==='manual_path'));
  assert.equal(points[1].x,null);assert.equal(points[9].x,null);
  assert.deepEqual(result.session.entities.slice(1),session.entities.slice(1));
  assert.deepEqual(buildTrajectories(JSON.parse(JSON.stringify(result.session)),clip.frames).P1,points);
});
test('an extra keyframe controls timing and stationary endpoints are allowed',()=>{
  const {session,clip}=fixture();
  const result=previewMissingPlayerRange(session,{entityId:'P1',keyframes:[{frame:2,x:10,y:20},{frame:5,x:10,y:20},{frame:8,x:70,y:80}]},clip);
  const points=buildTrajectories(result.session,clip.frames).P1;
  assert.equal(points[3].x,10);assert(Math.abs(points[6].x-30)<1e-8);assert.equal(result.preview.estimated,4);
});
test('manual segment over a missing machine track stays visible as estimated without inheriting the T',()=>{
  const {session,clip}=fixture();
  session.entities[0].modelBindings=[{kind:'track',trackId:7,start:0,end:40,identityConfirmed:false,reviewRequired:true}];
  const result=previewMissingPlayerRange(session,input,clip),point=buildTrajectories(result.session,clip.frames).P1[5];
  assert.equal(point.source,'manual_path');assert.equal(point.trackId,null);assert.equal(point.frameIdentityConfirmed,false);
  assert.equal(automaticAnnotationPointVisible(clip,5,point,result.session),true);
});
test('known cuts, visibility, existing evidence and identity conflicts stop suggestion and reject crossing previews',()=>{
  for(const barrier of ['cut','occluded','out_of_view','excluded','existing','identity']){
    const {session,clip}=fixture(),entity=session.entities[0];
    if(barrier==='cut')session.cuts=[5];
    if(['occluded','out_of_view'].includes(barrier))entity.visibilityRanges=[{start:5,end:6,state:barrier}];
    if(barrier==='excluded')entity.bindings=[{kind:'unassigned',trackId:null,start:5,end:6,order:1}];
    if(barrier==='existing')entity.anchors=[{frame:5,x:40,y:50}];
    if(barrier==='identity')entity.identityKeyframes=[{frame:5,kind:'track',trackId:7}];
    assert.equal(suggestMissingPlayerRange(session,{entityId:'P1',frame:2},clip).end,4,barrier);
    assert.throws(()=>previewMissingPlayerRange(session,input,clip),undefined,barrier);
  }
});
test('malformed, reversed or one-point ranges never create an estimated segment',()=>{
  const {session,clip}=fixture();
  for(const keyframes of [[{frame:2,x:10,y:20}],input.keyframes.toReversed(),[{frame:2,x:-1,y:20},input.keyframes[1]],[input.keyframes[0],{frame:50,x:10,y:20}]])
    assert.throws(()=>previewMissingPlayerRange(session,{entityId:'P1',keyframes},clip));
});
test('explicit single-frame fallback only adds the clicked missing position and retains surrounding evidence',()=>{
  const {session,clip}=fixture(),entity=session.entities[0];
  entity.anchors=[{frame:1,x:8,y:10},{frame:3,x:12,y:14}];
  const before=structuredClone(session),keyframes=[{frame:2,x:10,y:12}];
  assert.equal(suggestMissingPlayerRange(session,{entityId:'P1',frame:2},clip).end,2);
  const result=previewMissingPlayerRange(session,{entityId:'P1',keyframes,allowSingleFrame:true},clip);
  assert.deepEqual(session,before);assert.equal(result.preview.changed,1);assert.equal(result.preview.estimated,0);
  const points=buildTrajectories(result.session,clip.frames).P1;
  assert.equal(points[2].x,10);assert.equal(points[2].box,null);assert.equal(points[2].trackId,null);assert.equal(points[2].identityConfirmed,false);
  assert.deepEqual(result.session.entities[0].anchors.slice(0,2),before.entities[0].anchors);
  entity.visibilityRanges=[{start:2,end:2,state:'occluded'}];
  assert.throws(()=>previewMissingPlayerRange(session,{entityId:'P1',keyframes,allowSingleFrame:true},clip),/遮挡/);
});
test('single and multi-frame repairs replace ineffective old track anchors while preserving their evidence',()=>{
  for(const single of [true,false]){
    const {session,clip}=fixture(),entity=session.entities[0];
    entity.identityKeyframes=[{frame:0,kind:'track',trackId:8}];
    entity.anchors=[{frame:2,x:30,y:40,trackId:7,identityConfirmed:false,box:[20,10,40,40],source:'manual'},
      {frame:5,x:31,y:41,trackId:7,identityConfirmed:false}];
    const before=structuredClone(session),keyframes=single?[{frame:2,x:50,y:60}]:input.keyframes;
    assert.equal(buildTrajectories(session,clip.frames).P1[2].source,'missing');
    const result=previewMissingPlayerRange(session,{entityId:'P1',keyframes,allowSingleFrame:single},clip);
    const reloaded=JSON.parse(JSON.stringify(result.session)),points=buildTrajectories(reloaded,clip.frames).P1;
    assert.deepEqual(session,before);
    assert.equal(points[2].x,keyframes[0].x);assert.equal(points[2].y,keyframes[0].y);
    assert.equal(points[2].trackId,null);assert.equal(points[2].box,null);
    assert.deepEqual(reloaded.entities[0].anchors.find(anchor=>anchor.frame===2).supersededAnchors,[before.entities[0].anchors[0]]);
    if(single)assert.deepEqual(reloaded.entities[0].anchors.find(anchor=>anchor.frame===5),before.entities[0].anchors[1]);
    else{
      assert(Math.abs(points[5].x-40)<1e-8);assert.equal(points[5].source,'manual_path');
      assert.deepEqual(reloaded.entities[0].anchors.find(anchor=>anchor.frame===5).supersededAnchors,[before.entities[0].anchors[1]]);
    }
  }
});
test('a stale first anchor cannot hide protected manual evidence from missing-range validation',()=>{
  for(const protectedAnchor of [{frame:2,x:50,y:60,trackId:7,identityConfirmed:true},{frame:2,x:50,y:60,trackId:null,identityConfirmed:false},{frame:2,x:50,y:60,trackId:7}]){
    const {session,clip}=fixture(),entity=session.entities[0];
    entity.identityKeyframes=[{frame:0,kind:'track',trackId:8}];
    entity.anchors=[{frame:2,x:30,y:40,trackId:7,identityConfirmed:false},protectedAnchor];
    const before=structuredClone(session);
    assert.throws(()=>previewMissingPlayerRange(session,{entityId:'P1',keyframes:[{frame:2,x:10,y:20}],allowSingleFrame:true},clip),/已有位置记录/);
    assert.deepEqual(session,before);
  }
});
