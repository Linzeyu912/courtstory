import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {blankSession,draftStorageKey} from './trajectory.mjs';
import {confirmIdentity} from './identity-timeline.mjs';

// Exercise the shipped step-based workbench and imported model annotations. The DOM double replaces layout,
// media playback and React mounting; identity, draft and click routing stay real.
async function openApp({modelConflict=false,liveConfirmed=true,reviewEdit}={}){
  const reviewRequests=[];
  const records=[0,.031,.078,.119,.165].map((time,frame)=>({frame,time,
    tracks:[[100,80,220,320,7,.95,2],[400,100,530,330,8,.93,2],[720,90,840,300,9,.92,2]],
    track_roles:{7:'player',8:'player',9:'player'},role_conflicts:[{trackIds:[9]}],
    objects:[{kind:'basketball',box:[600,200,620,220],score:.9}]}));
  const clip={video_sha256:'simple-video',tracking_fingerprint:'rich-original-draft',tracking_revision:'team-stable',
    width:1280,height:720,frames:records,sourceCuts:[2],track_roles:{7:'player',8:'player',9:'player'},
    variants:[{id:'team-stable',label:'篮球'}],trackingMetadata:{model:'basketball',tracker:'BoT-SORT',presentation:{default_stable:true}}};
  const session=blankSession(clip.video_sha256);session.cuts=[2];session.presentationStable=true;
  confirmIdentity(session,'P1',0,{box:records[0].tracks[0].slice(0,4),trackId:7},records);
  confirmIdentity(session,'P2',0,{box:records[0].tracks[1].slice(0,4),trackId:8},records);
  Object.assign(session.entities[0],{name:'人工姓名',team:'白衣',jersey:'7',teamGroup:'A',teamGroupSource:'human'});
  if(liveConfirmed)session.liveSelection={confirmed:true};
  if(modelConflict)session.entities[2].modelBindings=[{kind:'track',start:0,end:4,trackId:9,source:'model_suggestion',identityConfirmed:false,reviewRequired:true}];
  const key=draftStorageKey(clip,'team-stable',true),saved=new Map([[key,JSON.stringify(session)]]),nodes=new Map();
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  function make(){
    const context={labels:[],boxes:[],strokeStyle:'',clearRect(){this.labels=[];this.boxes=[];},
      strokeRect(...box){this.boxes.push({box,color:this.strokeStyle});},fillText(text){this.labels.push(text);},measureText:text=>({width:String(text).length*8})};
    const ctx=new Proxy(context,{get:(value,key)=>key in value?value[key]:(()=>{})});
    return {children:[],listeners:{},attributes:{},dataset:{},style:{setProperty(){}},value:'',checked:false,hidden:false,disabled:false,
      textContent:'',tagName:'DIV',clientWidth:1280,clientHeight:720,width:1280,height:720,paused:true,currentTime:0,
      classList:{add(){},remove(){},toggle(){}},append(...children){this.children.push(...children);},prepend(...children){this.children.unshift(...children);},
      replaceChildren(...children){this.children=children;},setAttribute(key,value){this.attributes[key]=String(value);},
      getAttribute(key){return this.attributes[key]??null;},removeAttribute(key){delete this.attributes[key];},contains:()=>false,addEventListener(key,fn){(this.listeners[key]||=[]).push(fn);},
      click(){if(!this.disabled){this.onclick?.({target:this});this.dispatch('click',{target:this});}},
      dispatch(key,event={}){for(const fn of this.listeners[key]||[])fn({...event,currentTarget:this,target:event.target||this});},
      focus(){},scrollIntoView(){},getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720}),
      pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},requestVideoFrameCallback(){},
      setPointerCapture(){},hasPointerCapture:()=>false,releasePointerCapture(){},ctx};
  }
  const get=id=>{if(!nodes.has(id)){const node=make(),tag=html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0]||'';
    node.checked=/\bchecked\b/.test(tag);node.hidden=/\bhidden\b/.test(tag);nodes.set(id,node);}return nodes.get(id);};
  const tabs=['footage','identity','repair','export','calibration','events'].map(step=>{const tab=get(`tab-${step}`);tab.dataset.step=step;tab.setAttribute('aria-selected',String(step==='footage'));return tab;});
  const areas=['video','data','tactics','production'].map(area=>{const node=get(`area-${area}`);node.dataset.areaTarget=area;return node;});
  const body={dataset:{},classList:{add(){},remove(){}}},initialView=html.match(/<body[^>]+data-review-view="([^"]+)"/)?.[1];if(initialView)body.dataset.reviewView=initialView;
  const document={body,activeElement:null,getElementById:get,createElement:make,addEventListener(){},querySelector:()=>get('player-overview'),querySelectorAll:selector=>selector==='[data-step]'?tabs:selector==='[data-area-target]'?areas:[]};
  const globals=['document','window','devicePixelRatio','location','fetch','localStorage','requestAnimationFrame','setTimeout','clearTimeout','MutationObserver','ResizeObserver'];
  const previous=new Map(globals.map(name=>[name,globalThis[name]]));
  const policy=JSON.parse(readFileSync(new URL('./team-overlay-policy.json',import.meta.url)));
  Object.assign(globalThis,{MutationObserver:class {observe(){} disconnect(){}},ResizeObserver:class {observe(){} disconnect(){}},document,window:{addEventListener(){},history:{replaceState(){}}},devicePixelRatio:1,
    location:{search:'?sample=test&variant=team-stable&qa=1',assign(){}},requestAnimationFrame(){},setTimeout:()=>1,clearTimeout(){},
    localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)},
    fetch:async (url,init)=>{
      if(url==='/api/review-edit'){
        const request=JSON.parse(init.body);reviewRequests.push(request);
        const result=reviewEdit?await reviewEdit(request):{error:'no test response'};
        return {ok:!result.error,json:async()=>result};
      }
      return {ok:true,json:async()=>url==='/api/library'?{defaultSample:'test',samples:[{id:'test',title:'测试视频',defaultVariant:'team-stable'}]}:url==='/team-overlay-policy.json'?policy:String(url).startsWith('/api/player-identity/options')?{seasons:[],teams:[]}:clip};
    }});
  let appApi,identityActions,identityState,workbench;
  try{
    const source=readFileSync(new URL('./app.mjs',import.meta.url),'utf8'),imports=[...source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)],dependencies={};
    for(const match of imports){
      if(match[2]==='./ui.bundle.mjs'){dependencies.mountIdentityUI=actions=>{identityActions=actions;return {render(state){identityState=state;}};};
        dependencies.mountVideoDisplay=({video,stage,startTime,onReady})=>{
          stage.dataset.videoState='ready';video.currentTime=startTime;onReady?.({time:startTime});
          return {pause:()=>video.pause(),seek:time=>{video.pause();video.currentTime=time;},
            reload:()=>{video.pause();video.currentTime=startTime;},togglePlayback:()=>video.paused?video.play():video.pause()};
        };continue;}
      if(match[2]==='./footage-ui.mjs'){dependencies.mountFootageUI=()=>({render(){}});continue;}
      if(match[2]==='./workspace.mjs'){
        const module=await import('./workspace.mjs');
        dependencies.createWorkspace=api=>{appApi=api;workbench=module.createWorkspace(api);return workbench;};continue;
      }
      const module=await import(new URL(match[2],import.meta.url));
      for(const part of match[1].split(',')){const [name,alias=name]=part.trim().split(/\s+as\s+/);dependencies[alias]=module[name];}
    }
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFunction(...Object.keys(dependencies),source.replace(/^import .*;\r?\n/gm,''))(...Object.values(dependencies));
    const restore=()=>{for(const [name,value] of previous){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}};
    await new Promise(resolve=>setImmediate(resolve));
    return {get,clip,key,saved,reviewRequests,state:()=>appApi.getState(),body,restore,identityState:()=>identityState,actions:identityActions,workbench,
      clickBox:(x,y)=>get('overlay').dispatch('click',{button:0,clientX:x,clientY:y}),
      select:id=>identityActions.select(id)};
  }catch(error){for(const [name,value] of previous){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}throw error;}
}

