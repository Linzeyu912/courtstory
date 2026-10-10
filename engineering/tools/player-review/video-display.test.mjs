import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mountVideoDisplay} from './video-display.mjs';
import {frameAtMediaTime,frameSeekTime} from './team-overlay.mjs';
import {createPhasePlayback} from './tactics-playback.mjs';

class FakeEvents {
  listeners=new Map();
  addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}
  removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);}
  emit(type){for(const handler of [...(this.listeners.get(type)||[])])handler({type});}
}
class FakeVideo extends FakeEvents {
  readyState=0;duration=12;paused=true;ended=false;seeking=false;error=null;
  time=0;seeks=[];loads=0;plays=0;callbacks=new Map();callbackId=0;
  get currentTime(){return this.time;}
  set currentTime(time){assert(this.readyState>=1,'seek must wait for metadata');this.seeks.push(time);this.time=time;this.ended=false;this.seeking=true;this.emit('seeking');}
  pause(){if(!this.paused){this.paused=true;this.emit('pause');}}
  play(){this.plays++;this.paused=false;this.emit('play');this.emit('playing');return Promise.resolve();}
  load(){this.loads++;this.readyState=0;this.seeking=false;this.error=null;this.time=0;this.paused=true;this.emit('pause');}
  metadata(){this.readyState=1;this.emit('loadedmetadata');}
  finishSeek(){this.readyState=4;this.seeking=false;this.emit('seeked');}
  data(){this.readyState=4;this.emit('loadeddata');this.emit('canplay');}
  requestVideoFrameCallback(handler){const id=++this.callbackId;this.callbacks.set(id,handler);return id;}
  cancelVideoFrameCallback(id){this.callbacks.delete(id);}
  frame(time=this.time){this.time=time;const item=this.callbacks.entries().next().value;if(item){this.callbacks.delete(item[0]);item[1](0,{mediaTime:time});}}
}
function setup(t,{initial=0,startTime=0,video=new FakeVideo(),rateControl=null,onReady,onFrame}={}) {
  const draws=[],ready=[],presented=[],errors=[],status={hidden:false},message={textContent:''},retry=new FakeEvents(),stage={dataset:{}};
  let target=initial,drawError=null;
  const canvas={width:1920,height:1080,dataset:{},getContext:()=>({drawImage(...args){if(drawError)throw drawError;draws.push({time:video.currentTime,args});}})};
  const display=mountVideoDisplay({video,canvas,status,message,retry,stage,startTime,rateControl,getTargetTime:()=>target,onReady:point=>{ready.push(point);onReady?.(point);},onFrame:point=>{presented.push(point);onFrame?.(point);},onError:error=>errors.push(error)});
  t.after(()=>display.dispose());
  return {video,canvas,status,message,retry,stage,display,draws,ready,presented,errors,setTarget:value=>target=value,setDrawError:error=>drawError=error};
}

test('slow playback survives reload and ended replay while annotations still receive source media time',async t=>{
  const rateControl=new FakeEvents();rateControl.value='1';
  const s=setup(t,{rateControl,startTime:.04});s.video.metadata();s.video.data();
  assert.equal(s.video.playbackRate,1);rateControl.value='.25';rateControl.emit('change');
  assert.equal(s.video.playbackRate,.25);assert.equal(s.video.defaultPlaybackRate,.25);
  s.display.seek(3);s.video.finishSeek();s.display.play();await Promise.resolve();
  s.video.frame(3.5);assert.equal(s.presented.at(-1).time,3.5);
  s.setTarget(3.5);s.display.reload();s.video.playbackRate=1;s.video.metadata();s.video.finishSeek();
  assert.equal(s.video.playbackRate,.25);assert.equal(s.video.currentTime,3.5);
  s.video.paused=true;s.video.ended=true;s.video.emit('ended');s.display.togglePlayback();s.video.finishSeek();await Promise.resolve();
  assert.equal(s.video.currentTime,.04);assert.equal(s.video.playbackRate,.25);
  rateControl.value='.5';rateControl.emit('change');assert.equal(s.video.playbackRate,.5);
  rateControl.value='4';rateControl.emit('change');assert.equal(s.video.playbackRate,.5);assert.equal(rateControl.value,'0.5');
  s.display.dispose();assert.equal(rateControl.listeners.get('change').size,0);
});

