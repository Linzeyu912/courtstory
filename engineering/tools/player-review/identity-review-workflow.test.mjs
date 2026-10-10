import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {blankSession,buildTrajectories,replaceIdentityRange,entityLabel,confirmFrameIdentity} from './trajectory.mjs';
import {identityPersonSelection,identityQuickRange,excludeIdentityPersonRange,addMissingIdentityPoint,initialIdentityReviewView,issueReviewFrame} from './identity-review-workflow.mjs';
import * as identityWorkflow from './identity-review-workflow.mjs';
import {createIdentityAgentClient} from './identity-agent-client.mjs';
import {applyInitialIdentityReview,initialIdentitySlotBasis} from './identity-initial-review.mjs';
import {suggestMissingPlayerRange,previewMissingPlayerRange} from './missing-player-range.mjs';
import {frameSeekTime} from './team-overlay.mjs';
import {confirmIdentity} from './identity-timeline.mjs';

function fixture(){
  const clip={video_sha256:'video',tracking_fingerprint:'tracks',tracking_revision:'detector',width:1280,height:720,sourceCuts:[],frames:Array.from({length:9},(_,frame)=>({frame,time:frame/10,tracks:[[100+frame,80,150+frame,180,1,.9,0],[400+frame,80,450+frame,180,2,.9,0]]}))};
  const session=blankSession(clip.video_sha256);
  session.entities[0].modelBindings=[{kind:'track',trackId:1,start:0,end:8,identityConfirmed:false,reviewRequired:true}];
  session.entities[1].modelBindings=[{kind:'track',trackId:2,start:0,end:8,identityConfirmed:false,reviewRequired:true}];
  return {clip,session};
}
const bounds=range=>[range.start,range.end];

test('plain person selection finds the existing owner without changing assignments or selecting an ambiguous owner',()=>{
  const {session,clip}=fixture(),before=structuredClone(session),points=buildTrajectories(session,clip.frames);
  assert.equal(identityPersonSelection(points,3,2).entityId,'P2');
  assert.deepEqual(identityPersonSelection(points,3,99),{trackId:99,entityId:null,owners:[]});
  assert.equal(identityPersonSelection({...points,P3:points.P2},3,2).entityId,null);
  assert.deepEqual(session,before);
});

test('default correction includes the observed run and stops at missing frames, source cuts and human boundaries',()=>{
  const {session,clip}=fixture();
  assert.deepEqual(bounds(identityQuickRange({session,clip,frame:3,trackId:1})),[0,8]);
  clip.frames[1].tracks=[];clip.sourceCuts=[5];
  assert.deepEqual(bounds(identityQuickRange({session,clip,frame:3,trackId:1})),[2,4]);
  session.entities[1].identityKeyframes=[{frame:4,kind:'track',trackId:2}];
  assert.deepEqual(bounds(identityQuickRange({session,clip,frame:3,trackId:1})),[2,4],'another player cannot truncate this T');
  assert.deepEqual(bounds(identityQuickRange({session,clip,frame:3,trackId:1,entityId:'P2'})),[2,3],'the selected target still protects its own boundary');
  session.entities[0].frameConfirmations=[{frame:3}];
  assert.deepEqual(bounds(identityQuickRange({session,clip,frame:3,trackId:1})),[3,3]);
  assert.deepEqual(bounds(identityQuickRange({session,clip,frame:1,trackId:null})),[1,1]);
});

test('other players single-frame confirmations do not fragment a continuous T but same-T human boundaries do',()=>{
  const {session,clip}=fixture();confirmFrameIdentity(session,'P2',4,clip.frames);
  assert.deepEqual(bounds(identityQuickRange({session,clip,frame:3,trackId:1,entityId:'P1'})),[0,8]);
  session.entities[2].bindings=[{kind:'track',trackId:1,start:5,end:6,exclusive:true,order:2}];
  assert.deepEqual(bounds(identityQuickRange({session,clip,frame:3,trackId:1,entityId:'P1'})),[0,4]);
});

