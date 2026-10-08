import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {blankSession,buildTrajectories,exportReview,hasAssociation,draftStorageKey,confirmFrameIdentity} from './trajectory.mjs';
import {confirmIdentity} from './identity-timeline.mjs';
import {feetForPoint,footCandidateAnchor} from './feet-candidates.mjs';
import {sceneObjectsAt,updateSceneObject} from './scene-objects.mjs';
import {acceptCourtCandidates,invalidateCameraDependents,confirmCalibrationProjection} from './calibration-guide.mjs';
import {calibrationAt} from './court.mjs';
import {createWorkspace} from './workspace.mjs';

const image=[[100,100],[400,120],[350,350],[50,330]];
const frames=Array.from({length:9},(_,frame)=>({frame,time:frame/30,
  tracks:[[190,100,210,250,7,.9,2]],objects:[{kind:'basketball',box:[10,20,20,30],score:.8}]}));
const reference={frame:0,side:'left',source:'manual_reference',points:image.map((image,i)=>({id:'ABCD'[i],image,source:'manual_reference'}))};
const dependent={...structuredClone(reference),frame:4,source:'camera_propagation',cameraSupportFrame:0,
  points:reference.points.map(point=>({...point,source:'camera_propagation'}))};
const profile={maxKeyframeGapSeconds:0,keyframes:[reference,dependent]};
const clip={video_sha256:'video',tracking_fingerprint:'rich-draft-key',tracking_raw_fingerprint:'raw-ebard',
  tracking_revision:'ebard',width:1280,height:720,frames,sourceCuts:[],
  variants:[{id:'ebard',label:'E-BARD'}],trackingMetadata:{model:'basketball',tracker:'ByteTrack'},
  feetCandidates:{videoHash:'video',trackingFingerprint:'raw-ebard',source:'rtmpose_s_halpe26',
    frames:[{frame:0,feet:[{trackId:7,left:{x:198.25,y:245.75,score:.82},right:null}]}]}};

function calibratedSession(){
  const session=blankSession('video');session.presentationStable=true;session.liveSelection={confirmed:true};
  confirmIdentity(session,'P1',0,{box:frames[0].tracks[0].slice(0,4),trackId:7},frames);
  acceptCourtCandidates(session,profile,frames.length,'video');
  const independent={...structuredClone(reference),frame:8,source:'human',status:'manual_confirmed',
    points:reference.points.map(point=>({...point,source:'human'}))};
  session.courtCalibration.keyframes.push(independent);
  return session;
}

