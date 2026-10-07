import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSession,buildTrajectories} from './trajectory.mjs';
import {buildCourtPreparation,preparationDigest} from './court-preparation.mjs';
import {courtPreparationGuidance,mountCourtPreparationUI,openPreparationSource} from './court-preparation-ui.mjs';

function fixture(){
  const frames=Array.from({length:21},(_,frame)=>({frame,time:frame*.04,tracks:[[90+frame,40,110+frame,80,1,.9,0]]}));
  const clip={video_sha256:'a'.repeat(64),tracking_fingerprint:'b'.repeat(64),frames,mediaEndTime:.91,width:640,height:480};
  const session=blankSession(clip.video_sha256);session.entities[0].bindings=[{kind:'track',trackId:1,start:0,end:20}];
  session.liveSelection={ranges:[{start:0,end:20}]};
  const maps=frames.map(()=>({toCourt:[.05,0,0,0,.05,0,0,0,1],toImage:[20,0,0,0,20,0,0,0,1],method:'test',supportFrames:[0],supportHulls:[],referenceOnly:true,quality:null}));
  const preparation=buildCourtPreparation({session,clip,maps}),trajectories=buildTrajectories(session,frames);
  return {session,clip,maps,preparation,trajectories};
}
function guidance(f,extra={}){return courtPreparationGuidance({session:f.session,clip:f.clip,active:'P1',range:{startFrame:0,endFrameExclusive:21},imagePoints:f.trajectories.P1,courtPoints:f.preparation.preparedByPlayer.P1,maps:f.maps,...extra});}

// Runs the actual registered handlers without browser/storage/model dependencies.
// Browser layout is verified separately.
class Node {
  constructor(){this.children=[];this.nodes=new Map();this.attrs={};this.value='';this.hidden=false;this.disabled=false;}
  set innerHTML(value){this.html=value;for(const match of value.matchAll(/data-([a-z-]+)(?=[\s=>])/g))this.nodes.set(match[1],new Node());if(this.nodes.has('preset'))this.nodes.get('preset').value='light';}
  get innerHTML(){return this.html;}
  querySelector(selector){return this.nodes.get(selector.slice(6,-1));}
  setAttribute(key,value){this.attrs[key]=value;}
  prepend(...nodes){this.children.unshift(...nodes);}
}
async function mounted({prepared=true,fetch:fetchOverride}={}){
  const f=fixture(),s={session:f.session,frame:0,active:'P1',trajectories:f.trajectories,sessionRevision:0};
  if(prepared)s.session.courtPreparation=f.preparation;
  const host=new Node(),calls=[],posts=[],changes=[];
  const fetch=fetchOverride??(async(url,options)=>{if(options){posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({version:3})};}return {ok:true,json:async()=>({version:2,preparation:null})};});
  const ui=mountCourtPreparationUI({host,clip:f.clip,sample:'sample',variant:'variant',state:()=>s,
    change:fn=>{changes.push(preparationDigest(s.session));fn();s.sessionRevision++;},redraw:()=>{},next:()=>calls.push(['next']),seek:frame=>calls.push(['seek',frame]),undo:()=>{},
    points:()=>s.session.courtPreparation?.preparedByPlayer??f.preparation.preparedByPlayer,maps:()=>f.maps,openSource:(...args)=>calls.push(args)},
    {document:{createElement:()=>new Node()},search:'?qa=1',fetch,mountGroundAgent:()=>({render(){},display(){return null;},previewEntityIds(){return [];},compare(){return false;}})});
  await new Promise(resolve=>setImmediate(resolve));
  const purpose=host.children[0],section=host.children[1],$=key=>section.querySelector(`[data-${key}]`);
  return {...f,s,ui,purpose,$,calls,posts,changes};
}

test('source guidance routes a missing association, missing mapping and missing position to distinct repairs',()=>{
  const f=fixture();assert.equal(guidance(f).action,'compare');
  f.session.entities[0].bindings=[];assert.equal(guidance(f).action,'identity');
  f.session.entities[0].bindings=[{kind:'track',trackId:1,start:0,end:20}];
  const unmapped=f.preparation.rawByPlayer.P1.map(p=>({...p,x:null,y:null,source:'uncalibrated'}));
  assert.equal(guidance(f,{maps:[],courtPoints:unmapped}).action,'calibration');
  const image=structuredClone(f.trajectories.P1);image[4]={...image[4],x:null,y:null,source:'missing'};
  const result=guidance(f,{imagePoints:image});assert.equal(result.action,'image');assert.equal(result.frame,4);
});

test('guidance does not require unused slots or repair out-of-view frames; unsupported mapping stays on video',()=>{
  const f=fixture();assert.equal(guidance(f).mapped,21);
  const image=f.trajectories.P1.map(p=>({...p,x:null,y:null,source:'out_of_view'}));
  const outside=guidance(f,{imagePoints:image,courtPoints:[],maps:[]});assert.equal(outside.action,'compare');assert.equal(outside.outOfView,21);
  f.clip.supportsCourtCalibration=false;
  assert.equal(guidance(f,{courtPoints:[],maps:[]}).action,'image');
  const unmapped=f.preparation.rawByPlayer.P1.map(p=>({...p,x:null,y:null,source:'uncalibrated'}));
  assert.equal(guidance(f,{courtPoints:unmapped,maps:[]}).action,'image');
});

