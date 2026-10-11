import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {blankSession,buildTrajectories,exportReview} from './trajectory.mjs';
import {adoptIdentitySuggestions,confirmIdentity} from './identity-timeline.mjs';
import {DEFAULT_NAME_DISPLAY,normalizeNameDisplay,nameDisplaySelected,nameIdentityLabel,layoutNameLabels} from './team-overlay.mjs';
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
  assert.equal(requireFeature('effectiveTeamGroup')(s.entities[0]),'A');
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
test('one team color survives proposed, human and estimated states and model team hints cannot change its fixed row',()=>{
  const style=requireFeature('teamOverlayStyle');
  const a={id:'P1',role:'player',modelTeamGroup:'A'},b={id:'P6',role:'player',modelTeamGroup:'B'};
  const proposedPoint={identitySource:'model_suggestion',source:'tracked'};
  const humanPoint={identitySource:'manual_forward',source:'tracked',frameIdentityConfirmed:true};
  assert.equal(style(a,proposedPoint,policy).color,style(a,humanPoint,policy).color);
  assert.equal(style(a,{...humanPoint,source:'interpolated'},policy).color,style(a,humanPoint,policy).color);
  assert.notEqual(style(a,proposedPoint,policy).color,style(b,proposedPoint,policy).color);
  assert.equal(style(a,proposedPoint,policy).dashed,true);assert.equal(style(a,humanPoint,policy).dashed,false);
  assert.equal(style({id:'P5',role:'player',modelTeamGroup:'B'},proposedPoint,policy).group,'A');
  assert.equal(style(a,humanPoint,policy).color,'#ee5568');assert.equal(style(b,humanPoint,policy).color,'#4295ed');
});

// Locking identity must not silently promote the independent model team hint.
test('identity confirmation uses a solid line only on its reviewed frame and keeps the team color',()=>{
  const style=requireFeature('teamOverlayStyle'),assign=requireFeature('setTeamGroup'),s=blankSession('clip');
  adoptIdentitySuggestions(s,suggestions([proposed('P1',1,'A')]),frames);
  confirmIdentity(s,'P1',1,{box:[100,100,200,300],trackId:1},frames);
  const trajectory=buildTrajectories(s,frames).P1,point=trajectory[1],e=s.entities[0];
  assert.equal(point.identitySource,'manual_forward');assert.equal(e.teamGroupSource,undefined);
  const identityOnly=style(e,point,policy);assert.equal(identityOnly.label,'1');assert.equal(identityOnly.dashed,false);
  assign(s,'P1','A');const both=style(e,point,policy);
  assert.equal(both.color,identityOnly.color);assert.equal(both.label,'1');assert.equal(both.dashed,false);
  const groupOnly=style(e,{...point,identitySource:'model_suggestion',frameIdentityConfirmed:false},policy);
  assert.equal(groupOnly.label,'1?');assert.equal(groupOnly.dashed,true);
  assert.equal(style(e,trajectory[2],policy).dashed,true,'forward association is not a review of the next frame');
});

