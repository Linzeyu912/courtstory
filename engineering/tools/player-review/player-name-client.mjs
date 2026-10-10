/** A small polling client for name proposals. Responses never edit a draft themselves. */
export function createPlayerNameClient({context={},snapshot,onChange=()=>{},fetch:request=globalThis.fetch.bind(globalThis),
  schedule=setTimeout,cancelSchedule=clearTimeout,pollInterval=1200,requestContext=()=>({})}){
  let job=null,error='',pending=false,epoch=0,timer=null,base=null,disposed=false,providerStatus=null;
  const listeners=new Set();
  const contextValue=()=>typeof context==='function'?context():context;
  let readRequestContext=requestContext;
  const stamp=()=>{const value=snapshot();return {session:JSON.stringify(value.session),revision:value.revision,
    videoHash:value.clip?.video_sha256,trackingFingerprint:value.clip?.tracking_fingerprint,
    trackingRevision:value.clip?.tracking_revision,requestContext:JSON.stringify(readRequestContext())};};
  const stale=()=>{
    if(!base)return false;const now=stamp();
    return now.session!==base.session||now.revision!==base.revision||
      now.videoHash!==base.videoHash||now.trackingFingerprint!==base.trackingFingerprint||now.trackingRevision!==base.trackingRevision||
      now.requestContext!==base.requestContext;
  };
  const changed=()=>{if(!disposed){const value=state();onChange(value);for(const listener of listeners)listener(value);}};
  const query=()=>new URLSearchParams(Object.fromEntries(Object.entries(contextValue()).filter(([,v])=>v!=null)
    .map(([k,v])=>[k,typeof v==='boolean'?(v?'1':'0'):String(v)]))).toString();
  async function json(url,body){
    const response=await request(url,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let value={};try{value=await response.json();}catch{}
    if(!response.ok)throw new Error(typeof value.error==='string'?value.error:'姓名识别请求失败，请重试。');
    return value;
  }
  function stopTimer(){if(timer!==null)cancelSchedule(timer);timer=null;}
  const running=()=>['queued','preparing','analyzing','running','validating'].includes(job?.status);
  function state(){return {job:job?structuredClone(job):null,error,busy:pending||running(),stale:stale(),canApply:Boolean(job?.status==='ready'&&!stale()&&!pending),
    visibility:true,providerStatus:providerStatus?structuredClone(providerStatus):null};}
  async function poll(ticket){
    if(disposed||ticket!==epoch||!job?.jobId)return;
    try{
      const value=await json(`/api/player-name-identity/jobs/${encodeURIComponent(job.jobId)}?${query()}`);
      if(disposed||ticket!==epoch)return;
      if(value.jobId!==job.jobId||value.purpose!=='player_names')throw new Error('姓名任务返回与当前请求不匹配。');
      job={...job,...value};error='';changed();
      if(running())timer=schedule(()=>void poll(ticket),pollInterval);
    }catch(cause){if(disposed||ticket!==epoch)return;error=cause.message;job={...job,status:'failed',message:'读取姓名任务失败，可重试。'};changed();}
  }
  async function init(){
    try{providerStatus=await json(`/api/player-name-identity/status?${query()}`);}
    catch(cause){providerStatus={available:false,message:cause.message};}
    changed();return structuredClone(providerStatus);
  }
  async function start(input={}){
    if(disposed)throw new Error('姓名识别客户端已关闭。');
    if(pending||running())throw new Error('姓名识别仍在进行，请先取消当前任务。');
    stopTimer();const ticket=++epoch;const current=stamp();base=current;job=null;error='';pending=true;changed();
    const value=snapshot();
    try{
      const result=await json(`/api/player-name-identity/jobs?${query()}`,{...contextValue(),...input,
        session:JSON.parse(current.session),clientRevision:current.revision,
        videoHash:current.videoHash,trackingFingerprint:current.trackingFingerprint,trackingRevision:current.trackingRevision});
      if(disposed||ticket!==epoch){if(result.jobId)void json(`/api/player-name-identity/jobs/${encodeURIComponent(result.jobId)}/cancel?${query()}`,contextValue()).catch(()=>{});return null;}
      if(result.purpose!=='player_names'||typeof result.jobId!=='string'||!result.base||typeof result.sourceKey!=='string')
        throw new Error('姓名任务响应缺少来源绑定，请重试。');
      if(result.base.videoHash!==current.videoHash||result.base.trackingFingerprint!==current.trackingFingerprint||result.base.trackingRevision!==current.trackingRevision)
        throw new Error('姓名任务绑定到不同视频或跟踪版本。');
      job=result; if(running())timer=schedule(()=>void poll(ticket),800);return structuredClone(job);
    }catch(cause){if(ticket!==epoch||disposed)return null;error=cause.message;throw cause;}
    finally{if(ticket===epoch&&!disposed){pending=false;changed();}}
  }
  async function retry(input={}){return start({...input,forceRetry:true});}
  async function cancel(){
    const previous=job;if(pending&&!previous){const ticket=++epoch;stopTimer();pending=false;error='';job={purpose:'player_names',status:'cancelled',message:'已取消本轮姓名识别。'};changed();return ticket;}
    ++epoch;stopTimer();pending=false;error='';if(previous)job={...previous,status:'cancelled',message:'已取消本轮姓名识别。'};changed();
    if(previous?.jobId)try{await json(`/api/player-name-identity/jobs/${encodeURIComponent(previous.jobId)}/cancel?${query()}`,contextValue());}
    catch(cause){if(!disposed){error=cause.message;changed();}}
  }
  function applied(){if(job)job={...job,status:'applied',message:'姓名建议已加入候选结果，仍需人工核对。'};base=null;changed();}
  function dispose(){disposed=true;++epoch;stopTimer();}
  function subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
  function setRequestContextProvider(provider){if(typeof provider==='function'){readRequestContext=provider;changed();}}
  return {state,start,retry,cancel,init,applied,dispose,subscribe,setRequestContextProvider};
}
