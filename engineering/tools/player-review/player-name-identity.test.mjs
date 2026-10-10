import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPlayerNameIdentities,nameIdentityAt} from './player-name-identity.mjs';
import {mountPlayerNameUI} from './player-name-ui.mjs';
import {identityAt} from './identity-timeline.mjs';
import {buildTrajectories,confirmFrameIdentity} from './trajectory.mjs';
import fs from 'node:fs';

const clip=()=>({video_sha256:'video',tracking_fingerprint:'tracks',tracking_revision:'r1',sourceCuts:[],frames:[
  {tracks:[[0,0,10,20,7],[20,0,30,20,8]]},
  {tracks:[[1,0,11,20,7],[21,0,31,20,8]]},
  {tracks:[[2,0,12,20,9],[22,0,32,20,8]]},
]});
const session=()=>({videoHash:'video',cuts:[],entities:[
  {id:'P1',role:'player',identityKeyframes:[{frame:0,kind:'track',trackId:7,order:1}],anchors:[]},
  {id:'P2',role:'player',identityKeyframes:[{frame:0,kind:'track',trackId:8,order:2}],anchors:[]},
]});
const result=(candidates)=>({purpose:'player_names',jobId:'job1',sourceKey:'source1',base:{videoHash:'video',trackingFingerprint:'tracks',trackingRevision:'r1'},
  candidate:{verified:false,reviewRequired:true,candidates}});
const item=(entityId,trackId,start,end,name,jersey,evidenceFrame=start)=>({entityId,status:'candidate',nameCandidate:{name,player_id:`id-${jersey}`,namespace:'2k-season-roster',season:'2025',team:'BOS',jersey,lookupStatus:'unique_candidate'},
  playerId:`id-${jersey}`,season:'2025',team:'BOS',jersey,trackId,start,end,evidence:[{frame:evidenceFrame,trackId,box:[0,0,1,1],source:'observed'}],method:'ocr_and_roster',reason:'号码证据'});

test('applies finite intervals and keeps jersey 0 distinct from 00',()=>{
  const original=session(),before=structuredClone(clip()),c=clip();
  const applied=applyPlayerNameIdentities(original,result([item('P1',7,0,1,'Player Zero','0'),item('P2',8,0,1,'Player Double Zero','00')]),c);
  assert.equal(applied.report.applied,2);
  assert.deepEqual(applied.session.entities[0].machineNameIdentities[0].jersey,'0');
  assert.deepEqual(applied.session.entities[1].machineNameIdentities[0].jersey,'00');
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[0],{frame:1,trackId:7},c).name,'Player Zero');
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[0],{frame:2,trackId:9},c),null);
  assert.deepEqual(c,before,'applying names leaves frame boxes and tracks untouched');
});

test('preserves confirmed profiles and manual names',()=>{
  const s=session();s.entities[0].playerProfile={status:'confirmed',name:'Manual Profile',evidence:{videoSha256:'video'}};
  s.entities[1].name='Blue 00';s.entities[1].nameIdentity={source:'manual',name:'Manual Edit'};
  const applied=applyPlayerNameIdentities(s,result([item('P1',7,0,1,'Machine A','0'),item('P2',8,0,1,'Machine B','00')]),clip());
  assert.equal(applied.report.applied,0);assert.equal(applied.session.entities[0].playerProfile.name,'Manual Profile');
  assert.equal(applied.session.entities[1].name,'Blue 00');assert.equal(applied.session.entities[1].nameIdentity.name,'Manual Edit');
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[0],{frame:0,trackId:7},clip()).name,'Manual Profile');
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[1],{frame:0,trackId:8},clip()).name,'Manual Edit');
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[1],{frame:0,trackId:8},
    {...clip(),video_sha256:'another-video'}),null,'manual names do not leak into a different video');
});

test('confirmed roster jersey and team take precedence over an old slot label',()=>{
  const s=session(),c=clip();s.entities[0].jersey='0';s.entities[0].team='white';
  s.entities[0].playerProfile={status:'confirmed',name:'Roster Player',jersey_number:'00',team_abbreviation:'DAL',evidence:{videoSha256:'video'}};
  const identity=nameIdentityAt(s,s.entities[0],{frame:0,trackId:7},c);
  assert.equal(identity.jersey,'00');assert.equal(identity.team,'DAL');
});

