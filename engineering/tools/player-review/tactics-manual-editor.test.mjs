import test from 'node:test';
import assert from 'node:assert/strict';
import {makeV2Fixture} from './tactics-v2-fixture.mjs';
import {createManualAnnotation,setManualAnnotationRange,duplicateAnnotation,correctAnnotationProgress,nearestRouteProgress} from './tactics-manual-editor.mjs';
import {upsertTacticKeyframe,removeTacticKeyframe,compileTacticKeyframes} from './tactics-keyframes.mjs';
import {projectAnnotations,removeAnnotation} from './tactics-annotations.mjs';
import {compileProduction,renderProductionSvg} from './tactics-production.mjs';
import {validateDocument,createTacticsDocument} from './tactics-document.mjs';

async function base(){const {document:d}=await makeV2Fixture();delete d.review.courtPreparation;return createTacticsDocument(d.review);}
const route=(d,id='a',range={startFrame:10,endFrameExclusive:50})=>createManualAnnotation(d,{id,type:'route',phaseId:'phase-1',range,frame:10,space:'video',points:[{x:200,y:400},{x:900,y:300}]});
const geometry=(d,frame)=>projectAnnotations(d,{phaseId:'phase-1',frame}).items[0].video;

test('manual fixed video route consumes its own range, stores explicit pixels, trims the tail and keeps its head',async()=>{
  const d=route(await base());await validateDocument(d);const a=d.annotations.items[0];
  assert.deepEqual([a.startFrame,a.endFrameExclusive],[10,50]);assert.equal(a.points.length,4);assert.equal(a.videoMode,'fixed');assert.deepEqual(a.referenceSize,{width:d.review.width,height:d.review.height});
  assert.equal(geometry(d,9),null);const full=geometry(d,10),half=geometry(d,30),near=geometry(d,49);
  assert.ok(half.curve[0].x>full.curve[0].x+250);assert.deepEqual(half.arrow,full.arrow);assert.deepEqual(half.curve.at(-1),full.curve.at(-1));assert.ok(!near||near.opacity<half.opacity);
  assert.equal(geometry(d,50),null);assert.match(renderProductionSvg(d,{phaseId:'phase-1',sourceFrame:30,reveal:1,state:'source'}),/authored-ribbon/);
  for(let frame=10;frame<50;frame++){const g=geometry(d,frame);if(!g)continue;const length=g.curve.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-g.curve[i].x,p.y-g.curve[i].y),0),head=Math.hypot(g.arrow[1].x-(g.arrow[0].x+g.arrow[2].x)/2,g.arrow[1].y-(g.arrow[0].y+g.arrow[2].y)/2);assert.ok(length>head*2,'remaining body must disappear before becoming an isolated arrowhead');}
});
test('directional passing curve stays complete over its interval and keeps optional yellow dots',async()=>{
  let d=await base();for(const [id,pattern] of [['pass','dashed'],['dots','dots']])d=createManualAnnotation(d,{id,type:'route',pattern,phaseId:'phase-1',range:{startFrame:30,endFrameExclusive:42},frame:10,space:'video',points:[{x:200,y:400},{x:800,y:250}]});
  await validateDocument(d);const s=projectAnnotations(d,{phaseId:'phase-1',frame:40});assert.equal(s.items[0].video.pattern,'dashed');assert.deepEqual(s.items[0].video.curve[0],{x:200,y:400});assert.equal(s.items[1].video.pattern,'dots');
});
test('empty explanation, early future objects, max same-frame hold, later freeze preserves old progress',async()=>{
  let d=await base();d=upsertTacticKeyframe(d,{id:'first',kind:'explanation',frame:10,annotationIds:[]});
  d=route(d);d=createManualAnnotation(d,{id:'screen',type:'screen',phaseId:'phase-1',range:{startFrame:15,endFrameExclusive:30},frame:10,space:'video',points:[{x:700,y:350}]});
  d=upsertTacticKeyframe(d,{...d.tacticKeyframes.items[0],annotationIds:['a','screen']});
  d=upsertTacticKeyframe(d,{id:'same',kind:'explanation',frame:10,annotationIds:['a'],holdSeconds:1});
  assert.equal(d.tacticKeyframes.items.length,1);assert.equal(compileTacticKeyframes(d)[0].holdSeconds,2.5);
  const scene=projectAnnotations(d,{phaseId:'phase-1',frame:10,freeze:true,reveal:1});assert.ok(scene.items.every(a=>a.video));
  d=upsertTacticKeyframe(d,{id:'second',kind:'explanation',frame:35,annotationIds:[]});
  const expected=geometry(d,35),frozen=projectAnnotations(d,{phaseId:'phase-1',frame:35,freeze:true,reveal:.1}).items[0].video;assert.deepEqual(frozen,expected);
  const plan=compileProduction(d);assert.equal(plan.totalFrames,333); // 6.1 source + 5 seconds extra, at output 30fps
  assert.ok(plan.frames.some(f=>f.state==='settle'));assert.ok(plan.frames.some(f=>f.state==='draw'));
  assert.throws(()=>upsertTacticKeyframe(d,{...d.tacticKeyframes.items[0],frame:11}),/早于|起点/);
  assert.equal(removeTacticKeyframe(d,'first').annotations.items.length,2);const without=removeAnnotation(d,'a');assert.deepEqual(without.tacticKeyframes.items[0].annotationIds,['screen']);
  assert.throws(()=>upsertTacticKeyframe(d,{id:'short',kind:'explanation',frame:0,annotationIds:[],holdSeconds:.2}),/0.9/);
});
test('click correction uses arc length, rejects reversal, preserves shape edits and resizes in actual PTS',async()=>{
  let d=route(await base());const a=d.annotations.items[0],p={x:655,y:335};const found=nearestRouteProgress(d,a,p);
  assert.ok(Math.abs(found.progress-.65)<.005);d=correctAnnotationProgress(d,'a',30,found.progress);assert.equal(d.annotations.items[0].progressFrames[1].t,found.progress);
  assert.throws(()=>correctAnnotationProgress(d,'a',35,.4),/倒退|下降/);
  const resized=setManualAnnotationRange(d,'a',{startFrame:20,endFrameExclusive:60});assert.equal(resized.annotations.items[0].progressFrames[1].frame,40);assert.deepEqual(d.annotations.items[0].points,resized.annotations.items[0].points);
  const m=d.review.sourceFrameMapping;for(let i=1;i<m.length;i++)m[i].time=i<30?i*.07:2.1+(i-30)*.13;d.review.mediaEndTime=6.4;
  const vfr=setManualAnnotationRange(d,'a',{startFrame:15,endFrameExclusive:55});const keys=vfr.annotations.items[0].progressFrames;
  const target=m[15].time+(m[30].time-m[10].time)/(m[50].time-m[10].time)*(m[55].time-m[15].time);
  const frame=m.findIndex(p=>p.time>=target);assert.equal(keys[1].frame,frame);
});
test('duplicate preserves geometry/effects/first cue and gets an independent identifier; conflicts leave input intact',async()=>{
  let d=route(await base());d=upsertTacticKeyframe(d,{id:'first',kind:'explanation',frame:10,annotationIds:['a']});const before=structuredClone(d);
  const copy=duplicateAnnotation(d,'a','b');await validateDocument(copy);assert.equal(copy.annotations.items.length,2);assert.deepEqual(copy.annotations.items[0].points,copy.annotations.items[1].points);assert.deepEqual(copy.tacticKeyframes.items[0].annotationIds,['a','b']);
  assert.throws(()=>setManualAnnotationRange(d,'a',{startFrame:0,endFrameExclusive:40}),/讲解暂停/);assert.deepEqual(d,before);
  const detached=setManualAnnotationRange(d,'a',{startFrame:0,endFrameExclusive:40},{detachCue:true});assert.equal(detached.tacticKeyframes.items[0].annotationIds.length,0);
});
test('manual player foot retains the independent following spotlight tool',async()=>{
  const d=createManualAnnotation(await base(),{id:'foot',type:'spotlight',phaseId:'phase-1',entityId:'P1',anchorMode:'player_foot',range:{startFrame:10,endFrameExclusive:50},frame:10,space:'video',points:[{x:200,y:400}]});
  await validateDocument(d);assert.equal(d.annotations.items[0].followEntity,true);
});
test('first/last frame empty explanation cues add exactly their extra time and zero cues do not freeze',async()=>{
  let d=await base();assert.equal(compileProduction(d).totalFrames,183);
  for(const [id,frame] of [['first',0],['last',60]])d=upsertTacticKeyframe(d,{id,kind:'explanation',frame,annotationIds:[]});
  await validateDocument(d);const plan=compileProduction(d);assert.equal(plan.totalFrames,333);assert.equal(plan.frames.filter(f=>f.state==='source').length,183);assert.ok(plan.frames.some(f=>f.state==='hold'&&f.sourceFrame===60));
});