test('occurrence preview retains manual evidence, gaps and cuts without marking a whole T manually checked',()=>{
  assert.equal(typeof identityWorkflow.assignIdentityTrackOccurrences,'function');
  const {session,clip}=fixture();clip.frames[4].tracks=clip.frames[4].tracks.filter(box=>box[4]!==1);clip.sourceCuts=[6];
  const player=session.entities[0];
  player.bindings=[{kind:'track',trackId:2,start:1,end:1,exclusive:true,order:2,origin:'human_range_replacement'},
    {kind:'unassigned',trackId:null,start:7,end:7,exclusive:true,order:3,origin:'human_release'}];
  confirmFrameIdentity(session,'P1',2,clip.frames);
  player.anchors=[{frame:3,x:127,y:180,trackId:1,identityConfirmed:false}];
  const before=structuredClone(session),result=identityWorkflow.assignIdentityTrackOccurrences(session,{entityId:'P1',trackId:1,start:0,end:8,selectionFrame:5},clip);
  assert.deepEqual(session,before,'preview never mutates the current draft');
  assert.deepEqual(result.session.entities[0].frameConfirmations,before.entities[0].frameConfirmations);
  assert.deepEqual(result.session.entities[0].anchors,before.entities[0].anchors);
  assert.deepEqual(result.session.entities[0].bindings.slice(0,2),before.entities[0].bindings);
  const points=buildTrajectories(result.session,clip.frames,clip.sourceCuts,clip).P1;
  assert.equal(points[1].trackId,2);assert.equal(points[7].x,null);assert.equal(points[4].x,null);
  assert.equal(points[2].frameIdentityConfirmed,true);assert.equal(points[3].x,127);
  assert(points.filter(point=>point.frame!==2).every(point=>!point.frameIdentityConfirmed));
  const added=result.session.entities[0].bindings.slice(2);
  assert(added.every(binding=>binding.scope==='track_occurrences'&&binding.exclusive===false&&binding.reviewRequired));
  assert(added.every(binding=>!(binding.start<6&&binding.end>=6)),'a cut separates occurrence segments');
  assert(result.preview.preservedHuman>=3);
});

test('occurrence assignment reports equal-priority ownership conflicts and preserves human not-player exclusions',()=>{
  const {session,clip}=fixture();
  session.entities[2].modelBindings=[{kind:'track',trackId:1,start:0,end:8}];
  session.entities[0].bindings=[{kind:'track',trackId:1,start:0,end:8,scope:'track_occurrences',exclusive:false,order:1}];
  const result=identityWorkflow.assignIdentityTrackOccurrences(session,{entityId:'P3',trackId:1,start:0,end:8,selectionFrame:3},clip);
  assert.equal(result.preview.conflicts,9);assert.equal(result.preview.preservedHuman,0);
  assert(buildTrajectories(result.session,clip.frames).P3.every(point=>point.source==='conflict'));
  const excluded=excludeIdentityPersonRange(session,{entityId:'P1',trackId:1,start:3,end:5},clip);
  const next=identityWorkflow.assignIdentityTrackOccurrences(excluded.session,{entityId:'P3',trackId:1,start:0,end:8,selectionFrame:3},clip);
  assert.equal(next.preview.preservedHuman,3);
  assert(next.session.entities[2].bindings.every(binding=>binding.end<3||binding.start>5));
});

test('occurrence assignment can fill absent forward-track observations while protecting its remaining real observations',()=>{
  const {session,clip}=fixture();session.entities[0].modelBindings=[];
  confirmIdentity(session,'P1',0,{trackId:2,box:clip.frames[0].tracks[1].slice(0,4)},clip.frames);
  for(const at of [2,3])clip.frames[at].tracks=clip.frames[at].tracks.filter(box=>box[4]!==2);
  const result=identityWorkflow.assignIdentityTrackOccurrences(session,{entityId:'P1',trackId:1,start:0,end:8,selectionFrame:3},clip);
  const points=buildTrajectories(result.session,clip.frames).P1;
  assert.equal(points[2].trackId,1);assert.equal(points[3].trackId,1);assert.equal(points[4].trackId,2);
  assert.equal(points[0].frameIdentityConfirmed,true);
});

test('same T cannot extend a correction through a large jump, area jump, duplicate observation or ambiguous role',()=>{
  for(const kind of ['jump','area','duplicate','ambiguous','conflict-list','time-gap']){
    const {session,clip}=fixture();
    if(kind==='jump')clip.frames[4].tracks[0]=[900,80,950,180,1,.9,0];
    if(kind==='area')clip.frames[4].tracks[0]=[104,80,304,480,1,.9,0];
    if(kind==='duplicate')clip.frames[4].tracks.push([110,80,160,180,1,.8,0]);
    if(kind==='ambiguous')clip.frames[4].track_evidence={1:{identity_review_required:true}};
    if(kind==='conflict-list')clip.frames[4].role_conflicts=[{trackIds:[1]}];
    if(kind==='time-gap')clip.frames[4].time=1;
    assert.deepEqual(bounds(identityQuickRange({session,clip,frame:3,trackId:1})),[0,3],kind);
    if(kind!=='time-gap')assert.deepEqual(bounds(identityQuickRange({session,clip,frame:5,trackId:1})),[5,8],kind);
  }
});