test('legacy labels do not block names, old profiles are video-bound, human names outrank machine duplicates',()=>{
  const s=session(),c=clip();s.entities[0].name='白1号';
  s.entities[1].playerProfile={status:'confirmed',name:'Old Profile',evidence:{videoSha256:'another-video'}};
  const applied=applyPlayerNameIdentities(s,result([item('P1',7,0,1,'Shared Name','0'),item('P2',8,0,1,'Candidate','00')]),c);
  assert.equal(applied.report.applied,2,'legacy labels and profiles from another video do not block this video');
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[0],{frame:0,trackId:7},c)?.name,'Shared Name');
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[1],{frame:0,trackId:8},c)?.name,'Candidate');
  applied.session.entities[1].playerProfile={status:'confirmed',name:'Shared Name',evidence:{videoSha256:'video'}};
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[0],{frame:0,trackId:7},c),null);
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[1],{frame:0,trackId:8},c).name,'Shared Name');
  applied.session.entities[0].nameIdentity={source:'manual',name:'Shared Name'};
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[0],{frame:0,trackId:7},c),null);
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[1],{frame:0,trackId:8},c),null);
});

test('machine identity records are rejected on another video or tracking version',()=>{
  const c=clip(),s=session(),applied=applyPlayerNameIdentities(s,result([item('P1',7,0,1,'Bound Name','0')]),c).session;
  assert.equal(nameIdentityAt(applied,applied.entities[0],{frame:0,trackId:7},{...clip(),video_sha256:'other-video'}),null);
  assert.equal(nameIdentityAt(applied,applied.entities[0],{frame:0,trackId:7},{...clip(),tracking_revision:'r2'}),null);
});

test('old source binding, unsupported evidence, and same-frame conflicts stay unknown',()=>{
  const s=session(),c=clip();
  assert.throws(()=>applyPlayerNameIdentities(s,{...result([item('P1',7,0,1,'Old','0')]),base:{videoHash:'video',trackingFingerprint:'old',trackingRevision:'r1'}},c),/版本不符/);
  const conflict=applyPlayerNameIdentities(s,result([item('P1',7,0,1,'Duplicate','0'),item('P2',8,0,1,'Duplicate','00')]),c);
  assert.equal(conflict.report.conflicts,2);assert.equal(nameIdentityAt(conflict.session,conflict.session.entities[0],{frame:0,trackId:7},c),null);
  const noEvidence=item('P1',7,0,1,'No Evidence','0',2);
  assert.equal(applyPlayerNameIdentities(s,result([noEvidence]),c).report.applied,0);
});

