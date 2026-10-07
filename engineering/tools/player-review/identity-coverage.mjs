import {buildTrajectories} from './trajectory.mjs';
import {validateFrameRange} from './tactics-time-range.mjs';
export function buildIdentityCoverage(session,frames,sourceCuts=[],clip=null){
  const points=buildTrajectories(session,frames,sourceCuts,clip),byPlayer={},unresolvedRanges=[],conflicts=[];
  for(const e of session.entities){
    const ranges=[];let previous=null;
    for(const p of points[e.id]){
      const state=p.source==='out_of_view'?'out_of_view':p.source==='conflict'?'conflict':p.x===null?'missing':p.frameIdentityConfirmed?'reviewed':'associated';
      if(previous?.state===state)previous.endFrameExclusive=p.frame+1;
      else{previous={entityId:e.id,state,startFrame:p.frame,endFrameExclusive:p.frame+1};ranges.push(previous);}
    }
    byPlayer[e.id]=ranges;
    unresolvedRanges.push(...ranges.filter(r=>r.state==='missing'||r.state==='conflict'));
    conflicts.push(...ranges.filter(r=>r.state==='conflict'));
  }
  return {byPlayer,unresolvedRanges,conflicts,frameMapping:frames.map(f=>({frame:f.frame,time:f.time})),cuts:[...new Set([...(session.cuts??[]),...sourceCuts])].sort((a,b)=>a-b)};
}
export function planContinuationWindows(coverage,{range,entityId,windowSeconds=4,overlapSeconds=1}){
  const m=coverage.frameMapping;validateFrameRange(m,range);
  if(!Number.isFinite(windowSeconds)||!Number.isFinite(overlapSeconds)||windowSeconds<=overlapSeconds||overlapSeconds<0)throw new Error('续接窗口参数无效。');
  const gaps=coverage.unresolvedRanges.filter(r=>!entityId||r.entityId===entityId),windows=[];
  for(const gap of gaps){
    let start=Math.max(range.startFrame,gap.startFrame),end=Math.min(range.endFrameExclusive,gap.endFrameExclusive);
    while(start<end){
      const cut=coverage.cuts.find(c=>c>start&&c<end),limit=cut??end;
      let stop=start+1;while(stop<limit&&m[stop].time<m[start].time+windowSeconds)stop++;
      if(!windows.some(w=>w.startFrame===start&&w.endFrameExclusive===stop))windows.push({startFrame:start,endFrameExclusive:stop});
      if(stop===limit){start=limit;continue;}
      let next=stop;while(next>start+1&&m[next-1].time>=m[stop].time-overlapSeconds)next--;
      start=Math.max(start+1,next);
    }
  }
  return windows;
}
export function mountIdentityCoverage({host,clip,state,agent,seek,storageKey}){
  const root=document.createElement('section');root.className='identity-coverage-panel';
  root.innerHTML='<h3>全片身份时间条与续接队列</h3><div data-coverage></div><p data-summary role="status"></p><div class="tactics-buttons"><button data-plan>让 Agent 续接此球员（全片分窗）</button><button data-next>执行下一窗 / 重试</button><button data-skip>保留未知，跳过这窗</button><button data-cancel>暂停续接队列</button></div><p data-queue role="status"></p>';
  host.append(root);const $=k=>root.querySelector(`[data-${k}]`);let queues={},message='';
  try{queues=JSON.parse(localStorage.getItem(storageKey))??{};}catch{}
  const save=()=>localStorage.setItem(storageKey,JSON.stringify(queues));
  const reference=()=>JSON.stringify(state().session.entities.find(e=>e.id===state().entityId)?.identityReference??null);
  const safe=fn=>async()=>{try{await fn();}catch(e){message=e.message;}render();};
  const nextWindow=()=>queues[state().entityId]?.windows.find(w=>!['adopted','unknown'].includes(w.status));
  $('plan').onclick=safe(()=>{
    if(reference()==='null')throw new Error('先保存当前球员的清晰参考身份。');
    const s=state(),coverage=buildIdentityCoverage(s.session,clip.frames,clip.sourceCuts??[],clip),entityId=s.entityId;
    // Full-film scan includes associated, still unreviewed positions as well as gaps.
    coverage.unresolvedRanges=coverage.byPlayer[entityId].filter(r=>r.state!=='out_of_view'&&r.state!=='reviewed');
    const windows=planContinuationWindows(coverage,{entityId,range:{startFrame:0,endFrameExclusive:clip.frames.length}});
    queues[entityId]={videoSha256:clip.video_sha256,trackingFingerprint:clip.tracking_fingerprint,reference:reference(),paused:false,windows:windows.map(w=>({...w,status:'pending',jobId:null}))};save();message='队列已建立。每窗返回候选后先核对、采用或跳过，再执行下一窗。';
  });
  $('next').onclick=safe(async()=>{
    const q=queues[state().entityId],w=nextWindow();if(!q||!w)throw new Error('没有待扫描窗口。');
    if(q.reference!==reference()||q.videoSha256!==clip.video_sha256||q.trackingFingerprint!==clip.tracking_fingerprint)throw new Error('身份参考或来源变化，请重新建立续接队列。');
    if(['ready','queued','preparing','analyzing','validating'].includes(w.status))throw new Error('先采用或跳过当前窗候选。');
    q.paused=false;w.status='pending';save();await agent().start({purpose:'continuation',reference:JSON.parse(q.reference),range:{start:w.startFrame,end:w.endFrameExclusive-1}});
    w.jobId=agent().state().job?.jobId??null;w.status=agent().state().job?.status??'failed';save();
  });
  $('skip').onclick=safe(async()=>{const w=nextWindow();if(w){await agent().cancel();w.status='unknown';save();message='该窗保持未知，未补位置或确认身份。';}});
  $('cancel').onclick=safe(async()=>{const q=queues[state().entityId],w=nextWindow();if(q){q.paused=true;if(w&&!['adopted','unknown'].includes(w.status))w.status='cancelled';await agent().cancel();save();}});
  function render(){
    const s=state(),coverage=buildIdentityCoverage(s.session,clip.frames,clip.sourceCuts??[],clip),ranges=coverage.byPlayer[s.entityId]??[];
    $('coverage').replaceChildren(...ranges.map(r=>{const button=document.createElement('button');button.textContent=`${clip.frames[r.startFrame].time.toFixed(2)}–${(clip.frames[r.endFrameExclusive]?.time??clip.mediaEndTime).toFixed(2)} 秒 · ${{missing:'位置缺口',conflict:'身份冲突',out_of_view:'出画',associated:'已关联，待核对',reviewed:'人工确认'}[r.state]}`;button.onclick=()=>seek(r.startFrame);return button;}));
    $('summary').textContent=`${s.entityId} · 缺口 ${coverage.unresolvedRanges.filter(r=>r.entityId===s.entityId).length} 段 · 出画不计待补框。${message}`;
    const q=queues[s.entityId],job=agent()?.state().job,w=q?.windows.find(w=>w.jobId&&w.jobId===job?.jobId);
    if(w&&!['unknown','adopted','cancelled'].includes(w.status)&&job.status!==w.status){w.status=job.status==='applied'?'adopted':job.status;save();}
    $('queue').textContent=q?`${q.paused?'已暂停':'分窗队列'}：${q.windows.length} 窗 · 已采用 ${q.windows.filter(w=>w.status==='adopted').length} · 候选待采用 ${q.windows.filter(w=>w.status==='ready').length} · 保留未知 ${q.windows.filter(w=>w.status==='unknown').length}。扫描成功不表示全片身份已确认。`:'尚未建立全片续接队列。';
  }
  return {render};
}
