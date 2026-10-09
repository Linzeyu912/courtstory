import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCommentaryUI} from './commentary-ui.mjs';

// Small DOM double for the draft/candidate lifecycle; real browser layout is checked separately.
class Element {
  set value(v) { this._value=String(v); }
  get value() { return this._value; }
  constructor(tag) { this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.listeners={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.classList={add(){}}; }
  append(node) { this.children.push(node);if(this.tag==='select'&&this.children.length===1)this.value=node.value; }
  replaceChildren() { this.children=[]; }
  setAttribute(k,v) { this.attrs[k]=v; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k,fn) { (this.listeners[k]??=[]).push(fn); }
  async fire(k) { for(const fn of this.listeners[k]??[])await fn();await new Promise(resolve=>setImmediate(resolve)); }
  pause() {} load() {}
}
const fixture=()=>({summary:'半场进攻',events:[],uncertainties:[],cues:[{cueId:'c1',text:'突破上篮。',suggestedStartTime:1,suggestedEndTime:4,delivery:'during_play'}, {cueId:'c2',text:'回防。',suggestedStartTime:5,suggestedEndTime:7,delivery:'during_play'}]});
function all(node) { return [node,...node.children.flatMap(all)]; }
function harness({running=false,fail=false,conflict=false}={}) {
  const previous={document:global.document,localStorage:global.localStorage,fetch:global.fetch,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
  const root=new Element('section'), storage=new Map(), writes=[];
  let saved=fixture(), submitted=null, tick=null;
  global.document={createElement:tag=>new Element(tag)};
  global.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  global.setTimeout=fn=>{tick=fn;return 1;};global.clearTimeout=()=>{tick=null;};
  const candidate=()=>{const plan=structuredClone(submitted);plan.cues[0].text='这个跟防，真不下班。';return {id:'test',action:'polish',status:'completed',originalPlan:submitted,plan};};
  global.fetch=async(url,options)=>{
    let result;
    if(url.startsWith('/api/commentary?'))result={plan:saved,status:{understandingConfigured:true,ttsConfigured:true}};
    else if(url==='/api/commentary/save'){saved=JSON.parse(options.body).plan;writes.push(saved);result={plan:saved};}
    else if(url.startsWith('/api/commentary/cues/')){
      if(conflict)return {ok:false,status:409,json:async()=>({error:'本句已有新版本'})};
      const {patch,expectedCue}=JSON.parse(options.body);
      assert.deepEqual(saved.cues.find(c=>c.cueId===expectedCue.cueId),expectedCue);
      const cue={...expectedCue,...patch,editedBy:'human',editedAt:'test'};
      saved={...saved,cues:saved.cues.map(c=>c.cueId===cue.cueId?cue:c)};
      writes.push(structuredClone(saved));result={cue,plan:saved};
    }
    else if(url==='/api/commentary/jobs'){
      submitted=JSON.parse(options.body).plan;
      if(fail)return {ok:false,json:async()=>({error:'network failed'})};
      result=running?{id:'test',action:'polish',status:'running',stage:'polishing'}:candidate();
    }else result=candidate();
    return {ok:true,json:async()=>result};
  };
  const ui=mountCommentaryUI({root,clip:{},sample:'test',variant:'v1'});
  return {root,writes,ui,get:label=>all(root).find(n=>n.textContent===label),
    field:label=>all(root).find(n=>n.attrs['aria-label']===label),
    text:()=>all(root).find(n=>n.attrs['aria-label']==='第 1 句解说文字'),
    ready:()=>new Promise(resolve=>setImmediate(resolve)),tick:async()=>{await tick();},
    restore(){ui.dispose();Object.assign(global,previous);}};
}

test('polish previews, explicitly adopts, saves and can undo without auto-writing',async()=>{
  const h=harness();try{
    await h.ready();await h.get('润色解说').fire('click');
    assert.equal(h.text().value,'突破上篮。');assert.equal(h.writes.length,0);
    await h.get('采用润色稿').fire('click');assert.equal(h.text().value,'这个跟防，真不下班。');
    assert.equal(h.writes.length,0);
    await h.get('保存解说稿 · 有未保存修改').fire('click');assert.equal(h.writes.length,1);
    await h.get('撤回本次润色').fire('click');assert.equal(h.text().value,'突破上篮。');
    assert.equal(h.get('保存解说稿 · 有未保存修改').disabled,false);
  }finally{h.restore();}
});

test('editing during a running polish prevents stale adoption',async()=>{
  const h=harness({running:true});try{
    await h.ready();await h.get('润色解说').fire('click');
    assert.equal(h.text().disabled,false);
    h.text().value='用户刚改的稿件。';await h.text().fire('input');await h.tick();
    assert.equal(h.text().value,'用户刚改的稿件。');assert.equal(h.get('采用润色稿').disabled,true);
    await h.get('采用润色稿').fire('click');assert.equal(h.text().value,'用户刚改的稿件。');
  }finally{h.restore();}
});

test('polish error preserves edited draft and permits retry',async()=>{
  const h=harness({fail:true});try{
    await h.ready();h.text().value='我的原稿。';await h.text().fire('input');await h.get('润色解说').fire('click');
    assert.equal(h.text().value,'我的原稿。');assert.equal(h.get('润色解说').disabled,false);assert.equal(h.writes.length,0);
  }finally{h.restore();}
});

test('saving one cue keeps another local draft and its server version separate',async()=>{
  const h=harness();try{
    await h.ready();await h.get('润色解说').fire('click');await h.get('采用润色稿').fire('click');
    h.text().value='人工改的第一句。';await h.text().fire('input');
    const second=h.field('第 2 句解说文字');second.value='第二句还没决定。';await second.fire('input');
    h.field('第 1 句语言').value='mul';await h.field('第 1 句语言').fire('change');
    await h.field('保存第 1 句').fire('click');
    assert.equal(h.writes.length,1);assert.equal(h.writes[0].cues[0].text,'人工改的第一句。');
    assert.equal(h.writes[0].cues[0].language,'mul');assert.equal(h.writes[0].cues[1].text,'回防。');
    assert.equal(h.field('第 2 句解说文字').value,'第二句还没决定。');
    assert.equal(h.field('保存第 1 句').disabled,true);
    await h.field('恢复第 2 句').fire('click');
    assert.equal(h.field('第 2 句解说文字').value,'回防。');assert.equal(h.writes.length,1);
  }finally{h.restore();}
});

test('single-cue conflict retains the human draft',async()=>{
  const h=harness({conflict:true});try{
    await h.ready();h.text().value='这句不能丢。';await h.text().fire('input');
    await h.field('保存第 1 句').fire('click');
    assert.equal(h.text().value,'这句不能丢。');assert.equal(h.writes.length,0);
    assert.equal(h.field('保存第 1 句').disabled,false);
  }finally{h.restore();}
});
