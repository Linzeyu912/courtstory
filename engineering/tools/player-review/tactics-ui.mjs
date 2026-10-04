import {createTacticsDocument,validateDocument,splitPhase,removePhase,upsertAction,removeAction,reviewAction,refreshSnapshot,restoreArchivedAnnotation,ACTION_KINDS,clone} from './tactics-document.mjs';
import {documentDigest} from './tactics-agent.mjs';
import {buildTacticalOverlay} from '../tactical-overlay/overlay.mjs';
import {createSourceBinding} from '../tactical-overlay/binding.mjs';
import {readTacticsDraft,writeTacticsDraft} from './tactics-storage.mjs';
import {buildPhaseRoutes,projectPhaseRoutes,renderPresentationSVG,updateRouteControlPoints,restoreRoute,courtToVideo,videoToCourt} from './tactics-presentation.mjs';
import {createRouteEditor,commitWhenCurrent,screenToCourt} from './tactics-route-editor.mjs';
import {createPhasePlayback} from './tactics-playback.mjs';
import {createAnnotation,updateAnnotation,removeAnnotation,annotationPointFromVideo,projectAnnotations,renderAnnotationsSVG,hitTestAnnotation,playerFoot,playersAtVideoPoint,annotationPresentation,annotationPausePoints,ANNOTATION_LIMITS,ANNOTATION_REASONS} from './tactics-annotations.mjs';
import {tacticsPlayerLabel,tacticsPlayerInspection} from './tactics-player-identity.mjs';