test('not-player exclusion is finite, preserves original human evidence, and survives model refresh dismissals',()=>{
  const {session,clip}=fixture();
  session.entities[0].anchors=[{frame:3,x:125,y:180,trackId:1,identityConfirmed:false}];
  session.entities[0].bindings=[{kind:'track',trackId:1,start:0,end:8,origin:'human_range_replacement',exclusive:true,order:1}];
  const before=structuredClone(session),beforePoints=buildTrajectories(session,clip.frames).P1;
  const result=excludeIdentityPersonRange(session,{entityId:'P1',trackId:1,start:2,end:5},clip);
  assert.deepEqual(session,before);
  assert.deepEqual(result.session.entities[0].anchors,before.entities[0].anchors);
  const after=buildTrajectories(result.session,clip.frames).P1;
  assert(after.slice(2,6).every(point=>point.x===null&&point.reviewExcluded));
  for(const frame of [0,1,6,7,8])assert.deepEqual(after[frame],beforePoints[frame]);
  assert.deepEqual(result.session.entities[0].modelBindings,before.entities[0].modelBindings);
  assert.deepEqual(result.session.entities[0].dismissedModelBindings.map(bounds),[[2,5]]);
  assert.deepEqual(result.session.entities[1],before.entities[1]);
  assert.equal(result.preview.excludedObservations,4);
  assert.deepEqual(JSON.parse(JSON.stringify(before)),session,'one stored history snapshot restores all old records');
});

test('finite exclusion preserves model-binding tokens and valid confirmations on both sides',()=>{
  const {session,clip}=fixture();confirmFrameIdentity(session,'P1',1,clip.frames);confirmFrameIdentity(session,'P1',7,clip.frames);
  const oldBinding=structuredClone(session.entities[0].modelBindings),confirmations=structuredClone(session.entities[0].frameConfirmations);
  const result=excludeIdentityPersonRange(session,{entityId:'P1',trackId:1,start:3,end:5},clip);
  const after=buildTrajectories(result.session,clip.frames).P1;
  assert.equal(after[1].frameIdentityConfirmed,true);assert.equal(after[7].frameIdentityConfirmed,true);
  assert(after.slice(3,6).every(point=>point.x===null&&point.reviewExcluded));
  assert.deepEqual(result.session.entities[0].modelBindings,oldBinding);assert.deepEqual(result.session.entities[0].frameConfirmations,confirmations);
});

test('unassigned people may be excluded without inventing a new player identity',()=>{
  const {session,clip}=fixture();session.entities[1].modelBindings=[];
  const result=excludeIdentityPersonRange(session,{entityId:'P1',trackId:2,start:2,end:4},clip);
  assert.equal(result.preview.changed,0);assert.equal(result.preview.excludedObservations,3);
  assert.equal(result.session.entities[0].dismissedModelBindings[0].trackId,2);
  assert.deepEqual(result.session.entities[1],session.entities[1]);
});

test('manual missing-person point overrides only its current excluded/out-of-view frame and never confirms or extrapolates',()=>{
  const {session,clip}=fixture();
  session.entities[0].bindings=[{kind:'unassigned',trackId:null,start:0,end:8,order:1,origin:'human_release'}];
  session.entities[0].visibilityRanges=[{start:0,end:8,state:'out_of_view',origin:'human_visibility_review'}];
  const before=structuredClone(session),draft=addMissingIdentityPoint(session,{entityId:'P1',frame:3,x:210,y:250},clip),points=buildTrajectories(draft,clip.frames).P1;
  assert.deepEqual(session,before);
  assert.equal(points[3].x,210);assert.equal(points[3].y,250);assert.equal(points[3].trackId,null);
  assert.equal(points[3].frameIdentityConfirmed,false);assert.equal(points[3].groundContactConfirmed,false);
  assert(points.filter(point=>point.frame!==3).every(point=>point.x===null&&point.source==='out_of_view'));
  assert.deepEqual(draft.entities[1],before.entities[1]);
  assert.throws(()=>addMissingIdentityPoint(session,{entityId:'P1',frame:3,x:-1,y:250},clip));
});

test('initial review labels explain exact uncertainty and seeking clamps to actual evidence',()=>{
  const kinds=['identity_uncertain','team_uncertain','role_uncertain','role_mismatch','unresolved','unsampled'];
  const view=initialIdentityReviewView({job:{jobId:'initial',status:'ready',candidate:{issues:kinds.map((kind,index)=>({kind,id:String(index),start:2,end:4,reason:'证据不足'}))}}});
  assert.deepEqual(view.issues.map(issue=>issue.label),['身份待核对','所属球队待核对','球员 / 裁判待分辨','裁判 / 其他人误入球员','这段人物尚未核对','短暂人物未抽样']);
  assert.equal(view.issues.length,6);assert.deepEqual(view.roles,{});assert.equal(view.applied,false);
  assert.equal(issueReviewFrame({start:2,end:4,evidenceFrames:[1,3]},9),3);
  assert.equal(issueReviewFrame({start:20,end:30,evidenceFrames:[]},9),8);
});

