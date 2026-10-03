import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {buildPhaseRoutes,updateRouteControlPoints,restoreRoute,extractRouteControlPoints} from './tactics-presentation.mjs';
import {createRouteEditor,commitWhenCurrent,screenToCourt} from './tactics-route-editor.mjs';

async function fixture(){
  const f=await makePresentationDemo();
  f.playDefinition.phases=[{phaseId:'phase-1',order:0,title:'future',startFrame:0,endFrameExclusive:61,freezeFrame:0,
    participantIds:f.playDefinition.participants.map(p=>p.id),actionIds:f.playDefinition.actions.map(a=>a.actionId),relationIds:f.playDefinition.relations.map(r=>r.id)}];
  const d={schemaVersion:1,title:'fixture',notes:'',...f};
  const model=await buildPhaseRoutes(d,'phase-1');
  const route=model.routes.find(r=>r.sourcePoints.length>5);
  assert.ok(route);return {d,model,route};
}
test('drag preview never writes; pointerup submits once and a second pointer cannot finish it',async()=>{
  const {route}=await fixture(),calls=[],previews=[],stamp={context:1};
  const editor=createRouteEditor({getStamp:()=>stamp,commitControls:(...args)=>calls.push(args),onPreview:r=>previews.push(r)});
  editor.select(route);const original=extractRouteControlPoints(route);
  editor.begin(0,7);editor.move({x:original[0].x+.2,y:original[0].y},7);
  assert.equal(calls.length,0);assert.equal(previews.at(-1).manual,true);
  await editor.end(8);assert.equal(calls.length,0);
  await editor.end(7);await editor.end(7);assert.equal(calls.length,1);
  assert.equal(calls[0][2],stamp);assert.deepEqual(route.controlPoints,original);
});
test('cancel and selecting a new route discard the gesture without committing',async()=>{
  const {route}=await fixture(),calls=[];
  const editor=createRouteEditor({getStamp:()=>({}),commitControls:(...args)=>calls.push(args)});
  editor.select(route);editor.begin(0,1);editor.move({x:1,y:2},1);editor.cancel();await editor.end(1);
  assert.deepEqual(editor.controls,route.controlPoints);assert.equal(calls.length,0);
  editor.begin(0,2);editor.move({x:2,y:3},2);editor.select(null);await editor.end(2);
  assert.equal(calls.length,0);assert.deepEqual(editor.controls,[]);
});
test('insert uses an available source frame, maintains ordering, and only internal controls can be removed',async()=>{
  const {d,route}=await fixture(),before=structuredClone(d.review),writes=[];
  let current=d;
  const editor=createRouteEditor({getStamp:()=>({}),commitControls:(r,c)=>{current=updateRouteControlPoints(current,r,c);writes.push(current);}});
  editor.select(route);
  const frame=route.sourcePoints.find(p=>!editor.controls.some(c=>c.frame===p.frame)).frame;
  await editor.insert(frame);assert.equal(writes.length,1);
  assert.equal(editor.controls[editor.selectedPoint].frame,frame);
  assert.ok(editor.controls.every((p,i)=>!i||p.frame>editor.controls[i-1].frame));
  await assert.rejects(editor.insert(frame),/帧/);await editor.remove();assert.equal(writes.length,2);
  editor.selectPoint(0);await assert.rejects(editor.remove(),/端点/);
  editor.selectPoint(editor.controls.length-1);await assert.rejects(editor.remove(),/端点/);
  assert.deepEqual(current.review,before);assert.deepEqual(restoreRoute(current,route.routeId),d);
});
test('stationary click and invalid points cause no persisted edit',async()=>{
  const {route}=await fixture(),calls=[];
  const editor=createRouteEditor({getStamp:()=>({}),commitControls:(...args)=>calls.push(args)});
  editor.select(route);editor.begin(0,1);await editor.end(1);assert.equal(calls.length,0);
  editor.begin(0,2);assert.equal(editor.move({x:Infinity,y:1},2),false);await editor.end(2);
  assert.equal(calls.length,0);editor.select(null);await assert.rejects(editor.insert(1),/选择/);
});
test('a rejected or outdated submission discards its local preview',async()=>{
  const {route}=await fixture();
  for(const rejection of [false,new Error('save failure')]){
    let preview;
    const editor=createRouteEditor({getStamp:()=>({}),commitControls:async()=>{if(rejection instanceof Error)throw rejection;return rejection;},onPreview:r=>preview=r});
    editor.select(route);editor.begin(0,1);editor.move({x:1,y:2},1);
    if(rejection===false)await editor.end(1);else await assert.rejects(editor.end(1),/save failure/);
    assert.deepEqual(editor.controls,route.controlPoints);assert.equal(preview,null);
  }
});
test('delayed validation cannot commit into a different document, phase, or revision',async()=>{
  for(const field of ['document','context','phaseId','revision']){
    let release,applied=0,stamp={document:{},context:1,phaseId:'p1',revision:1};
    const old={...stamp},validation=new Promise(r=>release=r);
    const pending=commitWhenCurrent({next:{},stamp:old,getStamp:()=>stamp,validate:()=>validation,apply:()=>applied++});
    stamp={...stamp,[field]:field==='phaseId'?'p2':field==='document'?{}:2};release();
    assert.equal(await pending,false);assert.equal(applied,0);
  }
  const stamp={context:1};let applied=0;
  assert.equal(await commitWhenCurrent({next:{},stamp,getStamp:()=>({...stamp}),validate:async()=>{},apply:()=>applied++}),true);
  assert.equal(applied,1);
});
test('SVG inverse CTM maps scaled and scrolled viewport into court metres',()=>{
  const svg={getScreenCTM:()=>({inverse:()=>({})}),createSVGPoint:()=>({x:0,y:0,matrixTransform(){return {x:(this.x-40)/20,y:(this.y+60)/20};}})};
  assert.deepEqual(screenToCourt(svg,{clientX:240,clientY:40},{space:'court'}),{x:10,y:5});
  assert.equal(screenToCourt(svg,{clientX:20,clientY:40},{space:'court'}),null);
  assert.equal(screenToCourt({...svg,getScreenCTM:()=>null},{clientX:240,clientY:40},{space:'court'}),null);
});
test('video inverse mapping uses the exact current frame and refuses absent calibration',async()=>{
  const {model}=await fixture();
  const svg={getScreenCTM:()=>({inverse:()=>({})}),createSVGPoint:()=>({matrixTransform(){return {x:this.x,y:this.y};}})};
  assert.equal(screenToCourt(svg,{clientX:100,clientY:200},{space:'video',model,frame:9999}),null);
});
