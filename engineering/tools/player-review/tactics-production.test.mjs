import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {STUDIO_TEAM_ID} from './studio-team-id.mjs';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createTacticsDocument,validateDocument,splitPhase,refreshSnapshot} from './tactics-document.mjs';
import {createSourceBinding} from '../tactical-overlay/binding.mjs';
import {createAnnotation,projectAnnotations,annotationStatus,updateAnnotation,annotationPresentation,hitTestAnnotation} from './tactics-annotations.mjs';
import {nearestRouteProgress} from './tactics-manual-editor.mjs';
import {project} from './court.mjs';
const api=await import('./tactics-production.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const geometry=await import('./tactics-authored-geometry.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const fixture=async()=>createTacticsDocument((await makePresentationDemo()).review);

test('frontend team signature is always visible in production, including unrevealed and empty frames',async()=>{
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert.equal(html.match(/class="studio-team-number">([^<]+)/)[1],STUDIO_TEAM_ID);
  const document=await fixture();let previous;
  for(const state of ['source','settle','draw','hold']){
    const svg=api.renderProductionSvg(document,{sourceFrame:0,phaseId:'phase-1',state,reveal:state==='hold'?1:0});
    assert.equal((svg.match(/data-part="studio-team-id"/g)??[]).length,1);
    const mark=svg.slice(svg.indexOf('<g data-part="studio-team-id"'));
    assert.match(mark,/aria-label="TEAM 25"/);assert.match(mark,/fill="#1d428a"/);assert.match(mark,/fill="#ffffff"/);
    assert.doesNotMatch(mark,/<text|opacity=/);
    if(previous)assert.equal(mark,previous);previous=mark;
  }
});
test('native production exposes asset frame and review time without relabeling parent footage',async()=>{
  const document=await fixture(),plan=api.compileProduction(document),state=plan.frames[0];
  assert.equal(state.assetFrame,state.sourceFrame);
  assert.equal(state.reviewTimeSeconds,document.review.sourceFrameMapping[state.assetFrame].time);
});
test('an externally compiled joint snapshot renders through the native SVG path and rejects source drift',async()=>{
  const document=await fixture(),plan=api.compileProduction(document);
  assert.equal(typeof api.validateProductionSnapshot,'function');
  assert.equal(api.validateProductionSnapshot(document,plan),plan);
  const changed=structuredClone(plan);changed.frames[0].sourceFrame=99999;
  assert.throws(()=>api.validateProductionSnapshot(document,changed),/成片/);
  changed.frames[0]=structuredClone(plan.frames[0]);changed.frames[0].phaseId='wrong-phase';
  assert.throws(()=>api.validateProductionSnapshot(document,changed),/成片/);
});
const camera=d=>({id:'cam',phaseId:'phase-1',phaseSnapshot:geometry.productionPhaseSnapshot(d.playDefinition.phases[0]),approximate:true,groundQuad:[[0,0],[10,0],[10,10],[0,10]],keyframes:[{frame:0,quad:[[100,100],[1100,100],[1100,650],[100,650]],evidenceFrames:[0]},{frame:60,quad:[[120,100],[1120,100],[1120,650],[120,650]],evidenceFrames:[60]}]});
async function authored(){
  let d=await fixture();assert.equal(typeof api.updateProductionCamera,'function');d=api.updateProductionCamera(d,'cam',camera(d));
  return createAnnotation(d,{id:'bezier',type:'route',phaseId:'phase-1',frame:10,startFrame:10,endFrameExclusive:50,space:'video',points:[{x:250,y:500},{x:450,y:300},{x:650,y:300},{x:850,y:500}],authoredPath:{version:1,curve:'cubic_bezier',cameraId:'cam',cameraDigest:d.production.cameras[0].digest,progressFrames:[{frame:10,t:0},{frame:30,t:.5},{frame:50,t:1}],ribbon:geometry.DEFAULT_RIBBON}});
}
test('click correction for legacy authored paths preserves Bezier parameter under perspective and moving cameras',async()=>{
  let d=await authored();const keys=structuredClone(d.production.cameras[0].keyframes);keys[0].quad=[[100,100],[1100,100],[900,650],[300,650]];keys[1].quad=[[130,100],[1130,100],[930,650],[330,650]];
  d=api.updateProductionCamera(d,'cam',{keyframes:keys},{rebindRoutes:true});const a=d.annotations.items[0],ref=geometry.productionCameraAt(d.production.cameras[0],10),now=geometry.productionCameraAt(d.production.cameras[0],30);
  const controls=a.points.map(p=>project(ref.toGround,p.x,p.y)),ground=geometry.cubicBezier(controls,.65),image=project(now.toImage,ground.x,ground.y);
  const found=nearestRouteProgress(d,a,image,{frame:30});assert.ok(found.distance<.01);assert.ok(Math.abs(found.progress-.65)<.0001);
});
test('explicit same-video production recovery rebinds independent routes without changing review, geometry or ordinary court graphics',async()=>{
  const original=await authored(),review=structuredClone(original.review);review.exportCompatibility='new-review-shape';
  const stale=await refreshSnapshot(original,review),before=structuredClone(stale);
  assert.equal(typeof api.rebindIndependentProduction,'function');
  assert.ok(annotationStatus(stale).stale.some(a=>a.id==='bezier'));
  const restored=await api.rebindIndependentProduction(stale);
  assert.deepEqual(restored.review,review);assert.deepEqual(stale,before);assert.deepEqual(restored.production.cameras,original.production.cameras);
  assert.deepEqual(restored.annotations.items[0].points,original.annotations.items[0].points);
  assert.deepEqual(restored.annotations.items[0].authoredPath,original.annotations.items[0].authoredPath);
  assert.equal(annotationStatus(restored).active.find(a=>a.id==='bezier').id,'bezier');assert.ok(api.compileProduction(restored).totalFrames>0);await validateDocument(restored);
  const withCourt=createAnnotation(original,{id:'court-mark',type:'screen',phaseId:'phase-1',frame:10,space:'court',points:[{x:10,y:5}]}),courtStale=await refreshSnapshot(withCourt,review),courtRestored=await api.rebindIndependentProduction(courtStale);
  assert.deepEqual(courtRestored.annotations.items.find(a=>a.id==='court-mark'),courtStale.annotations.items.find(a=>a.id==='court-mark'));
  assert.ok(annotationStatus(courtRestored).stale.some(a=>a.id==='court-mark'));
});
test('production recovery refuses different media, changed stages, camera support and cuts; legacy proof must match the old binding',async()=>{
  const original=await authored(),review=structuredClone(original.review);review.exportCompatibility='new';
  const stale=await refreshSnapshot(original,review);
  for(const mutate of [d=>d.review.videoSha256='0'.repeat(64),d=>d.review.sourceVideoSha256='0'.repeat(64),d=>d.review.width++,d=>d.review.height++,d=>d.review.sourceFrameMapping[20].time+=.001,d=>d.playDefinition.phases[0].freezeFrame=1,d=>d.review.settings.cuts.push(25)]){
    const changed=structuredClone(stale);mutate(changed);changed.playDefinition.sourceBinding=await createSourceBinding(changed.review);
    await assert.rejects(api.rebindIndependentProduction(changed));
  }
  const short=structuredClone(stale);short.production.cameras[0].keyframes=short.production.cameras[0].keyframes.slice(0,1);short.production.cameras[0].digest=api.productionCameraDigest(short.production.cameras[0]);short.annotations.items[0].authoredPath.cameraDigest=short.production.cameras[0].digest;
  await assert.rejects(api.rebindIndependentProduction(short),/相机/);
  const legacy=structuredClone(stale);delete legacy.production.mediaBinding;
  await assert.rejects(api.rebindIndependentProduction(legacy),/原.*来源|凭据/);
  await assert.rejects(api.rebindIndependentProduction(legacy,{referenceDocument:stale}),/来源|凭据/);
  const restored=await api.rebindIndependentProduction(legacy,{referenceDocument:original});assert.equal(annotationStatus(restored).active.length,1);
});
test('refresh captures legacy media proof before replacing review and never recovers player-linked authored routes',async()=>{
  let d=await authored();delete d.production.mediaBinding;
  const route=d.annotations.items[0];d=createAnnotation(d,{id:'player-route',type:'route',phaseId:route.phaseId,frame:route.anchorFrame,startFrame:route.startFrame,endFrameExclusive:route.endFrameExclusive,space:'video',entityId:'P1',points:route.points,authoredPath:route.authoredPath});
  const review=structuredClone(d.review);review.exportCompatibility='new';
  const stale=await refreshSnapshot(d,review),before=structuredClone(stale);
  assert.equal(stale.production.mediaBinding.width,d.review.width);assert.equal(annotationStatus(stale).stale.length,2);
  const restored=await api.rebindIndependentProduction(stale);
  assert.deepEqual(stale,before);assert.ok(annotationStatus(restored).active.some(a=>a.id==='bezier'));
  assert.deepEqual(restored.annotations.items[1],stale.annotations.items[1]);assert.ok(annotationStatus(restored).stale.some(a=>a.id==='player-route'));
  const lost=structuredClone(stale);delete lost.production.mediaBinding;
  const rerefreshed=await refreshSnapshot(lost,review);assert.equal(rerefreshed.production.mediaBinding,undefined,'new review cannot establish old dimensions');
});
test('explicit recovery still works after a stale independent route camera is manually adjusted',async()=>{
  const original=await authored(),review=structuredClone(original.review);review.exportCompatibility='new';
  const stale=await refreshSnapshot(original,review),keyframes=structuredClone(stale.production.cameras[0].keyframes);keyframes[0].quad[0][0]+=5;
  const edited=api.updateProductionCamera(stale,'cam',{keyframes},{rebindRoutes:true});
  assert.deepEqual(edited.production.sourceBinding,stale.production.sourceBinding,'camera edits cannot silently replace the original source proof');
  assert.equal(annotationStatus(edited).stale.length,1);
  const restored=await api.rebindIndependentProduction(edited);
  assert.equal(annotationStatus(restored).active.length,1);assert.deepEqual(restored.production.cameras,edited.production.cameras);assert.ok(api.compileProduction(restored).totalFrames>0);
  const foreign=structuredClone(edited);foreign.annotations.items[0].sourceBinding.videoSha256='0'.repeat(64);
  await assert.rejects(api.rebindIndependentProduction(foreign),/来源/);
});
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
test('authored ribbons retain their geometry and configured edge with the shared luminous paint',async()=>{
  const d=await authored(),state={sourceFrame:10,sourceTime:1,state:'source',reveal:1,phaseId:'phase-1'},svg=api.renderProductionSvg(d,state);
  const g=projectAnnotations(d,{phaseId:'phase-1',frame:10}).items[0].video;
  assert.match(svg,new RegExp(`<g data-part="authored-ribbon" opacity="${g.opacity}">`));
  assert.match(svg,new RegExp(`fill="none" stroke="${g.edgeColor}" stroke-width="${g.strokeWidth}" stroke-opacity=".18"`));
  assert.match(svg,/<linearGradient/);assert.match(svg,/<feGaussianBlur/);
  assert.deepEqual(projectAnnotations(d,{phaseId:'phase-1',frame:10}).items[0].video,g);
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
