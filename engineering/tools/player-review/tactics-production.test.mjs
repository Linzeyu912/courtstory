import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createTacticsDocument,validateDocument,splitPhase} from './tactics-document.mjs';
import {createAnnotation,projectAnnotations,annotationStatus,updateAnnotation,annotationPresentation,hitTestAnnotation} from './tactics-annotations.mjs';
const api=await import('./tactics-production.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const geometry=await import('./tactics-authored-geometry.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const fixture=async()=>createTacticsDocument((await makePresentationDemo()).review);
const camera=d=>({id:'cam',phaseId:'phase-1',phaseSnapshot:geometry.productionPhaseSnapshot(d.playDefinition.phases[0]),approximate:true,groundQuad:[[0,0],[10,0],[10,10],[0,10]],keyframes:[{frame:0,quad:[[100,100],[1100,100],[1100,650],[100,650]],evidenceFrames:[0]},{frame:60,quad:[[120,100],[1120,100],[1120,650],[120,650]],evidenceFrames:[60]}]});
async function authored(){
  let d=await fixture();assert.equal(typeof api.updateProductionCamera,'function');d=api.updateProductionCamera(d,'cam',camera(d));
  return createAnnotation(d,{id:'bezier',type:'route',phaseId:'phase-1',frame:10,startFrame:10,endFrameExclusive:50,space:'video',points:[{x:250,y:500},{x:450,y:300},{x:650,y:300},{x:850,y:500}],authoredPath:{version:1,curve:'cubic_bezier',cameraId:'cam',cameraDigest:d.production.cameras[0].digest,progressFrames:[{frame:10,t:0},{frame:30,t:.5},{frame:50,t:1}],ribbon:geometry.DEFAULT_RIBBON}});
}
test('camera digest is stable SHA256, production stays separate from reviewed calibration',async()=>{
  const base=await fixture(),review=structuredClone(base.review),d=await authored();
  assert.deepEqual(d.review,review);await validateDocument(d);
  const c=d.production.cameras[0];assert.equal(c.digest,api.productionCameraDigest(c));
  assert.equal(geometry.sha256('abc'),createHash('sha256').update('abc').digest('hex'));
  assert.deepEqual(api.validateProduction(d),[]);
});
test('Bezier has four edit handles, fixed projected destination, shrinking tail and shared SVG',async()=>{
  const d=await authored(),a=projectAnnotations(d,{phaseId:'phase-1',frame:10}).items[0],b=projectAnnotations(d,{phaseId:'phase-1',frame:30}).items[0];
  assert.equal(a.handles.length,4);assert.ok(a.video.ribbon.length>30);assert.ok(b.video.ribbon.length<a.video.ribbon.length);
  const tipIndex=a.video.ribbon.findIndex(p=>p.x===a.video.tip.x&&p.y===a.video.tip.y),head=a.video.ribbon.slice(tipIndex-1,tipIndex+2),inside={x:head.reduce((s,p)=>s+p.x,0)/3,y:head.reduce((s,p)=>s+p.y,0)/3};
  assert.equal(hitTestAnnotation({items:[a]},inside,0)?.id,'bezier');
  assert.ok(Math.abs(b.video.tip.x-a.video.tip.x-20/3)<.01);
  assert.match(api.renderProductionSvg(d,{sourceFrame:30,sourceTime:3,state:'source',reveal:1,phaseId:'phase-1'}),/data-part="authored-ribbon"/);
  const bigger=updateAnnotation(d,'bezier',{style:{size:2}}),big=projectAnnotations(bigger,{phaseId:'phase-1',frame:10}).items[0];
  assert.equal(big.video.strokeWidth,a.video.strokeWidth*2);assert.notDeepEqual(big.video.ribbon,a.video.ribbon);
  assert.equal(annotationPresentation(d).items[0].mode,'timeline');
  assert.throws(()=>updateAnnotation(d,'bezier',{points:a.original.points.slice(0,3)}));
});
test('authored ribbons preserve the full fill with an outer edge composited at one opacity',async()=>{
  const d=await authored(),state={sourceFrame:10,sourceTime:1,state:'source',reveal:1,phaseId:'phase-1'},svg=api.renderProductionSvg(d,state);
  const g=projectAnnotations(d,{phaseId:'phase-1',frame:10}).items[0].video;
  assert.match(svg,new RegExp(`<g data-part="authored-ribbon" opacity="${g.opacity}">`));
  assert.match(svg,new RegExp(`fill="none" stroke="${g.edgeColor}" stroke-width="${2*g.strokeWidth}"/><polygon`));
  assert.match(svg,/fill="#19a9e1" stroke="none"\/><\/g>/);
});
test('lower output frame rate flushes late exact-frame cues in source order',async()=>{
  const {review}=await makePresentationDemo();review.sourceFrameMapping.forEach((f,i)=>{f.time=i/60;f.sourceTime=i/60;});
  let d=await createTacticsDocument(review);d=createAnnotation(d,{id:'last',type:'screen',phaseId:'phase-1',frame:60,space:'video',points:[{x:300,y:300}]});
  d=api.updateProductionCue(d,{phaseId:'phase-1',frame:60,settleFrames:5,drawFrames:0,holdFrames:40});
  const plan=api.compileProduction(d,{fps:24});assert.ok(plan.frames.some(f=>f.sourceFrame===60&&f.state==='hold'));
  assert.ok(plan.frames.every((f,i)=>!i||f.sourceFrame>=plan.frames[i-1].sourceFrame));
  assert.deepEqual(api.productionCue(d,{phaseId:'phase-1',frame:0}),{phaseId:'phase-1',frame:0,...api.DEFAULT_PRODUCTION_CUE});
});
test('camera edits stale dependent routes until explicit rebinding, progress and camera validation are strict',async()=>{
  const d=await authored(),keys=structuredClone(d.production.cameras[0].keyframes);keys[0].quad[0][0]+=5;
  const changed=api.updateProductionCamera(d,'cam',{keyframes:keys});assert.equal(annotationStatus(changed).stale[0].reason,'camera_changed');
  const rebound=api.updateProductionCamera(changed,'cam',{}, {rebindRoutes:true});assert.equal(annotationStatus(rebound).active.length,1);
  assert.throws(()=>api.updateAuthoredProgress(d,'bezier',[{frame:10,t:.5},{frame:50,t:.2}]));
  assert.throws(()=>api.updateProductionCamera(d,'cam',{keyframes:[{frame:0,quad:[[0,0],[1,1],[0,1],[1,0]],evidenceFrames:[0]}]}));
  assert.throws(()=>api.updateProductionCamera(d,'cam',{approximate:false}));
  assert.deepEqual(d.production.cameras[0].keyframes[0].quad[0],[100,100]);
  const short=api.updateProductionCamera(d,'cam',{keyframes:d.production.cameras[0].keyframes.slice(0,1)},{rebindRoutes:true});
  assert.equal(projectAnnotations(short,{phaseId:'phase-1',frame:10}).items[0].hiddenReason,'production_camera_unavailable');
  assert.throws(()=>api.compileProduction(short),/相机.*覆盖/);
  const stale=structuredClone(d);stale.production.sourceBinding.reviewDigest='0'.repeat(64);
  assert.equal(annotationStatus(stale).stale[0].reason,'production_source_changed');assert.throws(()=>api.compileProduction(stale),/来源/);
});
test('production compiler freezes source time, reveals before hold and keeps old annotations in exact-frame SVG',async()=>{
  let d=await authored();d=api.updateProductionCue(d,{phaseId:'phase-1',frame:10,settleFrames:5,drawFrames:21,holdFrames:49});
  d=createAnnotation(d,{id:'manual',type:'screen',phaseId:'phase-1',frame:10,space:'video',points:[{x:300,y:300}]});
  const plan=api.compileProduction(d,{fps:30}),holds=plan.frames.filter(f=>f.sourceFrame===10&&f.state!=='source');
  assert.equal(holds.length,75);assert.equal(holds[0].reveal,0);assert.equal(holds.at(-1).reveal,1);
  assert.equal(new Set(holds.map(f=>f.sourceTime)).size,1);assert.match(api.renderProductionSvg(d,holds.at(-1)),/data-annotation-id="manual"/);
  assert.deepEqual(api.sampleProduction(plan,plan.totalFrames-1),plan.frames.at(-1));assert.throws(()=>api.sampleProduction(plan,-1));
  const later=createAnnotation(d,{id:'later',type:'screen',phaseId:'phase-1',frame:20,space:'video',points:[{x:300,y:300}]});
  assert.ok(api.compileProduction(later).frames.some(f=>f.sourceFrame===20&&f.state==='hold'),'new static annotations retain a hold after explicit production exists');
});
test('a later cue reveals only its new route and preserves earlier remaining routes',async()=>{
  let d=await authored();
  const previous=d.annotations.items[0];
  d=createAnnotation(d,{id:'new-route',type:'route',phaseId:'phase-1',frame:20,startFrame:20,endFrameExclusive:50,space:'video',points:previous.points,
    authoredPath:{...structuredClone(previous.authoredPath),progressFrames:[{frame:20,t:0},{frame:50,t:1}]}});
  d=createAnnotation(d,{id:'new-marker',type:'screen',phaseId:'phase-1',frame:20,space:'video',points:[{x:300,y:300}]});
  d=api.updateProductionCue(d,{phaseId:'phase-1',frame:20,settleFrames:5,drawFrames:21,holdFrames:49});
  const state=api.compileProduction(d).frames.find(f=>f.sourceFrame===20&&f.state==='settle'),svg=api.renderProductionSvg(d,state);
  assert.match(svg,/data-annotation-id="bezier"/);assert.match(svg,/data-annotation-id="new-marker"/);assert.doesNotMatch(svg,/data-annotation-id="new-route"/);
  const full=projectAnnotations(d,{phaseId:'phase-1',frame:20,reveal:1}).items.find(a=>a.id==='bezier').video;
  for(const reveal of [0,.4,1])assert.deepEqual(projectAnnotations(d,{phaseId:'phase-1',frame:20,reveal}).items.find(a=>a.id==='bezier').video,full);
  assert.ok(projectAnnotations(d,{phaseId:'phase-1',frame:20,reveal:0,editing:true}).items.find(a=>a.id==='new-route').video);
});
test('legacy production imports source-locked ordinary annotations and compiles exactly 386 frames',async()=>{
  const {review}=await makePresentationDemo();review.sourceFrameMapping=Array.from({length:143},(_,frame)=>({frame,time:frame/30,sourceFrame:frame,sourceTime:frame/30}));review.entities=[];review.court.calibration.keyframes=[];
  const base=await createTacticsDocument(review);
  const old={schemaVersion:1,sourceSha256:review.videoSha256,width:1280,height:720,fps:30,camera:{groundQuad:[[0,0],[10,0],[10,10],[0,10]],keyframes:[{frame:0,quad:[[100,100],[1100,100],[1100,650],[100,650]]},{frame:142,quad:[[120,100],[1120,100],[1120,650],[120,650]]}]},
    style:{fillRgb:[25,193,235],edgeRgb:[9,52,68],bodyWidthMetres:.2,arrowLengthMetres:.67,arrowWidthMetres:.7,edgePixels:2.1,opacity:.94,fadeRemainingMetres:.55},timeline:{sourceFrames:143,freezeFrames:[15,40,90],insertedHoldFrames:75,endHoldFrames:18,freezeReveal:{settleFrames:5,drawFrames:21}},
    routes:[15,40,90].map((f,i)=>({id:`legacy-${i}`,phase:i+1,refFrame:f,visibleFromFrame:f,endFrame:[40,90,132][i],controlPoints:[[250,500],[450,300],[650,300],[850,500]],progressFrames:[[f,0],[[40,90,132][i],1]]}))};
  const d=await api.importAuthoredProduction(base,old);await validateDocument(d);
  assert.equal(d.annotations.items.length,3);assert.equal(d.production.routes,undefined);assert.deepEqual(d.review,base.review);
  const plan=api.compileProduction(d);assert.equal(plan.totalFrames,386);assert.equal(plan.frames[15].state,'settle');
  for(const f of [15,40,90])assert.equal(plan.frames.filter(x=>x.sourceFrame===f).length,76);
  assert.match(api.renderProductionSvg(d,plan.frames.find(x=>x.sourceFrame===40&&x.reveal===1)),/authored-ribbon/);
  await assert.rejects(api.importAuthoredProduction(base,{...old,sourceSha256:'0'.repeat(64)}),/来源/);
  const manual=splitPhase(base,'phase-1',70);await validateDocument(manual);
  await assert.rejects(api.importAuthoredProduction(manual,old),/已有人工/);
});