test('different-segment identity conflict preserves clear names and flags only the ambiguous profile',()=>{
  const c=clip(),s=session();
  c.frames[0].tracks.push([40,0,50,20,11]);c.frames[1].tracks.push([41,0,51,20,11]);
  s.entities[0].nameIdentity={source:'manual',name:'Manual Keeper'};
  s.entities.push({id:'P5',role:'player',identityKeyframes:[{frame:0,kind:'track',trackId:11,order:3}],anchors:[]});
  const p2First=item('P2',8,0,1,'Jabari Smith Jr.','10'),p2Second=item('P2',9,2,2,'Kevin Durant','7',2),p5=item('P5',11,0,1,'Kevin Durant','7');
  const response=result([p2First,p2Second,p5]);response.candidate.issues=[{entityId:'P2',kind:'identity_conflict',
    reason:'同一 P 的不同有限片段号码不一致，请复核。',segments:[{trackId:8,start:0,end:1,jersey:'10'},{trackId:9,start:2,end:2,jersey:'7'}]}];
  const applied=applyPlayerNameIdentities(s,response,c);
  assert.equal(applied.report.applied,3);assert.equal(applied.report.skipped,0);assert.equal(applied.report.conflicts,0);
  assert.deepEqual(applied.report.identityConflictEntities,['P2']);
  assert.equal(applied.session.entities.find(entity=>entity.id==='P2').machineNameIdentities.length,2);
  assert.equal(applied.session.entities.find(entity=>entity.id==='P2').machinePlayerProfile.status,'ambiguous');
  assert.equal(applied.session.entities.find(entity=>entity.id==='P2').machineNameIdentityConflicts.length,1);
  assert.equal(nameIdentityAt(applied.session,applied.session.entities.find(entity=>entity.id==='P2'),{frame:0,trackId:8},c).name,'Jabari Smith Jr.');
  assert.equal(nameIdentityAt(applied.session,applied.session.entities.find(entity=>entity.id==='P2'),{frame:2,trackId:9},c),null);
  assert.equal(nameIdentityAt(applied.session,applied.session.entities.find(entity=>entity.id==='P5'),{frame:0,trackId:11},c).name,'Kevin Durant');
  assert.equal(nameIdentityAt(applied.session,applied.session.entities.find(entity=>entity.id==='P1'),{frame:0,trackId:7},c).name,'Manual Keeper');

  const makeNode=()=>({children:[],value:'',checked:false,append(...items){this.children.push(...items);},replaceChildren(...items){this.children=[...items];},setAttribute(){},ownerDocument:doc});
  const doc={createElement:makeNode,createTextNode:text=>({textContent:text})},root=makeNode();
  const client={state:()=>({job:{status:'ready',candidate:response.candidate},error:'',busy:false,stale:false,canApply:false}),
    subscribe:()=>()=>{},init:async()=>{},dispose(){}};
  const ui=mountPlayerNameUI({api:{getState:()=>({session:s,clip:c})},client,root});
  const issueRow=root.children[0].children[6].children.find(row=>row.className==='player-name-conflict');
  assert.match(issueRow.textContent,/P2.*T8 #10 · 0–1帧.*T9 #7 · 2–2帧.*同一 P/);ui.dispose();
});

test('same T keeps names only inside the proposed interval and manual T changes take over',()=>{
  const s=session(),c=clip(),applied=applyPlayerNameIdentities(s,result([item('P1',7,0,1,'Finite','0')]),c).session;
  applied.entities[0].identityKeyframes.push({frame:2,kind:'track',trackId:9,order:3});
  assert.equal(nameIdentityAt(applied,applied.entities[0],{frame:1,trackId:7},c).name,'Finite');
  assert.equal(nameIdentityAt(applied,applied.entities[0],{frame:2,trackId:9},c),null);
});

test('reapplying an old job is idempotent and does not rewrite manual data',()=>{
  const s=session(),c=clip(),res=result([item('P1',7,0,1,'Candidate','0')]);
  const once=applyPlayerNameIdentities(s,res,c).session;
  const twice=applyPlayerNameIdentities(once,res,c);
  assert.equal(twice.report.alreadyApplied,true);assert.equal(twice.session.entities[0].machineNameIdentities.length,1);
});

test('UI forwards optional game ID and hiding results changes presentation only',async()=>{
  const makeNode=()=>({children:[],value:'',checked:false,append(...items){this.children.push(...items);},replaceChildren(...items){this.children=[...items];},setAttribute(){},
    ownerDocument:doc});
  const doc={createElement:makeNode,createTextNode:text=>({textContent:text})};
  const root=makeNode(),original=session();let commits=0,started=null,providerStatus=null;const visibility=[];
  const api={getState:()=>({session:original,clip:clip()}),commit:()=>commits++};
  const client={state:()=>({job:null,error:'',busy:false,stale:false,canApply:false,providerStatus}),subscribe:()=>()=>{},init:async()=>{},
    start:async(value)=>{started=value;},dispose(){}};
  const ui=mountPlayerNameUI({api,client,root,onVisibilityChange:value=>visibility.push(value)});
  const checkbox=root.children[0].children[4].children[0];checkbox.checked=false;checkbox.onchange();
  const context=root.children[0].children[2].children;
  context[0].children[0].value='2025-26';context[1].children[0].value='0022500701';
  context[2].children[0].value='BOS';context[3].children[0].value='NYK';
  for(const label of context)label.children[0].oninput();
  assert.equal(root.children[0].children[3].children[0].disabled,true,'configuration must be loaded before start');
  providerStatus={available:false,message:'OpenRouter 未配置'};ui.render();
  assert.equal(root.children[0].children[3].children[0].disabled,true);
  assert.equal(root.children[0].children[7].textContent,'OpenRouter 未配置');
  providerStatus={available:true,provider:'openrouter',model:'openai/gpt-6-astra'};ui.render();
  assert.equal(root.children[0].children[3].children[0].disabled,false);
  await root.children[0].children[3].children[0].onclick();
  assert.equal(started.gameId,'0022500701');assert.deepEqual(started.teamMap,{A:'BOS',B:'NYK'});
  assert.deepEqual(visibility,[false]);assert.equal(commits,0);assert.deepEqual(original,session());ui.dispose();
});

test('name context form exposes saved context to the initial review and reports changed roster input',()=>{
  const doc={createElement:()=>({children:[],value:'',append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(){},ownerDocument:doc}),createTextNode:text=>({textContent:text})};
  const root=doc.createElement(),saved={...session(),identityContext:{season:'2025-26',teamMap:{A:'HOU',B:'LAL'},gameId:'0022500701'}};
  const changed=[],client={state:()=>({}),init:async()=>{},dispose(){}};
  const ui=mountPlayerNameUI({root,client,api:{getState:()=>({session:saved,clip:clip()}),onContextChange:input=>changed.push(input)}});
  assert.deepEqual(ui.requestContext(),saved.identityContext);
  const inputs=root.children[0].children[2].children.map(label=>label.children[0]);
  inputs[2].value='bos';inputs[2].oninput();assert.equal(changed.at(-1).teamMap.A,'BOS');
  inputs[0].value='';inputs[0].oninput();assert.deepEqual(ui.initialIdentityContext(),{teamMap:{A:'BOS',B:'LAL'},gameId:'0022500701'});
  inputs[3].value='';inputs[3].oninput();assert.deepEqual(ui.initialIdentityContext(),{teamMap:{A:'BOS'},gameId:'0022500701'});
  saved.identityContext={season:'2024-25',teamMap:{A:'NYK'}};ui.render();assert.deepEqual(ui.initialIdentityContext(),saved.identityContext,'undo/restoration resynchronizes displayed roster context');
  ui.dispose();
});

test('sample roster context seeds both recognition paths while saved edits and deliberate blanks win',async()=>{
  const doc={createElement:()=>({children:[],value:'',append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(){},ownerDocument:doc}),createTextNode:text=>({textContent:text})};
  const root=doc.createElement(),saved=session();let nameContext;
  let started;
  const client={state:()=>({providerStatus:{available:true,provider:'openrouter',model:'openai/gpt-6-astra'}}),init:async()=>{},start:async input=>started=input,dispose(){}};
  const ui=mountPlayerNameUI({root,client,api:{getState:()=>({session:saved,clip:clip(),nameContext}),onContextChange:input=>saved.identityContext=structuredClone(input)}});
  assert.equal(ui.initialIdentityContext(),undefined,'unknown video must not use input placeholders as facts');
  assert.equal(root.children[0].children[3].children[0].disabled,true);
  nameContext={season:'2025-26',gameId:'0022500701',teamMap:{A:'HOU',B:'DAL'}};ui.render();
  assert.deepEqual(ui.initialIdentityContext(),nameContext);
  await root.children[0].children[3].children[0].onclick();assert.deepEqual(started,nameContext);
  saved.gameContext={season:'2024-25',gameId:'0022400100'};saved.teamIdentities={red:{team:'BOS'}};ui.render();
  assert.deepEqual(ui.initialIdentityContext(),{season:'2024-25',gameId:'0022400100',teamMap:{A:'BOS',B:'DAL'}});
  const inputs=root.children[0].children[2].children.map(label=>label.children[0]);
  inputs[0].value='';inputs[0].oninput();inputs[1].value='';inputs[1].oninput();inputs[3].value='';inputs[3].oninput();
  ui.render();assert.deepEqual(ui.initialIdentityContext(),{teamMap:{A:'BOS'}},'render must not restore deliberately cleared sample defaults');
  saved.identityContext={season:'2025-26',teamMap:{A:'HOU',B:'LAL'}};ui.render();
  assert.deepEqual(ui.initialIdentityContext(),{season:'2025-26',teamMap:{A:'HOU',B:'LAL'}},'saved undo context must replace the form without borrowing sample game ID');
  ui.dispose();
});

test('saved video review names remain source and range aware in the name panel without an independent job',()=>{
  const doc={createElement:()=>({children:[],value:'',append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(){},ownerDocument:doc}),createTextNode:text=>({textContent:text})};
  const root=doc.createElement();let c=clip(),saved=applyPlayerNameIdentities(session(),result([item('P1',7,0,1,'Saved Candidate','00')]),c).session;
  saved.entities[0].identityKeyframes.push({frame:2,kind:'track',trackId:9,order:3});
  saved.initialIdentityReview={algoVersion:'video-identity-review-v2',videoHash:'video',trackingFingerprint:'tracks',trackingRevision:'r1',completionStatus:'partial'};
  let trajectories=buildTrajectories(saved,c.frames,[],c);
  const client={state:()=>({job:null,providerStatus:{available:false,message:'独立姓名服务未配置'}}),init:async()=>{},dispose(){}};
  const ui=mountPlayerNameUI({root,client,api:{getState:()=>({session:saved,clip:c,trajectories})}});
  const panel=root.children[0],rows=()=>panel.children[6].children.map(row=>row.textContent).join('\n');
  assert.match(panel.children[5].textContent,/初检.*已保存.*部分/);
  assert.match(rows(),/P1.*Saved Candidate.*机器候选.*待人工审核.*2\/3/);
  assert.match(rows(),/P2.*姓名未知/);
  assert.match(panel.children[3].children[0].textContent,/高级/);
  assert.equal(panel.children[3].children[0].disabled,true);assert.equal(panel.children[7].textContent,'独立姓名服务未配置');
  saved=structuredClone(saved);saved.entities[0].nameIdentity={source:'manual',name:'Human Name'};
  trajectories=buildTrajectories(saved,c.frames,[],c);ui.render();assert.match(rows(),/Human Name.*人工姓名/);assert.doesNotMatch(rows(),/Saved Candidate/);
  saved=structuredClone(saved);delete saved.entities[0].nameIdentity;saved.entities[0].identityKeyframes=[{frame:0,kind:'track',trackId:9,order:3}];
  trajectories=buildTrajectories(saved,c.frames,[],c);ui.render();assert.doesNotMatch(rows(),/Saved Candidate/);
  c={...clip(),tracking_revision:'r2'};saved=applyPlayerNameIdentities(session(),result([item('P1',7,0,1,'Old Source','0')]),clip()).session;
  trajectories=buildTrajectories(saved,c.frames,[],c);ui.render();assert.doesNotMatch(rows(),/Old Source/);assert.match(panel.children[5].textContent,/尚未开始/);
  saved={...session(),initialIdentityReview:{algoVersion:'video-identity-review-v2',videoHash:'video',trackingFingerprint:'tracks',trackingRevision:'r2',completionStatus:'partial'}};
  trajectories=buildTrajectories(saved,c.frames,[],c);ui.render();assert.match(panel.children[5].textContent,/初检.*已保存/);assert.match(rows(),/P1.*姓名未知/);
  ui.dispose();
});

test('a same-frame collision removes only its overlap and retains both clear tails',()=>{
  const s=session(),c=clip();c.frames[2].tracks.push([2,0,12,20,7]);
  const response=result([item('P1',7,0,2,'Duplicate','0'),item('P2',8,1,1,'Duplicate','00')]);
  const applied=applyPlayerNameIdentities(s,response,c);
  assert.deepEqual(applied.session.entities[0].machineNameIdentities.map(({start,end})=>[start,end]),[[0,0],[2,2]]);
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[0],{frame:0,trackId:7},c).name,'Duplicate');
  assert.equal(nameIdentityAt(applied.session,applied.session.entities[0],{frame:1,trackId:7},c),null);
});

