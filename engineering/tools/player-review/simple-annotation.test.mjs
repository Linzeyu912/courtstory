import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {blankSession,draftStorageKey} from './trajectory.mjs';
import {confirmIdentity} from './identity-timeline.mjs';

// Exercise the shipped app and simple controls. The DOM double replaces layout,
// media playback and React mounting; identity, draft and click routing stay real.
async function openApp({modelConflict=false,fullTeamA=false}={}){
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
  if(fullTeamA)for(const index of [3,4,5,6])Object.assign(session.entities[index],{teamGroup:'A',teamGroupSource:'human'});
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
      getAttribute(key){return this.attributes[key]??null;},addEventListener(key,fn){(this.listeners[key]||=[]).push(fn);},
      click(){if(!this.disabled){this.onclick?.({target:this});this.dispatch('click',{target:this});}},
      dispatch(key,event={}){for(const fn of this.listeners[key]||[])fn({...event,currentTarget:this,target:event.target||this});},
      focus(){},scrollIntoView(){},getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720}),
      pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},requestVideoFrameCallback(){},
      setPointerCapture(){},hasPointerCapture:()=>false,releasePointerCapture(){},ctx};
  }
  const get=id=>{if(!nodes.has(id)){const node=make(),tag=html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0]||'';
    node.checked=/\bchecked\b/.test(tag);node.hidden=/\bhidden\b/.test(tag);nodes.set(id,node);}return nodes.get(id);};
  const tabs=['footage','identity','repair','export','calibration','events'].map(step=>{const tab=get(`tab-${step}`);tab.dataset.step=step;tab.setAttribute('aria-selected',String(step==='footage'));return tab;});
  const body={dataset:{}},initialView=html.match(/<body[^>]+data-review-view="([^"]+)"/)?.[1];if(initialView)body.dataset.reviewView=initialView;
  const document={body,activeElement:null,getElementById:get,createElement:make,addEventListener(){},querySelector:()=>get('player-overview'),querySelectorAll:selector=>selector==='[data-step]'?tabs:[]};
  const globals=['document','window','devicePixelRatio','location','fetch','localStorage','requestAnimationFrame','setTimeout','clearTimeout'];
  const previous=new Map(globals.map(name=>[name,globalThis[name]]));
  const policy=JSON.parse(readFileSync(new URL('./team-overlay-policy.json',import.meta.url)));
  Object.assign(globalThis,{document,window:{addEventListener(){},history:{replaceState(){}}},devicePixelRatio:1,
    location:{search:'?sample=test&variant=team-stable&qa=1',assign(){}},requestAnimationFrame(){},setTimeout:()=>1,clearTimeout(){},
    localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)},
    fetch:async url=>({ok:true,json:async()=>url==='/api/library'?{defaultSample:'test',samples:[{id:'test',title:'测试视频',defaultVariant:'team-stable'}]}:url==='/team-overlay-policy.json'?policy:clip})});
  let appApi;
  try{
    const source=readFileSync(new URL('./app.mjs',import.meta.url),'utf8'),imports=[...source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)],dependencies={};
    for(const match of imports){
      if(match[2]==='./ui.bundle.mjs'){dependencies.mountIdentityUI=()=>({render(){}});continue;}
      if(match[2]==='./footage-ui.mjs'){dependencies.mountFootageUI=()=>({render(){}});continue;}
      if(match[2]==='./workspace.mjs'){dependencies.createWorkspace=api=>{appApi=api;return {refresh(){},draw(){},drawImageOverlay(){},handleImageClick:()=>false,
        switchStep(step){document.body.dataset.step=step;get('overlay').hidden=step==='footage';for(const tab of tabs)tab.setAttribute('aria-selected',String(tab.dataset.step===step));api.setMode('select',{edit:false});}};};continue;}
      const module=await import(new URL(match[2],import.meta.url));
      for(const part of match[1].split(',')){const [name,alias=name]=part.trim().split(/\s+as\s+/);dependencies[alias]=module[name];}
    }
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFunction(...Object.keys(dependencies),source.replace(/^import .*;\r?\n/gm,''))(...Object.values(dependencies));
    const restore=()=>{for(const [name,value] of previous){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}};
    return {get,clip,key,saved,state:()=>appApi.getState(),body,restore,
      clickBox:(x,y)=>get('overlay').dispatch('click',{button:0,clientX:x,clientY:y}),
      chip:id=>get('simpleIds').children.find(node=>node.dataset.playerId===id)};
  }catch(error){for(const [name,value] of previous){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}throw error;}
}

test('default annotations are visible before the old clipping gate with one numbered box per player and no T/P overlay',async()=>{
  const app=await openApp();
  try{
    assert.equal(app.body.dataset.reviewView,'simple');assert.equal(app.get('overlay').hidden,false);
    assert.equal(app.get('showTrackTrails').checked,false);assert.equal(app.get('showObjects').checked,false);
    assert.equal(app.get('simpleIds').children.length,10);
    assert.deepEqual(app.get('simpleIds').children.map(node=>node.textContent),['1','2','3','4','5','6','7','8','9','10']);
    assert.deepEqual(app.get('overlay').ctx.labels.sort(),['1','2','编号未匹配'].sort());
    assert.equal(app.get('overlay').ctx.boxes.length,3);
    assert.equal(app.get('overlay').ctx.boxes.find(item=>item.box[0]===400).color,'#9ca3af','unknown team keeps its own plain number in gray');
    assert.equal(app.state().session.liveSelection,null,'simple viewing does not manufacture a human clipping confirmation');
  }finally{app.restore();}
});

