import test from 'node:test';
import assert from 'node:assert/strict';
import {draftStorageKey} from './trajectory.mjs';
import {mountVideoLibrary} from './video-library.mjs';
import {readFileSync} from 'node:fs';
const choices=JSON.parse(readFileSync(new URL('../../configs/tracking/workbench-models.json',import.meta.url)));

function setup({localVideo=true,variant='yolo',ready=['yolo'],save=()=>{},search='?sample=local-video&qa=1',respond=null,modelChoices=null}={}){
  const nodes=new Map(),navigated=[],events=[],before=[];
  const make=()=>({textContent:'',value:'',children:[],options:[],listeners:{},attributes:{},classList:{toggle(){}},disabled:false,open:false,
    setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name]??null;},removeAttribute(name){delete this.attributes[name];},focus(){},
    append(...items){this.children.push(...items);this.options.push(...items);},replaceChildren(...items){this.children=[...items];this.options=[...items];},
    addEventListener(name,fn){this.listeners[name]=fn;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();}});
  const get=id=>{if(!nodes.has(id)){const node=make();node.id=id;node.parentElement=make();nodes.set(id,node);}return nodes.get(id);};
  const presets=[{id:'team-stable',label:'THY 完整方案 · 推荐'},{id:'yolo',label:'原 YOLO'}];
  get('trackingVersion').options=ready.map(value=>({value}));get('trackingVersion').value=variant;
  const old=new Map(['document','location','fetch','XMLHttpRequest'].map(key=>[key,globalThis[key]]));
  const inventory={folder:'D:/HKS/data/local-videos',entries:[{id:'local-video',filename:'test.mp4',bytes:12,
    sampleId:'local-video',variants:ready,status:'ready',message:'已处理'}],presets,runtimeAvailable:true};
  Object.assign(globalThis,{document:{getElementById:get,createElement:make,addEventListener(){}},location:{search,assign:url=>navigated.push(url)},
    fetch:async(url,options)=>{events.push({url,options});const result=respond?.(url,options,inventory);return {ok:result?.ok!==false,json:async()=>structuredClone(result?.data||inventory)};}});
  mountVideoLibrary({sample:'local-video',variant,localVideo,presets,modelChoices,beforeNavigate:()=>{before.push('save');return save();}});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  return {get,navigated,events,before,inventory,flush,restore(){get('videoLibraryDialog').close();for(const [key,value] of old){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};
}

test('local imports isolate legacy original drafts while keeping existing sample keys unchanged',()=>{
  const base={video_sha256:'same-video',tracking_fingerprint:'same-observations'};
  assert.equal(draftStorageKey(base,'original'),'player-review:same-video');
  assert.notEqual(draftStorageKey(base,'original'),draftStorageKey({...base,importSourceSha256:'source'},'original'));
  assert.notEqual(draftStorageKey(base,'yolo'),draftStorageKey({...base,importSourceSha256:'source'},'yolo'));
  assert.notEqual(draftStorageKey({...base,importSourceSha256:'source'},'yolo'),draftStorageKey({...base,importSourceSha256:'source',tracking_fingerprint:'other'},'reid'));
});
test('an unprocessed model opens the library with that preset instead of navigating to missing results',async()=>{
  const app=setup();try{
    assert.ok(app.get('trackingVersion').options.some(option=>option.value==='prepare:team-stable'));
    app.get('trackingVersion').value='prepare:team-stable';
    app.get('trackingVersion').listeners.change({target:app.get('trackingVersion')});await app.flush();
    assert.equal(app.get('videoLibraryDialog').open,true);
    assert.equal(app.get('importPreset').value,'team-stable');
    assert.equal(app.get('trackingVersion').value,'yolo');assert.deepEqual(app.navigated,[]);
  }finally{app.restore();}
});
test('switching a ready model saves the draft and retains QA isolation',async()=>{
  const app=setup({ready:['yolo','team-stable']});try{
    app.get('trackingVersion').value='team-stable';app.get('trackingVersion').listeners.change({target:app.get('trackingVersion')});
    await app.flush();
    assert.deepEqual(app.before,['save']);assert.equal(app.navigated[0],'/?sample=local-video&qa=1&variant=team-stable');
  }finally{app.restore();}
});
test('navigation waits for persisted draft and drops the previous tactical candidate context',async()=>{
  let finish;const saved=new Promise(resolve=>{finish=resolve;});
  const app=setup({ready:['yolo','team-stable'],save:()=>saved,search:'?sample=local-video&qa=1&area=tactics&candidate=1'});
  try{
    app.get('trackingVersion').value='team-stable';app.get('trackingVersion').listeners.change({target:app.get('trackingVersion')});
    await app.flush();assert.deepEqual(app.before,['save']);assert.deepEqual(app.navigated,[]);
    finish();await app.flush();assert.equal(app.navigated[0],'/?sample=local-video&qa=1&variant=team-stable');
  }finally{finish();app.restore();}
});
test('file import sends actual file bytes and refreshes the folder list',async()=>{
  const app=setup();try{
    const sent=[];globalThis.XMLHttpRequest=class{
      constructor(){this.upload={};this.headers={};}open(method,url){this.method=method;this.url=url;}
      setRequestHeader(key,value){this.headers[key]=value;}
      send(file){sent.push({file,headers:this.headers,method:this.method,url:this.url});this.status=200;this.responseText='{"id":"local-video","duplicate":false}';this.onload();}
    };
    const file={name:'比赛片段.mp4',size:123};const input=app.get('importVideos');input.files=[file];
    await input.onchange({target:input});
    assert.equal(sent[0].file,file);assert.equal(sent[0].headers['X-Video-Filename'],encodeURIComponent(file.name));
    assert.equal(sent[0].headers['Content-Type'],'application/octet-stream');assert.equal(sent[0].url,'/api/video-library/import');
    assert.equal(input.disabled,false);assert.match(app.get('videoLibraryStatus').textContent,/已导入 1/);
    assert.equal(app.get('localVideoList').children.length,1);
  }finally{app.restore();}
});
test('upload failures are visible and let the user choose the file again',async()=>{
  const app=setup();try{
    globalThis.XMLHttpRequest=class{constructor(){this.upload={};}open(){}setRequestHeader(){}send(){this.onerror();}};
    const input=app.get('importVideos');input.files=[{name:'retry.mp4',size:123}];
    await input.onchange({target:input});assert.equal(input.disabled,false);assert.equal(input.value,'');
    assert.match(app.get('videoLibraryStatus').textContent,/连接中断/);
  }finally{app.restore();}
});

test('import starts default detection, displays queued state and opens player checks after ready',async()=>{
  const app=setup({ready:[]});try{
    app.inventory.entries[0].status='queued';app.inventory.entries[0].jobVariant='team-stable';
    globalThis.XMLHttpRequest=class{constructor(){this.upload={};}open(){}setRequestHeader(){}send(){this.status=200;this.responseText=JSON.stringify({id:'local-video',duplicate:false,job:{status:'queued',variant:'team-stable',sampleId:'local-video'}});this.onload();}};
    const input=app.get('importVideos');input.files=[{name:'new.mp4',size:123}];app.get('videoLibraryDialog').showModal();
    await input.onchange({target:input});
    assert.match(app.get('videoLibraryStatus').textContent,/识别/);assert.deepEqual(app.navigated,[]);
    app.inventory.entries[0].status='ready';app.inventory.entries[0].variants=['team-stable'];
    app.get('refreshVideoLibrary').onclick();await app.flush();await app.flush();
    assert.equal(app.navigated[0],'/?sample=local-video&qa=1&variant=team-stable&step=players');
  }finally{app.restore();}
});

test('failed new job remains retryable when old precomputed variants are present',async()=>{
  const app=setup({ready:['team-stable'],respond:(url)=>url.endsWith('/process')?{data:{status:'queued',variant:'team-stable',sampleId:'local-video'}}:null});
  try{
    Object.assign(app.inventory.entries[0],{status:'error',jobVariant:'team-stable',message:'CUDA out of memory'});
    app.get('openVideoLibrary').onclick();await app.flush();
    const row=app.get('localVideoList').children[0],button=row.children[1];
    assert.match(row.children[0].children[1].textContent,/CUDA out of memory/);
    assert.match(button.textContent,/重试/);await button.onclick();
    assert.ok(app.events.some(event=>event.url.endsWith('/process')));assert.deepEqual(app.navigated,[]);
  }finally{app.restore();}
});

test('missing selected weights disable processing with the actual reason',async()=>{
  const app=setup({ready:[]});try{
    app.inventory.runtime={available:true,reason:'',variants:{'team-stable':{available:false,reason:'缺少 BODD_yolov8n_0001.pt'}}};
    app.get('openVideoLibrary').onclick();await app.flush();
    const button=app.get('localVideoList').children[0].children[1];
    assert.equal(button.disabled,true);assert.match(button.title,/BODD_yolov8n_0001.pt/);
    assert.equal(app.get('importPreset').options.find(option=>option.value==='team-stable').disabled,true);
  }finally{app.restore();}
});

test('archive and restore use collection endpoints and busy jobs cannot be archived',async()=>{
  const app=setup({respond:(url,options,inventory)=>{
    if(url.endsWith('/archive')){inventory.archivedEntries=[{...inventory.entries[0],archived:true}];inventory.entries=[];return {data:{archived:true}};}
    if(url.endsWith('/restore')){inventory.entries=inventory.archivedEntries;inventory.archivedEntries=[];return {data:{archived:false}};}
    return null;
  }});
  try{
    app.get('openVideoLibrary').onclick();await app.flush();
    let row=app.get('localVideoList').children[0];
    const archive=row.children.find(child=>child.textContent==='归档');assert.ok(archive);
    await archive.onclick();assert.equal(app.get('localVideoList').children[0].className,'library-empty');
    app.get('videoLibraryScope').value='archived';app.get('videoLibraryScope').onchange();
    row=app.get('localVideoList').children[0];const restore=row.children.find(child=>child.textContent==='恢复');assert.ok(restore);
    await restore.onclick();
    const event=app.events.find(event=>event.url.endsWith('/restore'));assert.deepEqual(JSON.parse(event.options.body),{id:'local-video'});
    app.inventory.entries[0].status='running';app.get('videoLibraryScope').value='active';app.get('refreshVideoLibrary').onclick();await app.flush();
    assert.equal(app.get('localVideoList').children[0].children.find(child=>child.textContent==='归档').disabled,true);
  }finally{app.restore();}
});

test('primary import opens the chooser and cancellation sends no processing request',async()=>{
  const app=setup();try{
    let clicked=0;app.get('importVideos').click=()=>clicked++;
    assert.equal(typeof app.get('startVideoImport').onclick,'function');
    app.get('startVideoImport').onclick();await app.flush();
    assert.equal(clicked,1);assert.equal(app.get('videoLibraryDialog').open,true);
    const input=app.get('importVideos');input.files=[];await input.onchange({target:input});
    assert.equal(app.events.filter(event=>event.options?.method==='POST').length,0);
  }finally{app.restore();}
});

test('model picker selection during import renders each row once',async()=>{
  const app=setup({modelChoices:choices});try{
    await app.flush();app.get('importVideos').click=()=>{};
    app.get('startVideoImport').onclick();await app.flush();
    assert.equal(app.get('localVideoList').children.length,1);
  }finally{app.restore();}
});

test('a search with no matches explains the empty list and clearing it restores entries',async()=>{
  const app=setup();try{
    app.get('openVideoLibrary').onclick();await app.flush();
    app.get('videoLibrarySearch').value='no-such-video';app.get('videoLibrarySearch').oninput();
    assert.match(app.get('localVideoList').children[0].textContent,/没有符合条件的视频/);
    assert.match(app.get('videoLibraryCount').textContent,/0 \/ 1 段/);
    app.get('videoLibrarySearch').value='';app.get('videoLibrarySearch').oninput();
    assert.equal(app.get('localVideoList').children[0].className,'local-video-row');
    assert.equal(app.inventory.entries.length,1);assert.equal(app.events.filter(e=>e.options?.method==='POST').length,0);
  }finally{app.restore();}
});

test('a refresh after mutation waits for the in-flight inventory before reading new state',async()=>{
  const app=setup();const originalFetch=globalThis.fetch;let release;const held=new Promise(resolve=>{release=resolve;});let reads=0;
  try{
    globalThis.fetch=async(...args)=>{if(++reads===1)await held;return originalFetch(...args);};
    app.get('openVideoLibrary').onclick();app.get('refreshVideoLibrary').onclick();
    await app.flush();assert.equal(reads,1);
    release();await app.flush();await app.flush();assert.equal(reads,2);
  }finally{release();await app.flush();app.restore();}
});
