import React, {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {proposalLabel,trackingReviewState} from './tracking-display.mjs';
import {IdentityRangeEditor} from './identity-range-ui.jsx';
import {IdentityAgentPanel} from './identity-agent-ui.jsx';

const isPlayerSlot=id=>/^P(?:[1-9]|10)$/.test(id);
const slotLabel=id=>isPlayerSlot(id)?id.slice(1):id;
const isUnassigned=key=>!!(key.reviewExcluded||key.unassigned||key.kind==='unassigned');

function EntityRoster({state,api}) {
  const [swapSource,setSwapSource]=useState(null);
  const [drag,setDrag]=useState(null);
  const [notice,setNotice]=useState('');
  const [swapPending,setSwapPending]=useState(false);
  const swapLock=useRef(false);
  const pointer=useRef(null);
  const clickGuard=useRef(0);
  const roster=useRef(null);
  const busy=!!state.reviewBusy||swapPending;
  const selectedId=state.entity.id;
  const teams=[{side:'red',label:'红队',start:1,end:5},{side:'blue',label:'蓝队',start:6,end:10}];
  const referees=state.entities.filter(e=>!isPlayerSlot(e.id));

  async function swapPlayers(sourceId,targetId) {
    if(state.reviewBusy||swapLock.current)return;
    swapLock.current=true;
    setSwapPending(true);
    setSwapSource(null);
    setNotice(`正在交换 ${slotLabel(sourceId)} 与 ${slotLabel(targetId)} 的整段身份数据…`);
    try {
      const completed=await api.swapPlayers(sourceId,targetId);
      setNotice(completed?`已交换 ${slotLabel(sourceId)} 与 ${slotLabel(targetId)} 的整段身份数据，可撤销。`:'交换未完成，请查看提示后重试。');
    }catch{
      setNotice('交换未完成，请查看提示后重试。');
    }finally{
      swapLock.current=false;
      setSwapPending(false);
    }
  }

  function finishPointer(event,cancel=false) {
    const current=pointer.current;
    if(!current||current.pointerId!==event.pointerId)return;
    pointer.current=null;
    if(current.button.hasPointerCapture?.(event.pointerId))current.button.releasePointerCapture(event.pointerId);
    if(current.moved){
      clickGuard.current=Date.now()+350;
      if(!cancel&&!busy&&current.targetId){
        void swapPlayers(current.sourceId,current.targetId);
      }else if(!cancel){
        setNotice('未交换。请拖到另一个球员槽位后松开。');
      }
      event.preventDefault();
    }
    setDrag(null);
  }

  function startPointer(event,id) {
    if(busy||!isPlayerSlot(id)||event.button!==0||event.isPrimary===false)return;
    pointer.current={sourceId:id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,button:event.currentTarget,moved:false,targetId:null};
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event) {
    const current=pointer.current;
    if(!current||current.pointerId!==event.pointerId||busy)return;
    if(!current.moved&&Math.hypot(event.clientX-current.startX,event.clientY-current.startY)<7)return;
    current.moved=true;
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-player-slot]');
    const targetId=target&&roster.current?.contains(target)?target.dataset.playerSlot:null;
    current.targetId=targetId&&targetId!==current.sourceId?targetId:null;
    setDrag({sourceId:current.sourceId,targetId:current.targetId});
    event.preventDefault();
  }

  function chooseSlot(id) {
    if(Date.now()<clickGuard.current)return;
    if(swapSource&&isPlayerSlot(id)){
      if(busy)return;
      if(id===swapSource){setNotice('请再选择另一个球员槽位，或取消交换。');return;}
      void swapPlayers(swapSource,id);
      return;
    }
    setSwapSource(null);
    api.select(id);
  }


  function slotButton(entity) {
    const source=drag?.sourceId===entity.id||swapSource===entity.id;
    const target=drag?.targetId===entity.id;
    const player=isPlayerSlot(entity.id);
    return <button key={entity.id}
      className={`entity ${entity.id===selectedId?'selected':''} ${entity.selected?'bound':''} ${source?'swap-source':''} ${target?'swap-target':''}`}
      data-player-slot={player?entity.id:undefined}
      aria-label={`${swapSource&&player?'与 '+slotLabel(swapSource)+' 交换':'选择'} ${slotLabel(entity.id)} · ${entity.name}`}
      aria-pressed={entity.id===selectedId}
      title={`${slotLabel(entity.id)} · ${entity.name}${player?'；拖到其他球员槽位交换整段身份数据':''}`}
      draggable={false}
      onPointerDown={event=>startPointer(event,entity.id)} onPointerMove={movePointer}
      onPointerUp={event=>finishPointer(event)} onPointerCancel={event=>finishPointer(event,true)}
      onLostPointerCapture={event=>{if(pointer.current?.pointerId===event.pointerId)finishPointer(event,true);}}
      onClick={()=>chooseSlot(entity.id)}>
      {slotLabel(entity.id)}<span className="entity-slot-state" data-review={entity.review?.status||'empty'} title={entity.review?.label} aria-hidden="true">{target?'交换':entity.review?.status==='human'?'本帧确认':entity.review?.status==='machine'?'机器结果':entity.review?.status==='pending'?'待确认':entity.review?.status==='invalid'?'冲突':entity.review?.status==='out_of_view'?'出画':entity.hasRecords?'缺位置':'空槽'}</span>
    </button>;
  }

  return <div className={`team-roster ${swapSource?'is-swapping':''} ${drag?'is-dragging':''}`} data-busy={busy} ref={roster}
    onKeyDown={event=>{if(event.key==='Escape'){
      const current=pointer.current;pointer.current=null;
      if(current?.button.hasPointerCapture?.(current.pointerId))current.button.releasePointerCapture(current.pointerId);
      if(current?.moved)clickGuard.current=Date.now()+350;
      setDrag(null);setSwapSource(null);setNotice('已取消交换。');
    }}}>
    {teams.map(team=><section className={`team-group team-${team.side}`} key={team.side} aria-label={`${team.label}球员槽位`}>
      <div className="team-row-heading"><h3><i aria-hidden="true"></i>{team.label}</h3>
      </div>
      <div className="team-slot-row">{state.entities.filter(e=>{const number=Number(e.id.slice(1));return isPlayerSlot(e.id)&&number>=team.start&&number<=team.end;}).sort((a,b)=>Number(a.id.slice(1))-Number(b.id.slice(1))).map(slotButton)}</div>
    </section>)}
    {referees.length>0&&<section className="referee-group" aria-label="裁判槽位"><h3>裁判</h3><div className="team-slot-row">{referees.map(slotButton)}</div></section>}
    <div className="roster-swap-controls">
      <button disabled={busy||!isPlayerSlot(selectedId)} aria-pressed={!!swapSource} onClick={()=>{
        if(swapSource){setSwapSource(null);setNotice('已取消交换。');}
        else{setSwapSource(selectedId);setNotice(`已选 ${slotLabel(selectedId)}，点击另一个球员槽位完成交换。`);}
      }}>{swapSource?'取消交换':`交换 ${isPlayerSlot(selectedId)?slotLabel(selectedId):'球员'} 槽位`}</button>
      <span>{swapSource?'再点一个球员槽位':'也可直接拖动球员槽位'}</span>
    </div>
    <p className="roster-swap-scope">交换会移动整段身份、位置与绑定，空槽也可交换；不是只改当前帧。</p>
    <p className="roster-swap-notice" role="status" aria-live="polite">{drag?`${drag.sourceId} → ${drag.targetId||'拖到其他球员槽位'}；松开完成交换。`:notice}</p>
  </div>;
}

