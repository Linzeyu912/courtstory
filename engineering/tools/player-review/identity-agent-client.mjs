/** Identity jobs are proposals. No transport response is allowed to mutate a draft. */
export function createIdentityAgentClient({context,snapshot,onChange=()=>{},fetch:request=globalThis.fetch.bind(globalThis),schedule=setTimeout,cancelSchedule=clearTimeout}){
  let status={available:false,message:'正在检查身份 Agent…'},job=null,error='',pending=false,base=null,epoch=0,timer=null;
  let selected=new Set(),edits=new Map();
  let displaySource=null,displayJob=null,editRevision=0,displayRevision=-1;
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
  function state(){
    if(displaySource!==job||displayRevision!==editRevision){
      displaySource=job;displayRevision=editRevision;displayJob=job?structuredClone(job):null;
      for(const segment of displayJob?.candidate?.segments||[]){
        const edit=edits.get(segment.id);segment.originalStart=segment.start;segment.originalEnd=segment.end;
        if(edit)Object.assign(segment,edit);
      }
    }
    return {status,job:displayJob,error,busy:pending||running(),selectedIds:[...selected],stale:isStale()};
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
  function dispose(){++epoch;stopTimer();}
  return {state,init,start,cancel,toggle,edit,adopt,applied,reportError,dispose};
}
