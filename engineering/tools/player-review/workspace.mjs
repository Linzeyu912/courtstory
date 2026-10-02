import {COURT,LANDMARK_NAMES,landmarks,keyframePoints,fitKeyframe,project,calibrationAt,buildCourtTrajectories,courtGaps,pathSegments,validQuad,addCourtAnchor,addEvent} from './court.mjs';
import {courtLandmarks,courtMarkings} from './court-geometry.mjs';

export function createWorkspace(api){
  const $=id=>document.getElementById(id),{clip,getState,change,seek,toast,isSelected,color}=api;
  const court=$('court'),ctx=court.getContext('2d');
  let step='identity',view='half',pan=0,courtPoints={},pending=null,pointMode=false,transform=null,hits=[],drag=null,lastControlFrame=-1;
  const state=()=>{const s=getState();return {...s,entity:s.session.entities.find(e=>e.id===s.active)};};
  const reasonLabel={missing:'位置缺失',conflict:'身份冲突',uncalibrated:clip.supportsCourtCalibration===false?'未提供适配场地模板':'球场待标定'};
  const shades={projected:'#1675b6',court_manual:'#6e4fd0',court_estimated:'#b96a09',missing:'#c83d4c',conflict:'#ae385c',uncalibrated:'#a08bd1',out_of_view:'#8c98a8'};
  const time=i=>`${clip.frames[i].time.toFixed(2)} s`;
  function switchStep(next,scroll=false){
    const session=getState().session;
    if(['identity','repair','export'].includes(next)&&!session.liveSelection){toast('先在第一步保留并确认直播画面。');next='footage';}
    if(next==='calibration'&&clip.supportsCourtCalibration===false){toast('这段 NCAA 示例用于原图位置验收；尚未提供适配的球场模板。');return;}
    step=next;pending=null;pointMode=false;$('repairCourt').setAttribute('aria-pressed','false');
    document.body.dataset.step=step;
    $('overview').hidden=!['calibration','events'].includes(step);
    (step==='repair'?$('repairCourtView'):$('overview')).prepend($('courtCard'));
    $('repairCourtView').hidden=step!=='repair';
    $('openCourtCalibration').hidden=step!=='repair';
    const roster=document.querySelector('.player-overview');
    (step==='identity'?$('identityRoster'):step==='repair'?$('repairRoster'):$('overview')).append(roster);
    (step==='repair'?$('repairIdentityControls'):$('identityMain')).append($('identityControls'));
    $('repairBindingControls').append($('bindingControls'));
    $('overlay').hidden=step==='footage';$('pointStatus').hidden=step==='footage';
    document.querySelectorAll('[data-step]').forEach(tab=>{const on=tab.dataset.step===step;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;$(`panel-${tab.dataset.step}`).hidden=!on;});
    api.setMode(step==='repair'?'point':'select');
    $('videoMode').textContent={footage:'核对直播区间及整体站位',calibration:'核对场地线与参照点',identity:'点击候选框对应 P1–P10',repair:'归并临时编号，手动补脚下点',events:'核对事件发生时刻',export:'导出位置与未解决区间'}[step];
    $('calibrationHelp').textContent='ABCD 只围住禁区。选择 E–J 可以补外边界、中线或三分直线交点；看不清的点不要猜。';
    api.redraw();
    if(scroll)$('operations').scrollIntoView({behavior:'smooth',block:'start'});
  }
  const tabs=[...document.querySelectorAll('[data-step]')].filter(tab=>!tab.hidden);
  tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>switchStep(tab.dataset.step));tab.addEventListener('keydown',event=>{let index;if(event.key==='ArrowRight')index=(i+1)%tabs.length;if(event.key==='ArrowLeft')index=(i+tabs.length-1)%tabs.length;if(event.key==='Home')index=0;if(event.key==='End')index=tabs.length-1;if(index!==undefined){event.preventDefault();event.stopPropagation();tabs[index].focus();switchStep(tabs[index].dataset.step);}});});
  function setView(value){view=value;for(const id of ['halfCourt','fullCourt']){const on=id===(view==='half'?'halfCourt':'fullCourt');$(id).classList.toggle('active',on);$(id).setAttribute('aria-pressed',String(on));}for(const id of ['courtPan','panLeft','panRight','followPlayer'])$(id).disabled=view==='full';draw();}
  $('halfCourt').onclick=()=>setView('half');$('fullCourt').onclick=()=>setView('full');
  function setPan(value){pan=Math.max(0,Math.min(COURT.length/2,value));$('courtPan').value=pan/(COURT.length/2)*1000;draw();}
  $('courtPan').oninput=e=>{$('followPlayer').checked=false;setPan(Number(e.target.value)/1000*COURT.length/2);};
  $('panLeft').onclick=()=>{$('followPlayer').checked=false;setPan(0);};$('panRight').onclick=()=>{$('followPlayer').checked=false;setPan(COURT.length/2);};$('followPlayer').onchange=draw;

  $('openCourtCalibration').onclick=()=>switchStep('calibration',true);
  $('returnToRepair').onclick=()=>switchStep('repair',true);
  $('repairImage').onclick=()=>{pointMode=false;api.setMode('point');$('repairCourt').setAttribute('aria-pressed','false');$('repairHelp').textContent='在原视频中，点击当前球员脚下。';};
  $('repairCourt').onclick=()=>{if(!isSelected(state().entity)){toast('请先对应当前球员。');return;}if(clip.supportsCourtCalibration===false){toast('本示例尚未提供适配的球场模板，请在原视频补位置。');return;}getState().video.pause();api.setMode('select');pointMode=true;$('repairCourt').setAttribute('aria-pressed','true');$('repairHelp').textContent='在左侧 2D 球场点击当前帧的位置；只保存当前帧，可撤销。';toast('在 2D 球场点击当前帧的位置，可撤销。');draw();};
  $('repairIdentity').onclick=()=>{$('bindingControls').open=true;$('bindingControls').scrollIntoView({behavior:'smooth',block:'nearest'});};
  $('startCalibration').onclick=()=>{const s=state();s.video.pause();pending={frame:s.frame,side:$('calibrationSide').value,image:[]};$('calibrationHelp').textContent=`正在标定第 ${s.frame+1} 帧：请点击 ${LANDMARK_NAMES[0]}`;api.redraw();};
  $('cancelCalibration').onclick=()=>{pending=null;$('calibrationHelp').textContent='已取消本次点选，原标定保留。';api.redraw();};
  const catalog=courtLandmarks();for(const p of catalog){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.id} · ${p.name}`;$('calibrationLandmark').append(option);}
  $('calibrationSide').onchange=()=>{pending=null;api.redraw();};
  $('showCourtLines').onchange=()=>api.redraw();
  function keyAtCurrent(){
    const s=state(),old=s.session.courtCalibration?.keyframes.find(k=>k.frame===s.frame);
    if(old)return {...structuredClone(old),points:structuredClone(keyframePoints(old))};
    const map=calibrationAt(s.session.courtCalibration,s.frame,clip.frames,s.session.cuts);
    return {frame:s.frame,side:map?.side||$('calibrationSide').value,source:'human',points:map?map.image.map((image,i)=>({id:'ABCD'[i],image,source:'interpolated_seed'})):[]};
  }
  function storeKey(key){const s=state();s.session.courtCalibration||={template:'NBA',videoHash:clip.video_sha256,maxKeyframeGapSeconds:1.2,keyframes:[]};s.session.courtCalibration.keyframes=s.session.courtCalibration.keyframes.filter(k=>k.frame!==key.frame);s.session.courtCalibration.keyframes.push(key);}
  $('pickLandmark').onclick=()=>{const s=state();s.video.pause();pending={kind:'single',frame:s.frame,side:$('calibrationSide').value,id:$('calibrationLandmark').value,image:[]};$('calibrationHelp').textContent=`请在原视频点击 ${$('calibrationLandmark').selectedOptions[0].textContent}。只替换这个点；其他参照点保留。`;api.redraw();};
  $('restoreCalibration').disabled=!clip.courtCalibration;
  $('restoreCalibration').onclick=()=>change(()=>{const s=state(),human=(s.session.courtCalibration?.keyframes||[]).filter(k=>k.source==='human'||keyframePoints(k).some(p=>p.source==='human'));s.session.courtCalibration=structuredClone(clip.courtCalibration);s.session.courtCalibration.keyframes=s.session.courtCalibration.keyframes.filter(k=>!human.some(h=>h.frame===k.frame)).concat(human);});
  $('addEvent').onclick=()=>{const s=state();if(!isSelected(s.entity)){toast('请先选定球员，再标注事件。');return;}change(()=>addEvent(s.entity,s.frame,$('eventType').value,$('eventNote').value,clip.frames));$('eventNote').value='';toast(`${s.active} 已添加 ${time(s.frame)} 的人工事件。`);};
  function row(label,jump,remove,aria){const el=document.createElement('div');el.className='anchor';const b=document.createElement('button');b.textContent=label;b.onclick=jump;const d=document.createElement('button');d.textContent='删除';d.setAttribute('aria-label',aria);d.onclick=remove;el.append(b,d);return el;}
  function renderControls(){
    const s=state(),key=s.session.courtCalibration?.keyframes.find(k=>k.frame===s.frame),map=calibrationAt(s.session.courtCalibration,s.frame,clip.frames,s.session.cuts);lastControlFrame=s.frame;
    $('controlPointList').replaceChildren();$('checkQuality').textContent='核验点不参与拟合。请留出额外可见交点，检查它被还原后的偏差。';
    if(!key){$('calibrationQuality').textContent=map?'当前帧是关键帧间的估计。重选一点会建立本帧标定，其余四角先保留为待复核的估计。':'当前帧没有有效标定。可逐个添加参照点，至少需要 4 个不共线的点。';return;}
    $('calibrationSide').value=key.side;
    const fit=fitKeyframe(key),points=keyframePoints(key);
    $('calibrationQuality').textContent=fit?`${fit.points.length} 个有效参照点 · 拟合残差 ${fit.fitRmsePixels.toFixed(1)} px（用于拟合的点，非独立准确率）。请核对整条边线、三分弧和中线。`:'参照点不足或布局退化，暂停球场映射；请补至少 4 个不共线点。';
    if(fit?.checkResiduals.length)$('checkQuality').textContent='留出核验：'+fit.checkResiduals.map(r=>`${r.id} 偏差 ${r.pixels?.toFixed(1)??'不可解'} px / ${r.metres?.toFixed(2)??'不可解'} 米`).join('；')+'。仅核验这些点，不代表整段精度。';
    for(const p of points){
      const name=courtLandmarks(key.side).find(c=>c.id===p.id)?.name||p.id,err=fit?.residuals.find(r=>r.id===p.id)?.pixels;
      const el=row(`${p.id} · ${name} · ${p.role==='check'?'核验 / ':''}${p.source==='human'?'人工':'待复核'}${err==null?'':` · ${err.toFixed(1)} px`}`,()=>{$('calibrationLandmark').value=p.id;$('pickLandmark').click();},()=>change(()=>{const next=keyAtCurrent();next.points=next.points.filter(x=>x.id!==p.id);next.source='human';delete next.image;storeKey(next);}),`删除参照点 ${p.id}`);
      const role=document.createElement('button');role.textContent=p.role==='check'?'改为标定':'仅作核验';role.setAttribute('aria-label',`参照点 ${p.id} ${p.role==='check'?'改为标定':'仅作核验'}`);role.onclick=()=>change(()=>{const next=keyAtCurrent();next.points.find(x=>x.id===p.id).role=p.role==='check'?'control':'check';next.source='human';delete next.image;storeKey(next);});el.insertBefore(role,el.lastChild);
      const enable=document.createElement('input');enable.type='checkbox';enable.checked=p.enabled!==false;enable.setAttribute('aria-label',`启用参照点 ${p.id}`);enable.onchange=()=>change(()=>{const next=keyAtCurrent();next.points.find(x=>x.id===p.id).enabled=enable.checked;next.source='human';delete next.image;storeKey(next);});el.prepend(enable);$('controlPointList').append(el);
    }
  }
  function refresh(){
    const s=state();courtPoints=buildCourtTrajectories(s.session,clip.frames,s.trajectories);const points=courtPoints[s.active]||[],selected=isSelected(s.entity),gaps=selected?courtGaps(points):[];
    $('playerHeading').textContent=`${s.active} · ${s.entity.name}`;
    $('playerIdentity').textContent=[s.entity.team||'球队待填写',s.entity.jersey?`#${s.entity.jersey}`:'号码待填写'].join(' · ');

    $('mappedCount').textContent=points.filter(p=>p.x!==null).length;$('gapCount').textContent=gaps.length;$('eventCount').textContent=(s.entity.events||[]).length;
    $('gapList').replaceChildren();
    if(!selected)$('gapList').textContent='在「球员身份」中点击原视频的人物，开始整理轨迹。';
    else if(!gaps.length)$('gapList').textContent='没有未解决的位置区间；已有坐标仍可继续复核。';
    for(const gap of gaps){const b=document.createElement('button');b.className=`gap-item ${gap.reason}`;b.textContent=`${time(gap.start)}–${time(gap.end)} · ${reasonLabel[gap.reason]} (${gap.end-gap.start+1} 帧) →`;b.onclick=()=>{seek(gap.start);switchStep(gap.reason==='uncalibrated'?(clip.supportsCourtCalibration===false?'identity':'calibration'):gap.reason==='conflict'?'identity':'repair',true);};$('gapList').append(b);}
    $('calibrationList').replaceChildren();for(const k of [...(s.session.courtCalibration?.keyframes||[])].sort((a,b)=>a.frame-b.frame))$('calibrationList').append(row(`${time(k.frame)} · ${k.source==='reference'?'参考':'人工'} · ${keyframePoints(k).filter(p=>p.enabled!==false).length} 点`,()=>seek(k.frame),()=>change(()=>s.session.courtCalibration.keyframes=s.session.courtCalibration.keyframes.filter(x=>x.frame!==k.frame)),`删除第 ${k.frame+1} 帧标定`));
    renderControls();
    $('courtAnchorList').replaceChildren();for(const a of [...(s.entity.courtAnchors||[])].sort((a,b)=>a.frame-b.frame))$('courtAnchorList').append(row(`${time(a.frame)} · 球场补点`,()=>seek(a.frame),()=>change(()=>s.entity.courtAnchors=s.entity.courtAnchors.filter(x=>x.frame!==a.frame)),`删除第 ${a.frame+1} 帧球场补点`));
    $('eventList').replaceChildren();for(const e of [...(s.entity.events||[])].sort((a,b)=>a.frame-b.frame)){
      const el=row(`${time(e.frame)} · ${e.type}`,()=>seek(e.frame),()=>change(()=>s.entity.events=s.entity.events.filter(x=>x.id!==e.id)),`删除事件 ${e.type} ${time(e.frame)}`);const note=document.createElement('p');note.className='small muted';note.textContent=e.note||'人工事件';$('eventList').append(el,note);
    }
    const chosen=s.session.entities.filter(isSelected),allGaps=chosen.reduce((n,e)=>n+courtGaps(courtPoints[e.id]).length,0);
    $('exportSummary').textContent=`${chosen.length} 个已选目标 · ${allGaps} 段待处理 · ${chosen.reduce((n,e)=>n+(e.events||[]).length,0)} 个事件。缺失会原样保留；参考标定和估计点会附带待复核标记。`;
    draw();
  }
  function draw(){
    const s=state(),points=courtPoints[s.active]||[],current=points[s.frame],mapping=calibrationAt(s.session.courtCalibration,s.frame,clip.frames,s.session.cuts);
    if(lastControlFrame!==s.frame)renderControls();
    if(pending&&pending.frame!==s.frame){pending=null;$('calibrationHelp').textContent='时间已改变，本次未完成的点选已取消。';}
    if(view==='half'&&$('followPlayer').checked&&current?.x!=null){pan=Math.max(0,Math.min(COURT.length/2,current.x-COURT.length/4));$('courtPan').value=pan/(COURT.length/2)*1000;}
    const w=court.clientWidth,h=court.clientHeight,dpr=devicePixelRatio||1;
    court.width=Math.round(w*dpr);court.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);hits=[];
    if(w<=52||h<=34){transform=null;return;}
    const span=view==='half'?COURT.length/2:COURT.length,start=view==='half'?pan:0;
    const scale=Math.min((w-52)/(span+1),(h-34)/(COURT.width+1)),ox=(w-span*scale)/2,oy=(h-COURT.width*scale)/2;
    transform={scale,ox,oy,start,span};
    const screen=(x,y)=>[ox+(x-start)*scale,oy+y*scale];
    ctx.save();ctx.beginPath();ctx.rect(ox-.6*scale,oy-.6*scale,(span+1.2)*scale,(COURT.width+1.2)*scale);ctx.clip();
    const rect=(x,y,ww,hh,fill)=>{const[a,b]=screen(x,y);if(fill){ctx.fillStyle=fill;ctx.fillRect(a,b,ww*scale,hh*scale);}ctx.strokeRect(a,b,ww*scale,hh*scale);};
    const line=(x1,y1,x2,y2)=>{ctx.beginPath();ctx.moveTo(...screen(x1,y1));ctx.lineTo(...screen(x2,y2));ctx.stroke();};
    const arc=(x,y,r,a,b)=>{ctx.beginPath();const [xx,yy]=screen(x,y);ctx.arc(xx,yy,r*scale,a,b);ctx.stroke();};
    ctx.strokeStyle='#75614b';ctx.lineWidth=1.5;rect(0,0,COURT.length,COURT.width,'#eacfa0');
    ctx.strokeStyle='#e1c293';for(let x=1;x<COURT.length;x++)line(x,0,x,COURT.width);
    ctx.strokeStyle='#665742';rect(0,5.1816,5.7912,4.8768,'#b7cad6');rect(COURT.length-5.7912,5.1816,5.7912,4.8768,'#b7cad6');
    line(COURT.length/2,0,COURT.length/2,COURT.width);arc(COURT.length/2,7.62,1.8288,0,Math.PI*2);
    const threeR=7.239,cornerY=.9144,theta=Math.asin((7.62-cornerY)/threeR),cornerX=1.6002+Math.sqrt(threeR**2-(7.62-cornerY)**2);
    arc(1.6002,7.62,threeR,-theta,theta);line(0,cornerY,cornerX,cornerY);line(0,COURT.width-cornerY,cornerX,COURT.width-cornerY);
    arc(COURT.length-1.6002,7.62,threeR,Math.PI-theta,Math.PI+theta);line(COURT.length,cornerY,COURT.length-cornerX,cornerY);line(COURT.length,COURT.width-cornerY,COURT.length-cornerX,COURT.width-cornerY);
    for(const x of [5.7912,COURT.length-5.7912])arc(x,7.62,1.8288,0,Math.PI*2);
    for(const x of [1.6002,COURT.length-1.6002]){ctx.strokeStyle='#c16422';arc(x,7.62,.2286,0,Math.PI*2);}ctx.strokeStyle='#665742';line(1.2192,6.7056,1.2192,8.5344);line(COURT.length-1.2192,6.7056,COURT.length-1.2192,8.5344);
    // Draw each adjacent observed pair separately. A missing frame or cut breaks the line.
    for(const segment of pathSegments(points,s.session.cuts))for(let i=1;i<segment.length;i++){
      const a=segment[i-1],b=segment[i];
      ctx.strokeStyle=b.source==='court_estimated'||a.source==='court_estimated'?shades.court_estimated:shades.projected;ctx.globalAlpha=b.frame > s.frame ? 0.40 : 0.95;ctx.lineWidth=2.5;ctx.setLineDash(b.source==='court_estimated'||a.source==='court_estimated'?[4,4]:[]);line(a.x,a.y,b.x,b.y);
    }ctx.globalAlpha=1;ctx.setLineDash([]);
    for(const p of points)if(p.x!==null){const[x,y]=screen(p.x,p.y);if(p.x>=start&&p.x<=start+span&&p.y>=0&&p.y<=COURT.width)hits.push({x,y,frame:p.frame,id:s.active,kind:'trail'});if(p.source==='court_manual'){ctx.fillStyle=shades.court_manual;ctx.fillRect(x-4,y-4,8,8);}}
    for(const gap of isSelected(s.entity)?courtGaps(points):[]){
      const endpoints=[points[gap.start-1],points[gap.end+1]].filter(p=>p?.x!=null);ctx.strokeStyle=shades[gap.reason];ctx.lineWidth=2;
      endpoints.forEach((p,i)=>{const[x,y]=screen(p.x,p.y);ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.stroke();if(i===0){ctx.fillStyle='#a52f42';ctx.font='11px sans-serif';ctx.fillText(`${time(gap.start)} 缺口`,x+10,y-10);}if(p.x>=start&&p.x<=start+span)hits.push({x,y,frame:gap.start,id:s.active,kind:'gap',reason:gap.reason});});
    }
    for(const e of s.entity.events||[]){const p=points[e.frame];if(p?.x==null)continue;const[x,y]=screen(p.x,p.y);ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);ctx.fillStyle='#f2d58c';ctx.fillRect(-5,-5,10,10);ctx.restore();ctx.fillStyle='#f2d58c';ctx.font='11px sans-serif';ctx.fillText(e.type,x+9,y+14);if(p.x>=start&&p.x<=start+span)hits.push({x,y,frame:e.frame,id:s.active,kind:'event'});}
    for(const entity of s.session.entities){if(!isSelected(entity))continue;const p=courtPoints[entity.id]?.[s.frame];if(p?.x==null)continue;const[x,y]=screen(p.x,p.y),selected=entity.id===s.active;ctx.beginPath();ctx.arc(x,y,selected?13:10,0,Math.PI*2);ctx.fillStyle=color(entity.id);ctx.fill();ctx.strokeStyle=selected?'#fff':'#12363a';ctx.lineWidth=selected?3:1.5;ctx.stroke();ctx.fillStyle='#09272d';ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.fillText(entity.id,x,y+3);ctx.textAlign='left';if(p.x>=start&&p.x<=start+span&&p.y>=0&&p.y<=COURT.width)hits.push({x,y,frame:s.frame,id:entity.id,kind:'player'});}
    if(step==='calibration')courtLandmarks(pending?.side||$('calibrationSide').value).forEach(({x,y,id})=>{const[a,b]=screen(x,y);ctx.fillStyle=id===pending?.id?'#d44331':'#fff8e8';ctx.beginPath();ctx.arc(a,b,9,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#796548';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle=id===pending?.id?'white':'#183739';ctx.font='bold 11px sans-serif';ctx.fillText(id,a-4,b+4);});
    ctx.restore();
    ctx.fillStyle='#766c5e';ctx.font='11px sans-serif';ctx.fillText(view==='half'?'半场窗口 14.33 × 15.24 m · 可横向滑动':'全场 28.65 × 15.24 m',20,h-12);
    $('courtBadge').textContent=clip.supportsCourtCalibration===false?'仅原图位置验收':mapping?(mapping.referenceOnly?'参考标定 · 待复核':mapping.method==='manual_keyframe'?'人工标定 · 当前关键帧':'关键帧间估计 · 待复核'):'当前帧待标定';
    $('courtEmpty').hidden=isSelected(s.entity)&&points.some(p=>p.x!==null);
    $('courtEmpty').textContent=clip.supportsCourtCalibration===false?'本示例未提供适配的球场模板，请修改原图位置。':isSelected(s.entity)?'暂无可用球场轨迹 · 先校准球场，或人工补球场点':'先选择球员，再查看他的轨迹';
    $('courtPointStatus').textContent=current?.x!=null?`当前：${current.source==='court_manual'?'人工球场补点':current.source==='court_estimated'?'前后位置估计后映射':'原图位置映射'}${current.outsideCourt?' · 投影落在界外，请核对脚点 / 标定':''}。坐标精度待复核。`:isSelected(s.entity)?`当前：${reasonLabel[current?.source]||'已确认离开画面'}。没有可用位置时不显示球员圆点。`:'当前目标尚未选定。';
    const inspector=$('coordinateInspector'),imagePoint=s.trajectories[s.active]?.[s.frame];inspector.replaceChildren();inspector.hidden=!isSelected(s.entity)||current?.x==null;
    if(!inspector.hidden){
      const origin={bbox_bottom_center:'人物框底边中心（近似）',human_image_anchor:'人工原图补点',interpolated_image_point:'前后原图点估计',human_court_anchor:'人工球场补点'};
      const lines=[`原图：${imagePoint?.x!=null?`${imagePoint.x.toFixed(1)}, ${imagePoint.y.toFixed(1)} px`:'无可用点'} → 球场：${current.x.toFixed(2)}, ${current.y.toFixed(2)} 米`,`位置来源：${origin[current.footMethod]||'待核对'}`];
      if(current.calibrationSupport)lines.push(current.calibrationSupport==='outside_controls'?'位于标定点包围范围外，建议补附近参照。':'位于标定点包围范围内，仍需核验。');
      if(current.sensitivity)lines.push(`误差示例：脚点偏 5 px，局部可偏约 ${current.sensitivity.approxMaxMetres.toFixed(2)} 米；不含标定误差。`);
      for(const text of lines){const p=document.createElement('p');p.textContent=text;inspector.append(p);}
    }
    drawTimeline(points,s);
  }
  function drawTimeline(points,s){const target=$('courtTimeline'),c=target.getContext('2d'),dpr=devicePixelRatio||1;target.width=Math.round(target.clientWidth*dpr);target.height=24*dpr;c.clearRect(0,0,target.width,target.height);if(isSelected(s.entity))points.forEach((p,i)=>{c.fillStyle=shades[p.source];c.fillRect(i/points.length*target.width,3*dpr,target.width/points.length+1,18*dpr);});for(const event of s.entity.events||[]){c.fillStyle='#172336';c.fillRect(event.frame/points.length*target.width,0,2*dpr,6*dpr);}c.fillStyle='#111d2a';c.fillRect(s.frame/clip.frames.length*target.width,0,2*dpr,target.height);}
  $('courtTimeline').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();seek(Math.floor((e.clientX-r.left)/r.width*clip.frames.length));};
  function clickCourt(event){if(!transform)return;const s=state(),r=court.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top;
    if(pointMode){if(['conflict','out_of_view'].includes(s.trajectories[s.active][s.frame].source)){toast('请先解决身份冲突或修改出画区间，再补位置。');return;}const xx=(x-transform.ox)/transform.scale+transform.start,yy=(y-transform.oy)/transform.scale;try{change(()=>addCourtAnchor(s.entity,s.frame,xx,yy));pointMode=false;$('repairCourt').setAttribute('aria-pressed','false');$('repairHelp').textContent='已保存当前帧的人工球场点。可删除或撤销。';toast(`${s.active} 已补当前帧球场位置。`);}catch(error){toast(error.message);}return;}
    const hit=[...hits].reverse().find(p=>Math.hypot(p.x-x,p.y-y)<(p.kind==='player'?16:9));
    if(hit){if(hit.id!==s.active)api.select(hit.id);seek(hit.frame);if(hit.kind==='gap')switchStep(hit.reason==='uncalibrated'?'calibration':hit.reason==='conflict'?'identity':'repair',true);if(hit.kind==='event')switchStep('events',true);}
  }
  court.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY,pan,moved:false};court.setPointerCapture(e.pointerId);};
  court.onpointermove=e=>{if(!drag||view!=='half'||pointMode)return;const delta=e.clientX-drag.x;if(Math.abs(delta)>5)drag.moved=true;if(drag.moved){$('followPlayer').checked=false;setPan(drag.pan-delta/transform.scale);}};
  court.onpointerup=e=>{const moved=drag?.moved;drag=null;if(court.hasPointerCapture(e.pointerId))court.releasePointerCapture(e.pointerId);if(!moved)clickCourt(e);};court.onpointercancel=()=>drag=null;
  court.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();$('followPlayer').checked=false;setPan(pan+(e.key==='ArrowRight'?1:-1));}};
  function handleImageClick(x,y){
    if(step==='calibration'){
      if(!pending){toast('先选择参照点并点击“在原视频重选这个点”，或重新点选整组禁区四角。');return true;}
      if(pending.kind==='single'){
        const next=keyAtCurrent();if(next.side!==pending.side&&next.points.length){toast('球篮方向与本帧旧标定不同，请先重新点选整组禁区四角。');pending=null;return true;}
        const role=next.points.find(p=>p.id===pending.id)?.role||'control';next.side=pending.side;next.source='human';next.points=next.points.filter(p=>p.id!==pending.id);next.points.push({id:pending.id,image:[x,y],source:'human',enabled:true,role});delete next.image;pending=null;change(()=>storeKey(next));$('calibrationHelp').textContent='这个参照点已更新。可继续重选其他点，或撤销；请用反投影场地线核对。';return true;
      }
      pending.image.push([x,y]);
      if(pending.image.length===4){if(!validQuad(pending.image)){pending.image=[];$('calibrationHelp').textContent='四点顺序交叉或过于接近，请重新按 A → B → C → D 点选。';api.redraw();return true;}const k={...pending,source:'human'},s=state();pending=null;change(()=>{s.session.courtCalibration||={template:'NBA',videoHash:clip.video_sha256,maxKeyframeGapSeconds:1.2,keyframes:[]};s.session.courtCalibration.keyframes=s.session.courtCalibration.keyframes.filter(p=>p.frame!==k.frame);s.session.courtCalibration.keyframes.push(k);});$('calibrationHelp').textContent=`第 ${k.frame+1} 帧四角已保存。请播放检查投影，并在镜头移动处补充标定。`;toast('当前帧标定已保存，可撤销。');}
      else{$('calibrationHelp').textContent=`请点击 ${LANDMARK_NAMES[pending.image.length]}`;api.redraw();}return true;
    }
    if(['events','export'].includes(step)){toast('当前步骤用于核对画面；修改位置请进入“轨迹补全”。');return true;}
    return false;
  }
  function drawImageOverlay(context){
    if(step!=='calibration')return;const s=state(),map=calibrationAt(s.session.courtCalibration,s.frame,clip.frames,s.session.cuts),key=s.session.courtCalibration?.keyframes.find(k=>k.frame===s.frame);
    if(map&&$('showCourtLines').checked){
      for(const line of courtMarkings()){
        context.strokeStyle=line.color;context.lineWidth=4;context.setLineDash([]);context.beginPath();let prev=null,visible=[];
        for(const p of line.points){const q=project(map.toImage,...p),depth=map.toImage[6]*p[0]+map.toImage[7]*p[1]+map.toImage[8];if(!q||Math.abs(q.x)>50000||Math.abs(q.y)>50000){prev=null;continue;}if(prev&&prev.depth*depth>0)context.lineTo(q.x,q.y);else context.moveTo(q.x,q.y);prev={...q,depth};if(q.x>0&&q.x<clip.width&&q.y>0&&q.y<clip.height)visible.push(q);}
        context.stroke();if(visible.length){const p=visible[Math.floor(visible.length/2)];context.font='bold 20px sans-serif';const width=context.measureText(line.name).width;context.fillStyle='#172336da';context.fillRect(p.x+5,p.y-25,width+12,26);context.fillStyle=line.color;context.fillText(line.name,p.x+11,p.y-6);}
      }
    }
    const points=pending&&pending.kind!=='single'?pending.image.map((image,i)=>({id:'ABCD'[i],image})):key?keyframePoints(key):map?map.image.map((image,i)=>({id:'ABCD'[i],image})):[];
    context.font='bold 23px sans-serif';for(const p of points){const[x,y]=p.image;context.fillStyle=p.enabled===false?'#999':'#fff6d2';context.strokeStyle='#233f5b';context.lineWidth=3;context.beginPath();context.arc(x,y,10,0,Math.PI*2);context.fill();context.stroke();context.fillStyle='#233f5b';context.fillRect(x+12,y-25,31,29);context.fillStyle='white';context.fillText(p.id,x+19,y-3);}
  }
  window.addEventListener('resize',draw);
  return {refresh,draw,handleImageClick,drawImageOverlay,switchStep,gaps:()=>courtGaps(courtPoints[state().active]||[])};
}
