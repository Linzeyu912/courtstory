import test from 'node:test';
import assert from 'node:assert/strict';
import {tacticsNameLabels,renderTacticsNameSVG} from './tactics-name-overlay.mjs';
import {renderProductionSvg,compileProduction} from './tactics-production.mjs';
import {createAnnotation} from './tactics-annotations.mjs';
import {createTacticsDocument} from './tactics-document.mjs';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';

function fixture(){
  const source={videoSha256:'video',trackingFingerprint:'tracks',trackingRevision:'r1',width:1280,height:720};
  const document={review:{...source,entities:[{id:'P1',role:'player'},{id:'P2',role:'player'}]}};
  const nameOverlay={nameIdentitySource:source,nameDisplay:{enabled:true,showName:true,showJersey:true,showAnkleRing:false},
    playerNameIdentities:['P1','P2'].map((id,i)=>({id,observations:[{frame:4,trackId:i+1,x:200+i*200,y:300,
      nameIdentity:{name:i?'Candidate':'Confirmed',jersey:'0',trackId:i+1,start:3,end:5,identityVerified:!i,nameStatus:i?'machine_accepted':'human_confirmed'}}]}))};
  const annotationScene={items:[{type:'spotlight',entityId:'P1',video:{center:{x:200,y:300}},hiddenReason:null}]};
  return {document,nameOverlay,annotationScene,frame:4};
}
test('name switch and visible spotlights share the bounded label policy',()=>{
  const f=fixture();assert.equal(tacticsNameLabels(f).length,2);
  assert.deepEqual(tacticsNameLabels({...f,showNames:false}).map(row=>[row.id,row.label,row.forced]),[['P1','Confirmed · #0',true]]);
  f.nameOverlay.nameDisplay={enabled:false,showName:false,groups:{A:false},players:{P1:false}};
  assert.match(renderTacticsNameSVG(f),/Confirmed/);
  f.annotationScene.items[0].hiddenReason='outside_time';
  assert.equal(tacticsNameLabels(f).length,0);
});
test('name evidence never crosses its frame, T, source, or missing observation',()=>{
  for(const change of [f=>f.nameOverlay.playerNameIdentities[0].observations[0].nameIdentity.end=3,
    f=>f.nameOverlay.playerNameIdentities[0].observations[0].trackId=99,
    f=>f.nameOverlay.nameIdentitySource={...f.nameOverlay.nameIdentitySource,videoSha256:'another'},
    f=>f.nameOverlay.playerNameIdentities[0].observations[0].x=null]){
    const f=fixture();change(f);const rows=tacticsNameLabels({...f,showNames:false});
    assert.equal(rows.length,1);assert.equal(rows[0].label,'P1 · pending');
  }
});
test('duplicates are merged, unlinked marks do not force names, and text is escaped',()=>{
  const f=fixture();f.annotationScene.items.push({...f.annotationScene.items[0]});
  f.nameOverlay.playerNameIdentities[0].observations[0].nameIdentity.name='<script>&"';
  const svg=renderTacticsNameSVG({...f,showNames:false});
  assert.equal((svg.match(/data-player-name=/g)||[]).length,1);assert(!svg.includes('<script>'));assert(svg.includes('&lt;script&gt;'));
  f.annotationScene.items=f.annotationScene.items.map(row=>({...row,entityId:null}));
  assert.equal(tacticsNameLabels({...f,showNames:false}).length,0);
});
test('normal labels retain accepted-candidate status and explicit display filters',()=>{
  const f=fixture();assert.match(tacticsNameLabels(f)[1].label,/^P2 Candidate/);
  f.nameOverlay.nameDisplay.players={P2:false};assert.equal(tacticsNameLabels(f).length,1);
  f.nameOverlay.nameDisplay.players={};f.nameOverlay.playerNameIdentities[1].observations[0].nameIdentity.nameStatus='candidate';
  assert.match(tacticsNameLabels(f)[1].label,/Candidate\?/);
});
test('native production uses the same SVG policy with the global switch off',async()=>{
  let document=await createTacticsDocument((await makePresentationDemo()).review);
  const phase=document.playDefinition.phases[0],frame=phase.startFrame;
  document=createAnnotation(document,{id:'name-focus',type:'spotlight',phaseId:phase.phaseId,entityId:'P1',
    space:'video',points:[{x:300,y:300}],frame,startFrame:frame,endFrameExclusive:frame+1,followEntity:false});
  const source=Object.fromEntries(['videoSha256','trackingFingerprint','trackingRevision','width','height'].map(key=>[key,document.review[key]]));
  const nameOverlay={nameIdentitySource:source,nameDisplay:{enabled:false},playerNameIdentities:[{id:'P1',observations:[{
    frame,x:300,y:300,trackId:11,nameIdentity:{name:'Production Name',trackId:11,start:frame,end:frame,identityVerified:true}}]}]};
  const plan=compileProduction(document),state=plan.frames.find(row=>row.sourceFrame===frame);
  const svg=renderProductionSvg(document,state,{nameOverlay});assert.match(svg,/Production Name/);assert.match(svg,/data-forced-name="true"/);
});
