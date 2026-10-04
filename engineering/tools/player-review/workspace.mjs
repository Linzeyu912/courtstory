import {COURT,LANDMARK_NAMES,landmarks,keyframePoints,fitKeyframe,project,calibrationAt,buildCourtTrajectories,courtGaps,pathSegments,smoothCourtTrajectory,validQuad,addCourtAnchor,addEvent} from './court.mjs';
import {courtLandmarks,courtMarkings} from './court-geometry.mjs';
import {normalizeCourtCandidates,acceptCourtCandidates,calibrationGuideState,reorientCalibrationKey,confirmCalibrationProjection,calibrationGeometryFingerprint,invalidateCameraDependents,isHumanCalibrationKey,clearCalibrationProjectionReview,calibrationReviewStates} from './calibration-guide.mjs';
import {REVIEW_COLORS} from './tracking-display.mjs';
import {entityLabel,isHumanIdentitySelected} from './trajectory.mjs';
import {mountWorkbenchShell} from './ui.bundle.mjs';

export function createWorkspace(api){
  const $=id=>document.getElementById(id),{clip,sample,variant,getState,change,seek,toast,isSelected,color}=api;
  const court=$('court'),ctx=court.getContext('2d');
  let step='identity',view='half',pan=0,courtPoints={},pending=null,pointMode=false,transform=null,hits=[],drag=null,lastControlFrame=-1;
  let courtCandidateSettings=clip.courtCandidates||{},courtCandidates=normalizeCourtCandidates(clip.courtCandidates,clip.frames.length),propagating=false,candidateCache=null,candidateValidCount=0;
  let reviewCache=null,reviewStates=[];
  let automaticCalibrating=false,candidateNotice='',previewCandidates=false;
  const state=()=>{const s=getState();return {...s,entity:s.session.entities.find(e=>e.id===s.active)};};
  const reasonLabel={missing:'位置缺失',conflict:'身份冲突',uncalibrated:clip.supportsCourtCalibration===false?'未提供适配场地模板':'球场待标定'};
  const shades={projected:'#1675b6',court_manual:'#6e4fd0',court_estimated:'#b96a09',missing:'#c83d4c',conflict:'#ae385c',uncalibrated:'#a08bd1',out_of_view:'#8c98a8'};
  const time=i=>`${clip.frames[i].time.toFixed(2)} s`;
  const shell=mountWorkbenchShell(api);
  function switchStep(next,scroll=false){
    if(next==='export'){shell.showArea('production');return;}
    const session=getState().session;
    if(['identity','calibration','repair'].includes(next)&&!session.liveSelection){toast('先在第一步保留并确认直播画面。');next='footage';}
    if(next==='calibration'&&clip.supportsCourtCalibration===false){toast('这段 NCAA 示例用于原图位置验收；尚未提供适配的球场模板。');return;}
    step=next;pending=null;pointMode=false;$('repairCourt').setAttribute('aria-pressed','false');
    document.body.dataset.step=step;
    shell.enterVideo(step);
    if(step==='calibration')shell.showArea('video');
    $('openCourtCalibration').hidden=clip.supportsCourtCalibration===false;
    const roster=document.querySelector('.player-overview');
    (step==='repair'?$('repairRoster'):$('identityRoster')).append(roster);
    (step==='repair'?$('repairIdentityControls'):$('identityMain')).append($('identityControls'));
    (step==='repair'?$('repairIdentityControls'):$('identityMain')).append($('playerProfilePanel'));
    $('repairBindingControls').append($('bindingControls'));
    $('overlay').hidden=step==='footage';$('pointStatus').hidden=step==='footage';
    document.querySelectorAll('button[data-step]').forEach(tab=>{const on=tab.dataset.step===step;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;$(`panel-${tab.dataset.step}`).hidden=!on;});
    api.setMode(step==='repair'?'point':'select',{edit:false});
    if(['calibration','repair'].includes(step)&&view==='half'){
      const s=state(),mapping=calibrationAt(s.session.courtCalibration,s.frame,clip.frames,s.session.cuts);
      if(mapping)setPan(mapping.side==='right'?COURT.length/2:0);
    }
    $('videoMode').textContent={footage:'核对直播区间及整体站位',calibration:'核对场地线与参照点',identity:'点击候选人物确认球员 1–10',repair:'核对人物位置与 2D 映射，修正缺口',events:'核对事件发生时刻'}[step];
    $('calibrationHelp').textContent='先在示意图选一个点名，再点原视频中同一个地面交点；看不清可换其他点。';
    api.redraw();
    if(scroll)$('stepPanels').scrollTop=0;
  }
  const tabs=[...document.querySelectorAll('button[data-step]')].filter(tab=>!tab.hidden);
  tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>switchStep(tab.dataset.step));tab.addEventListener('keydown',event=>{let index;if(event.key==='ArrowRight')index=(i+1)%tabs.length;if(event.key==='ArrowLeft')index=(i+tabs.length-1)%tabs.length;if(event.key==='Home')index=0;if(event.key==='End')index=tabs.length-1;if(index!==undefined){event.preventDefault();event.stopPropagation();tabs[index].focus();switchStep(tabs[index].dataset.step);}});});
  function setView(value){view=value;for(const id of ['halfCourt','fullCourt']){const on=id===(view==='half'?'halfCourt':'fullCourt');$(id).classList.toggle('active',on);$(id).setAttribute('aria-pressed',String(on));}for(const id of ['courtPan','panLeft','panRight','followPlayer'])$(id).disabled=view==='full';draw();}
  $('halfCourt').onclick=()=>setView('half');$('fullCourt').onclick=()=>setView('full');
  function setPan(value){pan=Math.max(0,Math.min(COURT.length/2,value));$('courtPan').value=pan/(COURT.length/2)*1000;draw();}
  $('courtPan').oninput=e=>{$('followPlayer').checked=false;setPan(Number(e.target.value)/1000*COURT.length/2);};
  $('panLeft').onclick=()=>{$('followPlayer').checked=false;setPan(0);};$('panRight').onclick=()=>{$('followPlayer').checked=false;setPan(COURT.length/2);};$('followPlayer').onchange=draw;

  $('openCourtCalibration').onclick=()=>switchStep('calibration',true);
  $('returnToRepair').onclick=()=>switchStep('repair',true);
  $('calibrationPlayers').onclick=$('repairPlayers').onclick=()=>switchStep('identity',true);
  $('repairCalibration').onclick=()=>switchStep('calibration',true);
  $('repairCalibration').hidden=clip.supportsCourtCalibration===false;
  $('continueData').onclick=()=>shell.showArea('data');
  $('continueTactics').onclick=()=>shell.showArea('tactics');
  $('repairImage').onclick=()=>{pointMode=false;api.setMode('point');$('repairCourt').setAttribute('aria-pressed','false');$('repairHelp').textContent='在原视频中，点击当前球员脚下。';};
  $('repairCourt').onclick=()=>{if(!isSelected(state().entity)){toast('请先对应当前球员。');return;}if(clip.supportsCourtCalibration===false){toast('本示例尚未提供适配的球场模板，请在原视频补位置。');return;}getState().video.pause();api.setMode('select');pointMode=true;$('repairCourt').setAttribute('aria-pressed','true');$('repairHelp').textContent='在下方 2D 球场点击当前帧的位置；只保存当前帧，可撤销。';shell.openData();toast('在 2D 球场点击当前帧的位置，可撤销。');draw();};
  $('repairIdentity').onclick=()=>{$('bindingControls').open=true;$('bindingControls').scrollIntoView({behavior:'smooth',block:'nearest'});};
  $('startCalibration').onclick=()=>{const s=state();s.video.pause();$('manualCalibration').open=true;pending={frame:s.frame,side:$('calibrationSide').value,image:[],captureRegions:[]};$('calibrationHelp').textContent=`正在标定第 ${s.frame+1} 帧：请在视频中或四周的画外区域标注 ${LANDMARK_NAMES[0]}。`;api.redraw();};
  $('cancelCalibration').onclick=()=>{pending=null;$('calibrationHelp').textContent='已取消本次点选，原标定保留。';api.redraw();};
  const catalog=courtLandmarks();for(const p of catalog){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.id} · ${p.name}`;$('calibrationLandmark').append(option);}
  $('calibrationSide').onchange=()=>{const side=$('calibrationSide').value,key=currentCourtKey();pending=null;$('followPlayer').checked=false;if(key&&key.side!==side){change(()=>storeKey(reorientCalibrationKey(key,side)));$('calibrationHelp').textContent='篮侧已修改，原图参照点坐标保留。请重新核对点名与投影线，再确认预览。';toast('篮侧已保存；本帧映射暂停，等待重新核对。');}setPan(side==='right'?COURT.length/2:0);renderGuide();api.redraw();};
  $('calibrationLandmark').onchange=()=>{pending=null;renderGuide();api.redraw();};
  $('showCourtLines').onchange=()=>api.redraw();
  function currentCourtKey(){
    const s=state(),calibration=s.session.courtCalibration,saved=calibration?.keyframes.find(k=>k.frame===s.frame);
    if(!previewCandidates||(saved&&isHumanCalibrationKey(saved)))return saved;
    const candidate=courtCandidates.find(k=>k.frame===s.frame);
    if(!candidate)return saved;
    const reference=candidate.cameraSupportFrame??candidate.quality?.cameraSupportFrame??candidate.quality?.referenceFrame??courtCandidateSettings.referenceFrame;
    const deleted=calibration?.deletedReferenceFrames||[];
    const savedReference=calibration?.keyframes.find(k=>k.frame===reference),incomingReference=courtCandidates.find(k=>k.frame===reference);
    const changed=reference!==s.frame&&savedReference&&incomingReference&&isHumanCalibrationKey(savedReference)&&calibrationGeometryFingerprint(savedReference)!==calibrationGeometryFingerprint(incomingReference);
    const crossed=Number.isInteger(reference)&&(s.session.cuts||[]).some(c=>c>Math.min(reference,s.frame)&&c<=Math.max(reference,s.frame));
    if(changed||crossed||deleted.includes(s.frame)||deleted.includes(reference))return {...candidate,status:'invalid',points:[],invalidReason:'reference_changed'};
    return candidate;
  }
  function keyAtCurrent(){
    const s=state(),old=currentCourtKey();
    if(old)return {...structuredClone(old),points:structuredClone(keyframePoints(old))};
    const map=calibrationAt(s.session.courtCalibration,s.frame,clip.frames,s.session.cuts);
    return {frame:s.frame,side:map?.side||$('calibrationSide').value,source:'human',points:map?map.image.map((image,i)=>({id:'ABCD'[i],image,source:'interpolated_seed'})):[]};
  }
  const hasSavedCalibration=()=>Boolean(state().session.courtCalibration?.keyframes.some(key=>key.status!=='invalid'&&!key.invalidReason&&fitKeyframe(key)));
  function lineEvidenceText(key){
    if(key?.source==='human'||keyframePoints(key||{}).some(p=>p.source==='human'))return '';
    const quality=key?.quality?.projectedLines||key?.quality?.courtLineFit;
    if(!quality)return '';
    const supported=quality.supportedFamilies?.length,visible=quality.visibleFamilies?.length;
    const families=Number.isInteger(supported)?`线缘支持 ${supported}/${Number.isInteger(visible)?visible:'?'} 组`:'';
    const residual=Number.isFinite(quality.medianResidualPixels)?`中位边缘距 ${quality.medianResidualPixels.toFixed(1)} px`:'';
    const bounds=quality.visibleCourtBoundsMeters;
    const range=Array.isArray(bounds)&&bounds.length===4&&bounds.every(Number.isFinite)?`模板线范围 x ${bounds[0].toFixed(1)}–${bounds[2].toFixed(1)} m · y ${bounds[1].toFixed(1)}–${bounds[3].toFixed(1)} m`:'';
    const uncertainty=quality.uncertaintyHint==='insufficient_line_evidence'?'线缘证据不足，误差未定':'';
    const temporal=key?.quality?.temporalLineFit;
    const joint=temporal?.refinementApplied?`${temporal.sourceFrames.length} 帧联合标线拟合 · BC 与远边线有线段支持`:temporal?.sourceFrames?.length?'多帧线证据未通过，保留初始候选':'';
    const near=key?.quality?.lineVisibility?.near_sideline;
    const hidden=near?.status==='inferred'?'近边线为几何推算；G/H 无需强行补点，优先核对可见线段':'';
    const detail=[joint,hidden,families,residual,range,uncertainty].filter(Boolean).join(' · ');
    return detail?` · ${detail}（启发式，不是精度）`:'';
  }
  function storeKey(key){const s=state();s.session.courtCalibration||={template:'NBA',videoHash:clip.video_sha256,maxKeyframeGapSeconds:1.2,keyframes:[]};const calibration=s.session.courtCalibration,previous=calibration.keyframes.find(k=>k.frame===key.frame);if(!previous||calibrationGeometryFingerprint(previous)!==calibrationGeometryFingerprint(key)){invalidateCameraDependents(calibration,key.frame);if(previous)key=clearCalibrationProjectionReview(key);}if(key.status==='needs_review')key=clearCalibrationProjectionReview(key);if(isHumanCalibrationKey(key))calibration.deletedReferenceFrames=(calibration.deletedReferenceFrames||[]).filter(frame=>frame!==key.frame);calibration.keyframes=calibration.keyframes.filter(k=>k.frame!==key.frame);calibration.keyframes.push(key);}
  $('pickLandmark').onclick=()=>{const s=state();s.video.pause();$('manualCalibration').open=true;pending={kind:'single',frame:s.frame,side:$('calibrationSide').value,id:$('calibrationLandmark').value,image:[]};$('calibrationHelp').textContent=`请在视频中或画外标点区点击 ${$('calibrationLandmark').selectedOptions[0].textContent}。只替换这个点；其他参照点保留。`;renderGuide();api.redraw();};
  $('restoreCalibration').disabled=!clip.courtCalibration;
  $('restoreCalibration').onclick=()=>change(()=>{const s=state(),previous=s.session.courtCalibration,
    human=(previous?.keyframes||[]).filter(isHumanCalibrationKey),
    baseline=structuredClone(clip.courtCalibration);
    s.session.courtCalibration={...baseline,keyframes:human,deletedReferenceFrames:[...(previous?.deletedReferenceFrames||[])]};
    acceptCourtCandidates(s.session,baseline,clip.frames.length,clip.video_sha256);
  });
  $('guideNext').onclick=()=>{$('calibrationLandmark').value=calibrationGuideState(keyAtCurrent(),$('calibrationLandmark').value).nextId;$('pickLandmark').click();renderGuide();};
  $('confirmCalibration').onclick=()=>{let key=keyAtCurrent();if(!fitKeyframe(key)){toast('需要至少 4 个有效且不共线的地面参照点。');return;}key=confirmCalibrationProjection(key,state().frame,new Date().toISOString());pending=null;change(()=>storeKey(key));if(view==='half')setPan(key.side==='right'?COURT.length/2:0);shell.openData();$('calibrationPreviewStatus').textContent='已接通当前帧原图脚点 → 2D。镜头运动需要继续生成或补充标定，位置精度仍待核对。';toast('当前帧已可预览 2D 位置，仍保留精度待核对状态。');};
  $('loadCourtCandidate').onclick=()=>{candidateNotice='';previewCandidates=true;const s=state(),candidate=currentCourtKey();if(!candidate||candidate.status==='invalid'){toast('当前帧没有可用候选，请换到候选帧或人工点选。');api.redraw();return;}const old=s.session.courtCalibration?.keyframes.find(key=>key.frame===s.frame);if(old&&isHumanCalibrationKey(old)){toast('当前帧已有人工参照点，已保留；可逐点修正或用它生成镜头跟随候选。');return;}pending=null;change(()=>storeKey(structuredClone(candidate)));if(view==='half')setPan(candidate.side==='right'?COURT.length/2:0);$('calibrationHelp').textContent='候选已显示在原图。播放视频核对多条投影线，有偏差时可逐点修正。';};
  const referenceFrame=()=>{const frame=courtCandidateSettings.referenceFrame??clip.courtCandidates?.referenceFrame??clip.referenceFrame;return Number.isInteger(frame)&&frame>=0&&frame<clip.frames.length?frame:null;};
  $('autoCalibrateCourt').onclick=async()=>{
    if(propagating)return;
    const s=state(),cuts=structuredClone(s.session.cuts||[]),requestedFrame=s.frame;
    s.video.pause();pending=null;propagating=true;automaticCalibrating=true;candidateNotice='';renderGuide();
    try{
      const response=await fetch('/api/court-calibrate',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sample,variant,frame:requestedFrame,cuts,propagate:true,qa:new URLSearchParams(location.search).has('qa')})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||'自动标定失败，请人工点选。');
      if(JSON.stringify(state().session.cuts||[])!==JSON.stringify(cuts))throw new Error('处理期间切镜位置已改变，请重新生成候选。');
      const settings=body.courtCandidates||body,proposals=normalizeCourtCandidates(settings,clip.frames.length);
      if(!proposals.some(key=>key.status!=='invalid'&&fitKeyframe(key)))throw new Error('这帧未能自动确定场地。请换到球场线更清楚的一帧重试，或在上方人工补点。');
      courtCandidateSettings=settings;courtCandidates=proposals;previewCandidates=true;
      const current=state(),candidate=proposals.find(key=>key.frame===current.frame&&key.status!=='invalid'),old=current.session.courtCalibration?.keyframes.find(key=>key.frame===current.frame);
      if(candidate&&(!old||!isHumanCalibrationKey(old))){
        change(()=>storeKey(structuredClone(candidate)));
        if(view==='half')setPan(candidate.side==='right'?COURT.length/2:0);
      }
      $('calibrationHelp').textContent='自动点位已生成，请检查原图投影线。已有人工标定保留；有偏差时可逐点修正。';
      toast('本地自动标定完成；候选待核对，已有人工标定保留。');
    }catch(error){candidateNotice=`自动标定未完成：${error.message}`;$('manualCalibration').open=true;toast(candidateNotice);}
    finally{propagating=false;automaticCalibrating=false;renderGuide();api.redraw();}
  };
  $('jumpCourtReference').onclick=()=>{const frame=referenceFrame();if(frame===null)return;seek(frame);if(!$('loadCourtCandidate').disabled)$('loadCourtCandidate').click();else toast('已定位参考帧，可检查已有标定或人工补选参照点。');};
  $('acceptCourtCandidates').onclick=()=>{if(propagating||pending)return;if(!previewCandidates&&hasSavedCalibration()){switchStep('repair',true);return;}if(!courtCandidates.length)return;candidateNotice='';let result;change(()=>{result=acceptCourtCandidates(state().session,{...courtCandidateSettings,keyframes:courtCandidates},clip.frames.length,clip.video_sha256);});previewCandidates=false;toast(`已采用 ${result.accepted} 帧待复核映射，保留 ${result.preserved} 帧人工标定，${result.invalid} 帧失败留空。`);const current=state().session.courtCalibration.keyframes.find(k=>k.frame===state().frame);if(current&&view==='half')setPan(current.side==='right'?COURT.length/2:0);$('calibrationPreviewStatus').textContent='已采用，仍可返回核对和修正。';switchStep('repair',true);};
  $('propagateCalibration').onclick=async()=>{
    if(propagating)return;
    const s=state(),cuts=structuredClone(s.session.cuts||[]);let seed=keyAtCurrent();
    if(!fitKeyframe(seed)){toast('请先选好至少 4 个有效的地面点，再确认修正。');return;}
    // This explicitly labelled action confirms this reference frame only.
    seed=confirmCalibrationProjection(seed,s.frame,new Date().toISOString());
    pending=null;s.video.pause();change(()=>storeKey(seed));
    const referenceFingerprint=calibrationGeometryFingerprint(seed);
    candidateNotice='';propagating=true;renderGuide();
    try{
      const response=await fetch('/api/court-propagate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sample,variant,seed,cuts,qa:new URLSearchParams(location.search).has('qa')})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||'镜头跟随失败。');
      const current=state(),reference=current.session.courtCalibration?.keyframes.find(k=>k.frame===seed.frame);
      if(JSON.stringify(current.session.cuts||[])!==JSON.stringify(cuts)||!reference||calibrationGeometryFingerprint(reference)!==referenceFingerprint)throw new Error('处理期间参照点或切镜已改变，请按当前修正重新生成。');
      const settings=body.courtCandidates||body,proposals=normalizeCourtCandidates(settings,clip.frames.length);
      if(!proposals.some(k=>k.status!=='invalid'&&fitKeyframe(k)))throw new Error('当前镜头没有可用结果，请换参考帧或继续人工修正。');
      courtCandidateSettings=settings;courtCandidates=proposals;previewCandidates=true;
      $('manualCalibration').open=false;toast('修正已用于镜头跟随，请播放视频核对后采用。');
    }catch(error){candidateNotice=`镜头跟随未完成：${error.message}`;$('manualCalibration').open=true;toast(candidateNotice);}
    finally{propagating=false;renderControls();api.redraw();}
  };
  function renderGuide(){
    const s=state(),key=currentCourtKey(),id=pending?.id||(pending?.image?'ABCD'[pending.image.length]:null)||$('calibrationLandmark').value||'A';
    const guide=calibrationGuideState(key,id),side=pending?.side||key?.side||$('calibrationSide').value;
    $('guideInstruction').textContent=`${guide.count} 个已选参照点 · 当前 ${guide.id}：${guide.name}。${guide.hint} ${guide.ready?'已可检查投影线。':'至少需要 4 个不共线点。'}`;
    $('confirmCalibration').disabled=propagating||!guide.ready||Boolean(pending);$('propagateCalibration').disabled=propagating||!guide.ready||Boolean(pending);
    $('cancelCalibration').hidden=!pending;
    $('propagateCalibration').textContent=propagating&&!automaticCalibrating?'正在按修正跟随镜头…':'确认修正并跟随镜头';
    $('autoCalibrateCourt').disabled=propagating||clip.supportsCourtCalibration===false;
    $('autoCalibrateCourt').textContent=automaticCalibrating?'正在标定本镜头…':'自动标定本镜头';
    $('guideLandmarks').replaceChildren();
    for(const landmark of courtLandmarks(side)){const button=document.createElement('button');button.textContent=landmark.id;button.title=landmark.name;button.setAttribute('aria-label',`选择参照点 ${landmark.id} ${landmark.name}`);button.setAttribute('aria-pressed',String(landmark.id===id));button.className=landmark.id===id?'active':'';button.onclick=()=>{$('calibrationLandmark').value=landmark.id;$('pickLandmark').click();renderGuide();};$('guideLandmarks').append(button);}
    if(candidateCache!==courtCandidates){candidateCache=courtCandidates;candidateValidCount=courtCandidates.filter(k=>k.status!=='invalid'&&fitKeyframe(k)).length;}const candidate=courtCandidates.find(k=>k.frame===s.frame);
    const savedReady=!previewCandidates&&hasSavedCalibration();
    $('loadCourtCandidate').disabled=!candidate||candidate.status==='invalid';$('acceptCourtCandidates').disabled=(!candidateValidCount&&!savedReady)||propagating||Boolean(pending);
    $('acceptCourtCandidates').textContent=savedReady?'查看已保存的 2D':'采用结果并进入 2D';
    const reference=referenceFrame(),referenceKey=courtCandidates.find(k=>k.frame===reference),referenceSource=courtCandidateSettings.referenceSource||referenceKey?.source;
    $('jumpCourtReference').disabled=reference===null||propagating;$('jumpCourtReference').textContent=reference===null?'尚无参考帧':`跳到参考帧（第 ${reference+1} 帧）`;
    const referenceNote=[courtCandidateSettings.referenceDescription,...(courtCandidateSettings.notes||[]).slice(0,1)].filter(Boolean).join(' ');
    $('candidateReferenceDescription').textContent=(referenceSource==='human_visual_reference'?'AI 目视参考，尚未由用户确认。 ':'')+referenceNote;
    $('candidateReferenceDescription').hidden=!$('candidateReferenceDescription').textContent;
    $('candidateStatus').textContent=propagating?(automaticCalibrating?'正在运行本地场地点模型与标线拟合，生成当前镜头候选…':'正在从已核对的标定生成镜头跟随候选…'):candidateNotice||(courtCandidates.length?`${candidateValidCount} 帧可用候选 / ${courtCandidates.length} 帧。当前帧：${candidate?candidate.status==='invalid'?'无效，保持留空':`待核对 ${candidate.source}${candidate.quality?.reason?` · ${candidate.quality.reason}`:''}${Number.isFinite(candidate.quality?.inlierRatio)?` · 地面匹配内点 ${Math.round(candidate.quality.inlierRatio*100)}%`:''}${Number.isFinite(candidate.quality?.medianResidualPixels)?` · 匹配残差 ${candidate.quality.medianResidualPixels.toFixed(1)} px（非地面精度）`:''}${lineEvidenceText(candidate)}`:'暂无候选'}。`:'尚无自动场地候选。可点击自动识别，或先人工标定再跟随镜头。');
    $('calibrationFlowStatus').textContent=propagating?'正在处理当前镜头，请稍候…':candidateNotice||(
      pending?'请在原视频中点选地面交点。':key?.status==='invalid'?'当前帧无法映射，请换清楚的帧或展开人工修正。':
      key&&isHumanCalibrationKey(key)?'当前帧的人工标定已保留。修正后可跟随镜头，或查看已有 2D。':
      previewCandidates&&candidateValidCount?`${candidateValidCount} 帧已生成，继续核对画面。`:
      savedReady?'已有保存的标定，可查看 2D 或重新自动标定。':
      candidateValidCount?'已有历史候选；可重新自动标定，或在详情中载入检查。':'点击自动标定开始；也可以直接展开人工选点。');
    const diagram=$('calibrationDiagram'),context=diagram.getContext('2d'),w=diagram.width,h=diagram.height,margin=28,scale=Math.min((w-2*margin)/(COURT.length/2),(h-2*margin)/COURT.width),start=side==='right'?COURT.length/2:0;
    const toScreen=(x,y)=>[margin+(x-start)*scale,margin+y*scale];context.clearRect(0,0,w,h);context.fillStyle='#f0dfbf';context.fillRect(margin,margin,COURT.length/2*scale,COURT.width*scale);context.save();context.beginPath();context.rect(margin-3,margin-3,COURT.length/2*scale+6,COURT.width*scale+6);context.clip();
    for(const line of courtMarkings()){context.beginPath();line.points.forEach((point,index)=>{const p=toScreen(...point);index?context.lineTo(...p):context.moveTo(...p);});context.strokeStyle=line.color;context.lineWidth=1.5;context.stroke();}
    context.restore();context.fillStyle='#546275';context.font='11px sans-serif';context.fillText('远侧边线（示意图上边）',margin,14);context.fillText('近侧边线（示意图下边）',margin,h-5);
    for(const landmark of courtLandmarks(side)){const[x,y]=toScreen(landmark.x,landmark.y),selected=landmark.id===id,done=keyframePoints(key||{}).some(p=>p.id===landmark.id&&p.enabled!==false);context.beginPath();context.arc(x,y,selected?9:6,0,Math.PI*2);context.fillStyle=selected?'#c75632':done?'#4d8677':'#fff';context.fill();context.strokeStyle='#67707a';context.stroke();context.fillStyle=selected||done?'#fff':'#27384b';context.font='bold 11px sans-serif';context.fillText(landmark.id,x-4,y+4);}
  }
  $('addEvent').onclick=()=>{const s=state();if(!isSelected(s.entity)){toast('请先选定球员，再标注事件。');return;}change(()=>addEvent(s.entity,s.frame,$('eventType').value,$('eventNote').value,clip.frames));$('eventNote').value='';toast(`${entityLabel(s.active)} 已添加 ${time(s.frame)} 的人工事件。`);};
  function row(label,jump,remove,aria){const el=document.createElement('div');el.className='anchor';const b=document.createElement('button');b.textContent=label;b.onclick=jump;const d=document.createElement('button');d.textContent='删除';d.setAttribute('aria-label',aria);d.onclick=remove;el.append(b,d);return el;}
  function renderControls(){
    const s=state(),key=currentCourtKey(),map=calibrationAt(s.session.courtCalibration,s.frame,clip.frames,s.session.cuts);lastControlFrame=s.frame;
    if(key)$('calibrationSide').value=key.side;
    renderGuide();
    $('controlPointList').replaceChildren();$('checkQuality').textContent='核验点不参与拟合。请留出额外可见交点，检查它被还原后的偏差。';
    if(!key){$('calibrationQuality').textContent=map?'当前帧是关键帧间的估计。重选一点会建立本帧标定，其余四角先保留为待复核的估计。':'当前帧没有有效标定。可逐个添加参照点，至少需要 4 个不共线的点。';return;}
    const fit=fitKeyframe(key),points=keyframePoints(key);
    const offscreenCount=points.filter(point=>point.captureRegion==='outside_frame').length;
    $('calibrationQuality').textContent=fit?`${key.invalidReason==='reference_changed'?'参考帧已修改，需重新生成 · ':key.status==='needs_review'?'待核对投影 · ':''}${fit.points.length} 个有效参照点 · 拟合残差 ${fit.fitRmsePixels.toFixed(1)} px（用于拟合的点，非独立准确率）。${lineEvidenceText(key)}${offscreenCount?`其中 ${offscreenCount} 个是画外估计点，建议用可见交点核验。`:''}请核对整条边线、三分弧和中线。`:'参照点不足或布局退化，暂停球场映射；请补至少 4 个不共线点。';
    if(fit?.checkResiduals.length)$('checkQuality').textContent=fit.checkResiduals.map(r=>{const point=points.find(p=>p.id===r.id),propagated=(point?.source||key.source)==='camera_propagation';return `${propagated?'传播参照偏差，非本帧独立核验':'留出核验'}：${r.id} 偏差 ${r.pixels?.toFixed(1)??'不可解'} px / ${r.metres?.toFixed(2)??'不可解'} 米`;}).join('；')+'。这些偏差不代表整段精度。';
    for(const p of points){
      const name=courtLandmarks(key.side).find(c=>c.id===p.id)?.name||p.id,err=fit?.residuals.find(r=>r.id===p.id)?.pixels;
      const el=row(`${p.id} · ${name} · ${p.captureRegion==='outside_frame'?'画外估计 · ':''}${p.role==='check'?'核验 / ':''}${p.source==='human'?'人工':'待复核'}${err==null?'':` · ${err.toFixed(1)} px`}`,()=>{$('calibrationLandmark').value=p.id;$('pickLandmark').click();},()=>change(()=>{const next=keyAtCurrent();next.points=next.points.filter(x=>x.id!==p.id);next.source='human';next.status='needs_review';delete next.image;storeKey(next);}),`删除参照点 ${p.id}`);
      const role=document.createElement('button');role.textContent=p.role==='check'?'改为标定':'仅作核验';role.setAttribute('aria-label',`参照点 ${p.id} ${p.role==='check'?'改为标定':'仅作核验'}`);role.onclick=()=>change(()=>{const next=keyAtCurrent();next.points.find(x=>x.id===p.id).role=p.role==='check'?'control':'check';next.source='human';next.status='needs_review';delete next.image;storeKey(next);});el.insertBefore(role,el.lastChild);
      const enable=document.createElement('input');enable.type='checkbox';enable.checked=p.enabled!==false;enable.setAttribute('aria-label',`启用参照点 ${p.id}`);enable.onchange=()=>change(()=>{const next=keyAtCurrent();next.points.find(x=>x.id===p.id).enabled=enable.checked;next.source='human';next.status='needs_review';delete next.image;storeKey(next);});el.prepend(enable);$('controlPointList').append(el);
    }
  }
  function refresh(){
    const s=state();courtPoints=buildCourtTrajectories(s.session,clip.frames,s.trajectories);const points=courtPoints[s.active]||[],selected=isSelected(s.entity),gaps=selected?courtGaps(points):[];
    $('playerHeading').textContent=`${entityLabel(s.active)}${s.entity.name!==entityLabel(s.active)?` · ${s.entity.name}`:''}`;
    $('playerIdentity').textContent=[s.entity.team||'球队待填写',s.entity.jersey?`#${s.entity.jersey}`:'号码待填写'].join(' · ');

    $('mappedCount').textContent=points.filter(p=>p.x!==null).length;$('gapCount').textContent=gaps.length;$('eventCount').textContent=(s.entity.events||[]).length;
    $('gapList').replaceChildren();
    if(!selected)$('gapList').textContent='在「球员身份」中点击原视频的人物，开始整理轨迹。';
    else if(!gaps.length)$('gapList').textContent='没有未解决的位置区间；已有坐标仍可继续复核。';
    for(const gap of gaps){const b=document.createElement('button');b.className=`gap-item ${gap.reason}`;b.textContent=`${time(gap.start)}–${time(gap.end)} · ${reasonLabel[gap.reason]} (${gap.end-gap.start+1} 帧) →`;b.onclick=()=>{seek(gap.start);switchStep(gap.reason==='uncalibrated'?(clip.supportsCourtCalibration===false?'identity':'calibration'):gap.reason==='conflict'?'identity':'repair',true);};$('gapList').append(b);}
    $('calibrationList').replaceChildren();for(const k of [...(s.session.courtCalibration?.keyframes||[])].sort((a,b)=>a.frame-b.frame))$('calibrationList').append(row(`${time(k.frame)} · ${k.status==='invalid'?'无效':k.status==='needs_review'?'待核对':k.source==='human'?'人工':'参考映射'} · ${keyframePoints(k).filter(p=>p.enabled!==false).length} 点`,()=>seek(k.frame),()=>change(()=>{invalidateCameraDependents(s.session.courtCalibration,k.frame,{referenceDeleted:true});s.session.courtCalibration.keyframes=s.session.courtCalibration.keyframes.filter(x=>x.frame!==k.frame);}),`删除第 ${k.frame+1} 帧标定`));
    renderControls();
    $('courtAnchorList').replaceChildren();for(const a of [...(s.entity.courtAnchors||[])].sort((a,b)=>a.frame-b.frame))$('courtAnchorList').append(row(`${time(a.frame)} · 球场补点`,()=>seek(a.frame),()=>change(()=>s.entity.courtAnchors=s.entity.courtAnchors.filter(x=>x.frame!==a.frame)),`删除第 ${a.frame+1} 帧球场补点`));
    $('eventList').replaceChildren();for(const e of [...(s.entity.events||[])].sort((a,b)=>a.frame-b.frame)){
      const el=row(`${time(e.frame)} · ${e.type}`,()=>seek(e.frame),()=>change(()=>s.entity.events=s.entity.events.filter(x=>x.id!==e.id)),`删除事件 ${e.type} ${time(e.frame)}`);const note=document.createElement('p');note.className='small muted';note.textContent=e.note||'人工事件';$('eventList').append(el,note);
    }
    const chosen=s.session.entities.filter(isSelected),allGaps=chosen.reduce((n,e)=>n+courtGaps(courtPoints[e.id]).length,0);
    $('exportSummary').textContent=`${chosen.filter(isHumanIdentitySelected).length} 个人工确认目标 · ${chosen.filter(e=>!isHumanIdentitySelected(e)).length} 个待确认目标 · ${allGaps} 段待处理 · ${chosen.reduce((n,e)=>n+(e.events||[]).length,0)} 个事件。缺失会原样保留，模型建议与估计点会附带待复核标记。`;
    draw();
  }
  function draw(){
    const s=state(),points=courtPoints[s.active]||[],displayPoints=$('smoothCourtPath').checked?smoothCourtTrajectory(points,s.session.cuts):points,
      current=points[s.frame],displayCurrent=displayPoints[s.frame],mapping=calibrationAt(s.session.courtCalibration,s.frame,clip.frames,s.session.cuts);
    const players=s.session.entities.filter(isSelected).filter(e=>e.role==='player'),humanPlayers=players.filter(isHumanIdentitySelected);
    const mappedNow=players.filter(e=>courtPoints[e.id]?.[s.frame]?.x!=null).length;
    $('workflowPlayers').textContent=`球员标定：人工关联 ${humanPlayers.length} / 10 人`;
    $('workflowCourt').textContent=clip.supportsCourtCalibration===false?'球场标定：此素材尚无适配模板':`球场标定：第 ${s.frame+1} 帧${mapping?'有可用映射':'待标定'}`;
    $('workflowMapping').textContent=`当前帧 ${mappedNow} 名球员有 2D 位置。${mappedNow?'请对照原视频核对，已有位置不代表人工审核通过。':'补齐人物位置和球场映射后会自动显示；缺失位置留空。'}`;
    shell.refresh();
    drawTimeline(points,s);
    if(lastControlFrame!==s.frame)renderControls();else if(step==='calibration')renderGuide();
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
    for(const segment of pathSegments(displayPoints,s.session.cuts))for(let i=1;i<segment.length;i++){
      const a=segment[i-1],b=segment[i];
      ctx.strokeStyle=b.source==='court_estimated'||a.source==='court_estimated'?shades.court_estimated:shades.projected;ctx.globalAlpha=b.frame > s.frame ? 0.40 : 0.95;ctx.lineWidth=2.5;ctx.setLineDash(b.source==='court_estimated'||a.source==='court_estimated'?[4,4]:[]);line(a.x,a.y,b.x,b.y);
    }ctx.globalAlpha=1;ctx.setLineDash([]);
    for(const p of displayPoints)if(p.x!==null){const[x,y]=screen(p.x,p.y);if(p.x>=start&&p.x<=start+span&&p.y>=0&&p.y<=COURT.width)hits.push({x,y,frame:p.frame,id:s.active,kind:'trail'});if(p.source==='court_manual'){ctx.fillStyle=shades.court_manual;ctx.fillRect(x-4,y-4,8,8);}}
    for(const gap of isSelected(s.entity)?courtGaps(points):[]){
      const endpoints=[points[gap.start-1],points[gap.end+1]].filter(p=>p?.x!=null);ctx.strokeStyle=shades[gap.reason];ctx.lineWidth=2;
      endpoints.forEach((p,i)=>{const[x,y]=screen(p.x,p.y);ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.stroke();if(i===0){ctx.fillStyle='#a52f42';ctx.font='11px sans-serif';ctx.fillText(`${time(gap.start)} 缺口`,x+10,y-10);}if(p.x>=start&&p.x<=start+span)hits.push({x,y,frame:gap.start,id:s.active,kind:'gap',reason:gap.reason});});
    }
    for(const e of s.entity.events||[]){const p=displayPoints[e.frame];if(p?.x==null)continue;const[x,y]=screen(p.x,p.y);ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);ctx.fillStyle='#f2d58c';ctx.fillRect(-5,-5,10,10);ctx.restore();ctx.fillStyle='#f2d58c';ctx.font='11px sans-serif';ctx.fillText(e.type,x+9,y+14);if(p.x>=start&&p.x<=start+span)hits.push({x,y,frame:e.frame,id:s.active,kind:'event'});}
    for(const entity of s.session.entities){if(!isSelected(entity))continue;const p=entity.id===s.active?displayCurrent:courtPoints[entity.id]?.[s.frame];if(p?.x==null)continue;const[x,y]=screen(p.x,p.y),selected=entity.id===s.active,tentative=s.trajectories[entity.id]?.[s.frame]?.frameIdentityConfirmed!==true;ctx.beginPath();ctx.arc(x,y,selected?13:10,0,Math.PI*2);ctx.fillStyle=color(entity.id);ctx.fill();ctx.strokeStyle=selected?'#fff':'#12363a';ctx.lineWidth=selected?3:1.5;ctx.setLineDash(tentative?[3,2]:[]);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#09272d';ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.fillText(entity.role==='player'?entity.id.slice(1):entity.id,x,y+3);ctx.textAlign='left';if(p.x>=start&&p.x<=start+span&&p.y>=0&&p.y<=COURT.width)hits.push({x,y,frame:s.frame,id:entity.id,kind:'player'});}
    if(step==='calibration')courtLandmarks(pending?.side||$('calibrationSide').value).forEach(({x,y,id})=>{const[a,b]=screen(x,y);ctx.fillStyle=id===(pending?.id||(pending?.image?'ABCD'[pending.image.length]:$('calibrationLandmark').value))?'#d44331':'#fff8e8';ctx.beginPath();ctx.arc(a,b,9,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#796548';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle=id===(pending?.id||(pending?.image?'ABCD'[pending.image.length]:$('calibrationLandmark').value))?'white':'#183739';ctx.font='bold 11px sans-serif';ctx.fillText(id,a-4,b+4);});
    ctx.restore();
    ctx.fillStyle='#766c5e';ctx.font='11px sans-serif';ctx.fillText(view==='half'?'半场窗口 14.33 × 15.24 m · 可横向滑动':'全场 28.65 × 15.24 m',20,h-12);
    const courtReview=reviewStates[s.frame];
    $('courtBadge').textContent=clip.supportsCourtCalibration===false?'仅原图位置验收':courtReview?.label||'当前帧待标定';
    $('courtBadge').dataset.review=courtReview?.status||'empty';
    $('courtEmpty').hidden=isSelected(s.entity)&&points.some(p=>p.x!==null);
    $('courtEmpty').textContent=clip.supportsCourtCalibration===false?'本示例未提供适配的球场模板，请修改原图位置。':isSelected(s.entity)?'暂无可用球场轨迹 · 先校准球场，或人工补球场点':'先选择球员，再查看他的轨迹';
    $('courtPointStatus').textContent=current?.x!=null?`当前：${current.source==='court_manual'?'人工球场补点':current.source==='court_estimated'?'前后位置估计后映射':'原图位置映射'}${current.outsideCourt?' · 投影落在界外，请核对脚点 / 标定':''}。坐标精度待复核。`:isSelected(s.entity)?`当前：${reasonLabel[current?.source]||'已确认离开画面'}。没有可用位置时不显示球员圆点。`:'当前目标尚未选定。';
    if($('smoothCourtPath').checked&&displayCurrent?.displaySmoothed)$('courtPointStatus').textContent+=' 当前轨迹仅在显示层做了前后各 2 帧的中值平滑；原始点和导出坐标不变。';
    const inspector=$('coordinateInspector'),imagePoint=s.trajectories[s.active]?.[s.frame];inspector.replaceChildren();inspector.hidden=!isSelected(s.entity)||current?.x==null;
    if(!inspector.hidden){
      const origin={bbox_bottom_center:'人物框底边中心（近似）',human_image_anchor:'人工原图补点',interpolated_image_point:'前后原图点估计',human_court_anchor:'人工球场补点',pose_candidate_human_adopted:'人工采用脚部模型候选（接地未验证）'};
      const lines=[`原图：${imagePoint?.x!=null?`${imagePoint.x.toFixed(1)}, ${imagePoint.y.toFixed(1)} px`:'无可用点'} → 球场：${current.x.toFixed(2)}, ${current.y.toFixed(2)} 米`,`位置来源：${origin[current.footMethod]||'待核对'}`];
      if(current.calibrationSupport)lines.push(current.calibrationSupport==='outside_controls'?'位于标定点包围范围外，建议补附近参照。':'位于标定点包围范围内，仍需核验。');
      if(current.sensitivity)lines.push(`误差示例：脚点偏 5 px，局部可偏约 ${current.sensitivity.approxMaxMetres.toFixed(2)} 米；不含标定误差。`);
      for(const text of lines){const p=document.createElement('p');p.textContent=text;inspector.append(p);}
    }
  }
  function drawTimeline(points,s){
    const inputs=[s.session.courtCalibration?.keyframes,s.session.courtCalibration?.deletedReferenceFrames,courtCandidates,s.session.cuts];
    if(!reviewCache||inputs.some((value,index)=>value!==reviewCache[index])){reviewCache=inputs;reviewStates=calibrationReviewStates(s.session.courtCalibration,courtCandidates,clip.frames,s.session.cuts);}
    const target=$('courtTimeline'),c=target.getContext('2d'),dpr=devicePixelRatio||1,count=clip.frames.length;
    target.width=Math.round(target.clientWidth*dpr);target.height=24*dpr;c.clearRect(0,0,target.width,target.height);
    reviewStates.forEach((review,index)=>{c.fillStyle=REVIEW_COLORS[review.status];c.fillRect(index/count*target.width,3*dpr,target.width/count+1,18*dpr);});
    for(const cut of s.session.cuts){c.fillStyle='#122034';c.fillRect(cut/count*target.width,0,2*dpr,target.height);}
    c.fillStyle='#111d2a';c.fillRect(s.frame/count*target.width,0,2*dpr,target.height);
    const review=reviewStates[s.frame]||{status:'empty',label:'尚无标定结果'},badge=$('calibrationReviewStatus');
    badge.dataset.review=review.status;badge.textContent=`标定：${clip.supportsCourtCalibration===false?'暂无适配模板':review.label}`;
    const confirmed=reviewStates.filter(item=>item.status==='human').length,machine=reviewStates.filter(item=>item.status==='machine').length;
    target.title=`第 ${s.frame+1} 帧 · ${review.label}。机器结果待确认 ${machine} 帧 · 人工确认 ${confirmed} / ${count} 帧。`;
    target.setAttribute('aria-valuenow',String(s.frame+1));target.setAttribute('aria-valuemax',String(count));target.setAttribute('aria-valuetext',target.title);
    $('calibrationReviewCount').textContent=`标定人工确认 ${confirmed} / ${count} 帧`;
  }
  $('courtTimeline').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();seek(Math.floor((e.clientX-r.left)/r.width*clip.frames.length));};
  $('smoothCourtPath').onchange=draw;
  for(const id of ['courtTimeline','timeline'])$(id).addEventListener('keydown',event=>{const current=state().frame;const target={ArrowLeft:current-1,ArrowRight:current+1,Home:0,End:clip.frames.length-1}[event.key];if(target!==undefined){event.preventDefault();event.stopPropagation();seek(target);}});
  function clickCourt(event){if(!transform)return;const s=state(),r=court.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top;
    if(pointMode){if(s.trajectories[s.active][s.frame].reviewExcluded){toast('这一段已取消关联；请先在原视频重新关联人物，再补球场位置。');return;}if(['conflict','out_of_view'].includes(s.trajectories[s.active][s.frame].source)){toast('请先解决身份冲突或修改出画区间，再补位置。');return;}const xx=(x-transform.ox)/transform.scale+transform.start,yy=(y-transform.oy)/transform.scale;try{change(()=>addCourtAnchor(s.entity,s.frame,xx,yy));pointMode=false;$('repairCourt').setAttribute('aria-pressed','false');$('repairHelp').textContent='已保存当前帧的人工球场点。可删除或撤销。';toast(`${entityLabel(s.active)} 已补当前帧球场位置。`);}catch(error){toast(error.message);}return;}
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
        const previous=next.points.find(p=>p.id===pending.id),role=previous?.role||'control',outside=x<0||x>clip.width||y<0||y>clip.height;next.side=pending.side;next.source='human';next.status='needs_review';next.points=next.points.filter(p=>p.id!==pending.id);next.points.push({id:pending.id,image:[x,y],source:'human',enabled:true,role,...(outside?{captureRegion:'outside_frame'}:{})});delete next.image;pending=null;change(()=>storeKey(next));$('calibrationHelp').textContent=outside?'这个画外参照点已保存为估计位置。请用其余可见交点检查投影线。':'这个参照点已更新。可继续重选其他点，或撤销；请用反投影场地线核对。';return true;
      }
      pending.image.push([x,y]);pending.captureRegions.push(x<0||x>clip.width||y<0||y>clip.height?'outside_frame':'video_frame');
      if(pending.image.length===4){if(!validQuad(pending.image)){pending.image=[];pending.captureRegions=[];$('calibrationHelp').textContent='四点顺序交叉或过于接近，请重新按 A → B → C → D 点选。';api.redraw();return true;}const k={frame:pending.frame,side:pending.side,source:'human',status:'needs_review',points:pending.image.map((image,index)=>({id:'ABCD'[index],image,source:'human',...(pending.captureRegions[index]==='outside_frame'?{captureRegion:'outside_frame'}:{})}))};pending=null;change(()=>storeKey(k));$('calibrationHelp').textContent=`第 ${k.frame+1} 帧四角已保存。请播放检查投影；画外点是估计位置，建议用可见交点复核。`;toast('当前帧标定已保存，可撤销。');}
      else{$('calibrationHelp').textContent=`请点击 ${LANDMARK_NAMES[pending.image.length]}`;api.redraw();}return true;
    }
    if(step==='events'){toast('当前步骤用于核对画面；修改位置请进入“2D 轨迹核对”。');return true;}
    return false;
  }
  function drawImageOverlay(context){
    if(step!=='calibration')return;const s=state(),key=currentCourtKey(),fit=key?.status!=='invalid'&&!key?.invalidReason&&key&&fitKeyframe(key),map=key?(fit?{toImage:fit.toImage}:null):calibrationAt(s.session.courtCalibration,s.frame,clip.frames,s.session.cuts);
    const manual=key?.source==='human'||keyframePoints(key||{}).some(p=>p.source==='human');
    const evidence=manual?null:key?.quality;
    if(map&&$('showCourtLines').checked){
      for(const line of courtMarkings()){
        const supported=evidence?.lineVisibility?.[line.id]?.status==='supported_projection';
        const inferred=!supported&&(!manual||line.id==='near_sideline');
        const color=inferred?'#efba62':line.color,label=`${line.name} · ${supported?'线支持投影':manual?'人工投影':'推算'}`;
        context.strokeStyle=color;context.lineWidth=inferred?3:4;context.setLineDash(inferred?[12,9]:[]);context.beginPath();let prev=null,visible=[];
        for(const p of line.points){const q=project(map.toImage,...p),depth=map.toImage[6]*p[0]+map.toImage[7]*p[1]+map.toImage[8];if(!q||Math.abs(q.x)>50000||Math.abs(q.y)>50000){prev=null;continue;}if(prev&&prev.depth*depth>0)context.lineTo(q.x,q.y);else context.moveTo(q.x,q.y);prev={...q,depth};if(q.x>0&&q.x<clip.width&&q.y>0&&q.y<clip.height)visible.push(q);}
        context.stroke();if(visible.length){const p=visible[Math.floor(visible.length/2)];context.font='bold 20px sans-serif';const width=context.measureText(label).width;context.fillStyle='#172336da';context.fillRect(p.x+5,p.y-25,width+12,26);context.fillStyle=color;context.fillText(label,p.x+11,p.y-6);}
      }
    }
    const points=pending&&pending.kind!=='single'?pending.image.map((image,i)=>({id:'ABCD'[i],image})):key?keyframePoints(key):map?map.image.map((image,i)=>({id:'ABCD'[i],image})):[];
    const displayed=[...points];
    // Ghost endpoints are display-only: never turn an occluded G/H projection
    // into a measured control or require the user to click an invisible corner.
    if(map&&$('showCourtLines').checked&&!pending&&!manual)for(const id of ['G','H']){
      const point=evidence?.pointVisibility?.[id];
      if(point?.image&&!points.some(p=>p.id===id))displayed.push({id,image:point.image,projectionOnly:true});
    }
    context.font='bold 23px sans-serif';for(const p of displayed){const[x,y]=p.image;
      const inferred=p.projectionOnly||(!pending&&evidence?.pointVisibility?.[p.id]?.status==='inferred');
      const label=`${p.id}${inferred?'·推算':''}`;
      context.fillStyle=p.enabled===false?'#999':'#fff6d2';context.strokeStyle=inferred?'#efba62':'#233f5b';context.lineWidth=3;context.setLineDash(inferred?[4,4]:[]);context.beginPath();context.arc(x,y,10,0,Math.PI*2);if(!inferred)context.fill();context.stroke();context.fillStyle='#233f5b';context.fillRect(x+12,y-25,context.measureText(label).width+14,29);context.fillStyle=inferred?'#efba62':'white';context.fillText(label,x+19,y-3);}
    context.setLineDash([]);
  }
  window.addEventListener('resize',draw);
  return {refresh,draw,handleImageClick,drawImageOverlay,switchStep,showArea:shell.showArea,gaps:()=>courtGaps(courtPoints[state().active]||[])};
}