test('the default workbench keeps step navigation and the bottom data drawer without granting clipping confirmation',async()=>{
  const app=await openApp({liveConfirmed:false});try{
    assert.notEqual(app.body.dataset.reviewView,'simple');assert.equal(app.body.dataset.step,'footage');
    assert.equal(app.get('overlay').hidden,true);assert.equal(app.body.dataset.drawer,'closed');
    assert.equal(app.identityState().entities.length,10);
    assert.deepEqual(app.identityState().entities.map(entity=>entity.teamSide),Array(5).fill('red').concat(Array(5).fill('blue')));
    const before=structuredClone(app.state().session);app.clickBox(450,200);assert.deepEqual(app.state().session,before);
    app.get('tab-identity').click();assert.equal(app.body.dataset.step,'footage');assert.equal(app.state().session.liveSelection,null);
    app.get('drawerToggle').click();assert.equal(app.body.dataset.drawer,'half');
    app.get('drawerFull').click();assert.equal(app.body.dataset.drawer,'full');assert.equal(app.body.dataset.area,'data');
    app.get('drawerClose').click();assert.equal(app.body.dataset.drawer,'closed');assert.deepEqual(app.state().session,before);
  }finally{app.restore();}
});

test('selecting a roster card after previewing a candidate only changes the active player',async()=>{
  const app=await openApp();try{
    const before=structuredClone(app.state().session);
    app.actions.preview(app.identityState().proposals.find(proposal=>proposal.trackId===9));
    app.select('P2');assert.equal(app.state().active,'P2');assert.deepEqual(app.state().session,before);
    assert.equal(app.get('undo').disabled,true);assert.equal(app.state().session.entities[0].name,'人工姓名');
  }finally{app.restore();}
});