test('finite v4 proof rebinds a machine P/T swap, protects human records and invalidates stale sources',()=>{
  const c=clip(),s=session();
  for(const entity of s.entities){entity.identityKeyframes=[];entity.bindings=[{kind:'track',trackId:entity.id==='P1'?7:8,start:0,end:2,origin:'ai_visual_reference'}];}
  const candidate=item('P2',7,0,1,'Stable Player','0');candidate.evidenceMethod='direct_jersey';candidate.originalEntityId='P1';
  const applied=applyPlayerNameIdentities(s,result([candidate]),c).session;
  assert.equal(identityAt(applied.entities[0],0,[],c.frames[0],c).kind,'unassigned');
  assert.equal(identityAt(applied.entities[1],0,[],c.frames[0],c).trackId,7);
  assert.equal(identityAt(applied.entities[1],2,[],c.frames[2],c).trackId,8,'old machine association resumes outside finite proof');
  assert.equal(identityAt(applied.entities[1],0,[],c.frames[0],{...c,tracking_revision:'changed'}).trackId,8);
  assert.equal(nameIdentityAt(applied,applied.entities[1],{frame:0,trackId:7},c).nameStatus,'machine_accepted');
  const tracks=buildTrajectories(applied,c.frames,[],c);
  assert.equal(tracks.P1[0].x,null);assert.equal(tracks.P2[0].trackId,7);
  applied.entities[1].identityKeyframes.push({frame:0,kind:'track',trackId:8,origin:'human_selection',order:10});
  assert.equal(identityAt(applied.entities[1],0,[],c.frames[0],c).trackId,8,'human selection always wins');
});

