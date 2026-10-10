// Keep a decoded frame in a canvas independently of the native video compositor.
export function mountVideoDisplay({video,canvas,status,message,retry,stage,rateControl=null,onReady=()=>{},onFrame=()=>{},onError=()=>{},getTargetTime=()=>video.currentTime,startTime=0}) {
  const context=canvas.getContext('2d');
  const validTime=value=>Number.isFinite(value)&&value>=0?value:null;
  // Match the annotation lookup's microsecond precision; 1ms can straddle a PTS boundary.
  const seekTolerance=1e-6+1e-9;
  let targetTime=validTime(getTargetTime())??0,pendingTime=targetTime;
  let state='loading',disposed=false,presenting=false,awaitingSeek=false,reloading=false;
  let wantsPlayback=!video.paused,playPending=false,playSerial=0;
  let videoFrameId=null,animationId=null,frameEpoch=0;
  const listeners=[];
  canvas.dataset.ready='false';
  let playbackRate=[.25,.5,1].includes(Number(rateControl?.value))?Number(rateControl.value):1;
  function applyPlaybackRate(){video.defaultPlaybackRate=playbackRate;video.playbackRate=playbackRate;if(rateControl)rateControl.value=String(playbackRate);}
  function changePlaybackRate(){const next=Number(rateControl.value);if([.25,.5,1].includes(next))playbackRate=next;applyPlaybackRate();}
  rateControl?.addEventListener('change',changePlaybackRate);
  applyPlaybackRate();

  function show(next,text,canRetry=false) {
    if(disposed)return;
    state=next;stage.dataset.videoState=next;
    status.hidden=next==='ready';message.textContent=text;
    retry.hidden=!canRetry;
  }
  function cancelFrames() {
    frameEpoch++;
    if(videoFrameId!==null&&typeof video.cancelVideoFrameCallback==='function')video.cancelVideoFrameCallback(videoFrameId);
    if(animationId!==null&&typeof globalThis.cancelAnimationFrame==='function')globalThis.cancelAnimationFrame(animationId);
    videoFrameId=null;animationId=null;
  }
  function fail(error,text='视频画面读取失败，请重新载入。') {
    if(disposed)return;
    cancelFrames();playPending=false;playSerial++;
    show('error',text,true);onError(text,error);
  }
  function boundedTime(time) {
    return Number.isFinite(video.duration)&&video.duration>=0?Math.min(time,video.duration):time;
  }
  function atTarget() {
    return pendingTime===null||Math.abs(video.currentTime-boundedTime(pendingTime))<seekTolerance;
  }
  function present(mediaTime) {
    if(disposed||presenting||video.error||awaitingSeek||video.seeking||video.readyState<2||!atTarget())return false;
    if(!canvas.width||!canvas.height)return false;
    presenting=true;
    try {
      try {
        if(!context)throw new Error('Canvas 2D context is unavailable');
        context.drawImage(video,0,0,canvas.width,canvas.height);
      } catch(error) {
        fail(error);return false;
      }
      const time=validTime(mediaTime)??video.currentTime,notify=state!=='ready';
      targetTime=time;pendingTime=null;
      canvas.dataset.ready='true';show('ready','');
      if(notify)onReady({time});
      onFrame({time});
      return true;
    } finally {presenting=false;}
  }
  function queueFrame(force=false) {
    if(disposed||state==='error'||videoFrameId!==null||animationId!==null)return;
    const playing=!video.paused&&!video.ended;
    if(!playing&&!force)return;
    const epoch=frameEpoch;
    if(typeof video.requestVideoFrameCallback==='function') {
      videoFrameId=video.requestVideoFrameCallback((_,metadata)=>{
        if(disposed||epoch!==frameEpoch)return;
        videoFrameId=null;present(metadata?.mediaTime);queueFrame();
      });
    } else if(playing&&typeof globalThis.requestAnimationFrame==='function') {
      animationId=globalThis.requestAnimationFrame(()=>{
        if(disposed||epoch!==frameEpoch)return;
        animationId=null;present();queueFrame();
      });
    }
  }
  function attemptPlayback() {
    if(disposed||!wantsPlayback||playPending||!video.paused||awaitingSeek||video.readyState<2||state==='error')return;
    applyPlaybackRate();playPending=true;const serial=++playSerial;
    let result;
    try {result=video.play();}
    catch(error){playPending=false;wantsPlayback=false;fail(error,'视频无法播放，请重新载入后重试。');return;}
    Promise.resolve(result).then(()=>{
      if(disposed||serial!==playSerial)return;
      playPending=false;queueFrame();
    },error=>{
      if(disposed||serial!==playSerial)return;
      playPending=false;wantsPlayback=false;
      fail(error,error?.name==='NotAllowedError'?'浏览器尚未允许播放，请再次点击播放。':'视频无法播放，请重新载入后重试。');
    });
  }
  function applyPendingSeek() {
    if(disposed||video.readyState<1||pendingTime===null||awaitingSeek)return;
    pendingTime=boundedTime(pendingTime);targetTime=pendingTime;
    if(Math.abs(video.currentTime-pendingTime)>=seekTolerance) {
      awaitingSeek=true;show('seeking','正在定位视频画面…');
      try {video.currentTime=pendingTime;}
      catch(error){awaitingSeek=false;fail(error,'无法定位视频画面，请重新载入。');return;}
    }
    present();queueFrame(true);
  }
  function pause() {
    if(disposed)return;
    wantsPlayback=false;playPending=false;playSerial++;
    video.pause();cancelFrames();present();
  }
  function seek(time) {
    if(disposed||validTime(time)===null)return false;
    targetTime=time;pendingTime=time;awaitingSeek=false;
    // Mark the old canvas as pending before pause/currentTime can emit events.
    show(video.readyState<1?'loading':'seeking',video.readyState<1?'正在载入视频…':'正在定位视频画面…');
    pause();applyPendingSeek();
    // A boundary seek may be requested inside onFrame while present() is locked.
    // If no actual seek is needed, present the target after that callback unwinds.
    if(presenting)queueMicrotask(()=>{if(!disposed)refresh();});
    return true;
  }
  function play() {
    if(disposed)return;
    wantsPlayback=true;applyPendingSeek();present();attemptPlayback();queueFrame();
  }
  function togglePlayback() {
    if(disposed)return;
    if(video.ended) {
      // Some clips have no decodable frame at zero; avoid native ended replay's zero seek.
      seek(validTime(startTime)??0);wantsPlayback=true;attemptPlayback();queueFrame();return;
    }
    if(wantsPlayback||!video.paused){pause();return;}
    wantsPlayback=true;applyPendingSeek();present();attemptPlayback();queueFrame();
  }
  function refresh() {
    if(disposed)return;
    applyPendingSeek();present();queueFrame();
  }
  function reload() {
    if(disposed)return;
    const resume=wantsPlayback||!video.paused;
    targetTime=pendingTime??validTime(getTargetTime())??validTime(video.currentTime)??targetTime;
    pendingTime=targetTime;awaitingSeek=false;reloading=true;
    cancelFrames();playPending=false;playSerial++;wantsPlayback=resume;
    show('loading','正在重新载入视频…');
    try {applyPlaybackRate();video.load();}
    catch(error){reloading=false;fail(error,'视频重新载入失败，请重试。');}
  }
  function listen(type,handler) {video.addEventListener(type,handler);listeners.push([type,handler]);}
  listen('loadedmetadata',()=>{reloading=false;applyPlaybackRate();applyPendingSeek();attemptPlayback();});
  for(const type of ['loadeddata','canplay'])listen(type,()=>{
    applyPendingSeek();present();attemptPlayback();queueFrame(true);
  });
  listen('seeking',()=>{
    awaitingSeek=true;
    const time=validTime(video.currentTime);
    // Native/manual navigation may replace a target before its seek completes.
    if(pendingTime===null||(time!==null&&Math.abs(time-pendingTime)>=seekTolerance))pendingTime=time??targetTime;
    cancelFrames();show('seeking','正在定位视频画面…');queueFrame(true);
  });
  listen('seeked',()=>{
    if(video.seeking)return;
    awaitingSeek=false;applyPendingSeek();present();attemptPlayback();queueFrame(true);
  });
  for(const type of ['play','playing'])listen(type,()=>{
    if(video.paused)return;
    wantsPlayback=true;present();queueFrame();
  });
  listen('pause',()=>{
    if(!reloading)wantsPlayback=false;
    cancelFrames();present();
  });
  listen('ended',()=>{wantsPlayback=false;cancelFrames();present();});
  listen('waiting',()=>show(awaitingSeek?'seeking':'loading',awaitingSeek?'正在定位视频画面…':'正在等待视频数据…'));
  listen('stalled',()=>{
    // A paused video can stop fetching even though its current frame is decoded.
    // Keep that usable frame visible; an unfinished seek must still show loading.
    if(present())return;
    show('loading','视频数据暂未就绪，可以重新载入。',true);
  });
  listen('error',()=>fail(video.error||new Error('Video media error'),video.error?.code===3?'视频解码失败，请重新载入。':'视频加载失败，请检查本地服务后重试。'));
  retry.addEventListener('click',reload);
  show('loading','正在载入视频…');applyPendingSeek();attemptPlayback();

  return {seek,pause,play,togglePlayback,refresh,reload,dispose(){
    if(disposed)return;
    disposed=true;cancelFrames();playSerial++;playPending=false;
    for(const [type,handler] of listeners)video.removeEventListener(type,handler);
    retry.removeEventListener('click',reload);
    rateControl?.removeEventListener('change',changePlaybackRate);
  }};
}