test('explicit play resumes after a queued seek and pause cancels deferred resume',async t=>{
  const s=setup(t);s.video.metadata();s.video.data();
  assert.equal(typeof s.display.play,'function');
  s.display.seek(3);s.display.play();assert.equal(s.video.plays,0);
  s.video.finishSeek();await Promise.resolve();assert.equal(s.video.plays,1);
  s.display.seek(4);s.display.play();s.display.pause();s.video.finishSeek();await Promise.resolve();assert.equal(s.video.plays,1);
});

test('phase boundary and final frame complete exact-hit seeks inside presented callbacks; skipped freezes decode their target',async t=>{
  const frames=Array.from({length:61},(_,i)=>({time:i*.1})),p=createPhasePlayback();
  p.configure([{phaseId:'a',startFrame:0,endFrameExclusive:30,freezeFrame:12},{phaseId:'b',startFrame:30,endFrameExclusive:61,freezeFrame:42}],'a');
  let s;
  const run=commands=>{for(const c of commands){if(c.type==='pause')s.display.pause();else if(c.type==='play')s.display.play();else if(c.type==='seek')s.display.seek(frameSeekTime(frames,c.frame));}};
  s=setup(t,{initial:frameSeekTime(frames,12),onFrame:({time})=>run(p.presented(frameAtMediaTime(frames,time)))});
  s.video.metadata();s.video.finishSeek();run(p.select('a'));run(p.continue(12));await Promise.resolve();
  s.video.frame(frameSeekTime(frames,42));await Promise.resolve();assert.equal(p.state().status,'paused');assert.equal(s.stage.dataset.videoState,'ready');assert.equal(frameAtMediaTime(frames,s.presented.at(-1).time),42);
  run(p.continue(42));await Promise.resolve();s.video.frame(frameSeekTime(frames,60));await Promise.resolve();assert.equal(p.state().status,'ended');assert.equal(s.stage.dataset.videoState,'ready');
  run(p.select('a'));s.video.finishSeek();run(p.continue(12));await Promise.resolve();s.video.frame(4.8);
  assert.equal(p.state().status,'seeking');assert.equal(s.video.seeks.at(-1),frameSeekTime(frames,42));s.video.finishSeek();assert.equal(p.state().status,'paused');
});

test('a direct external seek supersedes a still-pending phase seek instead of restoring its older target',t=>{
  const s=setup(t);s.video.metadata();s.video.data();s.display.seek(3);
  s.video.currentTime=5;s.video.finishSeek();assert.equal(s.stage.dataset.videoState,'ready');assert.equal(s.video.currentTime,5);assert.equal(s.presented.at(-1).time,5);
});

test('a presented last frame with a sub-millisecond lagging media clock performs an exact seek before ending',async t=>{
  const frames=Array.from({length:143},(_,i)=>({time:i/30})),p=createPhasePlayback();
  p.configure([{phaseId:'last',startFrame:90,endFrameExclusive:143,freezeFrame:90}],'last');
  p.select('last');
  let s;
  const run=commands=>{for(const c of commands){if(c.type==='pause')s.display.pause();else if(c.type==='play')s.display.play();else if(c.type==='seek')s.display.seek(frameSeekTime(frames,c.frame));}};
  s=setup(t,{initial:frameSeekTime(frames,108),onFrame:({time})=>run(p.presented(frameAtMediaTime(frames,time)))});
  s.video.metadata();s.video.finishSeek();p.externalSeek(108);p.presented(108);run(p.continue(108));await Promise.resolve();assert.equal(p.state().status,'playing');
  s.video.time=4.732785;const [id,callback]=s.video.callbacks.entries().next().value;s.video.callbacks.delete(id);callback(0,{mediaTime:frames[142].time});await Promise.resolve();
  assert.equal(s.video.currentTime,frameSeekTime(frames,142),'lagging currentTime must cross the frame boundary even when within 1ms');
  s.video.finishSeek();assert.equal(p.state().status,'ended');assert.equal(frameAtMediaTime(frames,s.presented.at(-1).time),142);
});