test('applied safety issues and counts replace the raw list, are deduplicated and remain visible after reload',()=>{
  const issue={id:'guard',kind:'slot_basis_changed',entityId:'P2',trackId:4,start:1,end:3,reason:'保留人工身份'};
  const record={jobId:'initial',report:{changedModelBindings:2,preservedHuman:3,excludedObservations:4,issues:[issue,issue]}};
  const view=initialIdentityReviewView({job:{jobId:'initial',status:'ready',candidate:{issues:[]}}},{initialIdentityReview:record});
  assert.equal(view.issues.length,1);assert.equal(view.issues[0].label,'当前球员已被人工修改');assert.equal(view.report.preservedHuman,3);
  const undone=initialIdentityReviewView({job:{jobId:'initial',status:'ready',applicationReport:record.report},applied:false},{});
  assert.equal(undone.stale,true,'undo requires cache rebase before a new adoption');
});

const app=readFileSync(new URL('./app.mjs',import.meta.url),'utf8');
function appHarness(extra={}){
  const {session,clip}=fixture(),listeners=new Map(),nodes=new Map(),calls=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{checked:true,open:false,addEventListener:(name,fn)=>listeners.set(`${id}:${name}`,fn),scrollIntoView:()=>{}});return nodes.get(id);};
  const source=app.slice(app.indexOf('function quickIdentityState()'),app.indexOf('function identityReferenceFrameReady()'));
  const click=app.slice(app.indexOf("canvas.addEventListener('click',"),app.indexOf('\nfunction setMode',app.indexOf("canvas.addEventListener('click',")));
  const undo=app.split('\n').find(line=>line.startsWith("$('undo').addEventListener"));
  const frameControls=app.slice(app.indexOf('function seek(index,'),app.indexOf('function proposals()'));
  const context={initialSession:session,clip,structuredClone,identityPersonSelection,identityQuickRange,assignIdentityTrackOccurrences:identityWorkflow.assignIdentityTrackOccurrences,excludeIdentityPersonRange,addMissingIdentityPoint,suggestMissingPlayerRange,previewMissingPlayerRange,initialIdentityReviewView,issueReviewFrame,buildTrajectories,replaceIdentityRange,entityLabel,
    document:{querySelector:()=>node('selected')},$:node,canvas:{addEventListener:(name,fn)=>listeners.set(`canvas:${name}`,fn)},pauseVideo:()=>calls.push('pause'),draw:()=>{},clearRangePreview:()=>{},prepareGeometryEdit:()=>{},
    identityReferenceFrameReady:()=>true,toast:message=>calls.push(message),editable:()=>true,imagePosition:event=>event,proposals:()=>[],pickPersonProposal:()=>null,commitImageEdit:()=>{},frameSeekTime,frameAtMediaTime:(frames,time)=>frames.reduce((nearest,record,index)=>Math.abs(record.time-time)<Math.abs(frames[nearest].time-time)?index:nearest,0),
    setTimeout:()=>{},...extra};
  vm.runInNewContext(`
    let session=initialSession,active='P1',frame=3,mode='select',sessionRevision=0,history=[],reviewBusy=false,initialApplying=false,initialApplyError='',initialAutoApply=true;
    let previewTrackId=null,quickIdentity={action:null,targetId:'P1',trackId:null},rangeEdit={capture:null},rangePreviewData=null,suppressClick=false;
    const sourceCuts=clip.sourceCuts,sceneUI=null,workspace=null,identityAgent=globalThis.mockAgent||null;
    const videoDisplay=null,tacticsUI=null,video={pause:()=>{},currentTime:0};let tacticsSeekTime=null,drag=null;
    let trajectories=buildTrajectories(session,clip.frames,sourceCuts);
    function refresh(){trajectories=buildTrajectories(session,clip.frames,sourceCuts);}
    function saveDraft(){}
    function change(fn){history.push({draft:JSON.stringify(session),active});fn();sessionRevision++;refresh();}
    ${frameControls}
    async function associateProposal(){throw new Error('A plain click must not assign');}
    function applyInitialIdentityReview(current,result){return globalThis.applyInitialResult(current,result);}
    ${source}\n${click}\n${undo}
    globalThis.harness={selectIdentityPerson,beginIdentityQuickEdit,setIdentityQuickTarget,setIdentityQuickRange,applyIdentityQuickEdit,applyMissingSingleFrame,cancelIdentityQuickEdit,adoptInitialReview,reviewIdentityIssue,seek,updateFrame,
      setIdentityQuickEndpoint:typeof setIdentityQuickEndpoint==='function'?setIdentityQuickEndpoint:null,
      setIdentityQuickPreset:typeof setIdentityQuickPreset==='function'?setIdentityQuickPreset:null,
      state:()=>({session,active,frame,mode,revision:sessionRevision,quick:quickIdentityState(),history,initialApplyError}),
      externalEdit:()=>{session.note='new manual note';sessionRevision++;},
      manualFixture:()=>{session.entities[0].bindings=[{kind:'unassigned',trackId:null,start:0,end:8,order:1,origin:'human_release'}];refresh();},
      singleMissingFixture:(stale=false)=>{const entity=session.entities[2];entity.anchors=[{frame:2,x:260,y:310},{frame:4,x:280,y:330}];if(stale){entity.identityKeyframes=[{frame:0,kind:'track',trackId:8}];entity.anchors.push({frame:3,x:250,y:300,trackId:7,identityConfirmed:false});}refresh();},
      selectFrame:at=>frame=at};
  `,context);
  return {api:context.harness,listeners,calls,session,clip};
}

