// Decode with HTMLVideoElement, paint the visible frame into a normal canvas.
// Native video surfaces can stay black in an embedded browser despite a healthy
// media clock. Keep status tied to successful frame painting, not just play().
export function createCanvasPlayer({video,canvas,toggle,restart,seek,rate,clock,status,poster,
  raf=requestAnimationFrame,caf=cancelAnimationFrame}){
  const context=canvas.getContext('2d',{alpha:false});
  let frameRequest=null,animationRequest=null,disposed=false,painted=false;
  const listeners=[];
  const on=(node,event,fn)=>{node.addEventListener(event,fn);listeners.push(()=>node.removeEventListener(event,fn));};
  const finiteDuration=()=>Number.isFinite(video.duration)&&video.duration>0?video.duration:0;
  const applyRate=()=>{const speed=Number(rate.value);if([.25,.5,1,1.5,2].includes(speed))video.playbackRate=speed;};
  const update=()=>{
    const duration=finiteDuration();seek.max=String(duration||1);seek.disabled=!duration;
    seek.value=String(video.currentTime||0);toggle.textContent=video.paused?'播放':'暂停';
    clock.textContent=`${(video.currentTime||0).toFixed(2)} / ${duration.toFixed(2)} 秒`;
  };
  function paint(){
    if(disposed||video.readyState<2||video.seeking||!video.videoWidth)return false;
    if(canvas.width!==video.videoWidth||canvas.height!==video.videoHeight){canvas.width=video.videoWidth;canvas.height=video.videoHeight;}
    try{
      context.drawImage(video,0,0,canvas.width,canvas.height);painted=true;
      canvas.dataset.paintedFrames=String(Number(canvas.dataset.paintedFrames||0)+1);
      canvas.dataset.mediaTime=String(video.currentTime);canvas.dataset.frameSource='video';
      status.textContent=video.ended?'播放结束，可重新播放':video.paused?'已暂停，可拖动进度条':'正在播放';
      update();return true;
    }catch(error){status.textContent='画面绘制失败，请重新加载：'+error.message;return false;}
  }
  function cancel(){
    if(frameRequest!==null){video.cancelVideoFrameCallback?.(frameRequest);frameRequest=null;}
    if(animationRequest!==null){caf(animationRequest);animationRequest=null;}
  }
  function schedule(){
    if(disposed||video.paused||video.ended||frameRequest!==null||animationRequest!==null)return;
    if(video.requestVideoFrameCallback){frameRequest=video.requestVideoFrameCallback(()=>{frameRequest=null;paint();schedule();});}
    else animationRequest=raf(()=>{animationRequest=null;paint();schedule();});
  }
  async function play(){
    if(disposed)return;
    // Only one report video plays at once; other players retain their last frame.
    video.ownerDocument?.querySelectorAll('video[data-report-decoder]').forEach(other=>{if(other!==video)other.pause();});
    if(video.ended)video.currentTime=0;
    try{await video.play();if(disposed)return;paint();schedule();}
    catch(error){status.textContent='未能播放，可点击重新加载：'+error.message;update();}
  }
  on(toggle,'click',()=>video.paused?play():video.pause());
  on(canvas,'click',()=>video.paused?play():video.pause());
  on(restart,'click',()=>{cancel();video.pause();painted=false;status.textContent='正在重新加载…';video.load();update();});
  on(seek,'input',()=>{const target=Number(seek.value);if(finiteDuration()&&Number.isFinite(target)){video.currentTime=Math.min(finiteDuration(),Math.max(0,target));status.textContent='正在定位画面…';}});
  on(rate,'change',applyRate);
  on(video,'loadedmetadata',()=>{applyRate();update();});
  on(video,'loadeddata',()=>{paint();schedule();});
  on(video,'seeked',()=>{paint();schedule();});
  on(video,'play',()=>{update();schedule();});
  on(video,'playing',()=>{paint();schedule();});
  on(video,'pause',()=>{cancel();paint();update();});
  on(video,'ended',()=>{cancel();paint();update();});
  on(video,'timeupdate',update);
  on(video,'waiting',()=>{status.textContent='正在缓冲，保留上一帧…';});
  on(video,'error',()=>{cancel();status.textContent=`视频加载失败（${video.error?.code??'未知'}），请重新加载或打开 MP4。`;update();});
  if(poster)on(poster,'load',()=>{if(!painted&&!disposed){context.drawImage(poster,0,0,canvas.width,canvas.height);canvas.dataset.frameSource='poster';}});
  update();paint();
  return {dispose(){disposed=true;cancel();listeners.forEach(remove=>remove());},paint};
}

if(typeof document!=='undefined')for(const host of document.querySelectorAll('[data-report-player]')){
  const get=part=>host.querySelector(`[data-part="${part}"]`),poster=new Image();
  createCanvasPlayer({video:get('video'),canvas:get('canvas'),toggle:get('toggle'),restart:get('restart'),
    seek:get('seek'),rate:get('rate'),clock:get('clock'),status:get('status'),poster});
  poster.src=host.dataset.poster;
  get('fullscreen').addEventListener('click',()=>{
    const request=host.requestFullscreen?.();request?.catch(()=>{get('status').textContent='当前浏览器不支持全屏，可打开 MP4 单独查看。';});
  });
}
