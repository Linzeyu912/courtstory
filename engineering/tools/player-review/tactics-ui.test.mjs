import test from 'node:test';
import assert from 'node:assert/strict';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {mountTacticsUI} from './tactics-ui.mjs';
import {createSourceBinding} from '../tactical-overlay/binding.mjs';
import {courtToVideo} from './tactics-presentation.mjs';
let environmentId=0;
// The storage module keeps one IDB connection for the mounted application.
// Route that connection to each test's transaction store rather than the first fixture.
let activeDatabase;
const connection={transaction(...args){return activeDatabase.transaction(...args);}};

function environment(source,{player=false,empty=false}={}){
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
  activeDatabase=database;Object.assign(globalThis,{
    document:{body:{dataset:{area:'tactics'}},getElementById:get,createElement:make,createElementNS:(_ns,tag)=>make(tag),addEventListener:(name,fn)=>events[name]=fn},
    window:{history:{replaceState(){}}},location:{search:'?sample=test&qa=1'},Image:class{async decode(){}},ResizeObserver:class{observe(){}},
    localStorage:{getItem:()=>null},indexedDB:{open(){const r={};queueMicrotask(()=>{r.result=connection;r.onsuccess();});return r;}},
    fetch:async(path,options)=>{
      let value;if(path.startsWith('/api/tactics?'))value={version:0,document:empty?null:source};
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
    selectRoute(){get('tacticsShowReference').checked=true;get('tacticsShowReference').onchange?.();const route=ui.getSceneState().model.routes.find(r=>r.entityId==='P1');get('tacticsRoute').value=route.routeId;get('tacticsRoute').onchange();return route;},
    target(attrs={}){return {closest:selector=>{const key=selector.slice(1,-1);return Object.hasOwn(attrs,key)?{getAttribute:k=>attrs[k]??null}:null;}};},
    async key(key,extra={}){await events.keydown?.({key,target:{tagName:'DIV'},preventDefault(){},...extra});},
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

test('canvas creates and edits an independent route with no detected route, saves/reloads, and undoes without changing evidence',async()=>{
  const f=await makePresentationDemo();for(const e of f.review.entities)e.trajectory=[];
  f.playDefinition.sourceBinding=await createSourceBinding(f.review);
  const d={schemaVersion:1,title:'manual canvas',notes:'',...f},before=structuredClone(f.review),env=environment(d);
  try{
    await env.load();assert.equal(env.ui.getSceneState().model.routes.length,0);
    assert.equal(env.get('tacticsShowReference').checked,false,'no automatic route clutter by default');
    assert.equal(typeof env.get('tacticsToolRoute').onclick,'function');
    await env.get('tacticsToolRoute').onclick();
    for(const [i,p] of [[400,320],[540,270],[660,330]].entries())await env.event('pointerdown',{pointerId:20+i,target:env.target(),clientX:p[0],clientY:p[1]});
    assert.match(env.get('tacticsToolHint').textContent,/完成绘制/);assert.equal(env.get('tacticsFinishDrawing').disabled,false);
    await env.get('tacticsFinishDrawing').onclick();await env.ui.saveDraft();
    let a=env.writes.at(-1).document.annotations.items[0];assert.equal(a.type,'route');assert.equal(a.points.length,3);
    assert.deepEqual(env.writes.at(-1).document.review,before);assert.equal(env.get('tacticsObjectList').children.length,1);
    const routeId=a.id,originalX=a.points[1].x;
    await env.event('pointerdown',{pointerId:30,target:env.target({'data-annotation-control-index':'1','data-annotation-id':routeId}),clientX:540,clientY:270});
    await env.event('pointermove',{pointerId:30,clientX:580,clientY:280});await env.event('pointerup',{pointerId:30});
    a=env.writes.at(-1).document.annotations.items[0];assert.notEqual(a.points[1].x,originalX);
    await env.get('tacticsAnnotationDeletePoint').onclick();assert.equal(env.writes.at(-1).document.annotations.items[0].points.length,2);
    await env.get('tacticsUndo').onclick();assert.equal(env.writes.at(-1).document.annotations.items[0].points.length,3);
    await env.get('tacticsAnnotationAddPoint').onclick();await env.event('pointerdown',{pointerId:31,target:env.target(),clientX:620,clientY:320});
    assert.equal(env.writes.at(-1).document.annotations.items[0].points.length,4);
    await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.annotations.items[0].points.length,4);
    await env.get('tacticsWorkspace').onclick();await env.ui.ready();assert.equal(env.ui.getSceneState().annotations.items.length,1);
    assert.equal(env.ui.getSceneState().annotations.items[0].id,routeId);
  }finally{env.restore();}
});

test('screen and player spotlight are visible independent objects; playback and phase changes discard incomplete gestures',async()=>{
  const f=await makePresentationDemo(),env=environment({schemaVersion:1,title:'marks',notes:'',...f},{player:true});
  try{
    await env.load();await env.get('tacticsToolScreen').onclick();
    await env.event('pointerdown',{pointerId:41,target:env.target(),clientX:650,clientY:300});
    let items=env.writes.at(-1).document.annotations.items;assert.equal(items[0].type,'screen');
    assert.equal(env.get('tacticsContinue').disabled,false,'finishing a manual edit must restore the visible preview button');
    const overlay=env.get('tacticsCanvas').children[0].children[1];assert.match(overlay.innerHTML,/data-annotation-id/);
    env.get('tacticsAnnotationAngle').value='45';await env.get('tacticsAnnotationAngle').onchange();
    assert.equal(env.writes.at(-1).document.annotations.items[0].style.angle,45);
    await env.get('tacticsToolSpotlight').onclick();await env.event('pointerdown',{pointerId:42,target:env.target(),clientX:720,clientY:410});
    items=env.writes.at(-1).document.annotations.items;assert.equal(items[1].type,'spotlight');assert.equal(items[1].followEntity,true);
    assert.match(overlay.innerHTML,/<(?:ellipse|polygon|path)\b/);assert.doesNotMatch(overlay.innerHTML,/<text\b/);
    await env.get('tacticsAnnotationDelete').onclick();assert.equal(env.writes.at(-1).document.annotations.items.length,1);
    await env.get('tacticsUndo').onclick();assert.equal(env.writes.at(-1).document.annotations.items.length,2);
    await env.get('tacticsToolRoute').onclick();await env.event('pointerdown',{pointerId:43,target:env.target(),clientX:600,clientY:360});
    await env.get('tacticsContinue').onclick();assert.equal(env.ui.getSceneState().drawingPoints,0);
    env.get('tacticsPause').onclick();await env.get('tacticsToolRoute').onclick();await env.event('pointerdown',{pointerId:44,target:env.target(),clientX:600,clientY:360});
    env.get('tacticsPhases').children[1].onclick();await env.ui.ready();assert.equal(env.ui.getSceneState().drawingPoints,0);
    assert.equal(env.writes.at(-1).document.annotations.items.length,2);
    await env.get('tacticsToolRoute').onclick();await env.event('pointerdown',{pointerId:45,target:env.target(),clientX:600,clientY:360});
    await env.key('Escape');assert.equal(env.ui.getSceneState().drawingPoints,0);
  }finally{env.restore();}
});

test('selected marker actions stay beside the canvas and rotate/delete/undo/save/reload the selected object',async()=>{
  const f=await makePresentationDemo(),env=environment({schemaVersion:1,title:'marker actions',notes:'',...f},{player:true});
  try{
    await env.load();assert.equal(env.get('tacticsSelectionActions').hidden,true);
    await env.get('tacticsToolScreen').onclick();await env.event('pointerdown',{pointerId:61,target:env.target(),clientX:650,clientY:300});
    let a=env.ui.getSceneState().annotations.items[0];const id=a.id;
    assert.equal(env.ui.getSceneState().selectedAnnotationId,id);assert.equal(env.get('tacticsSelectionActions').hidden,false);
    assert.equal(env.get('tacticsSelectionRotation').hidden,false);assert.equal(env.get('tacticsQuickAngle').textContent,'0°');
    await env.get('tacticsRotateLeft').onclick();assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,345);
    await env.get('tacticsRotateRight').onclick();assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,0);
    env.get('tacticsAnnotationAngle').value='95';
    await env.get('tacticsAnnotationAngle').onchange();assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,95);
    await env.get('tacticsQuickDelete').onclick();assert.equal(env.ui.getSceneState().annotations.items.length,0);
    assert.equal(env.get('tacticsSelectionActions').hidden,true);assert.equal(env.ui.getSceneState().selectedAnnotationId,null);
    assert.match(env.get('tacticsStatus').textContent,/已删除挡拆标记.*撤销/);
    await env.get('tacticsUndo').onclick();assert.equal(env.ui.getSceneState().annotations.items[0].id,id);
    assert.equal(env.get('tacticsSelectionActions').hidden,false);assert.equal(env.get('tacticsQuickAngle').textContent,'95°');
    await env.get('tacticsSave').onclick();assert.equal(env.saved.at(-1).document.annotations.items[0].style.angle,95);
    await env.get('tacticsWorkspace').onclick();await env.ui.ready();
    assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,95);
    env.get('tacticsObjectList').children[0].onclick();await env.get('tacticsDeselect').onclick();
    assert.equal(env.ui.getSceneState().selectedAnnotationId,null);assert.equal(env.get('tacticsSelectionActions').hidden,true);
    await env.event('pointerdown',{pointerId:62,target:env.target({'data-annotation-id':id}),clientX:650,clientY:300});await env.event('pointerup',{pointerId:62});
    await env.key('Delete');assert.equal(env.ui.getSceneState().annotations.items.length,0);await env.get('tacticsUndo').onclick();
    await env.get('tacticsToolSpotlight').onclick();await env.event('pointerdown',{pointerId:63,target:env.target(),clientX:720,clientY:400});
    assert.equal(env.get('tacticsSelectionRotation').hidden,true);assert.equal(env.get('tacticsQuickDelete').disabled,false);
    await env.get('tacticsQuickDelete').onclick();assert.equal(env.ui.getSceneState().annotations.items.length,1);
  }finally{env.restore();}
});

