import test from 'node:test';
import assert from 'node:assert/strict';
import {mountVideoDisplay} from './video-display.mjs';

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
function setup(t,{initial=0,startTime=0,video=new FakeVideo(),onReady}={}) {
  const draws=[],ready=[],errors=[],status={hidden:false},message={textContent:''},retry=new FakeEvents(),stage={dataset:{}};
  let target=initial,drawError=null;
  const canvas={width:1920,height:1080,dataset:{},getContext:()=>({drawImage(...args){if(drawError)throw drawError;draws.push({time:video.currentTime,args});}})};
  const display=mountVideoDisplay({video,canvas,status,message,retry,stage,startTime,getTargetTime:()=>target,onReady:point=>{ready.push(point);onReady?.(point);},onError:error=>errors.push(error)});
  t.after(()=>display.dispose());
  return {video,canvas,status,message,retry,stage,display,draws,ready,errors,setTarget:value=>target=value,setDrawError:error=>drawError=error};
}

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
