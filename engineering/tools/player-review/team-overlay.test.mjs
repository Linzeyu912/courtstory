import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {blankSession,buildTrajectories,exportReview} from './trajectory.mjs';
import {adoptIdentitySuggestions,confirmIdentity} from './identity-timeline.mjs';
let overlay={};try{overlay=await import('./team-overlay.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const policyPath=new URL('./team-overlay-policy.json',import.meta.url);
const policy=fs.existsSync(policyPath)?JSON.parse(fs.readFileSync(policyPath,'utf8')):null;
const requireFeature=name=>{assert.equal(typeof overlay[name],'function',`${name}: required team presentation behavior is missing`);return overlay[name];};
const frames=Array.from({length:7},(_,frame)=>({frame,time:frame*.04,tracks:[[100,100,200,300,1,.9,2],[300,100,400,300,2,.8,2]]}));
const proposed=(id,trackId,teamGroup)=>({id,teamGroup,teamHint:teamGroup==='A'?'dark':'white',bindings:[{start:0,end:6,trackId}]});
const suggestions=entities=>({version:1,method:'team-group-proposal',verified:false,teamGrouping:{version:1,layout:'reserved_5_plus_5_v1',verified:false},entities});
const points=bottoms=>bottoms.map((bottom,frame)=>({frame,time:frame*.04,x:150,y:bottom,box:[100,100,200,bottom],source:'tracked',trackId:1,identitySource:'model_suggestion',identityStartFrame:0,footMethod:'bbox_bottom_center'}));

// Dropping modelTeamGroup would make the two model teams indistinguishable.
test('team suggestions keep a separate unconfirmed group without overwriting human fields',()=>{
  const s=blankSession('clip');s.entities[0].name='人工姓名';s.entities[0].team='人工球队';s.entities[0].jersey='7';
  s.entities[0].teamGroup='B';s.entities[0].teamGroupSource='human';
  confirmIdentity(s,'P1',1,{box:[100,100,200,300],trackId:1},frames);
  const before=structuredClone(s.entities[0]);
  adoptIdentitySuggestions(s,suggestions([proposed('P1',1,'A'),proposed('P6',2,'B')]),frames);
  assert.equal(s.entities[0].modelTeamGroup,'A');assert.equal(s.entities[5].modelTeamGroup,'B');
  for(const key of ['id','name','team','jersey','teamGroup','teamGroupSource','anchors','identityKeyframes'])assert.deepEqual(s.entities[0][key],before[key]);
  assert.equal(s.modelSuggestionLoad.verified,false);
  assert.equal(requireFeature('effectiveTeamGroup')(s.entities[0]),'B');
});

// A six-player team must fail before any model bindings can be adopted.
test('oversized or wrong-slot model teams reject atomically',()=>{
  const s=blankSession('clip'),before=structuredClone(s);
  assert.throws(()=>adoptIdentitySuggestions(s,suggestions(Array.from({length:6},(_,i)=>proposed(`P${i+1}`,1,'A'))),frames));
  assert.deepEqual(s,before);
  assert.throws(()=>adoptIdentitySuggestions(s,suggestions([proposed('P6',1,'A')]),frames));
  assert.deepEqual(s,before);
  const confirmedGroup=suggestions([proposed('P1',1,'A')]);confirmedGroup.teamGrouping.verified=true;
  assert.throws(()=>adoptIdentitySuggestions(s,confirmedGroup,frames));assert.deepEqual(s,before);
});

// Identity confirmation and position estimation must not change the team color.
test('one team color survives proposed, human and estimated states while unknown stays pending',()=>{
  const style=requireFeature('teamOverlayStyle');
  const a={id:'P1',role:'player',modelTeamGroup:'A'},b={id:'P6',role:'player',modelTeamGroup:'B'};
  const proposedPoint={identitySource:'model_suggestion',source:'tracked'};
  const humanPoint={identitySource:'manual_forward',source:'tracked'};
  assert.equal(style(a,proposedPoint,policy).color,style(a,humanPoint,policy).color);
  assert.equal(style(a,{...humanPoint,source:'interpolated'},policy).color,style(a,humanPoint,policy).color);
  assert.notEqual(style(a,proposedPoint,policy).color,style(b,proposedPoint,policy).color);
  assert.equal(style(a,proposedPoint,policy).dashed,true);assert.equal(style(a,humanPoint,policy).dashed,true);
  assert.equal(style({id:'P5',role:'player'},proposedPoint,policy).group,null);
});

// Locking identity must not silently promote the independent model team hint.
test('identity confirmation alone keeps team uncertainty until separate human grouping',()=>{
  const style=requireFeature('teamOverlayStyle'),assign=requireFeature('setTeamGroup'),s=blankSession('clip');
  adoptIdentitySuggestions(s,suggestions([proposed('P1',1,'A')]),frames);
  confirmIdentity(s,'P1',1,{box:[100,100,200,300],trackId:1},frames);
  const point=buildTrajectories(s,frames).P1[2],e=s.entities[0];
  assert.equal(point.identitySource,'manual_forward');assert.equal(e.teamGroupSource,undefined);
  const identityOnly=style(e,point,policy);assert.equal(identityOnly.label,'1?');assert.equal(identityOnly.dashed,true);
  assign(s,'P1','A');const both=style(e,point,policy);
  assert.equal(both.color,identityOnly.color);assert.equal(both.label,'1');assert.equal(both.dashed,false);
  const groupOnly=style(e,{...point,identitySource:'model_suggestion'},policy);
  assert.equal(groupOnly.label,'1?');assert.equal(groupOnly.dashed,true);
});

// Removing capacity checks would silently turn a fixed five-person team into six.
test('manual team corrections preserve IDs and enforce five-person capacity',()=>{
  const assign=requireFeature('setTeamGroup'),s=blankSession('clip');
  for(const e of s.entities.slice(5))assign(s,e.id,'B');
  const before=structuredClone(s);assert.throws(()=>assign(s,'P1','B'));assert.deepEqual(s,before);
  assign(s,'P10',null);assign(s,'P1','B');
  assert.equal(s.entities[0].id,'P1');assert.equal(s.entities[0].teamGroupSource,'human');
  assert.equal(s.entities[9].teamGroup,null);
});

// A display filter that mutates data would silently corrupt the review/export truth.
test('isolated geometry spike is reduced deterministically without changing raw or export positions',()=>{
  const smooth=requireFeature('stabilizePoints'),raw=points([300,301,380,303,304]),before=structuredClone(raw);
  const stable=smooth(raw,[],1280,720,policy);
  assert.deepEqual(raw,before);assert.ok(stable[2].y<330);assert.ok(Math.abs(stable[2].y-380)<=64);
  assert.deepEqual(smooth(raw,[],1280,720,policy),stable);
  assert.deepEqual(stable[0].box,raw[0].box);assert.deepEqual(stable[4].box,raw[4].box);
  const s=blankSession('clip');adoptIdentitySuggestions(s,suggestions([proposed('P1',1,'A')]),frames);
  const output=exportReview(s,{video_sha256:'clip',width:1280,height:720,frames},'test');
  assert.equal(output.entities[0].trajectory[2].y,300);assert.equal(output.entities[0].trajectory[2].presentationMethod,undefined);
});

// Blending across absence, cuts, human anchors, or binding boundaries creates phantom motion.
test('missing frames, cuts, track changes, binding changes and human anchors stop smoothing',()=>{
  const smooth=requireFeature('stabilizePoints');
  for(const mutate of [r=>{r[1]={frame:1,time:.04,x:null,y:null,source:'missing'};},r=>{r[1].trackId=2;},r=>{r[1].identitySource='manual_forward';},r=>{r[1].identityStartFrame=1;},r=>{r[1].source='manual';r[1].x=137;r[1].y=277;}]){
    const raw=points([300,301,380,303,304]);mutate(raw);const stable=smooth(raw,[],1280,720,policy);
    assert.deepEqual(stable[2].box,raw[2].box);assert.deepEqual(stable[1],raw[1]);
  }
  const raw=points([300,301,380,303,304]);assert.deepEqual(smooth(raw,[2],1280,720,policy)[2].box,raw[2].box);
});

// Edit/hit coordinates must be the same geometry a paused reviewer sees.
test('paused editing uses exact raw foot and box while stable seek remains deterministic',()=>{
  const display=requireFeature('presentationPoint'),raw=points([300,301,380,303,304]),stable=requireFeature('stabilizePoints')(raw,[],1280,720,policy);
  assert.deepEqual(display(raw[2],stable[2],{stable:true,editing:true}),raw[2]);
  assert.deepEqual(display(raw[2],stable[2],{stable:false,editing:false}),raw[2]);
  assert.equal(display(raw[2],stable[2],{stable:true,editing:false}).y,stable[2].y);
  raw[2]={...raw[2],source:'manual',x:137,y:277,footMethod:'human_image_anchor'};
  assert.deepEqual(requireFeature('stabilizePoints')(raw,[],1280,720,policy)[2],raw[2]);
});

// Nearest wall-clock time can select the following frame before it is presented.
test('presented media time selects the containing source frame with an end-safe fallback',()=>{
  const at=requireFeature('frameAtMediaTime');
  assert.equal(at(frames,.079),1);assert.equal(at(frames,.08),2);
  assert.equal(at(frames,100),6);assert.equal(at(frames,-1),0);assert.equal(at(frames,NaN,4),4);
});

test('shared renderer fixture keeps hand-checked geometry and team display policy',()=>{
  const fixture=JSON.parse(fs.readFileSync(new URL('./team-overlay-fixture.json',import.meta.url),'utf8'));
  const stable=requireFeature('stabilizePoints')(fixture.points,fixture.cuts,fixture.width,fixture.height,policy);
  assert.deepEqual(stable.map(p=>p.y),fixture.expectedY);
  const style=requireFeature('teamOverlayStyle');
  assert.equal(style(fixture.entities[0],fixture.points[0],policy).label,'1?');
  assert.equal(style(fixture.entities[1],{identitySource:'manual_forward',source:'tracked'},policy).label,'6');
});

test('fresh roster reserves two rows of five without assigning unknown identities to either team',()=>{
  const roster=requireFeature('teamRoster'),s=blankSession('clip');
  const fresh=roster(s.entities,policy);assert.equal(fresh.A.length,5);assert.equal(fresh.B.length,5);
  assert.ok(s.entities.every(e=>requireFeature('effectiveTeamGroup')(e)===null));
  s.entities[7].selected=true;s.entities[7].name='原人工身份';
  const old=roster(s.entities,policy);assert.equal(old.pending[0].id,'P8');assert.equal(old.pending[0].name,'原人工身份');
});