test('rotation handle uses original annotation space, previews without writing, and cancels on seek or phase change',async()=>{
  const f=await makePresentationDemo();
  // Anisotropic projection makes a screen-space 45 degree drag a different court angle.
  for(const keyframe of f.review.court.calibration.keyframes)for(const p of keyframe.points)p.image[0]*=1.5;
  f.playDefinition.sourceBinding=await createSourceBinding(f.review);
  const env=environment({schemaVersion:1,title:'rotate on ground',notes:'',...f},{player:true});
  try{
    await env.load();await env.get('tacticsToolScreen').onclick();await env.event('pointerdown',{pointerId:71,target:env.target(),clientX:650,clientY:300});
    const a=env.ui.getSceneState().annotations.items[0],id=a.id,center=a.points[0],state=env.ui.getSceneState();assert.equal(a.space,'court');
    const toVideo=p=>courtToVideo(state.model,state.frame,p),start=toVideo({x:center.x,y:center.y-1}),end=toVideo({x:center.x+1,y:center.y-1});
    const target=env.target({'data-annotation-id':id,'data-annotation-rotate':'true'}),before=env.writes.length;
    await env.event('pointerdown',{pointerId:72,target,clientX:start.x,clientY:start.y});
    await env.event('pointermove',{pointerId:72,clientX:end.x,clientY:end.y});
    assert.equal(env.writes.length,before);assert.equal(env.get('tacticsQuickAngle').textContent,'45°');
    await env.event('pointerup',{pointerId:72});assert.equal(env.writes.length,before+1);
    assert.ok(Math.abs(env.ui.getSceneState().annotations.items[0].style.angle-45)<.001);
    assert.deepEqual(env.ui.getSceneState().annotations.items[0].points,a.points,'rotation does not move the marker');
    await env.get('tacticsUndo').onclick();assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,0);
    for(const navigation of ['seek','phase']){
      const count=env.writes.length;await env.event('pointerdown',{pointerId:73,target,clientX:start.x,clientY:start.y});
      await env.event('pointermove',{pointerId:73,clientX:end.x,clientY:end.y});
      if(navigation==='seek'){env.ui.externalSeek(state.frame+1);await Promise.resolve();}else{env.get('tacticsPhases').children[1].onclick();await env.ui.ready();}
      await env.event('pointerup',{pointerId:73});assert.equal(env.writes.length,count);
      assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,0);
    }
  }finally{env.restore();}
});