// Removing capacity checks would silently turn a fixed five-person team into six.
test('legacy manual grouping cannot change fixed row membership or free a sixth slot',()=>{
  const assign=requireFeature('setTeamGroup'),s=blankSession('clip');
  for(const e of s.entities.slice(5))assign(s,e.id,'B');
  const before=structuredClone(s);assert.throws(()=>assign(s,'P1','B'));assert.deepEqual(s,before);
  assert.throws(()=>assign(s,'P10',null));assert.deepEqual(s,before);
  assign(s,'P1','A');assert.equal(s.entities[0].id,'P1');assert.deepEqual(s,before);
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

test('source PTS and browser microsecond timestamps select the same frame throughout sample 004',()=>{
  const at=requireFeature('frameAtMediaTime');
  const records=JSON.parse(fs.readFileSync(new URL('../../../engineering/tests/fixtures/player-observations/004-team-stable.json',import.meta.url),'utf8'));
  assert.equal(records[1].time,.082707551);
  assert.equal(at(records,.082707),1,'browser seek to the second frame must not reset the UI to the first');
  for(let index=0;index<records.length;index++){
    const record=records[index],sourceTime=record.source_frame_pts*record.source_time_base[0]/record.source_time_base[1];
    assert.equal(at(records,Math.floor(sourceTime*1e6)/1e6),index,`truncated source PTS at frame ${index}`);
    assert.equal(at(records,Math.round(sourceTime*1e6)/1e6),index,`rounded source PTS at frame ${index}`);
    assert.equal(at(records,record.time),index,`exact candidate time at frame ${index}`);
    if(index>0){
      assert.equal(at(records,record.time-2e-6),index-1,'tolerance must not become nearest-frame selection');
      assert.equal(at(records,(records[index-1].time+record.time)/2),index-1,'playback stays on the presented interval');
    }
  }
  let current=0;
  for(let target=1;target<records.length;target++){
    current=at(records,Math.floor(records[current+1].time*1e6)/1e6,current);
    assert.equal(current,target,'consecutive next-frame actions must advance exactly one frame');
  }
  for(let target=records.length-2;target>=0;target--){
    current=at(records,Math.floor(records[current-1].time*1e6)/1e6,current);
    assert.equal(current,target,'consecutive previous-frame actions must move back exactly one frame');
  }
});

test('timestamp tolerance stays local with irregular presentation intervals and nonzero starts',()=>{
  const at=requireFeature('frameAtMediaTime'),records=[.040988736,.082707551,.131273919,.198824233].map(time=>({time}));
  assert.equal(at(records,.131273),2);
  assert.equal(at(records,.131271919),1);
  assert.equal(at(records,.15),2);
  assert.equal(at(records,.198824),3);
});

test('seek positions remain inside every decoded sample 004 frame after browser microsecond truncation',()=>{
  const seekTime=requireFeature('frameSeekTime');
  const records=JSON.parse(fs.readFileSync(new URL('../../../engineering/tests/fixtures/player-observations/004-team-stable.json',import.meta.url),'utf8'));
  const before=structuredClone(records),pts=records.map(record=>record.source_frame_pts*record.source_time_base[0]/record.source_time_base[1]);
  assert.ok(Math.floor(records[1].time*1e6)/1e6<pts[1],'exact boundary requests can decode the preceding frame');
  for(let index=0;index<records.length;index++){
    const requested=seekTime(records,index),quantized=Math.floor(requested*1e6)/1e6;
    assert.ok(quantized>=pts[index],`seek must not precede decoded frame ${index}`);
    if(index+1<pts.length)assert.ok(quantized<pts[index+1],`seek must not cross frame ${index}`);
    assert.equal(requireFeature('frameAtMediaTime')(records,quantized),index);
  }
  assert.deepEqual(records,before);
});

test('seek inset respects short variable frame intervals and clamps invalid indices',()=>{
  const seekTime=requireFeature('frameSeekTime'),records=[.04,.0801,.080102,.2].map(time=>({time}));
  assert.equal(seekTime(records,0),.040002);
  assert.equal(seekTime(records,1),(.0801+.080102)/2,'inset is capped at half the next interval');
  assert.ok(seekTime(records,1)<records[2].time);
  assert.equal(seekTime(records,-1),seekTime(records,0));
  assert.equal(seekTime(records,100),seekTime(records,3));
  assert.equal(seekTime(records,NaN),seekTime(records,0));
  assert.equal(seekTime([],0),0);
  assert.equal(seekTime([{time:0}],0),.000002);
});

test('shared renderer fixture keeps hand-checked geometry and team display policy',()=>{
  const fixture=JSON.parse(fs.readFileSync(new URL('./team-overlay-fixture.json',import.meta.url),'utf8'));
  const stable=requireFeature('stabilizePoints')(fixture.points,fixture.cuts,fixture.width,fixture.height,policy);
  assert.deepEqual(stable.map(p=>p.y),fixture.expectedY);
  const style=requireFeature('teamOverlayStyle');
  assert.equal(style(fixture.entities[0],fixture.points[0],policy).label,'1?');
  assert.equal(style(fixture.entities[1],{identitySource:'manual_forward',source:'tracked',frameIdentityConfirmed:true},policy).label,'6');
});

test('fresh roster reserves two rows of five and keeps both empty and selected slots on their fixed rows',()=>{
  const roster=requireFeature('teamRoster'),s=blankSession('clip');
  const fresh=roster(s.entities,policy);assert.equal(fresh.A.length,5);assert.equal(fresh.B.length,5);
  assert.deepEqual(s.entities.map(e=>requireFeature('effectiveTeamGroup')(e)),Array(5).fill('A').concat(Array(5).fill('B')));
  s.entities[7].selected=true;s.entities[7].name='原人工身份';
  const old=roster(s.entities,policy);assert.equal(old.pending.length,0);assert.equal(old.B[2].id,'P8');assert.equal(old.B[2].name,'原人工身份');
});


test('historical tracking metadata cannot replace the fixed red and blue team colors',()=>{
  const historical={...policy,teams:{A:{label:'蓝队',color:'#38bdf8'},B:{label:'橙队',color:'#fb923c'}}};
  const style=requireFeature('teamOverlayStyle');
  assert.equal(style({id:'P1',teamGroup:'B',modelTeamGroup:'B'},{identitySource:'model_suggestion'},historical).color,'#ee5568');
  assert.equal(style({id:'P6',teamGroup:'A',modelTeamGroup:'A'},{identitySource:'manual_forward'},historical).color,'#4295ed');
});

test('name selection is presentation-only and unknown, candidate, and confirmed labels share export text',()=>{
  const players=Array.from({length:10},(_,i)=>({id:`P${i+1}`,role:'player'}));
  const fixture=JSON.parse(fs.readFileSync(new URL('./team-overlay-name-fixture.json',import.meta.url),'utf8'));
  const settings=normalizeNameDisplay(fixture.nameDisplay,players);
  assert.equal(nameDisplaySelected(players[0],settings),true);
  assert.equal(nameDisplaySelected(players[1],settings),false);
  assert.equal(nameDisplaySelected(players[5],settings),false);
  for(const item of fixture.labels)assert.equal(nameIdentityLabel(item.identity,players[Number(item.id.slice(1))-1],settings),item.expected);
  const session=blankSession('clip'),before=structuredClone(session);
  normalizeNameDisplay({...settings,enabled:false,players:{P1:false}},session.entities);
  assert.deepEqual(session,before,'show/hide preferences must never alter player identity data');
});

test('accepted names keep the fixed player id without claiming human confirmation',()=>{
  const identity={name:'Daniel Gafford',jersey:'21',nameStatus:'machine_accepted',identityVerified:false,positionBindingStatus:'observed'};
  assert.equal(nameIdentityLabel(identity,{id:'P7'},{}),'P7 Daniel Gafford · #21');
  assert.equal(nameIdentityLabel({...identity,positionBindingStatus:'needs_review'},{id:'P7'},{}),'P7 Daniel Gafford~ · #21');
  assert.equal(identity.identityVerified,false);
});

test('feet labels stay inside the image and overlapping neighbours use another row',()=>{
  const items=[{x:5,y:180,width:170,height:20},{x:40,y:180,width:180,height:20},{x:635,y:470,width:170,height:20}];
  const before=structuredClone(items),placed=layoutNameLabels(items,640,480,1);
  assert.deepEqual(items,before);
  for(const item of placed){assert.ok(item.rect.left>=0&&item.rect.right<=640);assert.ok(item.rect.top>=0&&item.rect.bottom<=480);}
  assert.ok(placed[0].rect.bottom<=placed[1].rect.top||placed[1].rect.bottom<=placed[0].rect.top);
  assert.ok(placed[0].rect.top>items[0].y,'default label is below the feet');
});