// Execute the shipped DOM handlers; canvas painting is inert because these
// tests verify persisted state and event routing, not browser rendering.
function domFixture(){
  const nodes=new Map(),context=new Proxy({measureText:text=>({width:String(text).length*8})},{get:(value,key)=>key in value?value[key]:(()=>{})});
  const make=(tag='div')=>{const queries=new Map();const node={tag,children:[],listeners:{},attributes:{},dataset:{},style:{setProperty(){}},value:'',checked:false,hidden:false,
    clientWidth:0,clientHeight:0,width:320,height:220,paused:true,currentTime:0,selectedOptions:[{textContent:'A'}],
    classList:{add(...names){node.className=[...new Set([...(node.className??'').split(/\s+/).filter(Boolean),...names])].join(' ');},remove(...names){node.className=(node.className??'').split(/\s+/).filter(name=>!names.includes(name)).join(' ');},toggle(name,force){const active=(node.className??'').split(/\s+/).includes(name),enable=force??!active;this[enable?'add':'remove'](name);return enable;}},
    append(...children){for(const child of children){if(child?.parentElement)child.parentElement.children=child.parentElement.children.filter(n=>n!==child);if(child&&typeof child==='object')child.parentElement=this;this.children.push(child);}},
    prepend(...children){this.append(...children);this.children=[...children,...this.children.filter(n=>!children.includes(n))];},replaceChildren(...children){for(const child of this.children)if(child&&typeof child==='object')child.parentElement=null;this.children=[];this.append(...children);},
    after(...children){const parent=this.parentElement;if(!parent)return;for(const child of children){if(child?.parentElement)child.parentElement.children=child.parentElement.children.filter(n=>n!==child);if(child&&typeof child==='object')child.parentElement=parent;}parent.children.splice(parent.children.indexOf(this)+1,0,...children);},
    querySelector(selector){
      const className=/^\.([\w-]+)$/.exec(selector)?.[1];if(!className)return null;
      const existing=this.children.find(child=>(child.className??'').split(/\s+/).includes(className));if(existing)return existing;
      if(!this.innerHTML?.includes(className))return null;
      if(!queries.has(selector)){const child=make();child.className=className;queries.set(selector,child);this.append(child);}return queries.get(selector);
    },
    insertBefore(child,before){this.children.splice(this.children.indexOf(before),0,child);},get lastChild(){return this.children.at(-1);},
    setAttribute(key,value){this.attributes[key]=value;},getAttribute(key){return this.attributes[key]??null;},removeAttribute(key){delete this.attributes[key];},contains:()=>false,
    addEventListener(key,fn){(this.listeners[key]||=[]).push(fn);},focus(){},scrollIntoView(){},
    getContext:()=>context,getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720}),
    setPointerCapture(){},hasPointerCapture:()=>false,releasePointerCapture(){},
    pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},requestVideoFrameCallback(){}};return node;};
  const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
  const tabs=['footage','identity','calibration','repair','events'].map(step=>{const node=get(`tab-${step}`);node.dataset.step=step;node.setAttribute('aria-selected',String(step==='identity'));return node;});
  get('calibrationSide').value='left';get('calibrationLandmark').value='A';
  const document={body:{dataset:{}},activeElement:null,getElementById:get,createElement:make,createTextNode:text=>({nodeType:3,textContent:String(text)}),addEventListener(){},dispatchEvent(){},
    querySelector:()=>get('player-overview'),querySelectorAll:selector=>selector==='button[data-step]'?tabs:[]};
  const originals=new Map(['document','window','devicePixelRatio','location','fetch','localStorage','requestAnimationFrame','setTimeout','clearTimeout','MutationObserver','ResizeObserver'].map(key=>[key,globalThis[key]]));
  Object.assign(globalThis,{MutationObserver:class {observe(){} disconnect(){}},ResizeObserver:class {observe(){} disconnect(){}},document,window:{addEventListener(){},history:{replaceState(){}}},devicePixelRatio:1,
    location:{search:'?sample=test&variant=ebard&qa=1',assign(){}},requestAnimationFrame(){},
    setTimeout(fn,ms){if(ms===0)fn();return 1;},clearTimeout(){}});
  return {get,restore(){for(const [key,value] of originals){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};
}

function automaticCourtFixture(dom,session=blankSession('video')){
  const automatic={...structuredClone(reference),source:'hoop_constrained_court48',status:'needs_review',
    points:reference.points.map(point=>({...point,source:'yolo11n-court48'}))};
  const result={videoHash:'video',referenceFrame:0,keyframes:[automatic],reviewRequired:true,metricAccuracyValidated:false};
  const workspace=createWorkspace({clip,sample:'test',variant:'ebard',
    getState:()=>({session,active:'P1',frame:0,video:dom.get('video'),trajectories:buildTrajectories(session,frames)}),
    setMode(){},change:fn=>fn(),redraw(){},seek(){},toast(){},isSelected:hasAssociation,color:()=> '#38bdf8'});
  return {session,result,workspace};
}

test('automatic court button calls the local backend and loads unconfirmed points',async()=>{
  const dom=domFixture();
  try{
    const {session,result}=automaticCourtFixture(dom);let request;
    globalThis.fetch=async(url,options)=>{request={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>result};};
    await dom.get('autoCalibrateCourt').onclick();
    assert.equal(request.url,'/api/court-calibrate');
    assert.deepEqual(request.body,{sample:'test',variant:'ebard',frame:0,cuts:[],propagate:true,qa:true});
    const key=session.courtCalibration.keyframes.find(key=>key.frame===0);
    assert.equal(key.status,'needs_review');assert.equal(key.source,'hoop_constrained_court48');
    assert.equal(key.projectionReviewedAt,undefined);assert.equal(dom.get('autoCalibrateCourt').disabled,false);
  }finally{dom.restore();}
});

test('manual points entered during automatic inference survive its response',async()=>{
  const dom=domFixture();
  try{
    const {session,result}=automaticCourtFixture(dom);let complete,calls=0;
    globalThis.fetch=()=>{calls++;return new Promise(resolve=>{complete=resolve;});};
    const pending=dom.get('autoCalibrateCourt').onclick();
    await dom.get('autoCalibrateCourt').onclick();assert.equal(calls,1);
    const manual={...structuredClone(reference),source:'human',status:'needs_review'};
    session.courtCalibration={keyframes:[manual],maxKeyframeGapSeconds:0};
    complete({ok:true,json:async()=>result});await pending;
    assert.deepEqual(session.courtCalibration.keyframes,[manual]);
  }finally{dom.restore();}
});

test('failed automatic initialisation preserves calibration and shows the manual fallback',async()=>{
  const dom=domFixture();
  try{
    const session=calibratedSession(),before=structuredClone(session.courtCalibration);
    const {workspace}=automaticCourtFixture(dom,session);
    globalThis.fetch=async()=>({ok:true,json:async()=>({keyframes:[],initialization:{status:'invalid'}})});
    await dom.get('autoCalibrateCourt').onclick();workspace.refresh();
    assert.deepEqual(session.courtCalibration,before);
    assert.match(dom.get('candidateStatus').textContent,/人工补点/);
    assert.equal(dom.get('autoCalibrateCourt').disabled,false);
  }finally{dom.restore();}
});

test('a cut changed while automatic inference runs rejects the stale response',async()=>{
  const dom=domFixture();
  try{
    const {session,result}=automaticCourtFixture(dom);let complete;
    globalThis.fetch=()=>new Promise(resolve=>{complete=resolve;});
    const pending=dom.get('autoCalibrateCourt').onclick();session.cuts=[3];
    complete({ok:true,json:async()=>result});await pending;
    assert.equal(session.courtCalibration?.keyframes?.length||0,0);
    assert.match(dom.get('candidateStatus').textContent,/切镜位置已改变/);
  }finally{dom.restore();}
});

test('the real 2D player renderer uses frame review for dashed and solid circles',()=>{
  const dom=domFixture();
  try{
    const session=calibratedSession(),entity=session.entities[0];
    entity.anchors=[];entity.identityKeyframes=[];entity.modelBindings=[{kind:'track',trackId:7,start:0,end:8}];
    let frame=0,dash=[],lastStroke=[],playerDash=[];
    const canvas=dom.get('court');canvas.clientWidth=700;canvas.clientHeight=420;
    const context=canvas.getContext('2d');
    context.setLineDash=value=>{dash=[...value];};context.stroke=()=>{lastStroke=[...dash];};
    context.fillText=text=>{if(text==='1')playerDash.push([...lastStroke]);};
    const workspace=createWorkspace({clip,getState:()=>({session,active:'P1',frame,video:dom.get('video'),trajectories:buildTrajectories(session,frames)}),
      setMode(){},change:fn=>fn(),redraw(){},seek(){},toast(){},isSelected:hasAssociation,color:()=> '#38bdf8'});
    workspace.refresh();assert.deepEqual(playerDash.at(-1),[3,2]);
    confirmFrameIdentity(session,'P1',0,frames);workspace.refresh();assert.deepEqual(playerDash.at(-1),[]);
    frame=4;workspace.refresh();assert.deepEqual(playerDash.at(-1),[3,2]);
  }finally{dom.restore();}
});

test('raw E-BARD feet remain usable with a rich draft fingerprint and cannot transfer to another detector',()=>{
  const point=buildTrajectories(calibratedSession(),frames).P1[0];
  assert.ok(feetForPoint(clip,0,point));
  assert.equal(feetForPoint({...clip,tracking_raw_fingerprint:'raw-botsort'},0,point),null);
  assert.equal(feetForPoint(clip,0,{...point,trackId:999}),null);
  assert.equal(draftStorageKey(clip,'ebard',true),'player-review:video:rich-draft-key:qa');
});

test('manual objects export with exclusions while keeping player identity and stable geometry independent',()=>{
  const session=calibratedSession(),people=structuredClone(session.entities),records=structuredClone(frames);
  const object=sceneObjectsAt(session,records[0],0)[0];
  updateSceneObject(session,0,object,{point:[18.25,28.75]},1280,720);
  updateSceneObject(session,1,sceneObjectsAt(session,records[1],1)[0],{action:'exclude'},1280,720);
  const output=exportReview(session,clip,'now');
  assert.equal(output.sceneObjects.manualEdits.length,2);
  assert.deepEqual(output.sceneObjects.frames[0].objects[0].point,[18.25,28.75]);
  assert.equal(output.sceneObjects.frames[1].objects.length,0);
  assert.equal(output.entities[0].identityConfirmed,true);assert.equal(session.presentationStable,true);
  assert.deepEqual(session.entities,people);assert.deepEqual(records,frames);
});

test('adopted RTMPose feet retain source and unverified contact in image/court export and human identity confirmation',()=>{
  const session=calibratedSession(),point=buildTrajectories(session,frames).P1[0];
  const candidate={...clip.feetCandidates.frames[0].feet[0],source:clip.feetCandidates.source};
  session.entities[0].anchors=[footCandidateAnchor(point,0,candidate,'left',1280,720)];
  confirmIdentity(session,'P1',0,{box:point.box,trackId:7,preservePosition:true},frames);
  const output=exportReview(session,clip,'now'),entity=output.entities[0];
  assert.equal(entity.identityConfirmed,true);
  for(const value of [entity.trajectory[0],entity.courtTrajectory[0]]){
    assert.equal(value.footMethod,'pose_candidate_human_adopted');assert.equal(value.groundContactConfirmed,false);
    assert.equal(value.footCandidate.source,'rtmpose_s_halpe26');assert.equal(value.footCandidate.contactState,'unknown');
  }
  assert.deepEqual([entity.trajectory[0].x,entity.trajectory[0].y],[198.25,245.75]);
});

test('deleting a reference prevents an unchanged cached profile from reviving its dependents; undo preserves independent human keys',()=>{
  const session=calibratedSession(),before=structuredClone(session),independent=structuredClone(session.courtCalibration.keyframes.find(key=>key.frame===8));
  assert.ok(calibrationAt(session.courtCalibration,4,frames));
  invalidateCameraDependents(session.courtCalibration,0,{referenceDeleted:true});
  session.courtCalibration.keyframes=session.courtCalibration.keyframes.filter(key=>key.frame!==0);
  assert.equal(calibrationAt(session.courtCalibration,4,frames),null);
  acceptCourtCandidates(session,profile,frames.length,'video');
  assert.equal(calibrationAt(session.courtCalibration,4,frames),null);
  assert.equal(calibrationAt(session.courtCalibration,0,frames),null);
  assert.deepEqual(session.courtCalibration.keyframes.find(key=>key.frame===8),independent);
  assert.ok(calibrationAt(before.courtCalibration,4,frames),'undo restores the prior reference and its valid dependent');
  assert.deepEqual(session.entities,before.entities);
});

test('the actual four-corner redraw handler invalidates old camera dependents and keeps unrelated manual calibration',()=>{
  const dom=domFixture();
  try{
    let session=calibratedSession();const history=[],before=structuredClone(session);
    const workspace=createWorkspace({clip,getState:()=>({session,active:'P1',frame:0,mode:'select',video:dom.get('video'),trajectories:buildTrajectories(session,frames)}),
      change:fn=>{history.push(structuredClone(session));fn();},setMode(){},redraw(){},seek(){},toast(){},isSelected:hasAssociation,color:()=> '#38bdf8'});
    workspace.switchStep('calibration');dom.get('startCalibration').onclick();
    for(const [x,y] of image)assert.equal(workspace.handleImageClick(x+10,y),true);
    assert.equal(calibrationAt(session.courtCalibration,4,frames),null);
    assert.deepEqual(session.courtCalibration.keyframes.find(key=>key.frame===8),before.courtCalibration.keyframes.find(key=>key.frame===8));
    assert.deepEqual(session.entities,before.entities);
    session=history.pop();assert.ok(calibrationAt(session.courtCalibration,4,frames));
  }finally{dom.restore();}
});

test('step navigation preserves stable display while the explicit player edit control requests raw editing',()=>{
  const dom=domFixture();
  try{
    const session=calibratedSession();
    const workspace=createWorkspace({clip,getState:()=>({session,active:'P1',frame:0,video:dom.get('video'),trajectories:buildTrajectories(session,frames)}),
      setMode:(mode,{edit=true}={})=>{if(mode==='point'&&edit)session.presentationStable=false;},
      change:fn=>fn(),redraw(){},seek(){},toast(){},isSelected:hasAssociation,color:()=> '#38bdf8'});
    workspace.switchStep('repair');assert.equal(session.presentationStable,true);
    dom.get('repairImage').onclick();assert.equal(session.presentationStable,false);
  }finally{dom.restore();}
});

test('entering 2D review shows the calibrated half without changing player or court data',()=>{
  const dom=domFixture();
  try{
    const session=calibratedSession();session.courtCalibration.keyframes[0].side='right';
    const before=structuredClone(session);
    const workspace=createWorkspace({clip,getState:()=>({session,active:'P1',frame:0,video:dom.get('video'),trajectories:buildTrajectories(session,frames)}),
      setMode(){},change:fn=>fn(),redraw(){},seek(){},toast(){},isSelected:hasAssociation,color:()=> '#38bdf8'});
    workspace.refresh();workspace.switchStep('repair');
    assert.equal(dom.get('courtPan').value,1000);assert.deepEqual(session,before);
    assert.match(dom.get('workflowCourt').textContent,/有可用映射/);
    assert.match(dom.get('workflowMapping').textContent,/当前帧 1 名球员有 2D 位置/);
  }finally{dom.restore();}
});

test('the original calibration reload control preserves deletion intent and independent manual keys',()=>{
  const dom=domFixture();
  try{
    const session=calibratedSession(),independent=structuredClone(session.courtCalibration.keyframes.find(key=>key.frame===8));
    const workspace=createWorkspace({clip:{...clip,courtCalibration:profile},
      getState:()=>({session,active:'P1',frame:0,video:dom.get('video'),trajectories:buildTrajectories(session,frames)}),
      setMode(){},change:fn=>fn(),redraw(){},seek(){},toast(){},isSelected:hasAssociation,color:()=> '#38bdf8'});
    workspace.refresh();dom.get('calibrationList').children[0].children[1].onclick();
    assert.equal(calibrationAt(session.courtCalibration,4,frames),null);
    dom.get('restoreCalibration').onclick();
    assert.equal(calibrationAt(session.courtCalibration,4,frames),null);
    assert.deepEqual(session.courtCalibration.keyframes.find(key=>key.frame===8),independent);
  }finally{dom.restore();}
});

test('reaccepting an old profile preserves an independently reviewed camera frame after its original reference is deleted',()=>{
  const session=calibratedSession(),otherDependent={...structuredClone(dependent),frame:6};
  const candidates={...profile,keyframes:[...profile.keyframes,otherDependent]};
  acceptCourtCandidates(session,candidates,frames.length,'video');
  const key=session.courtCalibration.keyframes.find(key=>key.frame===4);
  const reviewed=confirmCalibrationProjection(key,4,'human-reviewed');
  session.courtCalibration.keyframes=session.courtCalibration.keyframes.map(key=>key.frame===4?reviewed:key);
  const undo=structuredClone(session),people=structuredClone(session.entities),independent=structuredClone(session.courtCalibration.keyframes.find(key=>key.frame===8));
  invalidateCameraDependents(session.courtCalibration,0,{referenceDeleted:true});
  session.courtCalibration.keyframes=session.courtCalibration.keyframes.filter(key=>key.frame!==0);
  assert.ok(calibrationAt(session.courtCalibration,4,frames));
  assert.equal(calibrationAt(session.courtCalibration,6,frames),null);
  const result=acceptCourtCandidates(session,candidates,frames.length,'video');
  assert.equal(result.preserved,1);
  assert.deepEqual(session.courtCalibration.keyframes.find(key=>key.frame===4),reviewed);
  assert.ok(calibrationAt(session.courtCalibration,4,frames));
  assert.equal(calibrationAt(session.courtCalibration,0,frames),null);
  assert.equal(calibrationAt(session.courtCalibration,6,frames),null);
  assert.deepEqual(session.courtCalibration.keyframes.find(key=>key.frame===8),independent);
  assert.deepEqual(session.entities,people);
  assert.ok(calibrationAt(undo.courtCalibration,0,frames));
  assert.ok(calibrationAt(undo.courtCalibration,6,frames));
  assert.deepEqual(undo.courtCalibration.keyframes.find(key=>key.frame===4),reviewed);
});

test('the actual calibration restore and current-frame candidate controls preserve independent human projection review and undo',()=>{
  const dom=domFixture();
  try{
    let session=calibratedSession(),frame=4;const history=[],otherDependent={...structuredClone(dependent),frame:6};
    const candidates={...profile,keyframes:[...profile.keyframes,otherDependent]};
    acceptCourtCandidates(session,candidates,frames.length,'video');
    const before=structuredClone(session);
    const workspace=createWorkspace({clip:{...clip,courtCalibration:candidates,courtCandidates:candidates},
      getState:()=>({session,active:'P1',frame,video:dom.get('video'),trajectories:buildTrajectories(session,frames)}),
      setMode(){},change:fn=>{history.push(structuredClone(session));fn();},redraw(){},seek(){},toast(){},isSelected:hasAssociation,color:()=> '#38bdf8'});
    workspace.switchStep('calibration');dom.get('confirmCalibration').onclick();
    const reviewed=structuredClone(session.courtCalibration.keyframes.find(key=>key.frame===4));
    assert.ok(reviewed.projectionReviewedAt);assert.equal(reviewed.cameraSupportFrame,4);
    assert.equal(reviewed.quality.cameraSupportReviewSource,'human_projection_review');
    frame=0;workspace.refresh();dom.get('calibrationList').children[0].children[1].onclick();
    assert.ok(calibrationAt(session.courtCalibration,4,frames));
    assert.equal(calibrationAt(session.courtCalibration,6,frames),null);
    const beforeRestore=structuredClone(session);
    dom.get('restoreCalibration').onclick();
    assert.deepEqual(session.courtCalibration.keyframes.find(key=>key.frame===4),reviewed);
    assert.ok(calibrationAt(session.courtCalibration,4,frames));
    assert.equal(calibrationAt(session.courtCalibration,0,frames),null);
    assert.equal(calibrationAt(session.courtCalibration,6,frames),null);
    assert.deepEqual(session.courtCalibration.keyframes.find(key=>key.frame===8),before.courtCalibration.keyframes.find(key=>key.frame===8));
    assert.deepEqual(session.entities,before.entities);
    session=history.pop();assert.deepEqual(session,beforeRestore,'undo reload restores the exact preceding review state');
    frame=4;workspace.refresh();const historyLength=history.length;
    dom.get('loadCourtCandidate').onclick();
    assert.deepEqual(session.courtCalibration.keyframes.find(key=>key.frame===4),reviewed);
    assert.equal(history.length,historyLength,'a preserved review does not create an overwrite/undo entry');
    session=history.pop();assert.ok(calibrationAt(session.courtCalibration,0,frames));
    assert.ok(calibrationAt(session.courtCalibration,6,frames));
    assert.deepEqual(session.courtCalibration.keyframes.find(key=>key.frame===4),reviewed,'undo reference deletion retains the independent review');
  }finally{dom.restore();}
});

test('the actual app gives scene picking priority over an existing P path mode without changing stable display or player anchors',async()=>{
  const dom=domFixture();
  try{
    const session=calibratedSession(),sparseClip={...clip,frames:frames.map((record,index)=>({...record,tracks:[0,8].includes(index)?record.tracks:[]}))};
    const saved=new Map([[draftStorageKey(sparseClip,'ebard',true),JSON.stringify(session)]]);
    const policy=JSON.parse(readFileSync(new URL('./team-overlay-policy.json',import.meta.url)));
    Object.assign(globalThis,{localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)},
      fetch:async url=>({ok:true,json:async()=>url==='/api/library'?{defaultSample:'test',samples:[{id:'test',defaultVariant:'ebard'}]}:url.startsWith('/api/commentary?')?{status:{},plan:null,job:null}:url==='/team-overlay-policy.json'?policy:sparseClip})});
    let appApi;
    const source=readFileSync(new URL('./app.mjs',import.meta.url),'utf8'),imports=[...source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)],dependencies={};
    for(const match of imports){
      if(match[2]==='./ui.bundle.mjs'){dependencies.mountIdentityUI=()=>({render(){}});
        dependencies.mountVideoDisplay=({video,stage,startTime,onReady})=>{
          stage.dataset.videoState='ready';video.currentTime=startTime;onReady?.({time:startTime});
          return {pause:()=>video.pause(),seek:time=>{video.pause();video.currentTime=time;},
            reload:()=>{video.pause();video.currentTime=startTime;},togglePlayback:()=>video.paused?video.play():video.pause()};
        };continue;}
      if(match[2]==='./footage-ui.mjs'){dependencies.mountFootageUI=()=>({render(){}});continue;}
      if(match[2]==='./workspace.mjs'){dependencies.createWorkspace=api=>{appApi=api;return {refresh(){},draw(){},drawImageOverlay(){},switchStep(){},handleImageClick:()=>false};};continue;}
      const module=await import(new URL(match[2],import.meta.url));
      for(const specifier of match[1].split(',')){const [name,alias=name]=specifier.trim().split(/\s+as\s+/);dependencies[alias]=module[name];}
    }
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFunction(...Object.keys(dependencies),source.replace(/^import .*;\r?\n/gm,''))(...Object.values(dependencies));
    const panel=dom.get('tacticsPanel'),heading=panel.querySelector('.tactics-heading'),commentary=panel.children[panel.children.indexOf(heading)+1];
    assert.equal(commentary.tag,'section');assert.equal(commentary.parentElement,panel);assert.equal(commentary.className,'commentary-ui');
    appApi.setMode('path');dom.get('stableDisplay').checked=true;
    for(const handler of dom.get('stableDisplay').listeners.change)handler({target:dom.get('stableDisplay')});
    const key=draftStorageKey(sparseClip,'ebard',true),before=JSON.parse(saved.get(key));
    dom.get('add-basketball').onclick();
    const event=(x,y)=>({button:0,clientX:x,clientY:y,pointerId:1,preventDefault(){}});
    for(const handler of dom.get('overlay').listeners.pointerdown)handler(event(18.25,28.75));
    for(const handler of dom.get('overlay').listeners.pointermove)handler(event(22.25,32.75));
    for(const handler of dom.get('overlay').listeners.pointerup)handler(event(22.25,32.75));
    for(const handler of dom.get('overlay').listeners.click)handler(event(18.25,28.75));
    const after=JSON.parse(saved.get(key));
    assert.deepEqual(after.entities,before.entities);assert.equal(after.presentationStable,true);
    assert.ok(after.sceneObjectEdits[0].point.every((value,index)=>Math.abs(value-[18.25,28.75][index])<1e-9));
  }finally{dom.restore();}
});

