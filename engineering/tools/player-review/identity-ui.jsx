import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {proposalLabel} from './tracking-display.mjs';

function IdentityPanel({state,api}) {
  const {entity,point,mode,proposals,previewTrackId}=state;
  const [candidate,setCandidate]=useState('');
  const selected=candidate===''?null:proposals[Number(candidate)];
  const available=point?.x!=null;
  const fields=[['name','目标名称',40],['team','球队 / 球衣描述',40],['jersey','球衣号码',4]];
  return <>
    <div className="identity-flow"><div><small>正在编辑的固定身份</small><strong>{entity.id} · {entity.name}</strong></div><span>←</span><div><small>当前帧模型编号</small><strong>{point?.trackId!=null?`T${point.trackId}`:'尚未关联'}</strong></div></div>
    <div className="identity-evidence"><span className={`identity-state state-${point?.source||'missing'}`}>{({tracked:'模型位置',manual:point?.footMethod==='bbox_bottom_center'?'人工选人 · 脚点待核对':'人工位置',interpolated:'估计位置',manual_path:'手绘待核对',missing:'缺少位置',conflict:'身份冲突',out_of_view:'已标出画'})[point?.source]||'待关联'}</span>{state.observedIds.length>0&&<span>此身份对应过 {state.observedIds.map(id=>`T${id}`).join('、')}</span>}</div>
    <p className="small muted">P 是固定球员，T 是跟踪器编号。每次关联从当前帧起向后生效，直到下一次身份确认或切镜；此前绑定保留。</p>
    <div className="identity-fields">{fields.map(([name,label,max])=><label className="field" key={name}>{label}<input key={`${entity.id}:${name}:${entity[name]||''}`} aria-label={label} defaultValue={entity[name]||''} maxLength={max} onBlur={e=>{if(e.target.value.trim()!==(entity[name]||''))api.setField(name,e.target.value.trim());}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} /></label>)}</div>
    <div className="mode-switch"><button className={mode==='select'?'active':''} aria-pressed={mode==='select'} onClick={()=>api.setMode('select')}>关联人物</button><button className={mode==='point'?'active':''} aria-pressed={mode==='point'} onClick={()=>api.setMode('point')}>点击补脚下点</button></div>
    <p className="note">{mode==='select'?'点击候选框关联；已选中后，拖动脚下圆点改位置，拖动框边移动人物框，拖动四角调整大小。':'点击球员脚下保存当前帧位置；也可直接拖动已有圆点。'}</p>
    <label className="field">当前帧候选人物<select aria-label="当前帧候选人物" value={candidate} onChange={e=>{setCandidate(e.target.value);api.preview(e.target.value===''?null:proposals[Number(e.target.value)]);}}><option value="">选择一个候选，先预览</option>{proposals.map((p,i)=><option key={i} value={i}>{proposalLabel(p)} · 置信度 {Math.round((p.score||0)*100)}%</option>)}</select></label>
    {selected?.roleConflict&&<p className="candidate-warning">这个位置同时有球员与裁判候选，请核对真人和所属角色后关联。</p>}
    {selected?.role==='referee'&&entity.role==='player'&&<p className="candidate-warning">模型把这个候选标为裁判。若实际是裁判，请先添加 R 编号；误分类的球员仍可人工关联到当前 P。</p>}
    <button className="primary wide" disabled={!selected} onClick={()=>{api.associate(selected);setCandidate('');}}>把当前候选关联到 {entity.id}</button>
    <p className="small muted">橙框是候选预览，蓝色手柄属于当前目标。关联和位置修改都可撤销。</p>
    <details className="identity-keyframes"><summary>身份确认时间点（{state.identityRanges.length}）</summary>
      {state.identityRanges.map(key=><div className="anchor" key={key.frame}><button onClick={()=>api.seek(key.frame)}>{key.time.toFixed(2)} s · 第 {key.start+1}–{key.end+1} 帧 · {key.trackId==null?'未编号':`T${key.trackId}`}</button><button aria-label={`删除第 ${key.frame+1} 帧身份确认`} onClick={()=>api.removeIdentity(key.frame)}>删除身份确认</button></div>)}
      <p className="small muted">位置编辑只改当前帧。删除身份确认可恢复上一段规则，撤销可恢复整个操作。</p>
    </details>
    <details className="coordinate-editor"><summary>精确修改当前帧坐标</summary><form key={`${entity.id}:${state.frame}:${point?.x}:${point?.y}:${point?.box}`} onSubmit={e=>{e.preventDefault();const values=new FormData(e.currentTarget);api.edit({x:Number(values.get('x')),y:Number(values.get('y')), ...(point?.box?{box:['x1','y1','x2','y2'].map(k=>Number(values.get(k)))}:{})});}}>
      <div className="range-fields">{['x','y'].map(k=><label className="field" key={k}>脚下 {k.toUpperCase()}<input aria-label={`脚下 ${k.toUpperCase()}`} name={k} type="number" step="any" defaultValue={point?.[k]??''} disabled={!available}/></label>)}</div>
      {point?.box&&<div className="box-fields">{['x1','y1','x2','y2'].map((k,i)=><label className="field" key={k}>{k.toUpperCase()}<input aria-label={`人物框 ${k.toUpperCase()}`} name={k} type="number" step="any" defaultValue={point.box[i]}/></label>)}</div>}
      <button disabled={!available}>保存当前帧坐标</button>
    </form></details>
  </>;
}

export function mountIdentityUI(api) {
  const grid=createRoot(document.getElementById('entities'));
  const panel=createRoot(document.getElementById('identityControls'));
  let signature='';
  return {render(state){
    const next=JSON.stringify(state);if(next===signature)return;signature=next;
    flushSync(()=>{
      grid.render(<>{state.entities.map(e=><button key={e.id} className={`entity ${e.id===state.entity.id?'selected':''} ${e.selected?'bound':''}`} aria-label={`选择 ${e.id}`} aria-pressed={e.id===state.entity.id} title={`${e.id} · ${e.name}`} onClick={()=>api.select(e.id)}>{e.id}</button>)}</>);
      panel.render(<IdentityPanel key={state.entity.id+':'+state.frame} state={state} api={api}/>);
    });
  }};
}