test('missing footage selection is explained before repair and opens footage without a half drawer',async()=>{
  const m=await mounted({prepared:false});m.s.session.liveSelection=null;m.ui.render();
  assert.equal(m.$('build').disabled,true);
  assert.equal(guidance(m).action,'footage');await m.$('resolve').onclick();
  assert.deepEqual(m.calls,[['footage',{frame:0,entityId:'P1'}]]);
  const calls=[];let step='repair';
  assert.equal(openPreparationSource('footage',{frame:0},{seek:f=>calls.push(['seek',f]),openStep:value=>{step=value;},step:()=>step,pause:()=>calls.push(['pause']),closeData:()=>calls.push(['close'])}),true);
  assert.deepEqual(calls,[['seek',0],['pause'],['close']]);
});

test('skip and repair buttons work before preparation without mutating the session',async()=>{
  const m=await mounted({prepared:false}),before=preparationDigest(m.s.session);
  await m.purpose.querySelector('[data-skip]').onclick();await m.$('image').onclick();await m.$('repair-court').onclick();
  assert.deepEqual(m.calls,[['next'],['image',{frame:0,entityId:'P1'}],['court',{frame:0,entityId:'P1'}]]);
  assert.equal(preparationDigest(m.s.session),before);assert.equal(m.changes.length,0);
  assert.equal(Number(m.$('end').value),.91);assert.equal(m.$('save').disabled,true);
});

test('navigation locates the frame, enters a real repair mode, and respects the source-selection guard',()=>{
  const calls=[];let current='identity';const api={seek:f=>calls.push(['seek',f]),openStep:s=>{calls.push(['step',s]);current=s;},step:()=>current,pause:()=>calls.push(['pause']),repairImage:()=>calls.push(['image']),repairCourt:()=>calls.push(['court']),viewOnly:()=>calls.push(['view']),openData:()=>calls.push(['data'])};
  assert.equal(openPreparationSource('image',{frame:4},api),true);assert.deepEqual(calls,[['seek',4],['step','repair'],['pause'],['image']]);
  calls.length=0;openPreparationSource('compare',{frame:7},api);assert.deepEqual(calls,[['seek',7],['step','repair'],['pause'],['view'],['data']]);
  calls.length=0;api.openStep=()=>{current='footage';};assert.equal(openPreparationSource('court',{frame:9},api),false);assert.deepEqual(calls,[['seek',9]]);
});

test('smoothing remains preview-only until adoption; switching player drops the old preview',async()=>{
  const m=await mounted(),original=preparationDigest(m.s.session.courtPreparation);
  await m.$('preview').onclick();assert.equal(m.$('adopt').disabled,false);assert.equal(m.ui.compare(),true);assert.equal(preparationDigest(m.s.session.courtPreparation),original);
  await m.$('discard').onclick();assert.equal(m.$('adopt').disabled,true);assert.equal(preparationDigest(m.s.session.courtPreparation),original);
  await m.$('preview').onclick();m.s.active='P2';m.ui.render();assert.equal(m.$('adopt').disabled,true);
  m.s.active='P1';m.ui.render();await m.$('preview').onclick();await m.$('adopt').onclick();
  assert.equal(m.s.session.courtPreparation.revision,2);assert.equal(m.changes.length,1);assert.deepEqual(m.s.session.courtPreparation.rawByPlayer,m.preparation.rawByPlayer);
});

test('invalid range and changed source cannot be previewed or saved',async()=>{
  const m=await mounted();m.$('end').value='0';m.$('end').onchange();assert.equal(m.$('build').disabled,true);await m.$('preview').onclick();assert.equal(m.$('adopt').disabled,true);
  m.$('end').value='.91';m.$('end').onchange();await m.$('preview').onclick();
  m.s.session.entities[0].bindings[0].end=19;m.ui.render();assert.equal(m.$('adopt').disabled,true);assert.equal(m.$('save').disabled,true);assert.equal(m.ui.display(),null);
  await m.$('save').onclick();assert.equal(m.posts.length,0);assert.equal(m.changes.length,0);
});

test('save sends an immutable QA snapshot with expected version and keeps local data on failure',async()=>{
  const m=await mounted();await m.$('save').onclick();assert.equal(m.posts.length,1);assert.equal(m.posts[0].qa,true);assert.equal(m.posts[0].expectedVersion,2);assert.deepEqual(m.posts[0].preparation,m.preparation);assert.equal(m.changes.length,0);
  const failed=await mounted({fetch:async(url,options)=>options?{ok:false,json:async()=>({error:'offline'})}:{ok:true,json:async()=>({version:0,preparation:null})}}),before=preparationDigest(failed.s.session);
  await failed.$('save').onclick();assert.equal(preparationDigest(failed.s.session),before);assert.equal(failed.$('save').disabled,false);assert.match(failed.$('status').textContent,/offline/);
});