test('actual app click and apply handlers select first, then reassign only the explicit continuous range with one undo',()=>{
  const h=appHarness(),before=JSON.parse(JSON.stringify(h.api.state().session));
  h.api.selectIdentityPerson({trackId:2});assert.equal(h.api.state().active,'P2');
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.state().session)),before);assert.equal(h.api.state().history.length,0);
  h.api.beginIdentityQuickEdit('replace');h.api.setIdentityQuickTarget('P3');
  h.api.setIdentityQuickRange('start',.2);h.api.setIdentityQuickRange('end',.4);
  assert.equal(h.api.state().history.length,0);
  h.api.applyIdentityQuickEdit();
  const current=h.api.state(),points=buildTrajectories(current.session,h.clip.frames);
  assert.equal(current.history.length,1);assert(points.P3.slice(2,5).every(point=>point.trackId===2&&point.x!=null));
  assert.equal(points.P2[1].trackId,2);assert.equal(points.P2[5].trackId,2);assert.equal(points.P2[3].x,null);
  h.listeners.get('undo:click')();assert.deepEqual(JSON.parse(JSON.stringify(h.api.state().session)),before);
});

test('actual quick handler refuses a preview made before another edit',()=>{
  const h=appHarness();h.api.beginIdentityQuickEdit('exclude');h.api.externalEdit();
  const before=JSON.parse(JSON.stringify(h.api.state().session));h.api.applyIdentityQuickEdit();
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.state().session)),before);
  assert.match(h.api.state().quick.error,/草稿已有新修改/);assert.equal(h.api.state().history.length,0);
});

test('actual canvas keeps endpoint clicks provisional, previews a segment and applies it with one undo',()=>{
  const h=appHarness(),before=JSON.parse(JSON.stringify(h.api.state().session));
  h.api.beginIdentityQuickEdit('missing');h.api.setIdentityQuickTarget('P3');h.listeners.get('canvas:click')({x:270,y:320});
  assert.equal(h.api.state().history.length,0);assert.equal(h.api.state().quick.missingKeys.length,1);
  h.api.selectFrame(7);h.listeners.get('canvas:click')({x:310,y:340});
  assert.equal(h.api.state().history.length,0);assert.equal(h.api.state().quick.preview.changed,5);
  h.api.applyIdentityQuickEdit();
  const state=h.api.state(),points=buildTrajectories(state.session,h.clip.frames).P3;
  assert.equal(state.history.length,1);assert.equal(points[3].x,270);assert.equal(points[7].x,310);
  assert.equal(points[5].source,'manual_path');assert.equal(points[5].frameIdentityConfirmed,false);
  assert(points.filter(point=>point.frame<3||point.frame>7).every(point=>point.x===null));assert.equal(state.quick.action,null);
  h.listeners.get('undo:click')();assert.deepEqual(JSON.parse(JSON.stringify(h.api.state().session)),before);
});

test('missing-person preview refuses stale edits, wrong decoded frames and excluded identities',()=>{
  const h=appHarness();h.api.beginIdentityQuickEdit('missing');h.api.setIdentityQuickTarget('P3');
  h.listeners.get('canvas:click')({x:270,y:320});h.api.selectFrame(7);h.listeners.get('canvas:click')({x:310,y:340});
  h.api.externalEdit();h.api.applyIdentityQuickEdit();assert.equal(h.api.state().history.length,0);assert.match(h.api.state().quick.error,/草稿已有新修改/);
  const blocked=appHarness({identityReferenceFrameReady:()=>false});blocked.api.beginIdentityQuickEdit('missing');blocked.api.setIdentityQuickTarget('P3');
  blocked.listeners.get('canvas:click')({x:270,y:320});assert.equal(blocked.api.state().quick.missingKeys.length,0);
  const excluded=appHarness();excluded.api.manualFixture();excluded.api.beginIdentityQuickEdit('missing');
  excluded.listeners.get('canvas:click')({x:270,y:320});assert.equal(excluded.api.state().history.length,0);assert.match(excluded.api.state().quick.error,/人工排除/);
});