test('unmapped video marker rotates freely and route deletion is available beside the canvas',async()=>{
  const f=await makePresentationDemo();f.review.entities=[];f.review.court.calibration.keyframes=[];
  const env=environment({schemaVersion:1,title:'free markers',notes:'',...f},{player:true,empty:true});
  try{
    await env.load();await env.get('tacticsCreateCanvas').onclick();await env.ui.ready();
    await env.get('tacticsToolScreen').onclick();await env.event('pointerdown',{pointerId:81,target:env.target(),clientX:650,clientY:300});
    const a=env.ui.getSceneState().annotations.items[0];assert.equal(a.space,'video');
    await env.event('pointerdown',{pointerId:82,target:env.target({'data-annotation-id':a.id,'data-annotation-rotate':'true'}),clientX:650,clientY:260});
    await env.event('pointermove',{pointerId:82,clientX:690,clientY:300});await env.event('pointerup',{pointerId:82});
    assert.equal(env.ui.getSceneState().annotations.items[0].style.angle,90);
    await env.get('tacticsToolRoute').onclick();
    for(const p of [[400,320],[600,400]])await env.event('pointerdown',{pointerId:83,target:env.target(),clientX:p[0],clientY:p[1]});
    await env.get('tacticsFinishDrawing').onclick();assert.equal(env.get('tacticsSelectionRotation').hidden,true);
    await env.get('tacticsQuickDelete').onclick();assert.equal(env.ui.getSceneState().annotations.items.length,1);
    await env.get('tacticsUndo').onclick();assert.equal(env.ui.getSceneState().annotations.items.length,2);
  }finally{env.restore();}
});

