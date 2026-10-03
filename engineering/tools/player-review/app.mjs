import {mountIdentityUI,mountVideoDisplay} from './ui.bundle.mjs';
import {mountFootageUI} from './footage-ui.mjs';
import {manualPathAnchors} from './manual-path.mjs';
import {editImageAnchor,dragImageEdit} from './image-edit.mjs';
import {createWorkspace} from './workspace.mjs';
import {blankSession,ensurePlayerSlots,buildTrajectories,confirmFrameIdentity,correctFrameIdentity,reviewTrailCuts,gapRanges,exportReview,isHumanIdentitySelected,isSelected,hasAssociation,entityLabel,playerDisplayState,draftStorageKey,trackingModelSummary,trackCatalog,confirmBinding,continuationSuggestions} from './trajectory.mjs';
import {IDENTITY_BINDING_MODE,migrateIdentitySession,confirmIdentity,identityInterval,identityConfirmationInterval,identitySuggestionSummary} from './identity-timeline.mjs';
import {teamOverlayStyle,candidateOverlayColor,stabilizePoints,presentationPoint,frameAtMediaTime,frameSeekTime} from './team-overlay.mjs';
import {trackedPersonProposals,pickPersonProposal,visibleObjects,personTrail,indexTemporaryTracks,temporaryTrail,mergeSourceCuts,toggleReviewCut,REVIEW_COLORS,trackingReviewState,reviewedPersonTrail} from './tracking-display.mjs';
import {mountSceneObjects} from './scene-objects-ui.mjs';
import {feetForPoint,footCandidateAnchor} from './feet-candidates.mjs';
import {initializeAutomaticAnnotations,automaticPlayerCandidates,automaticAnnotationPointVisible} from './automatic-annotations.mjs';
import {mountPlayerIdentityUI,exportPlayerIdentities} from './player-identity.mjs';
import {trackingDiagnostic,detectionFrameSummary} from './tracking-diagnostics.mjs';
import {mountVideoLibrary} from './video-library.mjs';
import {modelResultLabel} from './model-selection.mjs';
import {mountTacticsUI} from './tactics-ui.mjs';
import {migrateLegacyTacticsDrafts} from './tactics-storage.mjs';
await migrateLegacyTacticsDrafts().catch(()=>{});
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const library=await fetch('/api/library').then(r=>{if(!r.ok)throw new Error('视频库加载失败');return r.json();});
const requestedSample=params.get('sample');
const sample=library.samples.some(item=>item.id===requestedSample)?requestedSample:library.defaultSample;
if(requestedSample&&requestedSample!==sample){params.set('sample',sample);params.delete('variant');window.history.replaceState(null,'',`/?${params}`);}
const sampleInfo=library.samples.find(item=>item.id===sample);
const requestedVariant=params.get('variant')||sampleInfo?.defaultVariant||library.defaultVariant||'original';
const clip=await fetch(`/api/clip?sample=${encodeURIComponent(sample)}&variant=${encodeURIComponent(requestedVariant)}`).then(response=>{if(!response.ok)throw new Error('视频数据加载失败');return response.json();});
const variant=clip.tracking_revision||clip.variant||requestedVariant;
const teamPolicy=clip.trackingMetadata?.presentation?.policy||await fetch('/team-overlay-policy.json').then(response=>{if(!response.ok)throw new Error('分队显示规则加载失败');return response.json();});
const qa=params.has('qa');
const key=draftStorageKey(clip,variant,qa);
let session=blankSession(clip.video_sha256);
session.maxGapSeconds=0;
const sourceCuts=mergeSourceCuts([],clip.sourceCuts,clip.frames.length);
session.cuts=[...sourceCuts];
try{const raw=localStorage.getItem(key),saved=JSON.parse(raw);if(saved?.videoHash===clip.video_sha256&&saved.version===1&&Array.isArray(saved.entities)){
  if(saved.identityBindingMode!==IDENTITY_BINDING_MODE&&!localStorage.getItem(key+':before-forward-identity'))localStorage.setItem(key+':before-forward-identity',raw);
  session=saved;
}}catch{}
session.cuts=mergeSourceCuts(session.cuts,sourceCuts,clip.frames.length);
ensurePlayerSlots(session);migrateIdentitySession(session);
const automaticSummary=initializeAutomaticAnnotations(session,clip);
if(session.courtCalibration===undefined)session.courtCalibration=structuredClone(clip.courtCalibration||null);
if(session.liveSelection===undefined)session.liveSelection=structuredClone(clip.liveSelection||null);
if(!session.liveRanges)session.liveRanges=session.liveSelection?[{start:0,end:clip.frames.length-1}]:[];
let workspace=null,sceneUI=null,playerIdentityUI=null;
let footageUI=null,pathStroke=null;
let active='P1',frame=0,mode='select',trajectories={},stableTrajectories={},history=[],toastTimer,previewTrackId=null;
let playerTrailCuts={},temporaryTrailCuts=new Map();
let reviewBusy=false,sessionRevision=0;
let associationScope='track_occurrences';
let videoDisplay=null;
let tacticsUI=null;
const catalog=trackCatalog(clip.frames);
const trackIndex=indexTemporaryTracks(clip.frames);
const versions=(clip.variants||[{id:'original',label:'原跟踪 · 保留已有草稿'}]).filter(item=>!clip.importSourceSha256||item.id!=='original');
for(const item of [...versions].sort((a,b)=>Number(b.recommended)-Number(a.recommended))){const option=document.createElement('option');option.value=item.id;option.textContent=modelResultLabel(library.modelChoices,item.id,item.label);$('trackingVersion').append(option);}
$('trackingVersion').value=variant;
const currentVersion=versions.find(item=>item.id===variant);
$('modelSummary').textContent=`${modelResultLabel(library.modelChoices,variant,currentVersion?.label||variant)}。不同检测器改变候选框；跟踪器影响 T 编号和断轨续接。各组合分别保存结果与草稿，准确性仍需核对。`;
const modelSummary=trackingModelSummary(clip.trackingMetadata||{},modelResultLabel(library.modelChoices,variant,currentVersion?.label||variant));
$('trackerStage').textContent=`${modelSummary.tracker} 连续关联`;
const objectKinds=new Set(clip.frames.flatMap(record=>visibleObjects(record).map(object=>object.kind)));
$('detectionStage').textContent=['人物',...(objectKinds.has('basketball')?['球']:[]),...(objectKinds.has('hoop')?['篮筐']:[])].join(' / ');
$('modelName').textContent=modelSummary.model;$('modelTrackerName').textContent=modelSummary.tracker;
$('modelDevice').textContent=modelSummary.device;$('modelParameters').textContent=modelSummary.details.join(' · ')||'未提供参数';
$('modelVariant').textContent=modelSummary.variant;
let suggestionSummary=null,suggestionError='';
if(clip.identitySuggestions)try{suggestionSummary=identitySuggestionSummary(clip.identitySuggestions,clip.frames);}catch(error){suggestionError=error.message;}
$('loadIdentitySuggestions').disabled=!suggestionSummary?.bindingCount&&!automaticSummary.playerCount;
$('suggestionSource').textContent=suggestionError|| (automaticSummary.playerCount?
  `当前保留 ${automaticSummary.playerCount} / 10 个球员编号。自动关联仍需核对，重新检查会保留人工修改和已有编号。`:
  '当前版本没有可用的十人关联建议。按固定球员 1–10 逐个人工确认，缺失位置保持空白。');