export function mountTacticsUI(api){
  const $=id=>document.getElementById(id),root=$('tacticsPanel');
  root.innerHTML=`<div class="tactics-heading"><div><h2>战术画布</h2><span class="tactics-subtitle">暂停画图 · 拖点修正 · 预览保存</span></div><div class="tactics-buttons"><span id="tacticsSaveState" class="tactics-save-state">正在读取</span><button id="tacticsUndo" title="撤销上一次修改（Ctrl / ⌘ Z）">撤销</button><button id="tacticsSave" class="primary">保存</button></div></div>
  <p id="tacticsStatus" role="status" aria-live="polite">正在读取当前视频的战术草稿。</p>
  <details id="tacticsAgentPanel" class="tactics-agent-panel" open><summary>Agent 战术初稿</summary><p class="small muted">Agent 先根据视频与轨迹生成阶段、暂停点、路线和标记；你核对并采用后，再手工修改。生成失败也可继续手工编辑。</p><div class="tactics-agent-inputs"><label class="field">分析范围<select id="tacticsAgentScope"><option value="play">整段视频，建立阶段</option><option value="phase">当前阶段，追加初稿</option></select></label><label class="field">希望讲清楚什么<input id="tacticsAgentGoal" maxlength="2000" placeholder="例如：持球掩护后切入与弱侧跑位"></label><button id="tacticsAgentRun" class="primary">生成战术初稿</button><button id="tacticsAgentCancel" hidden>取消生成</button></div><p id="tacticsAgentStatus" role="status" aria-live="polite">先生成初稿，再核对修改；当前人工草稿会保留。</p><div id="tacticsAgentPreview" class="tactics-agent-preview"></div><button id="tacticsAgentAdopt" class="primary" hidden disabled>采用到草稿，继续编辑</button></details>
  <div id="tacticsEmpty" class="tactics-empty" hidden><strong>先建立这个视频的战术画布</strong><p>没有识别结果也能画路线、虚线箭头、传球路线，或放挡拆标记和重点球员圈。</p><div id="tacticsEmptyActions" class="tactics-buttons"><button id="tacticsCreateCanvas" class="primary">建立画布，开始手工标注</button></div></div>
  <div id="tacticsEditor" hidden><div id="tacticsPhases" class="tactics-phases" aria-label="选择战术阶段"></div>
  <div class="tactics-layout"><section class="tactics-view"><div class="tactics-author-tools" role="toolbar" aria-label="画布工具">
  <button id="tacticsToolSelect" aria-pressed="true"><span aria-hidden="true">↖</span>选择 / 修改</button><button id="tacticsToolRoute" aria-pressed="false"><span aria-hidden="true">↗</span>画路线</button><button id="tacticsToolDashed" aria-pressed="false"><span aria-hidden="true">⇢</span>虚线箭头</button><button id="tacticsToolDots" aria-pressed="false"><span aria-hidden="true">•••</span>传球路线</button><button id="tacticsToolScreen" aria-pressed="false"><span aria-hidden="true">⊣</span>挡拆标记</button><button id="tacticsToolSpotlight" aria-pressed="false"><span aria-hidden="true">◯</span>重点球员圈</button></div>
  <div class="tactics-instruction"><p id="tacticsToolHint" role="status" aria-live="polite">选择一个工具，在视频画面上直接操作。</p><div class="tactics-buttons"><button id="tacticsFinishDrawing" class="primary" hidden>完成绘制</button><button id="tacticsCancelDrawing" hidden>取消</button></div></div>
  <div id="tacticsSelectionActions" class="tactics-selection-actions" role="toolbar" aria-label="选中图形操作" hidden><strong id="tacticsSelectionName"></strong><div id="tacticsSelectionRotation" class="tactics-rotation-actions"><button id="tacticsRotateLeft" title="向左旋转 15 度">↶ 左转 15°</button><output id="tacticsQuickAngle" aria-label="挡拆朝向"></output><button id="tacticsRotateRight" title="向右旋转 15 度">右转 15° ↷</button></div><button id="tacticsQuickDelete" class="tactics-danger" title="删除选中的图形（Delete）">删除图形</button><button id="tacticsDeselect">取消选择</button></div>
  <div id="tacticsCanvas" class="tactics-canvas" tabindex="0" aria-label="战术画布，使用上方工具在视频上添加或修改图形"><p>选择阶段后预览。</p></div>
  <div class="tactics-transport"><div class="tactics-buttons"><button id="tacticsContinue" class="primary">预览播放</button><button id="tacticsPause">暂停</button><button id="tacticsReplay">重播本段</button></div><span id="tacticsFrame" class="small muted"></span></div><label class="tactics-seek"><span>本段进度</span><input id="tacticsSeek" type="range" min="0" max="1" value="0" aria-label="当前阶段视频进度"></label>
  <div class="tactics-cue-controls"><p id="tacticsCueStatus" class="small muted" role="status" aria-live="polite"></p><div id="tacticsCueList" class="tactics-buttons" aria-label="跳到标记讲解画面"></div></div>
  <p id="tacticsPresentationStatus" class="small muted" role="status" aria-live="polite"></p></section>
  <aside class="tactics-controls" aria-label="图形操作"><div class="tactics-property-heading"><strong id="tacticsSelectedTitle">新建图形</strong><span id="tacticsObjectCount" class="small muted"></span></div>
  <label id="tacticsNewPlayerField" class="field"><span id="tacticsNewPlayerLabel">路线属于谁（可选）</span><select id="tacticsRoutePlayer"></select></label>
  <label id="tacticsExistingPlayerField" class="field" hidden><span id="tacticsAnnotationPlayerLabel">路线属于谁（可选）</span><select id="tacticsAnnotationPlayer"></select></label>
  <section class="tactics-person-card" aria-label="关联球员预览"><strong id="tacticsPersonName">尚未关联球员</strong><div class="tactics-person-preview"><canvas id="tacticsPersonImage" width="112" height="144" aria-label="所选球员的准确帧裁切" hidden></canvas><div><p id="tacticsPersonDescription"></p><p id="tacticsPersonFrame" class="small muted"></p><p id="tacticsPersonReview" class="small muted"></p></div></div><button id="tacticsLocatePlayer" disabled>在画面中查看</button><p class="small muted">P 编号是本视频的球员槽位，不是球衣号码。查看只临时高亮，不修改图形归属。</p></section>
  <p id="tacticsSelectionHint" class="small muted">先选上方工具，再点击画面。已添加的图形也可以在下面选中。</p>
  <div id="tacticsFootCandidates" class="tactics-foot-candidates" hidden></div>
  <div id="tacticsAnnotationProperties" hidden>
  <div id="tacticsAnnotationRouteFields"><label class="field">当前控制点<select id="tacticsAnnotationPoint"></select></label><div class="tactics-buttons"><button id="tacticsAnnotationAddPoint">＋ 加转弯点</button><button id="tacticsAnnotationDeletePoint">删此点</button></div></div>
  <label id="tacticsAnnotationAngleField" class="field">挡拆朝向（度）<input id="tacticsAnnotationAngle" type="number" min="0" max="359" step="5"></label>
  <label id="tacticsAnnotationFollowField" class="tactics-check"><input id="tacticsAnnotationFollow" type="checkbox">跟随关联球员</label>
  <div id="tacticsFootControls" class="tactics-foot-controls" hidden><p id="tacticsFootStatus" class="small muted"></p><div class="tactics-buttons"><button id="tacticsSnapFoot">重新贴脚</button><button id="tacticsOffsetMode" aria-pressed="false">微调偏移</button></div></div>
  <div class="range-fields"><label class="field">大小<select id="tacticsAnnotationSize"><option value="0.75">较小</option><option value="1">标准</option><option value="1.5">较大</option><option value="2">醒目</option></select></label><label class="field">颜色<select id="tacticsAnnotationColor"><option value="#26baff">蓝色</option><option value="#ffd34e">黄色</option><option value="#ff7b55">橙色</option><option value="#8fe3b0">绿色</option></select></label></div>
  <div class="tactics-buttons"><button id="tacticsAnnotationDelete" class="tactics-danger">删除选中图形</button><button id="tacticsAnnotationRebind" hidden>在本帧重新定位</button></div>
  <details class="tactics-time-settings"><summary>显示时间</summary><div class="range-fields"><label class="field">开始帧<input id="tacticsAnnotationStart" type="number" min="1"></label><label class="field">结束帧<input id="tacticsAnnotationEnd" type="number" min="1"></label></div><button id="tacticsAnnotationApplyTime">应用显示时间</button></details></div>
  <div class="tactics-object-heading"><h3>本阶段图形</h3><span class="small muted">点击选中</span></div><div id="tacticsObjectList" class="tactics-object-list"></div><p id="tacticsObjectEmpty" class="small muted">还没有图形。选择「画路线」「虚线箭头」「传球路线」，或放一个挡拆标记 / 脚底圈。</p>
  <details id="tacticsArchive" class="tactics-archive" hidden><summary id="tacticsArchiveTitle">已移除球员的图形</summary><p class="small muted">来源移除球员后，图形保留在这里。选择当前球员并恢复到本阶段。</p><label class="field">恢复后关联<select id="tacticsArchivePlayer"></select></label><div id="tacticsArchiveList" class="tactics-object-list"></div></details>
  </aside></div></div>
  <div class="tactics-secondary"><details id="tacticsPhaseSettings"><summary>阶段设置</summary><div class="tactics-secondary-grid"><label class="field">作品标题<input id="tacticsTitle" maxlength="120"></label><label class="field">阶段名称<input id="tacticsPhaseTitle" maxlength="100"></label><p id="tacticsPhaseRange" class="small muted"></p><div class="range-fields"><label class="field">暂停讲解帧<input id="tacticsFreeze" type="number" min="1"></label><button id="tacticsUseFrame">用当前帧</button></div><button id="tacticsApplyPhase">更新阶段</button><div class="range-fields"><label class="field">从此帧分为下一阶段<input id="tacticsSplitAt" type="number" min="2"></label><button id="tacticsSplit">分段</button></div><button id="tacticsRemovePhase">合并当前阶段</button></div></details>
  <details id="tacticsReferenceDetails"><summary>识别路线参考</summary><p class="small muted">需要参考机器识别时再打开。手绘路线独立保存，不要求先有识别路线。</p><label class="tactics-check"><input id="tacticsShowReference" type="checkbox">在画面显示识别路线</label><label class="tactics-check"><input id="tacticsShowAll" type="checkbox">显示全部球员参考路线</label><label class="field">原始路线段<select id="tacticsRoute"></select></label><p id="tacticsRouteHint" class="small muted" role="status"></p><label class="field">参考路线控制点<select id="tacticsControlPoint"></select></label><label class="field">插入控制点的帧<select id="tacticsInsertFrame"></select></label><div class="tactics-buttons"><button id="tacticsInsertPoint">插入控制点</button><button id="tacticsDeletePoint">删除控制点</button><button id="tacticsRestoreRoute">恢复来源路线</button></div></details>
  <details id="tacticsActionReview"><summary>动作审核与讲解</summary><div class="tactics-secondary-grid"><label class="field">选择动作<select id="tacticsAction"></select></label><label class="field">执行球员<select id="tacticsActor"></select></label><label class="field">动作类型<select id="tacticsKind"></select></label><div class="range-fields"><label class="field">起始帧<input id="tacticsStart" type="number" min="1"></label><label class="field">结束帧（包含）<input id="tacticsEnd" type="number" min="1"></label></div><div id="tacticsScreenFields"><label class="field">受掩护球员<select id="tacticsBeneficiary"></select></label><label class="field">相关防守者<select id="tacticsDefender"></select></label><p class="small muted">这里记录动作关系；画面上的挡拆符号用上方「挡拆标记」添加。</p></div><label class="field">动作说明<input id="tacticsActionNote" maxlength="300"></label><div class="tactics-buttons"><button id="tacticsApplyAction">保存动作记录</button><button id="tacticsDeleteAction">删除动作</button></div><label class="field">审核人<input id="tacticsReviewer" maxlength="80" placeholder="你的姓名或账号"></label><div class="tactics-buttons"><button id="tacticsConfirmAction">我已核对本动作</button><button id="tacticsUnconfirmAction">撤回动作审核</button></div><p id="tacticsActionStatus" class="small muted"></p><label class="field">讲解草稿与审核意见<textarea id="tacticsNotes" rows="4" maxlength="8000" placeholder="记录看到的动作、配合关系和需要改进的地方"></textarea></label></div></details>
  <details id="tacticsAdvanced"><summary>来源、草稿与导出</summary><p id="tacticsSource" class="tactics-source"></p><div class="tactics-buttons"><button id="tacticsSnapshot">使用当前轨迹建立草稿</button><button id="tacticsCandidate">THY 三阶段示例</button><button id="tacticsWorkspace">当前视频草稿</button><button id="tacticsReload">重新读取已保存版本</button><button id="tacticsIdentity">核对球员</button><button id="tacticsCalibration">核对球场</button><button id="tacticsJson">导出完整数据 JSON</button><button id="tacticsReport">导出审核冻结报告</button></div><p class="small muted">完整数据含所有手绘路线、挡拆标记和重点球员圈。审核冻结报告仅包含原有动作与审核，不包含新画布图形。</p><div id="tacticsRoster" class="tactics-roster"></div><div id="tacticsIssues"></div></details></div>`;
  let documentValue=null,phaseId=null,kind='workspace',version=0,history=[],revision=0,epoch=0,context=0,loading=false,lastScene=null,active=false,pendingDraft=Promise.resolve();
  let selectedEntityId=null,selectedRouteId=null,selectedControlFrame=null,temporaryRoute=null,editBusy=false,sceneReady=Promise.resolve(),sceneNodes=null,editingEnabled=true,loadSequence=0;
  const playback=createPhasePlayback(),synchronized=typeof api.seek==='function'&&typeof api.play==='function';
  let presentedPoint=null,pendingSceneEpoch=null;
  let annotationTool='select',selectedAnnotationId=null,selectedAnnotationPoint=0,drawing=null,annotationDrag=null,annotationPreview=null,annotationScene=null,addingAnnotationPoint=false;
  let offsetMode=false,footCandidates=[],agentJob=null,agentCapture=null,agentTimer=null,agentBusy=false,agentAdopting=false,agentAvailable=null;
  let staticSpotlight=false,personInspection=null;
  let cueDocument=null,markerCues=[],cueListSignature='';
  const base={sample:api.sample,variant:api.variant,qa:api.qa},cacheKey=(space=kind)=>`${api.key}:tactics:${space}`;
  const phase=()=>documentValue?.playDefinition.phases.find(p=>p.phaseId===phaseId)||documentValue?.playDefinition.phases[0];
  const status=text=>{$('tacticsStatus').textContent=text;};
  const stamp=()=>({document:documentValue,context,phaseId,revision,loading});
  const annotations=()=>documentValue?.annotations?.items||[];
  function pausePoints(){if(cueDocument!==documentValue){cueDocument=documentValue;markerCues=documentValue?annotationPausePoints(documentValue):[];}return markerCues;}
  const annotationInPanel=a=>a.phaseId===phaseId||!documentValue.playDefinition.phases.some(p=>p.phaseId===a.phaseId);
  const selectedAnnotation=()=>annotations().find(a=>a.id===selectedAnnotationId&&annotationInPanel(a))||null;
  const typeNames={route:'路线',dashed:'虚线箭头',dots:'传球路线',screen:'挡拆标记',spotlight:'重点球员圈'};
  const toolButtons=[['tacticsToolSelect','select'],['tacticsToolRoute','route'],['tacticsToolDashed','dashed'],['tacticsToolDots','dots'],['tacticsToolScreen','screen'],['tacticsToolSpotlight','spotlight']];
  const straightRoute=a=>a?.type==='route'&&['dashed','dots'].includes(a.style.pattern);
  const annotationName=a=>typeNames[straightRoute(a)?a.style.pattern:a.type]||'图形';
  const editAllowed=()=>!!lastScene&&active&&!loading&&!editBusy&&editingEnabled;
  const inspectedPlayer=()=>{const a=selectedAnnotation();return personInspection?.entityId??(a?a.entityId:selectedEntityId);};
  const playerLabel=id=>tacticsPlayerLabel(documentValue.review,id);
  const inspectionDetails=()=>documentValue&&lastScene&&inspectedPlayer()?tacticsPlayerInspection(documentValue,inspectedPlayer(),lastScene.frame,{phaseId,model:lastScene.model}):null;
  function decodedPersonSource(){
    if(!lastScene||!editingEnabled||playback.state().status==='seeking')return null;
    if(!synchronized)return lastScene.background?.frame===lastScene.frame?lastScene.background.image:null;
    const point=api.getPresentedFrame?.()||presentedPoint;
    return point?.frame===lastScene.frame&&point.source===lastScene.backgroundSource?point.source:null;
  }
  function fillPersonCard(){
    const id=inspectedPlayer(),details=inspectionDetails(),image=$('tacticsPersonImage'),source=decodedPersonSource();
    image.hidden=true;
    $('tacticsPersonName').textContent=id&&documentValue?playerLabel(id):'尚未关联球员';
    $('tacticsPersonDescription').textContent=id?'当前帧没有可用人物画面。':staticSpotlight?'静态圈不跟随球员。':selectedAnnotation()?'这幅图形尚未关联球员。':'尚未关联球员。可选择球员，或在添加脚圈时点击画面中的人物。';
    $('tacticsPersonFrame').textContent='';$('tacticsPersonReview').textContent='';
    $('tacticsLocatePlayer').disabled=!details?.target||!editAllowed()||playback.state().status==='seeking';
    if(!details)return;
    const inspected=personInspection?.entityId===id&&personInspection.target.frame===lastScene.frame?personInspection.target:null;
    const shown=inspected||details.current,target=shown||details.target;
    if(target)$('tacticsPersonFrame').textContent=`${target.kind==='reference'?'参考帧':'观测帧'} · 第 ${target.frame+1} 帧${Number.isFinite(documentValue.review.sourceFrameMapping[target.frame]?.time)?` · ${documentValue.review.sourceFrameMapping[target.frame].time.toFixed(2)} 秒`:''}${target.trackId!=null?` · T${target.trackId}`:''}`;
    $('tacticsPersonReview').textContent=shown?(shown.kind==='reference'?'已保存身份参考':shown.reviewed?'本帧关联已核对':'本帧关联待核对')+(details.reference?'；参考身份不代表全程关联已核对。':'。'):details.reference?'身份参考不代表当前帧已有可靠关联。':'身份待确认，不根据名单推测号码。';
    if(playback.state().status==='seeking'){$('tacticsPersonDescription').textContent='正在定位所选人物的画面，解码完成后显示预览。';return;}
    if(!editingEnabled){$('tacticsPersonDescription').textContent='播放中，暂停后可查看人物。';return;}
    if(!shown){$('tacticsPersonDescription').textContent=target?'当前帧人物不可见或缺少有效框，可定位到上面的可用帧。':'当前帧人物不可见，且没有可用参考或观测帧。请先核对球员。';return;}
    if(!source){$('tacticsPersonDescription').textContent='此帧尚无已解码画面；可在画面中查看，或完成视频定位后重试。';return;}
    const [x1,y1,x2,y2]=shown.box,w=x2-x1,h=y2-y1,scale=Math.min(112/w,144/h);
    try{const context=image.getContext('2d');image.width=112;image.height=144;context.clearRect(0,0,112,144);context.drawImage(source,x1,y1,w,h,(112-w*scale)/2,(144-h*scale)/2,w*scale,h*scale);image.hidden=false;$('tacticsPersonDescription').textContent=shown.kind==='reference'?'已保存参考中的人物。':'当前画面中的关联人物。';}
    catch{$('tacticsPersonDescription').textContent='人物裁切暂不可用，请点“在画面中查看”。';}
  }
  function personInspectionMarkup(){
    if(!personInspection||!decodedPersonSource()||lastScene.mode!=='video'||personInspection.entityId!==inspectedPlayer()||personInspection.target.frame!==lastScene.frame)return '';
    const [x1,y1,x2,y2]=personInspection.target.box,scale=lastScene.model.width/(sceneNodes?.width||lastScene.model.width);
    return `<g data-player-inspection="true" pointer-events="none"><rect x="${x1}" y="${y1}" width="${x2-x1}" height="${y2-y1}" fill="#ffe58a" fill-opacity="0.12" stroke="#ffe58a" stroke-width="${3*scale}" stroke-dasharray="${7*scale} ${4*scale}"/></g>`;
  }
  function markUnsaved(){$('tacticsSaveState').textContent='浏览器草稿 · 待保存';$('tacticsSaveState').setAttribute('data-dirty','true');}
  const normalizedAngle=value=>Math.round(((value%360+360)%360)*10)/10%360;
  function cancelAnnotationGesture(){
    const pointerId=annotationDrag?.pointerId,host=$('tacticsCanvas');
    if(pointerId!==undefined&&host.hasPointerCapture(pointerId))host.releasePointerCapture(pointerId);
    drawing=null;annotationDrag=null;annotationPreview=null;addingAnnotationPoint=false;
  }
  function chooseTool(tool){
    if(!editAllowed())return;cancelEditing();footCandidates=[];offsetMode=false;selectedRouteId=null;editor.select(null);annotationTool=tool;
    personInspection=null;if(tool!=='select'){if(selectedAnnotationId){selectedEntityId=null;staticSpotlight=false;}selectedAnnotationId=null;}
    fillAnnotationControls();drawScene();
  }
  function selectAnnotation(id){
    cancelEditing();footCandidates=[];offsetMode=false;selectedAnnotationId=id;selectedAnnotationPoint=0;annotationTool='select';selectedRouteId=null;editor.select(null);
    personInspection=null;staticSpotlight=false;const a=selectedAnnotation();selectedEntityId=a?.entityId??null;$('tacticsRoutePlayer').value=selectedEntityId||'';
    fillAnnotationControls();drawScene();
  }
  function fillAnnotationControls(){
    const a=selectedAnnotation(),disabled=!editAllowed(),items=annotations().filter(annotationInPanel);
    for(const [id,tool] of toolButtons){
      $(id).setAttribute('aria-pressed',String(annotationTool===tool));$(id).disabled=disabled;
    }
    $('tacticsCanvas').setAttribute('data-tool',annotationTool);
    $('tacticsFinishDrawing').hidden=!drawing||drawing.pattern!=='solid';$('tacticsFinishDrawing').disabled=disabled||!drawing||drawing.points.length<2;
    $('tacticsCancelDrawing').hidden=!drawing&&!addingAnnotationPoint;
    let hint=!lastScene?'正在准备画面…':playback.state().status==='seeking'?'正在定位画面，完成后可以继续编辑。':!editingEnabled?'播放中。暂停后可以添加或修改图形。':addingAnnotationPoint?'在画面点击新的转弯位置；会插入当前选中点之后。Esc 取消。':
      annotationTool==='route'?(drawing?`已点 ${drawing.points.length} 个点。继续点转弯 / 终点，然后点「完成绘制」。`:'在球员脚下点起点，再点转弯和终点；两点也能画直线。'):
      ['dashed','dots'].includes(annotationTool)?(drawing?`已选起点，再点终点即完成${typeNames[annotationTool]}；Esc 取消。`:`先点起点，再点终点，自动完成${annotationTool==='dots'?'黄色圆点传球线（无箭头）':'直线虚线箭头'}。`):
      annotationTool==='screen'?'在掩护发生的位置点击，放下挡拆标记；选中后可以移动和调整朝向。':
      annotationTool==='spotlight'?'点击球员身体，脚底圈会自动贴脚。重叠时请选择要跟随的人；没有轨迹时可放静态圈。':
      a?(a.type==='route'?(straightRoute(a)?'拖起点或终点调整直线；拖动线段可整体移动。':'拖动白色控制点修正路线；需要转弯可用「＋ 加转弯点」。'):a.type==='screen'?'拖白点移动；拖蓝色旋转柄自由转向，也可点左转 / 右转。':'拖动图形调整位置；在图形属性里修改大小。'):
      '点「画路线」新建；要修正已有图形，直接点画面上的图形或下方列表。';
    if(drawing?.space==='video')hint+=' 此处只能标注当前画面。';
    $('tacticsToolHint').textContent=editBusy?'正在保存这次修改…':hint;
    $('tacticsSelectedTitle').textContent=a?`修改${annotationName(a)}`:annotationTool==='select'?'图形操作':`添加${typeNames[annotationTool]}`;
    $('tacticsSelectionActions').hidden=!a;$('tacticsSelectionName').textContent=a?`已选：${annotationName(a)}`:'';
    $('tacticsSelectionRotation').hidden=a?.type!=='screen';
    $('tacticsQuickAngle').textContent=a?`${normalizedAngle(a.style.angle)}°`:'';
    for(const id of ['tacticsRotateLeft','tacticsRotateRight'])$(id).disabled=disabled||a?.type!=='screen';
    for(const id of ['tacticsQuickDelete','tacticsDeselect'])$(id).disabled=disabled||!a;
    $('tacticsObjectCount').textContent=`${items.length} 个图形`;
    const associationLabel=type=>type==='spotlight'?'脚圈跟随谁':type==='screen'?'掩护由谁执行（可选）':'路线属于谁（可选）';
    $('tacticsNewPlayerLabel').textContent=associationLabel(annotationTool);$('tacticsAnnotationPlayerLabel').textContent=associationLabel(a?.type);
    $('tacticsFootCandidates').hidden=!footCandidates.length;$('tacticsFootCandidates').replaceChildren(...footCandidates.map(person=>{const button=document.createElement('button');button.textContent=`跟随 ${playerLabel(person.id)}`;button.onclick=safe(()=>placeSpotlight(person.id));return button;}));
    $('tacticsAnnotationProperties').hidden=!a;$('tacticsNewPlayerField').hidden=!!a;$('tacticsExistingPlayerField').hidden=!a;
    $('tacticsAnnotationRouteFields').hidden=a?.type!=='route';$('tacticsAnnotationAngleField').hidden=a?.type!=='screen';$('tacticsAnnotationFollowField').hidden=a?.type!=='spotlight';
    const people=(documentValue?.playDefinition.participants||[]).filter(p=>phase()?.participantIds.includes(p.id)).map(p=>[p.id,playerLabel(p.id)]);
    selectOptions('tacticsRoutePlayer',[['',annotationTool==='spotlight'?'先选球员，或点击画面中的人':'不关联球员'],...(annotationTool==='spotlight'?[['__static__','静态圈（不跟随球员）']]:[]),...people],annotationTool==='spotlight'&&staticSpotlight?'__static__':selectedEntityId||'');
    if(a){
      selectOptions('tacticsAnnotationPlayer',[['','不关联球员'],...people],a.entityId||'');
      selectedAnnotationPoint=Math.min(selectedAnnotationPoint,a.points.length-1);selectOptions('tacticsAnnotationPoint',a.points.map((_p,i)=>[String(i),i===0?'起点':i===a.points.length-1?'终点':`转弯 ${i}`]),String(selectedAnnotationPoint));
      $('tacticsAnnotationAngle').value=a.style?.angle||0;$('tacticsAnnotationSize').value=String(a.style?.size||1);$('tacticsAnnotationColor').value=a.style?.color||'#26baff';
      $('tacticsAnnotationFollow').checked=!!a.followEntity;$('tacticsAnnotationFollow').disabled=disabled||!a.entityId;
      $('tacticsAnnotationStart').value=a.startFrame+1;$('tacticsAnnotationEnd').value=a.endFrameExclusive;
      const item=annotationScene?.items.find(item=>item.id===a.id),stale=annotationScene?.stale.find(item=>item.id===a.id);
      const reason=stale?'阶段或来源已变化。可在本帧重新定位，或删除此图形。':item?.hiddenReason==='reference_frame_only'?'此图形仅用于添加时的画面。点击下方列表可回到那一帧。':item?.hiddenReason==='outside_time'?'当前不在此图形的显示时间内。点击下方列表可回到添加帧。':item?.hiddenReason?`${ANNOTATION_REASONS[item.hiddenReason]||'当前画面无法定位此图形'}。可回到添加帧修正。`:
        a.space==='video'?'仅此画面：当前缺少可跟随镜头的球场位置。':a.type==='spotlight'&&a.followEntity?'脚底圈会跟随关联球员；拖动可微调与脚底的距离。':'修改只影响展示图形；原始轨迹和审核记录保留。';
      $('tacticsSelectionHint').textContent=reason;$('tacticsAnnotationRebind').hidden=!stale;
      if(a.anchorMode==='player_foot')$('tacticsSelectionHint').textContent=stale?reason:'按当前球员脚底自动跟随；无有效位置、身份冲突或镜头切换时隐藏。球场标定用于圈的透视外形。';
    }else{$('tacticsSelectionHint').textContent='选择关联球员后，在画面上放置图形。画面不显示球员文字标签。';}
    for(const id of ['tacticsAnnotationPlayer','tacticsAnnotationPoint','tacticsAnnotationAddPoint','tacticsAnnotationDeletePoint','tacticsAnnotationAngle','tacticsAnnotationSize','tacticsAnnotationColor','tacticsAnnotationDelete','tacticsAnnotationApplyTime','tacticsAnnotationRebind'])$(id).disabled=disabled||!a;
    $('tacticsAnnotationDeletePoint').disabled=disabled||a?.type!=='route'||a.points.length<=2;
    $('tacticsAnnotationAddPoint').disabled=disabled||a?.type!=='route'||straightRoute(a)||a.points.length>=ANNOTATION_LIMITS.points;
    $('tacticsObjectList').replaceChildren(...items.map(item=>{
      const b=document.createElement('button'),entity=people.find(([id])=>id===item.entityId)?.[1];
      b.textContent=`${straightRoute(item)?item.style.pattern==='dots'?'•••':'⇢':{route:'↗',screen:'⊣',spotlight:'◯'}[item.type]} ${annotationName(item)}${entity?` · ${entity}`:''}${item.origin?item.origin.kind==='agent'?' · Agent 建议':' · 人工修改':''}${item.phaseId!==phaseId?' · 待重新定位':''}`;
      b.setAttribute('aria-pressed',String(item.id===selectedAnnotationId));b.setAttribute('data-object-id',item.id);
      b.onclick=()=>{selectAnnotation(item.id);const projected=annotationScene?.items.find(a=>a.id===item.id);if(projected?.hiddenReason&&synchronized)seekCanvas(item.anchorFrame);};return b;
    }));
    $('tacticsObjectEmpty').hidden=!!items.length;
    $('tacticsFootControls').hidden=a?.type!=='spotlight';$('tacticsSnapFoot').disabled=disabled||!a?.entityId;
    $('tacticsOffsetMode').disabled=disabled||a?.anchorMode!=='player_foot';$('tacticsOffsetMode').setAttribute('aria-pressed',String(offsetMode));
    $('tacticsFootStatus').textContent=a?.anchorMode==='player_foot'?`脚底锚定 · 偏移 ${Math.round(a.offset?.x||0)}, ${Math.round(a.offset?.y||0)} 像素${offsetMode?' · 现在可拖动微调':''}`:'手工偏移（兼容旧图形）；点「重新贴脚」可切换为自动脚底锚定。';
    const archived=documentValue?.archivedTactics?.annotations||[];$('tacticsArchive').hidden=!archived.length;$('tacticsArchiveTitle').textContent=`已移除球员的图形 · ${archived.length}`;
    const restorePerson=$('tacticsArchivePlayer').value;selectOptions('tacticsArchivePlayer',[['','不关联球员'],...people],people.some(([id])=>id===restorePerson)?restorePerson:'');
    $('tacticsArchiveList').replaceChildren(...archived.map(item=>{const button=document.createElement('button');button.textContent=`恢复 ${annotationName(item)} · ${item.entityId||'未关联'}`;button.disabled=disabled;button.onclick=safe(async()=>{const next=restoreArchivedAnnotation(documentValue,item.id,{entityId:$('tacticsArchivePlayer').value||null,phaseId,frame:lastScene.frame});selectedAnnotationId=item.id;await saveAnnotation(next);});return button;}));
    fillPersonCard();
  }
  async function placeSpotlight(entityId,point=null){
    if(!editAllowed())return;const foot=entityId?playerFoot(documentValue,entityId,lastScene.frame,{phaseId,model:lastScene.model}).point:null;
    if(entityId&&!foot){status('这个球员在本帧没有有效脚底位置。请定位到可见帧，或选择不关联球员放静态圈。');return;}
    const id=`draw-${crypto.randomUUID()}`,located=foot?{space:'video',point:foot}:annotationPointFromVideo(lastScene.model,lastScene.frame,point);
    const next=createAnnotation(documentValue,{id,type:'spotlight',phaseId,entityId,frame:lastScene.frame,space:located.space,points:[located.point],...(foot?{anchorMode:'player_foot',offset:{x:0,y:0}}:{}),style:{color:'#ffd34e'}});
    footCandidates=[];selectedAnnotationId=id;selectedAnnotationPoint=0;annotationTool='select';await saveAnnotation(next);
  }
  function canvasPoint(event){
    const svg=sceneNodes?.overlay.querySelector('svg');if(!svg)return null;
    try{const m=svg.getScreenCTM();if(!m)return null;const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const point=p.matrixTransform(m.inverse());
      if(lastScene.mode==='court')return courtToVideo(lastScene.model,lastScene.frame,point);
      return point.x>=0&&point.y>=0&&point.x<=lastScene.model.width&&point.y<=lastScene.model.height?{x:point.x,y:point.y}:null;
    }catch{return null;}
  }
  function originalPoint(point,space){return space==='video'?{x:point.x,y:point.y}:videoToCourt(lastScene.model,lastScene.frame,point);}
  async function saveAnnotation(next,captured=stamp()){
    editBusy=true;fillAnnotationControls();
    try{const accepted=await commit(next,captured,{reuseScene:true});if(accepted)status('图形已写入浏览器草稿。预览满意后点击「保存」。');return accepted;}
    finally{editBusy=false;annotationPreview=null;fillAnnotationControls();playbackControls();drawScene();}
  }
  async function patchAnnotation(patch){const a=selectedAnnotation();if(!a||!editAllowed())return;return saveAnnotation(updateAnnotation(documentValue,a.id,patch));}
  async function deleteSelectedAnnotation(){
    const a=selectedAnnotation();if(!a||!editAllowed())return;
    cancelAnnotationGesture();
    if(await saveAnnotation(removeAnnotation(documentValue,a.id))){
      selectedAnnotationId=null;fillAnnotationControls();drawScene();status(`已删除${annotationName(a)}。可点「撤销」恢复。`);
    }
  }
  function deselectAnnotation(){cancelEditing();selectedAnnotationId=null;selectedEntityId=null;personInspection=null;staticSpotlight=false;selectedRouteId=null;editor.select(null);fillAnnotationControls();drawScene();}
  async function finishDrawing(){
    if(!drawing||drawing.points.length<2||!editAllowed())return;
    const pending=drawing,id=`draw-${crypto.randomUUID()}`,next=createAnnotation(documentValue,{id,type:'route',phaseId,entityId:selectedEntityId||null,frame:pending.frame,space:pending.space,points:pending.points,style:pending.pattern==='solid'?{color:'#26baff'}:{pattern:pending.pattern}});
    drawing=null;selectedAnnotationId=id;selectedAnnotationPoint=0;annotationTool='select';await saveAnnotation(next,pending.stamp);
  }
  function seekCanvas(frame,{inspect=false}={}){
    if(!active||!synchronized||loading||editBusy)return;
    const target=Number(frame);if(!Number.isInteger(target)||target<0||target>=documentValue.review.sourceFrameMapping.length)return;
    if(!inspect)personInspection=null;cancelEditing();
    // externalSeek updates phase/intent but deliberately does not seek the player.
    // A request originating on this canvas must perform that seek itself.
    runPlayback([...playback.externalSeek(target),{type:'seek',frame:target}]);
  }
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
  function agentStatus(text){$('tacticsAgentStatus').textContent=text;}
  function agentControls(){
    $('tacticsSave').disabled=loading||!documentValue||agentAdopting;
    $('tacticsAgentRun').disabled=agentBusy||loading||!active||agentAvailable===false;
    $('tacticsAgentCancel').hidden=!agentBusy||agentAdopting;$('tacticsAgentAdopt').hidden=agentJob?.status!=='ready';
    $('tacticsAgentAdopt').disabled=agentBusy||agentJob?.status!=='ready'||!!agentJob?.adopted;
  }
  function previewAgent(job){
    const host=$('tacticsAgentPreview');host.replaceChildren();if(job?.status!=='ready')return;
    const summary=document.createElement('p');summary.textContent=job.candidate.summary;host.append(summary);
    for(const issue of job.candidate.issues||[]){const item=document.createElement('p');item.className='small muted';item.textContent=`待核对：${issue}`;host.append(item);}
    const doc=job.previewDocument,ids=doc?.annotations?.items.filter(a=>a.origin?.jobId===job.jobId).map(a=>a.id)||[];
    const presentation=job.presentation||(doc?annotationPresentation(doc,{annotationIds:ids}):null);
    for(const [index,phaseSuggestion] of job.candidate.phases.entries()){
      const card=document.createElement('section'),title=document.createElement('strong');card.className='tactics-agent-card';title.textContent=`${index+1} · ${phaseSuggestion.title}`;card.append(title);
      const phase=doc?.playDefinition.phases.find(p=>p.startFrame===phaseSuggestion.startFrame&&p.endFrameExclusive===phaseSuggestion.endFrameExclusive);
      const items=(presentation?.items||[]).filter(item=>phase?item.phaseId===phase.phaseId:item.frame>=phaseSuggestion.startFrame&&item.frame<phaseSuggestion.endFrameExclusive);
      const frames=[...new Set([phaseSuggestion.freezeFrame,...items.map(item=>item.frame),...(!presentation?phaseSuggestion.annotations.map(a=>a.anchorFrame):[])])].sort((a,b)=>a-b);
      if(!items.some(item=>item.visible)){const notice=document.createElement('p');notice.textContent=presentation?'本阶段没有可展示的标记。':'缺少展示报告，尚不能确认标记是否可见。';card.append(notice);}
      for(const at of frames){
        const point=document.createElement('div'),heading=document.createElement('strong'),details=items.filter(item=>item.frame===at),visible=details.filter(item=>item.visible);
        const frame=job.previewFrames?.find(f=>f.frame===at),time=doc?.review.sourceFrameMapping[at]?.time??frame?.time;
        point.className='tactics-agent-point';point.setAttribute('data-preview-frame',String(at));
        heading.textContent=`${Number.isFinite(time)?`${time.toFixed(2)} 秒 · `:''}第 ${at+1} 帧 · ${at===phaseSuggestion.freezeFrame?'阶段暂停画面':'标记参考画面'} · ${presentation?`本帧可见 ${visible.length} 个图形`:'可见数量待核对'}`;point.append(heading);
        if(frame?.dataUrl?.startsWith('data:image/jpeg;base64,')&&doc&&phase&&(!frame.videoSha256||frame.videoSha256===doc.review.videoSha256)){
          const surface=document.createElement('div'),image=document.createElement('img'),overlay=document.createElement('div'),scene=projectAnnotations(doc,{phaseId:phase.phaseId,frame:at,editing:true});
          const shownIds=new Set(visible.map(item=>item.id));scene.items=scene.items.filter(item=>shownIds.has(item.id));
          surface.className='tactics-agent-image';image.src=frame.dataUrl;image.alt=`第 ${at+1} 帧标记建议预览`;image.loading='lazy';image.decoding='async';
          overlay.innerHTML=renderAnnotationsSVG(scene);overlay.hidden=true;image.onload=()=>{overlay.hidden=false;};
          image.onerror=()=>{const missing=document.createElement('p');missing.className='small muted';missing.textContent='该帧预览图加载失败，暂不能核对画面中的标记。';surface.className='';surface.replaceChildren(missing);};
          surface.append(image,overlay);point.append(surface);
        }else{const missing=document.createElement('p');missing.className='small muted';missing.textContent=`缺少该帧的${doc&&phase?'匹配预览图':'预览图或标记文档'}，暂不能核对画面；以上为展示报告的时间点。`;point.append(missing);}
        if(details.length){
          const mode=document.createElement('p'),single=visible.filter(item=>item.mode==='reference_frame').length,continuous=visible.filter(item=>item.mode==='timeline').length;
          mode.className='small muted';mode.textContent=`参考画面暂停讲解${single?` · ${single} 个仅本帧显示`:''}${continuous?` · ${continuous} 个随后按有效证据连续展示`:''}`;point.append(mode);
          for(const hidden of details.filter(item=>!item.visible)){const reason=document.createElement('p');reason.className='small muted';reason.textContent=`此标记不可见：${ANNOTATION_REASONS[hidden.reason]||hidden.reason||'缺少可展示的几何信息'}`;point.append(reason);}
        }
        card.append(point);
      }
      const description=document.createElement('p');description.textContent=`${phaseSuggestion.reason} · ${phaseSuggestion.annotations.length} 个可编辑图形`;card.append(description);host.append(card);
    }
  }
  async function receiveAgent(job,captured){
    if(agentCapture!==captured||context!==captured.context){
      if(['queued','preparing','analyzing','validating'].includes(job.status))await request(`/api/tactics-agent/jobs/${job.jobId}/cancel`,{}).catch(()=>{});
      return;
    }
    agentJob=job;agentBusy=['queued','preparing','analyzing','validating'].includes(job.status);agentStatus(job.message||job.status);agentControls();previewAgent(job);
    if(agentBusy){clearTimeout(agentTimer);agentTimer=setTimeout(async()=>{try{await receiveAgent(await request(`/api/tactics-agent/jobs/${job.jobId}?${new URLSearchParams({...base,kind})}`),captured);}catch(error){if(agentCapture===captured){agentBusy=false;agentStatus(error.message);agentControls();}}},1000);}
  }
  async function generateAgent(){
    if(agentBusy||loading)return;
    if(!documentValue)await $('tacticsSnapshot').onclick();if(!documentValue)return;
    const scope=$('tacticsAgentScope').value||'play',captured={...stamp(),version},snapshot=clone(documentValue);
    agentCapture=captured;agentJob=null;agentBusy=true;agentStatus('正在准备当前草稿与视频…');agentControls();$('tacticsAgentPreview').replaceChildren();
    try{
      const digest=await documentDigest(snapshot);
      if(revision!==captured.revision||context!==captured.context)throw new Error('草稿已有修改，请重新生成。');
      captured.digest=digest;
      const result=await request('/api/tactics-agent/jobs',{document:snapshot,expectedVersion:captured.version,clientRevision:captured.revision,documentDigest:digest,scope,phaseId,goal:$('tacticsAgentGoal').value||''});
      await receiveAgent(result,captured);
    }catch(error){if(agentCapture===captured){agentBusy=false;agentStatus(error.message);agentControls();}}
  }
  async function adoptAgent(){
    if(agentBusy||agentJob?.status!=='ready'||agentJob.adopted||!agentCapture)return;
    const captured=agentCapture,job=agentJob,current=stamp(),snapshot=clone(documentValue);
    agentAdopting=true;agentBusy=true;agentControls();agentStatus('正在采用建议，完成后再保存…');
    try{
      const digest=await documentDigest(snapshot);
      if(agentCapture!==captured||loading||context!==captured.context||revision!==captured.revision||version!==captured.version||digest!==captured.digest)throw new Error('生成后草稿已有修改或版本变化，请重新生成建议。');
      agentBusy=true;agentControls();
      const response=await request(`/api/tactics-agent/jobs/${job.jobId}/adopt`,{document:snapshot,expectedVersion:version,clientRevision:revision,documentDigest:digest});
      if(agentCapture!==captured||revision!==current.revision||context!==current.context||version!==captured.version)throw new Error('等待采用时草稿已有修改，建议未覆盖当前内容。');
      if(!await commit(response.document,current))throw new Error('草稿状态已变化，请重新生成。');
      if(agentCapture===captured){
        const previousIds=new Set((snapshot.annotations?.items||[]).map(a=>a.id)),previousCues=new Set(annotationPausePoints(snapshot).map(c=>`${c.phaseId}:${c.frame}`));
        const added=annotations().filter(a=>!previousIds.has(a.id)).length,addedCues=pausePoints().filter(c=>!previousCues.has(`${c.phaseId}:${c.frame}`)).length;
        agentJob={...job,adopted:true};agentStatus(`已采用 ${added} 个图形，新增 ${addedCues} 个标记讲解暂停点。所有可见标记会在参考画面暂停；随后是否持续展示取决于图形类型和有效证据。点击继续播放推进，修改后点击「保存」。`);
      }
    }catch(error){if(agentCapture===captured)agentStatus(error.message);}finally{if(agentCapture===captured){agentAdopting=false;agentBusy=false;agentControls();}}
  }
  async function syncSnapshot(){
    if(!documentValue||kind!=='workspace'||loading||editBusy)return;
    const captured=stamp(),review=api.snapshot(),binding=await createSourceBinding(review);
    if(binding.reviewDigest===documentValue.playDefinition.sourceBinding.reviewDigest)return;
    if(await commit(await refreshSnapshot(documentValue,review),captured))status('已同步最新人物与标定。脚底圈自动重新贴脚；地面图形请核对后重新定位，已移除球员的图形保留在归档。');
  }
  const safe=fn=>async()=>{try{await fn();}catch(error){status(error.message);}};
  function selectOptions(id,options,value){const target=$(id);target.replaceChildren(...options.map(([v,text])=>{const o=document.createElement('option');o.value=v;o.textContent=text;return o;}));if(value!==undefined)target.value=value;}
  function cancelEditing(){editor.cancel();temporaryRoute=null;cancelAnnotationGesture();fillAnnotationControls();}
  function playbackControls(){
    const s=playback.state(),disabled=!synchronized||!active||loading||editBusy||!lastScene||s.status==='seeking';
    $('tacticsContinue').disabled=disabled||s.status==='playing';$('tacticsReplay').disabled=disabled;
    $('tacticsPause').disabled=!synchronized||!active||s.status==='inactive'||s.status==='paused'||s.status==='ended';
    const cues=pausePoints().filter(c=>c.phaseId===phaseId),point=api.getPresentedFrame?.()||presentedPoint;
    const stopped=!disabled&&s.status==='paused'&&point?.frame===lastScene?.frame&&cues.some(c=>c.frame===lastScene.frame);
    $('tacticsContinue').textContent=stopped?'继续播放':'预览播放';
    const cueMessage=`本阶段 ${cues.length} 个标记讲解暂停点。${s.status==='seeking'?'正在定位准确画面…':stopped?'已停在标记画面，点击继续播放。':'预览会自动暂停，点击继续播放逐点推进。'}所有可见标记在参考画面暂停；随后是否持续展示取决于图形类型和有效证据。`;
    if($('tacticsCueStatus').textContent!==cueMessage)$('tacticsCueStatus').textContent=cueMessage;
    const signature=JSON.stringify([phaseId,cues]);
    if(signature!==cueListSignature){
      cueListSignature=signature;$('tacticsCueList').replaceChildren(...cues.map(cue=>{
        const button=document.createElement('button'),time=documentValue.review.sourceFrameMapping[cue.frame]?.time;
        button.textContent=`${Number.isFinite(time)?`${time.toFixed(2)} 秒`:`第 ${cue.frame+1} 帧`} · ${cue.annotationIds.length} 个图形`;
        button.title=`定位到第 ${cue.frame+1} 帧，查看标记`;
        button.onclick=()=>{if(button.disabled)return;seekCanvas(cue.frame);};return button;
      }));
    }
    Array.from($('tacticsCueList').children).forEach((button,index)=>{button.disabled=disabled;button.setAttribute('aria-pressed',String(stopped&&cues[index].frame===lastScene.frame));});
  }
  function runPlayback(commands){
    const playbackStatus=playback.state().status;
    if(playbackStatus==='playing')personInspection=null;
    if(['seeking','playing'].includes(playbackStatus)&&editingEnabled){
      editingEnabled=false;cancelEditing();fillRouteControls();drawScene();
    }else if(playbackStatus==='seeking')drawScene();
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
    personInspection=null;cancelEditing();phaseId=id;
    if(synchronized){playback.configure(documentValue.playDefinition.phases,id,pausePoints());const commands=playback.select(id);render({preserveFrame:true});runPlayback(commands);}
    else render();
  }
  function clearPreview(){cancelEditing();epoch++;lastScene=null;editor.select(null);fillPersonCard();if(sceneNodes){sceneNodes.overlay.replaceChildren();sceneNodes.background.hidden=true;}$('tacticsFrame').textContent='正在准备当前阶段…';$('tacticsRoster').replaceChildren();$('tacticsIssues').replaceChildren();}
  async function commit(next,captured=stamp(),{reuseScene=false}={}){
    return commitWhenCurrent({next,stamp:captured,getStamp:stamp,validate:validateDocument,apply:async value=>{
      history.push({document:clone(documentValue),selectedAnnotationId});if(history.length>30)history.shift();documentValue=value;personInspection=null;revision++;markUnsaved();
      const applied=stamp();await draft();
      // Title/notes mutate this same document while its draft is queued. Render
      // the latest document after persistence; metadata revisions do not make
      // its newly applied presentation model obsolete. Navigation still does.
      if(applied.document!==documentValue||applied.context!==context||applied.phaseId!==phaseId||loading)return;
      render({reuseScene});await sceneReady;
    }});
  }
  function render({reuseScene=false,preserveFrame=false}={}){
    agentControls();
    $('tacticsEditor').hidden=!documentValue;
    $('tacticsEmpty').hidden=!!documentValue;
    for(const id of ['tacticsPhaseSettings','tacticsReferenceDetails','tacticsActionReview'])$(id).hidden=!documentValue;
    if(!documentValue)$('tacticsSaveState').textContent='尚未建立画布';
    $('tacticsCreateCanvas').disabled=loading;
    for(const id of ['tacticsJson','tacticsReport'])$(id).disabled=!documentValue;
    $('tacticsUndo').disabled=!history.length;
    if(!documentValue)return;
    if(annotations().length||documentValue.playDefinition.actions.length||documentValue.playDefinition.phases.length>1||documentValue.presentation?.routes.length)$('tacticsAgentScope').value='phase';
    const p=phase();phaseId=p.phaseId;
    if(synchronized){
      playback.configure(documentValue.playDefinition.phases,phaseId,pausePoints());
      if(active&&!reuseScene&&!preserveFrame)runPlayback(playback.select(phaseId));
    }
    $('tacticsSource').textContent=`${kind==='candidate'?'THY 独立候选快照':'当前视频轨迹快照'} · ${api.title} · ${documentValue.review.trackingRevision} · ${documentValue.playDefinition.participants.length} 名参与者 · ${version?'本机版本 '+version:'尚未保存到本机'}`;
    $('tacticsTitle').value=documentValue.title;$('tacticsNotes').value=documentValue.notes;
    $('tacticsPhaseTitle').value=p.title;$('tacticsFreeze').value=p.freezeFrame+1;
    $('tacticsPhaseRange').textContent=`第 ${p.startFrame+1}–${p.endFrameExclusive} 帧`;
    $('tacticsFreeze').min=p.startFrame+1;$('tacticsFreeze').max=p.endFrameExclusive;
    $('tacticsSplitAt').value=Math.min(p.endFrameExclusive,p.startFrame+Math.max(1,Math.floor((p.endFrameExclusive-p.startFrame)/2)))+1;
    $('tacticsRemovePhase').disabled=documentValue.playDefinition.phases.length===1;
    $('tacticsPhases').replaceChildren(...documentValue.playDefinition.phases.map((s,i)=>{const b=document.createElement('button');b.textContent=`${i+1} · ${s.title}`;b.setAttribute('aria-pressed',String(s.phaseId===phaseId));b.onclick=()=>selectPhase(s.phaseId);return b;}));
    const people=documentValue.playDefinition.participants.map(p=>[p.id,playerLabel(p.id)]);
    if(!p.participantIds.includes(selectedEntityId))selectedEntityId=null;
    selectOptions('tacticsRoutePlayer',[['','不关联球员'],...people.filter(([id])=>p.participantIds.includes(id))],selectedEntityId||'');
    selectOptions('tacticsActor',people);selectOptions('tacticsBeneficiary',[['','未指定'],...people]);selectOptions('tacticsDefender',[['','未指定'],...people]);
    selectOptions('tacticsKind',Object.entries(ACTION_KINDS));
    const selected=$('tacticsAction').value;
    selectOptions('tacticsAction',[['','＋ 新动作'],...documentValue.playDefinition.actions.map(a=>[a.actionId,`${a.actorId} · ${ACTION_KINDS[a.kind]} · ${a.startFrame+1}–${a.endFrameExclusive}${a.reviewStatus==='reviewed'?' · 已审核':''}`])]);
    if(documentValue.playDefinition.actions.some(a=>a.actionId===selected))$('tacticsAction').value=selected;
    fillAction();fillAnnotationControls();sceneReady=preview({reuseScene});playbackControls();
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
      fillRouteOptions();drawScene();fillAnnotationControls();
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
    const ratio=mode==='video'?model.height/model.width:15.24/28.6512;
    const actionsHeight=($('tacticsSelectionActions').offsetHeight||42)+6;
    const availableHeight=typeof window!=='undefined'&&Number.isFinite(window.innerHeight)?Math.max(160,window.innerHeight-400-actionsHeight):Infinity;
    const width=Math.max(200,Math.min($('tacticsCanvas').clientWidth-2,availableHeight/ratio)),height=width*ratio,nodes=ensureScene();
    nodes.width=width;nodes.canvas.style.width=`${width}px`;nodes.canvas.style.height=`${height}px`;
    const playbackState=playback.state(),decoded=api.getPresentedFrame?.()||presentedPoint;
    if(synchronized&&(!backgroundSource||playbackState.status==='seeking'&&decoded?.frame!==playbackState.targetFrame)){
      nodes.background.hidden=true;nodes.overlay.replaceChildren();
      $('tacticsFrame').textContent='正在定位同步视频画面…';return;
    }
    nodes.background.hidden=mode!=='video';
    if(mode==='video'){
      if(nodes.background.width!==model.width)nodes.background.width=model.width;
      if(nodes.background.height!==model.height)nodes.background.height=model.height;
      const source=backgroundSource||background?.image;if(source)nodes.background.getContext('2d').drawImage(source,0,0,model.width,model.height);
    }
    annotationScene=projectAnnotations(annotationPreview||documentValue,{phaseId,frame,model,selectedId:selectedAnnotationId,editing:editingEnabled});
    const sourceSvg=renderPresentationSVG($('tacticsShowReference').checked?projected:{...projected,routes:[]},{space:mode,width,height});
    const marks=renderAnnotationsSVG(annotationScene,{space:mode,width,height}).replace(/^<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'');
    nodes.overlay.innerHTML=sourceSvg.replace('</svg>',`${marks}${drawingMarkup()}${personInspectionMarkup()}</svg>`);drawHandles();drawAnnotationHandles();fillPersonCard();
    const ps=model.presentation,manual=ps.applied.length,stale=ps.stale.length;
    const hidden=projected.routes.filter(r=>mode==='video'&&!r.video).length;
    const authoredVisible=annotationScene.items.filter(a=>a[mode]).length;
    $('tacticsPresentationStatus').textContent=`${authoredVisible?`${authoredVisible} 个画布图形`:'画布已就绪，点击上方工具开始标注'}${annotationScene.stale.length?` · ${annotationScene.stale.length} 个图形需重新定位`:''}${!projected.videoAvailable?' · 当前画面缺少有效标定，可先标注「仅此画面」图形。':''}${$('tacticsShowReference').checked?` · 识别路线参考已显示${manual?`（含 ${manual} 段旧修正）`:''}${stale?`，${stale} 段旧修正已过期`:''}${hidden?`，${hidden} 段当前不可见`:''}`:''}`;
    if(synchronized)$('tacticsFrame').textContent=`${mediaTime.toFixed(2)} 秒 · 第 ${frame+1} 帧 · ${{playing:'播放中',paused:'已暂停',ended:'已结束',seeking:'定位中'}[playback.state().status]||'准备中'}`;
    $('tacticsSeek').min=phase().startFrame;$('tacticsSeek').max=phase().endFrameExclusive-1;$('tacticsSeek').value=playback.state().targetFrame??frame;$('tacticsSeek').disabled=!synchronized||loading||editBusy;
  }
  function drawingMarkup(){
    if(!drawing||!lastScene)return '';
    const pending=drawing.pattern!=='solid'&&drawing.cursor?[...drawing.points,drawing.cursor]:drawing.points;
    const points=pending.map(p=>lastScene.mode===drawing.space?p:drawing.space==='court'?courtToVideo(lastScene.model,lastScene.frame,p):videoToCourt(lastScene.model,lastScene.frame,p)).filter(Boolean);
    if(!points.length)return '';const ratio=(lastScene.mode==='video'?lastScene.model.width:28.6512)/sceneNodes.width;
    if(drawing.pattern!=='solid'){
      const color=drawing.pattern==='dots'?'#ffd45c':'#19a9e1',a=points[0],b=points[1],length=b?Math.hypot(b.x-a.x,b.y-a.y):0;
      let line='';
      if(length>1e-6){
        if(drawing.pattern==='dots'){
          const count=Math.max(1,Math.floor(length/(20*ratio)));
          line=Array.from({length:count+1},(_,i)=>`<circle cx="${a.x+(b.x-a.x)*i/count}" cy="${a.y+(b.y-a.y)*i/count}" r="${5*ratio}" fill="${color}" stroke="#5a4105" stroke-width="${1.5*ratio}"/>`).join('');
        }else{
          const dx=(b.x-a.x)/length,dy=(b.y-a.y)/length,tip=Math.min(length,12*ratio),base={x:b.x-dx*tip,y:b.y-dy*tip};
          line=`<path d="M ${a.x} ${a.y} L ${b.x} ${b.y}" stroke-width="${3*ratio}" stroke-dasharray="${8*ratio} ${5*ratio}"/><polygon data-drawing-arrow="true" points="${b.x},${b.y} ${base.x-dy*5*ratio},${base.y+dx*5*ratio} ${base.x+dy*5*ratio},${base.y-dx*5*ratio}" fill="${color}" stroke="none"/>`;
        }
      }
      return `<g data-drawing-pattern="${drawing.pattern}" pointer-events="none" fill="none" stroke="${color}" stroke-linecap="round">${line}<circle cx="${a.x}" cy="${a.y}" r="${5*ratio}" fill="#ffffff" stroke-width="${2*ratio}"/></g>`;
    }
    return `<g pointer-events="none" fill="none" stroke="#26baff" stroke-linecap="round" stroke-linejoin="round"><polyline stroke-width="${4*ratio}" stroke-dasharray="${7*ratio} ${5*ratio}" points="${points.map(p=>`${p.x},${p.y}`).join(' ')}"/>${points.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="${5*ratio}" fill="#ffffff" stroke-width="${2*ratio}"/>`).join('')}</g>`;
  }
  function drawAnnotationHandles(){
    const svg=sceneNodes?.overlay.querySelector('svg'),item=annotationScene?.items.find(item=>item.id===selectedAnnotationId);if(!svg||!item||!editingEnabled||annotationTool!=='select')return;
    const group=document.createElementNS('http://www.w3.org/2000/svg','g'),ratio=(lastScene.mode==='video'?lastScene.model.width:28.6512)/sceneNodes.width;
    group.setAttribute('data-annotation-handles','true');
    for(const handle of item.handles){
      const p=lastScene.mode==='video'?handle:videoToCourt(lastScene.model,lastScene.frame,handle);if(!p)continue;
      const control=document.createElementNS('http://www.w3.org/2000/svg','g');control.setAttribute('data-annotation-id',item.id);control.setAttribute('data-annotation-control-index',String(handle.index));control.setAttribute('class','tactics-control-handle');
      for(const [r,fill,stroke] of [[15,'transparent','none'],[handle.index===selectedAnnotationPoint?7:5.5,handle.index===selectedAnnotationPoint?'#ffe88a':'#ffffff','#173d55']]){
        const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');for(const [key,value] of Object.entries({cx:p.x,cy:p.y,r:r*ratio,fill,stroke,'stroke-width':2*ratio}))circle.setAttribute(key,String(value));control.append(circle);
      }group.append(control);
    }
    if(item.type==='screen'&&item[lastScene.mode]){
      const a=item.original,center=a.points[0],angle=(a.style.angle-90)*Math.PI/180;
      const far={x:center.x+Math.cos(angle)*(a.space==='court'?1:100),y:center.y+Math.sin(angle)*(a.space==='court'?1:100)};
      const display=p=>a.space===lastScene.mode?p:a.space==='court'?courtToVideo(lastScene.model,lastScene.frame,p):videoToCourt(lastScene.model,lastScene.frame,p);
      const c=display(center),tip=display(far);
      if(c&&tip){
        const length=Math.hypot(tip.x-c.x,tip.y-c.y);
        if(length>1e-6){
          const p={x:c.x+(tip.x-c.x)/length*42*ratio,y:c.y+(tip.y-c.y)/length*42*ratio};
          const line=document.createElementNS('http://www.w3.org/2000/svg','line');
          for(const [key,value] of Object.entries({x1:c.x,y1:c.y,x2:p.x,y2:p.y,stroke:'#5dccff','stroke-width':2*ratio,'stroke-dasharray':`${4*ratio} ${3*ratio}`,'pointer-events':'none'}))line.setAttribute(key,String(value));
          group.append(line);
          const grip=document.createElementNS('http://www.w3.org/2000/svg','g');
          grip.setAttribute('data-annotation-id',item.id);grip.setAttribute('data-annotation-rotate','true');grip.setAttribute('class','tactics-rotation-handle');grip.setAttribute('aria-label','拖动旋转挡拆标记');
          for(const [r,fill,stroke] of [[18,'transparent','none'],[10,'#087dad','#e7f8ff']]){
            const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');for(const [key,value] of Object.entries({cx:p.x,cy:p.y,r:r*ratio,fill,stroke,'stroke-width':2*ratio}))circle.setAttribute(key,String(value));grip.append(circle);
          }
          const icon=document.createElementNS('http://www.w3.org/2000/svg','path'),x=p.x,y=p.y,r=ratio;
          for(const [key,value] of Object.entries({d:`M ${x+4*r} ${y-3*r} A ${5*r} ${5*r} 0 1 0 ${x+4*r} ${y+3*r} M ${x+4*r} ${y-6*r} L ${x+4*r} ${y-2*r} L ${x} ${y-2*r}`,fill:'none',stroke:'#ffffff','stroke-width':1.5*r,'stroke-linecap':'round','stroke-linejoin':'round','pointer-events':'none'}))icon.setAttribute(key,String(value));
          grip.append(icon);group.append(grip);
        }
      }
    }
    svg.append(group);
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
    $('tacticsRouteHint').textContent=editBusy?'正在保存展示修正…':!editingEnabled?'暂停播放后可编辑路线。':loading?'正在加载草稿…':!lastScene?'正在准备路线…':!selectedEntityId?'先选择球员，再查看识别路线。':!route?(lastScene.model.routes.some(r=>r.entityId===selectedEntityId)?'先选择一条合法路线段，再拖动控制点。':'所选球员没有可编辑的连续路线；缺测与审核断点已保留。'):`${route.manual?'人工展示修正':'来源路线'} · ${points.length} 个控制点 · 当前第 ${(points[index]?.frame??route.startFrame)+1} 帧`;
  }
  function drawHandles(){
    const svg=sceneNodes?.overlay.querySelector('svg');if(!svg)return;
    svg.querySelector('[data-edit-handles]')?.remove();
    if(!editor.route||!editingEnabled||!lastScene||!$('tacticsShowReference').checked)return;
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
    const sequence=++loadSequence;loading=true;
    const oldAgent=agentJob;
    clearTimeout(agentTimer);agentCapture=null;agentJob=null;agentBusy=false;agentAdopting=false;
    $('tacticsAgentPreview').replaceChildren();
    if(synchronized)runPlayback(playback.leave());
    clearPreview();const token=epoch;fillRouteControls();agentControls();$('tacticsSnapshot').disabled=true;status('正在读取战术草稿…');
    try{
      if(oldAgent&&['queued','preparing','analyzing','validating'].includes(oldAgent.status))await request(`/api/tactics-agent/jobs/${oldAgent.jobId}/cancel`,{}).catch(()=>{});
      if(sequence!==loadSequence||token!==epoch)return;
      await draft();
      if(serverOnly&&documentValue)await writeTacticsDraft(`${cacheKey()}:before-reload`,clone({version,document:documentValue,phaseId}));
      const stored=serverOnly?null:await readTacticsDraft(cacheKey(nextKind));
      const saved=stored||await request(`/api/tactics?${new URLSearchParams({...base,qa:api.qa?'1':'0',kind:nextKind})}`);
      let next=saved.document;
      if(!next&&nextKind==='candidate')next=await request('/api/tactics/candidate');
      if(next){await validateDocument(next);if(next.review.videoSha256!==api.clip.video_sha256)throw new Error('此战术草稿属于另一段视频。');}
      if(token!==epoch)return;
      kind=nextKind;documentValue=next;version=saved.version||0;phaseId=stored?.phaseId||next?.playDefinition.phases[0].phaseId;history=[];revision++;context++;selectedRouteId=null;selectedControlFrame=null;selectedAnnotationId=null;selectedEntityId=null;staticSpotlight=false;personInspection=null;annotationTool='select';
      const params=new URLSearchParams(location.search);if(kind==='candidate')params.set('candidate','1');else params.delete('candidate');window.history.replaceState(null,'',`/?${params}`);
      await draft();render();$('tacticsSaveState').textContent=stored?'已恢复浏览器草稿':version?`已保存 · 版本 ${version}`:'浏览器草稿';status(next?'先选阶段和工具，在画面直接标注。预览会在下一阶段讲解点暂停。':'点击「建立画布，开始手工标注」，没有识别结果也可以开始。');
    }finally{if(sequence===loadSequence){loading=false;$('tacticsSnapshot').disabled=false;$('tacticsCreateCanvas').disabled=false;fillRouteControls();fillAnnotationControls();agentControls();}}
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
    status('画布已就绪。选择「画路线」「虚线箭头」「传球路线」「挡拆标记」或「重点球员圈」，直接在画面上添加；关联球员可选。');
  });
  $('tacticsCreateCanvas').onclick=()=>$('tacticsSnapshot').onclick();
  $('tacticsCandidate').onclick=safe(async()=>{
    if(api.variant!=='ebard'||api.clip.video_sha256!=='1f7bd135ad8cde5ab877612e596f93200281b6902aac8084fad19a544d20b85d'){
      await draft();await api.beforeNavigate();const params=new URLSearchParams(location.search);params.set('sample','005');params.set('variant','ebard');params.set('area','tactics');params.set('candidate','1');location.assign(`/?${params}`);return;
    }await load('candidate');
  });
  $('tacticsSave').onclick=safe(async()=>{
    if(!documentValue||loading||agentAdopting)return;const d=clone(documentValue),rev=revision,saveKind=kind,saveContext=context;
    const saved=await request('/api/tactics/save',{document:d,expectedVersion:version});
    if(kind!==saveKind||context!==saveContext)return;version=saved.version;await draft();
    status(rev===revision?`已保存到本机 · 版本 ${version}。`:'已保存请求时的版本；之后的新修改仍在浏览器草稿，请再次保存。');
    $('tacticsSaveState').textContent=rev===revision?`已保存 · 版本 ${version}`:'还有修改待保存';$('tacticsSaveState').setAttribute('data-dirty',String(rev!==revision));
    $('tacticsSource').textContent+=` · 已保存版本 ${version}`;
  });
  function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('tacticsJson').onclick=safe(async()=>{const d=clone(documentValue);await validateDocument(d);download(JSON.stringify(d,null,2),`tactics-${api.sample}-${kind}.json`,'application/json');status('已导出全部手绘图形、展示修正、轨迹快照与审核数据。');});
  $('tacticsReport').onclick=safe(async()=>{const d=clone(documentValue);status('正在生成冻结帧报告：仅既有动作与审核，平滑路线和人工展示修正保留在 JSON。');const result=await request('/api/tactics/export',{document:d});download(result.html,`tactics-${api.sample}-${kind}.html`,'text/html');status('已导出冻结帧报告；其中不包含平滑路线或人工展示修正，完整修正请同时导出审核数据 JSON。');});
  $('tacticsUndo').onclick=safe(async()=>{if(editBusy)return;if(drawing?.points.length){drawing.points.pop();if(!drawing.points.length)drawing=null;fillAnnotationControls();drawScene();return;}if(!history.length)return;personInspection=null;cancelEditing();const previous=history.pop();documentValue=previous.document;selectedAnnotationId=previous.selectedAnnotationId;revision++;markUnsaved();await draft();render({reuseScene:true});await sceneReady;fillAnnotationControls();status('已撤销上一次修改。');});
  $('tacticsRoutePlayer').onchange=()=>{const value=$('tacticsRoutePlayer').value;cancelEditing();staticSpotlight=value==='__static__';selectedEntityId=staticSpotlight?null:value||null;personInspection=null;selectedRouteId=null;selectedControlFrame=null;fillRouteOptions();fillAnnotationControls();drawScene();};
  $('tacticsLocatePlayer').onclick=()=>{const details=inspectionDetails();if(!editAllowed()||!details?.target)return;personInspection={entityId:inspectedPlayer(),target:details.target};if(lastScene.frame===details.target.frame&&decodedPersonSource())drawScene();else if(synchronized)seekCanvas(details.target.frame,{inspect:true});else status(`请在视频中定位到第 ${details.target.frame+1} 帧后查看此人物。`);};
  $('tacticsShowReference').onchange=()=>{cancelEditing();if(!$('tacticsShowReference').checked){selectedRouteId=null;editor.select(null);}drawScene();};
  $('tacticsShowAll').onchange=()=>drawScene();
  $('tacticsRoute').onchange=()=>{cancelEditing();selectedAnnotationId=null;annotationTool='select';$('tacticsShowReference').checked=true;selectedRouteId=$('tacticsRoute').value||null;selectedControlFrame=null;fillRouteOptions();drawScene();fillAnnotationControls();};
  $('tacticsControlPoint').onchange=()=>editor.selectPoint(Number($('tacticsControlPoint').value));
  $('tacticsInsertPoint').onclick=safe(async()=>{if(!editBusy&&editingEnabled&&!loading)await editor.insert(Number($('tacticsInsertFrame').value));});
  $('tacticsDeletePoint').onclick=safe(async()=>{if(!editBusy&&editingEnabled&&!loading)await editor.remove();});
  $('tacticsRestoreRoute').onclick=safe(async()=>{
    if(editBusy||!editingEnabled||loading||!editor.route)return;cancelEditing();editBusy=true;fillRouteControls();
    try{await commit(restoreRoute(documentValue,editor.route.routeId),stamp(),{reuseScene:true});status('已恢复来源平滑路线。');}finally{editBusy=false;fillRouteControls();}
  });
  for(const [id,tool] of toolButtons)$(id).onclick=()=>chooseTool(tool);
  $('tacticsFinishDrawing').onclick=safe(finishDrawing);
  $('tacticsCancelDrawing').onclick=()=>{cancelAnnotationGesture();annotationTool='select';fillAnnotationControls();drawScene();};
  $('tacticsAnnotationPoint').onchange=()=>{selectedAnnotationPoint=Number($('tacticsAnnotationPoint').value);fillAnnotationControls();drawScene();};
  $('tacticsAnnotationAddPoint').onclick=()=>{const a=selectedAnnotation();if(!editAllowed()||a?.type!=='route'||straightRoute(a))return;addingAnnotationPoint=true;fillAnnotationControls();};
  $('tacticsAnnotationDeletePoint').onclick=safe(async()=>{
    const a=selectedAnnotation();if(!a||a.type!=='route'||straightRoute(a)||a.points.length<=2||!editAllowed())return;
    const points=a.points.filter((_p,i)=>i!==selectedAnnotationPoint);selectedAnnotationPoint=Math.min(selectedAnnotationPoint,points.length-1);await patchAnnotation({points});
  });
  $('tacticsAnnotationDelete').onclick=safe(deleteSelectedAnnotation);$('tacticsQuickDelete').onclick=safe(deleteSelectedAnnotation);
  $('tacticsRotateLeft').onclick=safe(()=>patchAnnotation({style:{angle:normalizedAngle((selectedAnnotation()?.style.angle||0)-15)}}));
  $('tacticsRotateRight').onclick=safe(()=>patchAnnotation({style:{angle:normalizedAngle((selectedAnnotation()?.style.angle||0)+15)}}));
  $('tacticsDeselect').onclick=deselectAnnotation;
  $('tacticsAnnotationPlayer').onchange=safe(()=>{const entityId=$('tacticsAnnotationPlayer').value||null,a=selectedAnnotation(),foot=entityId&&a?.type==='spotlight'?playerFoot(documentValue,entityId,lastScene.frame,{phaseId,model:lastScene.model}).point:null;return patchAnnotation({entityId,...(a?.type==='spotlight'&&entityId?{anchorMode:'player_foot',offset:{x:0,y:0},...(foot?{points:[foot]}:{})}:{})});});
  $('tacticsAnnotationFollow').onchange=safe(()=>patchAnnotation({followEntity:$('tacticsAnnotationFollow').checked}));
  $('tacticsSnapFoot').onclick=safe(async()=>{const a=selectedAnnotation();if(!a?.entityId)return;const foot=playerFoot(documentValue,a.entityId,lastScene.frame,{phaseId,model:lastScene.model}).point;if(!foot){status('此帧没有有效脚底位置，请定位到球员可见帧。');return;}offsetMode=false;await patchAnnotation({anchorMode:'player_foot',points:[foot],offset:{x:0,y:0}});});
  $('tacticsOffsetMode').onclick=()=>{if(selectedAnnotation()?.anchorMode!=='player_foot'||!editAllowed())return;offsetMode=!offsetMode;fillAnnotationControls();};
  $('tacticsAgentRun').onclick=generateAgent;$('tacticsAgentAdopt').onclick=adoptAgent;
  $('tacticsAgentCancel').onclick=async()=>{if(!agentJob||agentAdopting)return;const job=agentJob,captured=agentCapture;try{clearTimeout(agentTimer);await receiveAgent(await request(`/api/tactics-agent/jobs/${job.jobId}/cancel`,{}),captured);}catch(error){if(agentCapture===captured)agentStatus(error.message);}};
  $('tacticsAnnotationAngle').onchange=safe(()=>patchAnnotation({style:{angle:Number($('tacticsAnnotationAngle').value)}}));
  $('tacticsAnnotationSize').onchange=safe(()=>patchAnnotation({style:{size:Number($('tacticsAnnotationSize').value)}}));
  $('tacticsAnnotationColor').onchange=safe(()=>patchAnnotation({style:{color:$('tacticsAnnotationColor').value}}));
  $('tacticsAnnotationApplyTime').onclick=safe(()=>patchAnnotation({startFrame:Number($('tacticsAnnotationStart').value)-1,endFrameExclusive:Number($('tacticsAnnotationEnd').value)}));
  $('tacticsAnnotationRebind').onclick=safe(()=>patchAnnotation({phaseId,frame:lastScene.frame}));
  $('tacticsSeek').oninput=()=>seekCanvas(Number($('tacticsSeek').value));
  const host=$('tacticsCanvas');
  host.addEventListener('pointerdown',async event=>{
    if(event.button!==0||loading||editBusy||!editingEnabled||!lastScene)return;
    // Prevented SVG pointer events do not focus the host on their own; focus it
    // explicitly so Delete edits the selected object after leaving a number field.
    host.focus?.({preventScroll:true});if(editBusy)return;
    try{
      const point=canvasPoint(event);
      if(point&&addingAnnotationPoint){
        const a=selectedAnnotation();if(!a||a.type!=='route'||straightRoute(a))return;
        const p=originalPoint(point,a.space);if(!p){status('当前画面无法定位这个控制点，请回到绘制帧再试。');return;}
        const points=structuredClone(a.points),index=selectedAnnotationPoint+1;points.splice(index,0,{x:p.x,y:p.y});addingAnnotationPoint=false;selectedAnnotationPoint=index;await patchAnnotation({points});return;
      }
      if(point&&['route','dashed','dots'].includes(annotationTool)){
        if(!drawing){const located=annotationPointFromVideo(lastScene.model,lastScene.frame,point);drawing={space:located.space,points:[located.point],frame:lastScene.frame,stamp:stamp(),pattern:annotationTool==='route'?'solid':annotationTool};}
        else if(drawing.points.length>=ANNOTATION_LIMITS.points){status(`一条路线最多 ${ANNOTATION_LIMITS.points} 个点，点「完成绘制」后可继续拖动调整。`);return;}
        else{
          const p=originalPoint(point,drawing.space);if(!p){status('这个位置暂时不能对应到球场，请选择画面内的球场位置。');return;}
          if(drawing.pattern!=='solid'&&Math.hypot(p.x-drawing.points[0].x,p.y-drawing.points[0].y)<=1e-6){status('起点与终点不能重合，请在另一处点击终点。');return;}
          drawing.points.push({x:p.x,y:p.y});
        }
        $('tacticsUndo').disabled=false;event.preventDefault();
        if(drawing.pattern!=='solid'&&drawing.points.length===2){await finishDrawing();return;}
        fillAnnotationControls();drawScene();return;
      }
      if(point&&['screen','spotlight'].includes(annotationTool)){
        if(annotationTool==='spotlight'){
          if(staticSpotlight){await placeSpotlight(null,point);event.preventDefault();return;}
          const hits=playersAtVideoPoint(documentValue,lastScene.frame,point,{phaseId,model:lastScene.model});
          if(hits.length>1){footCandidates=hits;fillAnnotationControls();status('这里有多个球员重叠，请在右侧选择脚圈跟随谁。');return;}
          const personId=hits[0]?.id??selectedEntityId;if(!personId){status('请先选择球员或点击人物；若只需静态圈，请明确选择“静态圈（不跟随球员）”。');return;}
          await placeSpotlight(personId,point);event.preventDefault();return;
        }
        const located=annotationPointFromVideo(lastScene.model,lastScene.frame,point),id=`draw-${crypto.randomUUID()}`;
        const next=createAnnotation(documentValue,{id,type:annotationTool,phaseId,entityId:selectedEntityId||null,frame:lastScene.frame,space:located.space,points:[located.point],style:{color:'#ffd34e'}});
        selectedAnnotationId=id;selectedAnnotationPoint=0;annotationTool='select';event.preventDefault();await saveAnnotation(next);return;
      }
      if(point&&annotationTool==='select'){
        const rotate=event.target.closest('[data-annotation-rotate]'),handle=event.target.closest('[data-annotation-control-index]'),annotationId=event.target.closest('[data-annotation-id]')?.getAttribute('data-annotation-id');
        const hit=annotationId?{id:annotationId,index:handle?Number(handle.getAttribute('data-annotation-control-index')):null}:hitTestAnnotation(annotationScene,point,12*lastScene.model.width/sceneNodes.width);
        if(hit){
          const adjustingOffset=offsetMode&&selectedAnnotationId===hit.id;selectAnnotation(hit.id);offsetMode=adjustingOffset;selectedAnnotationPoint=hit.index??0;
          const a=selectedAnnotation(),start=originalPoint(point,a.space),item=annotationScene.items.find(item=>item.id===a.id);
          if(a.anchorMode==='player_foot'&&!offsetMode){fillAnnotationControls();drawScene();return;}
          if(start&&item?.video){
            const center=a.points[0],rotating=!!rotate&&a.type==='screen';
            annotationDrag={pointerId:event.pointerId,id:a.id,kind:rotating?'rotate':a.anchorMode==='player_foot'?'offset':'move',offset:{...(a.offset||{x:0,y:0})},index:hit.index,start,points:structuredClone(a.points),space:a.space,stamp:stamp(),angleOffset:rotating?a.style.angle-Math.atan2(start.y-center.y,start.x-center.x)*180/Math.PI:0};
            host.setPointerCapture(event.pointerId);event.preventDefault();
          }
          fillAnnotationControls();drawScene();return;
        }
      }
    }catch(error){status(error.message);return;}
    const handle=event.target.closest('[data-control-index]');
    if(handle&&$('tacticsShowReference').checked){api.pause();if(editor.begin(Number(handle.getAttribute('data-control-index')),event.pointerId)){host.setPointerCapture(event.pointerId);event.preventDefault();}return;}
    const routeId=event.target.closest('[data-route-id]')?.getAttribute('data-route-id');
    const route=lastScene.model.routes.find(r=>r.routeId===routeId);if(!route||!$('tacticsShowReference').checked)return;
    api.pause();cancelEditing();selectedEntityId=route.entityId;$('tacticsRoutePlayer').value=selectedEntityId;selectedRouteId=routeId;selectedControlFrame=null;fillRouteOptions();drawScene();
  });
  host.addEventListener('pointermove',event=>{
    if(drawing?.pattern!=='solid'&&drawing&&lastScene){
      const videoPoint=canvasPoint(event);drawing.cursor=videoPoint&&originalPoint(videoPoint,drawing.space);drawScene();return;
    }
    if(annotationDrag?.pointerId===event.pointerId&&lastScene){
      const videoPoint=canvasPoint(event),point=videoPoint&&originalPoint(videoPoint,annotationDrag.space);if(!point)return;
      const drag=annotationDrag,dx=point.x-drag.start.x,dy=point.y-drag.start.y;
      let patch;
      if(drag.kind==='rotate'){
        const center=drag.points[0];if(Math.hypot(point.x-center.x,point.y-center.y)<1e-6)return;
        patch={style:{angle:normalizedAngle(Math.atan2(point.y-center.y,point.x-center.x)*180/Math.PI+drag.angleOffset)}};
      }else if(drag.kind==='offset')patch={offset:{x:drag.offset.x+dx,y:drag.offset.y+dy}};
      else patch={points:drag.points.map((p,i)=>drag.index===null||i===drag.index?{x:p.x+dx,y:p.y+dy}:p)};
      try{annotationPreview=updateAnnotation(documentValue,drag.id,patch);drawScene();if(patch.style)$('tacticsQuickAngle').textContent=`${patch.style.angle}°`;event.preventDefault();}catch{/* Keep the last valid point inside the picture/court. */}return;
    }
    if(!editor.dragging||!lastScene)return;
    const point=screenToCourt(sceneNodes?.overlay.querySelector('svg'),event,{space:lastScene.mode,model:lastScene.model,frame:lastScene.frame});
    if(point&&editor.move(point,event.pointerId))event.preventDefault();
  });
  // Keep capture on the stable host while the SVG itself is replaced for previews.
  host.addEventListener('pointerup',async event=>{
    try{
      if(annotationDrag?.pointerId===event.pointerId){const drag=annotationDrag,next=annotationPreview;annotationDrag=null;annotationPreview=null;
        if(next&&JSON.stringify(next.annotations)!==JSON.stringify(documentValue.annotations))await saveAnnotation(next,drag.stamp);else drawScene();return;
      }await editor.end(event.pointerId);
    }catch(error){status(error.message);temporaryRoute=null;annotationPreview=null;drawScene();}
    finally{if(host.hasPointerCapture(event.pointerId))host.releasePointerCapture(event.pointerId);}
  });
  host.addEventListener('pointercancel',event=>{cancelEditing();if(host.hasPointerCapture(event.pointerId))host.releasePointerCapture(event.pointerId);drawScene();});
  document.addEventListener('keydown',async event=>{
    if(!active||['INPUT','SELECT','TEXTAREA'].includes(event.target?.tagName)||event.target?.isContentEditable)return;
    if(event.key==='Escape'){const gesturing=!!(drawing||annotationDrag||addingAnnotationPoint);cancelEditing();annotationTool='select';if(!gesturing)selectedAnnotationId=null;fillAnnotationControls();drawScene();event.preventDefault();}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();await $('tacticsUndo').onclick();}
    else if(event.key==='Delete'||event.key==='Backspace'){if(selectedAnnotation()){event.preventDefault();await $('tacticsAnnotationDelete').onclick();}}
    else if(event.key==='Enter'&&drawing){event.preventDefault();await $('tacticsFinishDrawing').onclick();}
  });
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
  for(const [id,field] of [['tacticsTitle','title'],['tacticsNotes','notes']])$(id).oninput=()=>{if(documentValue){documentValue[field]=$(id).value;revision++;markUnsaved();draft();}};
  const resize=new ResizeObserver(()=>{try{drawScene();}catch(error){status(error.message);}});resize.observe($('tacticsCanvas'));
  document.addEventListener('workbench-area',safe(async()=>{
    active=document.body.dataset.area==='tactics';if(!active){epoch++;cancelEditing();if(synchronized)runPlayback(playback.leave());return;}api.pause();editingEnabled=true;
    if(!documentValue&&!loading)await load(new URLSearchParams(location.search).has('candidate')?'candidate':'workspace');
    else if(documentValue){if(synchronized)selectPhase(phaseId);else drawScene();}
    await syncSnapshot();agentControls();
    try{const executor=await request('/api/tactics-agent/status');agentAvailable=executor.available;if(!agentJob&&!agentBusy)agentStatus(executor.message);agentControls();}catch(error){agentAvailable=false;if(!agentJob&&!agentBusy)agentStatus(`Agent 服务不可用：${error.message}`);agentControls();}
  }));
  function renderFrame(frame,mediaTime,backgroundSource,{editing=true}={}){
    if(!lastScene||loading)return false;
    const modeChanged=editingEnabled!==editing;
    if(!editing){personInspection=null;cancelEditing();}editingEnabled=editing;
    lastScene.frame=frame;lastScene.mediaTime=mediaTime;lastScene.backgroundSource=backgroundSource;
    drawScene();if(modeChanged){fillRouteControls();fillAnnotationControls();}return true;
  }
  render();return {saveDraft:draft,ready:()=>sceneReady,cancelEditing,onPresentedFrame,
    getPlaybackState:playback.state,
    togglePlayback(){if(!active)return false;if(playback.state().status==='playing')$('tacticsPause').onclick();else $('tacticsContinue').onclick();return true;},
    externalSeek(frame){
      if(!active||!synchronized)return;personInspection=null;cancelEditing();
      const commands=playback.externalSeek(frame);runPlayback(commands);
      // Time navigation within one phase does not invalidate its document model.
      // An in-flight rebuild reads the latest presented frame when it applies;
      // keep its promise so an editing commit stays busy until that model is ready.
      // Cross-phase rendering, loads and exit still invalidate obsolete models.
      if(!lastScene&&!loading&&pendingSceneEpoch!==epoch&&!commands.some(c=>c.type==='phase'))render({preserveFrame:true});
    },
    invalidatePreview(){epoch++;cancelEditing();},
    getSceneState:()=>({model:lastScene?.model,phase:phase(),phaseId,frame:lastScene?.frame,mediaTime:lastScene?.mediaTime,active,loading,editBusy,editingEnabled,selectedEntityId,showAll:$('tacticsShowAll').checked,background:sceneNodes?.background,annotations:documentValue?.annotations||{schemaVersion:1,items:[]},drawingPoints:drawing?.points.length||0,selectedAnnotationId}),
    renderFrame};
}
