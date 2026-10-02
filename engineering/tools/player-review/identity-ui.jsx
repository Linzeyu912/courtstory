import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {entityLabel} from './trajectory.mjs';
import {effectiveTeamGroup,teamRoster} from './team-overlay.mjs';
import {proposalLabel} from './tracking-display.mjs';

function IdentityPanel({state,api}) {
  const {entity,point,mode,proposals,display}=state;
  const [candidate,setCandidate]=useState('');
  const selected=candidate===''?null:proposals[Number(candidate)];
  const available=point?.x!=null;
  const fields=[['name','目标名称',40],['team','球队 / 球衣描述',40],['jersey','球衣号码',4]];
  const group=effectiveTeamGroup(entity);
  return <>
    <div className="identity-flow"><div><small>正在编辑的固定身份</small><strong>{entityLabel(entity)}{entity.name!==entityLabel(entity)?` · ${entity.name}`:''}</strong></div><div><small>当前身份</small><strong className={`identity-lock ${display.identity}`}>{display.identity==='human_locked'?'人工已锁定':display.identity==='model_proposed'?'模型建议 · 待确认':'等待人工关联'}</strong></div></div>
    <div className={`current-player-state ${display.status}`} role="status">{display.label}{point?.x==null?' · 当前没有可靠位置':''}</div>
    <p className="small muted">球员 1–10 始终保留。每次人工关联从当前帧起向后生效，直到下一次身份确认或切镜；此前绑定保留。遮挡 / 断轨待续接表示模型没有可靠位置。</p>
    {display.identity==='model_proposed'&&<button className="primary wide" disabled={point?.trackId==null||!proposals.some(p=>p.trackId===point.trackId)} onClick={api.confirmCurrent}>确认当前建议为 {entityLabel(entity)}（从此帧起）</button>}
    {entity.modelTeamHint&&<p className="small muted">模型队色提示：{entity.modelTeamHint}（待核对，不改写人工球队）</p>}
    <label className="field">标注分队<select aria-label="标注分队" value={group||''} onChange={event=>api.setTeamGroup(event.target.value||null)}><option value="">分队待确认</option>{Object.entries(state.teamPolicy.teams).map(([key,team])=><option key={key} value={key}>{team.label}（最多五人）</option>)}</select></label>
    {group&&entity.teamGroupSource!=='human'&&<button className="wide" onClick={()=>api.setTeamGroup(group)}>确认分队为{state.teamPolicy.teams[group].label}</button>}
    <p className="small muted">每队一个框色，问号 / 虚线表示待确认。分队独立保存，不改写姓名、球队文字、号码或身份绑定。</p>
    <div className="identity-fields">{fields.map(([name,label,max])=><label className="field" key={name}>{label}<input key={`${entity.id}:${name}:${entity[name]||''}`} aria-label={label} defaultValue={entity[name]||''} maxLength={max} onBlur={e=>{if(e.target.value.trim()!==(entity[name]||''))api.setField(name,e.target.value.trim());}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} /></label>)}</div>
    <div className="mode-switch"><button className={mode==='select'?'active':''} aria-pressed={mode==='select'} onClick={()=>api.setMode('select')}>关联人物</button><button className={mode==='point'?'active':''} aria-pressed={mode==='point'} onClick={()=>api.setMode('point')}>点击补脚下点</button></div>
    <p className="note">{mode==='select'?'点击候选框关联。关闭视频下方“稳定显示”后可拖动原始框、四角及脚下点；稳定显示只调整画面，保存和导出保留原始坐标。':'点击球员脚下保存当前帧位置；已有脚下点也可拖动。人工点不会参与平滑。'}</p>
    <label className="field">当前帧候选人物<select aria-label="当前帧候选人物" value={candidate} onChange={e=>{setCandidate(e.target.value);api.preview(e.target.value===''?null:proposals[Number(e.target.value)]);}}><option value="">选择一个候选，先预览</option>{proposals.map((p,i)=><option key={i} value={i}>{proposalLabel(p)} · 检测分数 {Math.round((p.score||0)*100)}%</option>)}</select></label>
    {selected?.roleConflict&&<p className="candidate-warning">这个位置同时有球员与裁判候选，请核对真人和所属角色后关联。</p>}
    {selected?.role==='referee'&&entity.role==='player'&&<p className="candidate-warning">模型把这个候选标为裁判。若实际是裁判，请先添加 R 编号；误分类的球员仍可人工关联到当前固定球员。</p>}
    <button className="primary wide" disabled={!selected} onClick={()=>{api.associate(selected);setCandidate('');}}>把当前候选关联到 {entityLabel(entity)}</button>
    <p className="small muted">紫框是候选预览，白色手柄属于当前目标。脚下椭圆是框底参考，尚未验证地面触点；人工脚点单独保存。关联和位置修改可撤销。</p>
    <details className="identity-keyframes"><summary>高级信息 · 临时轨迹</summary><div className="identity-evidence"><span>P 是固定身份，T 是临时轨迹</span>{state.observedIds.length>0&&<span>此身份对应过 {state.observedIds.map(id=>`T${id}`).join('、')}</span>}</div><p className="small muted">当前内部编号：{point?.trackId!=null?`T${point.trackId}`:'无'}。临时编号用于断轨修复，不代表场上人数。检测分数只描述检测结果，不是身份可信度。</p></details>
    <details className="identity-keyframes"><summary>身份确认时间点（{state.identityRanges.length}）</summary>
      {state.identityRanges.map(key=><div className="anchor" key={key.frame}><button onClick={()=>api.seek(key.frame)}>{key.time.toFixed(2)} s · 第 {key.start+1}–{key.end+1} 帧 · {key.trackId==null?'未编号':`T${key.trackId}`}</button><button aria-label={`删除第 ${key.frame+1} 帧身份确认`} onClick={()=>api.removeIdentity(key.frame)}>删除身份确认</button></div>)}
      <p className="small muted">位置编辑只改当前帧。删除身份确认可恢复上一段规则，撤销可恢复整个操作。</p>
    </details>
    <details className="coordinate-editor"><summary>精确修改当前帧坐标</summary><form key={`${entity.id}:${state.frame}:${point?.x}:${point?.y}:${point?.box}`} onFocus={api.prepareEdit} onSubmit={e=>{e.preventDefault();const values=new FormData(e.currentTarget);api.edit({x:Number(values.get('x')),y:Number(values.get('y')), ...(point?.box?{box:['x1','y1','x2','y2'].map(k=>Number(values.get(k)))}:{})});}}>
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
      const groups=teamRoster(state.entities,state.teamPolicy);
      const buttons=entities=>entities.map(e=>{const group=effectiveTeamGroup(e);return <button key={e.id} style={{'--team-color':group?state.teamPolicy.teams[group].color:state.teamPolicy.pendingColor}} className={`entity team-member ${e.id===state.entity.id?'selected':''} ${e.selected?'bound':'unconfirmed'} ${e.display.status} ${e.display.identity}`} aria-label={`选择 ${entityLabel(e)}`} aria-pressed={e.id===state.entity.id} title={`${entityLabel(e)} · ${e.name} · ${e.display.label}`} onClick={()=>api.select(e.id)}><strong>{entityLabel(e)}</strong><small>{e.selected?'人工确认':e.display.identity==='model_proposed'?'建议待确认':'待关联'}</small><span>{group?e.teamGroupSource==='human'?'人工分队':'分队建议':'分队待确认'}</span><span>{e.display.label}</span></button>;});
      grid.render(<>{['A','B'].map(key=><section className="team-section" key={key} style={{'--team-color':state.teamPolicy.teams[key].color}} aria-label={state.teamPolicy.teams[key].label}><div className="team-heading"><strong>{state.teamPolicy.teams[key].label}</strong><small>{groups[key].filter(e=>effectiveTeamGroup(e)===key).length} / 5 已分组 · 空槽待关联</small></div><div className="team-player-grid">{buttons(groups[key])}</div></section>)}{groups.pending.length>0&&<section className="team-section pending-team" aria-label="分队待确认"><div className="team-heading"><strong>分队待确认</strong><small>保留原固定编号，不强行凑满五人</small></div><div className="team-player-grid">{buttons(groups.pending)}</div></section>}{groups.referees.length>0&&<div className="team-player-grid">{buttons(groups.referees)}</div>}</>);
      panel.render(<IdentityPanel key={state.entity.id+':'+state.frame} state={state} api={api}/>);
    });
  }};
}
