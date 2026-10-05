import {createManualAnnotation,duplicateAnnotation,correctAnnotationProgress,nearestRouteProgress} from './tactics-manual-editor.mjs';
import {removeTacticKeyframe} from './tactics-keyframes.mjs';
import {mountTacticsTimeline} from './tactics-timeline-ui.mjs';
import {createCourtAnnotation} from './tactics-court-editor.mjs';
import {compileTacticKeyframes} from './tactics-keyframes.mjs';
import {migrateTacticsDocument} from './tactics-document.mjs';
import {COURT} from './court.mjs';
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
import {mountTacticsProductionUI} from './tactics-production-ui.mjs';
import {updateProductionCamera,updateProductionCue,updateAuthoredProgress,productionCue,rebindIndependentProduction} from './tactics-production.mjs';

export function mountTacticsUI(api){
  const $=id=>document.getElementById(id),root=$('tacticsPanel');
  root.innerHTML=`<div class="tactics-heading"><div><h2>战术画布</h2><span class="tactics-subtitle">选时间 · 在视频上画 · 暂停讲解 · 导出</span></div><div class="tactics-buttons"><span id="tacticsSaveState" class="tactics-save-state">正在读取</span><button id="tacticsUndo" title="撤销上一次修改（Ctrl / ⌘ Z）">撤销</button><button id="tacticsRedo">重做</button><button id="tacticsSave" class="primary">保存</button><button id="tacticsPreviewCurrent">成片效果预览</button><button id="tacticsExportCurrent">导出 MP4</button></div></div>
  <p id="tacticsStatus" role="status" aria-live="polite">正在读取当前视频的战术草稿。</p>
  <details class="tactics-production-panel"><summary>成片预览</summary><section id="tacticsRender" class="tactics-production"></section></details>
  <details id="tacticsAgentPanel" class="tactics-agent-panel"><summary>Agent 战术初稿</summary><p class="small muted">Agent 根据已采用的 2D 轨迹和所选时间段生成路线与讲解点；你核对并采用后，再手工修改。生成失败也可继续手工编辑。</p><div class="tactics-agent-inputs"><label class="field">分析范围<select id="tacticsAgentScope"><option value="range">所选秒级区间，追加初稿</option><option value="play">整段视频，建立阶段</option><option value="phase">当前阶段，追加初稿</option></select></label><label class="field">希望讲清楚什么<input id="tacticsAgentGoal" maxlength="2000" placeholder="例如：持球掩护后切入与弱侧跑位"></label><button id="tacticsAgentRun" class="primary">生成战术初稿</button><button id="tacticsAgentCancel" hidden>取消生成</button></div><p id="tacticsAgentStatus" role="status" aria-live="polite">先生成初稿，再核对修改；当前人工草稿会保留。</p><div id="tacticsAgentPreview" class="tactics-agent-preview"></div><button id="tacticsAgentAdopt" class="primary" hidden disabled>采用到草稿，继续编辑</button></details>
  <div id="tacticsEmpty" class="tactics-empty" hidden><strong>先建立这个视频的战术画布</strong><p>没有识别结果也能画路线、虚线箭头、传球路线，或放挡拆标记和重点球员圈。</p><div id="tacticsEmptyActions" class="tactics-buttons"><button id="tacticsCreateCanvas" class="primary">建立画布，开始手工标注</button></div></div>
  <div id="tacticsEditor" hidden><div id="tacticsPhases" class="tactics-phases" aria-label="选择战术阶段"></div>
  <div class="tactics-layout"><section class="tactics-view"><div class="tactics-author-tools" role="toolbar" aria-label="画布工具">
  <button id="tacticsToolSelect" aria-pressed="true"><span aria-hidden="true">↖</span>选择 / 修改</button><button id="tacticsToolRoute" aria-pressed="false"><span aria-hidden="true">↗</span>跑位</button><button id="tacticsToolDashed" aria-pressed="false"><span aria-hidden="true">⇢</span>传球</button><button id="tacticsToolScreen" aria-pressed="false"><span aria-hidden="true">⊣</span>挡拆标记</button><details class="tactics-more-tools"><summary>更多标记</summary><button id="tacticsToolDots" aria-pressed="false">黄色圆点传球</button><button id="tacticsToolSpotlight" aria-pressed="false">重点球员圈</button></details></div>
  <div class="tactics-instruction"><p id="tacticsToolHint" role="status" aria-live="polite">选择一个工具，在视频画面上直接操作。</p><div class="tactics-buttons"><button id="tacticsFinishDrawing" class="primary" hidden>完成绘制</button><button id="tacticsCancelDrawing" hidden>取消</button></div></div>
  <div id="tacticsSelectionActions" class="tactics-selection-actions" role="toolbar" aria-label="选中图形操作" hidden><strong id="tacticsSelectionName"></strong><div id="tacticsSelectionRotation" class="tactics-rotation-actions"><button id="tacticsRotateLeft" title="向左旋转 15 度">↶ 左转 15°</button><output id="tacticsQuickAngle" aria-label="挡拆朝向"></output><button id="tacticsRotateRight" title="向右旋转 15 度">右转 15° ↷</button></div><button id="tacticsDuplicate">复制</button><button id="tacticsQuickDelete" class="tactics-danger" title="删除选中的图形（Delete）">删除图形</button><button id="tacticsDeselect">取消选择</button></div>
  <details class="tactics-coordinate-settings"><summary>坐标与高级画布</summary><label>新标注坐标<select id="tacticsCoordinateMode"><option value="auto">有映射时贴地；否则固定画面</option><option value="fixed">固定画面标注</option></select></label><button id="tacticsCourtView">2D 球场编辑</button><button id="tacticsVideoView">返回视频画布</button><button id="tacticsMigrate">迁移旧稿到秒级工作流（保留副本）</button></details><canvas id="tacticsSyncVideo" width="320" height="180" aria-label="原视频同步核对窗"></canvas><div id="tacticsCanvas" class="tactics-canvas" tabindex="0" aria-label="战术画布，使用上方工具在视频上添加或修改图形"><p>选择阶段后预览。</p></div>
  <div class="tactics-transport"><div class="tactics-buttons"><button id="tacticsContinue" class="primary">逐点检查</button><button id="tacticsPause">暂停</button><button id="tacticsReplay">重播本段</button></div><span id="tacticsFrame" class="small muted"></span><label class="tactics-source-position">原片时间（秒）<input id="tacticsSourceTime" type="number" min="0" step=".001" placeholder="输入定位时间"><button id="tacticsSourceSeek">定位</button></label></div><label class="tactics-seek"><span>原片定位</span><input id="tacticsSeek" type="range" min="0" max="1" value="0" aria-label="当前阶段视频进度"></label>
  <div class="tactics-cue-controls"><p id="tacticsCueStatus" class="small muted" role="status" aria-live="polite"></p><div id="tacticsCueList" class="tactics-buttons" aria-label="跳到标记讲解画面"></div></div>
  <p id="tacticsPresentationStatus" class="small muted" role="status" aria-live="polite"></p></section>
  <aside class="tactics-controls" aria-label="图形操作"><div class="tactics-property-heading"><strong id="tacticsSelectedTitle">新建图形</strong><span id="tacticsObjectCount" class="small muted"></span></div>
  <details class="tactics-person-settings"><summary>关联球员（可选）</summary><label id="tacticsNewPlayerField" class="field"><span id="tacticsNewPlayerLabel">路线属于谁（可选）</span><select id="tacticsRoutePlayer"></select></label>
  <label id="tacticsExistingPlayerField" class="field" hidden><span id="tacticsAnnotationPlayerLabel">路线属于谁（可选）</span><select id="tacticsAnnotationPlayer"></select></label>
  <section class="tactics-person-card" aria-label="关联球员预览"><strong id="tacticsPersonName">尚未关联球员</strong><div class="tactics-person-preview"><canvas id="tacticsPersonImage" width="112" height="144" aria-label="所选球员的准确帧裁切" hidden></canvas><div><p id="tacticsPersonDescription"></p><p id="tacticsPersonFrame" class="small muted"></p><p id="tacticsPersonReview" class="small muted"></p></div></div><button id="tacticsLocatePlayer" disabled>在画面中查看</button><p class="small muted">P 编号是本视频的球员槽位，不是球衣号码。查看只临时高亮，不修改图形归属。</p></section></details>
  <p id="tacticsSelectionHint" class="small muted">先选上方工具，再点击画面。已添加的图形也可以在下面选中。</p>
  <div id="tacticsFootCandidates" class="tactics-foot-candidates" hidden></div>
  <div id="tacticsAnnotationProperties" hidden><label class="field">标注名称（仅编辑）<input id="tacticsAnnotationName" maxlength="120"></label><p id="tacticsFirstCue" class="small muted"></p><button id="tacticsUnlinkCue">解除首次讲解关联</button><details id="tacticsRhythm"><summary>校正移动节奏</summary><p class="small muted">按时间裁短，不识别球员位置；只有节奏不吻合时才校正。定位动作中的画面，点击按钮，再点淡色完整路线；辅助线不进入成片。</p><button id="tacticsCorrectHere">此刻走到这里</button><button id="tacticsCorrectionCancel" hidden>取消校正</button><div id="tacticsCorrectionList"></div></details><details id="tacticsTangentSettings"><summary>精细曲线与样式</summary><label class="tactics-check"><input id="tacticsShowTangents" type="checkbox">显示两只独立弯曲手柄</label></details>
  <div id="tacticsAnnotationRouteFields"><label class="field">当前控制点<select id="tacticsAnnotationPoint"></select></label><div class="tactics-buttons"><button id="tacticsAnnotationAddPoint">＋ 加转弯点</button><button id="tacticsAnnotationDeletePoint">删此点</button></div></div>
  <div id="tacticsAuthoredFields" hidden><p class="small muted">四点曲线：起点、出发手柄、到达手柄、终点。只调整展示，不修改人物轨迹。</p><button id="tacticsAuthoredReference">回参考帧调曲线</button><details><summary>路线完成进度</summary><p class="small muted">视频到达此帧时，路线已完成对应比例；成片只显示剩余路线。缩短显示时间会移除区间外进度点。</p><label class="field">进度关键点<select id="tacticsProgressPoint"></select></label><div class="range-fields"><label class="field">原视频帧<input id="tacticsProgressFrame" type="number" min="1"></label><label class="field">完成百分比<input id="tacticsProgressValue" type="number" min="0" max="100" step="1"></label></div><div class="tactics-buttons"><button id="tacticsProgressApply">应用进度</button><button id="tacticsProgressAdd">增加关键点</button><button id="tacticsProgressDelete">删除关键点</button></div></details></div>
  <label id="tacticsDisplayModeField" class="field" hidden>播放时的路线<select id="tacticsDisplayMode"><option value="remaining">随动作变短</option><option value="full">全程保留</option></select></label><label id="tacticsAnnotationAngleField" class="field">挡拆朝向（度）<input id="tacticsAnnotationAngle" type="number" min="0" max="359" step="5"></label>
  <label id="tacticsAnnotationFollowField" class="tactics-check"><input id="tacticsAnnotationFollow" type="checkbox">跟随关联球员</label>
  <div id="tacticsFootControls" class="tactics-foot-controls" hidden><p id="tacticsFootStatus" class="small muted"></p><div class="tactics-buttons"><button id="tacticsSnapFoot">重新贴脚</button><button id="tacticsOffsetMode" aria-pressed="false">微调偏移</button></div></div>
  <div class="range-fields"><label class="field">大小<select id="tacticsAnnotationSize"><option value="0.75">较小</option><option value="1">标准</option><option value="1.5">较大</option><option value="2">醒目</option></select></label><label class="field">颜色<select id="tacticsAnnotationColor"><option value="#26baff">蓝色</option><option value="#ffd34e">黄色</option><option value="#ff7b55">橙色</option><option value="#8fe3b0">绿色</option></select></label></div>
  <div class="tactics-buttons"><button id="tacticsAnnotationDelete" class="tactics-danger">删除选中图形</button><button id="tacticsAnnotationRebind" hidden>在本帧重新定位</button></div>
  <details class="tactics-time-settings"><summary>显示时间</summary><div class="range-fields"><label class="field">开始帧<input id="tacticsAnnotationStart" type="number" min="1"></label><label class="field">结束帧<input id="tacticsAnnotationEnd" type="number" min="1"></label></div><button id="tacticsAnnotationApplyTime">应用显示时间</button></details></div>
  <div class="tactics-object-heading"><h3>标注列表</h3><span class="small muted">点击选中</span></div><div id="tacticsObjectList" class="tactics-object-list"></div><p id="tacticsObjectEmpty" class="small muted">还没有图形。选择「画路线」「虚线箭头」「传球路线」，或放一个挡拆标记 / 脚底圈。</p>
  <details id="tacticsArchive" class="tactics-archive" hidden><summary id="tacticsArchiveTitle">已移除球员的图形</summary><p class="small muted">来源移除球员后，图形保留在这里。选择当前球员并恢复到本阶段。</p><label class="field">恢复后关联<select id="tacticsArchivePlayer"></select></label><div id="tacticsArchiveList" class="tactics-object-list"></div></details>
  </aside></div></div>
  <div class="tactics-secondary"><details id="tacticsProductionSettings"><summary>冻结动画与示意相机</summary><div class="tactics-secondary-grid"><section><label class="field">冻结讲解点<select id="tacticsProductionCue"></select></label><div class="tactics-timing-fields"><label class="field">绘制前（秒）<input id="tacticsCueSettle" type="number" min="0" max="30" step="0.1"></label><label class="field">绘制（秒）<input id="tacticsCueDraw" type="number" min="0" max="30" step="0.1"></label><label class="field">绘制后（秒）<input id="tacticsCueHold" type="number" min="0" max="30" step="0.1"></label></div><button id="tacticsApplyCue">应用冻结时长</button></section><section><label class="field">示意相机<select id="tacticsProductionCamera"></select></label><label class="field">相机参考帧<select id="tacticsCameraFrame"></select></label><p id="tacticsCameraStatus" class="small muted"></p><div class="tactics-buttons"><button id="tacticsEditCamera">定位并调整四角</button><button id="tacticsFinishCamera" hidden>结束角点调整</button></div><p class="small muted">这是近似地面投影，修改会影响关联路线；不会改写球场标定或人工核对结果。拖角点后可撤销。</p></section></div><div class="tactics-production-removal"><button id="tacticsRebindProduction">重新绑定此视频编排</button><p id="tacticsProductionRebindHint" class="small muted"></p></div><div class="tactics-production-removal"><button id="tacticsRemoveProduction" class="tactics-danger">移除成片编排</button><p class="small muted">保留图形与控制点，移除镜头跟随、路线进度和冻结动画；编排路线退回参考帧静态图形，之后可重新生成。此操作可撤销。</p></div></details><details id="tacticsPhaseSettings"><summary>阶段设置</summary><div class="tactics-secondary-grid"><label class="field">作品标题<input id="tacticsTitle" maxlength="120"></label><label class="field">阶段名称<input id="tacticsPhaseTitle" maxlength="100"></label><p id="tacticsPhaseRange" class="small muted"></p><div class="range-fields"><label class="field">暂停讲解帧<input id="tacticsFreeze" type="number" min="1"></label><button id="tacticsUseFrame">用当前帧</button></div><button id="tacticsApplyPhase">更新阶段</button><div class="range-fields"><label class="field">从此帧分为下一阶段<input id="tacticsSplitAt" type="number" min="2"></label><button id="tacticsSplit">分段</button></div><button id="tacticsRemovePhase">合并当前阶段</button></div></details>
  <details id="tacticsReferenceDetails"><summary>识别路线参考</summary><p class="small muted">需要参考机器识别时再打开。手绘路线独立保存，不要求先有识别路线。</p><label class="tactics-check"><input id="tacticsShowReference" type="checkbox">在画面显示识别路线</label><label class="tactics-check"><input id="tacticsShowAll" type="checkbox">显示全部球员参考路线</label><label class="field">原始路线段<select id="tacticsRoute"></select></label><p id="tacticsRouteHint" class="small muted" role="status"></p><label class="field">参考路线控制点<select id="tacticsControlPoint"></select></label><label class="field">插入控制点的帧<select id="tacticsInsertFrame"></select></label><div class="tactics-buttons"><button id="tacticsInsertPoint">插入控制点</button><button id="tacticsDeletePoint">删除控制点</button><button id="tacticsRestoreRoute">恢复来源路线</button></div></details>
  <details id="tacticsActionReview"><summary>动作审核与讲解</summary><div class="tactics-secondary-grid"><label class="field">选择动作<select id="tacticsAction"></select></label><label class="field">执行球员<select id="tacticsActor"></select></label><label class="field">动作类型<select id="tacticsKind"></select></label><div class="range-fields"><label class="field">起始帧<input id="tacticsStart" type="number" min="1"></label><label class="field">结束帧（包含）<input id="tacticsEnd" type="number" min="1"></label></div><div id="tacticsScreenFields"><label class="field">受掩护球员<select id="tacticsBeneficiary"></select></label><label class="field">相关防守者<select id="tacticsDefender"></select></label><p class="small muted">这里记录动作关系；画面上的挡拆符号用上方「挡拆标记」添加。</p></div><label class="field">动作说明<input id="tacticsActionNote" maxlength="300"></label><div class="tactics-buttons"><button id="tacticsApplyAction">保存动作记录</button><button id="tacticsDeleteAction">删除动作</button></div><label class="field">审核人<input id="tacticsReviewer" maxlength="80" placeholder="你的姓名或账号"></label><div class="tactics-buttons"><button id="tacticsConfirmAction">我已核对本动作</button><button id="tacticsUnconfirmAction">撤回动作审核</button></div><p id="tacticsActionStatus" class="small muted"></p><label class="field">讲解草稿与审核意见<textarea id="tacticsNotes" rows="4" maxlength="8000" placeholder="记录看到的动作、配合关系和需要改进的地方"></textarea></label></div></details>
  <details id="tacticsAdvanced"><summary>来源、草稿与导出</summary><p id="tacticsSource" class="tactics-source"></p><div class="tactics-buttons"><button id="tacticsSnapshot">使用当前轨迹建立草稿</button><button id="tacticsCandidate">THY 三阶段示例</button><button id="tacticsWorkspace">当前视频草稿</button><button id="tacticsReload">重新读取已保存版本</button><button id="tacticsIdentity">核对球员</button><button id="tacticsCalibration">核对球场</button><button id="tacticsJson">导出完整数据 JSON</button><button id="tacticsReport">导出审核冻结报告</button></div><p class="small muted">完整数据含所有手绘路线、挡拆标记和重点球员圈。审核冻结报告仅包含原有动作与审核，不包含新画布图形。</p><div id="tacticsRoster" class="tactics-roster"></div><div id="tacticsIssues"></div></details></div>`;
  let documentValue=null,phaseId=null,kind='workspace',version=0,history=[],redo=[],revision=0,epoch=0,context=0,loading=false,lastScene=null,active=false,pendingDraft=Promise.resolve();
  let selectedEntityId=api.selectedEntityId?.()??null,selectedRouteId=null,selectedControlFrame=null,temporaryRoute=null,editBusy=false,sceneReady=Promise.resolve(),sceneNodes=null,editingEnabled=true,loadSequence=0;
  const playback=createPhasePlayback(),synchronized=typeof api.seek==='function'&&typeof api.play==='function';
  let presentedPoint=null,pendingSceneEpoch=null;
  let annotationTool='select',selectedAnnotationId=null,selectedAnnotationPoint=0,drawing=null,annotationDrag=null,annotationPreview=null,annotationScene=null,addingAnnotationPoint=false;
  let offsetMode=false,footCandidates=[],agentJob=null,agentCapture=null,agentTimer=null,agentBusy=false,agentAdopting=false,agentAvailable=null;
  let staticSpotlight=false,personInspection=null,agentSelectedIds=new Set();
  let cameraEditing=null,cameraDrag=null,productionPreview=null,progressIndex=0;
  let canvasView='video',rangePlayback=null,holdTimer=null,correctionMode=false,correctionFrame=null,correctionDrag=null,savePromise=null;
  let cueDocument=null,markerCues=[],cueListSignature='';
  const base={sample:api.sample,variant:api.variant,qa:api.qa},cacheKey=(space=kind)=>`${api.key}:tactics:${space}`;
  const phase=()=>documentValue?.playDefinition.phases.find(p=>p.phaseId===phaseId)||documentValue?.playDefinition.phases[0];
  const status=text=>{$('tacticsStatus').textContent=text;};
  const stamp=()=>({document:documentValue,context,phaseId,revision,loading});
  const annotations=()=>documentValue?.annotations?.items||[];
  function pausePoints(){if(cueDocument!==documentValue){cueDocument=documentValue;markerCues=documentValue?(documentValue.schemaVersion===2&&!documentValue.legacyTiming?compileTacticKeyframes(documentValue):annotationPausePoints(documentValue)):[];}return markerCues;}
  const annotationInPanel=a=>a.phaseId===phaseId||!documentValue.playDefinition.phases.some(p=>p.phaseId===a.phaseId);
  const selectedAnnotation=()=>annotations().find(a=>a.id===selectedAnnotationId&&annotationInPanel(a))||null;
  const typeNames={route:'跑位',dashed:'传球',dots:'圆点传球',screen:'挡拆标记',spotlight:'重点球员圈'};
  const toolButtons=[['tacticsToolSelect','select'],['tacticsToolRoute','route'],['tacticsToolDashed','dashed'],['tacticsToolDots','dots'],['tacticsToolScreen','screen'],['tacticsToolSpotlight','spotlight']];
  const straightRoute=a=>a?.type==='route'&&['dashed','dots'].includes(a.style.pattern);
  const annotationName=a=>a?.name|| (a?.authoredPath?'编排曲线':typeNames[straightRoute(a)?a.style.pattern:a?.type]||'图形');
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
  function markUnsaved(){$('tacticsSaveState').textContent='浏览器草稿 · 待保存';$('tacticsSaveState').setAttribute('data-dirty','true');void productionUI.sync();}
  const normalizedAngle=value=>Math.round(((value%360+360)%360)*10)/10%360;
  function cancelAnnotationGesture(){
    const pointerId=annotationDrag?.pointerId??cameraDrag?.pointerId,host=$('tacticsCanvas');
    if(pointerId!==undefined&&host.hasPointerCapture(pointerId))host.releasePointerCapture(pointerId);
    drawing=null;annotationDrag=null;annotationPreview=null;addingAnnotationPoint=false;cameraDrag=null;productionPreview=null;
  }
  function chooseTool(tool){
    cameraEditing=null;
    if(!editAllowed())return;
    if(tool!=='select'&&documentValue.schemaVersion===2&&!timeline.range()){timelineInstance?.focusRange();return;}
    cancelEditing();footCandidates=[];offsetMode=false;selectedRouteId=null;editor.select(null);annotationTool=tool;
    personInspection=null;if(tool!=='select'){if(selectedAnnotationId){selectedEntityId=null;staticSpotlight=false;}selectedAnnotationId=null;}
    fillAnnotationControls();drawScene();
  }
  function selectAnnotation(id){
    cameraEditing=null;progressIndex=0;
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
      correctionMode?'在淡色完整路线点击当前已经走到的位置；Esc 取消。':annotationTool==='route'?(drawing?`已点 ${drawing.points.length} 个点。继续点转弯 / 终点，然后点「完成绘制」。`:documentValue?.schemaVersion===2?'在视频上点起点，再点终点；自动生成直线，拖蓝色弯曲柄调整弧度。':'在球员脚下点起点，再点转弯和终点；两点也能画直线。'):
      ['dashed','dots'].includes(annotationTool)?(drawing?`已选起点，再点终点即完成${typeNames[annotationTool]}；Esc 取消。`:`先点起点，再点终点，自动完成${annotationTool==='dots'?'黄色圆点传球线（无箭头）':'直线虚线箭头'}。`):
      annotationTool==='screen'?'在掩护发生的位置点击，放下挡拆标记；选中后可以移动和调整朝向。':
      annotationTool==='spotlight'?'点击球员身体，脚底圈会自动贴脚。重叠时请选择要跟随的人；没有轨迹时可放静态圈。':
      a?(a.type==='route'?(a.authoredPath?'在参考帧拖起点、终点或两只手柄调整大曲线；拖动线条可整体移动。':a.curve==='cubic_bezier'?'拖起点、终点或蓝色主弯曲柄；拖线条整体移动。精细手柄可在右侧展开。':straightRoute(a)?'拖起点或终点调整直线；拖动线段可整体移动。':'拖动白色控制点修正路线；需要转弯可用「＋ 加转弯点」。'):a.type==='screen'?'拖白点移动；拖蓝色旋转柄自由转向，也可点左转 / 右转。':'拖动图形调整位置；在图形属性里修改大小。'):
      '先选时间，再点「跑位」新建；要修正已有图形，直接点画面上的图形或下方列表。';
    if(drawing?.space==='video')hint+=documentValue?.schemaVersion===2?' 标注固定在画面上，不会随镜头贴地移动。':' 此处只能标注当前画面。';
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
    $('tacticsDisplayModeField').hidden=!a?.actionRange||a.type!=='route';$('tacticsDisplayMode').value=a?.displayMode??'remaining';$('tacticsDisplayMode').disabled=disabled||!a;
    $('tacticsAnnotationProperties').hidden=!a;$('tacticsNewPlayerField').hidden=!!a;$('tacticsExistingPlayerField').hidden=!a;
    $('tacticsAnnotationRouteFields').hidden=a?.type!=='route';$('tacticsAnnotationAngleField').hidden=a?.type!=='screen';$('tacticsAnnotationFollowField').hidden=a?.type!=='spotlight';
    const people=(documentValue?.playDefinition.participants||[]).filter(p=>phase()?.participantIds.includes(p.id)).map(p=>[p.id,playerLabel(p.id)]);
    selectOptions('tacticsRoutePlayer',[['',annotationTool==='spotlight'?'先选球员，或点击画面中的人':'不关联球员'],...(annotationTool==='spotlight'?[['__static__','静态圈（不跟随球员）']]:[]),...people],annotationTool==='spotlight'&&staticSpotlight?'__static__':selectedEntityId||'');
    if(a){
      selectOptions('tacticsAnnotationPlayer',[['','不关联球员'],...people],a.entityId||'');
      selectedAnnotationPoint=Math.min(selectedAnnotationPoint,a.points.length-1);selectOptions('tacticsAnnotationPoint',a.points.map((_p,i)=>[String(i),(a.authoredPath||a.curve==='cubic_bezier')?['起点','出发手柄','到达手柄','终点'][i]:i===0?'起点':i===a.points.length-1?'终点':`转弯 ${i}`]),String(selectedAnnotationPoint));
      $('tacticsAnnotationAngle').value=a.style?.angle||0;$('tacticsAnnotationSize').value=String(a.style?.size||1);$('tacticsAnnotationColor').value=a.style?.color||'#26baff';
      $('tacticsAnnotationFollow').checked=!!a.followEntity;$('tacticsAnnotationFollow').disabled=disabled||!a.entityId;
      $('tacticsAnnotationStart').value=a.startFrame+1;$('tacticsAnnotationEnd').value=a.endFrameExclusive;
      const item=annotationScene?.items.find(item=>item.id===a.id),stale=annotationScene?.stale.find(item=>item.id===a.id);
      const reason=stale?'阶段或来源已变化。可在本帧重新定位，或删除此图形。':item?.hiddenReason==='reference_frame_only'?'此图形仅用于添加时的画面。点击下方列表可回到那一帧。':item?.hiddenReason==='outside_time'?'当前不在此图形的显示时间内。点击下方列表可回到添加帧。':item?.hiddenReason?`${ANNOTATION_REASONS[item.hiddenReason]||'当前画面无法定位此图形'}。可回到添加帧修正。`:
        a.authoredPath?'编排曲线使用近似地面相机跟随，在支撑范围内显示剩余路线；这不是已核对的球场标定。':a.space==='video'?(a.videoMode==='fixed'?'固定画面标注，不会随镜头贴地移动。':'旧稿仅在参考画面展示；时间不自动变成连续投影。'):a.type==='spotlight'&&a.followEntity?'脚底圈会跟随关联球员；拖动可微调与脚底的距离。':'修改只影响展示图形；原始轨迹和审核记录保留。';
      $('tacticsSelectionHint').textContent=reason;$('tacticsAnnotationRebind').hidden=!stale;
      if(a.anchorMode==='player_foot')$('tacticsSelectionHint').textContent=stale?reason:'按当前球员脚底自动跟随；无有效位置、身份冲突或镜头切换时隐藏。球场标定用于圈的透视外形。';
    }else{$('tacticsSelectionHint').textContent='先设置底部新标注区间，再选择工具在视频上绘制。关联球员可选。';}
    for(const id of ['tacticsAnnotationPlayer','tacticsAnnotationPoint','tacticsAnnotationAddPoint','tacticsAnnotationDeletePoint','tacticsAnnotationAngle','tacticsAnnotationSize','tacticsAnnotationColor','tacticsAnnotationDelete','tacticsAnnotationApplyTime','tacticsAnnotationRebind'])$(id).disabled=disabled||!a;
    $('tacticsAnnotationDeletePoint').disabled=disabled||a?.type!=='route'||!!a?.authoredPath||a?.curve==='cubic_bezier'||a.points.length<=2;
    $('tacticsAnnotationAddPoint').disabled=disabled||a?.type!=='route'||!!a?.authoredPath||a?.curve==='cubic_bezier'||straightRoute(a)||a.points.length>=ANNOTATION_LIMITS.points;
    $('tacticsObjectList').replaceChildren(...items.map(item=>{
      const b=document.createElement('button'),entity=people.find(([id])=>id===item.entityId)?.[1];
      b.textContent=`${straightRoute(item)?item.style.pattern==='dots'?'•••':'⇢':{route:'↗',screen:'⊣',spotlight:'◯'}[item.type]} ${annotationName(item)}${entity?` · ${entity}`:''}${item.origin?item.origin.kind==='agent'?' · Agent 建议':' · 人工修改':''}${item.phaseId!==phaseId?' · 待重新定位':''}`;
      b.setAttribute('aria-pressed',String(item.id===selectedAnnotationId));b.setAttribute('data-object-id',item.id);
      b.onclick=()=>{selectAnnotation(item.id);const projected=annotationScene?.items.find(a=>a.id===item.id);if((projected?.hiddenReason||item.authoredPath&&lastScene.frame!==item.anchorFrame)&&synchronized)seekCanvas(item.anchorFrame);};return b;
    }));
    $('tacticsObjectEmpty').hidden=!!items.length;
    $('tacticsFootControls').hidden=a?.type!=='spotlight';$('tacticsSnapFoot').disabled=disabled||!a?.entityId;
    $('tacticsOffsetMode').disabled=disabled||a?.anchorMode!=='player_foot';$('tacticsOffsetMode').setAttribute('aria-pressed',String(offsetMode));
    $('tacticsFootStatus').textContent=a?.anchorMode==='player_foot'?`脚底锚定 · 偏移 ${Math.round(a.offset?.x||0)}, ${Math.round(a.offset?.y||0)} 像素${offsetMode?' · 现在可拖动微调':''}`:'手工偏移（兼容旧图形）；点「重新贴脚」可切换为自动脚底锚定。';
    const archived=documentValue?.archivedTactics?.annotations||[];$('tacticsArchive').hidden=!archived.length;$('tacticsArchiveTitle').textContent=`已移除球员的图形 · ${archived.length}`;
    const restorePerson=$('tacticsArchivePlayer').value;selectOptions('tacticsArchivePlayer',[['','不关联球员'],...people],people.some(([id])=>id===restorePerson)?restorePerson:'');
    $('tacticsArchiveList').replaceChildren(...archived.map(item=>{const button=document.createElement('button');button.textContent=`恢复 ${annotationName(item)} · ${item.entityId||'未关联'}`;button.disabled=disabled;button.onclick=safe(async()=>{const next=restoreArchivedAnnotation(documentValue,item.id,{entityId:$('tacticsArchivePlayer').value||null,phaseId,frame:lastScene.frame});selectedAnnotationId=item.id;await saveAnnotation(next);});return button;}));
    fillManualControls();fillPersonCard();fillProductionControls();timeline.render();if(root.dataset)root.dataset.documentVersion=documentValue?.schemaVersion??1;
  }
  const productionCamera=()=>documentValue?.production?.cameras.find(c=>c.id===$('tacticsProductionCamera').value);
  function fillManualControls(){
    const a=selectedAnnotation(),keys=a?.authoredPath?.progressFrames??a?.progressFrames??[],run=a?.type==='route'&&(a.style.pattern??'solid')==='solid';
    $('tacticsAnnotationName').value=a?.name??annotationName(a);
    $('tacticsRhythm').hidden=!run||!keys.length;
    $('tacticsTangentSettings').hidden=a?.type!=='route';
    $('tacticsCorrectHere').disabled=!editAllowed();$('tacticsCorrectionCancel').hidden=!correctionMode;
    $('tacticsDuplicate').disabled=!a||!editAllowed();
    const cue=documentValue?.tacticKeyframes?.items.find(k=>k.kind==='explanation'&&k.annotationIds.includes(a?.id));
    $('tacticsFirstCue').textContent=cue?`首次讲解：原片 ${documentValue.review.sourceFrameMapping[cue.frame].time.toFixed(3)} 秒`:'未关联首次讲解；按自己的区间显示。';$('tacticsUnlinkCue').hidden=!cue;
    $('tacticsCorrectionList').replaceChildren(...keys.map((k,i)=>{
      const row=document.createElement('div');row.className='tactics-correction-row';
      const time=k.frame===documentValue.review.sourceFrameMapping.length?documentValue.review.mediaEndTime:documentValue.review.sourceFrameMapping[k.frame].time;
      const text=document.createElement('span');text.textContent=`${time.toFixed(3)} 秒 · 已完成 ${Math.round(k.t*100)}%${i===0||i===keys.length-1?'（端点）':''}`;row.append(text);
      if(i>0&&i<keys.length-1){
        const locate=document.createElement('button');locate.textContent='定位 / 改位置';locate.onclick=safe(async()=>{seekCanvas(k.frame);await waitForFrame(k.frame);startCorrection(k.frame);});
        const input=document.createElement('input');input.type='number';input.step='.001';input.value=time.toFixed(3);input.setAttribute('aria-label',`校正点 ${i} 时间（秒）`);
        const move=document.createElement('button');move.textContent='改时间';move.onclick=safe(async()=>{
          const m=documentValue.review.sourceFrameMapping,t=Number(input.value),f=input.value===''?-1:m.findIndex(p=>p.time>=t-1e-9);
          if(t<m[0].time||f<0||keys.some((p,j)=>j!==i&&p.frame===f))throw new Error('校正点时间无效或已占用，请选动作区间内部的另一画面。');
          const next=correctAnnotationProgress(correctAnnotationProgress(documentValue,a.id,k.frame,0,{remove:true}),a.id,f,k.t);await saveAnnotation(next);
        });
        const remove=document.createElement('button');remove.textContent='删除校正';remove.onclick=safe(()=>saveAnnotation(correctAnnotationProgress(documentValue,a.id,k.frame,0,{remove:true})));
        row.append(locate,input,move,remove);
      }
      return row;
    }));
  }
  async function waitForFrame(frame){
    const started=Date.now();while(active&&(lastScene?.frame!==frame||!editAllowed())){if(Date.now()-started>10000)throw new Error('画面定位尚未完成，请再试。');await new Promise(resolve=>setTimeout(resolve,30));}
  }
  function startCorrection(frame=lastScene?.frame){
    const a=selectedAnnotation(),range=a?.actionRange??a;if(!a||!editAllowed())return;
    if(frame<=range.startFrame||frame>=range.endFrameExclusive){status('请先将原片播放头放在动作起止之间，再校正位置；端点固定为开始和结束。');return;}
    correctionMode=true;correctionFrame=frame;$('tacticsRhythm').open=true;fillManualControls();fillAnnotationControls();drawScene();
  }
  function manualReferenceMarkup(){
    const a=selectedAnnotation();if(!a||!editingEnabled||a.type!=='route'||!lastScene)return '';
    if(!a.actionRange&&!a.authoredPath)return '';
    const full=projectAnnotations(documentValue,{phaseId,frame:lastScene.frame,model:lastScene.model,selectedId:a.id,editing:true,reference:true}).items.find(i=>i.id===a.id)?.[lastScene.mode];
    if(!full?.curve)return '';
    const ratio=(lastScene.mode==='video'?lastScene.model.width:COURT.length)/sceneNodes.width,curve=full.curve;
    let markup=`<polyline data-progress-reference="true" points="${curve.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#c4e7f4" stroke-opacity=".45" stroke-width="${2*ratio}" stroke-dasharray="${5*ratio} ${4*ratio}" pointer-events="none"/>`;
    if(correctionMode)markup+=`<text x="${curve[0].x}" y="${curve[0].y-15*ratio}" fill="#e5f8ff" font-size="${12*ratio}" pointer-events="none">点击完整路线：此刻走到这里</text>`;
    return `<g data-progress-helper="true">${markup}</g>`;
  }
  function fillProductionControls(){
    const a=selectedAnnotation(),points=a?.authoredPath?.progressFrames||[],disabled=!editAllowed();
    $('tacticsRemoveProduction').disabled=!documentValue?.production||loading||editBusy||agentAdopting;
    $('tacticsRebindProduction').disabled=!documentValue?.production||loading||editBusy||agentAdopting;
    $('tacticsProductionRebindHint').textContent='先核对本视频的实际参考画面与相机四角。点击重新绑定，即确认沿用独立曲线与示意相机；只恢复来源绑定，不确认人物或球场轨迹。视频、尺寸、帧映射、阶段和切镜必须一致，可撤销。';
    $('tacticsAuthoredFields').hidden=!a?.authoredPath;
    if(points.length){
      progressIndex=Math.min(progressIndex,points.length-1);const p=points[progressIndex];
      selectOptions('tacticsProgressPoint',points.map((v,i)=>[String(i),`第 ${v.frame+1} 帧 · ${Math.round(v.t*100)}%`]),String(progressIndex));
      $('tacticsProgressFrame').value=p.frame+1;$('tacticsProgressValue').value=Math.round(p.t*10000)/100;
      $('tacticsProgressValue').disabled=disabled||progressIndex===0||progressIndex===points.length-1;
    }
    for(const id of ['tacticsAuthoredReference','tacticsProgressPoint','tacticsProgressFrame','tacticsProgressApply','tacticsProgressAdd'])$(id).disabled=disabled||!points.length;
    $('tacticsProgressDelete').disabled=disabled||progressIndex===0||progressIndex===points.length-1;
    $('tacticsProductionSettings').hidden=!documentValue;if(!documentValue||!phase())return;
    const p=phase(),frames=[...new Set([p.freezeFrame,...pausePoints().filter(c=>c.phaseId===phaseId).map(c=>c.frame),...(documentValue.production?.timeline.cues||[]).filter(c=>c.phaseId===phaseId).map(c=>c.frame)])].sort((a,b)=>a-b);
    const oldCue=Number($('tacticsProductionCue').value),frame=frames.includes(oldCue)?oldCue:frames[0];
    selectOptions('tacticsProductionCue',frames.map(f=>[String(f),`${Number(documentValue.review.sourceFrameMapping[f].time).toFixed(2)} 秒 · 第 ${f+1} 帧`]),String(frame));
    fillCueFields();$('tacticsApplyCue').disabled=disabled;
    const cameras=(documentValue.production?.cameras||[]).filter(c=>c.phaseId===phaseId),old=$('tacticsProductionCamera').value;
    selectOptions('tacticsProductionCamera',cameras.length?cameras.map((c,i)=>[c.id,`示意相机 ${i+1} · ${c.keyframes.length} 个参考帧`]):[['','此阶段尚无示意相机']],cameras.some(c=>c.id===old)?old:cameras[0]?.id||'');
    fillCameraFields();
  }
  function fillCueFields(){
    const frame=Number($('tacticsProductionCue').value),cue=productionCue(documentValue,{phaseId,frame}),fps=documentValue?.production?.timeline.timebaseFps||30;
    $('tacticsCueSettle').value=Math.round(cue.settleFrames/fps*1000)/1000;$('tacticsCueDraw').value=Math.round(cue.drawFrames/fps*1000)/1000;$('tacticsCueHold').value=Math.round(cue.holdFrames/fps*1000)/1000;
  }
  function fillCameraFields(){
    const camera=productionCamera(),old=Number($('tacticsCameraFrame').value),keys=camera?.keyframes||[];
    selectOptions('tacticsCameraFrame',keys.map(k=>[String(k.frame),`第 ${k.frame+1} 帧 · ${documentValue.review.sourceFrameMapping[k.frame].time.toFixed(2)} 秒`]),String(keys.some(k=>k.frame===old)?old:keys[0]?.frame??''));
    $('tacticsEditCamera').disabled=!camera||!editAllowed();$('tacticsFinishCamera').hidden=!cameraEditing;
    $('tacticsCameraStatus').textContent=!camera?'Agent 编排提供示意相机后，可在此调整参考四角。':cameraEditing?(lastScene?.frame===cameraEditing.frame&&editingEnabled?'拖动画面上的 1–4 号角点；相机支撑范围以外不会外推。':'正在定位准确相机参考帧…'):'定位参考画面后，拖动四角修正近似投影。';
  }
  function cameraMarkup(){
    if(!cameraEditing||!lastScene||lastScene.mode!=='video'||!editingEnabled||lastScene.frame!==cameraEditing.frame)return '';
    const camera=(productionPreview||documentValue).production?.cameras.find(c=>c.id===cameraEditing.id),key=camera?.keyframes.find(k=>k.frame===cameraEditing.frame);if(!key)return '';
    const ratio=lastScene.model.width/sceneNodes.width;
    return `<g data-camera-edit="true"><polygon points="${key.quad.map(p=>p.join(',')).join(' ')}" fill="#ffd45c" fill-opacity=".08" stroke="#ffd45c" stroke-width="${2*ratio}" stroke-dasharray="${6*ratio} ${4*ratio}" pointer-events="none"/>${key.quad.map(([x,y],i)=>`<g data-camera-corner="${i}" class="tactics-control-handle"><circle cx="${x}" cy="${y}" r="${15*ratio}" fill="transparent"/><circle cx="${x}" cy="${y}" r="${8*ratio}" fill="#ffd45c" stroke="#543e14" stroke-width="${2*ratio}"/><text x="${x+12*ratio}" y="${y-8*ratio}" font-size="${14*ratio}" fill="#ffd45c" stroke="#172a35" stroke-width="${.5*ratio}" pointer-events="none">${i+1}</text></g>`).join('')}</g>`;
  }
  async function placeSpotlight(entityId,point=null){
    if(!editAllowed())return;
    if(documentValue.schemaVersion===2&&lastScene.mode==='court'){
      const p=entityId?(documentValue.review.courtPreparation?.preparedByPlayer[entityId]?.[lastScene.frame]??documentValue.review.entities.find(e=>e.id===entityId)?.courtTrajectory?.[lastScene.frame]):point;
      if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)){status('当前球员没有有效 2D 位置。');return;}
      const id=`draw-${crypto.randomUUID()}`;selectedAnnotationId=id;annotationTool='select';await saveAnnotation(makeAnnotation({id,type:'spotlight',phaseId,entityId,space:'court',points:[{x:p.x,y:p.y}],style:{color:'#ffd34e'}}));return;
    }
    const foot=entityId?playerFoot(documentValue,entityId,lastScene.frame,{phaseId,model:lastScene.model}).point:null;
    if(entityId&&!foot){status('这个球员在本帧没有有效脚底位置。请定位到可见帧，或选择不关联球员放静态圈。');return;}
    const id=`draw-${crypto.randomUUID()}`,located=foot?{space:'video',point:foot}:locatedPoint(point);
    const next=makeAnnotation({id,type:'spotlight',phaseId,entityId,frame:lastScene.frame,space:located.space,points:[located.point],...(foot?{anchorMode:'player_foot',offset:{x:0,y:0}}:{}),style:{color:'#ffd34e'}});
    footCandidates=[];selectedAnnotationId=id;selectedAnnotationPoint=0;annotationTool='select';await saveAnnotation(next);
  }
  function locatedPoint(point){return lastScene.mode==='court'?{space:'court',point}:$('tacticsCoordinateMode').value==='fixed'?{space:'video',point}:annotationPointFromVideo(lastScene.model,lastScene.frame,point);}
  function makeAnnotation(input){
    if(documentValue.schemaVersion!==2)return createAnnotation(documentValue,input);
    const range=timeline.range();if(!range)throw new Error('先设置新标注的开始和结束时间。');
    let next=createManualAnnotation(documentValue,{...input,range,frame:input.frame??lastScene.frame,pattern:input.style?.pattern??'solid',name:input.name??`${typeNames[input.type==='route'?(input.style?.pattern??'solid')==='solid'?'route':input.style.pattern:input.type]} ${annotations().length+1}`});
    return timelineInstance?.associateNew(next,input.id)??next;
  }
  function canvasPoint(event){
    const svg=sceneNodes?.overlay.querySelector('svg');if(!svg)return null;
    try{const m=svg.getScreenCTM();if(!m)return null;const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const point=p.matrixTransform(m.inverse());
      if(lastScene.mode==='court')return point.x>=0&&point.x<=COURT.length&&point.y>=0&&point.y<=COURT.width?{x:point.x,y:point.y}:null;
      return point.x>=0&&point.y>=0&&point.x<=lastScene.model.width&&point.y<=lastScene.model.height?{x:point.x,y:point.y}:null;
    }catch{return null;}
  }
  function originalPoint(point,space){return space===lastScene.mode?{x:point.x,y:point.y}:space==='court'?videoToCourt(lastScene.model,lastScene.frame,point):courtToVideo(lastScene.model,lastScene.frame,point);}
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
    const pending=drawing,id=`draw-${crypto.randomUUID()}`,next=makeAnnotation({id,type:'route',phaseId,entityId:selectedEntityId||null,frame:pending.frame,space:pending.space,points:pending.points,style:pending.pattern==='solid'?{color:'#26baff'}:{pattern:pending.pattern}});
    drawing=null;selectedAnnotationId=id;selectedAnnotationPoint=0;annotationTool='select';if(await saveAnnotation(next,pending.stamp)&&documentValue.schemaVersion===2)seekCanvas(documentValue.annotations.items.find(a=>a.id===id).anchorFrame);
  }
  function seekCanvas(frame,{inspect=false,camera=false}={}){
    if(!camera)cameraEditing=null;
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
  const productionUI=mountTacticsProductionUI({snapshot:()=>({...base,kind,document:documentValue,expectedVersion:version,revision}),request,
    beforePreview(){api.pause();if(synchronized)runPlayback(playback.pause());},
    beforeGenerate:async()=>{if(!await saveCurrent())throw new Error('保存过程中草稿有新修改，请再次生成；修改已保留。');}});
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
    if(job.candidate.schemaVersion===3){
      const range=job.candidate.range,text=document.createElement('p');text.textContent=`候选范围 [${range.startFrame},${range.endFrameExclusive}) · 准备版本 ${job.previewDocument?.review.courtPreparation?.revision} · 勾选采用后可拖动编辑`;host.append(text);
      for(const a of job.candidate.annotations){const label=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=agentSelectedIds.has(a.id);checkbox.onchange=()=>{if(checkbox.checked)agentSelectedIds.add(a.id);else agentSelectedIds.delete(a.id);};label.append(checkbox,`${a.type} · ${a.entityId??'独立示意'} · ${a.explanation}`);host.append(label);}
      if(doc)for(const at of [...new Set(job.candidate.annotations.map(a=>a.cueFrame))]){
        const phase=doc.playDefinition.phases.find(p=>at>=p.startFrame&&at<p.endFrameExclusive),surface=document.createElement('div');surface.className='tactics-agent-court-preview';
        const scene=projectAnnotations(doc,{phaseId:phase.phaseId,frame:at,editing:true});scene.items=scene.items.filter(a=>ids.includes(a.id));
        surface.innerHTML=renderAnnotationsSVG(scene,{space:'court',width:560,height:298});host.append(surface);
      }
      return;
    }
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
    if((agentJob?.jobId!==job.jobId||!agentJob?.candidate)&&job.candidate?.schemaVersion===3)agentSelectedIds=new Set(job.candidate.annotations.map(a=>a.id));
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
      const result=await request('/api/tactics-agent/jobs',{document:snapshot,expectedVersion:captured.version,clientRevision:captured.revision,documentDigest:digest,scope,phaseId,...(scope==='range'?{range:timeline.range()}:{}),goal:$('tacticsAgentGoal').value||''});
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
      const response=await request(`/api/tactics-agent/jobs/${job.jobId}/adopt`,{document:snapshot,expectedVersion:version,clientRevision:revision,documentDigest:digest,...(job.candidate.schemaVersion===3?{selectedIds:[...agentSelectedIds]}:{})});
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
  function cancelEditing(){correctionMode=false;correctionFrame=null;correctionDrag=null;editor.cancel();temporaryRoute=null;cancelAnnotationGesture();fillAnnotationControls();}
  function playbackControls(){
    const s=playback.state(),disabled=!synchronized||!active||loading||editBusy||!lastScene||s.status==='seeking';
    $('tacticsContinue').disabled=disabled||s.status==='playing';$('tacticsReplay').disabled=disabled;
    $('tacticsPause').disabled=rangePlayback?false:!synchronized||!active||s.status==='inactive'||s.status==='paused'||s.status==='ended';
    const cues=pausePoints().filter(c=>c.phaseId===phaseId),point=api.getPresentedFrame?.()||presentedPoint;
    const stopped=!disabled&&s.status==='paused'&&point?.frame===lastScene?.frame&&cues.some(c=>c.frame===lastScene.frame);
    $('tacticsContinue').textContent=documentValue?.schemaVersion===2&&!documentValue.legacyTiming?'原片播放':stopped?'继续播放':'逐点检查';
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
    if(playbackStatus==='playing'){personInspection=null;cameraEditing=null;}
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
    rangePlayback=null;clearTimeout(holdTimer);personInspection=null;cameraEditing=null;cancelEditing();phaseId=id;
    if(synchronized){playback.configure(documentValue.playDefinition.phases,id,pausePoints());const commands=playback.select(id);render({preserveFrame:true});runPlayback(commands);}
    else render();
  }
  function clearPreview(){cancelEditing();epoch++;lastScene=null;editor.select(null);fillPersonCard();if(sceneNodes){sceneNodes.overlay.replaceChildren();sceneNodes.background.hidden=true;}$('tacticsFrame').textContent='正在准备当前阶段…';$('tacticsRoster').replaceChildren();$('tacticsIssues').replaceChildren();}
  async function commit(next,captured=stamp(),{reuseScene=false}={}){
    return commitWhenCurrent({next,stamp:captured,getStamp:stamp,validate:validateDocument,apply:async value=>{
      redo=[];history.push({document:clone(documentValue),selectedAnnotationId});if(history.length>30)history.shift();documentValue=value;personInspection=null;revision++;markUnsaved();
      const applied=stamp();await draft();
      // Title/notes mutate this same document while its draft is queued. Render
      // the latest document after persistence; metadata revisions do not make
      // its newly applied presentation model obsolete. Navigation still does.
      if(applied.document!==documentValue||applied.context!==context||applied.phaseId!==phaseId||loading)return;
      render({reuseScene});await sceneReady;
    }});
  }
  function render({reuseScene=false,preserveFrame=false}={}){
    void productionUI.sync();
    agentControls();
    $('tacticsEditor').hidden=!documentValue;
    $('tacticsEmpty').hidden=!!documentValue;
    for(const id of ['tacticsPhaseSettings','tacticsReferenceDetails','tacticsActionReview'])$(id).hidden=!documentValue;
    if(!documentValue)$('tacticsSaveState').textContent='尚未建立画布';
    $('tacticsCreateCanvas').disabled=loading;
    for(const id of ['tacticsJson','tacticsReport'])$(id).disabled=!documentValue;
    $('tacticsUndo').disabled=!history.length;
    if(!documentValue)return;
    if(documentValue.schemaVersion!==2&&(annotations().length||documentValue.playDefinition.actions.length||documentValue.playDefinition.phases.length>1||documentValue.presentation?.routes.length))$('tacticsAgentScope').value='phase';
    $('tacticsMigrate').hidden=documentValue.schemaVersion===2;
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
    const mode=documentValue.schemaVersion===2?canvasView:synchronized||backgroundSource||projected.videoAvailable?'video':'court';lastScene.mode=mode;lastScene.projected=projected;
    const ratio=mode==='video'?model.height/model.width:15.24/28.6512;
    const actionsHeight=($('tacticsSelectionActions').offsetHeight||42)+6;
    const availableHeight=typeof window!=='undefined'&&Number.isFinite(window.innerHeight)?Math.max(220,Math.min(480,window.innerHeight-450-actionsHeight)):Infinity;
    const width=Math.max(200,Math.min($('tacticsCanvas').clientWidth-2,availableHeight/ratio)),height=width*ratio,nodes=ensureScene();
    nodes.width=width;nodes.canvas.style.width=`${width}px`;nodes.canvas.style.height=`${height}px`;
    const playbackState=playback.state(),decoded=api.getPresentedFrame?.()||presentedPoint;
    if(mode==='video'&&synchronized&&(!backgroundSource||playbackState.status==='seeking'&&decoded?.frame!==playbackState.targetFrame)){
      nodes.background.hidden=true;nodes.overlay.replaceChildren();
      $('tacticsFrame').textContent='正在定位同步视频画面…';return;
    }
    nodes.background.hidden=mode!=='video';
    if(mode==='video'){
      if(nodes.background.width!==model.width)nodes.background.width=model.width;
      if(nodes.background.height!==model.height)nodes.background.height=model.height;
      const source=backgroundSource||background?.image;if(source)nodes.background.getContext('2d').drawImage(source,0,0,model.width,model.height);
    }
    annotationScene=projectAnnotations(productionPreview||annotationPreview||documentValue,{phaseId,frame,model,selectedId:selectedAnnotationId,editing:editingEnabled,freeze:rangePlayback?.holding===frame});
    const sourceSvg=renderPresentationSVG($('tacticsShowReference').checked?projected:{...projected,routes:[]},{space:mode,width,height});
    const marks=renderAnnotationsSVG(annotationScene,{space:mode,width,height}).replace(/^<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'');
    const source=backgroundSource||background?.image,check=$('tacticsSyncVideo');if(source){check.width=model.width;check.height=model.height;check.getContext('2d').drawImage(source,0,0,model.width,model.height);}
    const playerMarks=mode==='court'?documentValue.review.entities.map(e=>{const p=documentValue.review.courtPreparation?.preparedByPlayer[e.id]?.[frame]??e.courtTrajectory?.[frame];return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?`<g data-player-id="${e.id}"><circle cx="${p.x}" cy="${p.y}" r=".24" fill="${e.id===selectedEntityId?'#ffd45c':'#7ec8ed'}"/><text x="${p.x+.28}" y="${p.y}" fill="#ffffff" font-size=".28">${e.id}</text></g>`:'';}).join(''):'';
    nodes.overlay.innerHTML=sourceSvg.replace('</svg>',`${playerMarks}${marks}${manualReferenceMarkup()}${drawingMarkup()}${personInspectionMarkup()}${cameraMarkup()}</svg>`);drawHandles();drawAnnotationHandles();fillPersonCard();
    const ps=model.presentation,manual=ps.applied.length,stale=ps.stale.length;
    const hidden=projected.routes.filter(r=>mode==='video'&&!r.video).length;
    const authoredVisible=annotationScene.items.filter(a=>a[mode]).length;
    $('tacticsPresentationStatus').textContent=`${authoredVisible?`${authoredVisible} 个画布图形`:'画布已就绪，点击上方工具开始标注'}${annotationScene.stale.length?` · ${annotationScene.stale.length} 个图形需重新定位`:''}${mode==='video'&&!projected.videoAvailable?' · 当前画面缺少有效标定；固定画面标注不会随镜头贴地移动。':mode==='video'?' · 有映射的地面标注随当前镜头投影；固定画面标注独立保留。':''}${$('tacticsShowReference').checked?` · 识别路线参考已显示${manual?`（含 ${manual} 段旧修正）`:''}${stale?`，${stale} 段旧修正已过期`:''}${hidden?`，${hidden} 段当前不可见`:''}`:''}`;
    if(synchronized)$('tacticsFrame').textContent=`${mediaTime.toFixed(2)} 秒 · 第 ${frame+1} 帧 · ${{playing:'播放中',paused:'已暂停',ended:'已结束',seeking:'定位中'}[playback.state().status]||'准备中'}`;
    $('tacticsSourceTime').max=documentValue.review.sourceFrameMapping.at(-1).time;
    if(document.activeElement!==$('tacticsSourceTime'))$('tacticsSourceTime').value=mediaTime.toFixed(3);
    timelineInstance?.updateFrame();
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
    const svg=sceneNodes?.overlay.querySelector('svg'),item=annotationScene?.items.find(item=>item.id===selectedAnnotationId);if(!svg||!item||!editingEnabled||annotationTool!=='select'||cameraEditing||item.original?.authoredPath&&lastScene.frame!==item.original.anchorFrame)return;
    const group=document.createElementNS('http://www.w3.org/2000/svg','g'),ratio=(lastScene.mode==='video'?lastScene.model.width:28.6512)/sceneNodes.width;
    group.setAttribute('data-annotation-handles','true');
    for(const handle of item.handles){
      if(item.original.curve==='cubic_bezier'&&!$('tacticsShowTangents').checked&&(handle.index===1||handle.index===2))continue;
      const p=lastScene.mode===handle.space||lastScene.mode==='video'&&!handle.space?handle:lastScene.mode==='court'?videoToCourt(lastScene.model,lastScene.frame,handle):courtToVideo(lastScene.model,lastScene.frame,handle);if(!p)continue;
      const control=document.createElementNS('http://www.w3.org/2000/svg','g');control.setAttribute('data-annotation-id',item.id);control.setAttribute('data-annotation-control-index',String(handle.index));control.setAttribute('class','tactics-control-handle');
      for(const [r,fill,stroke] of [[15,'transparent','none'],[handle.index===selectedAnnotationPoint?7:5.5,handle.index===selectedAnnotationPoint?'#ffe88a':'#ffffff','#173d55']]){
        const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');for(const [key,value] of Object.entries({cx:p.x,cy:p.y,r:r*ratio,fill,stroke,'stroke-width':2*ratio}))circle.setAttribute(key,String(value));control.append(circle);
      }group.append(control);
    }
    if(item.original.curve==='cubic_bezier'&&item.original.points.length===4){
      const a=item.original,mid={x:(a.points[0].x+3*a.points[1].x+3*a.points[2].x+a.points[3].x)/8,y:(a.points[0].y+3*a.points[1].y+3*a.points[2].y+a.points[3].y)/8};
      const p=a.space===lastScene.mode?mid:a.space==='court'?courtToVideo(lastScene.model,lastScene.frame,mid):mid;
      if(p){const bend=document.createElementNS('http://www.w3.org/2000/svg','circle');for(const [key,v] of Object.entries({cx:p.x,cy:p.y,r:9*ratio,fill:'#168bd1',stroke:'#e8f8ff','stroke-width':2*ratio,'data-annotation-bend':'true','data-annotation-id':a.id,'aria-label':'拖动调整主弯曲'}))bend.setAttribute(key,String(v));group.append(bend);}
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
      kind=nextKind;documentValue=next;lastSavedDigest=null;version=saved.version||0;phaseId=stored?.phaseId||next?.playDefinition.phases[0].phaseId;history=[];redo=[];revision++;context++;selectedRouteId=null;selectedControlFrame=null;selectedAnnotationId=null;selectedEntityId=api.selectedEntityId?.()??selectedEntityId;staticSpotlight=false;personInspection=null;annotationTool='select';
      const params=new URLSearchParams(location.search);if(kind==='candidate')params.set('candidate','1');else params.delete('candidate');window.history.replaceState(null,'',`/?${params}`);
      await draft();render();$('tacticsSaveState').textContent=stored?'已恢复浏览器草稿':version?`已保存 · 版本 ${version}`:'浏览器草稿';status(next?'先选阶段和工具，在画面直接标注。检查播放会在下一个讲解点暂停。':'点击「建立画布，开始手工标注」，没有识别结果也可以开始。');
    }finally{if(sequence===loadSequence){loading=false;$('tacticsSnapshot').disabled=false;$('tacticsCreateCanvas').disabled=false;fillRouteControls();fillAnnotationControls();agentControls();}}
  }
  $('tacticsWorkspace').onclick=safe(()=>load('workspace'));
  $('tacticsContinue').onclick=safe(async()=>{if(loading||editBusy||!active||!lastScene)return;await sceneReady;if(!active||loading||editBusy||!lastScene)return;epoch++;cancelEditing();runPlayback(documentValue.schemaVersion===2&&!documentValue.legacyTiming?playback.playSource(lastScene.frame):playback.continue(lastScene.frame));});
  $('tacticsPause').onclick=()=>{rangePlayback=null;clearTimeout(holdTimer);runPlayback(playback.pause());const point=api.getPresentedFrame?.()||presentedPoint;if(point)onPresentedFrame(point);};
  $('tacticsReplay').onclick=safe(async()=>{if(loading||editBusy||!active||!lastScene)return;epoch++;cancelEditing();if(documentValue.schemaVersion===2&&!documentValue.legacyTiming){const p=phase();seekCanvas(p.startFrame);await waitForFrame(p.startFrame);runPlayback(playback.playSource(p.startFrame,p.endFrameExclusive));}else runPlayback(playback.replay());});
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
  let lastSavedDigest=null;
  async function saveCurrent(){
    if(savePromise)return savePromise;
    if(!documentValue||loading||agentAdopting)return false;
    savePromise=(async()=>{
      const d=clone(documentValue),rev=revision,saveKind=kind,saveContext=context;
      $('tacticsSaveState').textContent='保存中…';$('tacticsSave').disabled=true;
      try{
        const digest=await documentDigest(d);
        if(digest===lastSavedDigest){await draft();$('tacticsSaveState').textContent=`已保存 · 版本 ${version}`;return rev===revision;}
        const saved=await request('/api/tactics/save',{document:d,expectedVersion:version});
        if(kind!==saveKind||context!==saveContext)return false;
        version=saved.version;lastSavedDigest=digest;await draft();
        const current=rev===revision;
        status(current?`已保存到本机 · 版本 ${version}。`:'请求时版本已保存；之后的新修改仍在浏览器草稿，请再次保存。');
        $('tacticsSaveState').textContent=current?`已保存 · 版本 ${version}`:'还有修改待保存';$('tacticsSaveState').setAttribute('data-dirty',String(!current));
        return current;
      }catch(error){$('tacticsSaveState').textContent='保存失败 · 草稿保留';$('tacticsSaveState').setAttribute('data-dirty','true');status(error.message);throw error;}
      finally{$('tacticsSave').disabled=false;}
    })();
    try{return await savePromise;}finally{savePromise=null;}
  }
  $('tacticsSave').onclick=safe(saveCurrent);
  $('tacticsPreviewCurrent').onclick=safe(async()=>{root.querySelector('.tactics-production-panel').open=true;await $('tacticsRenderStart').onclick();$('tacticsRender').scrollIntoView?.({block:'start',behavior:'smooth'});});
  $('tacticsExportCurrent').onclick=()=>api.openStep('export');
  $('tacticsAnnotationName').onchange=safe(()=>patchAnnotation({name:$('tacticsAnnotationName').value.trim()}));
  $('tacticsDuplicate').onclick=safe(async()=>{const a=selectedAnnotation();if(!a||!editAllowed())return;const id=`draw-${crypto.randomUUID()}`,next=duplicateAnnotation(documentValue,a.id,id);if(await saveAnnotation(next)){selectAnnotation(id);status('已复制，形状、时间与首次讲解关联保留；可从列表选择副本修改。');}});
  $('tacticsShowTangents').onchange=()=>drawScene();
  $('tacticsCorrectHere').onclick=()=>startCorrection();
  $('tacticsCorrectionCancel').onclick=()=>{correctionMode=false;correctionFrame=null;fillAnnotationControls();drawScene();};
  $('tacticsUnlinkCue').onclick=safe(async()=>{const a=selectedAnnotation(),next=clone(documentValue);for(const k of next.tacticKeyframes?.items??[])if(k.kind==='explanation')k.annotationIds=k.annotationIds.filter(id=>id!==a?.id);await saveAnnotation(next);});
  $('tacticsSourceSeek').onclick=safe(()=>{
    const value=$('tacticsSourceTime').value,time=Number(value),m=documentValue.review.sourceFrameMapping;
    if(value===''||time<m[0].time||time>m.at(-1).time)throw new Error(`原片定位时间必须在 ${m[0].time.toFixed(3)}—${m.at(-1).time.toFixed(3)} 秒之间。`);
    seekCanvas(m.findIndex(p=>p.time>=time-1e-9));
  });
  function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('tacticsJson').onclick=safe(async()=>{const d=clone(documentValue);await validateDocument(d);download(JSON.stringify(d,null,2),`tactics-${api.sample}-${kind}.json`,'application/json');status('已导出全部手绘图形、展示修正、轨迹快照与审核数据。');});
  $('tacticsReport').onclick=safe(async()=>{const d=clone(documentValue);status('正在生成冻结帧报告：仅既有动作与审核，平滑路线和人工展示修正保留在 JSON。');const result=await request('/api/tactics/export',{document:d});download(result.html,`tactics-${api.sample}-${kind}.html`,'text/html');status('已导出冻结帧报告；其中不包含平滑路线或人工展示修正，完整修正请同时导出审核数据 JSON。');});
  $('tacticsUndo').onclick=safe(async()=>{if(editBusy)return;if(drawing?.points.length){drawing.points.pop();if(!drawing.points.length)drawing=null;fillAnnotationControls();drawScene();return;}if(!history.length)return;personInspection=null;cancelEditing();const previous=history.pop();redo.push({document:clone(documentValue),selectedAnnotationId});documentValue=previous.document;selectedAnnotationId=previous.selectedAnnotationId;revision++;markUnsaved();await draft();render({reuseScene:true});await sceneReady;fillAnnotationControls();status('已撤销上一次修改。');});
  $('tacticsRoutePlayer').onchange=()=>{const value=$('tacticsRoutePlayer').value;cancelEditing();staticSpotlight=value==='__static__';selectedEntityId=staticSpotlight?null:value||null;if(selectedEntityId)api.selectEntity?.(selectedEntityId);personInspection=null;selectedRouteId=null;selectedControlFrame=null;fillRouteOptions();fillAnnotationControls();drawScene();};
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
  $('tacticsDisplayMode').onchange=safe(()=>patchAnnotation({displayMode:$('tacticsDisplayMode').value}));
  $('tacticsAnnotationPoint').onchange=()=>{selectedAnnotationPoint=Number($('tacticsAnnotationPoint').value);fillAnnotationControls();drawScene();};
  $('tacticsAnnotationAddPoint').onclick=()=>{const a=selectedAnnotation();if(!editAllowed()||a?.type!=='route'||a.authoredPath||a.curve==='cubic_bezier'||straightRoute(a))return;addingAnnotationPoint=true;fillAnnotationControls();};
  $('tacticsAnnotationDeletePoint').onclick=safe(async()=>{
    const a=selectedAnnotation();if(!a||a.type!=='route'||a.authoredPath||a.curve==='cubic_bezier'||straightRoute(a)||a.points.length<=2||!editAllowed())return;
    const points=a.points.filter((_p,i)=>i!==selectedAnnotationPoint);selectedAnnotationPoint=Math.min(selectedAnnotationPoint,points.length-1);await patchAnnotation({points});
  });
  $('tacticsAnnotationDelete').onclick=safe(deleteSelectedAnnotation);$('tacticsQuickDelete').onclick=safe(deleteSelectedAnnotation);
  $('tacticsRotateLeft').onclick=safe(()=>patchAnnotation({style:{angle:normalizedAngle((selectedAnnotation()?.style.angle||0)-15)}}));
  $('tacticsRotateRight').onclick=safe(()=>patchAnnotation({style:{angle:normalizedAngle((selectedAnnotation()?.style.angle||0)+15)}}));
  $('tacticsDeselect').onclick=deselectAnnotation;
  $('tacticsAnnotationPlayer').onchange=safe(()=>{const entityId=$('tacticsAnnotationPlayer').value||null,a=selectedAnnotation();if(documentValue.schemaVersion===2&&a?.space==='court')return patchAnnotation({entityId,...(a.type==='spotlight'?{anchorMode:entityId?'court_player_foot':'manual_offset',followEntity:!!entityId}:{})});const foot=entityId&&a?.type==='spotlight'?playerFoot(documentValue,entityId,lastScene.frame,{phaseId,model:lastScene.model}).point:null;return patchAnnotation({entityId,...(a?.type==='spotlight'&&entityId?{anchorMode:'player_foot',offset:{x:0,y:0},...(foot?{points:[foot]}:{})}:{})});});
  $('tacticsAnnotationFollow').onchange=safe(()=>patchAnnotation({followEntity:$('tacticsAnnotationFollow').checked}));
  $('tacticsSnapFoot').onclick=safe(async()=>{const a=selectedAnnotation();if(!a?.entityId)return;if(documentValue.schemaVersion===2&&a.space==='court'){const p=documentValue.review.courtPreparation?.preparedByPlayer[a.entityId]?.[lastScene.frame]??documentValue.review.entities.find(e=>e.id===a.entityId)?.courtTrajectory?.[lastScene.frame];if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new Error('此帧没有有效 2D 脚底位置。');return patchAnnotation({anchorMode:'court_player_foot',followEntity:true,points:[{x:p.x,y:p.y}]});}const foot=playerFoot(documentValue,a.entityId,lastScene.frame,{phaseId,model:lastScene.model}).point;if(!foot){status('此帧没有有效脚底位置，请定位到球员可见帧。');return;}offsetMode=false;await patchAnnotation({anchorMode:'player_foot',points:[foot],offset:{x:0,y:0}});});
  $('tacticsOffsetMode').onclick=()=>{if(selectedAnnotation()?.anchorMode!=='player_foot'||!editAllowed())return;offsetMode=!offsetMode;fillAnnotationControls();};
  $('tacticsAgentRun').onclick=generateAgent;$('tacticsAgentAdopt').onclick=adoptAgent;
  $('tacticsAgentCancel').onclick=async()=>{if(!agentJob||agentAdopting)return;const job=agentJob,captured=agentCapture;try{clearTimeout(agentTimer);await receiveAgent(await request(`/api/tactics-agent/jobs/${job.jobId}/cancel`,{}),captured);}catch(error){if(agentCapture===captured)agentStatus(error.message);}};
  $('tacticsProductionCue').onchange=fillCueFields;
  $('tacticsRebindProduction').onclick=safe(async()=>{
    if(!documentValue?.production||loading||editBusy||agentAdopting)return;
    api.pause();cancelEditing();cameraEditing=null;const captured=stamp(),snapshot=clone(documentValue),requestedKind=kind;
    editBusy=true;fillAnnotationControls();fillRouteControls();playbackControls();
    try{
      let referenceDocument=null;
      if(!snapshot.production.mediaBinding){
        const saved=await request(`/api/tactics?${new URLSearchParams({...base,qa:api.qa?'1':'0',kind:requestedKind})}`);
        referenceDocument=saved.document;
      }
      const next=await rebindIndependentProduction(snapshot,{referenceDocument});
      if(await commit(next,captured))status('已按你的确认重新绑定此视频的独立曲线与示意相机。保存后重新生成成片；其它待核对图形仍须分别处理。');
    }finally{editBusy=false;fillAnnotationControls();fillRouteControls();playbackControls();}
  });
  $('tacticsRemoveProduction').onclick=safe(async()=>{
    if(!documentValue?.production||loading||editBusy||agentAdopting)return;
    api.pause();cancelEditing();cameraEditing=null;const next=clone(documentValue);delete next.production;
    for(const a of [...(next.annotations?.items||[]),...(next.archivedTactics?.annotations||[])])delete a.authoredPath;
    if(await commit(next))status(`已移除成片编排：图形和控制点保留为参考帧静态图形。现在可调整阶段并重新生成；也可撤销恢复编排。${annotationScene?.stale.length?'仍有失效图形，请在准确参考画面逐个重新定位后导出。':''}`);
  });
  $('tacticsApplyCue').onclick=safe(async()=>{if(!editAllowed())return;const fps=documentValue.production?.timeline.timebaseFps||30;await commit(updateProductionCue(documentValue,{phaseId,frame:Number($('tacticsProductionCue').value),settleFrames:Math.round(Number($('tacticsCueSettle').value)*fps),drawFrames:Math.round(Number($('tacticsCueDraw').value)*fps),holdFrames:Math.round(Number($('tacticsCueHold').value)*fps)}),stamp(),{reuseScene:true});});
  $('tacticsAuthoredReference').onclick=()=>{const a=selectedAnnotation();if(a?.authoredPath)seekCanvas(a.anchorFrame);};
  $('tacticsProgressPoint').onchange=()=>{progressIndex=Number($('tacticsProgressPoint').value);fillProductionControls();};
  $('tacticsProgressApply').onclick=safe(async()=>{const a=selectedAnnotation();if(!editAllowed()||!a?.authoredPath)return;const points=clone(a.authoredPath.progressFrames);points[progressIndex]={frame:Number($('tacticsProgressFrame').value)-1,t:Number($('tacticsProgressValue').value)/100};await patchAnnotation({startFrame:points[0].frame,endFrameExclusive:points.at(-1).frame,authoredPath:{...a.authoredPath,progressFrames:points}});});
  $('tacticsProgressAdd').onclick=safe(async()=>{
    const a=selectedAnnotation();if(!editAllowed()||!a?.authoredPath)return;const points=clone(a.authoredPath.progressFrames),left=points[Math.min(progressIndex,points.length-2)],right=points[Math.min(progressIndex+1,points.length-1)];
    const frame=lastScene.frame>left.frame&&lastScene.frame<right.frame?lastScene.frame:Math.floor((left.frame+right.frame)/2);
    if(frame<=left.frame||frame>=right.frame){status('这两个关键点之间没有可插入的视频帧。');return;}
    const index=points.indexOf(left)+1;points.splice(index,0,{frame,t:left.t+(right.t-left.t)*(frame-left.frame)/(right.frame-left.frame)});progressIndex=index;await saveAnnotation(updateAuthoredProgress(documentValue,a.id,points));
  });
  $('tacticsProgressDelete').onclick=safe(async()=>{const a=selectedAnnotation(),points=clone(a?.authoredPath?.progressFrames||[]);if(!editAllowed()||progressIndex<=0||progressIndex>=points.length-1)return;points.splice(progressIndex,1);progressIndex--;await saveAnnotation(updateAuthoredProgress(documentValue,a.id,points));});
  $('tacticsProductionCamera').onchange=()=>{cameraEditing=null;cancelEditing();fillCameraFields();drawScene();};
  $('tacticsCameraFrame').onchange=()=>{cameraEditing=null;cancelEditing();fillCameraFields();drawScene();};
  $('tacticsEditCamera').onclick=()=>{const camera=productionCamera(),frame=Number($('tacticsCameraFrame').value);if(!camera||!editAllowed())return;cancelEditing();selectedAnnotationId=null;cameraEditing={id:camera.id,frame};if(lastScene.frame!==frame)seekCanvas(frame,{camera:true});fillCameraFields();drawScene();};
  $('tacticsFinishCamera').onclick=()=>{cameraEditing=null;cancelEditing();fillCameraFields();drawScene();};
  $('tacticsAnnotationAngle').onchange=safe(()=>patchAnnotation({style:{angle:Number($('tacticsAnnotationAngle').value)}}));
  $('tacticsAnnotationSize').onchange=safe(()=>patchAnnotation({style:{size:Number($('tacticsAnnotationSize').value)}}));
  $('tacticsAnnotationColor').onchange=safe(()=>patchAnnotation({style:{color:$('tacticsAnnotationColor').value}}));
  $('tacticsAnnotationApplyTime').onclick=safe(()=>{
    const a=selectedAnnotation(),startFrame=Number($('tacticsAnnotationStart').value)-1,endFrameExclusive=Number($('tacticsAnnotationEnd').value),patch={startFrame,endFrameExclusive};
    if(a?.authoredPath)patch.authoredPath={...a.authoredPath,progressFrames:[{frame:startFrame,t:0},...a.authoredPath.progressFrames.slice(1,-1).filter(p=>p.frame>startFrame&&p.frame<endFrameExclusive),{frame:endFrameExclusive,t:1}]};
    return patchAnnotation(patch);
  });
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
      if(point&&cameraEditing){
        const handle=event.target.closest('[data-camera-corner]'),camera=productionCamera();
        if(handle&&camera&&lastScene.frame===cameraEditing.frame){cameraDrag={pointerId:event.pointerId,index:Number(handle.getAttribute('data-camera-corner')),id:camera.id,frame:cameraEditing.frame,keyframes:clone(camera.keyframes),stamp:stamp()};host.setPointerCapture(event.pointerId);event.preventDefault();}return;
      }
      if(point&&correctionMode){
        const a=selectedAnnotation(),p=a&&originalPoint(point,a.space);if(!a||!p)return;
        const nearest=nearestRouteProgress(documentValue,a,p,{frame:lastScene.frame});
        const tolerance=a.space==='court'?.7:30*(documentValue.review.height/1080);
        if(nearest.distance>tolerance){status('请点击淡色路线附近；球员偏离路线时应先修改形状，校正进度不会追踪位置。');return;}
        try{const next=correctAnnotationProgress(documentValue,a.id,correctionFrame,nearest.progress);correctionMode=false;correctionFrame=null;await saveAnnotation(next);status('已校正此刻走到的位置；剩余路线即时更新，可撤销。');}catch(error){status(error.message);}event.preventDefault();return;
      }
      if(point&&addingAnnotationPoint){
        const a=selectedAnnotation();if(!a||a.type!=='route'||a.authoredPath||a.curve==='cubic_bezier'||straightRoute(a))return;
        const p=originalPoint(point,a.space);if(!p){status('当前画面无法定位这个控制点，请回到绘制帧再试。');return;}
        const points=structuredClone(a.points),index=selectedAnnotationPoint+1;points.splice(index,0,{x:p.x,y:p.y});addingAnnotationPoint=false;selectedAnnotationPoint=index;await patchAnnotation({points});return;
      }
      if(point&&['route','dashed','dots'].includes(annotationTool)){
        if(!drawing){if(documentValue.schemaVersion===2&&!timeline.range()){timelineInstance?.focusRange();return;}const located=locatedPoint(point);drawing={space:located.space,points:[located.point],frame:lastScene.frame,stamp:stamp(),pattern:annotationTool==='route'?'solid':annotationTool};}
        else if(drawing.points.length>=ANNOTATION_LIMITS.points){status(`一条路线最多 ${ANNOTATION_LIMITS.points} 个点，点「完成绘制」后可继续拖动调整。`);return;}
        else{
          const p=originalPoint(point,drawing.space);if(!p){status('这个位置暂时不能对应到球场，请选择画面内的球场位置。');return;}
          if(drawing.pattern!=='solid'&&Math.hypot(p.x-drawing.points[0].x,p.y-drawing.points[0].y)<=1e-6){status('起点与终点不能重合，请在另一处点击终点。');return;}
          drawing.points.push({x:p.x,y:p.y});
        }
        $('tacticsUndo').disabled=false;event.preventDefault();
        if((drawing.pattern!=='solid'||documentValue.schemaVersion===2)&&drawing.points.length===2){await finishDrawing();return;}
        fillAnnotationControls();drawScene();return;
      }
      if(point&&['screen','spotlight'].includes(annotationTool)){
        if(documentValue.schemaVersion===2&&!timeline.range()){timelineInstance?.focusRange();return;}
        if(annotationTool==='spotlight'){
          if(staticSpotlight){await placeSpotlight(null,point);event.preventDefault();return;}
          const hits=lastScene.mode==='court'?documentValue.review.entities.filter(e=>{const p=documentValue.review.courtPreparation?.preparedByPlayer[e.id]?.[lastScene.frame]??e.courtTrajectory?.[lastScene.frame];return p&&Number.isFinite(p.x)&&Math.hypot(p.x-point.x,p.y-point.y)<.6;}):playersAtVideoPoint(documentValue,lastScene.frame,point,{phaseId,model:lastScene.model});
          if(hits.length>1){footCandidates=hits;fillAnnotationControls();status('这里有多个球员重叠，请在右侧选择脚圈跟随谁。');return;}
          const personId=hits[0]?.id??selectedEntityId;if(!personId){status('请先选择球员或点击人物；若只需静态圈，请明确选择“静态圈（不跟随球员）”。');return;}
          await placeSpotlight(personId,point);event.preventDefault();return;
        }
        const located=locatedPoint(point),id=`draw-${crypto.randomUUID()}`;
        const next=makeAnnotation({id,type:annotationTool,phaseId,entityId:selectedEntityId||null,frame:lastScene.frame,space:located.space,points:[located.point],style:{color:'#ffd34e'}});
        selectedAnnotationId=id;selectedAnnotationPoint=0;annotationTool='select';event.preventDefault();await saveAnnotation(next);return;
      }
      if(point&&annotationTool==='select'){
        const bend=event.target.closest('[data-annotation-bend]'),rotate=event.target.closest('[data-annotation-rotate]'),handle=event.target.closest('[data-annotation-control-index]'),annotationId=event.target.closest('[data-annotation-id]')?.getAttribute('data-annotation-id');
        const hitScene={...annotationScene,items:annotationScene.items.map(i=>({...i,...(lastScene.mode==='court'?{video:i.court}:{}),handles:i.original.curve==='cubic_bezier'&&!$('tacticsShowTangents').checked?i.handles.filter(h=>h.index!==1&&h.index!==2):i.handles}))};
        const hit=annotationId?{id:annotationId,index:handle?Number(handle.getAttribute('data-annotation-control-index')):null}:hitTestAnnotation(hitScene,point,12*(lastScene.mode==='court'?COURT.length:lastScene.model.width)/sceneNodes.width);
        if(hit){
          const adjustingOffset=offsetMode&&selectedAnnotationId===hit.id;selectAnnotation(hit.id);offsetMode=adjustingOffset;selectedAnnotationPoint=hit.index??0;
          const a=selectedAnnotation(),start=originalPoint(point,a.space),item=annotationScene.items.find(item=>item.id===a.id);
          if(a.authoredPath&&lastScene.frame!==a.anchorFrame){seekCanvas(a.anchorFrame);status('已定位路线参考帧，画面就绪后可拖动四个控制点。');return;}
          if(['player_foot','court_player_foot'].includes(a.anchorMode)&&!offsetMode){fillAnnotationControls();drawScene();return;}
          if(start&&item?.[lastScene.mode]){
            const center=a.points[0],rotating=!!rotate&&a.type==='screen';
            annotationDrag={pointerId:event.pointerId,id:a.id,kind:bend?'bend':rotating?'rotate':a.anchorMode==='player_foot'?'offset':'move',offset:{...(a.offset||{x:0,y:0})},index:hit.index,start,points:structuredClone(a.points),space:a.space,stamp:stamp(),angleOffset:rotating?a.style.angle-Math.atan2(start.y-center.y,start.x-center.x)*180/Math.PI:0};
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
    if(cameraDrag?.pointerId===event.pointerId&&lastScene){
      const point=canvasPoint(event),drag=cameraDrag;if(!point||lastScene.frame!==drag.frame)return;
      const keys=clone(drag.keyframes),key=keys.find(k=>k.frame===drag.frame);key.quad[drag.index]=[point.x,point.y];
      try{productionPreview=updateProductionCamera(documentValue,drag.id,{keyframes:keys},{rebindRoutes:true});drawScene();event.preventDefault();}catch{/* Keep the last non-degenerate quadrilateral. */}return;
    }
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
      }else if(drag.kind==='bend'){patch={points:drag.points.map((p,i)=>i===1||i===2?{x:p.x+dx*4/3,y:p.y+dy*4/3}:p)};}else if(drag.kind==='offset')patch={offset:{x:drag.offset.x+dx,y:drag.offset.y+dy}};
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
      if(cameraDrag?.pointerId===event.pointerId){const drag=cameraDrag,next=productionPreview;cameraDrag=null;productionPreview=null;if(next&&JSON.stringify(next.production)!==JSON.stringify(documentValue.production))await saveAnnotation(next,drag.stamp);else drawScene();return;}
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
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();await $(event.shiftKey?'tacticsRedo':'tacticsUndo').onclick();}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();await $('tacticsRedo').onclick();}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'){event.preventDefault();await $('tacticsDuplicate').onclick();}
    else if(event.key==='Delete'||event.key==='Backspace'){if(selectedAnnotation()){event.preventDefault();await $('tacticsAnnotationDelete').onclick();}}
    else if(event.key==='Enter'&&drawing){event.preventDefault();await $('tacticsFinishDrawing').onclick();}
  });
  $('tacticsIdentity').onclick=()=>api.openStep('identity');$('tacticsCalibration').onclick=()=>api.openStep('calibration');
  $('tacticsAction').onchange=fillAction;$('tacticsKind').onchange=()=>{$('tacticsScreenFields').hidden=$('tacticsKind').value!=='screen';};
  $('tacticsApplyAction').onclick=safe(()=>commit(upsertAction(documentValue,{actionId:$('tacticsAction').value,actorId:$('tacticsActor').value,kind:$('tacticsKind').value,startFrame:Number($('tacticsStart').value)-1,endFrameExclusive:Number($('tacticsEnd').value),note:$('tacticsActionNote').value,beneficiaryId:$('tacticsBeneficiary').value,defenderId:$('tacticsDefender').value})));
  $('tacticsDeleteAction').onclick=safe(()=>commit(removeAction(documentValue,$('tacticsAction').value)));
  $('tacticsConfirmAction').onclick=safe(()=>commit(reviewAction(documentValue,$('tacticsAction').value,$('tacticsReviewer').value,true)));
  $('tacticsUnconfirmAction').onclick=safe(()=>commit(reviewAction(documentValue,$('tacticsAction').value,'',false)));
  function guardProductionPhaseChange(){
    if(!documentValue?.production)return false;
    $('tacticsProductionSettings').open=true;status('请先移除成片编排，再分段、合并或改变阶段暂停帧；图形会保留，移除操作可撤销。');return true;
  }
  $('tacticsApplyPhase').onclick=safe(async()=>{const freezeFrame=Number($('tacticsFreeze').value)-1;if(freezeFrame!==phase().freezeFrame&&guardProductionPhaseChange())return;const d=clone(documentValue),p=d.playDefinition.phases.find(p=>p.phaseId===phaseId);p.title=$('tacticsPhaseTitle').value.trim();p.freezeFrame=freezeFrame;d.playDefinition.revision++;await commit(d);});
  $('tacticsUseFrame').onclick=()=>{$('tacticsFreeze').value=api.frame()+1;};
  $('tacticsSplit').onclick=safe(()=>guardProductionPhaseChange()?undefined:commit(splitPhase(documentValue,phaseId,Number($('tacticsSplitAt').value)-1)));
  $('tacticsRemovePhase').onclick=safe(()=>guardProductionPhaseChange()?undefined:commit(removePhase(documentValue,phaseId)));
  for(const [id,field] of [['tacticsTitle','title'],['tacticsNotes','notes']])$(id).oninput=()=>{if(documentValue){documentValue[field]=$(id).value;revision++;markUnsaved();draft();}};
  const resize=new ResizeObserver(()=>{try{drawScene();}catch(error){status(error.message);}});resize.observe($('tacticsCanvas'));
  document.addEventListener('workbench-area',safe(async()=>{
    active=document.body.dataset.area==='tactics';productionUI.pause();if(!active){rangePlayback=null;clearTimeout(holdTimer);epoch++;cancelEditing();if(synchronized)runPlayback(playback.leave());if(document.body.dataset.area==='production'&&!documentValue&&!loading)await load('workspace');return;}api.pause();editingEnabled=true;
    if(!documentValue&&!loading)await load(new URLSearchParams(location.search).has('candidate')?'candidate':'workspace');
    else if(documentValue){if(synchronized)selectPhase(phaseId);else drawScene();}
    await syncSnapshot();agentControls();
    try{const executor=await request('/api/tactics-agent/status');agentAvailable=executor.available;if(!agentJob&&!agentBusy)agentStatus(executor.message);agentControls();}catch(error){agentAvailable=false;if(!agentJob&&!agentBusy)agentStatus(`Agent 服务不可用：${error.message}`);agentControls();}
  }));
  function renderFrame(frame,mediaTime,backgroundSource,{editing=true}={}){
    if(!lastScene||loading)return false;
    if(rangePlayback){
      editing=false;
      if(rangePlayback.pendingStart&&frame!==rangePlayback.range.startFrame)return false;
      if(frame>=rangePlayback.range.endFrameExclusive){api.pause();rangePlayback=null;clearTimeout(holdTimer);editing=true;}
      else{
        const started=rangePlayback.pendingStart;rangePlayback.pendingStart=false;
        const cue=compileTacticKeyframes(documentValue).find(k=>k.frame>=rangePlayback.range.startFrame&&k.frame<=frame&&!rangePlayback.seen.has(k.frame));
        if(cue){const current=rangePlayback;current.seen.add(cue.frame);current.holding=cue.frame;api.pause();api.seek(cue.frame);clearTimeout(holdTimer);holdTimer=setTimeout(()=>{if(rangePlayback===current){current.holding=null;api.play();}},cue.holdSeconds*1000);if(frame!==cue.frame)return false;}
        else if(started)api.play();
      }
    }
    const modeChanged=editingEnabled!==editing;
    if(!editing){personInspection=null;cancelEditing();}editingEnabled=editing;
    lastScene.frame=frame;lastScene.mediaTime=mediaTime;lastScene.backgroundSource=backgroundSource;
    drawScene();if(modeChanged){fillRouteControls();fillAnnotationControls();}return true;
  }
  window.addEventListener?.('pagehide',()=>{clearTimeout(holdTimer);productionUI.dispose();},{once:true});
  let timelineInstance=null;
  const timeline={
    range:()=>timelineInstance?.range()??documentValue?.newDrawingRange??null,
    render(){
      if(documentValue?.schemaVersion!==2)return;
      if(!timelineInstance)timelineInstance=mountTacticsTimeline({host:root.querySelector('.tactics-view'),propertiesHost:$('tacticsAnnotationProperties'),getDocument:()=>documentValue,getSelected:selectedAnnotation,getFrame:()=>lastScene?.frame??api.frame(),
        commit:next=>saveAnnotation(next),seek:seekCanvas,select:id=>selectAnnotation(id),name:annotationName,
        commitRange:async range=>{const next=clone(documentValue);next.newDrawingRange={...range};await saveAnnotation(next);},
        play:range=>{clearTimeout(holdTimer);rangePlayback=null;seekCanvas(range.startFrame);void waitForFrame(range.startFrame).then(()=>runPlayback(playback.playSource?.(range.startFrame,range.endFrameExclusive)??playback.continue(range.startFrame)));},status});
      timelineInstance.render();
    }
  };
  $('tacticsSyncVideo').hidden=true;
  $('tacticsTangentSettings').append($('tacticsAnnotationRouteFields'),$('tacticsAuthoredFields'));
  root.querySelector?.('.tactics-controls')?.append($('tacticsAgentPanel'));$('tacticsAgentPanel').open=false;
  $('tacticsCourtView').onclick=()=>{canvasView='court';$('tacticsSyncVideo').hidden=false;drawScene();};$('tacticsVideoView').onclick=()=>{canvasView='video';$('tacticsSyncVideo').hidden=true;drawScene();};
  $('tacticsMigrate').onclick=safe(async()=>{const result=await migrateTacticsDocument(documentValue,api.clip.mediaEndTime);await writeTacticsDraft(cacheKey()+':before-v2',result.backup);await commit(result.document);});
  $('tacticsRedo').onclick=safe(async()=>{if(!redo.length||editBusy)return;const next=redo.pop();history.push({document:clone(documentValue),selectedAnnotationId});documentValue=next.document;selectedAnnotationId=next.selectedAnnotationId;revision++;markUnsaved();await draft();render({reuseScene:true});});
  render();return {saveDraft:draft,ready:()=>sceneReady,cancelEditing,onPresentedFrame,
    getPlaybackState:playback.state,
    togglePlayback(){if(!active)return false;if(rangePlayback){$('tacticsPause').onclick();return true;}if(playback.state().status==='playing')$('tacticsPause').onclick();else $('tacticsContinue').onclick();return true;},
    externalSeek(frame){
      if(!active||!synchronized)return;rangePlayback=null;clearTimeout(holdTimer);personInspection=null;cameraEditing=null;cancelEditing();
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