test('verified cross-T continuation uses an observed anchor and does not carry the profile into unproved frames',()=>{
  const s=session(),c=clip(),anchor=item('P1',7,0,1,'Stable Player','0');
  anchor.evidenceMethod='direct_jersey';anchor.evidence[0].evidenceId='anchor';
  const continuation=item('P1',9,2,2,'Stable Player','0',2);
  continuation.evidenceMethod='visual_same_person';continuation.evidence[0].evidenceId='target';
  continuation.continuity={referenceEvidenceIds:['anchor'],targetEvidenceIds:['target'],reason:'same person visual comparison'};
  const applied=applyPlayerNameIdentities(s,result([anchor,continuation]),c).session;
  assert.equal(applied.entities[0].machinePlayerProfile.status,'candidate');
  assert.equal(nameIdentityAt(applied,applied.entities[0],{frame:2,trackId:9},c),null,'existing human T choice retains priority');
  const machine=session();machine.entities[0].identityKeyframes=[];
  machine.entities[0].bindings=[{kind:'track',start:0,end:2,trackId:7,origin:'ai_visual_reference'}];
  const repaired=applyPlayerNameIdentities(machine,result([anchor,continuation]),c).session;
  assert.equal(nameIdentityAt(repaired,repaired.entities[0],{frame:2,trackId:9},c).positionBindingStatus,'verified_continuation');
  continuation.continuity.referenceEvidenceIds=['invented'];
  assert.equal(applyPlayerNameIdentities(machine,result([anchor,continuation]),c).report.applied,1);
});

