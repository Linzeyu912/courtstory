/** Identity jobs are proposals. No transport response is allowed to mutate a draft. */
const hasObservations=clip=>clip.frames?.some(frame=>frame.tracks?.some(row=>Number.isInteger(row[4])&&row[4]>0&&row.slice(0,4).every(Number.isFinite)&&row[2]>row[0]&&row[3]>row[1]));

/** Reuse the existing detector queue; never submit an empty manual clip as a completed review. */
export async function prepareInitialIdentityObservations({clip,sample,variant,detectorVariant='team-stable',fetch:request=globalThis.fetch.bind(globalThis),
  onProgress=()=>{},isCurrent=()=>true,wait=()=>new Promise(resolve=>setTimeout(resolve,1200)),maxPolls=900}){
  if(hasObservations(clip))return {clip,sample,variant};
  const json=async(url,body)=>{const response=await request(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
    const value=await response.json();if(!response.ok)throw new Error(value.error||'人物检测准备失败，请在视频库检查模型环境后重试。');return value;};
  onProgress('当前视频缺少人物观察，正在准备检测器；已有人工草稿已保留。');
  let job=await json('/api/video-library/process',{sample,variant:detectorVariant});
  for(let attempt=0;attempt<maxPolls;attempt++){
    if(!isCurrent())return null;
    if(job.status==='error')throw new Error(job.message||'人物检测失败，请在视频库检查模型环境后重试。');
    if(job.status==='ready'&&job.variant===detectorVariant){
      const targetSample=job.sampleId||sample,targetClip=await json(`/api/clip?sample=${encodeURIComponent(targetSample)}&variant=${encodeURIComponent(detectorVariant)}`);
      if(!isCurrent())return null;
      if(!hasObservations(targetClip))throw new Error('检测已结束，但没有可用人物观察。请检查视频和检测模型；本轮身份初检尚未完成。');
      return {clip:targetClip,sample:targetSample,variant:targetClip.tracking_revision||targetClip.variant||detectorVariant};
    }
    onProgress(job.message||'正在运行人物检测；完成后自动继续身份初检。');await wait();
    if(!isCurrent())return null;
    const catalog=await json('/api/video-library'),entry=catalog.entries?.find(item=>item.id===job.sampleId||item.sampleId===job.sampleId);
    if(!entry)throw new Error('检测任务暂不在视频库中，请刷新视频库后重试初检；原草稿已保留。');
    if(entry.status==='error')throw new Error(entry.message||'人物检测失败，请检查模型环境。');
    if(entry.variants?.includes(detectorVariant))job={status:'ready',sampleId:entry.sampleId||entry.id,variant:detectorVariant};
    else if(entry.status==='ready')job=await json('/api/video-library/process',{sample,variant:detectorVariant});
    else job={...job,message:entry.message};
  }
  throw new Error('人物检测仍未完成，请在视频库查看任务状态，完成后重试初检。');
}

/** Carry an empty-detector draft only across a proven identical source/time grid. */
export function initialIdentityDraftForPreparedClip(session,source,target){
  if(session.videoHash!==source.video_sha256||source.video_sha256!==target.video_sha256||source.width!==target.width||source.height!==target.height||
    source.frames.length!==target.frames.length||source.frames.some((frame,index)=>frame.frame!==target.frames[index].frame||frame.time!==target.frames[index].time))
    throw new Error('检测结果的视频或帧时间与人工稿不同；原稿已保存，请从视频库打开检测结果后核对，不能自动迁移。');
  if(session.entities.some(entity=>['anchors','bindings','identityKeyframes','modelBindings','machineIdentityBindings'].some(field=>
    entity[field]?.some(item=>Number.isInteger(item.trackId)&&item.trackId>0))))
    throw new Error('原稿含旧跟踪编号，不能直接套用新检测编号；已保存原稿，请在视频库打开检测结果后核对。');
  return structuredClone(session);
}

export function createIdentityAgentClient({context,snapshot,onChange=()=>{},fetch:request=globalThis.fetch.bind(globalThis),schedule=setTimeout,cancelSchedule=clearTimeout,requestContext=()=>undefined,prepareInitialReview=null}){
  let status={available:false,message:'正在检查身份 Agent…'},job=null,error='',pending=false,base=null,epoch=0,timer=null;
  let selected=new Set(),edits=new Map();
  let displaySource=null,displayJob=null,editRevision=0,displayRevision=-1;
  let initialJob=null,initialError='',initialBase=null,initialPending=false,initialStarted=false,initialEpoch=0,initialTimer=null;
  let initialAwaitingApplication=false,initialContextKey=null;
  const explicitlyCancelledInitialTickets=new Set();
  const running=()=>['queued','preparing','analyzing','running','validating'].includes(job?.status);
  const stamp=()=>{const s=snapshot();return {session:JSON.stringify(s.session),revision:s.revision,entityId:s.entityId};};
  const isStale=()=>{if(!base)return false;const now=stamp();return now.session!==base.session||now.revision!==base.revision||now.entityId!==base.entityId;};
  function changed(){onChange();}
  async function json(url,body){
    const response=await request(url,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'身份 Agent 请求失败。');return value;
  }
  const sourceQuery=()=>new URLSearchParams({...context,qa:context.qa?'1':'0'}).toString();
  function stopTimer(){if(timer!==null)cancelSchedule(timer);timer=null;}
  const initialRunning=()=>['queued','preparing','analyzing','running','validating'].includes(initialJob?.status);
  const initialStamp=()=>{const s=snapshot();return {session:JSON.stringify(s.session),revision:s.revision,identityContext:JSON.stringify(requestContext()??null)};};
  const initialStale=()=>{if(!initialBase)return initialJob?.status==='ready'&&!initialWasApplied();const now=initialStamp();return initialBase.compatible===false||now.session!==initialBase.session||now.revision!==initialBase.revision||now.identityContext!==initialBase.identityContext;};
  function initialWasApplied(){
    const marker=snapshot().session?.initialIdentityReview;
    return Boolean(initialJob?.jobId&&(initialContextKey===null||initialStamp().identityContext===initialContextKey)&&marker?.sourceKey===initialJob.sourceKey&&
      (marker.generationJobId??marker.jobId)===(initialJob.generationJobId??initialJob.jobId));
  }
  function initialState(){return {job:initialJob,error:initialError,busy:initialPending||initialAwaitingApplication||initialRunning(),
    stale:!initialWasApplied()&&initialStale(),applied:initialWasApplied()};}
  function stopInitialTimer(){if(initialTimer!==null)cancelSchedule(initialTimer);initialTimer=null;}
  function state(){
    if(displaySource!==job||displayRevision!==editRevision){
      displaySource=job;displayRevision=editRevision;displayJob=job?structuredClone(job):null;
      for(const segment of displayJob?.candidate?.segments||[]){
        const edit=edits.get(segment.id);segment.originalStart=segment.start;segment.originalEnd=segment.end;
        if(edit)Object.assign(segment,edit);
      }
    }
    return {status,job:displayJob,error,busy:pending||running(),selectedIds:[...selected],stale:isStale(),initialReview:initialState()};
  }
  async function poll(ticket){
    if(ticket!==epoch||!job)return;
    try{
      const result=await json(`/api/identity-agent/jobs/${encodeURIComponent(job.jobId)}?${sourceQuery()}`);
      if(ticket!==epoch)return;
      job={...result,requestReference:job.requestReference};error='';changed();
      if(running())timer=schedule(()=>void poll(ticket),1200);
    }catch(cause){if(ticket!==epoch)return;error=cause.message;job={...job,status:'failed',message:'读取任务失败，请重新查找。'};changed();}
  }
  async function init(){
    try{status=await json('/api/identity-agent/status');}catch(cause){status={available:false,message:cause.message};}
    changed();return status;
  }
  async function pollInitial(ticket){
    if(ticket!==initialEpoch||!initialJob?.jobId)return;
    try{
      const value=await json(`/api/identity-agent/jobs/${encodeURIComponent(initialJob.jobId)}?${sourceQuery()}`);
      if(ticket!==initialEpoch)return;
      initialJob=value;initialError='';changed();
      if(initialRunning())initialTimer=schedule(()=>void pollInitial(ticket),1200);
    }catch(cause){
      if(ticket!==initialEpoch)return;
      initialError=cause.message;initialJob={...initialJob,status:'failed',message:'读取整段抽样初检失败；手工编辑可继续，可显式恢复任务。'};changed();
    }
  }
  async function startInitialReview(options={}){
    if(initialPending||initialRunning())return initialJob;
    if(initialStarted&&!options.forceRetry&&!options.reuseCached&&!options.restore)return initialJob;
    initialStarted=true;stopInitialTimer();const ticket=++initialEpoch;
    initialBase={...initialStamp(),compatible:true};initialContextKey=initialBase.identityContext;initialError='';initialPending=true;initialAwaitingApplication=false;changed();
    try{
      const initialStatus=status.initialReview??status;
      if(!initialStatus.available)throw new Error(initialStatus.message||'身份 Agent 尚未配置；可直接手工编辑。');
      if(prepareInitialReview){
        const previous=initialJob;initialJob={purpose:'initial_review',status:'preparing',message:'正在检查并准备人物检测观察…'};changed();
        const prepared=await prepareInitialReview({isCurrent:()=>ticket===initialEpoch,onProgress:message=>{
          if(ticket===initialEpoch){initialJob={...initialJob,message};changed();}
        }});
        if(ticket!==initialEpoch||prepared===false)return null;
        initialJob=previous;initialBase={...initialStamp(),compatible:true};initialContextKey=initialBase.identityContext;
      }
      const result=await json('/api/identity-agent/jobs',{...context,purpose:'initial_review',
        ...(JSON.parse(initialBase.identityContext)?{identityContext:JSON.parse(initialBase.identityContext)}:{}),
        session:JSON.parse(initialBase.session),clientRevision:initialBase.revision,
        ...(options.forceRetry?{forceRetry:true}:{}),...(options.reuseCached?{reuseCached:true}:{})});
      if(ticket!==initialEpoch){
        if(explicitlyCancelledInitialTickets.delete(ticket)&&result.jobId)
          await json(`/api/identity-agent/jobs/${encodeURIComponent(result.jobId)}/cancel`,context).catch(()=>{});
        return null;
      }
      if(result.purpose!=='initial_review'||!result.base||!result.sourceKey)throw new Error('整段初检响应缺少来源绑定。');
      initialBase.compatible=result.matchesCurrentInput!==false;initialBase.serverRevision=result.base.clientRevision;
      initialJob=result;
      if(initialRunning())initialTimer=schedule(()=>void pollInitial(ticket),800);
      return initialJob;
    }catch(cause){if(ticket!==initialEpoch)return null;initialError=cause.message;
      if(initialJob)initialJob={...initialJob,status:'review_required',message:'初检请求未完成；已有候选保留供人工核对。'};
      throw cause;}
    finally{if(ticket===initialEpoch){initialPending=false;changed();}}
  }
  async function retryInitialReview(){
    if(initialContextKey!==null&&initialContextKey!==initialStamp().identityContext)return startInitialReview({forceRetry:true,restore:true});
    if(initialJob?.candidate?.completionStatus==='partial')return startInitialReview({forceRetry:true,restore:true});
    if(initialJob?.candidate&&['ready','review_required'].includes(initialJob.status))return startInitialReview({reuseCached:true});
    return startInitialReview({forceRetry:true,restore:true});
  }
  async function cancelInitialReview(){
    const previous=initialJob;if(initialPending)explicitlyCancelledInitialTickets.add(initialEpoch);
    const ticket=++initialEpoch;stopInitialTimer();initialPending=false;initialAwaitingApplication=false;
    initialJob={...(previous??{purpose:'initial_review'}),status:'cancelled',message:'已取消本轮整段抽样初检；不会自动重启，仍可手工编辑。'};
    initialError='';changed();
    if(previous?.jobId)try{await json(`/api/identity-agent/jobs/${encodeURIComponent(previous.jobId)}/cancel`,context);}
    catch(cause){if(ticket===initialEpoch){initialError=cause.message;changed();}}
  }
  async function adoptInitialReview(){
    if(initialStale())throw new Error('初检期间草稿已修改；结果仅供核对，不会覆盖当前编辑。');
    if(initialPending||initialAwaitingApplication||initialJob?.status!=='ready'||initialWasApplied())throw new Error('当前没有可自动采用的整段初检结果。');
    const ticket=initialEpoch,original=initialJob;initialPending=true;initialError='';changed();
    try{
      const value=await json(`/api/identity-agent/jobs/${encodeURIComponent(original.jobId)}/adopt`,{
        ...(JSON.parse(initialBase.identityContext)?{identityContext:JSON.parse(initialBase.identityContext)}:{}),
        ...context,purpose:'initial_review',session:JSON.parse(initialBase.session),clientRevision:initialBase.serverRevision});
      if(ticket!==initialEpoch||initialStale())throw new Error('等待期间草稿或任务已变化；结果没有覆盖当前编辑。');
      if(value.purpose!=='initial_review'||value.jobId!==original.jobId||value.sourceKey!==original.sourceKey||value.base?.sessionDigest!==original.base.sessionDigest)
        throw new Error('初检返回的候选来源与当前任务不符。');
      initialAwaitingApplication=true;return value;
    }catch(cause){if(ticket===initialEpoch){initialError=cause.message;initialJob={...initialJob,status:'review_required',message:'初检候选保留，自动采用未完成；可手工核对。'};}throw cause;}
    finally{if(ticket===initialEpoch){initialPending=false;changed();}}
  }
  function initialApplied(report){
    initialAwaitingApplication=false;initialBase=null;
    if(initialJob)initialJob={...initialJob,applicationReport:structuredClone(report),message:'整段抽样初检已载入机器建议；人工记录保留，异常可继续核对。'};
    changed();
  }
  function reportInitialError(message){
    initialAwaitingApplication=false;initialError=message;
    if(initialJob?.status==='ready')initialJob={...initialJob,status:'review_required',message:'初检候选保留，自动采用未完成；可手工核对。'};
    changed();
  }
  async function start(input){
    if(pending||running())throw new Error('当前任务仍在进行，可先取消。');
    stopTimer();const ticket=++epoch;
    base=stamp();selected.clear();edits.clear();job=null;error='';pending=true;changed();
    const body={...context,...input,session:JSON.parse(base.session),clientRevision:base.revision,entityId:base.entityId};
    try{
      const result=await json('/api/identity-agent/jobs',body);
      if(ticket!==epoch){if(result.jobId)await json(`/api/identity-agent/jobs/${encodeURIComponent(result.jobId)}/cancel`,context).catch(()=>{});return null;}
      job={...result,requestReference:structuredClone(input.reference||null)};
      if(running())timer=schedule(()=>void poll(ticket),800);
      return job;
    }catch(cause){if(ticket!==epoch)return null;error=cause.message;throw cause;}
    finally{if(ticket===epoch){pending=false;changed();}}
  }
  async function cancel(){
    const previous=job,ticket=++epoch;stopTimer();pending=false;job=null;base=null;selected.clear();edits.clear();error='';changed();
    if(previous?.jobId)try{await json(`/api/identity-agent/jobs/${encodeURIComponent(previous.jobId)}/cancel`,context);}catch(cause){if(ticket===epoch){error=cause.message;changed();}}
  }
  function toggle(id){
    if(!job?.candidate?.segments?.some(s=>s.id===id)||isStale())return;
    if(selected.has(id))selected.delete(id);else selected.add(id);changed();
  }
  function edit(id,{start,end}){
    const original=job?.candidate?.segments?.find(s=>s.id===id);
    if(!original||![start,end].every(Number.isInteger)||start<original.start||end>original.end||start>end)throw new Error('只能在候选原范围内缩小起止帧。');
    if(!(original.evidenceFrames||[]).some(f=>f>=start&&f<=end))throw new Error('缩小后的范围须保留至少一张证据帧，请查看证据后调整。');
    edits.set(id,{start,end});editRevision++;changed();
  }
  async function adopt(){
    if(isStale())throw new Error('草稿或球员已变化，请重新查找后采用。');
    if(pending||job?.status!=='ready'||job.purpose!=='continuation')throw new Error('当前没有可采用的续接建议。');
    if(!selected.size)throw new Error('请先选择要采用的片段。');
    const ticket=epoch,original=job;
    pending=true;error='';changed();
    try{
      const value=await json(`/api/identity-agent/jobs/${encodeURIComponent(job.jobId)}/adopt`,{...context,session:JSON.parse(base.session),clientRevision:base.revision,entityId:base.entityId,selectedIds:[...selected]});
      if(ticket!==epoch||isStale())throw new Error('等待期间草稿或任务已变化，结果没有覆盖草稿。');
      const trusted=value.candidate?.segments;
      if(!Array.isArray(trusted)||trusted.length!==selected.size||new Set(trusted.map(s=>s.id)).size!==selected.size||trusted.some(s=>!selected.has(s.id)))throw new Error('返回的片段与所选候选不一致。');
      value.candidate.segments=trusted.map(segment=>{
        const before=original.candidate.segments.find(s=>s.id===segment.id);
        if(!before||before.trackId!==segment.trackId||before.start!==segment.start||before.end!==segment.end)throw new Error('候选范围已变化，请重新查找。');
        const narrowed=edits.get(segment.id)||segment;
        return {...segment,start:narrowed.start,end:narrowed.end,evidenceFrames:segment.evidenceFrames.filter(f=>f>=narrowed.start&&f<=narrowed.end)};
      });
      return value;
    }catch(cause){if(ticket===epoch)error=cause.message;throw cause;}
    finally{if(ticket===epoch){pending=false;changed();}}
  }
  function applied(){
    if(job){
      const candidate=structuredClone(job.candidate);
      if(job.purpose==='continuation')candidate.segments=candidate.segments.filter(s=>selected.has(s.id)).map(segment=>{
        const range=edits.get(segment.id)||segment;
        return {...segment,start:range.start,end:range.end,evidenceFrames:segment.evidenceFrames.filter(f=>f>=range.start&&f<=range.end)};
      });
      job={...job,candidate,status:'applied',message:job.purpose==='reference'?'参考身份已保存，可开始查找其他片段。':'已采用下面的片段，可撤销；仍需核对人物。'};
    }
    edits.clear();base=null;changed();
  }
  function reportError(value){error=value;changed();}
  function dispose(){++epoch;stopTimer();++initialEpoch;stopInitialTimer();}
  return {state,init,start,cancel,toggle,edit,adopt,applied,reportError,dispose,
    startInitialReview,retryInitialReview,cancelInitialReview,adoptInitialReview,initialApplied,reportInitialError};
}