$('loadIdentitySuggestions').textContent='重新检查自动编号';
$('loadIdentitySuggestions').onclick=()=>{try{let summary;change(()=>summary=initializeAutomaticAnnotations(session,clip));toast(`已保留 ${summary.playerCount} 个球员编号；新增 ${summary.addedPlayerIds.length} 个自动关联，可撤销。人工修改保留。`);}catch(error){toast(error.message);}};
for(const item of catalog){const option=document.createElement('option');option.value=item.id;option.textContent=`临时 ${item.id} · ${clip.frames[item.start].time.toFixed(2)}–${clip.frames[item.end].time.toFixed(2)} s`;$('linkTrack').append(option);}
for(const id of ['linkStart','linkEnd'])$(id).max=clip.frames.length;
const video=$('video'),canvas=$('overlay'),ctx=canvas.getContext('2d');
video.src=`/video.mp4?sample=${encodeURIComponent(sample)}`;
for(const item of library.samples){const option=document.createElement('option');option.value=item.id;option.textContent=item.title;$('sampleSelect').append(option);}
$('sampleSelect').value=sample;
$('sampleSelect').onchange=async e=>{const selected=e.target.value;await saveDraft();params.set('sample',selected);params.delete('variant');params.delete('area');params.delete('candidate');location.assign(`/?${params}`);};
$('sampleTitle').textContent=sampleInfo?.title||'本地视频';$('sampleDescription').textContent=sampleInfo?.description||'';
$('sampleSource').href=sampleInfo?.sourceUrl||'#';$('sampleSource').hidden=!sampleInfo?.sourceUrl;
mountVideoLibrary({sample,variant,clip,modelChoices:library.modelChoices,localVideo:!!clip.importSourceSha256,presets:library.processingPresets||[],beforeNavigate:()=>saveDraft()});
let drag=null,suppressClick=false;
const identityUI=mountIdentityUI({select:id=>{active=id;refresh();},setField:(name,value)=>change(()=>entity()[name]=value|| (name==='name'?entityLabel(active):'')),prepareEdit:prepareGeometryEdit,setMode,setAssociationScope:value=>{if(['track_occurrences','forward'].includes(value)){associationScope=value;pauseVideo();draw();}},preview:proposal=>{previewTrackId=proposal?.trackId??null;draw();},associate:associateProposal,confirmCurrent:confirmCurrentFrame,associateCurrent:()=>{const point=trajectories[active]?.[frame];const proposal=proposals().find(item=>item.trackId===point?.trackId);if(proposal)return associateProposal({...proposal,preservePosition:true});},edit:commitImageEdit,seek,removeIdentity:at=>change(()=>{
  entity().identityKeyframes=entity().identityKeyframes.filter(item=>item.frame!==at);
  entity().anchors=entity().anchors.filter(item=>item.frame!==at);entity().frameConfirmations=(entity().frameConfirmations||[]).filter(item=>item.frame!==at);session.identitySelection=null;
}),releaseIdentity:()=>reviewEdit({type:'release_identity',entityId:active,frame}),
clearPlayer:()=>reviewEdit({type:'clear_player',entityId:active}),
correctCandidate:(proposal,scope)=>associateProposal(proposal,scope),
swapPlayers:(sourceId,targetId)=>reviewEdit({type:'swap_players',sourceId,targetId})});
canvas.width=clip.width;canvas.height=clip.height;
footageUI=mountFootageUI({clip,sample,variant,qa,session:()=>session,frame:()=>frame,change,seek,toast,next:()=>workspace.switchStep('identity',true)});
$('scrubber').max=clip.frames.length-1;
session.presentationStable??=Boolean(clip.trackingMetadata?.presentation?.default_stable);
$('stableDisplay').checked=session.presentationStable;
function entity(){return session.entities.find(item=>item.id===active);}
function isAssigned(item){const points=trajectories[item.id]||[];return isHumanIdentitySelected(item)&&(points.some(point=>point.x!=null&&!point.reviewExcluded)||(item.courtAnchors||[]).some(anchor=>!points[anchor.frame]?.reviewExcluded&&!['conflict','out_of_view'].includes(points[anchor.frame]?.source)));}
function color(id){const item=session.entities.find(item=>item.id===id);return item?.role==='referee'?'#dba72b':item?.teamSide==='red'?'#ee5568':'#4295ed';}
function annotationPoint(point){return point&&!automaticAnnotationPointVisible(clip,frame,point)?{...point,x:null,y:null,annotationNeedsReview:point.x!=null}:point;}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4500);}
function saveDraft(){session.cuts=mergeSourceCuts(session.cuts,sourceCuts,clip.frames.length);localStorage.setItem(key,JSON.stringify(session));return tacticsUI?.saveDraft();}
function change(callback){history.push({draft:JSON.stringify(session),active});if(history.length>40)history.shift();callback();sessionRevision++;saveDraft();refresh();}
async function reviewEdit(operation){
  if(reviewBusy)return false;
  if(operation.type==='swap_players'&&operation.sourceId===operation.targetId)return false;
  pauseVideo();reviewBusy=true;const revision=sessionRevision;draw();
  try{
    const response=await fetch('/api/review-edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sample,variant,qa,session,operation})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'这次修改未保存，请重试。');
    if(revision!==sessionRevision)throw new Error('等待期间草稿已有新修改，本次操作未覆盖草稿；请重试。');
    if(!result.session||result.session.videoHash!==clip.video_sha256)throw new Error('返回的草稿与当前视频不匹配，请重试。');
    change(()=>{
      session=result.session;migrateIdentitySession(session);
      if(operation.type==='swap_players'){
        if(active===operation.sourceId)active=operation.targetId;
        else if(active===operation.targetId)active=operation.sourceId;
      }
    });
    previewTrackId=null;
    const assigned=operation.type==='assign_track'?trajectories[operation.entityId]?.[operation.frame]:null;
    if(operation.type==='assign_track'&&(!assigned?.frameIdentityConfirmed||assigned.trackId!==operation.trackId)){
      if(active===operation.entityId&&frame===operation.frame)previewTrackId=operation.trackId;
      toast(`已登记 T${operation.trackId}，但第 ${operation.frame+1} 帧仍有关联冲突或既有人工规则，尚未确认。请预览正确候选并选择纠正范围。`);
    }else toast(result.message||'已保存修改，可撤销。');
    return true;
  }catch(error){toast(error.message==='Failed to fetch'?'本地服务暂时不可用，修改未保存；请重试。':error.message);return false;}
  finally{reviewBusy=false;draw();}
}
function pauseVideo(){if(videoDisplay)videoDisplay.pause();else video.pause();}
function seek(index){frame=Math.max(0,Math.min(clip.frames.length-1,index));const time=frameSeekTime(clip.frames,frame);if(videoDisplay)videoDisplay.seek(time);else{video.pause();video.currentTime=time;}draw();}
function updateFrame(mediaTime){if(videoDisplay&&$('stage').dataset.videoState!=='ready')return;frame=frameAtMediaTime(clip.frames,Number.isFinite(mediaTime)?mediaTime:video.currentTime,frame);draw();}
function proposals(){return trackedPersonProposals(clip.frames[frame],clip.track_roles,clip.detectorEvidence);}
function drawBox(box,stroke,label,dashed=false,labelSize=20){const[x1,y1,x2,y2]=box;ctx.strokeStyle=stroke;ctx.lineWidth=3;ctx.setLineDash(dashed?[10,7]:[]);ctx.strokeRect(x1,y1,x2-x1,y2-y1);ctx.setLineDash([]);if(label){ctx.font=`bold ${labelSize}px sans-serif`;const w=ctx.measureText(label).width+14;ctx.fillStyle=stroke;ctx.fillRect(x1,Math.max(0,y1-labelSize-8),w,labelSize+7);ctx.fillStyle='#102133';ctx.fillText(label,x1+7,Math.max(labelSize+1,y1-7));}}
function drawTrail(points,stroke,selected=false){
  if(points.length<2)return;
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash([]);
  ctx.beginPath();points.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));
  if(selected){ctx.strokeStyle='#102133b0';ctx.lineWidth=10;ctx.stroke();}
  ctx.strokeStyle=stroke;ctx.lineWidth=selected?5:2.5;ctx.globalAlpha=selected ? .95 : .55;ctx.stroke();
  ctx.fillStyle=stroke;ctx.beginPath();ctx.arc(points[0].x,points[0].y,selected?4:2.5,0,2*Math.PI);ctx.fill();ctx.restore();
}
function drawPlayer(point,style){
  const scale=clip.height/720;ctx.strokeStyle=style.color;ctx.lineWidth=teamPolicy.box.lineWidthAt720*scale;ctx.setLineDash(style.dashed?teamPolicy.box.dashAt720.map(value=>value*scale):[]);
  if(point.box){const[x1,y1,x2,y2]=point.box;ctx.strokeRect(x1,y1,x2-x1,y2-y1);}
  ctx.beginPath();ctx.ellipse(point.x,point.y,teamPolicy.foot.radiusXAt720*scale,teamPolicy.foot.radiusYAt720*scale,0,0,2*Math.PI);ctx.stroke();ctx.setLineDash([]);
  const size=teamPolicy.foot.fontSizeAt720*scale,y=Math.max(size+2,point.y-teamPolicy.foot.numberOffsetAt720*scale);
  ctx.font=`bold ${size}px sans-serif`;const width=ctx.measureText(style.label).width;
  ctx.fillStyle='#221910';ctx.fillRect(point.x-width/2-3,y-size-3,width+6,size+7);ctx.fillStyle=style.color;ctx.fillText(style.label,point.x-width/2,y);
}
function drawReviewedTrail(trail,points){
  const {markers,segments}=reviewedPersonTrail(trail,points);
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash([]);
  for(const {from,to,status} of segments){
    ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);
    ctx.strokeStyle='#102133b0';ctx.lineWidth=9;ctx.stroke();
    ctx.strokeStyle=REVIEW_COLORS[status];ctx.lineWidth=5;ctx.stroke();
  }
  for(const point of markers){
    if(['missing','invalid','out_of_view'].includes(point.review.status))continue;
    ctx.beginPath();ctx.arc(point.x,point.y,point.review.status==='human'?5.5:3,0,2*Math.PI);
    ctx.fillStyle=REVIEW_COLORS[point.review.status];ctx.fill();
    if(point.review.status==='human'){ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();}
  }
  ctx.restore();
}
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const candidates=proposals(),objects=sceneUI?.objects()||visibleObjects(clip.frames[frame]);
  const annotations=session.entities.filter(hasAssociation).map(entity=>({entity,point:trajectories[entity.id]?.[frame]}))
    .filter(({point})=>point&&point.x!==null&&automaticAnnotationPointVisible(clip,frame,point));
  const pTail=hasAssociation(entity())?personTrail(trajectories[active],clip.frames,frame,playerTrailCuts[active]||session.cuts):[];
  if($('showTrackTrails').checked){
    for(const candidate of candidates)if(candidate.trackId!=null)drawTrail(temporaryTrail(trackIndex,clip.frames,candidate.trackId,frame,temporaryTrailCuts.get(candidate.trackId)||session.cuts),REVIEW_COLORS.machine);
    drawReviewedTrail(pTail,trajectories[active]);
  }
  if($('showObjects').checked)for(const object of objects){
    const stroke=object.kind==='basketball'?'#ffaf52':'#ff78b7',name=object.kind==='basketball'?'篮球候选':'篮筐候选';
    const selected=sceneUI?.selected()===object.id;
    if(object.box)drawBox(object.box,selected?'#ffe14e':stroke,`${name}${selected?' · 已选中':''}`,true);
    const [x,y]=object.point||[(object.box[0]+object.box[2])/2,(object.box[1]+object.box[3])/2];
    ctx.beginPath();ctx.arc(x,y,5,0,2*Math.PI);ctx.strokeStyle=stroke;ctx.lineWidth=3;ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-9,y);ctx.lineTo(x+9,y);ctx.moveTo(x,y-9);ctx.lineTo(x,y+9);ctx.stroke();
  }
  if($('showCandidates').checked)for(const proposal of candidates){
    const id=`T${proposal.trackId}${proposal.detectionObserved?'':' · 检测?'} `;
    const label=`${id}${proposal.roleConflict?' · 角色?':proposal.role==='referee'?' · 裁判':''}`;
    const stroke=candidateOverlayColor(proposal,annotations,teamPolicy);
    drawBox(proposal.box,stroke,label,true);
  }
  for(const {entity:item,point} of annotations){const displayed=presentationPoint(point,stableTrajectories[item.id]?.[frame],{stable:$('stableDisplay').checked,editing:Boolean(drag)});const rendered=drag?.entityId===item.id?{...point,...drag.edit}:displayed;const style=teamOverlayStyle(item,point,teamPolicy),stroke=style.color;drawPlayer(rendered,style);
    if(item.id===active&&rawEditing()){if(rendered.box){const b=rendered.box;for(const [x,y] of [[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]]){ctx.fillStyle='#fff';ctx.strokeStyle=stroke;ctx.fillRect(x-7,y-7,14,14);ctx.strokeRect(x-7,y-7,14,14);}}ctx.beginPath();ctx.moveTo(rendered.x-18,rendered.y);ctx.lineTo(rendered.x+18,rendered.y);ctx.moveTo(rendered.x,rendered.y-18);ctx.lineTo(rendered.x,rendered.y+18);ctx.strokeStyle=stroke;ctx.stroke();}}
  if(previewTrackId!==null){const box=clip.frames[frame].tracks.find(box=>Number(box[4])===previewTrackId);if(box)drawBox(box,teamPolicy.candidateColor,`候选 T${previewTrackId}`,true);}
  if(pathStroke?.length){ctx.beginPath();pathStroke.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle='#d99516';ctx.lineWidth=5;ctx.setLineDash([10,5]);ctx.stroke();ctx.setLineDash([]);}
  $('time').textContent=`${clip.frames[frame].time.toFixed(2)} s`;$('frameLabel').textContent=`第 ${frame+1} / ${clip.frames.length} 帧`;$('scrubber').value=frame;$('play').textContent=video.paused?'播放':'暂停';
  const item=entity(),point=trajectories[active]?.[frame];
  const feet=feetForPoint(clip,frame,point),footText=side=>feet?.[side]?`${side==='left'?'左脚':'右脚'} (${feet[side].x.toFixed(1)}, ${feet[side].y.toFixed(1)}) px · ${Math.round(feet[side].score*100)}%`:`${side==='left'?'左脚':'右脚'}无候选`;
  $('feetCandidateStatus').textContent=feet?`${entityLabel(active)} / T${point.trackId}：${footText('left')}；${footText('right')}。来源 ${feet.source}。`:point?.trackId==null?'先把当前球员关联到一个临时 T 编号。':'当前帧 / 模型版本没有匹配的脚部候选；可直接人工补脚下点。';
  $('adoptLeftFoot').disabled=!feet?.left;$('adoptRightFoot').disabled=!feet?.right;
  if(feet&&$('showFeetCandidates').checked)for(const side of ['left','right'])if(feet[side]){const p=feet[side];ctx.beginPath();ctx.arc(p.x,p.y,9,0,2*Math.PI);ctx.strokeStyle=side==='left'?'#ffda70':'#cf9dff';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.font='bold 17px sans-serif';ctx.fillText(side==='left'?'左脚?':'右脚?',p.x+12,p.y);}
  const visibleCount=candidates.filter(p=>p.trackId!=null).length;
  $('trackingContinuity').textContent=`当前 ${visibleCount} 个临时 T 编号${hasAssociation(item)?` · ${entityLabel(active)} ${point?.trackId!=null?`关联 T${point.trackId}`:'当前无临时编号'} · 连续原图位置 ${pTail.length} 帧`:''}。尾迹为最近 1.2 秒的原图位置，受镜头移动影响；缺失、估计、身份确认、人工补点与切镜处断开。`;
  const basketballs=objects.filter(o=>o.kind==='basketball').length,hoops=objects.filter(o=>o.kind==='hoop').length;
  $('objectStatus').textContent=objects.length?`当前帧：篮球 ${basketballs} 个候选 · 篮筐 ${hoops} 个候选。框中心是图像标记，不能作为球场地面点。`:'当前帧没有篮球 / 篮筐候选；只显示当前版本提供的独立对象检测。';
  footageUI?.render();sceneUI?.render();
  const descriptions={manual:'这一帧的位置由你确认。',tracked:'这一帧有已关联编号的位置；是否为同一个真人、脚点是否准确，仍需逐帧核对。',interpolated:'这一帧由前后位置估计；不是模型直接检出的结果。',missing:'这一帧尚未关联到位置；可以找回新编号、补点，或标记离开画面。',out_of_view:'这一帧已由你标记为离开画面，不计算位置。',conflict:'这一帧存在身份冲突，需要你重新点选确认。'};
  if(point?.source==='manual')descriptions.manual=point.footMethod==='bbox_bottom_center'?'这一帧已人工选人；位置仍取框底边中心，尚未确认地面脚点。':point.footMethod==='pose_candidate_human_adopted'?'这一帧由你采用脚部模型候选，来源已保留，接地尚未验证。':'这一帧使用人工点选的原图参考位置，仍需核对地面接触与标定。';
  if(point?.identitySource==='reassigned')descriptions.missing=`原关联在这一段已由人工确认归到 ${entityLabel(point.claimedBy)}；请重新关联当前球员。`;
  else if(point?.visibility==='occluded_waiting')descriptions.missing='遮挡 / 断轨待续接：身份关联保留，当前没有可靠位置，不生成框。';
  if(point?.identitySource==='model_suggestion')descriptions.tracked='当前是模型建议的位置与身份，尚未人工确认；检查后可锁定当前球员。';
  if(point?.frameIdentityConfirmed===true&&point.source==='tracked')descriptions.tracked='本帧人物已人工确认，球员框用实线；位置来自检测框，脚点仍需核对。';
  if(point?.reviewExcluded)descriptions.missing='这一段已取消关联，模型和旧修正不会自动补回。点击候选重新关联，或撤销取消操作。';
  descriptions.manual_path='手绘路径的拟补位置，时间沿路径均匀分配；逐帧核对后点击脚点或保存坐标确认。';
  $('pointStatus').textContent=hasAssociation(item)?`${entityLabel(active)} · ${descriptions[point?.source]||''}`:`${entityLabel(active)} · 位置未知。点击候选人物后人工确认。`;
  $('cut').disabled=sourceCuts.includes(frame);
  $('cut').textContent=sourceCuts.includes(frame)?'固定拼接点 · 轨迹在此断开':session.cuts.includes(frame)?'移除此处切镜标记':'此处标记切镜';drawTimeline();workspace?.draw();workspace?.drawImageOverlay(ctx);identityUI.render({entity:entity(),teamPolicy,display:playerDisplayState(entity(),point),entities:session.entities.map(e=>({id:e.id,name:e.name,role:e.role,teamSide:e.teamSide,selected:isAssigned(e),display:playerDisplayState(e,trajectories[e.id]?.[frame]),review:trackingReviewState(trajectories[e.id]?.[frame]),hasRecords:['anchors','identityKeyframes','bindings','modelBindings','courtAnchors','events','frameConfirmations'].some(field=>e[field]?.length)})),reviewBusy,releaseRange:identityInterval(session,entity(),frame,clip.frames.length),point:trajectories[active]?.[frame],frame,mode,associationScope,trackAssignments:trackAssignments(),proposals:candidates,previewTrackId,observedIds:[...new Set((trajectories[active]||[]).filter(p=>p.trackId!=null&&p.x!=null).map(p=>p.trackId))],identityRanges:(entity().identityKeyframes||[]).map(item=>({...item,...identityConfirmationInterval(session,entity(),item.frame,clip.frames.length),time:clip.frames[item.frame].time}))});
  const detection=detectionFrameSummary(clip.frames[frame],clip.detectorEvidence);
  $('detectionSummary').textContent=`本帧跟踪候选 ${candidates.length} · ${detection.complete?'检测来源已核验':'检测来源证据有限'}`;
  $('detectionEvidence').textContent='当前只显示带 T 编号的跟踪候选。T 由跟踪器跨帧关联产生，球员身份仍需核对。';
  const diagnostic=trackingDiagnostic(clip.frames[frame],point,previewTrackId!=null?candidates.find(item=>item.trackId===previewTrackId):null,clip.detectorEvidence);$('trackingDiagnosis').textContent=`${diagnostic.label}：${diagnostic.detail}`;
  playerIdentityUI?.render();
}
function drawTimeline(){
  const target=$('timeline'),context=target.getContext('2d'),dpr=devicePixelRatio||1,points=trajectories[active]||[];
  target.width=Math.round(target.clientWidth*dpr);target.height=36*dpr;context.clearRect(0,0,target.width,target.height);
  if(hasAssociation(entity()))points.forEach((point,index)=>{context.fillStyle=REVIEW_COLORS[trackingReviewState(point).status];context.fillRect(index/points.length*target.width,8*dpr,target.width/points.length+1,20*dpr);});
  for(const cut of session.cuts){context.fillStyle='#122034';context.fillRect(cut/clip.frames.length*target.width,0,2*dpr,target.height);}
  context.fillStyle='#122034';context.fillRect(frame/clip.frames.length*target.width,0,2*dpr,target.height);
  const review=trackingReviewState(points[frame]),badge=$('trackingReviewStatus');badge.dataset.review=review.status;badge.textContent=`人物：${review.label}`;
  target.title=`第 ${frame+1} 帧 · ${review.label}。绿色只确认本帧人物，脚点与球场标定另行核对。`;
  target.setAttribute('aria-valuenow',String(frame+1));target.setAttribute('aria-valuemax',String(clip.frames.length));target.setAttribute('aria-valuetext',target.title);
}
function refresh(){
  session.cuts=mergeSourceCuts(session.cuts,sourceCuts,clip.frames.length);
  trajectories=buildTrajectories(session,clip.frames,sourceCuts);
  playerTrailCuts=Object.fromEntries(session.entities.map(item=>[item.id,reviewTrailCuts([item],session.cuts,clip.frames.length)]));
  temporaryTrailCuts=new Map(catalog.map(item=>[item.id,reviewTrailCuts(session.entities,session.cuts,clip.frames.length,item.id)]));
  stableTrajectories=Object.fromEntries(Object.entries(trajectories).map(([id,points])=>[id,stabilizePoints(points,session.cuts,clip.width,clip.height,teamPolicy)]));
  $('stableDisplay').checked=Boolean(session.presentationStable);
  const bound=session.entities.filter(hasAssociation),human=session.entities.filter(isAssigned);
  const proposed=session.entities.filter(e=>e.role==='player'&&e.modelBindings?.length&&!isHumanIdentitySelected(e)).length;
  $('summary').textContent=`人工关联 ${human.filter(item=>item.role==='player').length} / 10${proposed?` · 建议待确认 ${proposed}`:''}${qa?' · 测试模式':''}`;
  $('maxGap').value=String(session.maxGapSeconds);$('undo').disabled=!history.length;$('export').disabled=!bound.length;
  const points=trajectories[active],counts={};points.forEach(point=>counts[point.source]=(counts[point.source]||0)+1);
  $('coverage').textContent=hasAssociation(entity())?`人物已逐帧确认 ${points.filter(point=>point.frameIdentityConfirmed).length} / ${points.length} 帧 · 人工位置 ${counts.manual||0} · 模型位置 ${counts.tracked||0} · 估计 ${(counts.interpolated||0)+(counts.manual_path||0)} · 缺失 / 冲突 ${(counts.missing||0)+(counts.conflict||0)} · 出画 ${counts.out_of_view||0}`:'先在右侧选择球员 1–10，再点画面中的候选人物';
  $('anchorList').replaceChildren();for(const anchor of [...entity().anchors].sort((a,b)=>a.frame-b.frame)){const row=document.createElement('div');row.className='anchor';const jump=document.createElement('button');jump.textContent=`位置 · 第 ${anchor.frame+1} 帧 · ${clip.frames[anchor.frame].time.toFixed(2)} s`;jump.addEventListener('click',()=>seek(anchor.frame));const remove=document.createElement('button');remove.textContent='删除位置';remove.addEventListener('click',()=>change(()=>entity().anchors=entity().anchors.filter(item=>item.frame!==anchor.frame)));row.append(jump,remove);$('anchorList').append(row);}
  const playerCount=human.filter(e=>e.role==='player').length;
  $('identityProgress').textContent=`人工关联 ${playerCount} / 10 名球员${session.identitySelection?' · 十人关联已登记':''}${proposed?` · 模型建议待确认 ${proposed} 名`:''}。关联数量不代表逐帧审核通过；位置未知留空。`;
  $('identityDone').disabled=playerCount!==10;
  $('suggestionLoadStatus').textContent=session.modelSuggestionLoad?`已载入 ${session.modelSuggestionLoad.playerCount} 个槽位的候选关联，身份仍需人工确认；可用顶部“撤销”恢复。`:'';
  renderBindings();workspace?.refresh();$('cuts').textContent=session.cuts.length?`切镜：${session.cuts.map(index=>`第 ${index+1} 帧${sourceCuts.includes(index)?'（固定拼接点）':''}`).join('、')}`:'当前没有切镜标记。';draw();
}
function trackAssignments(){
  const grouped=new Map();
  for(const binding of entity().bindings||[]){
    if(binding.scope!=='track_occurrences')continue;
    if(!grouped.has(binding.trackId))grouped.set(binding.trackId,{trackId:binding.trackId,start:binding.start,frames:0,segments:0});
    const item=grouped.get(binding.trackId);item.start=Math.min(item.start,binding.start);item.frames+=binding.end-binding.start+1;item.segments++;
  }
  return [...grouped.values()].sort((a,b)=>a.trackId-b.trackId);
}
async function associateProposal(hit,scope=associationScope){
  if(!hit)return false;
  if(hit.trackId==null||hit.suppressed||(hit.sourcePartition&&hit.sourcePartition!=='tracks')){toast('请选择带 T 编号的跟踪候选。');return false;}
  if(reviewBusy)return false;
  pauseVideo();
  const current=trajectories[active]?.[frame];
  if(scope==='track_occurrences'&&(current?.source==='conflict'||current?.identitySource==='reassigned')){
    previewTrackId=hit.trackId;draw();
    toast(`已预览 T${hit.trackId}；请在右侧选择“仅本帧采用”或“从本帧向后采用”来纠正关联。`);return false;
  }
  if(scope==='track_occurrences'){
    return reviewEdit({type:'assign_track',entityId:active,trackId:Number(hit.trackId),frame});
  }
  let interval;
  try{const copy=structuredClone(session);interval=scope==='frame'?correctFrameIdentity(copy,active,frame,hit,clip.frames,sourceCuts):confirmIdentity(copy,active,frame,hit,clip.frames);change(()=>session=copy);}catch(error){toast(error.message);return false;}
  const released=session.entities.filter(item=>item.id!==active&&trajectories[item.id].some(point=>point.claimedBy===active&&point.frame>=interval.start&&point.frame<=interval.end)).map(item=>item.id);
  previewTrackId=null;draw();toast(scope==='frame'?`${entityLabel(active)} 仅第 ${frame+1} 帧已改为 T${hit.trackId} 并确认；其他帧保持原有关联，可撤销。`:`${entityLabel(active)} 从第 ${interval.start+1} 帧起关联 T${hit.trackId}，到第 ${interval.end+1} 帧；此前绑定保留。${released.length?` ${released.join('、')} 的重叠错误关联已留空待处理。`:''}`);return true;
}
function confirmCurrentFrame(){
  if(reviewBusy)return false;pauseVideo();
  try{change(()=>confirmFrameIdentity(session,active,frame,clip.frames,sourceCuts));previewTrackId=null;draw();toast('当前帧人物已确认，球员框改为实线；其他帧仍需核对。');return true;}
  catch(error){toast(error.message);return false;}
}
function commitImageEdit(edit){try{const anchor=editImageAnchor(trajectories[active]?.[frame],frame,edit,clip.width,clip.height);change(()=>{entity().anchors=entity().anchors.filter(a=>a.frame!==frame);entity().anchors.push(anchor);});toast(`${entityLabel(active)} 当前帧位置已保存，可撤销。`);}catch(error){toast(error.message);}}
function imagePosition(event){const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)/r.width*clip.width,y:(event.clientY-r.top)/r.height*clip.height};}
function editable(){return ['identity','repair'].some(step=>$(`tab-${step}`).getAttribute('aria-selected')==='true');}
function rawEditing(){return editable()&&!$('stableDisplay').checked;}
function prepareGeometryEdit(){pauseVideo();session.presentationStable=false;$('stableDisplay').checked=false;saveDraft();draw();}
function handleAt(x,y){
  if(sceneUI?.isPicking())return null;
  if(!rawEditing())return null;const point=trajectories[active]?.[frame];if(point?.x==null)return null;
  const tolerance=14*clip.width/canvas.clientWidth;
  if(Math.hypot(x-point.x,y-point.y)<tolerance)return 'foot';
  if(!point.box)return null;const b=point.box,corners=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]];
  const corner=corners.findIndex(([xx,yy])=>Math.hypot(xx-x,yy-y)<tolerance*.7);if(corner>=0)return `corner${corner}`;
  if(x>=b[0]-tolerance*.5&&x<=b[2]+tolerance*.5&&y>=b[1]-tolerance*.5&&y<=b[3]+tolerance*.5&&Math.min(Math.abs(x-b[0]),Math.abs(x-b[2]),Math.abs(y-b[1]),Math.abs(y-b[3]))<tolerance*.5)return 'box';
  return null;
}
canvas.addEventListener('pointerdown',e=>{if(e.button!==0||sceneUI?.isPicking())return;const pos=imagePosition(e);if(mode==='path'&&editable()){pauseVideo();pathStroke=[pos];canvas.setPointerCapture(e.pointerId);e.preventDefault();return;}const kind=handleAt(pos.x,pos.y);if(!kind)return;pauseVideo();drag={entityId:active,frame,kind,origin:pos,point:structuredClone(trajectories[active][frame]),edit:{},moved:false};canvas.setPointerCapture(e.pointerId);e.preventDefault();});
canvas.addEventListener('pointermove',e=>{const pos=imagePosition(e);if(pathStroke){pos.x=Math.max(0,Math.min(clip.width,pos.x));pos.y=Math.max(0,Math.min(clip.height,pos.y));if(Math.hypot(pos.x-pathStroke.at(-1).x,pos.y-pathStroke.at(-1).y)>2)pathStroke.push(pos);draw();return;}if(!drag){const hit=handleAt(pos.x,pos.y);canvas.style.cursor=hit==='foot'||hit==='box'?'move':hit?'nwse-resize':'crosshair';return;}if(Math.hypot(pos.x-drag.origin.x,pos.y-drag.origin.y)>3)drag.moved=true;drag.edit=dragImageEdit(drag.point,drag.kind,drag.origin,pos,clip.width,clip.height);draw();});
canvas.addEventListener('pointerup',e=>{if(pathStroke){const stroke=pathStroke;pathStroke=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);suppressClick=true;setTimeout(()=>suppressClick=false,0);try{const anchors=manualPathAnchors(stroke,Number($('pathStart').value)-1,Number($('pathEnd').value)-1,clip.frames,trajectories[active],session.cuts);change(()=>entity().anchors.push(...anchors));toast(`已拟补 ${anchors.length} 帧，手绘路径仍需逐帧核对。`);}catch(error){toast(error.message);}setMode('point');return;}if(!drag)return;const current=drag;drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(current.moved){suppressClick=true;setTimeout(()=>suppressClick=false,0);commitImageEdit(current.edit);}else draw();});
canvas.addEventListener('pointercancel',()=>{drag=null;pathStroke=null;draw();});
canvas.addEventListener('click',event=>{if(suppressClick){suppressClick=false;return;}pauseVideo();const {x,y}=imagePosition(event);if(sceneUI?.handleImageClick(x,y))return;if(workspace?.handleImageClick(x,y))return;
  if(!editable()||mode==='path')return;
  if(mode==='select'){if(!$('showCandidates').checked){toast('先打开“跟踪候选”，或在右侧候选列表预览并确认。');return;}const hit=pickPersonProposal(proposals(),x,y);if(!hit){toast('此处没有带 T 编号的跟踪候选；请在右侧选择当前帧已有的 T 编号。');return;}associateProposal(hit);}
  else {const point=trajectories[active]?.[frame];if(point?.reviewExcluded){toast('这一段已取消关联；请先点击“关联人物”重新选人，再补位置。');return;}prepareGeometryEdit();change(()=>{entity().anchors=entity().anchors.filter(a=>a.frame!==frame);entity().anchors.push({frame,x,y,trackId:point?.trackId??null,box:point?.box||null,footMethod:'human_image_anchor',identityConfirmed:false,detectorBox:point?.detectorBox||point?.box||null});});toast(`${entityLabel(active)} 当前帧脚下点已保存。`);}
});
function setMode(value,{edit=true}={}){mode=value;if(value!=='path')pathStroke=null;if(edit&&(value==='point'||value==='path'))prepareGeometryEdit();else draw();}
for(const id of ['pathStart','pathEnd'])$(id).max=clip.frames.length;
$('pathStart').value=1;$('pathEnd').value=clip.frames.length;
$('pathUseGap').onclick=()=>{const gaps=gapRanges(trajectories[active]),gap=gaps.find(g=>g.start<=frame&&g.end>=frame)||gaps.find(g=>g.start>frame);if(!gap){toast('当前没有可补的缺口。');return;}$('pathStart').value=gap.start+1;$('pathEnd').value=gap.end+1;seek(gap.start);};
$('drawPath').onclick=()=>{if(!hasAssociation(entity())){toast('先对应当前球员，再补他的缺口。');return;}pauseVideo();setMode('path');toast('在原视频按住并画出路径；只拟补缺失帧，时间分配待核对。');};
$('cancelPath').onclick=()=>setMode('point');
$('identityDone').onclick=()=>{const players=session.entities.filter(e=>e.role==='player'&&isAssigned(e));if(players.length!==10){toast(`已对应 ${players.length}/10 名；请补齐十名场上球员。`);return;}if(players.some(e=>trajectories[e.id].some(p=>p.source==='conflict'))){toast('还有重复关联的临时编号，请先解决身份冲突。');return;}change(()=>session.identitySelection={playerIds:players.map(e=>e.id),confirmedAt:new Date().toISOString(),method:'human_player_roster'});workspace.switchStep(clip.supportsCourtCalibration===false?'repair':'calibration',true);};
$('play').addEventListener('click',()=>videoDisplay?.togglePlayback());
$('reloadVideo').addEventListener('click',()=>videoDisplay?.reload());
$('previous').addEventListener('click',()=>seek(frame-1));$('next').addEventListener('click',()=>seek(frame+1));$('scrubber').addEventListener('input',event=>seek(Number(event.target.value)));
$('timeline').addEventListener('click',event=>{const rect=event.currentTarget.getBoundingClientRect();seek(Math.floor((event.clientX-rect.left)/rect.width*clip.frames.length));});
$('stableDisplay').addEventListener('change',event=>change(()=>session.presentationStable=event.target.checked));
for(const event of ['timeupdate','seeked','play','pause'])video.addEventListener(event,()=>{if(video.paused)updateFrame();});
for(const id of ['showCandidates','showObjects','showTrackTrails','showFeetCandidates'])$(id).addEventListener('change',draw);$('maxGap').addEventListener('change',event=>change(()=>session.maxGapSeconds=Number(event.target.value)));
for(const [id,side] of [['adoptLeftFoot','left'],['adoptRightFoot','right']])$(id).onclick=()=>{const point=trajectories[active]?.[frame],candidate=feetForPoint(clip,frame,point);try{const anchor=footCandidateAnchor(point,frame,candidate,side,clip.width,clip.height);prepareGeometryEdit();change(()=>{entity().anchors=entity().anchors.filter(a=>a.frame!==frame);entity().anchors.push(anchor);});toast('已采用当前帧脚部候选；来源保留，接地仍需人工核对，可撤销。');}catch(error){toast(error.message);}};
$('undo').addEventListener('click',()=>{if(history.length){const previous=history.pop();session=JSON.parse(previous.draft);active=previous.active;sessionRevision++;if(!session.entities.some(item=>item.id===active))active='P1';saveDraft();refresh();}});
$('save').addEventListener('click',()=>{saveDraft();toast('草稿已保存在当前浏览器，可继续修改。');});
$('cut').addEventListener('click',()=>{if(sourceCuts.includes(frame)){toast('这是保留区间之间的来源拼接点，不能移除。');return;}change(()=>session.cuts=toggleReviewCut(session.cuts,sourceCuts,frame,clip.frames.length));});
function jumpGap(direction){if(!hasAssociation(entity())){toast('请先关联当前球员或载入待确认建议。');return;}const gaps=workspace?.gaps()||gapRanges(trajectories[active]);const match=direction>0?gaps.find(gap=>gap.start>frame):[...gaps].reverse().find(gap=>gap.end<frame);if(match)seek(direction>0?match.start:match.end);else toast('这个方向没有更多缺失区间。');}
$('previousGap').addEventListener('click',()=>jumpGap(-1));$('nextGap').addEventListener('click',()=>jumpGap(1));
$('addReferee').addEventListener('click',()=>{const count=session.entities.filter(item=>item.role==='referee').length;if(count>=3){toast('当前已提供 3 个裁判编号。');return;}change(()=>{active=`R${count+1}`;session.entities.push({id:active,name:`裁判 ${count+1}`,role:'referee',anchors:[]});});});
$('export').addEventListener('click',()=>{if(qa){toast('测试模式不执行正式确认或导出。');return;}const output=exportPlayerIdentities(exportReview(session,clip,new Date().toISOString()),session);const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='reviewed-player-tracks.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);saveDraft();toast('已下载轨迹备份。工作台仍保留当前草稿，可继续处理。');});
document.addEventListener('keydown',event=>{if(event.defaultPrevented||event.target.closest('input,select,textarea,button,summary,[role="separator"],[contenteditable="true"]'))return;if(event.code==='Space'){event.preventDefault();$('play').click();}if(event.key==='ArrowLeft')seek(frame-1);if(event.key==='ArrowRight')seek(frame+1);});
function setLinkTrack(id,start,end){
  const item=catalog.find(item=>item.id===Number(id));if(!item)return;
  $('linkTrack').value=item.id;$('linkStart').value=(start??item.start)+1;$('linkEnd').value=(end??item.end)+1;
  previewTrackId=item.id;
}
function renderBindings(){
  $('applyLink').textContent=`把这段编号关联到 ${entityLabel(active)}`;
  $('linkScope').textContent='只在填写区间内生效；区间内后来确认的身份优先。重复 ID 的旧关联只在重叠段留空待处理，其他时间和编号保留。';
  $('bindingList').replaceChildren();
  (entity().bindings||[]).forEach((binding,index)=>{
    if(binding.scope==='track_occurrences')return;
    const row=document.createElement('div');row.className='anchor';
    const jump=document.createElement('button');jump.textContent=`${binding.kind==='unassigned'?'已取消关联':binding.kind==='out_of_view'?'离开画面':binding.kind==='untracked'?'历史人工位置':`临时 ${binding.trackId}`} · ${binding.start+1}–${binding.end+1} 帧`;
    jump.addEventListener('click',()=>seek(binding.start));
    const remove=document.createElement('button');remove.textContent='删除';remove.setAttribute('aria-label',`删除纠正区间 ${index+1}`);
    remove.addEventListener('click',()=>change(()=>{
      entity().bindings.splice(index,1);
      if(binding.kind==='untracked'){
        entity().anchors=entity().anchors.filter(anchor=>anchor.frame!==binding.start||anchor.identityReviewOrder!==binding.order);
        entity().frameConfirmations=(entity().frameConfirmations||[]).filter(review=>review.frame!==binding.start||review.identityOrder!==binding.order);
      }
      session.identitySelection=null;
    }));
    row.append(jump,remove);$('bindingList').append(row);
  });
  (entity().modelBindings||[]).forEach((binding,index)=>{
    const row=document.createElement('div');row.className='anchor model-binding';
    const jump=document.createElement('button');jump.textContent=`待确认建议 T${binding.trackId} · ${binding.start+1}–${binding.end+1} 帧`;
    jump.onclick=()=>{previewTrackId=binding.trackId;seek(binding.start);};
    const remove=document.createElement('button');remove.textContent='移除建议';remove.setAttribute('aria-label',`移除模型建议区间 ${index+1}`);
    remove.onclick=()=>change(()=>entity().modelBindings.splice(index,1));
    row.append(jump,remove);$('bindingList').append(row);
  });
}
$('linkTrack').addEventListener('change',event=>{setLinkTrack(event.target.value);draw();});
$('previewStart').addEventListener('click',()=>{previewTrackId=Number($('linkTrack').value);seek(Number($('linkStart').value)-1);});
$('previewEnd').addEventListener('click',()=>{previewTrackId=Number($('linkTrack').value);seek(Number($('linkEnd').value)-1);});
$('useCurrentStart').addEventListener('click',()=>{$('linkStart').value=frame+1;});
$('applyLink').addEventListener('click',()=>{
  const binding={kind:'track',trackId:Number($('linkTrack').value),start:Number($('linkStart').value)-1,end:Number($('linkEnd').value)-1};
  try{const copy=structuredClone(session);confirmBinding(copy,active,binding,clip.frames);change(()=>session=copy);previewTrackId=null;$('linkSuggestions').replaceChildren();draw();toast(`${entityLabel(active)} 已关联临时 ${binding.trackId} 的第 ${binding.start+1}–${binding.end+1} 帧；保留后续确认边界。`);}catch(error){toast(error.message);}
});
$('markOut').addEventListener('click',()=>{
  if(!hasAssociation(entity())){toast('请先关联这个球员或载入待确认建议。');return;}
  change(()=>confirmBinding(session,active,{kind:'out_of_view',start:frame,end:clip.frames.length-1},clip.frames));
  toast(`${entityLabel(active)} 从第 ${frame+1} 帧起标为离开画面。重新入画时可用新的关联区间覆盖。`);
});
$('findLinks').addEventListener('click',()=>{
  const suggestions=continuationSuggestions(trajectories[active],clip.frames,session.cuts);
  $('linkSuggestions').replaceChildren();
  const note=document.createElement('p');note.textContent=suggestions.length?'候选参考时间、位置和可用的球衣颜色线索，需要你查看后确认。':'没有找到靠近轨迹末端的续接候选。可从完整编号列表查找，或确认是否离开画面。';$('linkSuggestions').append(note);
  for(const item of suggestions){const button=document.createElement('button');button.className='suggestion';button.textContent=`查看候选 ${item.fromId} → ${item.id} · ${clip.frames[item.start].time.toFixed(2)} s 起`;
    button.addEventListener('click',()=>{setLinkTrack(item.id,item.start,item.end);seek(item.start);});$('linkSuggestions').append(button);}
});
sceneUI=mountSceneObjects({clip,state:()=>({session,frame,video}),change,toast,redraw:draw});
workspace=createWorkspace({clip,sample,variant,getState:()=>({session,active,frame,mode,trajectories,video}),change,seek,toast,isSelected:hasAssociation,color,setMode,select:id=>{active=id;refresh();},redraw:draw});
tacticsUI=mountTacticsUI({clip,sample,variant,qa,key,title:sampleInfo?.title||sample,
  snapshot:()=>{if(!session.entities.some(hasAssociation))throw new Error('请先在球员标定中关联人物，再建立战术草稿。');return JSON.parse(JSON.stringify(exportPlayerIdentities(exportReview(session,clip,null),session)));},
  frame:()=>frame,pause:pauseVideo,beforeNavigate:saveDraft,openStep:step=>workspace.switchStep(step,true)});
playerIdentityUI=mountPlayerIdentityUI({getState:()=>({session,active,frame,clip,point:annotationPoint(trajectories[active]?.[frame])}),commit:copy=>change(()=>session=copy),pause:pauseVideo,toast});
if(clip.supportsCourtCalibration===false){$('tab-calibration').disabled=true;$('repairCourt').disabled=true;$('identityDone').textContent='十名球员已选好，继续轨迹核对';}
window.addEventListener('resize',drawTimeline);setLinkTrack(catalog[0]?.id);previewTrackId=null;saveDraft();refresh();workspace.switchStep(session.liveSelection?'identity':'footage');
const videoFrame=$('videoFrame');videoFrame.width=clip.width;videoFrame.height=clip.height;
videoDisplay=mountVideoDisplay({video,canvas:videoFrame,stage:$('stage'),status:$('videoStatus'),message:$('videoStatusMessage'),retry:$('videoRetry'),startTime:frameSeekTime(clip.frames,0),getTargetTime:()=>frameSeekTime(clip.frames,frame),onReady:({time})=>updateFrame(time),onFrame:({time})=>updateFrame(time),onError:toast});
if(params.get('area')==='tactics')workspace.showArea('tactics');
