import {preparationDigest,validateCourtPreparation} from './court-preparation.mjs';
import {adoptGroundTrajectory} from './ground-trajectory.mjs';

/** Async jobs only propose positions; adoption returns a checked preparation to its caller. */
export function createGroundTrajectoryAgentClient({context,snapshot,onChange=()=>{},fetch:request=globalThis.fetch.bind(globalThis),schedule=setTimeout,cancelSchedule=clearTimeout}){
  let status={available:false,message:'正在检查 Qwen 配置…'},job=null,error='',pending=false,base=null,epoch=0,timer=null,disposed=false;
  let stampCache=null,candidateCache=null;
  const running=()=>['queued','preparing','observing','analyzing','running','refining','rendering','validating'].includes(job?.status);
  const stamp=()=>{const s=snapshot();if(!stampCache||stampCache.sessionObject!==s.session||stampCache.preparation!==s.session.courtPreparation||stampCache.revision!==s.revision)stampCache={sessionObject:s.session,preparation:s.session.courtPreparation,revision:s.revision,session:JSON.stringify(s.session),preparationDigest:preparationDigest(s.session.courtPreparation??null)};return stampCache;};
  const stale=()=>{if(!base)return false;const s=stamp();return s.revision!==base.revision||s.session!==base.session||s.preparationDigest!==base.preparationDigest;};
  const changed=()=>{if(!disposed)onChange();};
  const stopTimer=()=>{if(timer!==null)cancelSchedule(timer);timer=null;};
  const query=()=>new URLSearchParams({...context,qa:context.qa?'1':'0'}).toString();
  async function json(url,body){
    const response=await request(url,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'Qwen 轨迹任务请求失败。');return value;
  }
  const state=()=>({status,job,error,busy:pending||running(),stale:stale()});
  async function init(){const ticket=epoch;try{const result=await json('/api/ground-trajectory-agent/status');if(!disposed&&ticket===epoch)status=result;}catch(cause){if(!disposed&&ticket===epoch)status={available:false,message:cause.message};}changed();return status;}
  async function poll(ticket){
    if(disposed||ticket!==epoch||!job)return;
    try{const result=await json(`/api/ground-trajectory-agent/jobs/${encodeURIComponent(job.jobId)}?${query()}`);if(disposed||ticket!==epoch)return;job=result;error='';changed();if(running())timer=schedule(()=>void poll(ticket),1200);}
    catch(cause){if(disposed||ticket!==epoch)return;error=cause.message;job={...job,status:'failed',message:'读取任务失败，可重新运行。'};changed();}
  }
  async function start(input){
    if(pending||running())throw new Error('当前任务仍在进行，请先取消。');
    stopTimer();const ticket=++epoch;base=stamp();job=null;error='';pending=true;changed();
    try{
      const result=await json('/api/ground-trajectory-agent/jobs',{...context,...input,session:JSON.parse(base.session),clientRevision:base.revision});
      if(disposed||ticket!==epoch){if(result.jobId)void json(`/api/ground-trajectory-agent/jobs/${encodeURIComponent(result.jobId)}/cancel`,context).catch(()=>{});return null;}
      job=result;if(running())timer=schedule(()=>void poll(ticket),800);return result;
    }catch(cause){if(disposed||ticket!==epoch)return null;error=cause.message;throw cause;}
    finally{if(!disposed&&ticket===epoch){pending=false;changed();}}
  }
  async function cancel(){
    const previous=job,ticket=++epoch;stopTimer();pending=false;base=null;job=previous?{...previous,status:'cancelled',message:'已取消，草稿未变化。',candidate:null}:null;error='';changed();
    if(previous?.jobId)try{await json(`/api/ground-trajectory-agent/jobs/${encodeURIComponent(previous.jobId)}/cancel`,context);}catch(cause){if(!disposed&&ticket===epoch){error=cause.message;changed();}}
  }
  function candidate(){
    if(stale()||!['ready','partial'].includes(job?.status))return null;
    const c=job?.candidate,p=snapshot().session.courtPreparation;
    if(candidateCache?.candidate===c&&candidateCache.preparation===p)return candidateCache.result;
    let result=null;
    if(c&&c.baseDigest===stamp().preparationDigest&&c.pointsByPlayer&&Array.isArray(c.entityIds)&&c.entityIds.length&&!c.entityIds.some(id=>!p?.preparedByPlayer[id])){
      try{const preview=structuredClone(p);for(const id of c.entityIds)preview.preparedByPlayer[id]=structuredClone(c.pointsByPlayer[id]);validateCourtPreparation(preview);result=c;}catch{}
    }
    candidateCache={candidate:c,preparation:p,result};return result;
  }
  async function adopt(){
    if(stale())throw new Error('草稿来源已变化，请重新运行 Qwen 修正。');
    const c=candidate();if(pending||!c)throw new Error('当前没有可采用的轨迹候选。');
    const ticket=epoch,original=snapshot().session.courtPreparation;pending=true;error='';changed();
    try{
      const value=await json(`/api/ground-trajectory-agent/jobs/${encodeURIComponent(job.jobId)}/adopt`,{...context,session:JSON.parse(base.session),clientRevision:base.revision,candidateRevision:c.revision});
      if(disposed||ticket!==epoch||stale())throw new Error('等待期间草稿或任务已变化，本次结果未覆盖草稿。');
      validateCourtPreparation(value.preparation);
      if(value.jobId!==job.jobId||value.candidate?.revision!==c.revision||preparationDigest(value.candidate)!==preparationDigest(c)||value.preparation.revision!==original.revision+1||preparationDigest(value.preparation.rawByPlayer)!==preparationDigest(original.rawByPlayer)||value.preparation.dependencyDigest!==original.dependencyDigest||value.preparation.videoSha256!==original.videoSha256)throw new Error('返回候选与当前准备来源不一致。');
      if(preparationDigest(value.preparation)!==preparationDigest(adoptGroundTrajectory(original,c)))throw new Error('返回准备与共享拟合结果不一致。');
      return value;
    }catch(cause){if(ticket===epoch)error=cause.message;throw cause;}
    finally{if(!disposed&&ticket===epoch){pending=false;changed();}}
  }
  function applied(){if(job)job={...job,status:'applied',message:'已采用模型地面位置估计，可撤销；仍需人工核对。'};base=null;changed();}
  function reportError(message){error=message;changed();}
  function dispose(){disposed=true;++epoch;stopTimer();}
  return {state,init,start,cancel,adopt,applied,candidate,reportError,dispose};
}