test('visual binding proof resolves obsolete identity-review flags while actual referee risk remains',()=>{
  const s=session(),c=clip();s.entities[0].identityKeyframes=[];
  s.entities[0].bindings=[{kind:'track',start:0,end:2,trackId:7,origin:'ai_visual_reference'}];
  c.frames[0].track_evidence={7:{color_conflict:true,identity_review_required:true}};
  c.frames[1].track_roles={7:'referee'};
  const candidate=item('P1',7,0,1,'Stable Player','0');candidate.evidenceMethod='direct_jersey';
  const applied=applyPlayerNameIdentities(s,result([candidate]),c).session;
  const tracks=buildTrajectories(applied,c.frames,[],c);
  assert.notEqual(tracks.P1[0].x,null);assert.equal(tracks.P1[0].machineRiskResolved,'role_conflict');
  assert.equal(tracks.P1[1].x,null);assert.equal(tracks.P1[1].identityRisk,'non_player');
  assert.equal(nameIdentityAt(applied,applied.entities[0],tracks.P1[1],c),null,'a role-blocked position is not a named observation');
});

test('explicit verified correction shadows old machine candidates only in the repaired overlap',()=>{
  const c=clip(),s=session();
  for(const entity of s.entities){entity.identityKeyframes=[];entity.bindings=[{kind:'track',trackId:entity.id==='P1'?7:8,start:0,end:2,origin:'ai_visual_reference'}];}
  const old=item('P1',7,0,1,'Stable Player','0');old.evidenceMethod='direct_jersey';
  const correction=item('P2',7,1,1,'Stable Player','0',1);
  correction.evidenceMethod='direct_jersey';correction.bindingCorrection=true;
  const applied=applyPlayerNameIdentities(s,result([old,correction]),c).session;
  assert.equal(nameIdentityAt(applied,applied.entities[0],{frame:0,trackId:7},c).name,'Stable Player');
  assert.equal(nameIdentityAt(applied,applied.entities[0],{frame:1,trackId:7},c),null);
  assert.equal(nameIdentityAt(applied,applied.entities[1],{frame:1,trackId:7},c).name,'Stable Player');
  const firstJob=applyPlayerNameIdentities(s,result([old]),c).session;
  firstJob.entities[0].bindings=[];
  const later=applyPlayerNameIdentities(firstJob,{...result([correction]),jobId:'repair-job',sourceKey:'repair-source'},c).session;
  assert.equal(buildTrajectories(later,c.frames,[],c).P1[1].x,null,'an older derived machine claim is released as well');
  assert.equal(buildTrajectories(later,c.frames,[],c).P2[1].trackId,7);
});

