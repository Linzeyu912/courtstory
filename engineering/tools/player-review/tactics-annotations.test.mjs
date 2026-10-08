import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createSourceBinding} from '../tactical-overlay/binding.mjs';
import {createTacticsDocument,validateDocument,splitPhase,removePhase} from './tactics-document.mjs';
import {buildPhaseRoutes} from './tactics-presentation.mjs';

const api=await import('./tactics-annotations.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const requireAPI=()=>assert.equal(typeof api.createAnnotation,'function','the manual tactical annotation module is required');
const fixture=async()=>({schemaVersion:1,title:'Annotations',notes:'',...await makePresentationDemo()});
const projectedFixture=async({scale=1,x=0,y=0}={})=>{
  const doc=await fixture();
  for(const key of doc.review.court.calibration.keyframes)for(const point of key.points)point.image=[point.image[0]*scale+x,point.image[1]*scale+y];
  doc.playDefinition.sourceBinding=await createSourceBinding(doc.review);return doc;
};
const route={id:'route-a',phaseId:'setup',type:'route',entityId:'P1',frame:12,space:'court',points:[{x:18,y:10},{x:20,y:9},{x:22,y:9}]};

test('new spotlight defaults are white while custom and saved color data survive the white-light renderer',async()=>{
  const base=await fixture(),input={...route,type:'spotlight',entityId:null,space:'video',points:[{x:600,y:400}]};
  const origin={kind:'agent',jobId:'palette',sourceFrames:[12],note:'focus'};
  for(const style of [undefined,{color:'#ffd45c'},{color:'#ffd34e'}]){
    const created=api.createAnnotation(base,{...input,origin,...(style?{style}:{})});
    assert.equal(created.annotations.items[0].style.color,'#ffffff');
  }
  assert.equal(api.createAnnotation(base,input).annotations.items[0].style.color,'#ffffff');
  for(const color of ['#ff0000','#ffd34e']){
    const saved=api.createAnnotation(base,{...input,style:{color}}),loaded=JSON.parse(JSON.stringify(saved));
    const svg=api.renderAnnotationsSVG(api.projectAnnotations(loaded,{phaseId:'setup',frame:12}));
    assert.equal(loaded.annotations.items[0].style.color,color);
    assert.match(svg,/stop-color="#ffffff"/);assert.match(svg,/data-part="spotlight-soft-light"/);assert.doesNotMatch(svg,/<text/);
    assert.ok(!svg.includes(color),'the focus light stays white even for saved colored circles');
  }
  assert.equal(api.createAnnotation(base,{...input,origin,style:{color:'#ff0000'}}).annotations.items[0].style.color,'#ff0000');
});

test('visible spotlights dim the video once with one soft opening per player, and stop at the time boundary',async()=>{
  let doc=await fixture();
  for(const [i,x] of [400,800].entries())doc=api.createAnnotation(doc,{...route,id:`focus-${i}`,type:'spotlight',entityId:null,space:'video',points:[{x,y:450}],endFrameExclusive:30});
  const scene=api.projectAnnotations(doc,{phaseId:'setup',frame:16,freeze:false}),svg=api.renderAnnotationsSVG(scene);
  assert.equal((svg.match(/data-part="spotlight-dim"/g)??[]).length,1);
  assert.equal((svg.match(/data-part="spotlight-opening"/g)??[]).length,2);
  assert.match(svg,/fill="#000000" fill-opacity="0.3"/);
  assert.doesNotMatch(api.renderAnnotationsSVG(api.projectAnnotations(doc,{phaseId:'setup',frame:30})),/spotlight-dim|spotlight-opening/);
  for(const item of scene.items)item.video.opacity=0;
  assert.doesNotMatch(api.renderAnnotationsSVG(scene),/spotlight-dim|spotlight-opening/);
  for(const item of scene.items){item.video.opacity=1;item.video.subjectBounds={left:-300,top:100,right:-100,bottom:300};}
  assert.doesNotMatch(api.renderAnnotationsSVG(scene),/spotlight-dim|spotlight-opening/);
});

test('spotlight illumination uses the observed body box and follows the existing manual offset',async()=>{
  const base=await fixture(),p=base.review.entities[0].trajectory[16];p.box=[700,200,800,400];
  base.playDefinition.sourceBinding=await createSourceBinding(base.review);
  let doc=api.createAnnotation(base,{...route,id:'body-focus',type:'spotlight',space:'video',frame:16,points:[{x:p.x,y:p.y}],followEntity:false});
  let scene=api.projectAnnotations(doc,{phaseId:'setup',frame:16});
  assert.deepEqual(scene.items[0].video.subjectBounds,{left:700,top:200,right:800,bottom:400});
  doc=api.updateAnnotation(doc,'body-focus',{points:[{x:p.x+20,y:p.y+10}]});
  scene=api.projectAnnotations(doc,{phaseId:'setup',frame:16});
  assert.deepEqual(scene.items[0].video.subjectBounds,{left:720,top:210,right:820,bottom:410});
});

test('legacy spotlight keeps its editable time range outside reference frames and gains the common glow',async()=>{
  let doc=api.createAnnotation(await fixture(),{...route,id:'legacy-focus',type:'spotlight',entityId:null,space:'video',points:[{x:600,y:400}],endFrameExclusive:30});
  doc=JSON.parse(JSON.stringify(doc));await validateDocument(doc);
  assert.equal(api.annotationPresentation(doc).items[0].mode,'timeline');
  const scene=api.projectAnnotations(doc,{phaseId:'setup',frame:16,freeze:false});
  assert.ok(scene.items[0].video,'legacy spotlight must respect its range beyond its anchor frame');
  assert.deepEqual(scene.items[0].handles,[{x:600,y:400,index:0}]);
  assert.equal(api.hitTestAnnotation(scene,scene.items[0].video.ring[0]).id,'legacy-focus');
  const svg=api.renderAnnotationsSVG(scene);
  assert.match(svg,/data-part="spotlight-soft-light"/);assert.match(svg,/data-part="spotlight-halo"/);
  assert.match(svg,/data-part="spotlight"/);assert.match(svg,/<radialGradient/);
  const moved=api.updateAnnotation(doc,'legacy-focus',{points:[{x:620,y:410}],style:{size:2,color:'#00ff00'}});
  const resized=api.projectAnnotations(moved,{phaseId:'setup',frame:16});
  assert.deepEqual(resized.items[0].video.center,{x:620,y:410});
  assert.ok(resized.items[0].video.ring[0].x-620>scene.items[0].video.ring[0].x-600);
  assert.equal(api.projectAnnotations(moved,{phaseId:'setup',frame:30}).items[0].hiddenReason,'outside_time');
  assert.equal(moved.annotations.items[0].style.color,'#00ff00');
  assert.doesNotMatch(api.renderAnnotationsSVG(resized),/#00ff00/);
});

test('explicit observed later dashed routes retain each bend as one native editable route',async()=>{
  const base=await fixture();
  for(let count=2;count<=6;count++){
    const points=Array.from({length:count},(_,i)=>({x:400+i*35,y:450-i*15+(i%2)*25}));
    const doc=api.createAnnotation(base,{...route,space:'video',points,meaning:'later_observed_action',curve:'polyline',style:{pattern:'dashed'}});
    await validateDocument(JSON.parse(JSON.stringify(doc)));
    assert.equal(doc.annotations.items.length,1);assert.deepEqual(doc.annotations.items[0].points,points);
    const scene=api.projectAnnotations(doc,{phaseId:'setup',frame:12,freeze:true});
    assert.equal(scene.items.length,1);assert.deepEqual(scene.items[0].video.curve[0],points[0]);
    assert.deepEqual(scene.items[0].video.curve.at(-1),points.at(-1));
    assert.match(api.renderAnnotationsSVG(scene),/stroke-dasharray=/);
    const edited=api.updateAnnotation(doc,'route-a',{points:points.map((p,i)=>({...p,y:p.y+(i===1?5:0)}))});
    assert.equal(edited.annotations.items.length,1);assert.equal(edited.annotations.items[0].points.length,count);
  }
  assert.throws(()=>api.createAnnotation(base,{...route,meaning:'later_observed_action',style:{pattern:'dashed'},points:Array.from({length:7},(_,i)=>({x:10+i,y:8}))}),/annotation_points/);
});

test('pass dots and dashed paths without observed-later meaning still reject multiple bends',async()=>{
  const base=await fixture();
  for(const meaning of [undefined,'pass','current_action'])for(const pattern of ['dashed','dots']){
    assert.throws(()=>api.createAnnotation(base,{...route,...(meaning?{meaning}:{}),curve:'polyline',style:{pattern}}),/annotation_straight_points/);
  }
  assert.throws(()=>api.createAnnotation(base,{...route,meaning:'later_observed_action',style:{pattern:'dots'}}),/annotation_straight_points/);
});

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

test('static position marker renders as a small cross without a spotlight or player label and stays editable',async()=>{
  const doc=api.createAnnotation(await fixture(),{id:'static-position',type:'position',phaseId:'setup',entityId:null,frame:12,space:'video',points:[{x:600,y:400}]});
  await validateDocument(JSON.parse(JSON.stringify(doc)));
  const scene=api.projectAnnotations(doc,{phaseId:'setup',frame:12}),svg=api.renderAnnotationsSVG(scene);
  assert.match(svg,/data-type="position"/);assert.match(svg,/data-part="position-mark"/);
  assert.doesNotMatch(svg,/data-part="spotlight"|<text/);assert.equal(scene.items[0].video.ring,undefined);
  assert.equal(api.hitTestAnnotation(scene,{x:600,y:400}).id,'static-position');
  assert.equal(api.annotationPresentation(doc).items[0].visible,true);
  const edited=api.updateAnnotation(doc,'static-position',{points:[{x:650,y:420}]});assert.equal(edited.annotations.items[0].points[0].x,650);
  assert.equal((api.removeAnnotation(edited,'static-position').annotations?.items??[]).length,0);
});

test('a court foot circle can be unlinked or stopped without an invalid anchor or changed observations',async()=>{
  const original=await fixture(),doc=api.createAnnotation(original,{...route,id:'court-foot',type:'spotlight',points:[{x:18,y:10}],anchorMode:'court_player_foot'});
  for(const patch of [{entityId:null},{followEntity:false}]){
    const next=api.updateAnnotation(doc,'court-foot',patch);await validateDocument(next);
    assert.equal(next.annotations.items[0].followEntity,false);assert.equal(next.annotations.items[0].anchorMode,'manual_offset');
    assert.deepEqual(next.review,original.review);assert.deepEqual(next.annotations.items[0].points,doc.annotations.items[0].points);
  }
  assert.equal(doc.annotations.items[0].followEntity,true);
});

test('pause points group all visible anchors in phase order without changing the document',async()=>{
  assert.equal(typeof api.annotationPausePoints,'function');let doc=await fixture();
  const marker={type:'screen',entityId:null,space:'video',points:[{x:400,y:400}]};
  doc=api.createAnnotation(doc,{...marker,id:'later-phase',phaseId:'finish',frame:35});
  doc=api.createAnnotation(doc,{...marker,id:'late',phaseId:'setup',frame:20,endFrameExclusive:21});
  doc=api.createAnnotation(doc,{...marker,id:'early',phaseId:'setup',frame:2});
  doc=api.createAnnotation(doc,{...marker,id:'same-frame',phaseId:'setup',frame:20});
  doc=api.createAnnotation(doc,{...route,id:'court-route'});
  doc=api.createAnnotation(doc,{...marker,id:'following',type:'spotlight',entityId:'P1',phaseId:'setup',frame:8});
  const before=structuredClone(doc);
  assert.deepEqual(api.annotationPausePoints(doc),[
    {phaseId:'setup',frame:2,annotationIds:['early']},
    {phaseId:'setup',frame:8,annotationIds:['following']},
    {phaseId:'setup',frame:12,annotationIds:['court-route']},
    {phaseId:'setup',frame:20,annotationIds:['late','same-frame']},
    {phaseId:'finish',frame:35,annotationIds:['later-phase']}]);
  assert.deepEqual(doc,before);
  assert.equal(api.projectAnnotations(doc,{phaseId:'setup',frame:21}).items.find(a=>a.id==='late').hiddenReason,'outside_time');
  assert.equal(api.projectAnnotations(doc,{phaseId:'setup',frame:21}).items.find(a=>a.id==='same-frame').hiddenReason,'reference_frame_only');
  assert.deepEqual(api.annotationPausePoints(await fixture()),[]);
});

test('presentation reports actual anchor visibility and includes single-frame court and following markers',async()=>{
  assert.equal(typeof api.annotationPresentation,'function');
  let doc=await fixture();doc.review.entities.find(e=>e.id==='P2').trajectory=[];
  doc.playDefinition.sourceBinding=await createSourceBinding(doc.review);
  const marker={type:'screen',phaseId:'setup',entityId:null,space:'video',points:[{x:400,y:400}]};
  doc=api.createAnnotation(doc,{...marker,id:'empty-route',type:'route',frame:11,points:[{x:400,y:400},{x:400,y:400}]});
  doc=api.createAnnotation(doc,{...marker,id:'court-one',space:'court',frame:12,endFrameExclusive:13,points:[{x:18,y:10}]});
  doc=api.createAnnotation(doc,{...marker,id:'missing-foot',type:'spotlight',entityId:'P2',anchorMode:'player_foot',frame:13});
  doc=api.createAnnotation(doc,{...marker,id:'follow-one',type:'spotlight',entityId:'P1',anchorMode:'player_foot',frame:14,endFrameExclusive:15});
  doc=api.createAnnotation(doc,{...marker,id:'court-timeline',space:'court',frame:15,points:[{x:19,y:10}]});
  doc=api.createAnnotation(doc,{...marker,id:'pixel-one',frame:20});
  const before=structuredClone(doc),report=api.annotationPresentation(doc);
  assert.deepEqual(report.items.map(({id,visible,reason,mode})=>({id,visible,reason,mode})),[
    {id:'empty-route',visible:false,reason:'completed',mode:'reference_frame'},
    {id:'court-one',visible:true,reason:null,mode:'reference_frame'},
    {id:'missing-foot',visible:false,reason:'missing_position',mode:'timeline'},
    {id:'follow-one',visible:true,reason:null,mode:'reference_frame'},
    {id:'court-timeline',visible:true,reason:null,mode:'timeline'},
    {id:'pixel-one',visible:true,reason:null,mode:'reference_frame'}]);
  assert.deepEqual(report.pausePoints.map(p=>p.frame),[12,14,15,20]);
  assert.deepEqual(api.annotationPausePoints(doc),report.pausePoints);
  assert.deepEqual(api.annotationPresentation(doc,{annotationIds:['court-one','missing-foot']}),{
    items:report.items.filter(i=>['court-one','missing-foot'].includes(i.id)),pausePoints:[report.pausePoints[0]]});
  assert.deepEqual(api.annotationPresentation(doc,{annotationIds:[]}),{items:[],pausePoints:[]});
  assert.deepEqual(doc,before);
  const stale=splitPhase(doc,'setup',22),staleReport=api.annotationPresentation(stale);
  assert.equal(staleReport.items.length,6);assert.ok(staleReport.items.every(i=>!i.visible&&i.reason==='phase_changed'));
  assert.deepEqual(staleReport.pausePoints,[]);
});

test('finite court projection entirely outside the video is not a presentable cue',async()=>{
  let doc=await projectedFixture({x:1000});
  for(const type of ['screen','spotlight','route'])doc=api.createAnnotation(doc,{id:type,type,entityId:null,phaseId:'setup',frame:20,space:'court',
    points:type==='route'?[{x:26,y:7},{x:27,y:7}]:[{x:26,y:7}]});
  const scene=api.projectAnnotations(doc,{phaseId:'setup',frame:20,editing:true});
  assert.ok(scene.items.every(i=>i.video),'existing render output stays unchanged');
  assert.ok(scene.items.find(i=>i.id==='screen').video.paths.flat().every(p=>p.x>1280));
  const report=api.annotationPresentation(doc);
  assert.ok(report.items.every(i=>!i.visible&&i.reason==='outside_viewport'));
  assert.deepEqual(report.pausePoints,[]);
});

test('viewport visibility preserves a crossing line, partial marker, stroke-only edge, arrow and dots',async()=>{
  let doc=await projectedFixture({x:1000});
  const base={entityId:null,phaseId:'setup',frame:12,space:'court'};
  for(const [id,x] of [['partial-screen',7],['stroke-screen',7.6]])doc=api.createAnnotation(doc,{...base,id,type:'screen',points:[{x,y:7}]});
  doc=api.createAnnotation(doc,{...base,id:'arrow',type:'route',points:[{x:7.3,y:6},{x:7.3,y:10}]});
  doc=api.createAnnotation(doc,{...base,id:'dots',type:'route',points:[{x:7.1,y:6},{x:7.1,y:10}],style:{pattern:'dots'}});
  const geometry=new Map(api.projectAnnotations(doc,{phaseId:'setup',frame:12,editing:true}).items.map(i=>[i.id,i.video]));
  assert.ok(geometry.get('stroke-screen').paths.flat().every(p=>p.x>1280));
  assert.ok(geometry.get('arrow').curve.every(p=>p.x>1280+geometry.get('arrow').strokeWidth));
  assert.ok(geometry.get('arrow').arrow.some(p=>p.x<1280));
  assert.ok(geometry.get('dots').dots.every(p=>p.x>1280));
  assert.ok(api.annotationPresentation(doc).items.every(i=>i.visible));
  let across=await projectedFixture({scale:2,x:-500});
  across=api.createAnnotation(across,{...base,id:'crossing',type:'route',points:[{x:0,y:3},{x:28,y:3}]});
  const line=api.projectAnnotations(across,{phaseId:'setup',frame:12,editing:true}).items[0].video.curve;
  assert.ok(line[0].x<0&&line.at(-1).x>1280);
  assert.equal(api.annotationPresentation(across).items[0].visible,true);
});

test('a dotted path crossing the viewport is invisible when every painted circle misses it',async()=>{
  let doc=await projectedFixture({x:-1000,y:-400});
  doc=api.createAnnotation(doc,{id:'gap',type:'route',entityId:null,phaseId:'setup',frame:12,space:'court',
    points:[{x:24.25,y:10.75},{x:25.25,y:9.75}],style:{pattern:'dots'}});
  const geometry=api.projectAnnotations(doc,{phaseId:'setup',frame:12,editing:true}).items[0].video;
  assert.equal(geometry.dots.length,3);
  assert.ok(geometry.dots.every(p=>Math.hypot(Math.max(0,-p.x),Math.max(0,-p.y))>geometry.dotRadius+1));
  assert.equal(api.annotationPresentation(doc).items[0].reason,'outside_viewport');
});

test('a dash gap at the viewport corner does not count as painted line or arrow',async()=>{
  let doc=await projectedFixture({x:-1000,y:-400});
  const input={type:'route',entityId:null,phaseId:'setup',frame:12,space:'court',points:[{x:24.5,y:10.35},{x:26,y:8.85}]};
  doc=api.createAnnotation(doc,{...input,id:'solid'});
  doc=api.createAnnotation(doc,{...input,id:'dashed',style:{pattern:'dashed'}});
  const report=api.annotationPresentation(doc);
  assert.equal(report.items[0].visible,true,'the continuous stroke grazes the corner');
  assert.equal(report.items[1].reason,'outside_viewport','only the unpainted gap grazes the corner');
});

test('a filled spotlight enclosing the viewport remains visible when all ring vertices lie outside it',async()=>{
  let doc=await projectedFixture({scale:100,x:640-72000,y:360-40000});
  doc=api.createAnnotation(doc,{id:'enclosing-ring',type:'spotlight',entityId:null,phaseId:'setup',frame:12,space:'court',points:[{x:18,y:10}]});
  const ring=api.projectAnnotations(doc,{phaseId:'setup',frame:12,editing:true}).items[0].video.ring;
  assert.ok(ring.every(p=>p.x<0||p.x>1280||p.y<0||p.y>720));
  assert.equal(api.annotationPresentation(doc).items[0].visible,true);
});

test('pause points exclude archived phase, source and player bindings',async()=>{
  assert.equal(typeof api.annotationPausePoints,'function');
  const input={...route,type:'screen',space:'video',points:[{x:400,y:400}]};
  const doc=api.createAnnotation(await fixture(),input);
  assert.deepEqual(api.annotationPausePoints(splitPhase(doc,'setup',20)),[]);
  assert.deepEqual(api.annotationPausePoints(removePhase(doc,'setup')),[]);
  const source=structuredClone(doc);source.playDefinition.sourceBinding.reviewDigest='0'.repeat(64);
  assert.deepEqual(api.annotationPausePoints(source),[]);
  const player=structuredClone(doc);player.playDefinition.participants=player.playDefinition.participants.filter(p=>p.id!=='P1');
  assert.deepEqual(api.annotationPausePoints(player),[]);
});

test('straight route patterns keep legacy defaults and reject incompatible imports or extra control points',async()=>{
  const base=await fixture(),points=[{x:18,y:10},{x:23,y:8}];
  const legacy=api.createAnnotation(base,route);await validateDocument(JSON.parse(JSON.stringify(legacy)));
  assert.equal(legacy.annotations.items[0].style.pattern,undefined);
  for(const pattern of ['solid','dashed','dots']){
    const doc=api.createAnnotation(base,{...route,points,style:{pattern}});
    await validateDocument(JSON.parse(JSON.stringify(doc)));
    assert.equal(doc.annotations.items[0].style.color,pattern==='dots'?'#ffd45c':'#19a9e1');
    const moved=api.updateAnnotation(doc,'route-a',{points:[{x:17,y:9},{x:22,y:7}],style:{size:1.5}});
    assert.equal(moved.annotations.items[0].style.pattern,pattern);assert.equal(moved.annotations.items[0].points.length,2);
    assert.deepEqual(doc.annotations.items[0].points,points);
    const split=splitPhase(moved,'setup',20),rebound=api.updateAnnotation(split,'route-a',{frame:12,endFrameExclusive:20});
    await validateDocument(rebound);assert.equal(rebound.annotations.items[0].style.pattern,pattern);
    if(pattern!=='solid'){
      assert.throws(()=>api.updateAnnotation(doc,'route-a',{points:route.points}));
      assert.throws(()=>api.updateAnnotation(doc,'route-a',{points:[points[0],points[0]]}));
      assert.throws(()=>api.createAnnotation(base,{...route,points:[points[0],points[0]],style:{pattern}}));
    }
  }
  for(const input of [{...route,style:{pattern:'dashed'}},{...route,style:{pattern:'dots'}},
    {...route,points,style:{pattern:'invented'}},
    {...route,type:'screen',points:[points[0]],style:{pattern:'solid'}},
    {...route,type:'spotlight',points:[points[0]],style:{pattern:'dots'}}])assert.throws(()=>api.createAnnotation(base,input));
  const imported=structuredClone(legacy);imported.annotations.items[0].style.pattern='dots';
  await assert.rejects(validateDocument(imported),/画布标注/);
});

test('dashed arrows use matching gaps in the white outline and colored line while keeping the head solid',async()=>{
  const doc=api.createAnnotation(await fixture(),{...route,points:[{x:17,y:10},{x:24,y:10}],style:{pattern:'dashed'}});
  const first=api.projectAnnotations(doc,{phaseId:'setup',frame:12}),later=api.projectAnnotations(doc,{phaseId:'setup',frame:20});
  const svg=api.renderAnnotationsSVG(first),lines=[...svg.matchAll(/<polyline\b[^>]*>/g)].map(match=>match[0]);
  assert.equal(lines.length,2);assert.ok(lines.every(line=>/stroke-dasharray="[^"]+"/.test(line)));
  assert.equal(lines[0].match(/stroke-dasharray="([^"]+)"/)[1],lines[1].match(/stroke-dasharray="([^"]+)"/)[1]);
  const arrow=svg.match(/<polygon\b[^>]*data-part="arrow"[^>]*>/)?.[0];assert.ok(arrow);assert.doesNotMatch(arrow,/stroke-dasharray/);
  assert.ok(later.items[0].video.curve[0].x>first.items[0].video.curve[0].x);
  assert.ok(first.items[0].video.curve.every(point=>Math.abs(point.y-first.items[0].video.curve[0].y)<1e-6));
  assert.equal(api.projectAnnotations(doc,{phaseId:'setup',frame:29}).items[0].hiddenReason,'completed');
});

test('passing dots remain equally spaced after perspective projection and gaps select the entire route',async()=>{
  const base=await fixture();
  for(const key of base.review.court.calibration.keyframes)for(const point of key.points){
    const [x,y]=point.image;point.image=[x/(1+x*.0005),y/(1+x*.0005)];
  }
  base.playDefinition.sourceBinding=await createSourceBinding(base.review);
  const doc=api.createAnnotation(base,{...route,points:[{x:4,y:4},{x:26,y:11}],style:{pattern:'dots'}});
  const scene=api.projectAnnotations(doc,{phaseId:'setup',frame:12}),geometry=scene.items[0].video;
  assert.ok(geometry.dots.length>5);assert.equal(geometry.arrow,undefined);
  const gaps=geometry.dots.slice(1).map((point,index)=>Math.hypot(point.x-geometry.dots[index].x,point.y-geometry.dots[index].y));
  assert.ok(Math.max(...gaps)-Math.min(...gaps)<1e-6);
  assert.ok(geometry.dotRadius>=5&&geometry.dotRadius<=6,'projected dots must remain visible when the video is shown at reduced size');
  assert.ok(gaps.every(gap=>gap>=20-1e-6),'passing markers need enough space to remain separate at the default size');
  const middle=Math.floor(geometry.dots.length/2),a=geometry.dots[middle],b=geometry.dots[middle+1];
  assert.deepEqual(api.hitTestAnnotation(scene,{x:(a.x+b.x)/2,y:(a.y+b.y)/2},1),{id:'route-a',index:null});
  const svg=api.renderAnnotationsSVG(scene);
  assert.equal((svg.match(/<circle\b/g)||[]).length,geometry.dots.length);
  assert.doesNotMatch(svg,/<polyline|data-part="arrow"/);assert.match(svg,/fill="#ffd45c"/);
  assert.ok([...svg.matchAll(/<circle\b[^>]*>/g)].every(match=>/stroke="#5a4105"/.test(match[0])&&/stroke-width="1"/.test(match[0])));
  const larger=api.projectAnnotations(api.updateAnnotation(doc,'route-a',{style:{size:2}}),{phaseId:'setup',frame:12}).items[0].video;
  assert.equal(larger.dotRadius,geometry.dotRadius*2);assert.ok(larger.dots.length<geometry.dots.length);
  const later=api.projectAnnotations(doc,{phaseId:'setup',frame:20}).items[0].video;
  assert.ok(later.dots.length<geometry.dots.length);assert.deepEqual(later.dots.at(-1),geometry.dots.at(-1));
});

test('extreme visible passing lines have a bounded number of circles and keep video frame visibility rules',async()=>{
  const base=await fixture();base.review.width=65000;base.playDefinition.sourceBinding=await createSourceBinding(base.review);
  const doc=api.createAnnotation(base,{...route,space:'video',points:[{x:0,y:500},{x:64999,y:500}],style:{pattern:'dots',size:.5}});
  const scene=api.projectAnnotations(doc,{phaseId:'setup',frame:12}),dots=scene.items[0].video.dots;
  assert.ok(dots.length>1&&dots.length<=160);assert.deepEqual(dots[0],{x:0,y:500});assert.deepEqual(dots.at(-1),{x:64999,y:500});
  assert.equal(api.projectAnnotations(doc,{phaseId:'setup',frame:13}).items[0].hiddenReason,'reference_frame_only');
});
