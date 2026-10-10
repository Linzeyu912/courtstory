import test from 'node:test';
import assert from 'node:assert/strict';
import {trackedRoutePoints,annotationReveal,canFollowAnnotation,simplifyTrackedRoute} from './tactics-motion.mjs';
import {explanationTiming} from './tactics-keyframes.mjs';
import {sampleAnnotationCurve,createAnnotation,projectAnnotations,renderAnnotationsSVG,updateAnnotation} from './tactics-annotations.mjs';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';

const length=points=>points.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
test('curved routes reveal by length, with their head moving along the curve',()=>{
  for(const curve of ['polyline','cubic_bezier']){
    const a={curve,points:[{x:0,y:0},{x:40,y:90},{x:110,y:90},{x:160,y:0}]};
    const full=sampleAnnotationCurve(a),half=sampleAnnotationCurve(a,.5);
    assert.deepEqual(sampleAnnotationCurve(a,0),[]);
    assert.deepEqual(half[0],full[0]);
    assert.ok(Math.abs(length(half)/length(full)-.5)<1e-6);
    assert.ok(half.at(-1).y>40);assert.ok(half.at(-1).x<160);
  }
});

const context=()=>{
  const frames=Array.from({length:10},(_,frame)=>({frame,time:frame*.1}));
  // Player walks +2 px / frame on the floor while the camera pans +10 px / frame.
  const points=frames.map(({frame})=>({frame,x:100+12*frame,y:200,trackId:1}));
  const maps=frames.map(({frame})=>({toCourt:[1,0,-10*frame,0,1,0,0,0,1],toImage:[1,0,10*frame,0,1,0,0,0,1]}));
  return {frames,maps,cuts:[],pointMaps:new Map([['P1',new Map(points.map(p=>[p.frame,p]))]])};
};
const foot=(c,id,f)=>{const p=c.pointMaps.get(id)?.get(f);return p?{point:{x:p.x,y:p.y}}:{reason:'missing_position'};};
const route={entityId:'P1',space:'video',anchorFrame:0,startFrame:0,endFrameExclusive:10};
test('tracked route follows the current foot and projects its remaining destination into the current camera',()=>{
  const c=context(),a=trackedRoutePoints(c,route,3,foot),b=trackedRoutePoints(c,route,6,foot);
  assert.equal(a.trackingSpace,'court');
  assert.deepEqual(a.points[0],{x:136,y:200});assert.deepEqual(a.points.at(-1),{x:148,y:200});
  assert.deepEqual(b.points[0],{x:172,y:200});assert.deepEqual(b.points.at(-1),{x:178,y:200});
  assert.deepEqual(trackedRoutePoints(c,route,3,foot),a); // seeking is deterministic
});
test('tracked routes stop at gaps, identity switches and camera cuts; missing calibration has an explicit image fallback',()=>{
  let c=context();c.pointMaps.get('P1').delete(5);
  assert.deepEqual(trackedRoutePoints(c,route,3,foot).points.at(-1),{x:138,y:200});
  assert.equal(trackedRoutePoints(c,route,5,foot).reason,'missing_position');
  c=context();c.pointMaps.get('P1').get(5).trackId=2;
  assert.deepEqual(trackedRoutePoints(c,route,3,foot).points.at(-1),{x:138,y:200});
  c=context();c.cuts=[4];assert.equal(trackedRoutePoints(c,route,6,foot).reason,'source_cut');
  c=context();c.maps=[];assert.equal(trackedRoutePoints(c,route,3,foot).trackingSpace,'video');
  assert.equal(trackedRoutePoints(c,{...route,space:'court'},3,foot).reason,'calibration_unavailable');
});
test('screen sequence shows the marker, handler route and then screener route',()=>{
  const screen={type:'screen',entityId:'P2',anchorFrame:12},handler={type:'route',entityId:'P1',anchorFrame:12},roller={...handler,entityId:'P2'};
  const all=[screen,handler,roller];
  assert.ok(annotationReveal(screen,all,.25)>0);assert.equal(annotationReveal(handler,all,.25),0);
  assert.ok(annotationReveal(handler,all,.5)>0);assert.equal(annotationReveal(roller,all,.5),0);
  assert.ok(annotationReveal(roller,all,.8)>0);assert.equal(annotationReveal(roller,all,1),1);
  const timing=explanationTiming(2.5,30,{staged:true});
  assert.equal(timing.drawFrames,36);assert.equal(timing.settleFrames+timing.drawFrames+timing.holdFrames,75);
});
test('route denoising removes detector ripples while preserving endpoints and a real turn',()=>{
  const points=Array.from({length:10},(_,i)=>({x:i*10,y:i%2?1:-1}));
  const before=structuredClone(points),line=simplifyTrackedRoute(points,3);
  assert.equal(line.length,2);assert.deepEqual(line[0],points[0]);assert.deepEqual(line.at(-1),points.at(-1));
  assert.deepEqual(points,before);
  const bend=simplifyTrackedRoute([{x:0,y:0},{x:20,y:0},{x:40,y:0},{x:40,y:20},{x:40,y:40}],3);
  assert.ok(bend.length>=3);
});
test('calibrated foot rings and screens preserve reveal and follow the real foot, with no position cross',async()=>{
  let doc={schemaVersion:1,title:'Motion',notes:'',...await makePresentationDemo()};
  for(const type of ['position','screen'])doc=createAnnotation(doc,{id:type,type,entityId:'P1',phaseId:'setup',frame:12,space:'video',points:[{x:20,y:20}],followEntity:true,anchorMode:'player_foot'});
  const scene=projectAnnotations(doc,{phaseId:'setup',frame:12,freeze:true,reveal:0});
  assert.ok(scene.items.every(i=>i.video.opacity===0));
  const next=projectAnnotations(doc,{phaseId:'setup',frame:19});
  const p=doc.review.entities[0].trajectory[19];assert.deepEqual(next.items[0].video.center,{x:p.x,y:p.y});
  assert.equal(next.items[0].video.paths,undefined);assert.equal(next.items[0].video.ring.length,49);
  assert.match(renderAnnotationsSVG(next),/position-ring/);
});
test('agent binding requires a matching observed foot and motion; editing an auto route relinquishes tracking',async()=>{
  let doc={schemaVersion:1,title:'Motion',notes:'',...await makePresentationDemo()};
  const p=doc.review.entities[0].trajectory[12],a={...route,type:'route',anchorFrame:12,points:[{x:p.x,y:p.y},{x:p.x+50,y:p.y-50}],startFrame:12,endFrameExclusive:29};
  assert.equal(canFollowAnnotation(doc.review,a),true);
  assert.equal(canFollowAnnotation(doc.review,{...a,points:[{x:1,y:1},a.points[1]]}),false);
  const q=doc.review.entities[1].trajectory[12];assert.equal(canFollowAnnotation(doc.review,{...a,entityId:'P2',points:[q,a.points[1]]}),false);
  doc=createAnnotation(doc,{...a,id:'auto',phaseId:'setup',frame:12,followEntity:true});
  doc=updateAnnotation(doc,'auto',{points:[{x:p.x,y:p.y},{x:900,y:350}]});assert.equal(doc.annotations.items[0].followEntity,false);
});