test('annotation frames follow presented media time and never advance on pending or failed draws',t=>{
  const s=setup(t);s.video.metadata();s.video.data();s.display.togglePlayback();
  s.video.time=1.08;const [id,callback]=s.video.callbacks.entries().next().value;
  s.video.callbacks.delete(id);callback(0,{mediaTime:1});
  assert.equal(s.presented.at(-1).time,1);
  const count=s.presented.length;s.display.seek(4);s.video.frame(4);
  assert.equal(s.presented.length,count);
  s.setDrawError(new Error('draw failed'));s.video.finishSeek();
  assert.equal(s.presented.length,count);
  s.display.dispose();callback(0,{mediaTime:5});assert.equal(s.presented.length,count);
});

test('metadata precedes seeking and only the latest queued target is presented',t=>{
  const s=setup(t,{initial:.033});s.display.seek(2);s.display.seek(3);
  assert.deepEqual(s.video.seeks,[]);assert.equal(s.stage.dataset.videoState,'loading');assert.equal(s.status.hidden,false);
  s.video.metadata();assert.deepEqual(s.video.seeks,[3]);assert.equal(s.stage.dataset.videoState,'seeking');assert.equal(s.draws.length,0);
  s.video.finishSeek();assert.equal(s.draws.at(-1).time,3);assert.equal(s.canvas.dataset.ready,'true');
  assert.equal(s.stage.dataset.videoState,'ready');assert.equal(s.status.hidden,true);
});

test('loaded data paints a paused first frame without starting playback',t=>{
  const s=setup(t);s.video.metadata();assert.equal(s.draws.length,0);s.video.data();
  assert.deepEqual(s.draws[0].args,[s.video,0,0,1920,1080]);assert.equal(s.video.plays,0);assert.equal(s.video.paused,true);
  assert.equal(s.ready[0].time,0);assert.equal(s.video.callbacks.size,1);
  s.video.frame();assert.equal(s.video.callbacks.size,0);
});

test('paused frame steps keep the old canvas pending until the new seek finishes',t=>{
  const s=setup(t);s.video.metadata();s.video.data();const count=s.draws.length;
  s.display.seek(4);assert.equal(s.stage.dataset.videoState,'seeking');assert.equal(s.canvas.dataset.ready,'true');
  s.display.refresh();s.video.emit('canplay');s.video.frame();assert.equal(s.draws.length,count);
  s.video.finishSeek();assert.equal(s.draws.at(-1).time,4);assert.equal(s.stage.dataset.videoState,'ready');assert.equal(s.video.paused,true);
});

test('a stalled network request does not cover a decoded paused frame',t=>{
  const s=setup(t);s.video.metadata();s.video.data();s.video.readyState=3;
  s.video.emit('stalled');
  assert.equal(s.stage.dataset.videoState,'ready');assert.equal(s.status.hidden,true);
  assert.equal(s.retry.hidden,true);assert.equal(s.video.plays,0);
});

test('stalled requests during a seek keep the old frame pending',t=>{
  const s=setup(t);s.video.metadata();s.video.data();s.display.seek(4);
  const count=s.draws.length;s.video.emit('stalled');
  assert.equal(s.draws.length,count);assert.equal(s.status.hidden,false);assert.equal(s.retry.hidden,false);
  s.video.finishSeek();assert.equal(s.stage.dataset.videoState,'ready');assert.equal(s.status.hidden,true);
});

