import {documentDigest} from './tactics-agent.mjs';

const busy=job=>['queued','running'].includes(job?.status);
const context=s=>({sample:s.sample,variant:s.variant,qa:s.qa,kind:s.kind});

// One immutable render task supplies both the canvas preview and delivery page.
export function createTacticsRenderClient({snapshot,request,onChange=()=>{},schedule=fn=>setTimeout(fn,1000),unschedule=clearTimeout}){
  let job=null,captured=null,error='',stale=false,starting=false,timer=null,serial=0,syncSerial=0,disposed=false;
  const state=()=>({job,error,stale,busy:starting||busy(job)});
  const notify=()=>{if(!disposed)onChange(state());};
  const clear=()=>{if(timer!==null)unschedule(timer);timer=null;};
  const query=()=>new URLSearchParams(captured.context).toString();
  async function sync(){
    const token=++syncSerial,current=snapshot();
    if(!captured){notify();return;}
    stale=true;notify();
    const digest=current.document?await documentDigest(current.document):null;
    if(token!==syncSerial||disposed)return;
    stale=digest!==captured.digest||JSON.stringify(context(current))!==JSON.stringify(captured.context)||
      (current.nameOverlayRevision??JSON.stringify(current.nameOverlay??null))!==captured.nameOverlayKey;notify();
  }
  function accept(value,token){
    if(disposed||token!==serial)return;
    job=value;error='';notify();clear();if(busy(job))timer=schedule(()=>poll());
  }
  async function poll(){
    if(!job||!busy(job)||disposed)return;const token=serial,id=job.id;
    try{accept(await request(`/api/tactics-render/jobs/${encodeURIComponent(id)}?${query()}`),token);}
    catch(e){if(token===serial&&!disposed){error=e.message;notify();clear();timer=schedule(()=>poll());}}
  }
  async function start(){
    if(starting||disposed)return;
    const source=snapshot();if(!source.document){error='请先建立并编辑战术草稿。';notify();return;}
    starting=true;error='';notify();
    try{
      const document=structuredClone(source.document),digest=await documentDigest(document),base=context(source);
      const nameOverlayKey=source.nameOverlayRevision??JSON.stringify(source.nameOverlay??null);
      if(captured?.digest===digest&&captured.nameOverlayKey===nameOverlayKey&&JSON.stringify(captured.context)===JSON.stringify(base)&&(busy(job)||job?.status==='succeeded')){await sync();return;}
      if(busy(job)){error='已有成片正在生成，请等待完成或取消后再生成当前草稿。';return;}
      const token=++serial;clear();captured={context:base,digest,nameOverlayKey};job=null;stale=false;
      const result=await request('/api/tactics-render/jobs',{...base,document,documentDigest:digest,expectedVersion:source.expectedVersion,
        options:{fps:30,...(source.nameOverlay?{nameOverlay:source.nameOverlay}:{})}});
      accept(result,token);await sync();
    }catch(e){error=e.message;}
    finally{starting=false;notify();}
  }
  async function cancel(){
    if(!job||!busy(job))return;const id=job.id,token=++serial;clear();
    try{accept(await request(`/api/tactics-render/jobs/${encodeURIComponent(id)}/cancel`,captured.context),token);}
    catch(e){if(token===serial){error=e.message;notify();timer=schedule(()=>poll());}}
  }
  return {start,cancel,poll,sync,state,dispose(){disposed=true;serial++;syncSerial++;clear();}};
}

export function mountTacticsProductionUI({snapshot,beforePreview=()=>{},beforeGenerate=async()=>{},request}){
  const $=id=>document.getElementById(id),prefixes=['tacticsRender','deliveryRender'];
  for(const prefix of prefixes){
    const host=$(prefix);if(!host)continue;
    host.innerHTML=`<div class="tactics-production-heading"><strong>${prefix==='tacticsRender'?'成片预览':'导出成片 MP4'}</strong><span class="small muted">静音 · 30 fps</span></div><p class="small muted">冻结绘制、剩余路线和镜头效果会一起编码；预览与下载使用同一份 MP4。</p><div class="tactics-buttons"><button id="${prefix}Start" class="primary">${prefix==='tacticsRender'?'生成成片预览':'生成成片 MP4'}</button><button id="${prefix}Cancel" hidden>取消生成</button><a id="${prefix}Download" class="primary" hidden download>下载成片 MP4</a></div><p id="${prefix}Status" role="status" aria-live="polite"></p><progress id="${prefix}Progress" hidden></progress><div id="${prefix}Result" hidden><video id="${prefix}Video" controls playsinline preload="metadata" aria-label="静音战术成片预览"></video><p id="${prefix}Metadata" class="small muted"></p></div>`;
  }
  function render(s){
    for(const prefix of prefixes){
      if(!$(prefix))continue;
      const result=s.job?.status==='succeeded',progress=s.job?.progress;
      $(prefix+'Start').disabled=s.busy||!snapshot().document;
      $(prefix+'Start').textContent=s.stale?'重新生成当前草稿':result?'已生成当前成片':prefix==='tacticsRender'?'生成成片预览':'生成成片 MP4';
      $(prefix+'Cancel').hidden=!s.busy||!s.job;$(prefix+'Cancel').disabled=!busy(s.job);
      $(prefix+'Progress').hidden=!s.busy||!progress;$(prefix+'Progress').max=progress?.total||1;$(prefix+'Progress').value=progress?.completed||0;
      const states={queued:'等待生成成片…',running:`正在生成成片${progress?.total?` · ${progress.completed} / ${progress.total} 帧`:''}`,succeeded:'成片已就绪。',failed:'成片生成失败，可修改后重试。',cancelled:'已取消生成，当前草稿保留。'};
      $(prefix+'Status').textContent=[s.stale?'草稿已修改：下面成片来自旧快照，请重新生成。':'',s.error||s.job?.error||s.job?.message||states[s.job?.status]||(s.busy?'正在准备草稿快照…':'生成前自动保存当前版本；预览与下载使用同一成片。')].filter(Boolean).join(' ');
      const url=result&&s.job.videoUrl;$(prefix+'Result').hidden=!url;$(prefix+'Download').hidden=!url;
      if(url){
        const video=$(prefix+'Video');if(video.getAttribute('src')!==url){video.setAttribute('src',url);video.load?.();}
        const link=$(prefix+'Download');link.href=url;link.download=`tactics-${s.job.id}.mp4`;link.textContent=s.stale?'下载旧快照 MP4':'下载成片 MP4';
        $(prefix+'Metadata').textContent=`${s.job.width} × ${s.job.height} · ${Number(s.job.duration).toFixed(2)} 秒 · ${s.job.totalFrames} 帧 · 保存版本 ${s.job.expectedVersion??'未知'} · 内容 ${s.job.documentDigest?.slice(0,12)??'未知'} · 静音${s.stale?' · 非当前草稿':''}`;
      }else $(prefix+'Video').pause?.();
    }
  }
  const client=createTacticsRenderClient({snapshot,request,onChange:render});
  for(const prefix of prefixes)if($(prefix)){
    $(prefix+'Start').onclick=async()=>{beforePreview();try{await beforeGenerate();await client.start();}catch(e){$(prefix+'Status').textContent=e.message+' 草稿保留，可重试。';}};
    $(prefix+'Cancel').onclick=()=>client.cancel();
    $(prefix+'Video').addEventListener('play',beforePreview);
  }
  render(client.state());
  return {...client,pause(){for(const prefix of prefixes)$(prefix+'Video')?.pause?.();}};
}
