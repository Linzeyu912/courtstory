import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {createTacticsDocument,validateDocument} from './tactics-document.mjs';
import {createAnnotation,removeAnnotation,updateAnnotation,projectAnnotations,renderAnnotationsSVG} from './tactics-annotations.mjs';
import {upsertTacticKeyframe} from './tactics-keyframes.mjs';
import {compileProduction,renderProductionSvg} from './tactics-production.mjs';
import {renderStudioTeamId} from './studio-team-id.mjs';

const api=await import('./shot-feedback.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const ref={planId:'shot-plan',revision:1,digest:'d'.repeat(64)};
async function fixture(){
  let document=await createTacticsDocument((await makePresentationDemo()).review);
  document=createAnnotation(document,{id:'shot-focus',type:'spotlight',phaseId:'phase-1',frame:20,startFrame:20,endFrameExclusive:21,space:'video',points:[{x:600,y:400}],
    origin:{kind:'agent',jobId:'shot-job',sourceFrames:[20],note:'release spotlight'}});
  document=upsertTacticKeyframe(document,{id:'release',frame:20,annotationIds:['shot-focus'],freeze:true,holdSeconds:2.5});
  document.agentRuns=[{jobId:'shot-job',commentaryPlanRef:structuredClone(ref),nodeIds:['shot-node'],annotationNodeRefs:{'shot-focus':'shot-node'},
    shotParticipantSnapshot:[{participantId:'shooter',entityId:null}]}];
  document.shotFeedback={schemaVersion:1,items:[{id:'shot-hud',nodeId:'shot-node',eventId:'shot-event',frame:20,spotlightAnnotationId:'shot-focus',shooterRef:'shooter',
    opportunity:{grade:'fair',reason:'contested shot'},pressure:{grade:'low',reason:'late closeout'},commentaryPlanRef:structuredClone(ref)}]};
  return document;
}
const frozen=(document,frame=20)=>projectAnnotations(document,{phaseId:'phase-1',frame,freeze:true});

test('shot HUD uses the shared SVG only at the exact release freeze and keeps native spotlight',async()=>{
  const document=await fixture(),svg=renderAnnotationsSVG(frozen(document));
  assert.match(svg,/data-part="shot-feedback"/);assert.match(svg,/投篮机会/);assert.match(svg,/防守压力/);
  assert.match(svg,/data-opportunity-grade="fair"/);assert.match(svg,/data-pressure-grade="low"/);
  assert.match(svg,/data-part="spotlight"/);
  assert.doesNotMatch(renderAnnotationsSVG(projectAnnotations(document,{phaseId:'phase-1',frame:20})),/shot-feedback/);
  assert.doesNotMatch(renderAnnotationsSVG(frozen(document,19)),/shot-feedback/);
  assert.doesNotMatch(renderAnnotationsSVG(frozen(document),{space:'court'}),/shot-feedback/);
});

test('HUD v4 size and position match the approved 1600px reference and each row has its own color',async()=>{
  assert.equal(typeof api.renderShotFeedbackSVG,'function');
  const scene=frozen(await fixture());scene.width=1600;scene.height=900;
  const svg=api.renderShotFeedbackSVG(scene);
  assert.match(svg,/translate\(544(?:\.0+)?,45(?:\.0+)?\)/);
  assert.match(svg,/data-part="shot-feedback-box"[^>]*width="302\.4"[^>]*height="103\.2"/);
  assert.match(svg,/data-metric="opportunity"[^>]*data-color="#ffe052"/);
  assert.match(svg,/data-metric="pressure"[^>]*data-color="#75d9a4"/);
  for(const [opportunity,pressure] of [['good','high'],['poor','medium'],['unknown','unknown']]){
    const document=await fixture();document.shotFeedback.items[0].opportunity.grade=opportunity;document.shotFeedback.items[0].pressure.grade=pressure;
    const result=renderAnnotationsSVG(frozen(document));
    assert.match(result,new RegExp(`data-opportunity-grade="${opportunity}"`));assert.match(result,new RegExp(`data-pressure-grade="${pressure}"`));
    if(opportunity==='unknown')assert.match(result,/data-color="#a9b6c0"/);
  }
});

test('structural validation rejects unsupported grades and extra geometry but accepts old documents',async()=>{
  const legacy=await createTacticsDocument((await makePresentationDemo()).review);await validateDocument(legacy);
  for(const change of [d=>d.shotFeedback.items[0].opportunity.grade='excellent',d=>d.shotFeedback.items[0].points=[{x:1,y:2}],d=>d.shotFeedback.items[0].commentaryPlanRef.revision=-1]){
    const document=await fixture();change(document);
    await assert.rejects(()=>validateDocument(document),/投篮反馈/);
  }
});

test('deleting or moving the linked spotlight preserves editable draft but hides invalid HUD and blocks export',async()=>{
  const original=await fixture();
  const moved=updateAnnotation(original,'shot-focus',{frame:22,startFrame:22,endFrameExclusive:23});moved.tacticKeyframes.items[0].frame=22;
  for(const document of [removeAnnotation(original,'shot-focus'),moved]){
    await validateDocument(document);
    assert.doesNotMatch(renderAnnotationsSVG(frozen(document)),/shot-feedback/);
    assert.throws(()=>compileProduction(document),/投篮反馈/);
  }
  const spatialEdit=updateAnnotation(original,'shot-focus',{points:[{x:610,y:410}]});await validateDocument(spatialEdit);
  assert.match(renderAnnotationsSVG(frozen(spatialEdit)),/shot-feedback/);
});

test('a manually placed spotlight keeps its explicit evaluation reference without requiring an Agent run',async()=>{
  const document=await fixture();delete document.annotations.items[0].origin;delete document.agentRuns;
  await validateDocument(document);
  assert.match(renderAnnotationsSVG(frozen(document)),/shot-feedback/);
  assert.ok(compileProduction(document).frames.length>0);
});

test('stale drawing plan linkage or node linkage does not render shot HUD',async()=>{
  for(const change of [d=>d.agentRuns[0].commentaryPlanRef={...ref,revision:2},d=>d.agentRuns[0].annotationNodeRefs['shot-focus']='different-node']){
    const document=await fixture();change(document);
    await validateDocument(document);
    assert.doesNotMatch(renderAnnotationsSVG(frozen(document)),/shot-feedback/);
    assert.throws(()=>compileProduction(document),/投篮反馈/);
  }
});

test('rebinding the release spotlight to another player hides HUD and blocks export while position edits remain valid',async()=>{
  let named=await fixture();named=updateAnnotation(named,'shot-focus',{entityId:'P1'});
  named.agentRuns[0].shotParticipantSnapshot[0].entityId='P1';
  assert.equal(api.shotFeedbackStatus(named).active.length,1);
  assert.ok(compileProduction(named).frames.length>0);
  for(const entityId of ['P2',null]){
    const changed=updateAnnotation(named,'shot-focus',{entityId});await validateDocument(changed);
    assert.equal(api.shotFeedbackStatus(changed).active.length,0);
    assert.doesNotMatch(renderAnnotationsSVG(frozen(changed)),/shot-feedback/);
    assert.throws(()=>compileProduction(changed),/投篮反馈/);
  }
  const moved=updateAnnotation(named,'shot-focus',{points:[{x:620,y:420}]});await validateDocument(moved);
  assert.match(renderAnnotationsSVG(frozen(moved)),/shot-feedback/);
  assert.ok(compileProduction(moved).frames.length>0);
});

test('anonymous shooter cannot silently gain an entity binding or lose its saved participant reference',async()=>{
  for(const change of [d=>updateAnnotation(d,'shot-focus',{entityId:'P2'}),d=>{delete d.agentRuns[0].shotParticipantSnapshot;return d;},
    d=>{d.agentRuns[0].shotParticipantSnapshot[0].participantId='someone-else';return d;}]){
    const document=change(await fixture());await validateDocument(document);
    assert.equal(api.shotFeedbackStatus(document).active.length,0);
    assert.doesNotMatch(renderAnnotationsSVG(frozen(document)),/shot-feedback/);
    assert.throws(()=>compileProduction(document),/投篮反馈/);
  }
  const manual=await fixture();delete manual.annotations.items[0].origin;delete manual.agentRuns;
  const rebound=updateAnnotation(manual,'shot-focus',{entityId:'P2'});await validateDocument(rebound);
  assert.throws(()=>compileProduction(rebound),/投篮反馈/);
});

test('formal production renders the same HUD SVG and enforces one at least 2.5s release pause',async()=>{
  const document=await fixture(),production=compileProduction(document,{fps:30});
  const release=production.frames.filter(f=>f.sourceFrame===20&&f.state!=='source');
  assert.equal(release.length,75);
  const expected=renderAnnotationsSVG(frozen(document)).replace('</svg>',`${renderStudioTeamId(document.review.width,document.review.height)}</svg>`);
  assert.equal(renderProductionSvg(document,release.at(-1)),expected);
  document.tacticKeyframes.items.find(k=>k.id==='release').holdSeconds=1;
  assert.throws(()=>compileProduction(document),/投篮反馈/);
});