test('an unnamed human T claim prevents a competing machine name from being displayed',()=>{
  const s=session(),c=clip();s.entities[0].identityKeyframes=[];
  s.entities[0].bindings=[{kind:'track',start:0,end:2,trackId:7,origin:'ai_visual_reference'}];
  s.entities[1].identityKeyframes=[{frame:0,kind:'track',trackId:7,origin:'human_selection',order:2}];
  const candidate=item('P1',7,0,1,'Machine Name','0');candidate.evidenceMethod='direct_jersey';
  const applied=applyPlayerNameIdentities(s,result([candidate]),c).session;
  assert.equal(nameIdentityAt(applied,applied.entities[0],{frame:0,trackId:7},c),null);
  const tracks=buildTrajectories(applied,c.frames,[],c);
  assert.equal(tracks.P1[0].x,null);assert.notEqual(tracks.P2[0].x,null);
});

test('a valid human review of a visual correction keeps that observation when a later machine job disagrees',()=>{
  const s=session(),c=clip();s.entities[0].identityKeyframes=[];s.entities[0].bindings=[];s.entities[1].identityKeyframes=[];
  const first=item('P1',7,0,1,'Human Reviewed Player','0');first.evidenceMethod='direct_jersey';
  const once=applyPlayerNameIdentities(s,result([first]),c).session;
  const review=confirmFrameIdentity(once,'P1',0,c.frames,[],c);
  assert.equal(review.identityScope,'machine_name_binding');
  const second=item('P1',8,0,1,'Other Player','00');second.evidenceMethod='direct_jersey';
  const job={...result([second]),jobId:'job2',sourceKey:'source2'};
  const twice=applyPlayerNameIdentities(once,job,c).session;
  const tracks=buildTrajectories(twice,c.frames,[],c);
  assert.equal(tracks.P1[0].trackId,7);assert.equal(tracks.P1[0].frameIdentityConfirmed,true);
  assert.equal(tracks.P1[1].trackId,8,'only the human reviewed frame is protected');
});

test('a proven foreign identity releases only its finite old AI claim, without changing manual records or inventing a target name',()=>{
  const s=session(),c=clip();s.entities[0].identityKeyframes=[];
  s.entities[0].bindings=[{kind:'track',trackId:7,start:0,end:2,origin:'ai_visual_reference'}];
  c.frames[2].tracks.push([2,0,12,20,7]);
  const job=result([]);job.candidate.issues=[{kind:'association_conflict',entityId:'P1',trackId:7,start:1,end:1,
    evidence:[{evidenceId:'foreign',frame:1,trackId:7}],referenceEvidence:[{evidenceId:'canonical',frame:0,trackId:7}],
    reason:'目标读数与真实源帧参照人物不同。'}];
  const before=structuredClone(s),applied=applyPlayerNameIdentities(s,job,c);
  assert.deepEqual(s,before);assert.equal(applied.report.associationReleasedSegments,1);
  const tracks=buildTrajectories(applied.session,c.frames,[],c);
  assert.notEqual(tracks.P1[0].x,null);assert.equal(tracks.P1[1].x,null);assert.notEqual(tracks.P1[2].x,null);
  assert.equal(applied.session.entities[0].machineNameIdentities,undefined);
  applied.session.entities[0].bindings.push({kind:'track',trackId:7,start:1,end:1,origin:'human_range_replacement',order:5});
  assert.notEqual(buildTrajectories(applied.session,c.frames,[],c).P1[1].x,null,'explicit human range keeps priority');
  const unsupported=result([]);unsupported.candidate.issues=[{...job.candidate.issues[0],referenceEvidence:[]}];
  assert.equal(applyPlayerNameIdentities(before,unsupported,c).report.associationReleasedSegments,0);
});