test('explicit candidate association changes only the selected identity and undo restores the draft',async()=>{
  const app=await openApp();try{
    const before=structuredClone(app.state().session);app.select('P3');
    const candidate=app.identityState().proposals.find(proposal=>proposal.trackId===9);
    app.actions.preview(candidate);assert.deepEqual(app.state().session,before);
    app.actions.setAssociationScope('forward');
    await app.actions.associate(candidate);
    assert.equal(app.state().session.entities[2].identityKeyframes.at(-1)?.trackId,9);
    assert.deepEqual(app.state().session.entities.slice(0,2),before.entities.slice(0,2));
    app.get('undo').click();assert.deepEqual(app.state().session,before);
  }finally{app.restore();}
});

test('scrubbing seeks just inside source frames without changing timestamps or consuming an earlier candidate preview',async()=>{
  const app=await openApp();try{
    const before=structuredClone(app.state().session),sourceTimes=app.clip.frames.map(record=>record.time);
    app.actions.preview(app.identityState().proposals.find(proposal=>proposal.trackId===9));
    app.get('next').click();assert.equal(app.state().video.currentTime,.031+2e-6);assert.equal(app.state().frame,1);
    app.select('P3');assert.deepEqual(app.state().session,before);
    app.get('scrubber').value='3';app.get('scrubber').dispatch('input');
    assert.equal(app.state().video.currentTime,.119+2e-6);assert.deepEqual(app.state().session.cuts,[2]);
    assert.deepEqual(app.clip.frames.map(record=>record.time),sourceTimes);
    assert.equal(app.state().trajectories.P1[3].time,.119,'trajectory timestamps retain the original PTS');
    assert.equal(app.state().trajectories.P1[3].x,null,'source join does not inherit the earlier identity');
  }finally{app.restore();}
});

test('left navigation and step controls preserve the draft and stable display while moving the data drawer',async()=>{
  const app=await openApp();try{
    const before=structuredClone(app.state().session);assert.equal(app.body.dataset.step,'identity');
    app.get('area-data').click();assert.equal(app.body.dataset.area,'data');assert.equal(app.body.dataset.drawer,'full');
    app.get('tab-repair').click();assert.equal(app.body.dataset.step,'repair');assert.equal(app.body.dataset.area,'video');
    assert.equal(app.body.dataset.drawer,'closed');assert.equal(app.state().session.presentationStable,true);
    app.get('drawerToggle').click();assert.equal(app.body.dataset.drawer,'half');
    app.get('tab-identity').click();assert.equal(app.body.dataset.drawer,'closed');
    assert.deepEqual(app.state().session,before);assert.equal(app.saved.get(app.key),JSON.stringify(before));
  }finally{app.restore();}
});

test('a conflicted saved model track remains a review candidate and ordinary roster selection cannot confirm it',async()=>{
  const app=await openApp({modelConflict:true});try{
    const before=structuredClone(app.state().session);
    assert.equal(app.state().trajectories.P3[0].x,780,'original model evidence remains stored');
    assert.ok(!app.get('overlay').ctx.labels.includes('3?'),'a conflicted model is not shown as a fixed numbered player');
    assert.ok(app.get('overlay').ctx.labels.some(label=>label.startsWith('T9')),'the raw candidate remains inspectable');
    app.select('P3');assert.deepEqual(app.state().session,before);assert.equal(app.get('undo').disabled,true);
    assert.equal(app.state().session.entities[2].identityKeyframes.length,0);
  }finally{app.restore();}
});

test('changing fixed player cards never rewrites team membership or converts a preview into a human identity',async()=>{
  const app=await openApp();try{
    const before=structuredClone(app.state().session);
    app.actions.preview(app.identityState().proposals.find(proposal=>proposal.trackId===9));
    for(const id of ['P3','P10','P1'])app.select(id);
    assert.equal(app.state().active,'P1');assert.deepEqual(app.state().session,before);
    assert.equal(Object.hasOwn(app.state().session,'teamRoles'),false);
    assert.equal(app.get('undo').disabled,true);
    assert.equal(app.get('overlay').ctx.boxes.find(item=>item.box[0]===100&&item.color==='#ee5568')?.color,'#ee5568');
  }finally{app.restore();}
});


