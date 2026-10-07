import React,{useEffect,useRef,useState} from 'react';

const timeAt=(times,frame)=>Number.isFinite(times?.[frame])?`${times[frame].toFixed(2)} 秒`:`第 ${frame+1} 帧`;
const activeJob=job=>['queued','preparing','analyzing','validating','running','cancelling'].includes(job?.status);
const readyJob=job=>job?.status==='ready';
const safeImage=url=>typeof url==='string'&&/^data:image\/(?:png|jpeg|webp);base64,/.test(url);

export function InitialIdentityReviewControls({state,api}){
  const review=state.initialReview||{},view=state.initialReviewView||{},job=view.job;
  const busy=!!(review.busy||state.initialApplying),available=state.identityAgent?.status?.available===true;
  const stages={idle:'载入视频后自动开始',queued:'已排队',preparing:'正在整理人物与抽样画面',analyzing:'正在区分球员、裁判和其他人',running:'正在核对人物',validating:'正在检查身份片段与冲突',ready:'初检已完成',adopted:'初检已完成',cancelled:'初检已取消',failed:'初检未完成'};
  const issues=view.issues||[];
  const progress=Number.isFinite(view.completed)&&Number.isFinite(view.total)&&view.total>0?` · ${view.completed}/${view.total}`:'';
  const issueButton=issue=><button key={issue.id} className="identity-initial-issue" onClick={()=>api.reviewIdentityIssue(issue)}><strong>{issue.label}</strong><span>{issue.reason||'定位到画面后核对'}{Number.isInteger(issue.start)?` · ${timeAt(state.frameTimes,issue.start)}`:''}</span></button>;
  return <section className="identity-initial-review" aria-label="自动初检与待处理问题">
    <div className="identity-agent-heading"><h3>Agent 整段抽样初检</h3><span className="identity-agent-label">{view.applied?'机器建议已补入':'保留人工修改'}</span></div>
    <p role="status" aria-live="polite">{state.initialApplying?'正在补入可用的机器建议…':job?.message||stages[job?.status||'idle']}{progress}</p>
    <ol className="identity-initial-steps"><li>读取已有检测框</li><li>检查错人、漏人和身份断开</li><li>补入有证据的机器建议</li></ol>
    <p className="small muted">整段抽样处理一次，刷新复用结果。未看到的人仍留待核对，号码和姓名可稍后填写。</p>
    {view.summary&&<p>{view.summary}</p>}
    {Boolean(view.roles?.player||view.roles?.referee||view.roles?.uncertain)&&<p className="identity-initial-counts">抽样人物：{view.roles.player||0} 个标为球员 · {view.roles.referee||0} 个标为裁判 · {view.roles.uncertain||0} 个待分辨</p>}
    {view.applied&&<p className="small muted">补入的片段仍标为待核对。没有观测的位置保持空白。</p>}
    {view.report&&<p className="small muted">更新 {view.report.changedModelBindings||0} 个球员的机器建议 · 排除 {view.report.excludedObservations||0} 个非球员观测 · 保留 {view.report.preservedHuman||0} 处人工记录。</p>}
    {view.stale&&<p className="identity-agent-notice">草稿已有新修改；旧结果只供查看。更新时复用初检结果，并重新检查人工修改。</p>}
    {(review.error||job?.status==='failed')&&<p className="identity-agent-error" role="alert">{review.error||job?.message||'初检失败，可重试或直接在画面修改。'}</p>}
    {!available&&!busy&&<p className="identity-agent-notice">{state.identityAgent?.status?.message||'正在检查识别服务…'}；仍可直接在画面修改。</p>}
    <div className="identity-agent-actions">
      {busy?<button onClick={()=>api.cancelInitialReview()}>停止初检</button>:<button disabled={!available||state.reviewBusy} onClick={()=>api.retryInitialReview()}>{view.stale?'更新初检到当前草稿':job?.status==='failed'||job?.status==='cancelled'?'重试自动初检':view.applied||job?.candidate?'用初检结果更新草稿':'开始自动初检'}</button>}
      {view.ready&&!view.applied&&<button className="primary" disabled={busy||view.stale||state.reviewBusy} onClick={()=>api.adoptInitialReview()}>补入可用机器建议</button>}
      <button onClick={()=>api.focusIdentityManual()}>直接人工修改</button>
    </div>
    {job?.candidate&&!busy&&<p className="small muted">更新草稿会使用已有分析，重新检查人工记录；不会再次调用模型。</p>}
    <div className="identity-initial-issues"><strong>{issues.length?`初检提示 ${issues.length} 处 · 点击定位`:'待处理问题'}</strong>
      {issues.slice(0,3).map(issueButton)}
      {issues.length>3&&<details><summary>查看其余 {issues.length-3} 处</summary>{issues.slice(3).map(issueButton)}</details>}
      {!issues.length&&<p className="small muted">{view.ready||view.applied?'本次抽样未列出额外问题；未抽样画面仍需留意，可直接修改画面中的人。':'发现的问题会集中列在这里。人工修改随时可用。'}</p>}
    </div>
  </section>;
}

