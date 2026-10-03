import {createTacticsDocument,validateDocument,splitPhase,removePhase,upsertAction,removeAction,reviewAction,refreshSnapshot,ACTION_KINDS,clone} from './tactics-document.mjs';
import {buildTacticalOverlay} from '../tactical-overlay/overlay.mjs';
import {createSourceBinding} from '../tactical-overlay/binding.mjs';
import {readTacticsDraft,writeTacticsDraft} from './tactics-storage.mjs';
import {buildPhaseRoutes,projectPhaseRoutes,renderPresentationSVG,updateRouteControlPoints,restoreRoute,courtToVideo} from './tactics-presentation.mjs';
import {createRouteEditor,commitWhenCurrent,screenToCourt} from './tactics-route-editor.mjs';
import {createPhasePlayback} from './tactics-playback.mjs';

export function mountTacticsUI(api){
  const $=id=>document.getElementById(id),root=$('tacticsPanel');
  root.innerHTML=`<div class="tactics-heading"><div><span class="eyebrow">战术审核</span><h2>阶段、动作与讲解</h2></div><div class="tactics-buttons"><button id="tacticsSnapshot">使用当前轨迹建立草稿</button><button id="tacticsCandidate">THY 三阶段示例</button><button id="tacticsSave" class="primary">保存到本机</button><button id="tacticsJson">导出审核数据</button><button id="tacticsReport">导出冻结帧报告</button></div></div>
  <p id="tacticsStatus" role="status" aria-live="polite">从当前轨迹建立草稿，或打开 THY 的 005 三阶段候选。</p>
  <div class="tactics-buttons"><button id="tacticsWorkspace">当前视频草稿</button><button id="tacticsReload">重新读取已保存版本</button><button id="tacticsUndo">撤销战术修改</button><button id="tacticsIdentity">核对球员</button><button id="tacticsCalibration">核对球场</button></div>
  <div id="tacticsEditor" hidden><p id="tacticsSource" class="tactics-source"></p>
  <div class="tactics-layout"><section class="tactics-view"><div id="tacticsPhases" class="tactics-phases"></div>
  <div class="tactics-route-toolbar"><label class="field">展示球员<select id="tacticsRoutePlayer"></select></label><label class="tactics-check"><input id="tacticsShowAll" type="checkbox">查看全部路线</label></div>
  <div class="tactics-buttons"><button id="tacticsContinue">继续本阶段</button><button id="tacticsPause">暂停</button><button id="tacticsReplay">重播本阶段</button></div>
  <div id="tacticsCanvas" class="tactics-canvas"><p>选择阶段后预览。</p></div><p id="tacticsFrame" class="small muted"></p><p id="tacticsPresentationStatus" class="small muted" role="status" aria-live="polite"></p><p class="small muted">浅色衬边表示未来路线；断点保留。人工展示修正不会更改轨迹或审核结论。</p>
  <details><summary>审核名单、待处理问题与来源</summary><div id="tacticsRoster" class="tactics-roster"></div><div id="tacticsIssues"></div></details></section>
  <aside class="tactics-controls"><label class="field">标题<input id="tacticsTitle" maxlength="120"></label><h3>当前阶段</h3><label class="field">阶段名称<input id="tacticsPhaseTitle" maxlength="100"></label><p id="tacticsPhaseRange" class="small muted"></p><div class="range-fields"><label class="field">冻结帧<input id="tacticsFreeze" type="number" min="1"></label><button id="tacticsUseFrame">用播放器当前帧</button></div><button id="tacticsApplyPhase">更新阶段与预览</button><div class="range-fields"><label class="field">从此帧分为下一阶段<input id="tacticsSplitAt" type="number" min="2"></label><button id="tacticsSplit">分段</button></div><button id="tacticsRemovePhase">合并当前阶段</button>
  <h3>展示路线修正</h3><label class="field">合法路线段<select id="tacticsRoute"></select></label><p id="tacticsRouteHint" class="small muted" role="status"></p><label class="field">控制点<select id="tacticsControlPoint"></select></label><label class="field">插入控制点的帧<select id="tacticsInsertFrame"></select></label><div class="tactics-buttons"><button id="tacticsInsertPoint">插入控制点</button><button id="tacticsDeletePoint">删除控制点</button><button id="tacticsRestoreRoute">恢复来源路线</button></div><p class="small muted">选择路线后拖动圆点；松手保存一次。端点可移动，不能删除。冻结报告导出既有动作与审核，不包含这里的平滑路线或人工展示修正；完整修正请导出审核数据 JSON。</p>
  <h3>动作与参与者</h3><label class="field">选择动作<select id="tacticsAction"></select></label><label class="field">执行球员<select id="tacticsActor"></select></label><label class="field">动作类型<select id="tacticsKind"></select></label><div class="range-fields"><label class="field">起始帧<input id="tacticsStart" type="number" min="1"></label><label class="field">结束帧（包含）<input id="tacticsEnd" type="number" min="1"></label></div><div id="tacticsScreenFields"><label class="field">受掩护球员<select id="tacticsBeneficiary"></select></label><label class="field">相关防守者<select id="tacticsDefender"></select></label><p class="small muted">未核对朝向时保留关系，不画方向横杠。</p></div><label class="field">动作说明<input id="tacticsActionNote" maxlength="300"></label><div class="tactics-buttons"><button id="tacticsApplyAction" class="primary">保存动作</button><button id="tacticsDeleteAction">删除动作</button></div>
  <label class="field">审核人<input id="tacticsReviewer" maxlength="80" placeholder="你的姓名或账号"></label><div class="tactics-buttons"><button id="tacticsConfirmAction">我已核对本动作</button><button id="tacticsUnconfirmAction">撤回动作审核</button></div><p id="tacticsActionStatus" class="small muted"></p><p class="small muted">动作审核单独记录；人物身份、接地点和球场标定仍按各自状态展示。</p>
  <label class="field">讲解草稿与审核意见<textarea id="tacticsNotes" rows="5" maxlength="8000" placeholder="记录看到的动作、配合关系和需要改进的地方"></textarea></label></aside></div></div>`;
  let documentValue=null,phaseId=null,kind='workspace',version=0,history=[],revision=0,epoch=0,context=0,loading=false,lastScene=null,active=false,pendingDraft=Promise.resolve();
  let selectedEntityId=null,selectedRouteId=null,selectedControlFrame=null,temporaryRoute=null,editBusy=false,sceneReady=Promise.resolve(),sceneNodes=null,editingEnabled=true,loadSequence=0;
  const playback=createPhasePlayback(),synchronized=typeof api.seek==='function'&&typeof api.play==='function';
  let presentedPoint=null,pendingSceneEpoch=null;
  const base={sample:api.sample,variant:api.variant,qa:api.qa},cacheKey=(space=kind)=>`${api.key}:tactics:${space}`;
  const phase=()=>documentValue?.playDefinition.phases.find(p=>p.phaseId===phaseId)||documentValue?.playDefinition.phases[0];
  const status=text=>{$('tacticsStatus').textContent=text;};
  const stamp=()=>({document:documentValue,context,phaseId,revision,loading});
  const editor=createRouteEditor({getStamp:stamp,
    commitControls:async(route,points,captured)=>{
      editBusy=true;fillRouteControls();
      try{const ok=await commit(updateRouteControlPoints(documentValue,route,points),captured,{reuseScene:true});if(ok)status('已保存人工展示修正；原轨迹和审核结论保留。');return ok;}
      finally{editBusy=false;fillRouteControls();}
    },
    onPreview:route=>{temporaryRoute=route;drawScene();},onSelection:()=>{if(editor.route)selectedControlFrame=editor.controls[editor.selectedPoint]?.frame;fillRouteControls();drawHandles();}});
  const draft=()=>{
    if(!documentValue)return pendingDraft;
    const key=cacheKey(),value=clone({version,document:documentValue,phaseId});
    pendingDraft=pendingDraft.catch(()=>{}).then(()=>writeTacticsDraft(key,value)).catch(()=>{status('浏览器草稿暂未保存，请点击「保存到本机」或导出审核数据，保留当前修改。');});
    return pendingDraft;
  };
  async function request(path,payload){
    const response=await fetch(path,payload?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base,kind,...payload})}:undefined);
    const result=await response.json();if(!response.ok)throw new Error(result.error||'本地战术服务暂不可用。');return result;
  }
  const safe=fn=>async()=>{try{await fn();}catch(error){status(error.message);}};
  function selectOptions(id,options,value){const target=$(id);target.replaceChildren(...options.map(([v,text])=>{const o=document.createElement('option');o.value=v;o.textContent=text;return o;}));if(value!==undefined)target.value=value;}
  function cancelEditing(){editor.cancel();temporaryRoute=null;}
  function playbackControls(){
    const s=playback.state(),disabled=!synchronized||!active||loading||editBusy||!lastScene||s.status==='seeking';
    $('tacticsContinue').disabled=disabled||s.status==='playing';$('tacticsReplay').disabled=disabled;
    $('tacticsPause').disabled=!synchronized||!active||s.status==='inactive'||s.status==='paused'||s.status==='ended';
  }
  function runPlayback(commands){
    for(const c of commands){
      if(c.type==='pause')api.pause();
      else if(c.type==='play')api.play();
      else if(c.type==='seek')api.seek(c.frame);
      else if(c.type==='phase'){cancelEditing();phaseId=c.phaseId;render({preserveFrame:true});}
    }
    playbackControls();
  }
  function onPresentedFrame(point){
    if(!active||!synchronized)return;
    presentedPoint=point;runPlayback(playback.presented(point.frame));
    const s=playback.state();
    if(s.status==='seeking'&&s.targetFrame!==point.frame)return;
    renderFrame(point.frame,point.time,point.source,{editing:s.status==='paused'||s.status==='ended'});
    playbackControls();
  }
  function selectPhase(id){
    cancelEditing();phaseId=id;
    if(synchronized){playback.configure(documentValue.playDefinition.phases,id);const commands=playback.select(id);render({preserveFrame:true});runPlayback(commands);}
    else render();
  }
  function clearPreview(){cancelEditing();epoch++;lastScene=null;editor.select(null);if(sceneNodes){sceneNodes.overlay.replaceChildren();sceneNodes.background.hidden=true;}$('tacticsFrame').textContent='正在准备当前阶段…';$('tacticsRoster').replaceChildren();$('tacticsIssues').replaceChildren();}
  async function commit(next,captured=stamp(),{reuseScene=false}={}){
    return commitWhenCurrent({next,stamp:captured,getStamp:stamp,validate:validateDocument,apply:async value=>{
      history.push(clone(documentValue));if(history.length>30)history.shift();documentValue=value;revision++;
      const applied=stamp();await draft();
      // Title/notes mutate this same document while its draft is queued. Render
      // the latest document after persistence; metadata revisions do not make
      // its newly applied presentation model obsolete. Navigation still does.
      if(applied.document!==documentValue||applied.context!==context||applied.phaseId!==phaseId||loading)return;
      render({reuseScene});await sceneReady;
    }});
  }
  function render({reuseScene=false,preserveFrame=false}={}){
    $('tacticsEditor').hidden=!documentValue;
    for(const id of ['tacticsSave','tacticsJson','tacticsReport'])$(id).disabled=!documentValue;
    $('tacticsUndo').disabled=!history.length;
    if(!documentValue)return;
    const p=phase();phaseId=p.phaseId;
    if(synchronized){
      playback.configure(documentValue.playDefinition.phases,phaseId);
      if(active&&!reuseScene&&!preserveFrame)runPlayback(playback.select(phaseId));
    }
    $('tacticsSource').textContent=`${kind==='candidate'?'THY 独立候选快照':'当前视频轨迹快照'} · ${api.title} · ${documentValue.review.trackingRevision} · ${documentValue.playDefinition.participants.length} 名参与者 · ${version?'本机版本 '+version:'尚未保存到本机'}`;
    $('tacticsTitle').value=documentValue.title;$('tacticsNotes').value=documentValue.notes;
    $('tacticsPhaseTitle').value=p.title;$('tacticsFreeze').value=p.freezeFrame+1;
    $('tacticsPhaseRange').textContent=`第 ${p.startFrame+1}–${p.endFrameExclusive} 帧`;
    $('tacticsFreeze').min=p.startFrame+1;$('tacticsFreeze').max=p.endFrameExclusive;
    $('tacticsSplitAt').value=Math.min(p.endFrameExclusive,p.startFrame+Math.max(1,Math.floor((p.endFrameExclusive-p.startFrame)/2)))+1;
    $('tacticsRemovePhase').disabled=documentValue.playDefinition.phases.length===1;
    $('tacticsPhases').replaceChildren(...documentValue.playDefinition.phases.map(s=>{const b=document.createElement('button');b.textContent=s.title;b.setAttribute('aria-pressed',String(s.phaseId===phaseId));b.onclick=()=>selectPhase(s.phaseId);return b;}));
    const people=documentValue.playDefinition.participants.map(p=>[p.id,`${p.id} · ${p.name}`]);
    if(!p.participantIds.includes(selectedEntityId))selectedEntityId=p.participantIds[0]||null;
    selectOptions('tacticsRoutePlayer',people.filter(([id])=>p.participantIds.includes(id)),selectedEntityId);
    selectOptions('tacticsActor',people);selectOptions('tacticsBeneficiary',[['','未指定'],...people]);selectOptions('tacticsDefender',[['','未指定'],...people]);
    selectOptions('tacticsKind',Object.entries(ACTION_KINDS));
    const selected=$('tacticsAction').value;
    selectOptions('tacticsAction',[['','＋ 新动作'],...documentValue.playDefinition.actions.map(a=>[a.actionId,`${a.actorId} · ${ACTION_KINDS[a.kind]} · ${a.startFrame+1}–${a.endFrameExclusive}${a.reviewStatus==='reviewed'?' · 已审核':''}`])]);
    if(documentValue.playDefinition.actions.some(a=>a.actionId===selected))$('tacticsAction').value=selected;
    fillAction();sceneReady=preview({reuseScene});playbackControls();
  }
  function fillAction(){
    const a=documentValue.playDefinition.actions.find(a=>a.actionId===$('tacticsAction').value),p=phase();
    $('tacticsActor').value=a?.actorId||documentValue.playDefinition.participants[0]?.id;
    $('tacticsKind').value=a?.kind||'move';$('tacticsStart').value=(a?.startFrame??p.startFrame)+1;$('tacticsEnd').value=a?.endFrameExclusive??p.endFrameExclusive;
    $('tacticsActionNote').value=a?.note||'';
    const relation=documentValue.playDefinition.relations.find(r=>r.actionId===a?.actionId);
    $('tacticsBeneficiary').value=relation?.beneficiaryId||'';$('tacticsDefender').value=relation?.defenderId||'';
    $('tacticsScreenFields').hidden=$('tacticsKind').value!=='screen';
    for(const id of ['tacticsDeleteAction','tacticsConfirmAction','tacticsUnconfirmAction'])$(id).disabled=!a;
    $('tacticsActionStatus').textContent=a?(a.reviewStatus==='reviewed'?'此动作已有人工审核记录。':'此动作等待人工核对。'):'选择球员和区间后添加动作。';
  }
  async function preview({reuseScene=false}={}){
    const d=clone(documentValue),p=clone(phase());
    const cached=reuseScene&&lastScene?.manifest.phaseId===p.phaseId&&lastScene.manifest.freezeFrame===p.freezeFrame&&lastScene.manifest.sourceBinding.videoSha256===d.review.videoSha256?lastScene:null;
    if(cached)epoch++;else clearPreview();const token=epoch;pendingSceneEpoch=token;
    try{
      const [manifest,model]=await Promise.all([
        cached?.manifest||buildTacticalOverlay({review:d.review,playDefinition:d.playDefinition,phaseId:p.phaseId,freezeFrame:p.freezeFrame}),buildPhaseRoutes(d,p.phaseId)]);
      if(token!==epoch)return;
      if(manifest.status==='refused')throw new Error('来源或阶段定义不匹配，已停止叠加。');
      const point=synchronized?(api.getPresentedFrame?.()||presentedPoint):null;
      const target=playback.state().targetFrame,usable=point&&(target===null||point.frame===target);
      const frame=usable?point.frame:cached?.frame??p.freezeFrame,mediaTime=usable?point.time:cached?.mediaTime??manifest.time;
      const projected=projectPhaseRoutes(model,{frame,mediaTime,selectedEntityId,showAll:$('tacticsShowAll').checked});
      let background=cached?.background||null,mode=synchronized||projected.videoAvailable?'video':'court';
      if(mode==='video'&&!cached&&!synchronized){
        const result=await request('/api/tactics/frame',{videoSha256:d.review.videoSha256,frames:[p.freezeFrame]});
        background=result.frames[0];
        if(background.frame!==manifest.freezeFrame||background.time!==manifest.time||background.videoSha256!==manifest.sourceBinding.videoSha256||background.sourceFrame!==manifest.sourceFrame||background.sourceTime!==manifest.sourceTime)throw new Error('冻结帧与轨迹不匹配，已停止叠加。');
        const image=new Image();image.src=background.dataUrl;await image.decode();background.image=image;
      }
      if(token!==epoch)return;
      lastScene={manifest,model,mode,background,frame,mediaTime,backgroundSource:usable?point.source:cached?.backgroundSource};temporaryRoute=null;
      if(synchronized)editingEnabled=['paused','ended'].includes(playback.state().status);
      fillRouteOptions();drawScene();
      if(!synchronized)$('tacticsFrame').textContent=`${mode==='video'?'精确冻结帧':'2D 预览 · 当前帧球场投影不可用'} · 第 ${p.freezeFrame+1} 帧 · ${manifest.time.toFixed(3)} 秒 · ${manifest.status==='ok'?'所需证据齐全':'有待核对项'}。`;
      $('tacticsRoster').replaceChildren(...manifest.roster.map(person=>{const node=document.createElement('p');node.textContent=`${person.id} · ${person.name} · ${person.positionState==='visible'?(person.position?.courtPoint?'有球场位置':'有原图位置，球场待标定'):person.positionState==='offscreen'?'出画':'位置缺失'} · ${person.actionStates.map(a=>`${ACTION_KINDS[a.kind]}（${{active:'当前',future:'后续',pending:'后续',completed:'完成'}[a.temporalStatus]||a.temporalStatus}）`).join('、')||({player:'球员',referee:'裁判'}[person.role]||person.role)}`;return node;}));
      const groups=new Map();for(const issue of manifest.issues){const key=issue.code;groups.set(key,(groups.get(key)||0)+1);}
      const labels={identity_needs_review:'人物身份待核对',position_needs_review:'地面位置待核对',calibration_needs_review:'球场映射待核对',tactic_needs_review:'动作或关系待核对',freeze_calibration_unavailable:'冻结帧缺少有效球场标定'};
      $('tacticsIssues').replaceChildren(...[...groups].map(([code,count])=>{const node=document.createElement('p');node.textContent=`${labels[code]||code} · ${count} 项`;return node;}));
    }catch(error){if(token!==epoch)return;lastScene=null;editor.select(null);if(sceneNodes){sceneNodes.overlay.replaceChildren();sceneNodes.background.hidden=true;}$('tacticsFrame').textContent='预览失败，未保留上一阶段的叠加。';status(error.message);}
    finally{if(pendingSceneEpoch===token)pendingSceneEpoch=null;if(token===epoch)playbackControls();}
  }
  function ensureScene(){
    if(sceneNodes)return sceneNodes;
    const canvas=document.createElement('div');canvas.className='tactics-scene';
    const background=document.createElement('canvas');background.className='tactics-background';background.setAttribute('aria-label','战术视频画面');
    const overlay=document.createElement('div');overlay.className='tactics-overlay';canvas.append(background,overlay);$('tacticsCanvas').replaceChildren(canvas);
    return sceneNodes={canvas,background,overlay,width:0};
  }
  function drawScene(){
    if(!lastScene||!active)return;
    const {model,frame,mediaTime,background,backgroundSource}=lastScene;
    const renderModel=temporaryRoute?{...model,routes:model.routes.map(r=>r.routeId===temporaryRoute.routeId?temporaryRoute:r)}:model;
    const projected=projectPhaseRoutes(renderModel,{frame,mediaTime,selectedEntityId,showAll:$('tacticsShowAll').checked});
    const mode=synchronized||backgroundSource||projected.videoAvailable?'video':'court';lastScene.mode=mode;lastScene.projected=projected;
    const width=Math.max(320,$('tacticsCanvas').clientWidth-2),height=width*(mode==='video'?model.height/model.width:15.24/28.6512),nodes=ensureScene();
    nodes.width=width;nodes.canvas.style.width=`${width}px`;nodes.canvas.style.height=`${height}px`;
    if(synchronized&&!backgroundSource){
      nodes.background.hidden=true;nodes.overlay.replaceChildren();
      $('tacticsFrame').textContent='正在定位同步视频画面…';return;
    }
    nodes.background.hidden=mode!=='video';
    if(mode==='video'){
      if(nodes.background.width!==model.width)nodes.background.width=model.width;
      if(nodes.background.height!==model.height)nodes.background.height=model.height;
      const source=backgroundSource||background?.image;if(source)nodes.background.getContext('2d').drawImage(source,0,0,model.width,model.height);
    }
    nodes.overlay.innerHTML=renderPresentationSVG(projected,{space:mode,width,height});drawHandles();
    const ps=model.presentation,manual=ps.applied.length,stale=ps.stale.length;
    const hidden=projected.routes.filter(r=>mode==='video'&&!r.video).length;
    $('tacticsPresentationStatus').textContent=`${manual?`人工展示修正 ${manual} 段`:'来源平滑路线'}${stale?` · ${stale} 项展示修正已过期，保留在 JSON，未套用`:''}${ps.pending.length?` · 其他阶段修正 ${ps.pending.length} 项`:''}${hidden?` · ${hidden} 段无法在当前帧投影`:''}${!projected.videoAvailable?` · 当前帧缺少有效标定，${mode==='video'?'视频路线已隐藏':'显示 2D 球场'}`:''}`;
    if(synchronized)$('tacticsFrame').textContent=`同步视频 · 第 ${frame+1} 帧 · ${mediaTime.toFixed(3)} 秒 · ${{playing:'播放中',paused:'已暂停',ended:'末阶段结束',seeking:'正在定位'}[playback.state().status]||'准备中'}。到下一阶段冻结点自动暂停。`;
  }
  function fillRouteOptions(){
    const routes=lastScene?.model.routes.filter(r=>r.entityId===selectedEntityId)||[];
    if(!routes.some(r=>r.routeId===selectedRouteId))selectedRouteId=null;
    selectOptions('tacticsRoute',[['','选择合法路线段'],...routes.map(r=>[r.routeId,`第 ${r.startFrame+1}–${r.endFrameExclusive} 帧${r.manual?' · 人工修正':''}`])],selectedRouteId||'');
    const pointFrame=selectedControlFrame;
    temporaryRoute=null;editor.select(routes.find(r=>r.routeId===selectedRouteId)||null);
    const pointIndex=editor.controls.findIndex(p=>p.frame===pointFrame);if(pointIndex>=0)editor.selectPoint(pointIndex);fillRouteControls();
  }
  function fillRouteControls(){
    playbackControls();
    const route=editor.route,points=editor.controls,index=editor.selectedPoint,disabled=loading||editBusy||!editingEnabled||!route;
    selectOptions('tacticsControlPoint',points.map((p,i)=>[String(i),`第 ${p.frame+1} 帧${i===0||i===points.length-1?' · 端点':''}`]),String(index));
    const frames=route?.sourcePoints.filter(p=>p.frame>route.startFrame&&p.frame<route.endFrameExclusive-1&&!points.some(c=>c.frame===p.frame))||[];
    const old=$('tacticsInsertFrame').value;
    selectOptions('tacticsInsertFrame',frames.map(p=>[String(p.frame),`第 ${p.frame+1} 帧`]),frames.some(p=>String(p.frame)===old)?old:String(frames[Math.floor(frames.length/2)]?.frame??''));
    $('tacticsRoute').disabled=loading||editBusy||!editingEnabled||!lastScene;
    $('tacticsControlPoint').disabled=disabled;
    $('tacticsInsertFrame').disabled=disabled||!frames.length||points.length>=128;
    $('tacticsInsertPoint').disabled=$('tacticsInsertFrame').disabled;
    $('tacticsDeletePoint').disabled=disabled||index===0||index===points.length-1;
    $('tacticsRestoreRoute').disabled=disabled||!documentValue?.presentation?.routes.some(r=>r.routeId===route?.routeId);
    $('tacticsRouteHint').textContent=editBusy?'正在保存展示修正…':!editingEnabled?'暂停播放后可编辑路线。':loading?'正在加载草稿…':!lastScene?'正在准备路线…':!route?(lastScene.model.routes.some(r=>r.entityId===selectedEntityId)?'先选择一条合法路线段，再拖动控制点。':'所选球员没有可编辑的连续路线；缺测与审核断点已保留。'):`${route.manual?'人工展示修正':'来源路线'} · ${points.length} 个控制点 · 当前第 ${(points[index]?.frame??route.startFrame)+1} 帧`;
  }
  function drawHandles(){
    const svg=sceneNodes?.overlay.querySelector('svg');if(!svg)return;
    svg.querySelector('[data-edit-handles]')?.remove();
    if(!editor.route||!editingEnabled||!lastScene)return;
    if(lastScene.mode==='video'&&!lastScene.projected?.routes.find(r=>r.routeId===editor.route.routeId)?.video)return;
    const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.setAttribute('data-edit-handles','true');
    const ratio=(lastScene.mode==='video'?lastScene.model.width:28.6512)/sceneNodes.width;
    for(const [index,point] of editor.controls.entries()){
      const p=lastScene.mode==='video'?courtToVideo(lastScene.model,lastScene.frame,point):point;if(!p)continue;
      const control=document.createElementNS('http://www.w3.org/2000/svg','g');control.setAttribute('data-control-index',String(index));control.setAttribute('class','tactics-control-handle');
      for(const [radius,fill,stroke] of [[12,'transparent','none'],[index===editor.selectedPoint?8:6,index===editor.selectedPoint?'#fff4ac':'#ffffff','#243b4b']]){
        const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
        for(const [key,value] of Object.entries({cx:p.x,cy:p.y,r:radius*ratio,fill,stroke,'stroke-width':2*ratio}))circle.setAttribute(key,String(value));control.append(circle);
      }group.append(control);
    }svg.append(group);
  }
  async function load(nextKind,serverOnly=false){
    if(synchronized)runPlayback(playback.leave());
    const sequence=++loadSequence;loading=true;clearPreview();const token=epoch;fillRouteControls();await draft();$('tacticsSnapshot').disabled=true;status('正在读取战术草稿…');
    try{
      if(serverOnly&&documentValue)await writeTacticsDraft(`${cacheKey()}:before-reload`,clone({version,document:documentValue,phaseId}));
      const stored=serverOnly?null:await readTacticsDraft(cacheKey(nextKind));
      const saved=stored||await request(`/api/tactics?${new URLSearchParams({...base,qa:api.qa?'1':'0',kind:nextKind})}`);
      let next=saved.document;
      if(!next&&nextKind==='candidate')next=await request('/api/tactics/candidate');
      if(next){await validateDocument(next);if(next.review.videoSha256!==api.clip.video_sha256)throw new Error('此战术草稿属于另一段视频。');}
      if(token!==epoch)return;
      kind=nextKind;documentValue=next;version=saved.version||0;phaseId=stored?.phaseId||next?.playDefinition.phases[0].phaseId;history=[];revision++;context++;selectedRouteId=null;selectedControlFrame=null;
      const params=new URLSearchParams(location.search);if(kind==='candidate')params.set('candidate','1');else params.delete('candidate');window.history.replaceState(null,'',`/?${params}`);
      await draft();render();status(next?'可修改阶段、动作和讲解意见；修改自动保存在当前浏览器，点击「保存到本机」写入数据目录。':'尚无战术草稿。使用当前轨迹建立，或打开 THY 三阶段示例。');
    }finally{if(sequence===loadSequence){loading=false;$('tacticsSnapshot').disabled=false;fillRouteControls();}}
  }
  $('tacticsWorkspace').onclick=safe(()=>load('workspace'));
  $('tacticsContinue').onclick=safe(async()=>{if(loading||editBusy||!active||!lastScene)return;await sceneReady;if(!active||loading||editBusy||!lastScene)return;epoch++;cancelEditing();runPlayback(playback.continue(lastScene.frame));});
  $('tacticsPause').onclick=()=>{runPlayback(playback.pause());const point=api.getPresentedFrame?.()||presentedPoint;if(point)onPresentedFrame(point);};
  $('tacticsReplay').onclick=safe(async()=>{if(loading||editBusy||!active||!lastScene)return;epoch++;cancelEditing();runPlayback(playback.replay());});
  $('tacticsReload').onclick=safe(()=>load(kind,true));
  $('tacticsSnapshot').onclick=safe(async()=>{
    if(kind!=='workspace')await load('workspace');
    const current=api.snapshot();
    if(documentValue)await commit(await refreshSnapshot(documentValue,current));
    else{documentValue=await createTacticsDocument(current);version=0;phaseId=null;revision++;context++;await draft();render();}
    status('已采用当前轨迹快照。请添加或核对动作；更新快照后，动作审核需要重新确认。');
  });
  $('tacticsCandidate').onclick=safe(async()=>{
    if(api.variant!=='ebard'||api.clip.video_sha256!=='1f7bd135ad8cde5ab877612e596f93200281b6902aac8084fad19a544d20b85d'){
      await draft();await api.beforeNavigate();const params=new URLSearchParams(location.search);params.set('sample','005');params.set('variant','ebard');params.set('area','tactics');params.set('candidate','1');location.assign(`/?${params}`);return;
    }await load('candidate');
  });
  $('tacticsSave').onclick=safe(async()=>{
    if(!documentValue)return;const d=clone(documentValue),rev=revision,saveKind=kind,saveContext=context;
    const saved=await request('/api/tactics/save',{document:d,expectedVersion:version});
    if(kind!==saveKind||context!==saveContext)return;version=saved.version;await draft();
    status(rev===revision?`已保存到本机数据目录 · 版本 ${version}。`:'已保存请求时的版本；之后的新修改仍在浏览器草稿，请再次保存。');
    $('tacticsSource').textContent+=` · 已保存版本 ${version}`;
  });
  function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('tacticsJson').onclick=safe(async()=>{const d=clone(documentValue);await validateDocument(d);download(JSON.stringify(d,null,2),`tactics-${api.sample}-${kind}.json`,'application/json');status('已导出轨迹快照、阶段、动作、审核意见及完整展示修正。');});
  $('tacticsReport').onclick=safe(async()=>{const d=clone(documentValue);status('正在生成冻结帧报告：仅既有动作与审核，平滑路线和人工展示修正保留在 JSON。');const result=await request('/api/tactics/export',{document:d});download(result.html,`tactics-${api.sample}-${kind}.html`,'text/html');status('已导出冻结帧报告；其中不包含平滑路线或人工展示修正，完整修正请同时导出审核数据 JSON。');});
  $('tacticsUndo').onclick=safe(async()=>{if(!history.length||editBusy)return;cancelEditing();documentValue=history.pop();revision++;await draft();render();await sceneReady;});
  $('tacticsRoutePlayer').onchange=()=>{cancelEditing();selectedEntityId=$('tacticsRoutePlayer').value;selectedRouteId=null;selectedControlFrame=null;fillRouteOptions();drawScene();};
  $('tacticsShowAll').onchange=()=>drawScene();
  $('tacticsRoute').onchange=()=>{cancelEditing();selectedRouteId=$('tacticsRoute').value||null;selectedControlFrame=null;fillRouteOptions();drawScene();};
  $('tacticsControlPoint').onchange=()=>editor.selectPoint(Number($('tacticsControlPoint').value));
  $('tacticsInsertPoint').onclick=safe(async()=>{if(!editBusy&&editingEnabled&&!loading)await editor.insert(Number($('tacticsInsertFrame').value));});
  $('tacticsDeletePoint').onclick=safe(async()=>{if(!editBusy&&editingEnabled&&!loading)await editor.remove();});
  $('tacticsRestoreRoute').onclick=safe(async()=>{
    if(editBusy||!editingEnabled||loading||!editor.route)return;cancelEditing();editBusy=true;fillRouteControls();
    try{await commit(restoreRoute(documentValue,editor.route.routeId),stamp(),{reuseScene:true});status('已恢复来源平滑路线。');}finally{editBusy=false;fillRouteControls();}
  });
  const host=$('tacticsCanvas');
  host.addEventListener('pointerdown',event=>{
    if(event.button!==0||loading||editBusy||!editingEnabled||!lastScene)return;
    const handle=event.target.closest('[data-control-index]');
    if(handle){api.pause();if(editor.begin(Number(handle.getAttribute('data-control-index')),event.pointerId)){host.setPointerCapture(event.pointerId);event.preventDefault();}return;}
    const routeId=event.target.closest('[data-route-id]')?.getAttribute('data-route-id');
    const route=lastScene.model.routes.find(r=>r.routeId===routeId);if(!route)return;
    api.pause();cancelEditing();selectedEntityId=route.entityId;$('tacticsRoutePlayer').value=selectedEntityId;selectedRouteId=routeId;selectedControlFrame=null;fillRouteOptions();drawScene();
  });
  host.addEventListener('pointermove',event=>{
    if(!editor.dragging||!lastScene)return;
    const point=screenToCourt(sceneNodes?.overlay.querySelector('svg'),event,{space:lastScene.mode,model:lastScene.model,frame:lastScene.frame});
    if(point&&editor.move(point,event.pointerId))event.preventDefault();
  });
  // Keep capture on the stable host while the SVG itself is replaced for previews.
  host.addEventListener('pointerup',async event=>{
    try{await editor.end(event.pointerId);}catch(error){status(error.message);temporaryRoute=null;drawScene();}
    finally{if(host.hasPointerCapture(event.pointerId))host.releasePointerCapture(event.pointerId);}
  });
  host.addEventListener('pointercancel',event=>{cancelEditing();if(host.hasPointerCapture(event.pointerId))host.releasePointerCapture(event.pointerId);drawScene();});
  $('tacticsIdentity').onclick=()=>api.openStep('identity');$('tacticsCalibration').onclick=()=>api.openStep('calibration');
  $('tacticsAction').onchange=fillAction;$('tacticsKind').onchange=()=>{$('tacticsScreenFields').hidden=$('tacticsKind').value!=='screen';};
  $('tacticsApplyAction').onclick=safe(()=>commit(upsertAction(documentValue,{actionId:$('tacticsAction').value,actorId:$('tacticsActor').value,kind:$('tacticsKind').value,startFrame:Number($('tacticsStart').value)-1,endFrameExclusive:Number($('tacticsEnd').value),note:$('tacticsActionNote').value,beneficiaryId:$('tacticsBeneficiary').value,defenderId:$('tacticsDefender').value})));
  $('tacticsDeleteAction').onclick=safe(()=>commit(removeAction(documentValue,$('tacticsAction').value)));
  $('tacticsConfirmAction').onclick=safe(()=>commit(reviewAction(documentValue,$('tacticsAction').value,$('tacticsReviewer').value,true)));
  $('tacticsUnconfirmAction').onclick=safe(()=>commit(reviewAction(documentValue,$('tacticsAction').value,'',false)));
  $('tacticsApplyPhase').onclick=safe(async()=>{const d=clone(documentValue),p=d.playDefinition.phases.find(p=>p.phaseId===phaseId);p.title=$('tacticsPhaseTitle').value.trim();p.freezeFrame=Number($('tacticsFreeze').value)-1;d.playDefinition.revision++;await commit(d);});
  $('tacticsUseFrame').onclick=()=>{$('tacticsFreeze').value=api.frame()+1;};
  $('tacticsSplit').onclick=safe(()=>commit(splitPhase(documentValue,phaseId,Number($('tacticsSplitAt').value)-1)));
  $('tacticsRemovePhase').onclick=safe(()=>commit(removePhase(documentValue,phaseId)));
  for(const [id,field] of [['tacticsTitle','title'],['tacticsNotes','notes']])$(id).oninput=()=>{if(documentValue){documentValue[field]=$(id).value;revision++;draft();}};
  const resize=new ResizeObserver(()=>{try{drawScene();}catch(error){status(error.message);}});resize.observe($('tacticsCanvas'));
  document.addEventListener('workbench-area',safe(async()=>{
    active=document.body.dataset.area==='tactics';if(!active){epoch++;cancelEditing();if(synchronized)runPlayback(playback.leave());return;}api.pause();editingEnabled=true;
    if(!documentValue&&!loading)await load(new URLSearchParams(location.search).has('candidate')?'candidate':'workspace');
    else if(documentValue){if(synchronized)selectPhase(phaseId);else drawScene();if(kind==='workspace'){const binding=await createSourceBinding(api.snapshot());if(binding.reviewDigest!==documentValue.playDefinition.sourceBinding.reviewDigest)status('当前人物或球场数据已变化。这里显示已保存的快照；点击「使用当前轨迹建立草稿」更新并重新审核。');}}
  }));
  function renderFrame(frame,mediaTime,backgroundSource,{editing=true}={}){
    if(!lastScene||loading)return false;
    const modeChanged=editingEnabled!==editing;
    if(!editing)cancelEditing();editingEnabled=editing;
    lastScene.frame=frame;lastScene.mediaTime=mediaTime;lastScene.backgroundSource=backgroundSource;
    drawScene();if(modeChanged)fillRouteControls();return true;
  }
  render();return {saveDraft:draft,ready:()=>sceneReady,cancelEditing,onPresentedFrame,
    getPlaybackState:playback.state,
    togglePlayback(){if(!active)return false;if(playback.state().status==='playing')$('tacticsPause').onclick();else $('tacticsContinue').onclick();return true;},
    externalSeek(frame){
      if(!active||!synchronized)return;cancelEditing();
      const commands=playback.externalSeek(frame);runPlayback(commands);
      // Time navigation within one phase does not invalidate its document model.
      // An in-flight rebuild reads the latest presented frame when it applies;
      // keep its promise so an editing commit stays busy until that model is ready.
      // Cross-phase rendering, loads and exit still invalidate obsolete models.
      if(!lastScene&&!loading&&pendingSceneEpoch!==epoch&&!commands.some(c=>c.type==='phase'))render({preserveFrame:true});
    },
    invalidatePreview(){epoch++;cancelEditing();},
    getSceneState:()=>({model:lastScene?.model,phase:phase(),phaseId,frame:lastScene?.frame,mediaTime:lastScene?.mediaTime,active,loading,editBusy,editingEnabled,selectedEntityId,showAll:$('tacticsShowAll').checked,background:sceneNodes?.background}),
    renderFrame};
}