test('frame navigation survives quantized seeks followed by actual decoded-frame callbacks',t=>{
  const records=JSON.parse(fs.readFileSync(new URL('../../../engineering/tests/fixtures/player-observations/004-team-stable.json',import.meta.url),'utf8'));
  const pts=records.map(record=>record.source_frame_pts*record.source_time_base[0]/record.source_time_base[1]);
  class QuantizedVideo extends FakeVideo {
    get currentTime(){return super.currentTime;}
    set currentTime(time){super.currentTime=Math.floor(time*1e6)/1e6;}
    decodedFrame(){
      const decoded=Math.max(0,pts.findLastIndex(time=>time<=this.currentTime));
      const item=this.callbacks.entries().next().value;
      if(item){this.callbacks.delete(item[0]);item[1](0,{mediaTime:Math.floor(pts[decoded]*1e6)/1e6});}
      return decoded;
    }
  }
  const video=new QuantizedVideo(),s=setup(t,{video,initial:frameSeekTime(records,0)});
  video.metadata();video.finishSeek();video.decodedFrame();
  const displayed=()=>frameAtMediaTime(records,s.presented.at(-1).time);
  // Reproduce the old two-click bug: seeked first reports target currentTime,
  // then rVFC correctly reports the previous source frame actually decoded.
  s.display.seek(records[1].time);video.finishSeek();
  assert.equal(displayed(),1);assert.equal(video.decodedFrame(),0);assert.equal(displayed(),0);
  const step=index=>{
    s.display.seek(frameSeekTime(records,index));video.finishSeek();
    assert.equal(video.decodedFrame(),index);assert.equal(displayed(),index);
  };
  step(0);
  for(let index=1;index<records.length;index++)step(index);
  for(let index=records.length-2;index>=0;index--)step(index);
  for(let index=1;index<=32;index++)s.display.seek(frameSeekTime(records,index));
  video.finishSeek();assert.equal(video.decodedFrame(),32);assert.equal(displayed(),32,'rapid scrubber input keeps its latest target');
  s.display.pause();s.display.refresh();s.display.refresh();
  step(displayed()-1);assert.equal(displayed(),31,'pause and undo-style refreshes do not change the next previous-frame action');
});

test('reload preserves the requested time and resumes only when previously playing',async t=>{
  const s=setup(t);s.video.metadata();s.video.data();s.display.togglePlayback();await Promise.resolve();
  s.video.frame(2.5);s.setTarget(2.5);s.display.reload();
  assert.equal(s.video.loads,1);assert.equal(s.stage.dataset.videoState,'loading');assert.equal(s.video.callbacks.size,0);
  s.video.metadata();assert.equal(s.video.seeks.at(-1),2.5);assert.equal(s.video.plays,1);
  s.video.finishSeek();await Promise.resolve();assert.equal(s.video.plays,2);assert.equal(s.video.paused,false);
  s.display.pause();s.display.seek(7);s.setTarget(7);s.display.reload();s.video.metadata();s.video.finishSeek();
  assert.equal(s.video.currentTime,7);assert.equal(s.video.plays,2);assert.equal(s.video.paused,true);
});

test('pause during reload cancels deferred playback',async t=>{
  const s=setup(t);s.video.metadata();s.video.data();s.display.togglePlayback();await Promise.resolve();
  s.display.reload();s.display.pause();s.video.metadata();s.video.data();
  assert.equal(s.video.plays,1);assert.equal(s.video.paused,true);
});

test('ended replay seeks the first decodable frame before resuming playback',async t=>{
  const first=.040989,s=setup(t,{initial:first,startTime:first});s.video.metadata();s.video.finishSeek();
  s.video.time=s.video.duration;s.video.ended=true;s.video.emit('ended');
  s.display.togglePlayback();assert.equal(s.video.seeks.at(-1),first);assert.equal(s.stage.dataset.videoState,'seeking');
  assert.equal(s.video.plays,0);s.video.emit('canplay');s.display.refresh();assert.equal(s.video.plays,0);
  s.video.finishSeek();await Promise.resolve();assert.equal(s.video.plays,1);assert.equal(s.video.paused,false);
  assert.equal(s.stage.dataset.videoState,'ready');assert.equal(s.draws.at(-1).time,first);
});

test('pause while ended replay is seeking cancels deferred playback',t=>{
  const s=setup(t,{startTime:.040989});s.video.metadata();s.video.data();
  s.video.time=s.video.duration;s.video.ended=true;s.video.emit('ended');s.display.togglePlayback();
  s.display.pause();s.video.finishSeek();assert.equal(s.video.plays,0);assert.equal(s.video.paused,true);
  assert.equal(s.stage.dataset.videoState,'ready');assert.equal(s.video.currentTime,.040989);
});

