import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasPlayer} from './player.mjs';

function fixture({fallback=false}={}){
  const element=()=>Object.assign(new EventTarget(),{value:'',textContent:'',dataset:{}});
  const parts=Object.fromEntries(['video','canvas','toggle','restart','seek','rate','clock','status','poster'].map(k=>[k,element()]));
  const {video,canvas}=parts,callbacks=new Map(),draws=[];
  let next=0;
  Object.assign(video,{duration:10,currentTime:0,readyState:2,videoWidth:1440,videoHeight:740,paused:true,ended:false,seeking:false,
    play:async()=>{video.paused=false;video.dispatchEvent(new Event('play'));video.dispatchEvent(new Event('playing'));},
    pause:()=>{video.paused=true;video.dispatchEvent(new Event('pause'));},
    load:()=>{video.readyState=0;video.currentTime=0;},
  });
  if(!fallback){video.requestVideoFrameCallback=fn=>{callbacks.set(++next,fn);return next;};video.cancelVideoFrameCallback=id=>callbacks.delete(id);}
  canvas.getContext=()=>({drawImage:source=>draws.push(source===video?video.currentTime:'poster')});
  const player=createCanvasPlayer({...parts,raf:fn=>{callbacks.set(++next,fn);return next;},caf:id=>callbacks.delete(id)});
  const fire=(name,event)=>parts[name].dispatchEvent(new Event(event));
  const frame=time=>{video.currentTime=time;const [id,fn]=callbacks.entries().next().value;callbacks.delete(id);fn();};
  return {...parts,player,callbacks,draws,fire,frame};
}

test('播放持续绘制，暂停取消回调，暂停跳转后绘制新帧',async()=>{
  const p=fixture();p.fire('toggle','click');await Promise.resolve();
  assert.equal(p.callbacks.size,1);p.frame(2);assert.equal(p.draws.at(-1),2);
  p.fire('toggle','click');assert.equal(p.callbacks.size,0);
  p.seek.value='7';p.video.seeking=true;p.fire('seek','input');
  assert.equal(p.video.currentTime,7);assert.equal(p.player.paint(),false);assert.equal(p.draws.at(-1),2);
  p.video.seeking=false;p.fire('video','seeked');assert.equal(p.draws.at(-1),7);
  assert.equal(p.canvas.dataset.frameSource,'video');assert.equal(p.callbacks.size,0);
  p.player.dispose();
});

test('重复媒体事件不叠加帧循环，结束保留最后一帧并可重播',async()=>{
  const p=fixture();p.fire('toggle','click');await Promise.resolve();
  p.fire('video','playing');p.fire('video','loadeddata');assert.equal(p.callbacks.size,1);
  p.video.currentTime=10;p.video.ended=true;p.video.paused=true;p.fire('video','ended');
  assert.equal(p.callbacks.size,0);assert.equal(p.draws.at(-1),10);
  p.fire('toggle','click');await Promise.resolve();assert.equal(p.video.currentTime,0);
  p.player.dispose();
});

test('缓冲和延迟封面不覆盖已绘制画面，重载后恢复解码帧',()=>{
  const p=fixture();const count=p.draws.length;p.fire('poster','load');assert.equal(p.draws.length,count);
  p.fire('video','waiting');assert.match(p.status.textContent,/保留上一帧/);assert.equal(p.draws.length,count);
  p.fire('restart','click');assert.equal(p.video.readyState,0);
  p.video.readyState=2;p.fire('video','loadeddata');assert.equal(p.draws.at(-1),0);
  p.player.dispose();
});

test('RAF 回退也能播放，错误和卸载停止调度',async()=>{
  const p=fixture({fallback:true});p.fire('toggle','click');await Promise.resolve();p.frame(1);
  assert.equal(p.draws.at(-1),1);p.video.error={code:3};p.fire('video','error');
  assert.equal(p.callbacks.size,0);assert.match(p.status.textContent,/加载失败（3）/);
  p.player.dispose();const count=p.draws.length;p.fire('video','seeked');assert.equal(p.draws.length,count);
});

test('播放拒绝显示恢复提示，非法时长和倍率不会写入媒体',async()=>{
  const p=fixture();p.video.play=async()=>{throw new Error('blocked');};p.fire('toggle','click');await Promise.resolve();
  assert.match(p.status.textContent,/未能播放/);p.video.duration=NaN;p.fire('video','loadedmetadata');
  assert.equal(p.seek.disabled,true);p.seek.value='5';p.fire('seek','input');assert.equal(p.video.currentTime,0);
  p.rate.value='0.5';p.fire('rate','change');assert.equal(p.video.playbackRate,.5);
  p.fire('restart','click');p.video.playbackRate=1;p.fire('video','loadedmetadata');assert.equal(p.video.playbackRate,.5);
  p.rate.value='0';p.fire('rate','change');assert.equal(p.video.playbackRate,.5);p.player.dispose();
});