test('a positive corrected T in the same job outranks a negative claim about a different old T',()=>{
  const s=session(),c=clip();s.entities[0].identityKeyframes=[];s.entities[1].identityKeyframes=[];
  s.entities[0].bindings=[{kind:'track',trackId:7,start:0,end:2,origin:'ai_visual_reference'}];
  const correction=item('P1',8,1,1,'Canonical Player','00',1);correction.evidenceMethod='direct_jersey';correction.bindingCorrection=true;
  const job=result([correction]);job.candidate.issues=[{kind:'association_conflict',entityId:'P1',trackId:7,start:1,end:1,
    evidence:[{frame:1,trackId:7}],referenceEvidence:[{frame:0,trackId:8}]}];
  const applied=applyPlayerNameIdentities(s,job,c).session;
  assert.equal(buildTrajectories(applied,c.frames,[],c).P1[1].trackId,8);
  assert.equal(nameIdentityAt(applied,applied.entities[0],{frame:1,trackId:8},c).name,'Canonical Player');
});

test('a canonical source reference can establish the name without inventing a position binding, and support explicit continuity',()=>{
  const s=session(),c=clip();s.entities[0].identityKeyframes=[];s.entities[0].bindings=[];
  const profile={entityId:'P1',status:'reference_candidate',verified:false,
    nameCandidate:{name:'Canonical Name',lookupStatus:'unique_candidate',jersey:'0',team:'BOS'},
    evidence:[{frame:0,trackId:7,evidenceId:'canonical',targetConfirmed:true}]};
  const empty=result([]);empty.candidate.playerProfiles=[profile];
  const named=applyPlayerNameIdentities(s,empty,c).session;
  assert.equal(named.entities[0].machinePlayerProfile.name,'Canonical Name');
  assert.equal(named.entities[0].machinePlayerProfile.nameStatus,'machine_accepted');
  assert.equal(nameIdentityAt(named,named.entities[0],{frame:1,trackId:7},c),null);
  assert.equal(buildTrajectories(named,c.frames,[],c).P1[1].x,null);
  const continuation=item('P1',9,2,2,'Canonical Name','0',2);
  continuation.evidenceMethod='visual_same_person';continuation.evidence[0].evidenceId='target';
  continuation.continuity={referenceEvidenceIds:['canonical'],targetEvidenceIds:['target']};
  const job=result([continuation]);job.candidate.playerProfiles=[profile];
  const located=applyPlayerNameIdentities(s,job,c).session;
  assert.equal(nameIdentityAt(located,located.entities[0],{frame:2,trackId:9},c).name,'Canonical Name');
  assert.equal(nameIdentityAt(located,located.entities[0],{frame:1,trackId:7},c),null);
});

test('saved real v3 result retains clear local evidence without changing the source or pretending stable P2 identity',()=>{
  const folder=new URL('../../../artifacts/player-name-identity-20261007/all-players-v3/',import.meta.url);
  if(!fs.existsSync(folder))return;
  const read=name=>JSON.parse(fs.readFileSync(new URL(name,folder),'utf8'));
  const source=read('input-session.json'),c=read('input-clip.json'),job=read('job.json'),before=JSON.stringify(source);
  const applied=applyPlayerNameIdentities(source,job,c);
  assert.equal(JSON.stringify(source),before);
  const p2=applied.session.entities.find(item=>item.id==='P2');
  assert.equal(p2.machinePlayerProfile.status,'ambiguous');
  assert.equal(nameIdentityAt(applied.session,p2,{frame:60,trackId:6},c).name,'Jabari Smith Jr.');
  assert.equal(nameIdentityAt(applied.session,p2,{frame:130,trackId:6},c),null,'unsupported inter-segment interval stays unknown');
  assert.equal(nameIdentityAt(applied.session,p2,{frame:147,trackId:6},c).name,'Kevin Durant');
  assert.equal(nameIdentityAt(applied.session,p2,{frame:60,trackId:6},c).nameStatus,'candidate','old v3 evidence is not upgraded to machine accepted');
});