test('default whole-ID association uses the authoritative review API and keeps undo and unreviewed frames',async()=>{
  const app=await openApp({reviewEdit:request=>{
    const draft=structuredClone(request.session);
    draft.entities[2].bindings=[{kind:'track',trackId:9,start:0,end:1,scope:'track_occurrences',origin:'human_track_assignment',selectionFrame:1,order:3,exclusive:false},
      {kind:'track',trackId:9,start:2,end:4,scope:'track_occurrences',origin:'human_track_assignment',selectionFrame:1,order:3,exclusive:false}];
    draft.entities[2].frameConfirmations=[{frame:1,trackId:9,origin:'human_track_selection',identityOrder:3,identityScope:'track_occurrences'}];
    return {session:draft,message:'已归并，仍待逐帧核对'};
  }});try{
    app.select('P3');app.get('next').click();const before=structuredClone(app.state().session);
    assert.equal(app.identityState().associationScope,'track_occurrences');
    const candidate=app.identityState().proposals.find(proposal=>proposal.trackId===9);
    assert.equal(await app.actions.associate(candidate),true);
    assert.deepEqual(app.reviewRequests[0].operation,{type:'assign_track',entityId:'P3',trackId:9,frame:1});
    assert.equal(app.reviewRequests[0].variant,'team-stable');assert.equal(app.reviewRequests[0].qa,true);
    assert.equal(app.state().session.entities[2].identityKeyframes.length,0);
    assert.equal(app.state().trajectories.P3[0].trackId,9);
    assert.equal(app.state().trajectories.P3[4].trackId,9);
    assert.equal(app.state().trajectories.P3[4].reviewRequired,true);
    assert.equal(app.state().trajectories.P3[4].identityConfirmed,false);
    assert.equal(app.state().trajectories.P3[1].frameIdentityConfirmed,true);
    assert.match(app.get('coverage').textContent,/人物已逐帧确认 1 \/ 5 帧/);
    app.get('undo').click();assert.deepEqual(app.state().session,before);
  }finally{app.restore();}
});

test('confirming the displayed risky model frame reveals its player and leaves other frames unreviewed',async()=>{
  const app=await openApp({modelConflict:true});try{
    app.select('P3');const before=structuredClone(app.state().session);
    assert.equal(app.actions.confirmCurrent(),true);
    assert.equal(app.state().trajectories.P3[0].frameIdentityConfirmed,true);
    assert.ok(app.get('overlay').ctx.labels.includes('3'));
    assert.equal(app.state().trajectories.P3[1].frameIdentityConfirmed,false);
    assert.match(app.get('trackingDiagnosis').textContent,/人工确认.*风险提示/);
    app.get('undo').click();assert.deepEqual(app.state().session,before);
  }finally{app.restore();}
});

test('hidden candidate overlays cannot claim a track by clicking an invisible box',async()=>{
  const app=await openApp();try{
    const before=structuredClone(app.state().session);
    app.get('showCandidates').checked=false;app.clickBox(750,150);
    assert.deepEqual(app.state().session,before);assert.equal(app.reviewRequests.length,0);
    assert.match(app.get('toast').textContent,/先打开/);
  }finally{app.restore();}
});

test('explicit untracked fallback affects one frame and undo restores the prior track',async()=>{
  const app=await openApp();try{
    const before=structuredClone(app.state().session),next=structuredClone(app.state().trajectories.P1[1]);
    await app.actions.associate({box:[120,90,220,310],trackId:null,suppressed:true});
    assert.equal(app.state().trajectories.P1[0].frameIdentityConfirmed,true);
    assert.equal(app.state().trajectories.P1[0].trackId,null);
    assert.deepEqual(app.state().trajectories.P1[1],next);
    assert.match(app.get('toast').textContent,/其他帧保持/);
    app.get('undo').click();assert.deepEqual(app.state().session,before);
  }finally{app.restore();}
});

test('rejected whole-ID assignment preserves the draft, selection and existing manual points',async()=>{
  const app=await openApp({reviewEdit:()=>({error:'当前帧没有所选临时编号。'})});try{
    const before=structuredClone(app.state().session);
    const candidate=app.identityState().proposals.find(proposal=>proposal.trackId===9);
    assert.equal(await app.actions.associate(candidate),false);
    assert.deepEqual(app.state().session,before);assert.equal(app.state().active,'P1');
    assert.equal(app.get('undo').disabled,true);assert.match(app.get('toast').textContent,/没有所选/);
  }finally{app.restore();}
});