test('actual seek and playback retain missing anchors and the selected person, target and interval',()=>{
  const h=appHarness();h.api.beginIdentityQuickEdit('missing');h.api.setIdentityQuickTarget('P3');h.listeners.get('canvas:click')({x:270,y:320});
  h.api.seek(7);assert.equal(h.api.state().quick.action,'missing');assert.equal(h.api.state().quick.missingKeys[0].frame,3);
  h.listeners.get('canvas:click')({x:310,y:340});h.api.updateFrame(.5);
  assert.equal(h.api.state().quick.preview.changed,5);assert.equal(h.api.state().frame,5);
  h.listeners.get('canvas:click')({x:295,y:330});assert.equal(h.api.state().quick.missingKeys.length,3);
  h.api.cancelIdentityQuickEdit();h.api.selectIdentityPerson({trackId:1});h.api.setIdentityQuickTarget('P3');
  h.api.setIdentityQuickRange('start',.2);h.api.setIdentityQuickRange('end',.7);
  h.api.seek(6);h.api.updateFrame(.5);
  assert.equal(h.api.state().quick.action,'replace');assert.equal(h.api.state().quick.trackId,1);assert.equal(h.api.state().quick.targetId,'P3');
  assert.deepEqual(bounds(h.api.state().quick.range),[2,7]);assert.equal(h.api.state().history.length,0);
});

test('current-frame endpoints clamp the opposite end and invalid numeric input cannot apply an old preview',()=>{
  const h=appHarness();assert.equal(typeof h.api.setIdentityQuickEndpoint,'function');
  h.api.selectIdentityPerson({trackId:1});h.api.setIdentityQuickTarget('P3');
  h.api.setIdentityQuickRange('start',.2);h.api.setIdentityQuickRange('end',.4);
  h.api.seek(7);h.api.setIdentityQuickEndpoint('start');assert.deepEqual(bounds(h.api.state().quick.range),[7,7]);
  h.api.seek(3);h.api.setIdentityQuickEndpoint('end');assert.deepEqual(bounds(h.api.state().quick.range),[3,3]);
  h.api.setIdentityQuickRange('start',.8);assert.match(h.api.state().quick.error,/起点/);
  h.api.applyIdentityQuickEdit();assert.equal(h.api.state().history.length,0,'invalid edit invalidates the previous pending draft');
  h.api.setIdentityQuickEndpoint('start');h.api.seek(5);h.api.setIdentityQuickEndpoint('end');h.api.applyIdentityQuickEdit();
  assert.equal(h.api.state().history.length,1);
  const points=buildTrajectories(h.api.state().session,h.clip.frames).P3;
  assert.deepEqual(points.map(point=>point.x!=null),[false,false,false,true,true,true,false,false,false]);
});

test('empty, non-finite and outside numeric bounds invalidate the previous preview instead of silently applying it',()=>{
  for(const seconds of [NaN,Infinity,-.1,5]){
    const h=appHarness();h.api.selectIdentityPerson({trackId:1});h.api.setIdentityQuickTarget('P3');
    h.api.setIdentityQuickRange('start',seconds);h.api.applyIdentityQuickEdit();
    assert.equal(h.api.state().history.length,0);assert.match(h.api.state().quick.error,/时间/);assert.equal(h.api.state().quick.preview,null);
  }
});

test('forward and whole-T presets preview actual observations, retain selection through seeking and undo once',()=>{
  for(const [preset,expected] of [['forward',[false,false,false,true,true,false,true,true,true]],['all',[true,true,true,true,true,false,true,true,true]]]){
    const h=appHarness();assert.equal(typeof h.api.setIdentityQuickPreset,'function');
    h.clip.frames[5].tracks=h.clip.frames[5].tracks.filter(box=>box[4]!==1);h.clip.sourceCuts.push(7);
    const before=JSON.parse(JSON.stringify(h.api.state().session));
    h.api.selectIdentityPerson({trackId:1});h.api.setIdentityQuickTarget('P3');h.api.setIdentityQuickPreset(preset);
    assert.deepEqual(JSON.parse(JSON.stringify(h.api.state().session)),before);assert.equal(h.api.state().history.length,0);
    assert.equal(h.api.state().quick.preview.observationCount,preset==='all'?8:5);
    h.api.seek(8);assert.equal(h.api.state().quick.targetId,'P3');assert.equal(h.api.state().quick.trackId,1);
    h.api.applyIdentityQuickEdit();assert.equal(h.api.state().history.length,1);
    const points=buildTrajectories(h.api.state().session,h.clip.frames,h.clip.sourceCuts,h.clip).P3;
    assert.deepEqual(points.map(point=>point.x!=null),expected);assert(points.every(point=>!point.frameIdentityConfirmed));
    h.listeners.get('undo:click')();assert.deepEqual(JSON.parse(JSON.stringify(h.api.state().session)),before);
  }
});