function IdentityPanel({state,api}) {
  const {entity,point,mode,proposals}=state;
  const [candidate,setCandidate]=useState('');
  const selected=state.previewTrackId!=null?proposals.find(item=>item.trackId===state.previewTrackId):candidate===''?null:proposals[Number(candidate)];
  const candidateValue=selected?String(proposals.indexOf(selected)):'';
  const busy=!!state.reviewBusy;
  const hasRecords=state.entities.find(item=>item.id===entity.id)?.hasRecords;
  const available=point?.x!=null&&!point?.reviewExcluded;
  const releaseRange=state.releaseRange;
  const confirmed=point?.frameIdentityConfirmed===true;
  const review=trackingReviewState(point);
  const canConfirm=available&&!['interpolated','manual_path','conflict'].includes(point?.source);
  const needsCorrection=point?.source==='conflict'||point?.identitySource==='reassigned'||
    (state.previewTrackId!=null&&point?.trackId!==state.previewTrackId&&state.trackAssignments?.some(item=>item.trackId===state.previewTrackId));
  const evidenceLabel=point?.reviewExcluded?'已取消关联':point?.source==='conflict'?'身份冲突':confirmed?'本帧人物已确认 · 实线':point?.source==='manual_range'?'区间修正 · 当前帧待核对':point?.identitySource==='model_suggestion'?'模型建议 · 虚线待确认':point?.associationScope==='track_occurrences'?'整段归并 · 虚线待核对':({tracked:'模型位置 · 待核对',manual:'人工位置 · 人物待确认',interpolated:'估计位置',manual_path:'手绘待核对',missing:'缺少位置',conflict:'身份冲突',out_of_view:'已标出画'})[point?.source]||'待关联';
  const fields=[['name','目标名称',40],['team','球队 / 球衣描述',40],['jersey','球衣号码',4]];
  return <>
    <IdentityRangeEditor state={state} api={api}/>
    <details className="identity-single-frame"><summary>单帧确认与高级身份操作</summary>
    <div className="identity-flow"><div><small>正在编辑的固定身份</small><strong>球员 {slotLabel(entity.id)} · {entity.name}</strong></div><span>←</span><div><small>跟踪器临时编号</small><strong>{point?.reviewExcluded?'已取消关联':point?.trackId!=null?`T${point.trackId}`:confirmed?'无 T · 本帧人工确认':'尚未关联'}</strong></div></div>
    <div className="identity-evidence"><span className="identity-state review-status" data-review={review.status}>{evidenceLabel}</span>{state.observedIds.length>0&&<span>此身份对应过 {state.observedIds.map(id=>`T${id}`).join('、')}</span>}</div>
    <p className="small muted">YOLO 逐帧检测人物框，跟踪器分配 T 编号。一个球员可以归并多个 T；每个编号分别选一次，关联后仍需逐帧核对。</p>
    {needsCorrection&&<section className="candidate-warning identity-conflict" aria-label="人物关联冲突">
      <strong>先解决第 {state.frame+1} 帧的关联冲突</strong>
      <p>{point?.candidateTrackIds?.length>1?`球员 ${slotLabel(entity.id)} 在这一帧同时关联了 ${point.candidateTrackIds.map(id=>`T${id}`).join('、')}。`:point?.claimedBy?`此人物当前归属球员 ${slotLabel(point.claimedBy)}。`:'当前候选与已有的人物归属重叠。'}重新累计整段编号不会解除冲突。</p>
      <label className="field">预览正确人物<select aria-label="冲突纠正候选" value={selected?.trackId!=null?candidateValue:''} disabled={busy} onChange={e=>{setCandidate(e.target.value);api.preview(e.target.value===''?null:proposals[Number(e.target.value)]);}}><option value="">点画面中的候选，或在这里选择</option>{proposals.map((p,i)=>p.trackId!=null&&<option key={i} value={i}>{proposalLabel(p)}</option>)}</select></label>
      <div className="conflict-actions"><button className="primary" disabled={busy||selected?.trackId==null} onClick={async()=>{if(await api.correctCandidate(selected,'frame'))setCandidate('');}}>{selected?.trackId!=null?`仅本帧采用 T${selected.trackId}`:'仅本帧采用候选'}</button><button disabled={busy||selected?.trackId==null} onClick={async()=>{if(await api.correctCandidate(selected,'forward'))setCandidate('');}}>{selected?.trackId!=null?`从本帧向后采用 T${selected.trackId}`:'从本帧向后采用候选'}</button></div>
      <p>仅本帧：其他帧保持原样。向后纠错：直到下一人工边界或切镜；只把当前帧标为已确认。若此人物属于另一槽位，该槽位在纠正范围内留空，操作可撤销。</p>
    </section>}
    <div className="frame-confirmation" data-review={review.status}><button className="primary wide" disabled={busy||!canConfirm||confirmed} onClick={()=>api.confirmCurrent()}>{confirmed?'本帧人物已确认':`确认第 ${state.frame+1} 帧人物`}</button><p>蓝色为机器结果；确认后，本帧的轨迹点与时间轴变绿，人物框改为实线。脚点和球场位置另行核对。</p></div>
    <label className="field">人物关联范围<select aria-label="人物关联范围" disabled={busy} value={state.associationScope} onChange={event=>api.setAssociationScope(event.target.value)}><option value="track_occurrences">整个 T 编号的出现帧（含之前）</option><option value="forward">从当前帧向后纠错</option></select></label>
    <p className="small muted">{state.associationScope==='track_occurrences'?'累计归并这个编号实际出现的帧；缺帧留空，已有人工纠错优先。同帧多个编号冲突时留待处理。':'从当前帧起纠正身份，直到下一次人工边界或切镜。适合编号中途串到其他人的情况。'}</p>
    {point?.identitySource==='model_suggestion'&&available&&point.trackId!=null&&<button className="wide" disabled={busy} onClick={()=>api.associateCurrent()}>{state.associationScope==='track_occurrences'?`归并 T${point.trackId} 的全部出现帧`:'从当前帧向后关联此人物'}</button>}
    {state.trackAssignments?.length>0&&<div className="track-assignment-summary"><strong>已归并的临时编号</strong>{state.trackAssignments.map(item=><button key={item.trackId} onClick={()=>api.seek(item.start)}>{`T${item.trackId} · ${item.frames} 个观测帧 / ${item.segments} 段`}</button>)}<p className="small muted">登记数量不等于有效位置或审核数量。编号有重叠、取消或人工纠正时，以当前轨迹状态为准。</p></div>}
    <div className="identity-release">
      <button disabled={busy||hasRecords===false||point?.reviewExcluded} onClick={()=>api.releaseIdentity()}>从当前帧取消关联</button>
      <p className="small muted">{releaseRange?`第 ${releaseRange.start+1}–${releaseRange.end+1} 帧`:'从当前帧到下一次身份确认或切镜'}取消关联和位置；之前的记录保留，可撤销。</p>
      <details className="identity-clear"><summary>清空这个槽位的整段数据</summary><p className="small muted">清空 {slotLabel(entity.id)} 的所有位置、编号绑定和事件，保留姓名、球队与号码。整个操作可撤销。</p><button className="danger-action" disabled={busy||hasRecords===false} onClick={()=>api.clearPlayer()}>清空 {slotLabel(entity.id)} 整段数据</button></details>
    </div>
    <div className="identity-fields">{fields.map(([name,label,max])=><label className="field" key={name}>{label}<input key={`${slotLabel(entity.id)}:${name}:${entity[name]||''}`} aria-label={label} defaultValue={entity[name]||''} maxLength={max} disabled={busy} onBlur={e=>{if(!busy&&e.target.value.trim()!==(entity[name]||''))api.setField(name,e.target.value.trim());}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} /></label>)}</div>
    <div className="mode-switch"><button className={mode==='select'?'active':''} aria-pressed={mode==='select'} onClick={()=>api.setMode('select')}>关联人物</button><button className={mode==='point'?'active':''} aria-pressed={mode==='point'} onClick={()=>api.setMode('point')}>点击补脚下点</button></div>
    <p className="note">{mode==='select'?'点击候选框关联；已选中后，拖动脚下圆点改位置，拖动框边移动人物框，拖动四角调整大小。':'点击球员脚下保存当前帧位置；也可直接拖动已有圆点。'}</p>
    <label className="field">当前帧候选人物<select aria-label="当前帧候选人物" value={candidateValue} onChange={e=>{setCandidate(e.target.value);api.preview(e.target.value===''?null:proposals[Number(e.target.value)]);}}><option value="">选择一个候选，先预览</option>{proposals.map((p,i)=><option key={i} value={i}>{proposalLabel(p)} · 置信度 {Math.round((p.score||0)*100)}%</option>)}</select></label>
    {selected?.roleConflict&&<p className="candidate-warning">这个位置同时有球员与裁判候选，请核对真人和所属角色后关联。</p>}
    {selected?.role==='referee'&&entity.role==='player'&&<p className="candidate-warning">模型把这个候选标为裁判。若实际是裁判，请先添加 R 编号；误分类的球员仍可人工关联到当前 P。</p>}
    <button className="primary wide" disabled={busy||!selected} onClick={async()=>{if(await api.associate(selected))setCandidate('');}}>{state.associationScope==='track_occurrences'&&selected?.trackId!=null?`将 T${selected.trackId} 全部出现帧归入 ${slotLabel(entity.id)}`:`把当前候选关联到 ${slotLabel(entity.id)}`}</button>
    <p className="small muted">预览框会高亮。候选框用虚线；球员框在本帧人工确认后用实线。关联和位置修改都可撤销。</p>
    <details className="identity-keyframes"><summary>身份确认时间点（{state.identityRanges.length}）</summary>
      {state.identityRanges.map(key=><div className={`anchor ${isUnassigned(key)?'identity-unassigned':''}`} key={key.frame}><button onClick={()=>api.seek(key.frame)}>{key.time.toFixed(2)} s · 第 {key.start+1}–{key.end+1} 帧 · {isUnassigned(key)?'已取消关联':key.trackId==null?'未编号':`T${key.trackId}`}</button><button disabled={busy} aria-label={`删除第 ${key.frame+1} 帧身份确认`} onClick={()=>api.removeIdentity(key.frame)}>删除身份确认</button></div>)}
      <p className="small muted">位置编辑只改当前帧。删除身份确认可恢复上一段规则，撤销可恢复整个操作。</p>
    </details>
    <details className="coordinate-editor" onToggle={event=>{if(event.currentTarget.open)api.prepareEdit();}}><summary>精确修改当前帧坐标</summary><form key={`${slotLabel(entity.id)}:${state.frame}:${point?.x}:${point?.y}:${point?.box}`} onSubmit={e=>{
      e.preventDefault();if(busy||!available)return;
      const values=new FormData(e.currentTarget);
      api.edit({x:Number(values.get('x')),y:Number(values.get('y')),...(point?.box?{box:['x1','y1','x2','y2'].map(k=>Number(values.get(k)))}:{})});
    }}>
      <div className="range-fields">{['x','y'].map(k=><label className="field" key={k}>脚下 {k.toUpperCase()}<input aria-label={`脚下 ${k.toUpperCase()}`} name={k} type="number" step="any" defaultValue={point?.[k]??''} disabled={busy||!available}/></label>)}</div>
      {point?.box&&<div className="box-fields">{['x1','y1','x2','y2'].map((k,i)=><label className="field" key={k}>{k.toUpperCase()}<input aria-label={`人物框 ${k.toUpperCase()}`} name={k} type="number" step="any" defaultValue={point.box[i]} disabled={busy||!available}/></label>)}</div>}
      <button disabled={busy||!available}>保存当前帧坐标</button>
    </form></details>
    </details>
  </>;
}

export function mountIdentityUI(api) {
  const grid=createRoot(document.getElementById('entities'));
  const panel=createRoot(document.getElementById('identityControls'));
  let signature='';
  return {render(state){
    const next=JSON.stringify(state,(key,value)=>key==='dataUrl'?value?.length:value);if(next===signature)return;signature=next;
    flushSync(()=>{
      grid.render(<EntityRoster state={state} api={api}/>);
      panel.render(<><IdentityAgentPanel key={`agent:${state.entity.id}`} state={state} api={api}/><IdentityPanel key={state.entity.id+':'+state.frame} state={state} api={api}/></>);
    });
  }};
}
export {mountWorkbenchShell} from './workbench-shell.mjs';
export {mountVideoDisplay} from './video-display.mjs';
