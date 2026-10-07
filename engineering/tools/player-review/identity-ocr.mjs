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
  const method=evidence.mode==='scoreboard_vision'?'scoreboard_vision_human_adopted':'scoreboard_ocr_human_adopted';
  session.teamIdentities={...(session.teamIdentities||{}),[side]:{team,method,evidence:structuredClone(evidence)}};
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
export function scoreboardRegionForPreset(clip,preset='left'){
  const {width,height}=clip;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<12||height<50)throw new Error('视频尺寸不足，无法读取主比分卡。');
  const bounds=({left:[0,.55],center:[.225,.775],right:[.45,1]})[preset];
  if(!bounds)throw new Error('请选择主比分卡位置。');
  return [Math.floor(width*bounds[0]),Math.floor(height*.88),Math.ceil(width*bounds[1]),height];
}
export function mountIdentityOCR(api){
  const host=document.getElementById('identityOcr');if(!host)return {render(){}};
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  const controls=el('div',null,'gap-controls'),status=el('p','识别号码后采用到当前 P；T 编号变化不会丢失号码。','small muted'),results=el('div'),teams=el('div');
  const current=el('button','识别本帧背号'),scan=el('button','从已关联画面找背号'),scoreboard=el('button','读取记分牌文字队伍'),visualTeams=el('button','Agent 识别队标 / 球队');
  for(const b of [current,scan,scoreboard,visualTeams])b.type='button';
  const regionField=el('label','主比分卡位置','field'),region=el('select');region.setAttribute('aria-label','主比分卡位置');
  for(const [value,label] of [['left','左下'],['center','底部中央'],['right','右下']]){const option=el('option',label);option.value=value;region.append(option);}
  region.value='left';regionField.append(region);
  const help=el('p','球队识别只看当前帧的主比分卡。默认左下；可换位置，避免把广告或球员资料当作本场队伍。核对候选后再绑定红 / 蓝组。','small muted');
  controls.append(current,scan,scoreboard,visualTeams);host.append(controls,regionField,help,status,results,teams);
  let epoch=0,busy=false,active=null;
  function render(){const s=api.getState();if(active!==s.active){active=s.active;epoch++;busy=false;results.replaceChildren();teams.replaceChildren();status.textContent='号码采用到当前 P，原身份关联和跟踪位置保留。';}
    const valid=s.session.entities.find(e=>e.id===s.active)?.role==='player';current.disabled=busy||!valid||!s.point?.box;scan.disabled=busy||!valid;scoreboard.disabled=busy;visualTeams.disabled=busy;region.disabled=busy;
  }
  const identityStamp=(session,id)=>{const e=session.entities.find(e=>e.id===id);return JSON.stringify([e?.anchors,e?.bindings,e?.identityKeyframes,e?.modelBindings]);};
  const sourceContext=s=>({sample:s.sample,variant:s.variant,videoSha256:s.clip.video_sha256,trackingFingerprint:s.clip.tracking_fingerprint??null,sessionVideoHash:s.session.videoHash});
  async function request(mode,multi=false){
    const s=api.getState(),id=s.active,token=++epoch;api.pause?.();busy=true;render();results.replaceChildren();teams.replaceChildren();
    const requestedIdentity=identityStamp(s.session,id),source=sourceContext(s),requestedSource=JSON.stringify(source);
    function assertCurrentSource(data){
      if(token!==epoch)throw new Error('识别任务已变化，请重新核对当前候选。');
      const latest=sourceContext(api.getState());
      if(JSON.stringify(latest)!==requestedSource||data.videoSha256!==latest.videoSha256||(data.trackingFingerprint??null)!==latest.trackingFingerprint)
        throw new Error('视频或跟踪来源已变化，请重新识别。');
    }
    const teamMode=mode==='scoreboard'||mode==='scoreboard_vision',visualMode=mode==='scoreboard_vision';
    status.textContent=mode==='jersey'?'正在读取球衣号码…':visualMode?'Agent 正在分析主比分卡队标与球队，候选返回后需核对…':'正在读取主比分卡文字队伍…';
    try{
      const observations=teamMode?[{frame:s.frame}]:ocrObservations(s.trajectories?.[id]||[s.point],s.frame,multi);
      if(!observations.length)throw new Error('没有可识别的人物框，请先关联当前球员。');
      const scoreboardRegion=teamMode?scoreboardRegionForPreset(s.clip,region.value):null;
      const response=await fetch('/api/identity-ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sample:s.sample,variant:s.variant,
        videoSha256:source.videoSha256,mode,observations,...(teamMode?{scoreboardRegion}:{})})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'识别暂时不可用。');
      if(token!==epoch||id!==api.getState().active)return;
      assertCurrentSource(data);
      if(data.mode!==mode||!Array.isArray(data.candidates)||(visualMode&&data.engine!=='codex-vision'))throw new Error('返回的识别来源不匹配。');
      status.textContent=data.candidates.length?`已检查 ${data.scannedFrames} 帧 · ${visualMode?'Codex 视觉模型建议':'文字 OCR 候选'}。${teamMode?'核对画面后采用；球队候选需要确认红 / 蓝分组。':'核对候选后采用；多帧不一致时保留备选。'}`:visualMode?'没有辨认出主比分卡队伍；换清楚画面、调整比分卡位置或手工填写。':'没有读到可靠文字；换清楚的画面或手工填写。';
      for(const candidate of data.candidates){
        const row=el('div',null,'gap-controls'),evidence=candidate.evidence?.[0];
        row.append(el('span',`${mode==='jersey'?'#':''}${candidate.value} · ${candidate.distinctFrames} 帧 · ${visualMode?'视觉模型估计':'OCR 分数'} ${Math.round(candidate.score*100)}${visualMode?'%':''}（非正确率）`));
        if(evidence){const view=el('button',`查看第 ${evidence.frame+1} 帧`);view.onclick=()=>api.seek?.(evidence.frame);row.append(view);}
        if(mode==='jersey'){
          const use=el('button',`采用 #${candidate.value} 到 ${id}`);use.onclick=()=>{try{
            assertCurrentSource(data);
            if(api.getState().active!==id)throw new Error('所选球员已变化，请重新识别。');
            if(identityStamp(api.getState().session,id)!==requestedIdentity)throw new Error('该球员的编号关联或原图位置已变化，请重新识别。');
            const copy=structuredClone(api.getState().session);adoptJerseyReading(copy,id,candidate,data);api.commit(copy);api.onJersey?.(candidate.value);
            status.textContent=`已保存 ${id} 的 #${candidate.value}；可继续选择球队与赛季查找姓名，也可撤销。`;
          }catch(error){status.textContent=error.message;}};row.append(use);results.append(row);
        }else{
          for(const side of ['red','blue']){const use=el('button',`绑定${side==='red'?'红':'蓝'}组为 ${candidate.value}`);use.onclick=()=>{try{
            assertCurrentSource(data);
            const copy=structuredClone(api.getState().session);bindTeamReading(copy,side,candidate.value,{...candidate,videoSha256:data.videoSha256,engine:data.engine,mode,scoreboardRegion:data.scoreboardRegion||scoreboardRegion});api.commit(copy);api.onTeam?.();status.textContent='队伍已绑定到该组球员，可撤销；请继续核对各球员号码。';
          }catch(error){status.textContent=error.message;}};row.append(use);}teams.append(row);
          if(evidence?.reason)teams.append(el('p',String(evidence.reason).slice(0,300),'small muted'));
        }
      }
    }catch(error){if(token===epoch)status.textContent=error.message;}
    finally{if(token===epoch){busy=false;render();}}
  }
  current.onclick=()=>request('jersey');scan.onclick=()=>request('jersey',true);scoreboard.onclick=()=>request('scoreboard');visualTeams.onclick=()=>request('scoreboard_vision');render();return {render};
}