test('media errors and failed canvas draws expose retry and recover after reload',t=>{
  const s=setup(t);s.video.metadata();s.video.data();s.video.error={code:3};s.video.emit('error');
  assert.equal(s.stage.dataset.videoState,'error');assert.equal(s.retry.hidden,false);assert.match(s.message.textContent,/解码失败/);
  assert.match(s.errors[0],/解码失败/);
  s.retry.emit('click');assert.equal(s.video.loads,1);s.video.metadata();s.video.data();assert.equal(s.stage.dataset.videoState,'ready');
  s.setDrawError(new Error('draw failed'));s.display.refresh();assert.equal(s.stage.dataset.videoState,'error');assert.equal(s.retry.hidden,false);
  s.setDrawError(null);s.display.reload();s.video.metadata();s.video.data();assert.equal(s.stage.dataset.videoState,'ready');assert.equal(s.errors.length,2);
});

test('frame callbacks remain a single chain and dispose cancels callbacks and listeners',async t=>{
  const s=setup(t);s.video.metadata();s.video.data();s.display.togglePlayback();await Promise.resolve();
  for(let i=0;i<6;i++){s.display.refresh();s.video.emit('canplay');assert.equal(s.video.callbacks.size,1);s.video.frame(i/10);assert.equal(s.video.callbacks.size,1);}
  assert.equal(s.ready.length,1,'playing frames must not repeatedly notify the annotation UI');
  const stale=[...s.video.callbacks.values()][0],count=s.draws.length;s.display.dispose();
  assert.equal(s.video.callbacks.size,0);stale(0,{mediaTime:2});s.video.emit('loadeddata');s.retry.emit('click');
  assert.equal(s.draws.length,count);assert.equal(s.video.loads,0);assert([...s.video.listeners.values()].every(handlers=>handlers.size===0));
});

test('onReady can refresh the UI without recursive presentation',t=>{
  let display;const s=setup(t,{onReady:()=>display?.refresh()});display=s.display;
  s.video.metadata();s.video.data();assert.equal(s.ready.length,1);assert.equal(s.stage.dataset.videoState,'ready');
});

test('a rejected play request can be retried by the next explicit play action',async t=>{
  const s=setup(t);s.video.metadata();s.video.data();
  s.video.play=()=>Promise.reject(Object.assign(new Error('blocked'),{name:'NotAllowedError'}));
  s.display.togglePlayback();await Promise.resolve();assert.equal(s.stage.dataset.videoState,'error');
  s.video.play=FakeVideo.prototype.play;s.display.togglePlayback();await Promise.resolve();
  assert.equal(s.video.paused,false);assert.equal(s.stage.dataset.videoState,'ready');
});

test('late play events after pause do not restore deferred playback intent',t=>{
  const s=setup(t);s.video.metadata();s.video.data();s.display.pause();s.video.emit('play');
  s.display.reload();s.video.metadata();s.video.data();assert.equal(s.video.plays,0);assert.equal(s.video.paused,true);
});

test('fallback RAF runs only while playing and waiting stays visibly pending',async t=>{
  const oldRequest=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame,callbacks=new Map();let next=0;
  globalThis.requestAnimationFrame=handler=>{const id=++next;callbacks.set(id,handler);return id;};
  globalThis.cancelAnimationFrame=id=>callbacks.delete(id);
  t.after(()=>{globalThis.requestAnimationFrame=oldRequest;globalThis.cancelAnimationFrame=oldCancel;});
  const video=new FakeVideo();video.requestVideoFrameCallback=undefined;const s=setup(t,{video});
  video.metadata();video.data();assert.equal(callbacks.size,0);s.display.refresh();assert.equal(callbacks.size,0);
  s.display.togglePlayback();await Promise.resolve();assert.equal(callbacks.size,1);
  video.readyState=1;video.emit('waiting');assert.equal(s.stage.dataset.videoState,'loading');assert.equal(s.status.hidden,false);
  const [id,handler]=callbacks.entries().next().value;callbacks.delete(id);handler();assert.equal(callbacks.size,1);assert.equal(s.stage.dataset.videoState,'loading');
  video.data();assert.equal(s.stage.dataset.videoState,'ready');s.display.pause();assert.equal(callbacks.size,0);
});
