import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createSourceBinding} from '../tactical-overlay/binding.mjs';
import {createTacticsDocument,validateDocument,splitPhase,removePhase} from './tactics-document.mjs';
import {buildPhaseRoutes} from './tactics-presentation.mjs';

const api=await import('./tactics-annotations.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const requireAPI=()=>assert.equal(typeof api.createAnnotation,'function','the manual tactical annotation module is required');
const fixture=async()=>({schemaVersion:1,title:'Annotations',notes:'',...await makePresentationDemo()});
const route={id:'route-a',phaseId:'setup',type:'route',entityId:'P1',frame:12,space:'court',points:[{x:18,y:10},{x:20,y:9},{x:22,y:9}]};

test('authored route, screen and spotlight persist independently of tracks and legacy presentation',async()=>{
  requireAPI();const original=await fixture();original.presentation={schemaVersion:1,routes:[]};const before=structuredClone(original);
  let doc=api.createAnnotation(original,route);
  doc=api.createAnnotation(doc,{...route,id:'screen-a',type:'screen',points:[{x:21,y:7}],style:{angle:45,size:1.2}});
  doc=api.createAnnotation(doc,{...route,id:'spot-a',type:'spotlight',points:[{x:18,y:10}]});
  await validateDocument(doc);assert.equal(doc.annotations.schemaVersion,1);assert.equal(doc.annotations.items.length,3);
  assert.equal(doc.annotations.items[0].endFrameExclusive,30);assert.equal(doc.annotations.items[2].followEntity,true);
  assert.deepEqual(original,before);assert.deepEqual(doc.review,before.review);assert.deepEqual(doc.presentation,before.presentation);
  const changed=api.updateAnnotation(doc,'route-a',{points:[{x:17,y:10},{x:21,y:8}]});
  const roundTrip=JSON.parse(JSON.stringify(changed));await validateDocument(roundTrip);
  assert.equal(roundTrip.annotations.items[0].points.length,2);assert.equal(doc.annotations.items[0].points.length,3);
  assert.equal(api.removeAnnotation(roundTrip,'screen-a').annotations.items.length,2);
});

test('invalid annotation imports and edits reject coordinates, ranges, size, unknown payload and foreign players',async()=>{
  requireAPI();const doc=await fixture();
  for(const input of [{...route,points:[{x:Infinity,y:1},{x:2,y:3}]},{...route,points:[{x:-1,y:1},{x:2,y:3}]},
    {...route,frame:30},{...route,endFrameExclusive:31},{...route,style:{size:99}},{...route,entityId:'not-a-player'},
    {...route,points:Array.from({length:7},()=>({x:1,y:1}))},{...route,space:'video',points:[{x:1281,y:3},{x:100,y:10}]}]){
    assert.throws(()=>api.createAnnotation(doc,input));
  }
  const good=api.createAnnotation(doc,route);
  for(const annotations of [null,{schemaVersion:2,items:[]},{...good.annotations,payload:'unknown'},
    {...good.annotations,items:[good.annotations.items[0],good.annotations.items[0]]}]){
    await assert.rejects(validateDocument({...doc,annotations}),/画布标注/);
  }
  const bad=structuredClone(good);bad.annotations.items[0].points[0].x=NaN;
  await assert.rejects(validateDocument(bad),/画布标注/);
  assert.throws(()=>api.updateAnnotation(good,'route-a',{space:'video'}),/空间/);
});

test('phase changes keep old annotations recoverable without silently drawing on a new phase',async()=>{
  requireAPI();const doc=api.createAnnotation(await fixture(),route);
  const split=splitPhase(doc,'setup',20);await validateDocument(split);
  const scene=api.projectAnnotations(split,{phaseId:'setup',frame:12});
  assert.equal(scene.items.length,0);assert.equal(scene.stale[0].reason,'phase_changed');
  const restored=api.updateAnnotation(split,'route-a',{phaseId:'setup',frame:12,endFrameExclusive:20});
  assert.equal(api.projectAnnotations(restored,{phaseId:'setup',frame:12}).items.length,1);
  const removed=removePhase(doc,'setup');await validateDocument(removed);
  assert.equal(api.projectAnnotations(removed,{phaseId:'finish',frame:42}).stale[0].reason,'phase_missing');
  assert.equal(removed.annotations.items.length,1);
});

test('smooth authored arrows remain continuous across raw gaps and shrink by elapsed media time',async()=>{
  requireAPI();const base=await fixture();base.review.entities[0].trajectory[18]={frame:18,time:1.8,x:null,y:null,source:'out_of_view'};
  base.playDefinition.sourceBinding=await createSourceBinding(base.review);
  const doc=api.createAnnotation(base,route),model=await buildPhaseRoutes(doc,'setup');
  const first=api.projectAnnotations(doc,{phaseId:'setup',frame:12,model}).items[0];
  const later=api.projectAnnotations(doc,{phaseId:'setup',frame:20,model}).items[0];
  assert.ok(first.video.curve.length>20);assert.equal(first.video.arrow.length,3);
  assert.ok(later.video.curve.length<first.video.curve.length);assert.ok(later.video.curve[0].x>first.video.curve[0].x);
  assert.deepEqual(later.video.curve.at(-1),first.video.curve.at(-1));
  assert.ok(api.projectAnnotations(doc,{phaseId:'setup',frame:18,model}).items[0].video,'manual illustration is not split by tracker gaps');
  assert.equal(api.projectAnnotations(doc,{phaseId:'setup',frame:29,model}).items[0].hiddenReason,'completed');
  const editing=api.projectAnnotations(doc,{phaseId:'setup',frame:20,model,editing:true,selectedId:'route-a'}).items[0];
  assert.deepEqual(editing.video.curve,first.video.curve);assert.equal(editing.handles.length,3);
  const svg=api.renderAnnotationsSVG({width:1280,height:720,items:[editing]});
  assert.match(svg,/data-annotation-id="route-a"/);assert.match(svg,/data-part="arrow"/);assert.doesNotMatch(svg,/<text|chevron|P1/);
  assert.equal(api.hitTestAnnotation({items:[editing]},editing.handles[1]).id,'route-a');
});

test('court projection and video fallback use the exact visible frame and pixel bounds',async()=>{
  requireAPI();const doc=await fixture(),model=await buildPhaseRoutes(doc,'setup');
  const point=api.annotationPointFromVideo(model,12,{x:800,y:400});assert.equal(point.space,'court');
  assert.ok(Math.abs(point.point.x-20)<1e-6);assert.ok(Math.abs(point.point.y-10)<1e-6);
  const missing={...model,context:{...model.context,maps:model.context.maps.map(()=>null)}};
  assert.deepEqual(api.annotationPointFromVideo(missing,12,{x:800,y:400}),{space:'video',point:{x:800,y:400}});
  assert.throws(()=>api.annotationPointFromVideo(model,12,{x:-1,y:400}));
  const video=api.createAnnotation(doc,{...route,space:'video',points:[{x:600,y:400},{x:800,y:360}]});
  assert.ok(api.projectAnnotations(video,{phaseId:'setup',frame:12,model:missing}).items[0].video);
  assert.equal(api.projectAnnotations(video,{phaseId:'setup',frame:13,model:missing}).items[0].hiddenReason,'reference_frame_only');
});

test('screen bar and floor circle render visibly; spotlight follows only its own lawful footpoint',async()=>{
  requireAPI();const base=await fixture();base.review.entities[0].trajectory[20].source='conflict';
  base.playDefinition.sourceBinding=await createSourceBinding(base.review);
  let doc=api.createAnnotation(base,{...route,id:'screen-a',type:'screen',points:[{x:21,y:7}],style:{angle:60,size:1.4}});
  const anchor=base.review.entities[0].trajectory[12];
  doc=api.createAnnotation(doc,{...route,id:'spot-a',type:'spotlight',points:[{x:anchor.x/40+.2,y:anchor.y/40}]});
  const first=api.projectAnnotations(doc,{phaseId:'setup',frame:12}),later=api.projectAnnotations(doc,{phaseId:'setup',frame:19});
  assert.ok(first.items.find(i=>i.type==='screen').video.paths.length>=3);
  assert.equal(first.items.find(i=>i.type==='spotlight').video.ring.length,49);
  assert.ok(later.items.find(i=>i.type==='spotlight').video.center.x>first.items.find(i=>i.type==='spotlight').video.center.x);
  assert.equal(api.projectAnnotations(doc,{phaseId:'setup',frame:20}).items.find(i=>i.type==='spotlight').hiddenReason,'identity_conflict');
  const svg=api.renderAnnotationsSVG(first);assert.match(svg,/data-type="screen"/);assert.match(svg,/data-type="spotlight"/);assert.doesNotMatch(svg,/<text/);
});

test('missing detection and calibration never prevent hand-drawn placement on the current video frame',async()=>{
  requireAPI();const base=await fixture();base.review.court.calibration={maxKeyframeGapSeconds:0,keyframes:[]};
  for(const entity of base.review.entities)entity.trajectory=[];
  base.playDefinition.sourceBinding=await createSourceBinding(base.review);
  let doc=base;
  for(const type of ['route','screen','spotlight'])doc=api.createAnnotation(doc,{...route,id:type,type,space:'video',
    points:type==='route'?[{x:400,y:500},{x:500,y:450},{x:600,y:450}]:[{x:400,y:500}]});
  await validateDocument(doc);
  const first=api.projectAnnotations(doc,{phaseId:'setup',frame:12});assert.ok(first.items.every(item=>item.video));
  assert.equal(first.items.find(item=>item.type==='spotlight').video.center.x,400);
  const next=api.projectAnnotations(doc,{phaseId:'setup',frame:13});assert.ok(next.items.every(item=>!item.video));
  assert.equal(next.items.find(item=>item.type==='spotlight').hiddenReason,'anchor_position_unavailable');
  doc=api.updateAnnotation(doc,'screen',{points:[{x:500,y:510}],style:{angle:90}});
  assert.equal(api.projectAnnotations(doc,{phaseId:'setup',frame:12}).items.find(item=>item.type==='screen').video.center.x,500);
  const removed=api.removeAnnotation(api.removeAnnotation(api.removeAnnotation(doc,'route'),'screen'),'spotlight');
  assert.equal(removed.annotations,undefined);assert.deepEqual(removed.review,base.review);
});

test('source refresh keeps authored drawings inactive until the user explicitly rebinds them',async()=>{
  requireAPI();const doc=api.createAnnotation(await fixture(),route),changed=structuredClone(doc);
  changed.review.entities[0].name='corrected player';changed.playDefinition.sourceBinding=await createSourceBinding(changed.review);
  await validateDocument(changed);assert.equal(api.annotationStatus(changed,{phaseId:'setup'}).stale[0].reason,'source_changed');
  const stillStale=api.updateAnnotation(changed,'route-a',{style:{size:1.2}});
  assert.equal(api.annotationStatus(stillStale,{phaseId:'setup'}).stale.length,1);
  const rebound=api.updateAnnotation(stillStale,'route-a',{frame:12});
  assert.equal(api.annotationStatus(rebound,{phaseId:'setup'}).active.length,1);
});

test('a video with no detected or associated players can still start a complete manual canvas',async()=>{
  requireAPI();const review=(await fixture()).review;review.entities=[];review.court.calibration.keyframes=[];
  let doc=await createTacticsDocument(review);assert.deepEqual(doc.playDefinition.participants,[]);
  for(const type of ['route','screen','spotlight'])doc=api.createAnnotation(doc,{id:type,type,phaseId:'phase-1',entityId:null,frame:0,
    space:'video',points:type==='route'?[{x:300,y:300},{x:500,y:350}]:[{x:300,y:300}]});
  await validateDocument(doc);const model=await buildPhaseRoutes(doc,'phase-1');
  assert.deepEqual(model.routes,[]);assert.ok(api.projectAnnotations(doc,{phaseId:'phase-1',frame:0,model}).items.every(i=>i.video));
  assert.equal(doc.annotations.items.find(i=>i.type==='spotlight').followEntity,false);
});