test('the empty-state primary action creates a usable manual canvas with no players or calibration',async()=>{
  const f=await makePresentationDemo();f.review.entities=[];f.review.court.calibration.keyframes=[];
  const env=environment({schemaVersion:1,title:'empty',notes:'',...f},{player:true,empty:true});
  try{
    await env.load();assert.equal(env.get('tacticsEmpty').hidden,false);assert.equal(env.get('tacticsCreateCanvas').disabled,false);
    await env.get('tacticsCreateCanvas').onclick();await env.ui.ready();
    assert.equal(env.get('tacticsEmpty').hidden,true);assert.equal(env.get('tacticsToolRoute').disabled,false);
    await env.get('tacticsToolRoute').onclick();
    for(const p of [[400,320],[600,400]])await env.event('pointerdown',{pointerId:60,target:env.target(),clientX:p[0],clientY:p[1]});
    await env.get('tacticsFinishDrawing').onclick();
    assert.equal(env.ui.getSceneState().annotations.items[0].entityId,null);
    assert.equal(env.ui.getSceneState().annotations.items[0].space,'video');
  }finally{env.restore();}
});

test('merging a phase keeps its orphaned drawings reachable for explicit rebind or deletion',async()=>{
  const f=await makePresentationDemo(),env=environment({schemaVersion:1,title:'merge',notes:'',...f},{player:true});
  try{
    await env.load();await env.get('tacticsToolScreen').onclick();
    await env.event('pointerdown',{pointerId:51,target:env.target(),clientX:650,clientY:300});
    const id=env.ui.getSceneState().annotations.items[0].id;
    await env.get('tacticsRemovePhase').onclick();await env.ui.ready();
    const entry=env.get('tacticsObjectList').children.find(b=>b.getAttribute('data-object-id')===id);
    assert.ok(entry,'removed-phase objects remain selectable');assert.match(entry.textContent,/待重新定位/);
    entry.onclick();assert.equal(env.get('tacticsAnnotationRebind').hidden,false);
    await env.get('tacticsAnnotationRebind').onclick();await env.ui.ready();
    assert.equal(env.ui.getSceneState().annotations.items[0].phaseId,env.ui.getSceneState().phaseId);
    assert.equal(env.get('tacticsAnnotationRebind').hidden,true);
    await env.get('tacticsAnnotationDelete').onclick();assert.equal(env.ui.getSceneState().annotations.items.length,0);
  }finally{env.restore();}
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