test('editing bulk endpoints keeps manual-priority semantics and refreshing a range cannot revive stale preview data',()=>{
  const h=appHarness();assert.equal(typeof h.api.setIdentityQuickPreset,'function');
  h.api.selectIdentityPerson({trackId:1});h.api.setIdentityQuickTarget('P3');h.api.setIdentityQuickPreset('all');
  h.api.seek(2);h.api.setIdentityQuickEndpoint('start');
  assert.equal(h.api.state().quick.scope,'track_occurrences');assert.deepEqual(bounds(h.api.state().quick.range),[2,8]);
  h.api.externalEdit();h.api.setIdentityQuickRange('end',.6);h.api.applyIdentityQuickEdit();
  assert.equal(h.api.state().history.length,0);assert.match(h.api.state().quick.error,/草稿已有新修改/);
  h.api.selectIdentityPerson({trackId:2});
  assert.equal(h.api.state().quick.trackId,2);assert.equal(h.api.state().quick.targetId,'P3');
  h.api.applyIdentityQuickEdit();assert.equal(h.api.state().session.note,'new manual note');assert.equal(h.api.state().history.length,1);
});

test('range endpoints and assignment wait for the decoded frame and tolerate an endpoint without the selected T',()=>{
  let ready=true;const h=appHarness({identityReferenceFrameReady:()=>ready});
  h.api.selectIdentityPerson({trackId:1});h.api.setIdentityQuickTarget('P3');h.api.setIdentityQuickPreset('forward');
  h.clip.frames[7].tracks=h.clip.frames[7].tracks.filter(box=>box[4]!==1);
  h.api.seek(7);ready=false;h.api.setIdentityQuickEndpoint('end');assert.equal(h.api.state().quick.range.end,8);
  h.api.applyIdentityQuickEdit();assert.equal(h.api.state().history.length,0);
  ready=true;h.api.setIdentityQuickEndpoint('end');h.api.applyIdentityQuickEdit();
  const points=buildTrajectories(h.api.state().session,h.clip.frames).P3;
  assert.equal(points[6].trackId,1);assert.equal(points[7].x,null);assert.equal(points[8].x,null);
  assert(h.api.state().session.entities[2].bindings.every(binding=>binding.selectionFrame===3));
});
test('actual single-frame fallback applies exactly the clicked frame with one undo',()=>{
  for(const stale of [false,true]){
  const h=appHarness();h.api.singleMissingFixture(stale);const before=JSON.parse(JSON.stringify(h.api.state().session));
  h.api.beginIdentityQuickEdit('missing');h.api.setIdentityQuickTarget('P3');h.listeners.get('canvas:click')({x:270,y:320});
  assert.equal(h.api.state().quick.range.start,h.api.state().quick.range.end);assert.equal(h.api.state().history.length,0);
  h.api.applyMissingSingleFrame();const points=buildTrajectories(h.api.state().session,h.clip.frames).P3;
  assert.equal(h.api.state().history.length,1);assert.equal(points[3].x,270);assert.equal(points[3].identityConfirmed,false);assert.equal(points[3].box,null);
  h.listeners.get('undo:click')();assert.deepEqual(JSON.parse(JSON.stringify(h.api.state().session)),before);
  }
});

test('automatic adoption runs once, keeps manual data and late results never overwrite a newer draft',async()=>{
  let adopted=0,applied=0;const state={job:{jobId:'initial',status:'ready'},stale:false,applied:false};
  const mockAgent={state:()=>({initialReview:state}),adoptInitialReview:async()=>{adopted++;return {candidate:{}};},initialApplied:()=>{applied++;state.applied=true;}};
  const h=appHarness({mockAgent,applyInitialResult:(session)=>({session:{...structuredClone(session),initialIdentityReview:{jobId:'initial'}},report:{changedModelBindings:0}})});
  await h.api.adoptInitialReview(true);await h.api.adoptInitialReview(true);
  assert.equal(adopted,1);assert.equal(applied,1);assert.equal(h.api.state().history.length,1);
  assert.deepEqual(h.api.state().session.entities,h.session.entities);
  state.applied=false;state.stale=true;await h.api.adoptInitialReview(false);
  assert.equal(adopted,1);assert.equal(h.api.state().history.length,1);
});