test('identity reference actions in the actual app require the decoded target frame and confirm only that frame',async()=>{
  const dom=domFixture();
  try{
    const session=blankSession(clip.video_sha256);
    for(const entity of session.entities)entity.identitySuggestionsDismissed=true;
    const key=draftStorageKey(clip,'ebard',true),saved=new Map([[key,JSON.stringify(session)]]),jobRequests=[];
    const policy=JSON.parse(readFileSync(new URL('./team-overlay-policy.json',import.meta.url)));
    Object.assign(globalThis,{localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)},
      fetch:async(url,options)=>{
        let value;
        if(url==='/api/library')value={defaultSample:'test',samples:[{id:'test',defaultVariant:'ebard'}]};
        else if(url.startsWith('/api/commentary?'))value={status:{},plan:null,job:null};
        else if(url==='/team-overlay-policy.json')value=policy;
        else if(url==='/api/identity-agent/status')value={available:true,provider:'test-fixture'};
        else if(url==='/api/identity-agent/jobs'){
          const request=JSON.parse(options.body);jobRequests.push(request);
          if(request.purpose==='initial_review')value={jobId:'initial-test',status:'failed',purpose:'initial_review',base:{clientRevision:request.clientRevision},sourceKey:'fixture-initial',message:'初检未完成，手工编辑可继续'};
          else value={jobId:'reference-test',status:'ready',purpose:'reference',entityId:'P1',candidate:{team:'紫衣',jersey:'10',segments:[]},previewFrames:[]};
        }else value=clip;
        return {ok:true,json:async()=>value};
      }});
    let uiApi,uiState,workspaceApi,presentFrame;
    const source=readFileSync(new URL('./app.mjs',import.meta.url),'utf8'),imports=[...source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)],dependencies={};
    for(const match of imports){
      if(match[2]==='./ui.bundle.mjs'){
        dependencies.mountIdentityUI=api=>{uiApi=api;return {render:state=>{uiState=state;}};};
        dependencies.mountVideoDisplay=({video,stage,startTime,onFrame})=>{
          presentFrame=time=>{stage.dataset.videoState='ready';video.currentTime=time;onFrame({time});};
          stage.dataset.videoState='ready';video.currentTime=startTime;
          return {pause:()=>video.pause(),seek:time=>{video.pause();video.currentTime=time;stage.dataset.videoState='seeking';},
            reload:()=>{stage.dataset.videoState='seeking';},togglePlayback:()=>video.paused?video.play():video.pause()};
        };continue;
      }
      if(match[2]==='./footage-ui.mjs'){dependencies.mountFootageUI=()=>({render(){}});continue;}
      if(match[2]==='./workspace.mjs'){dependencies.createWorkspace=api=>{workspaceApi=api;return {refresh(){},draw(){},drawImageOverlay(){},switchStep(){},handleImageClick:()=>false};};continue;}
      const module=await import(new URL(match[2],import.meta.url));
      for(const specifier of match[1].split(',')){const [name,alias=name]=specifier.trim().split(/\s+as\s+/);dependencies[alias]=module[name];}
    }
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFunction(...Object.keys(dependencies),source.replace(/^import .*;\r?\n/gm,''))(...Object.values(dependencies));
    await new Promise(resolve=>setImmediate(resolve));
    presentFrame(frames[0].time);
    assert.equal(uiState.referenceFrameReady,true);
    const before=structuredClone(workspaceApi.getState().session),persistedBefore=saved.get(key),input={trackId:7,team:'紫衣',jersey:'10'};
    uiApi.seek(4);
    assert.equal(workspaceApi.getState().frame,4,'the logical frame has moved before decoding');
    assert.equal(uiState.referenceFrameReady,false);
    uiApi.saveIdentityReference(input);await uiApi.recognizeIdentity(input);
    assert.deepEqual(workspaceApi.getState().session,before);
    assert.equal(saved.get(key),persistedBefore);assert.equal(uiState.canUndo,false);
    assert.equal(jobRequests.filter(job=>job.purpose==='reference').length,0,'no per-person model job may use a frame the user has not seen');
    assert.equal(jobRequests.filter(job=>job.purpose==='initial_review').length,1,'whole-video initial review starts independently');
    dom.get('stage').dataset.videoState='ready';uiApi.identityReferenceCandidate(7);
    assert.equal(uiState.referenceFrameReady,false,'ready status alone cannot certify the old decoded frame');
    uiApi.saveIdentityReference(input);assert.deepEqual(workspaceApi.getState().session,before);
    presentFrame(frames[4].time);
    assert.equal(uiState.referenceFrameReady,true,'onFrame must publish its decoded frame before rendering controls');
    uiApi.saveIdentityReference(input);
    const after=workspaceApi.getState().session,player=after.entities.find(entity=>entity.id==='P1');
    assert.equal(player.identityReference.frame,4);assert.equal(player.identityReference.trackId,7);
    assert.deepEqual(player.frameConfirmations.map(review=>review.frame),[4]);
    assert.deepEqual(buildTrajectories(after,frames).P1.filter(point=>point.frameIdentityConfirmed).map(point=>point.frame),[4]);
    assert.equal(uiState.canUndo,true);
    await uiApi.recognizeIdentity(input);
    const references=jobRequests.filter(job=>job.purpose==='reference');
    assert.equal(references.length,1);assert.equal(references[0].reference.frame,4);
    dom.get('undo').click=()=>{for(const handler of dom.get('undo').listeners.click||[])handler({});};
    uiApi.undo();assert.deepEqual(workspaceApi.getState().session,before,'one undo restores the complete pre-reference draft');
  }finally{dom.restore();}
});
