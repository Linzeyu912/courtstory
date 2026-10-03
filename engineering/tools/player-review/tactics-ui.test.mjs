import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {mountTacticsUI} from './tactics-ui.mjs';
import {createSourceBinding} from '../tactical-overlay/binding.mjs';
let environmentId=0;

function environment(source,{player=false}={}){
  const nodes=new Map(),events={},writes=[],saved=[],store=new Map();let hold=false,releases=[],frameRequests=0;
  function make(tag='div'){
    const node={tag,children:[],attrs:{},listeners:{},style:{},value:'',checked:false,clientWidth:800,hidden:false,textContent:'',
      append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;if(tag==='select')this.value=children[0]?.value||'';},
      setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]??null;},remove(){this.removed=true;},
      querySelector(selector){if(selector==='svg')return this.children.find(n=>n.tag==='svg')||null;return this.children.find(n=>!n.removed&&selector==='[data-edit-handles]'&&n.attrs['data-edit-handles'])||null;},
      addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);},setPointerCapture(id){this.pointer=id;},hasPointerCapture(id){return this.pointer===id;},releasePointerCapture(){this.pointer=null;},click(){},
      getContext:()=>({drawImage(){}}),getScreenCTM:()=>({inverse:()=>({})}),createSVGPoint:()=>({matrixTransform(){return {x:this.x,y:this.y};}})};
    Object.defineProperty(node,'innerHTML',{get(){return this.html||'';},set(value){this.html=value;this.children=value.startsWith('<svg')?[make('svg')]:[];}});
    return node;
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
  const originals=new Map(['document','window','location','Image','ResizeObserver','indexedDB','localStorage','fetch'].map(k=>[k,globalThis[k]]));
  const database={transaction(_store,mode){const tx={objectStore:()=>({
    get(key){const r={};queueMicrotask(()=>{r.result=store.get(key);r.onsuccess();});return r;},
    put(value,key){const finish=()=>{store.set(key,structuredClone(value));writes.push(structuredClone(value));tx.oncomplete();};if(hold)releases.push(finish);else queueMicrotask(finish);}
  })};return tx;}};
  Object.assign(globalThis,{
    document:{body:{dataset:{area:'tactics'}},getElementById:get,createElement:make,createElementNS:(_ns,tag)=>make(tag),addEventListener:(name,fn)=>events[name]=fn},
    window:{history:{replaceState(){}}},location:{search:'?sample=test&qa=1'},Image:class{async decode(){}},ResizeObserver:class{observe(){}},
    localStorage:{getItem:()=>null},indexedDB:{open(){const r={};queueMicrotask(()=>{r.result=database;r.onsuccess();});return r;}},
    fetch:async(path,options)=>{
      let value;if(path.startsWith('/api/tactics?'))value={version:0,document:source};
      else if(path==='/api/tactics/frame'){frameRequests++;value={frames:JSON.parse(options.body).frames.map(frame=>({...source.review.sourceFrameMapping[frame],videoSha256:source.review.videoSha256,dataUrl:'data:image/jpeg;base64,/9j/'}))};}
      else if(path==='/api/tactics/save'){const payload=JSON.parse(options.body);saved.push(payload);value={version:payload.expectedVersion+1};}
      else throw new Error(path);return {ok:true,json:async()=>value};
    }
  });
  let point=null,paused=true,seekSerial=0,seekHeld=false,pendingSeeks=[];const playerCalls=[],background={kind:'decoded-canvas'};
  const present=(frame)=>{seekSerial++;point={frame,time:source.review.sourceFrameMapping[frame].time,source:background,paused};ui.onPresentedFrame?.(point);};
  const bridge=player?{seek(frame){const serial=++seekSerial;playerCalls.push(['seek',frame]);paused=true;const done=()=>{if(serial===seekSerial)present(frame);};if(seekHeld)pendingSeeks.push(done);else queueMicrotask(done);},play(){paused=false;playerCalls.push(['play']);},getPresentedFrame:()=>point}:{};
  const ui=mountTacticsUI({key:`player-review:ui-fixture-${++environmentId}:qa`,sample:'test',variant:'test',qa:true,title:'fixture',clip:{video_sha256:source.review.videoSha256},pause(){paused=true;playerCalls.push(['pause']);},snapshot:()=>source.review,frame:()=>point?.frame??12,openStep(){},...bridge});
  return {get,ui,writes,saved,store,playerCalls,present,background,get frameRequests(){return frameRequests;},get pendingWrites(){return releases.length;},
    holdSeek(){seekHeld=true;},finishSeek(){seekHeld=false;for(const done of pendingSeeks.splice(0))done();},
    async load(){await events['workbench-area']();await ui.ready();},
    async exit(){await events['workbench-area']();},
    async event(name,event){for(const fn of get('tacticsCanvas').listeners[name]||[])await fn({button:0,preventDefault(){},...event});},
    selectRoute(){const route=ui.getSceneState().model.routes.find(r=>r.entityId==='P1');get('tacticsRoute').value=route.routeId;get('tacticsRoute').onchange();return route;},
    handle(index){return {closest:selector=>selector==='[data-control-index]'?{getAttribute:()=>String(index)}:null};},
    hold(){hold=true;},release(){hold=false;for(const release of releases.splice(0))release();},
    restore(){for(const [k,v] of originals){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
  };
}
// One mounted session exercises the real UI handlers, asynchronous validation and queued drafts.
test('mounted UI edits persist through concurrent notes/title, keeps the canvas stable, cancels phase gestures and restores/undoes separately from review',async()=>{
  const f=await makePresentationDemo(),d={schemaVersion:1,title:'fixture',notes:'',...f},before=structuredClone(d.review),env=environment(d);
  try{
    await env.load();assert.match(env.get('tacticsRouteHint').textContent,/先选择/);
    const state=env.ui.getSceneState(),canvas=state.background,route=env.selectRoute(),point=route.controlPoints[0];
    const host=env.get('tacticsCanvas'),overlay=host.children[0].children[1];
    assert.doesNotMatch(overlay.innerHTML,/<text\b|<foreignObject\b/);
    await env.event('pointerdown',{pointerId:1,target:env.handle(0)});
    await env.event('pointermove',{pointerId:1,clientX:(point.x+.2)*40,clientY:point.y*40});
    assert.equal(env.writes.at(-1).document.presentation,undefined);
    env.hold();const pending=env.event('pointerup',{pointerId:1});await Promise.resolve();await Promise.resolve();
    assert.equal(env.ui.getSceneState().editBusy,true);
    await env.event('pointerdown',{pointerId:2,target:env.handle(0)});await env.event('pointermove',{pointerId:2,clientX:40,clientY:80});await env.event('pointerup',{pointerId:2});
    for(let i=0;i<50&&!env.pendingWrites;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(env.pendingWrites,1,'route document is applied and waiting on the deliberately slow draft');
    env.get('tacticsNotes').value='new notes while route save waits';env.get('tacticsNotes').oninput();
    env.get('tacticsTitle').value='new title while route save waits';env.get('tacticsTitle').oninput();
    const initialRequests=env.frameRequests;env.release();await pending;await env.ui.saveDraft();
    let draft=env.writes.at(-1).document;assert.equal(draft.presentation.routes.length,1);
    assert.ok(Math.abs(draft.presentation.routes[0].controlPoints[0].x-point.x-.2)<1e-6);
    assert.deepEqual(draft.review,before);assert.equal(env.ui.getSceneState().background,canvas);
    assert.equal(env.frameRequests,initialRequests,'presentation-only commit reuses the decoded freeze frame');
    const applied=env.ui.getSceneState().model.routes.find(r=>r.routeId===route.routeId);
    assert.equal(applied.manual,true,'model must reflect the saved presentation before editing unlocks');
    assert.ok(Math.abs(applied.controlPoints[0].x-point.x-.2)<1e-6);
    assert.equal(draft.notes,'new notes while route save waits');assert.equal(draft.title,'new title while route save waits');
    assert.equal(env.get('tacticsNotes').value,draft.notes);assert.equal(env.get('tacticsTitle').value,draft.title);
    env.get('tacticsRoutePlayer').value='P2';env.get('tacticsRoutePlayer').onchange();env.get('tacticsRoutePlayer').value='P1';env.get('tacticsRoutePlayer').onchange();env.selectRoute();
    const internal=applied.controlPoints[1];
    await env.event('pointerdown',{pointerId:4,target:env.handle(1)});await env.event('pointermove',{pointerId:4,clientX:internal.x*40,clientY:(internal.y+.1)*40});await env.event('pointerup',{pointerId:4});
    draft=env.writes.at(-1).document;assert.ok(Math.abs(draft.presentation.routes[0].controlPoints[0].x-point.x-.2)<1e-6,'later drag retains the first saved point');
    assert.equal(draft.notes,'new notes while route save waits');assert.equal(draft.title,'new title while route save waits');
    await env.get('tacticsSave').onclick();assert.equal(env.saved[0].qa,true);assert.equal(env.saved[0].kind,'workspace');assert.deepEqual(env.saved[0].document.presentation,draft.presentation);
    await env.get('tacticsWorkspace').onclick();await env.ui.ready();
    assert.equal(env.ui.getSceneState().model.routes.find(r=>r.routeId===route.routeId).manual,true,'IndexedDB reload retains presentation');
    env.selectRoute();await env.get('tacticsInsertPoint').onclick();draft=env.writes.at(-1).document;
    assert.equal(draft.presentation.routes[0].controlPoints.length,route.controlPoints.length+1);
    assert.equal(env.get('tacticsDeletePoint').disabled,false,'inserted internal point remains selected after rebuild');
    await env.get('tacticsDeletePoint').onclick();assert.equal(env.writes.at(-1).document.presentation.routes[0].controlPoints.length,route.controlPoints.length);
    const count=env.writes.length;
    await env.event('pointerdown',{pointerId:3,target:env.handle(0)});await env.event('pointermove',{pointerId:3,clientX:40,clientY:80});
    env.get('tacticsPhases').children[1].onclick();await env.ui.ready();await env.event('pointerup',{pointerId:3});assert.equal(env.writes.length,count);
    env.get('tacticsPhases').children[0].onclick();await env.ui.ready();env.selectRoute();
    await env.get('tacticsRestoreRoute').onclick();assert.equal(env.writes.at(-1).document.presentation,undefined);
    await env.get('tacticsUndo').onclick();assert.equal(env.writes.at(-1).document.presentation.routes.length,1);assert.deepEqual(env.writes.at(-1).document.review,before);
  }finally{env.release();env.restore();}
});

test('mounted playback reuses decoded frames, trims cached routes, pauses on skipped freeze, seeks backwards and exits safely',async()=>{
  const f=await makePresentationDemo();f.review.court.calibration.keyframes=f.review.court.calibration.keyframes.filter(k=>k.frame!==20);f.playDefinition.sourceBinding=await createSourceBinding(f.review);
  const d={schemaVersion:1,title:'fixture',notes:'',...f},env=environment(d,{player:true});
  try{
    await env.load();await Promise.resolve();assert.equal(env.frameRequests,0);
    assert.equal(env.ui.getSceneState().frame,12);const model=env.ui.getSceneState().model,canvas=env.ui.getSceneState().background;
    await env.get('tacticsContinue').onclick();assert.equal(env.ui.getPlaybackState().status,'playing');
    env.present(20);assert.equal(env.ui.getSceneState().model,model);assert.equal(env.ui.getSceneState().background,canvas);assert.equal(canvas.hidden,false);
    const overlay=env.get('tacticsCanvas').children[0].children[1];assert.doesNotMatch(overlay.innerHTML,/<polyline|<text\b/);assert.match(env.get('tacticsPresentationStatus').textContent,/缺少有效标定/);
    env.present(26);const remaining=env.ui.getSceneState().model.routes[0];assert.ok(remaining.curve.length>1);
    env.present(49);await env.ui.ready();await Promise.resolve();assert.equal(env.ui.getSceneState().phaseId,'finish');assert.equal(env.ui.getSceneState().frame,42);assert.equal(env.ui.getPlaybackState().status,'paused');
    const stops=env.playerCalls.filter(c=>c[0]==='seek'&&c[1]===42).length;env.present(42);assert.equal(env.playerCalls.filter(c=>c[0]==='seek'&&c[1]===42).length,stops);
    await env.get('tacticsReplay').onclick();await Promise.resolve();assert.equal(env.ui.getPlaybackState().status,'playing');
    env.ui.externalSeek(16);env.present(16);await env.ui.ready();assert.equal(env.ui.getSceneState().phaseId,'setup');assert.equal(env.ui.getPlaybackState().status,'paused');
    env.holdSeek();env.get('tacticsPhases').children[1].onclick();await env.ui.ready();
    assert.equal(env.ui.getSceneState().background.hidden,true,'a ready new model cannot paint on the previous phase decoded background while seeking');
    assert.equal(overlay.children.length,0);env.finishSeek();assert.equal(env.ui.getSceneState().background.hidden,false);
    env.get('tacticsPhases').children[0].onclick();await env.ui.ready();
    env.get('tacticsPhases').children[1].onclick();env.ui.externalSeek(50);env.present(50);await env.ui.ready();
    assert.ok(env.ui.getSceneState().model,'external seek during same-phase preparation must keep a current model');assert.equal(env.ui.getSceneState().frame,50);
    assert.equal(env.frameRequests,0);const plays=env.playerCalls.filter(c=>c[0]==='play').length;
    globalThis.document.body.dataset.area='footage';await env.exit();env.present(60);assert.equal(env.ui.getPlaybackState().status,'inactive');assert.equal(env.playerCalls.filter(c=>c[0]==='play').length,plays);
  }finally{env.restore();}
});

test('same-phase seek during a saved presentation rebuild applies the new model before edits unlock and retains the first edit',async()=>{
  const f=await makePresentationDemo(),env=environment({schemaVersion:1,title:'fixture',notes:'',...f},{player:true});
  const subtle=globalThis.crypto.subtle,own=Object.getOwnPropertyDescriptor(subtle,'digest'),real=subtle.digest;
  let release,blocked;const gate=new Promise(resolve=>release=resolve),reached=new Promise(resolve=>blocked=resolve);
  try{
    await env.load();const route=env.selectRoute(),first=route.controlPoints[0],changedX=first.x+.2;
    await env.event('pointerdown',{pointerId:7,target:env.handle(0)});
    await env.event('pointermove',{pointerId:7,clientX:changedX*40,clientY:first.y*40});
    Object.defineProperty(subtle,'digest',{configurable:true,value:async function(algorithm,data){
      const value=JSON.parse(new TextDecoder().decode(data));
      if(value?.points&&Object.hasOwn(value,'breakBefore')){blocked();await gate;}
      return real.call(this,algorithm,data);
    }});
    const pending=env.event('pointerup',{pointerId:7});await reached;await env.ui.saveDraft();
    await env.get('tacticsSave').onclick();assert.ok(Math.abs(env.saved.at(-1).document.presentation.routes[0].controlPoints[0].x-changedX)<1e-6);
    assert.equal(env.ui.getSceneState().editBusy,true);assert.equal(env.ui.getSceneState().model.routes.find(r=>r.routeId===route.routeId).manual,false);
    env.ui.externalSeek(16);env.present(16);assert.equal(env.ui.getSceneState().editBusy,true);
    release();await pending;await env.ui.ready();
    const updated=env.ui.getSceneState().model.routes.find(r=>r.routeId===route.routeId);
    assert.equal(updated.manual,true,'same-phase time navigation must not invalidate a newly saved document model');
    assert.ok(Math.abs(updated.controlPoints[0].x-changedX)<1e-6);assert.equal(env.ui.getSceneState().frame,16);assert.equal(env.ui.getSceneState().editBusy,false);
    env.get('tacticsRoutePlayer').value='P2';env.get('tacticsRoutePlayer').onchange();env.get('tacticsRoutePlayer').value='P1';env.get('tacticsRoutePlayer').onchange();env.selectRoute();
    const second=updated.controlPoints[1];await env.event('pointerdown',{pointerId:8,target:env.handle(1)});
    await env.event('pointermove',{pointerId:8,clientX:second.x*40,clientY:(second.y+.1)*40});await env.event('pointerup',{pointerId:8});
    await env.get('tacticsSave').onclick();assert.ok(Math.abs(env.saved.at(-1).document.presentation.routes[0].controlPoints[0].x-changedX)<1e-6,'editing another point must retain the saved first point');
  }finally{release();if(own)Object.defineProperty(subtle,'digest',own);else delete subtle.digest;env.restore();}
});