function liveClientHarness({helperFailure=false,deferAdoption=false}={}){
  let h,job,resolveAdoption;const requests=[];
  const client=createIdentityAgentClient({context:{sample:'fixture',variant:'detector',qa:true},snapshot:()=>({session:h.api.state().session,revision:h.api.state().revision,entityId:h.api.state().active}),
    fetch:async(url,options)=>{
      const body=options?.body?JSON.parse(options.body):null;requests.push({url,body});
      if(url.endsWith('/status'))return {ok:true,json:async()=>({available:true})};
      if(url==='/api/identity-agent/jobs'){
        const p={subjectId:'person',entityId:'P3',role:'player',reason:'同一清晰观测',confidence:.9};
        job={jobId:'initial-job',generationJobId:'generation',sourceKey:'fixture-source',algoVersion:'initial-identity-review-v1',purpose:'initial_review',status:'ready',matchesCurrentInput:true,
          base:{videoHash:h.clip.video_sha256,trackingFingerprint:h.clip.tracking_fingerprint,trackingRevision:h.clip.tracking_revision,sessionDigest:'digest',clientRevision:body.clientRevision},
          candidate:{schemaVersion:1,identityVerified:false,reviewRequired:true,summary:'抽样初检',slotBasis:initialIdentitySlotBasis(body.session),subjects:[p],issues:[],segments:[{...p,id:'segment',trackId:1,start:2,end:4,evidenceFrames:[2,4]}]}};
        return {ok:true,json:async()=>structuredClone(job)};
      }
      if(url.endsWith('/adopt')){
        if(deferAdoption)await new Promise(resolve=>resolveAdoption=resolve);
        return {ok:true,json:async()=>structuredClone(job)};
      }
      throw new Error(`Unexpected request ${url}`);
    }});
  h=appHarness({mockAgent:client,applyInitialResult:(session,result)=>{if(helperFailure)throw new Error('fixture helper refused unsafe result');return applyInitialIdentityReview(session,result,h.clip);}});
  return {...h,client,requests,release:()=>resolveAdoption?.()};
}

test('real client and helper apply machine-only results through the app exactly once and respect undo',async()=>{
  const h=liveClientHarness();await h.client.init();await h.client.startInitialReview();
  await h.api.adoptInitialReview(true);await h.api.adoptInitialReview(true);
  assert.equal(h.api.state().history.length,1);assert.equal(h.client.state().initialReview.applied,true);
  const points=buildTrajectories(h.api.state().session,h.clip.frames,[],h.clip);
  assert.equal(points.P3[3].trackId,1);assert.equal(points.P3[3].frameIdentityConfirmed,false);
  assert.equal(h.requests.filter(request=>request.url.endsWith('/adopt')).length,1);
  h.listeners.get('undo:click')();assert.equal(h.client.state().initialReview.applied,false);
  await h.api.adoptInitialReview(true);assert.equal(h.api.state().history.length,0,'undo must not trigger automatic re-application');
});

test('real helper failure exits client application busy state and retry reuses the cached analysis',async()=>{
  const h=liveClientHarness({helperFailure:true});await h.client.init();await h.client.startInitialReview();await h.api.adoptInitialReview(true);
  const review=h.client.state().initialReview;
  assert.equal(review.busy,false);assert.equal(review.job.status,'review_required');assert.match(review.error,/helper refused/);
  assert.equal(h.api.state().history.length,0);
  await h.client.retryInitialReview();
  assert.equal(h.requests.at(-1).body.reuseCached,true);assert.equal(h.requests.at(-1).body.forceRetry,undefined);
});

test('real client rejects an adoption response after an independent manual edit',async()=>{
  const h=liveClientHarness({deferAdoption:true});await h.client.init();await h.client.startInitialReview();
  const pending=h.api.adoptInitialReview(true);h.api.externalEdit();h.release();await pending;
  assert.equal(h.api.state().session.note,'new manual note');assert.equal(h.api.state().history.length,0);
  assert.equal(h.client.state().initialReview.busy,false);assert.match(h.api.state().initialApplyError,/等待期间草稿/);
});

test('an old ready job is not adopted while the client is still preparing its next base',async()=>{
  let adopted=0;
  const h=appHarness({mockAgent:{state:()=>({initialReview:{job:{status:'ready'},busy:true}}),adoptInitialReview:async()=>adopted++}});
  await h.api.adoptInitialReview(true);assert.equal(adopted,0);assert.equal(h.api.state().history.length,0);
});
