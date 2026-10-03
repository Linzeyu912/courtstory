import test from 'node:test';
import assert from 'node:assert/strict';
import {draftStorageKey} from './trajectory.mjs';
import {mountVideoLibrary} from './video-library.mjs';

function setup({localVideo=true,variant='yolo',ready=['yolo'],save=()=>{},search='?sample=local-video&qa=1'}={}){
  const nodes=new Map(),navigated=[],events=[],before=[];
  const make=()=>({textContent:'',value:'',children:[],options:[],listeners:{},disabled:false,open:false,
    append(...items){this.children.push(...items);this.options.push(...items);},replaceChildren(){this.children=[];},
    addEventListener(name,fn){this.listeners[name]=fn;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();}});
  const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
  const presets=[{id:'team-stable',label:'THY 完整方案 · 推荐'},{id:'yolo',label:'原 YOLO'}];
  get('trackingVersion').options=ready.map(value=>({value}));get('trackingVersion').value=variant;
  const old=new Map(['document','location','fetch','XMLHttpRequest'].map(key=>[key,globalThis[key]]));
  const inventory={folder:'D:/HKS/data/local-videos',entries:[{id:'local-video',filename:'test.mp4',bytes:12,
    sampleId:'local-video',variants:ready,status:'ready',message:'已处理'}],presets,runtimeAvailable:true};
  Object.assign(globalThis,{document:{getElementById:get,createElement:make},location:{search,assign:url=>navigated.push(url)},
    fetch:async(url,options)=>{events.push({url,options});return {ok:true,json:async()=>structuredClone(inventory)};}});
  mountVideoLibrary({sample:'local-video',variant,localVideo,presets,beforeNavigate:()=>{before.push('save');return save();}});
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