export function IdentityQuickControls({state,api}){
  const quick=state.quickIdentity||{},range=quick.range||{start:state.frame,end:state.frame},busy=!!state.reviewBusy;
  const selected=Number.isInteger(quick.trackId),editing=!!quick.action,preview=quick.preview;
  const targets=(state.entities||[]).filter(entity=>entity.role==='player'||/^P(?:[1-9]|10)$/.test(entity.id));
  const actionLabel={replace:'改成谁',exclude:'这段不是球员',missing:'补漏人',reconnect:'认回同一个人'}[quick.action];
  return <section className="identity-quick-controls" aria-label="快速修改人物">
    <h3>只改不对的地方</h3>
    <p>{selected?`已选画面中的人${quick.ownerId?` · 球员 ${quick.ownerId.replace(/^P/,'')}`:' · 尚未对应球员'}`:`当前球员 ${state.entity.id.replace(/^P/,'')} · 点击画面中的人选择`} {selected&&<small>（跟踪号 T{quick.trackId}）</small>}</p>
    <p className="small muted">模型找到的人＝检测框，尚不保证始终是同一位球员。直接点框只选择，不会改归属。</p>
    <div className="identity-quick-actions"><button disabled={busy||!selected} aria-pressed={quick.action==='replace'} onClick={()=>api.beginIdentityQuickEdit('replace')}>改成谁</button><button disabled={busy||!selected} aria-pressed={quick.action==='exclude'} onClick={()=>api.beginIdentityQuickEdit('exclude')}>不是球员</button><button disabled={busy} aria-pressed={quick.action==='missing'} onClick={()=>api.beginIdentityQuickEdit('missing')}>补漏人</button><button disabled={busy} onClick={()=>api.beginIdentityQuickEdit('reconnect')}>认回同一个人</button></div>
    {editing&&<div className="identity-quick-edit">
      <strong>{actionLabel} · {timeAt(state.frameTimes,range.start)} – {timeAt(state.frameTimes,range.end)}</strong>
      <p className="small muted">{range.reason||'应用于上面的时间段；其他记录保留。'}</p>
      {['replace','missing','reconnect'].includes(quick.action)&&<label className="field">对应球员<select aria-label="快速修改对应球员" value={quick.targetId||state.entity.id} disabled={busy} onChange={event=>api.setIdentityQuickTarget(event.target.value)}>{targets.map(entity=><option key={entity.id} value={entity.id}>球员 {entity.id.slice(1)} · {entity.name}</option>)}</select></label>}
      {quick.action==='missing'&&<p className="identity-agent-notice">先选这个人的球员编号，再点画面中他的脚下。只补当前帧；不会猜测其他帧的位置。</p>}
      {quick.action==='replace'&&<p className="small muted">可再点画面换人，然后一次应用到上面的连续段。</p>}
      {quick.action==='reconnect'&&<><p className="small muted">选择这人原来的球员编号，再点当前画面中的人，只接上当前连续段。</p><button disabled={busy} onClick={()=>api.openIdentityReference()}>需要 Agent 帮忙：按清晰参考查找</button></>}
      {quick.action==='exclude'&&<p className="small muted">从球员建议中排除这个人的本段记录。裁判与其他人不会冒充球员，原始检测保留。</p>}
      {quick.action!=='missing'&&<details className="identity-quick-bounds"><summary>调整这次修改的时间段</summary><div className="range-fields">{[['start','起点'],['end','终点']].map(([field,label])=><label key={field} className="field">{label}（秒）<input key={`${field}:${range[field]}`} aria-label={`快速修改${label}秒`} type="number" min="0" max={state.frameTimes?.at(-1)??0} step="any" defaultValue={state.frameTimes?.[range[field]]??0} disabled={busy} onBlur={event=>{if(event.target.value!=='')api.setIdentityQuickRange(field,Number(event.target.value));}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/></label>)}</div></details>}
      {preview&&<p className="identity-quick-preview" role="status">{preview.excludedTrackId!=null?`将排除这个人的 ${preview.excludedObservations||0} 个观测帧。`:`将修改 ${preview.changed||0} 帧。`}{Object.entries(preview.affectedPlayers||{}).map(([id,count])=>`球员 ${id.slice(1)} 有 ${count} 帧重叠归属会释放。`).join('')}可一次撤销。</p>}
      {quick.error&&<p className="identity-agent-error" role="alert">{quick.error}</p>}
      {quick.action!=='missing'&&<button className="primary" disabled={busy||!selected||!preview} onClick={()=>api.applyIdentityQuickEdit()}>应用到这段</button>}
      <div className="identity-agent-actions">{quick.action!=='exclude'&&<button disabled={busy} onClick={()=>api.openIdentityRange()}>更多范围 / 位置工具</button>}<button disabled={busy} onClick={()=>api.cancelIdentityQuickEdit()}>取消修改</button></div>
    </div>}
    <button disabled={busy||!state.canUndo} onClick={()=>api.undo()}>撤销上次修改</button>
  </section>;
}

export function syncIdentityReferenceForm(form,previous,next,edited={}) {
  const copy={...form};
  for(const key of ['team','jersey'])if(previous[key]!==next[key]&&!edited[key])copy[key]=next[key];
  return copy;
}

export function editedIdentityCandidateRange(segment,key,value){
  const frame=Number(value)-1;
  if(!segment||!['start','end'].includes(key)||value===''||!Number.isInteger(frame)||frame<(segment.originalStart??segment.start)||frame>(segment.originalEnd??segment.end)||
    (key==='start'&&frame>segment.end)||(key==='end'&&frame<segment.start))throw new Error('采用范围只能在找到的原片段内缩小，起帧不能晚于止帧。');
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
  const pendingText={queued:'任务排队中',preparing:'正在准备证据画面',analyzing:'正在核对抽样画面',validating:'正在检查找到的片段',running:'正在核对抽样画面',cancelling:'正在取消任务',ready:'已找到片段，等待核对',cancelled:'任务已取消',failed:'任务失败',adopted:'已采用所选片段，仍需逐帧核对'};
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
      <label className="field">当前画面 · {timeAt(times,state.frame)}<select aria-label="身份参考人物" value={trackId??''} disabled={busy} onChange={event=>api.identityReferenceCandidate(event.target.value===''?null:Number(event.target.value))}><option value="">选择画面中的人（跟踪号 T）</option>{tracks.map(id=><option key={id} value={id}>T{id}</option>)}</select></label>
      <div className="identity-agent-fields"><label className="field">球队 / 球衣描述<input aria-label="参考球队或球衣描述" maxLength={40} value={form.team} disabled={busy} placeholder="例如：紫色球衣" onChange={e=>onFormChange('team',e.target.value)}/></label><label className="field">号码<input aria-label="参考球衣号码" maxLength={3} inputMode="numeric" pattern="[0-9]{1,3}" value={form.jersey} disabled={busy} placeholder="10" onChange={e=>onFormChange('jersey',e.target.value)}/></label></div>
      <div className="identity-agent-actions"><button disabled={busy||!available||!Number.isInteger(trackId)||!referenceFrameReady} onClick={()=>api.recognizeIdentity(referenceInput)}>Agent 识别号码</button><button className="primary" disabled={busy||!canSave||!referenceFrameReady} onClick={()=>api.saveIdentityReference(referenceInput)}>保存参考身份</button></div>
      {!referenceFrameReady&&<p className="identity-agent-notice" role="status">画面正在定位，请等待清晰画面加载后再保存参考。</p>}
      <p className="small muted">球队与号码属于当前视频。保存只确认当前帧；临时 T 编号以后可能换人。</p>
      {recognition&&<div className="identity-agent-suggestion"><strong>识别建议：{job.candidate?.team||'球队未辨认'} · {job.candidate?.jersey?`${job.candidate.jersey} 号`:'号码未辨认'}</strong>{job.candidate?.reason&&<p>{job.candidate.reason}</p>}<p>先核对原画面，再填入并保存。</p><div className="identity-agent-actions"><button disabled={busy||stale||!sameReference} onClick={onUseRecognition}>填入识别建议</button>{!sameReference&&job.requestReference&&<button disabled={busy||stale} onClick={async()=>{await api.seek(job.requestReference.frame);api.identityReferenceCandidate(job.requestReference.trackId);}}>回到识别参考帧</button>}</div></div>}
      {reference&&<div className="identity-agent-saved"><span>已保存：{reference.team||'未填球队'} · {reference.jersey?`${reference.jersey} 号`:'未填号码'} · T{reference.trackId}</span><button disabled={busy} onClick={()=>previewTrack(reference.frame,reference.trackId)}>看参考帧 · {timeAt(times,reference.frame)}</button></div>}
    </div>
    <div className="identity-agent-search"><strong>2 · 查找其他片段</strong><p>{state.range?`查找范围：${timeAt(times,state.range.start)} – ${timeAt(times,state.range.end)}`:'请先设置查找范围。'}</p><p className="small muted">在下方“修正一段视频”调整起止点。</p><button className="primary wide" disabled={busy||!available||!reference||!state.range} onClick={()=>api.findIdentity()}>Agent 查找其他片段</button>{!reference&&<p className="small muted">先保存参考身份，再开始查找。</p>}</div>
    {!available&&<p className="identity-agent-notice" role="status">{agent.status?.message||'正在检查识别服务…'}</p>}
    {job&&<div className="identity-agent-job" role="status"><span>{job.message||pendingText[job.status]||'身份任务等待更新'}</span><button onClick={()=>api.cancelIdentityJob()} disabled={!!state.reviewBusy}>{activeJob(job)?'取消任务':'清除本次结果 / 重置任务'}</button></div>}
    {stale&&<p className="identity-agent-error" role="alert">草稿或所选球员已改变；旧结果不能采用，请重新查找。</p>}
    {(agent.error||localError)&&<p className="identity-agent-error" role="alert">{localError||agent.error}</p>}
    {segments.length>0&&<div className="identity-agent-results"><strong>3 · 核对找到的片段，再选择采用</strong><p className="small muted">抽样证据不能保证区间内每一帧都正确。可缩小采用范围；模型估计并非经过校准的正确率。</p>
      {segments.map(segment=><article key={segment.id} className="identity-agent-candidate" data-selected={selected.includes(segment.id)}>
        <label className="identity-agent-choice"><input type="checkbox" aria-label={`采用候选 T${segment.trackId} 第 ${segment.start+1}–${segment.end+1} 帧`} checked={selected.includes(segment.id)} disabled={busy||stale||!ready} onChange={()=>api.toggleIdentityCandidate(segment.id)}/><span><strong>T{segment.trackId} · {timeAt(times,segment.start)} – {timeAt(times,segment.end)}</strong><small>模型估计 {Math.round(segment.confidence*100)}%</small></span></label>
        <p>{segment.reason}</p>
        <div className="identity-agent-bounds">{[['start','起帧'],['end','止帧']].map(([key,label])=><label key={key}>{label}（含）<input key={`${segment.id}:${key}:${segment[key]}`} aria-label={`${segment.id} 采用${label}`} type="number" min={(key==='start'?(segment.originalStart??segment.start):segment.start)+1} max={(key==='end'?(segment.originalEnd??segment.end):segment.end)+1} defaultValue={segment[key]+1} disabled={busy||stale||!ready} onBlur={event=>onRangeEdit(segment.id,key,event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/></label>)}</div>
        <div className="identity-agent-actions"><button onClick={()=>previewTrack(segment.start,segment.trackId)}>看起点</button><button onClick={()=>previewTrack(Math.floor((segment.start+segment.end)/2),segment.trackId)}>看中间</button><button onClick={()=>previewTrack(segment.end,segment.trackId)}>看终点</button></div>
        <details className="identity-agent-evidence"><summary>抽样证据（{segment.evidenceFrames.length} 帧）</summary><div>{segment.evidenceFrames.map(frame=><button key={frame} onClick={()=>previewTrack(frame,segment.trackId)}>{previews.has(`${frame}:${segment.trackId}`)&&<img src={previews.get(`${frame}:${segment.trackId}`)} alt={`T${segment.trackId} 第 ${frame+1} 帧证据`} loading="lazy"/>}<span>第 {frame+1} 帧 · {timeAt(times,frame)}</span></button>)}</div></details>
      </article>)}
      <button className="primary wide" disabled={busy||stale||!ready||!selectedCount} onClick={()=>api.adoptIdentityCandidates()}>采用所选片段（{selectedCount}）</button><p className="small muted">采用后仍保留逐帧待核对状态；与人工记录冲突时不会覆盖。</p>
    </div>}
    {ready&&job.purpose==='continuation'&&segments.length===0&&<p className="identity-agent-notice">没有找到可采用的片段。可换一帧更清楚的参考，或调整查找范围。</p>}
    <button className="wide" disabled={busy||!state.canUndo} onClick={()=>api.undo()}>撤销上次修改</button>
  </section>;
}

export function IdentityAgentPanel({state,api}){
  const ref=state.entity.identityReference;
  const [form,setForm]=useState(()=>({team:ref?.team??state.entity.team??'',jersey:ref?.jersey??state.entity.jersey??''}));
  const [localError,setLocalError]=useState('');
  const savedKey=JSON.stringify(ref??null);
  const edits=useRef({});
  const source=useRef({id:state.entity.id,savedKey,team:state.entity.team??'',jersey:state.entity.jersey??''});
  useEffect(()=>{
    const previous=source.current,next={id:state.entity.id,savedKey,team:state.entity.team??'',jersey:state.entity.jersey??''};
    if(previous.id!==next.id||previous.savedKey!==savedKey){
      edits.current={};
      setForm({team:ref?.team??next.team,jersey:ref?.jersey??next.jersey});
      setLocalError('');
    }else setForm(current=>syncIdentityReferenceForm(current,previous,next,edits.current));
    source.current=next;
  },[savedKey,state.entity.id,state.entity.team,state.entity.jersey]);
  if(state.entity.role!=='player'||!state.identityAgent)return null;
  function onRangeEdit(id,key,value){
    const segment=state.identityAgent.job?.candidate?.segments?.find(item=>item.id===id);
    try{const range=editedIdentityCandidateRange(segment,key,value);setLocalError('');if(range[key]!==segment[key])api.editIdentityCandidate(id,range);}
    catch(error){setLocalError(error.message);}
  }
  return <IdentityAgentControls state={state} api={api} form={form} localError={localError} onRangeEdit={onRangeEdit}
    onFormChange={(key,value)=>{edits.current[key]=true;setForm(current=>({...current,[key]:value}));setLocalError('');}}
    onUseRecognition={()=>{const suggestion=state.identityAgent.job?.candidate;edits.current={team:true,jersey:true};setForm({team:suggestion?.team||'',jersey:suggestion?.jersey||''});setLocalError('');}}
    onSeekTime={seconds=>{if(!Number.isFinite(seconds))return;const times=state.frameTimes||[];let nearest=0;for(let i=1;i<times.length;i++)if(Math.abs(times[i]-seconds)<Math.abs(times[nearest]-seconds))nearest=i;api.seek(nearest);}}/>;
}
