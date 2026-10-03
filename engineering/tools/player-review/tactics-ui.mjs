import {createTacticsDocument,validateDocument,splitPhase,removePhase,upsertAction,removeAction,reviewAction,refreshSnapshot,ACTION_KINDS,clone} from './tactics-document.mjs';
import {buildTacticalOverlay} from '../tactical-overlay/overlay.mjs';
import {renderOverlaySvg} from '../tactical-overlay/render-svg.mjs';
import {createSourceBinding} from '../tactical-overlay/binding.mjs';
import {readTacticsDraft,writeTacticsDraft} from './tactics-storage.mjs';

export function mountTacticsUI(api){
  const $=id=>document.getElementById(id),root=$('tacticsPanel');
  root.innerHTML=`<div class="tactics-heading"><div><span class="eyebrow">战术审核</span><h2>阶段、动作与讲解</h2></div><div class="tactics-buttons"><button id="tacticsSnapshot">使用当前轨迹建立草稿</button><button id="tacticsCandidate">THY 三阶段示例</button><button id="tacticsSave" class="primary">保存到本机</button><button id="tacticsJson">导出审核数据</button><button id="tacticsReport">导出冻结帧报告</button></div></div>
  <p id="tacticsStatus" role="status" aria-live="polite">从当前轨迹建立草稿，或打开 THY 的 005 三阶段候选。</p>
  <div class="tactics-buttons"><button id="tacticsWorkspace">当前视频草稿</button><button id="tacticsReload">重新读取已保存版本</button><button id="tacticsUndo">撤销战术修改</button><button id="tacticsIdentity">核对球员</button><button id="tacticsCalibration">核对球场</button></div>
  <div id="tacticsEditor" hidden><p id="tacticsSource" class="tactics-source"></p>
  <div class="tactics-layout"><section class="tactics-view"><div id="tacticsPhases" class="tactics-phases"></div><div id="tacticsCanvas" class="tactics-canvas"><p>选择阶段后预览。</p></div><p id="tacticsFrame" class="small muted"></p><p class="small muted">实线：当前动作完整路线　虚线：后续实际观测　淡线：已完成动作。缺失位置保留断点。</p><div id="tacticsRoster" class="tactics-roster"></div><details><summary>待处理问题与来源</summary><div id="tacticsIssues"></div></details></section>
  <aside class="tactics-controls"><label class="field">标题<input id="tacticsTitle" maxlength="120"></label><h3>当前阶段</h3><label class="field">阶段名称<input id="tacticsPhaseTitle" maxlength="100"></label><p id="tacticsPhaseRange" class="small muted"></p><div class="range-fields"><label class="field">冻结帧<input id="tacticsFreeze" type="number" min="1"></label><button id="tacticsUseFrame">用播放器当前帧</button></div><button id="tacticsApplyPhase">更新阶段与预览</button><div class="range-fields"><label class="field">从此帧分为下一阶段<input id="tacticsSplitAt" type="number" min="2"></label><button id="tacticsSplit">分段</button></div><button id="tacticsRemovePhase">合并当前阶段</button>
  <h3>动作与参与者</h3><label class="field">选择动作<select id="tacticsAction"></select></label><label class="field">执行球员<select id="tacticsActor"></select></label><label class="field">动作类型<select id="tacticsKind"></select></label><div class="range-fields"><label class="field">起始帧<input id="tacticsStart" type="number" min="1"></label><label class="field">结束帧（包含）<input id="tacticsEnd" type="number" min="1"></label></div><div id="tacticsScreenFields"><label class="field">受掩护球员<select id="tacticsBeneficiary"></select></label><label class="field">相关防守者<select id="tacticsDefender"></select></label><p class="small muted">未核对朝向时保留关系，不画方向横杠。</p></div><label class="field">动作说明<input id="tacticsActionNote" maxlength="300"></label><div class="tactics-buttons"><button id="tacticsApplyAction" class="primary">保存动作</button><button id="tacticsDeleteAction">删除动作</button></div>
  <label class="field">审核人<input id="tacticsReviewer" maxlength="80" placeholder="你的姓名或账号"></label><div class="tactics-buttons"><button id="tacticsConfirmAction">我已核对本动作</button><button id="tacticsUnconfirmAction">撤回动作审核</button></div><p id="tacticsActionStatus" class="small muted"></p><p class="small muted">动作审核单独记录；人物身份、接地点和球场标定仍按各自状态展示。</p>
  <label class="field">讲解草稿与审核意见<textarea id="tacticsNotes" rows="5" maxlength="8000" placeholder="记录看到的动作、配合关系和需要改进的地方"></textarea></label></aside></div></div>`;
  let documentValue=null,phaseId=null,kind='workspace',version=0,history=[],revision=0,epoch=0,context=0,loading=false,lastScene=null,active=false,pendingDraft=Promise.resolve();
  const base={sample:api.sample,variant:api.variant,qa:api.qa},cacheKey=(space=kind)=>`${api.key}:tactics:${space}`;
  const phase=()=>documentValue?.playDefinition.phases.find(p=>p.phaseId===phaseId)||documentValue?.playDefinition.phases[0];
  const status=text=>{$('tacticsStatus').textContent=text;};
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
  function clearPreview(){epoch++;lastScene=null;$('tacticsCanvas').replaceChildren();$('tacticsFrame').textContent='正在准备当前阶段…';$('tacticsRoster').replaceChildren();$('tacticsIssues').replaceChildren();}
  async function commit(next){
    await validateDocument(next);history.push(clone(documentValue));if(history.length>30)history.shift();documentValue=next;revision++;await draft();render();
  }
  function render(){
    $('tacticsEditor').hidden=!documentValue;
    for(const id of ['tacticsSave','tacticsJson','tacticsReport'])$(id).disabled=!documentValue;
    $('tacticsUndo').disabled=!history.length;
    if(!documentValue)return;
    const p=phase();phaseId=p.phaseId;
    $('tacticsSource').textContent=`${kind==='candidate'?'THY 独立候选快照':'当前视频轨迹快照'} · ${api.title} · ${documentValue.review.trackingRevision} · ${documentValue.playDefinition.participants.length} 名参与者 · ${version?'本机版本 '+version:'尚未保存到本机'}`;
    $('tacticsTitle').value=documentValue.title;$('tacticsNotes').value=documentValue.notes;
    $('tacticsPhaseTitle').value=p.title;$('tacticsFreeze').value=p.freezeFrame+1;
    $('tacticsPhaseRange').textContent=`第 ${p.startFrame+1}–${p.endFrameExclusive} 帧`;
    $('tacticsFreeze').min=p.startFrame+1;$('tacticsFreeze').max=p.endFrameExclusive;
    $('tacticsSplitAt').value=Math.min(p.endFrameExclusive,p.startFrame+Math.max(1,Math.floor((p.endFrameExclusive-p.startFrame)/2)))+1;
    $('tacticsRemovePhase').disabled=documentValue.playDefinition.phases.length===1;
    $('tacticsPhases').replaceChildren(...documentValue.playDefinition.phases.map(s=>{const b=document.createElement('button');b.textContent=s.title;b.setAttribute('aria-pressed',String(s.phaseId===phaseId));b.onclick=()=>{phaseId=s.phaseId;render();};return b;}));
    const people=documentValue.playDefinition.participants.map(p=>[p.id,`${p.id} · ${p.name}`]);
    selectOptions('tacticsActor',people);selectOptions('tacticsBeneficiary',[['','未指定'],...people]);selectOptions('tacticsDefender',[['','未指定'],...people]);
    selectOptions('tacticsKind',Object.entries(ACTION_KINDS));
    const selected=$('tacticsAction').value;
    selectOptions('tacticsAction',[['','＋ 新动作'],...documentValue.playDefinition.actions.map(a=>[a.actionId,`${a.actorId} · ${ACTION_KINDS[a.kind]} · ${a.startFrame+1}–${a.endFrameExclusive}${a.reviewStatus==='reviewed'?' · 已审核':''}`])]);
    if(documentValue.playDefinition.actions.some(a=>a.actionId===selected))$('tacticsAction').value=selected;
    fillAction();preview();
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
  async function preview(){
    clearPreview();const token=epoch,d=clone(documentValue),p=clone(phase());
    try{
      const manifest=await buildTacticalOverlay({review:d.review,playDefinition:d.playDefinition,phaseId:p.phaseId,freezeFrame:p.freezeFrame});
      if(token!==epoch)return;
      if(manifest.status==='refused')throw new Error('来源或阶段定义不匹配，已停止叠加。');
      let background=null,mode=manifest.videoOverlay.available?'video':'court';
      if(mode==='video'){
        const result=await request('/api/tactics/frame',{videoSha256:d.review.videoSha256,frames:[p.freezeFrame]});
        background=result.frames[0];
        if(background.frame!==manifest.freezeFrame||background.time!==manifest.time||background.videoSha256!==manifest.sourceBinding.videoSha256||background.sourceFrame!==manifest.sourceFrame||background.sourceTime!==manifest.sourceTime)throw new Error('冻结帧与轨迹不匹配，已停止叠加。');
        const image=new Image();image.src=background.dataUrl;await image.decode();
      }
      if(token!==epoch)return;
      lastScene={manifest,mode,background};drawScene();
      $('tacticsFrame').textContent=`${mode==='video'?'精确冻结帧':'2D 预览 · 当前帧球场投影不可用'} · 第 ${p.freezeFrame+1} 帧 · ${manifest.time.toFixed(3)} 秒 · ${manifest.status==='ok'?'所需证据齐全':'有待核对项'}。下方播放器时间轴与本冻结图独立。`;
      $('tacticsRoster').replaceChildren(...manifest.roster.map(person=>{const node=document.createElement('p');node.textContent=`${person.id} · ${person.name} · ${person.positionState==='visible'?(person.position?.courtPoint?'有球场位置':'有原图位置，球场待标定'):person.positionState==='offscreen'?'出画':'位置缺失'} · ${person.actionStates.map(a=>`${ACTION_KINDS[a.kind]}（${{active:'当前',future:'后续',pending:'后续',completed:'完成'}[a.temporalStatus]||a.temporalStatus}）`).join('、')||({player:'球员',referee:'裁判'}[person.role]||person.role)}`;return node;}));
      const groups=new Map();for(const issue of manifest.issues){const key=issue.code;groups.set(key,(groups.get(key)||0)+1);}
      const labels={identity_needs_review:'人物身份待核对',position_needs_review:'地面位置待核对',calibration_needs_review:'球场映射待核对',tactic_needs_review:'动作或关系待核对',freeze_calibration_unavailable:'冻结帧缺少有效球场标定'};
      $('tacticsIssues').replaceChildren(...[...groups].map(([code,count])=>{const node=document.createElement('p');node.textContent=`${labels[code]||code} · ${count} 项`;return node;}));
    }catch(error){if(token!==epoch)return;lastScene=null;$('tacticsCanvas').textContent=error.message;$('tacticsFrame').textContent='预览失败，未保留上一阶段的叠加。';status(error.message);}
  }
  function drawScene(){
    if(!lastScene||!active)return;
    const {manifest,mode,background}=lastScene,host=$('tacticsCanvas');let width=Math.max(320,host.clientWidth-2),svg;
    for(const candidate of [width,...[640,960,1280].filter(w=>w>width)]){
      try{svg=renderOverlaySvg(manifest,{mode,viewport:{width:candidate,height:candidate*(mode==='video'?documentValue.review.height/documentValue.review.width:15.24/28.65)}});width=candidate;break;}catch(error){if(!/label|layout|space|viewport/i.test(error.message))throw error;}
    }
    if(!svg)throw new Error('当前画布无法容纳全部标签，请扩大窗口。');
    const canvas=document.createElement('div');canvas.className='tactics-scene';canvas.style.width=`${width}px`;
    if(background){const img=document.createElement('img');img.alt=`第 ${manifest.freezeFrame+1} 帧`;img.src=background.dataUrl;canvas.append(img);}
    const overlay=document.createElement('div');overlay.className='tactics-overlay';overlay.innerHTML=svg;canvas.append(overlay);host.replaceChildren(canvas);
  }
  async function load(nextKind,serverOnly=false){
    await draft();const token=++epoch;loading=true;$('tacticsSnapshot').disabled=true;status('正在读取战术草稿…');
    try{
      if(serverOnly&&documentValue)await writeTacticsDraft(`${cacheKey()}:before-reload`,clone({version,document:documentValue,phaseId}));
      const stored=serverOnly?null:await readTacticsDraft(cacheKey(nextKind));
      const saved=stored||await request(`/api/tactics?${new URLSearchParams({...base,qa:api.qa?'1':'0',kind:nextKind})}`);
      let next=saved.document;
      if(!next&&nextKind==='candidate')next=await request('/api/tactics/candidate');
      if(next){await validateDocument(next);if(next.review.videoSha256!==api.clip.video_sha256)throw new Error('此战术草稿属于另一段视频。');}
      if(token!==epoch)return;
      kind=nextKind;documentValue=next;version=saved.version||0;phaseId=stored?.phaseId||next?.playDefinition.phases[0].phaseId;history=[];revision++;context++;
      const params=new URLSearchParams(location.search);if(kind==='candidate')params.set('candidate','1');else params.delete('candidate');window.history.replaceState(null,'',`/?${params}`);
      await draft();render();status(next?'可修改阶段、动作和讲解意见；修改自动保存在当前浏览器，点击「保存到本机」写入数据目录。':'尚无战术草稿。使用当前轨迹建立，或打开 THY 三阶段示例。');
    }finally{loading=false;$('tacticsSnapshot').disabled=false;}
  }
  $('tacticsWorkspace').onclick=safe(()=>load('workspace'));
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
  $('tacticsJson').onclick=safe(async()=>{await validateDocument(documentValue);download(JSON.stringify(documentValue,null,2),`tactics-${api.sample}-${kind}.json`,'application/json');status('已导出轨迹快照、阶段、动作和审核意见。');});
  $('tacticsReport').onclick=safe(async()=>{const d=clone(documentValue);status('正在生成各阶段的精确冻结帧报告…');const result=await request('/api/tactics/export',{document:d});download(result.html,`tactics-${api.sample}-${kind}.html`,'text/html');status('已导出可独立打开的冻结帧报告。');});
  $('tacticsUndo').onclick=safe(async()=>{if(!history.length)return;documentValue=history.pop();revision++;draft();render();});
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
    active=document.body.dataset.area==='tactics';if(!active)return;api.pause();
    if(!documentValue&&!loading)await load(new URLSearchParams(location.search).has('candidate')?'candidate':'workspace');
    else if(documentValue){drawScene();if(kind==='workspace'){const binding=await createSourceBinding(api.snapshot());if(binding.reviewDigest!==documentValue.playDefinition.sourceBinding.reviewDigest)status('当前人物或球场数据已变化。这里显示已保存的快照；点击「使用当前轨迹建立草稿」更新并重新审核。');}}
  }));
  render();return {saveDraft:draft};
}
