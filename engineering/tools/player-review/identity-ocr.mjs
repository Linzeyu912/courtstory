// OCR contributes evidence to persistent P identities, never temporary T IDs.
export function adoptJerseyReading(session,id,candidate,response){
  const entity=session.entities.find(e=>e.id===id&&e.role==='player');
  if(!entity||response.videoSha256!==session.videoHash||response.mode!=='jersey'||
    !/^[0-9]{1,2}$/.test(candidate?.value)||!response.candidates?.some(c=>c.value===candidate.value))throw new Error('号码证据与当前球员或视频不匹配。');
  if(entity.playerProfile?.status==='confirmed'&&entity.playerProfile.jersey_number!==candidate.value)throw new Error('该号码与已确认身份冲突，请先核对或清除旧身份。');
  entity.jersey=candidate.value;
  entity.jerseyEvidence={method:'ocr_human_adopted',engine:response.engine,videoSha256:response.videoSha256,
    trackingFingerprint:response.trackingFingerprint,jersey:candidate.value,evidence:structuredClone(candidate.evidence),
    adoptedAt:new Date().toISOString()};
  return entity;
}
export function bindTeamReading(session,side,team,evidence){
  if(!['red','blue'].includes(side)||!/^[A-Z]{3}$/.test(team)||evidence?.videoSha256!==session.videoHash)throw new Error('队伍证据不正确。');
  const people=session.entities.filter(e=>e.role==='player'&&e.teamSide===side);
  if(people.some(e=>e.playerProfile?.status==='confirmed'&&e.playerProfile.team_abbreviation!==team))throw new Error('该分组包含已确认的其他球队球员，请先核对分队。');
  const opposite=side==='red'?'blue':'red';
  if(session.teamIdentities?.[opposite]?.team===team)throw new Error('另一组已绑定这支队伍，请先核对分组。');
  session.teamIdentities={...(session.teamIdentities||{}),[side]:{team,method:'scoreboard_ocr_human_adopted',evidence:structuredClone(evidence)}};
  for(const entity of people)entity.team=team;
}
export function ocrObservations(points,current,scan=false){
  const valid=points.map((p,frame)=>({...p,frame})).filter(p=>p.box?.length===4&&!p.reviewExcluded&&
    !['conflict','missing','out_of_view','interpolated','manual_path'].includes(p.source));
  if(!scan)return valid.filter(p=>p.frame===current).map(({frame,box,trackId})=>({frame,box,trackId:trackId??null}));
  const selected=new Map();
  const at=valid.find(p=>p.frame===current);if(at)selected.set(at.frame,at);
  for(let i=0;i<Math.min(16,valid.length);i++){const p=valid[Math.round(i*(valid.length-1)/Math.max(1,Math.min(16,valid.length)-1))];selected.set(p.frame,p);}
  return [...selected.values()].sort((a,b)=>a.frame-b.frame).map(({frame,box,trackId})=>({frame,box,trackId:trackId??null}));
}
export function mountIdentityOCR(api){
  const host=document.getElementById('identityOcr');if(!host)return {render(){}};
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  const controls=el('div',null,'gap-controls'),status=el('p','识别号码后采用到当前 P；T 编号变化不会丢失号码。','small muted'),results=el('div'),teams=el('div');
  const current=el('button','识别本帧背号'),scan=el('button','从已关联画面找背号'),scoreboard=el('button','读取记分牌队伍');
  for(const b of [current,scan,scoreboard])b.type='button';
  controls.append(current,scan,scoreboard);host.append(controls,status,results,teams);
  let epoch=0,busy=false,active=null;
  function render(){const s=api.getState();if(active!==s.active){active=s.active;epoch++;busy=false;results.replaceChildren();teams.replaceChildren();status.textContent='号码采用到当前 P，原身份关联和跟踪位置保留。';}
    const valid=s.session.entities.find(e=>e.id===s.active)?.role==='player';current.disabled=busy||!valid||!s.point?.box;scan.disabled=busy||!valid;scoreboard.disabled=busy;
  }
  const identityStamp=(session,id)=>{const e=session.entities.find(e=>e.id===id);return JSON.stringify([e?.anchors,e?.bindings,e?.identityKeyframes,e?.modelBindings]);};
  async function request(mode,multi=false){
    const s=api.getState(),id=s.active,token=++epoch;api.pause?.();busy=true;render();results.replaceChildren();teams.replaceChildren();
    const requestedIdentity=identityStamp(s.session,id);
    status.textContent=mode==='jersey'?'正在读取球衣号码…':'正在读取画面下方记分牌…';
    try{
      const observations=mode==='scoreboard'?[{frame:s.frame}]:ocrObservations(s.trajectories?.[id]||[s.point],s.frame,multi);
      if(!observations.length)throw new Error('没有可识别的人物框，请先关联当前球员。');
      const response=await fetch('/api/identity-ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sample:s.sample,variant:s.variant,
        videoSha256:s.clip.video_sha256,mode,observations})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'OCR 暂时不可用。');
      if(token!==epoch||id!==api.getState().active)return;
      if(data.videoSha256!==s.clip.video_sha256||!Array.isArray(data.candidates))throw new Error('返回的识别来源不匹配。');
      status.textContent=data.candidates.length?`已检查 ${data.scannedFrames} 帧。核对候选后采用；单帧也可使用，多帧不一致时保留备选。`:'没有读到可靠文字；换清楚的画面或手工填写。';
      for(const candidate of data.candidates){
        const row=el('div',null,'gap-controls'),evidence=candidate.evidence?.[0];
        row.append(el('span',`${mode==='jersey'?'#':''}${candidate.value} · ${candidate.distinctFrames} 帧 · OCR 分数 ${Math.round(candidate.score*100)}（非正确率）`));
        if(evidence){const view=el('button',`查看第 ${evidence.frame+1} 帧`);view.onclick=()=>api.seek?.(evidence.frame);row.append(view);}
        if(mode==='jersey'){
          const use=el('button',`采用 #${candidate.value} 到 ${id}`);use.onclick=()=>{try{
            if(api.getState().active!==id)throw new Error('所选球员已变化，请重新识别。');
            if(identityStamp(api.getState().session,id)!==requestedIdentity)throw new Error('该球员的编号关联或原图位置已变化，请重新识别。');
            const copy=structuredClone(api.getState().session);adoptJerseyReading(copy,id,candidate,data);api.commit(copy);api.onJersey?.(candidate.value);
            status.textContent=`已保存 ${id} 的 #${candidate.value}；可继续选择球队与赛季查找姓名，也可撤销。`;
          }catch(error){status.textContent=error.message;}};row.append(use);results.append(row);
        }else{
          for(const side of ['red','blue']){const use=el('button',`绑定${side==='red'?'红':'蓝'}组为 ${candidate.value}`);use.onclick=()=>{try{
            const copy=structuredClone(api.getState().session);bindTeamReading(copy,side,candidate.value,{videoSha256:data.videoSha256,...candidate});api.commit(copy);api.onTeam?.();status.textContent='队伍已绑定到该组球员，可撤销；请继续核对各球员号码。';
          }catch(error){status.textContent=error.message;}};row.append(use);}teams.append(row);
        }
      }
    }catch(error){if(token===epoch)status.textContent=error.message;}
    finally{if(token===epoch){busy=false;render();}}
  }
  current.onclick=()=>request('jersey');scan.onclick=()=>request('jersey',true);scoreboard.onclick=()=>request('scoreboard');render();return {render};
}