test('a normal click on another numbered player only selects that ID and preserves human corrections',async()=>{
  const app=await openApp();
  try{
    const before=structuredClone(app.state().session);
    app.clickBox(450,200);
    assert.equal(app.state().active,'P2');assert.deepEqual(app.state().session,before);
    assert.equal(app.get('undo').disabled,true,'viewing a player does not create an undo edit');
    assert.equal(app.state().session.entities[0].name,'人工姓名');
  }finally{app.restore();}
});

test('an unmatched candidate needs explicit correction before an ID click associates it once and undo restores the draft',async()=>{
  const app=await openApp();
  try{
    const before=structuredClone(app.state().session);
    app.clickBox(760,180);assert.deepEqual(app.state().session,before);
    app.chip('P3')?.click();assert.deepEqual(app.state().session,before,'an ordinary ID click cannot consume a selected candidate');
    app.get('simpleCorrection').click();app.chip('P3')?.click();
    assert.equal(app.state().session.entities[2].identityKeyframes.at(-1)?.trackId,9);
    assert.equal(app.get('simpleCorrection').getAttribute('aria-pressed'),'false','correction ends after one association');
    app.get('undo').click();assert.deepEqual(app.state().session,before);
  }finally{app.restore();}
});

test('scrubbing clears an armed correction and preserves exact source PTS and immutable cuts',async()=>{
  const app=await openApp();
  try{
    const before=structuredClone(app.state().session);
    app.clickBox(760,180);app.get('simpleCorrection').click();app.get('next').click();
    assert.equal(app.state().video.currentTime,.031);assert.equal(app.state().frame,1);
    app.chip('P3')?.click();assert.deepEqual(app.state().session,before);
    assert.equal(app.get('simpleCorrection').getAttribute('aria-pressed'),'false');
    app.get('scrubber').value='3';app.get('scrubber').dispatch('input');
    assert.equal(app.state().video.currentTime,.119);assert.deepEqual(app.state().session.cuts,[2]);
  }finally{app.restore();}
});

test('advanced tools reopen the existing step flow without changing the stored draft and can return to plain viewing',async()=>{
  const app=await openApp();
  try{
    const before=structuredClone(app.state().session);
    app.get('advancedTools').click();assert.equal(app.body.dataset.reviewView,'advanced');
    assert.equal(app.body.dataset.step,'footage');assert.equal(app.get('overlay').hidden,true);
    app.get('showObjects').checked=true;app.get('showObjects').dispatch('change');
    assert.ok(app.get('overlay').ctx.labels.some(label=>String(label).includes('篮球')));
    app.get('advancedTools').click();assert.equal(app.body.dataset.reviewView,'simple');
    assert.equal(app.get('overlay').hidden,false);assert.deepEqual(app.state().session,before);
    assert.deepEqual(app.get('overlay').ctx.labels.sort(),['1','2','编号未匹配'].sort());
    assert.equal(app.saved.get(app.key),JSON.stringify(app.state().session));
  }finally{app.restore();}
});

test('a known identity conflict in an old model draft stays gray and cannot be confirmed by ordinary viewing',async()=>{
  const app=await openApp({modelConflict:true});
  try{
    const before=structuredClone(app.state().session);
    assert.equal(app.state().trajectories.P3[0].x,780,'the old raw model trajectory remains stored');
    assert.ok(!app.get('overlay').ctx.labels.includes('3'),'the flagged model identity cannot appear as a fixed numbered player');
    assert.equal(app.get('overlay').ctx.labels.filter(label=>label==='编号未匹配').length,1);
    app.clickBox(760,180);assert.deepEqual(app.state().session,before);
    assert.equal(app.get('undo').disabled,true);
    assert.match(app.chip('P3').getAttribute('aria-label'),/需要核对/);
  }finally{app.restore();}
});

test('team correction can retry after failure and ends after success so ordinary ID selection cannot consume a stale candidate',async()=>{
  const app=await openApp({fullTeamA:true});
  try{
    const before=structuredClone(app.state().session);
    app.clickBox(760,180);app.chip('P3').click();app.get('simpleCorrection').click();
    const changeTeam=value=>{app.get('simpleTeam').value=value;app.get('simpleTeam').onchange({target:app.get('simpleTeam')});};
    changeTeam('A');
    assert.deepEqual(app.state().session,before,'a failed grouping does not change identity, team, or geometry');
    assert.equal(app.get('simpleCorrection').getAttribute('aria-pressed'),'true','a failed action remains available for retry');
    assert.ok(!app.get('toast').textContent.includes('分队已保存'),'failure cannot report a saved team');
    changeTeam('B');
    assert.equal(app.state().session.entities[2].teamGroup,'B');assert.equal(app.state().session.entities[2].teamGroupSource,'human');
    assert.equal(app.get('simpleCorrection').getAttribute('aria-pressed'),'false');
    assert.equal(app.get('overlay').ctx.boxes.find(item=>item.box[0]===720).color,'#9ca3af','the selected gray candidate has been cleared');
    const afterTeam=structuredClone(app.state().session);app.chip('P10').click();
    assert.equal(app.state().active,'P10');assert.deepEqual(app.state().session,afterTeam,'ordinary ID selection cannot create a human identity from the old candidate');
    app.get('undo').click();assert.deepEqual(app.state().session,before);
    assert.equal(app.get('undo').disabled,true,'only the successful team action creates an undo entry');
  }finally{app.restore();}
});
