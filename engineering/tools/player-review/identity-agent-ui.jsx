import React,{useEffect,useState} from 'react';

const timeAt=(times,frame)=>Number.isFinite(times?.[frame])?`${times[frame].toFixed(2)} 秒`:`第 ${frame+1} 帧`;
const activeJob=job=>['queued','preparing','analyzing','validating','running','cancelling'].includes(job?.status);
const readyJob=job=>job?.status==='ready';
const safeImage=url=>typeof url==='string'&&/^data:image\/(?:png|jpeg|webp);base64,/.test(url);

export function editedIdentityCandidateRange(segment,key,value){
  const frame=Number(value)-1;
  if(!segment||!['start','end'].includes(key)||value===''||!Number.isInteger(frame)||frame<(segment.originalStart??segment.start)||frame>(segment.originalEnd??segment.end)||
    (key==='start'&&frame>segment.end)||(key==='end'&&frame<segment.start))throw new Error('采用范围只能在原候选内缩小，起帧不能晚于止帧。');
  return {start:segment.start,end:segment.end,[key]:frame};
}

export function IdentityAgentControls({state,api,form,onFormChange,onUseRecognition,onSeekTime,onRangeEdit,localError=''}){
  const agent=state.identityAgent||{},job=agent.job,reference=state.entity.identityReference,times=state.frameTimes||[];
  const busy=!!(state.reviewBusy||agent.busy||activeJob(job)),stale=!!agent.stale,available=agent.status?.available===true;
  const referenceFrameReady=state.referenceFrameReady===true;
  const trackId=state.referenceCandidate?.trackId??null;
  const tracks=[...new Set((state.proposals||[]).map(p=>p.trackId).filter(Number.isInteger))];
  if(Number.isInteger(trackId)&&!tracks.includes(trackId))tracks.push(trackId);
  tracks.sort((a,b)=>a-b);
  const matchingJob=job?.entityId===state.entity.id,ready=matchingJob&&readyJob(job),recognition=ready&&job.purpose==='reference';
  const sameReference=recognition&&job.requestReference?.frame===state.frame&&job.requestReference?.trackId===trackId;
  const segments=matchingJob&&job.purpose==='continuation'?(job.candidate?.segments||[]):[],selected=agent.selectedIds||[];
  const selectedCount=segments.filter(s=>selected.includes(s.id)).length;
  const referenceInput={trackId,team:form.team.trim(),jersey:form.jersey.trim()};
  const canSave=Number.isInteger(trackId)&&!!referenceInput.team&&/^\d{1,3}$/.test(referenceInput.jersey);
  const pendingText={queued:'任务排队中',preparing:'正在准备证据画面',analyzing:'正在核对抽样画面',validating:'正在检查候选区间',running:'正在核对抽样画面',cancelling:'正在取消任务',ready:'候选已返回，等待人工核对',cancelled:'任务已取消',failed:'任务失败',adopted:'已采用所选片段，仍需逐帧核对'};
  const previews=new Map((job?.previewFrames||[]).filter(p=>safeImage(p.dataUrl)).map(p=>[`${p.frame}:${p.trackId}`,p.dataUrl]));
  async function previewTrack(frame,id){await api.seek(frame);api.identityReferenceCandidate(id);}
  return <section className="identity-agent-panel" aria-label="球员身份与跨片段续接">
    <div className="identity-agent-heading"><div><small>当前固定身份 · {state.entity.id}</small><h3>认回同一位球员</h3></div><span className="identity-agent-label">待人工核对</span></div>
    <p className="identity-agent-intro">选清楚的一帧，确认球衣与号码，再查找这位球员的其他片段。</p>
    <div className="identity-agent-reference">
      <strong>1 · 建立本视频的身份参考</strong>
      <form className="identity-agent-seek" onSubmit={event=>{event.preventDefault();const input=event.currentTarget.elements.namedItem('identity-time');if(input.value!=='')onSeekTime(Number(input.value));}}>
        <label>定位到秒<input aria-label="身份参考定位秒" name="identity-time" type="number" min="0" max={times.at(-1)??0} step="any" placeholder={Number.isFinite(times[state.frame])?times[state.frame].toFixed(2):'0.00'} disabled={busy}/></label><button disabled={busy}>定位</button>
      </form>
      <label className="field">当前画面 · {timeAt(times,state.frame)}<select aria-label="身份参考人物" value={trackId??''} disabled={busy} onChange={event=>api.identityReferenceCandidate(event.target.value===''?null:Number(event.target.value))}><option value="">选择画面中的临时 T 编号</option>{tracks.map(id=><option key={id} value={id}>T{id}</option>)}</select></label>
      <div className="identity-agent-fields"><label className="field">球队 / 球衣描述<input aria-label="参考球队或球衣描述" maxLength={40} value={form.team} disabled={busy} placeholder="例如：紫色球衣" onChange={e=>onFormChange('team',e.target.value)}/></label><label className="field">号码<input aria-label="参考球衣号码" maxLength={3} inputMode="numeric" pattern="[0-9]{1,3}" value={form.jersey} disabled={busy} placeholder="10" onChange={e=>onFormChange('jersey',e.target.value)}/></label></div>
      <div className="identity-agent-actions"><button disabled={busy||!available||!Number.isInteger(trackId)||!referenceFrameReady} onClick={()=>api.recognizeIdentity(referenceInput)}>Agent 识别号码</button><button className="primary" disabled={busy||!canSave||!referenceFrameReady} onClick={()=>api.saveIdentityReference(referenceInput)}>保存参考身份</button></div>
      {!referenceFrameReady&&<p className="identity-agent-notice" role="status">画面正在定位，请等待清晰画面加载后再保存参考。</p>}
      <p className="small muted">球队与号码属于当前视频。保存只确认当前帧；临时 T 编号以后可能换人。</p>
      {recognition&&<div className="identity-agent-suggestion"><strong>识别建议：{job.candidate?.team||'球队未辨认'} · {job.candidate?.jersey?`${job.candidate.jersey} 号`:'号码未辨认'}</strong><p>先核对原画面，再填入并保存。</p><div className="identity-agent-actions"><button disabled={busy||stale||!sameReference} onClick={onUseRecognition}>填入识别建议</button>{!sameReference&&job.requestReference&&<button disabled={busy||stale} onClick={async()=>{await api.seek(job.requestReference.frame);api.identityReferenceCandidate(job.requestReference.trackId);}}>回到识别参考帧</button>}</div></div>}
      {reference&&<div className="identity-agent-saved"><span>已保存：{reference.team||'未填球队'} · {reference.jersey?`${reference.jersey} 号`:'未填号码'} · T{reference.trackId}</span><button disabled={busy} onClick={()=>previewTrack(reference.frame,reference.trackId)}>看参考帧 · {timeAt(times,reference.frame)}</button></div>}
    </div>
    <div className="identity-agent-search"><strong>2 · 查找其他片段</strong><p>{state.range?`查找范围：${timeAt(times,state.range.start)} – ${timeAt(times,state.range.end)}`:'请先设置查找范围。'}</p><p className="small muted">在下方“修正一段视频”调整起止点。</p><button className="primary wide" disabled={busy||!available||!reference||!state.range} onClick={()=>api.findIdentity()}>Agent 查找其他片段</button>{!reference&&<p className="small muted">先保存参考身份，再开始查找。</p>}</div>
    {!available&&<p className="identity-agent-notice" role="status">{agent.status?.message||'正在检查识别服务…'}</p>}
    {job&&<div className="identity-agent-job" role="status"><span>{job.message||pendingText[job.status]||'身份任务等待更新'}</span><button onClick={()=>api.cancelIdentityJob()} disabled={!!state.reviewBusy}>{activeJob(job)?'取消任务':'清除候选 / 重置任务'}</button></div>}
    {stale&&<p className="identity-agent-error" role="alert">草稿或所选球员已改变；旧候选不能采用，请重新查找。</p>}
    {(agent.error||localError)&&<p className="identity-agent-error" role="alert">{localError||agent.error}</p>}
    {segments.length>0&&<div className="identity-agent-results"><strong>3 · 核对候选，再选择采用</strong><p className="small muted">抽样证据不能保证区间内每一帧都正确。可缩小采用范围；模型估计并非经过校准的正确率。</p>
      {segments.map(segment=><article key={segment.id} className="identity-agent-candidate" data-selected={selected.includes(segment.id)}>
        <label className="identity-agent-choice"><input type="checkbox" aria-label={`采用候选 T${segment.trackId} 第 ${segment.start+1}–${segment.end+1} 帧`} checked={selected.includes(segment.id)} disabled={busy||stale||!ready} onChange={()=>api.toggleIdentityCandidate(segment.id)}/><span><strong>T{segment.trackId} · {timeAt(times,segment.start)} – {timeAt(times,segment.end)}</strong><small>模型估计 {Math.round(segment.confidence*100)}%</small></span></label>
        <p>{segment.reason}</p>
        <div className="identity-agent-bounds">{[['start','起帧'],['end','止帧']].map(([key,label])=><label key={key}>{label}（含）<input key={`${segment.id}:${key}:${segment[key]}`} aria-label={`${segment.id} 采用${label}`} type="number" min={(key==='start'?(segment.originalStart??segment.start):segment.start)+1} max={(key==='end'?(segment.originalEnd??segment.end):segment.end)+1} defaultValue={segment[key]+1} disabled={busy||stale||!ready} onBlur={event=>onRangeEdit(segment.id,key,event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/></label>)}</div>
        <div className="identity-agent-actions"><button onClick={()=>previewTrack(segment.start,segment.trackId)}>看起点</button><button onClick={()=>previewTrack(Math.floor((segment.start+segment.end)/2),segment.trackId)}>看中间</button><button onClick={()=>previewTrack(segment.end,segment.trackId)}>看终点</button></div>
        <details className="identity-agent-evidence"><summary>抽样证据（{segment.evidenceFrames.length} 帧）</summary><div>{segment.evidenceFrames.map(frame=><button key={frame} onClick={()=>previewTrack(frame,segment.trackId)}>{previews.has(`${frame}:${segment.trackId}`)&&<img src={previews.get(`${frame}:${segment.trackId}`)} alt={`T${segment.trackId} 第 ${frame+1} 帧证据`} loading="lazy"/>}<span>第 {frame+1} 帧 · {timeAt(times,frame)}</span></button>)}</div></details>
      </article>)}
      <button className="primary wide" disabled={busy||stale||!ready||!selectedCount} onClick={()=>api.adoptIdentityCandidates()}>采用所选片段（{selectedCount}）</button><p className="small muted">采用后仍保留逐帧待核对状态；与人工记录冲突时不会覆盖。</p>
    </div>}
    {ready&&job.purpose==='continuation'&&segments.length===0&&<p className="identity-agent-notice">没有可采用的候选。可换一帧更清楚的参考，或调整查找范围。</p>}
    <button className="wide" disabled={busy||!state.canUndo} onClick={()=>api.undo()}>撤销上次修改</button>
  </section>;
}

export function IdentityAgentPanel({state,api}){
  const ref=state.entity.identityReference;
  const [form,setForm]=useState(()=>({team:ref?.team??state.entity.team??'',jersey:ref?.jersey??state.entity.jersey??''}));
  const [localError,setLocalError]=useState('');
  const savedKey=JSON.stringify(ref??null);
  useEffect(()=>{setForm({team:ref?.team??state.entity.team??'',jersey:ref?.jersey??state.entity.jersey??''});setLocalError('');},[savedKey,state.entity.id]);
  if(state.entity.role!=='player'||!state.identityAgent)return null;
  function onRangeEdit(id,key,value){
    const segment=state.identityAgent.job?.candidate?.segments?.find(item=>item.id===id);
    try{const range=editedIdentityCandidateRange(segment,key,value);setLocalError('');if(range[key]!==segment[key])api.editIdentityCandidate(id,range);}
    catch(error){setLocalError(error.message);}
  }
  return <IdentityAgentControls state={state} api={api} form={form} localError={localError} onRangeEdit={onRangeEdit}
    onFormChange={(key,value)=>{setForm(current=>({...current,[key]:value}));setLocalError('');}}
    onUseRecognition={()=>{const suggestion=state.identityAgent.job?.candidate;setForm({team:suggestion?.team||'',jersey:suggestion?.jersey||''});setLocalError('');}}
    onSeekTime={seconds=>{if(!Number.isFinite(seconds))return;const times=state.frameTimes||[];let nearest=0;for(let i=1;i<times.length;i++)if(Math.abs(times[i]-seconds)<Math.abs(times[nearest]-seconds))nearest=i;api.seek(nearest);}}/>;
}
