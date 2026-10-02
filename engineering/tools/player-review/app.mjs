import {mountIdentityUI} from './ui.bundle.mjs';
import {mountFootageUI} from './footage-ui.mjs';
import {manualPathAnchors} from './manual-path.mjs';
import {editImageAnchor,dragImageEdit} from './image-edit.mjs';
import {createWorkspace} from './workspace.mjs';
import {blankSession,ensurePlayerSlots,buildTrajectories,reviewTrailCuts,gapRanges,exportReview,isHumanIdentitySelected,hasAssociation,entityLabel,playerDisplayState,draftStorageKey,trackingModelSummary,trackCatalog,confirmBinding,continuationSuggestions} from './trajectory.mjs';
import {IDENTITY_BINDING_MODE,migrateIdentitySession,confirmIdentity,identityInterval,identitySuggestionSummary} from './identity-timeline.mjs';
import {effectiveTeamGroup,setTeamGroup,teamOverlayStyle,stabilizePoints,presentationPoint,frameAtMediaTime} from './team-overlay.mjs';
import {personProposals,visibleObjects,personTrail,indexTemporaryTracks,temporaryTrail,mergeSourceCuts,toggleReviewCut} from './tracking-display.mjs';
import {mountSceneObjects} from './scene-objects-ui.mjs';
import {feetForPoint,footCandidateAnchor} from './feet-candidates.mjs';
import {initializeAutomaticAnnotations,automaticPlayerCandidates,automaticAnnotationPointVisible} from './automatic-annotations.mjs';
import {mountSimpleAnnotationUI,simplePlayerStyle} from './simple-annotation.mjs';
import {mountPlayerIdentityUI,exportPlayerIdentities} from './player-identity.mjs';
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
let workspace=null,sceneUI=null,simpleUI=null,playerIdentityUI=null;
let footageUI=null,pathStroke=null;
let active='P1',frame=0,mode='select',trajectories={},stableTrajectories={},history=[],toastTimer,previewTrackId=null,previewBox=null;
let playerTrailCuts={},temporaryTrailCuts=new Map();
const catalog=trackCatalog(clip.frames);
const trackIndex=indexTemporaryTracks(clip.frames);
const versions=clip.variants||[{id:'original',label:'原跟踪 · 保留已有草稿'}];
for(const item of versions){const option=document.createElement('option');option.value=item.id;option.textContent=`${item.label}${item.recommended?' · 推荐':''}`;$('trackingVersion').append(option);}
$('trackingVersion').value=variant;
const currentVersion=versions.find(item=>item.id===variant);
$('modelSummary').textContent=`${currentVersion?.label||variant}${currentVersion?.recommended?' · 推荐用于篮球片段，结果仍需核对':''}。每个版本分别保存人工草稿。`;
$('trackingVersion').addEventListener('change',event=>{saveDraft();params.set('variant',event.target.value);location.assign(`/?${params}`);});
const modelSummary=trackingModelSummary(clip.trackingMetadata||{},(clip.variants||[]).find(item=>item.id===variant)?.label||variant);
$('trackerStage').textContent=`${modelSummary.tracker} 连续关联`;
const objectKinds=new Set(clip.frames.flatMap(record=>visibleObjects(record).map(object=>object.kind)));
$('detectionStage').textContent=['人物',...(objectKinds.has('basketball')?['球']:[]),...(objectKinds.has('hoop')?['篮筐']:[])].join(' / ');
$('modelName').textContent=modelSummary.model;$('modelTracker').textContent=modelSummary.tracker;
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
$('sampleSelect').onchange=e=>{saveDraft();params.set('sample',e.target.value);params.delete('variant');location.assign(`/?${params}`);};
$('sampleTitle').textContent=sampleInfo?.title||'本地视频';$('sampleDescription').textContent=sampleInfo?.description||'';
$('sampleSource').href=sampleInfo?.sourceUrl||'#';$('sampleSource').hidden=!sampleInfo?.sourceUrl;
let drag=null,suppressClick=false;
const identityUI=mountIdentityUI({select:id=>{active=id;refresh();},setField:(name,value)=>change(()=>entity()[name]=value|| (name==='name'?entityLabel(active):'')),setTeamGroup:group=>{try{change(()=>setTeamGroup(session,active,group));toast('分队已保存，固定编号、人工姓名及身份关联保留。');}catch(error){toast(error.message);}},prepareEdit:prepareGeometryEdit,setMode,preview:proposal=>{previewTrackId=proposal?.trackId??null;previewBox=proposal?.trackId==null&&proposal?{frame,box:proposal.box}:null;draw();},associate:associateProposal,confirmCurrent:()=>{const point=trajectories[active]?.[frame];const proposal=proposals().find(item=>item.trackId===point?.trackId);if(proposal)associateProposal({...proposal,preservePosition:true});},edit:commitImageEdit,seek,removeIdentity:at=>change(()=>{
  entity().identityKeyframes=entity().identityKeyframes.filter(item=>item.frame!==at);
  entity().anchors=entity().anchors.filter(item=>item.frame!==at);session.identitySelection=null;
})});
canvas.width=clip.width;canvas.height=clip.height;
footageUI=mountFootageUI({clip,sample,variant,qa,session:()=>session,frame:()=>frame,change,seek,toast,next:()=>workspace.switchStep('identity',true)});
$('scrubber').max=clip.frames.length-1;
session.presentationStable??=Boolean(clip.trackingMetadata?.presentation?.default_stable);
$('stableDisplay').checked=session.presentationStable;
function entity(){return session.entities.find(item=>item.id===active);}
function isSimpleView(){return document.body.dataset.reviewView==='simple';}
function annotationPoint(point){return point&&!automaticAnnotationPointVisible(clip,frame,point)?{...point,x:null,y:null,annotationNeedsReview:point.x!=null}:point;}
function simpleState(){
  const points=Object.fromEntries(session.entities.map(item=>[item.id,annotationPoint(trajectories[item.id]?.[frame])]));
  const annotations=session.entities.filter(item=>item.role==='player'&&/^P(?:[1-9]|10)$/.test(item.id)).flatMap(item=>{
    const raw=points[item.id];if(raw?.x==null||raw.y==null)return [];
    const point=presentationPoint(raw,stableTrajectories[item.id]?.[frame],{stable:$('stableDisplay').checked,editing:false});
    return [{id:item.id,raw,point}];
  });
  return {frame,active,entities:session.entities,points,annotations,candidates:automaticPlayerCandidates(clip,frame,trajectories),teamPolicy};
}
function color(id){const group=effectiveTeamGroup(session.entities.find(item=>item.id===id)||{});return group?teamPolicy.teams[group].color:teamPolicy.pendingColor;}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4500);}
function saveDraft(){session.cuts=mergeSourceCuts(session.cuts,sourceCuts,clip.frames.length);localStorage.setItem(key,JSON.stringify(session));}
function change(callback){history.push(JSON.stringify(session));if(history.length>40)history.shift();callback();saveDraft();refresh();}
function seek(index){frame=Math.max(0,Math.min(clip.frames.length-1,index));video.pause();video.currentTime=clip.frames[frame].time;draw();}
function updateFrame(mediaTime){frame=frameAtMediaTime(clip.frames,Number.isFinite(mediaTime)?mediaTime:video.currentTime,frame);draw();}
function proposals(){return personProposals(clip.frames[frame],clip.track_roles);}
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
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const simple=isSimpleView(),plain=simple?simpleState():null;
  const candidates=proposals(),objects=sceneUI?.objects()||visibleObjects(clip.frames[frame]);
  const pTail=hasAssociation(entity())?personTrail(trajectories[active],clip.frames,frame,playerTrailCuts[active]||session.cuts):[];
  if(!simple&&$('showTrackTrails').checked){
    for(const candidate of candidates)if(candidate.trackId!=null)drawTrail(temporaryTrail(trackIndex,clip.frames,candidate.trackId,frame,temporaryTrailCuts.get(candidate.trackId)||session.cuts),candidate.role==='referee'?'#6eb3ec':'#b4c2cd');
    drawTrail(pTail,color(active),true);
  }
  if(!simple&&$('showObjects').checked)for(const object of objects){
    const stroke=object.kind==='basketball'?'#ffaf52':'#ff78b7',name=object.kind==='basketball'?'篮球候选':'篮筐候选';
    const selected=sceneUI?.selected()===object.id;
    if(object.box)drawBox(object.box,selected?'#ffe14e':stroke,`${name}${selected?' · 已选中':''}`,true);
    const [x,y]=object.point||[(object.box[0]+object.box[2])/2,(object.box[1]+object.box[3])/2];
    ctx.beginPath();ctx.arc(x,y,5,0,2*Math.PI);ctx.strokeStyle=stroke;ctx.lineWidth=3;ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-9,y);ctx.lineTo(x+9,y);ctx.moveTo(x,y-9);ctx.lineTo(x,y+9);ctx.stroke();
  }
  if(!simple&&$('showCandidates').checked)for(const proposal of candidates){
    const id=proposal.trackId==null?'候选':`T${proposal.trackId}`;
    const label=`${id}${proposal.roleConflict?' · 角色?':proposal.role==='referee'?' · 裁判':proposal.role==='player'?' · 球员':''}`;
    drawBox(proposal.box,proposal.roleConflict?teamPolicy.candidateColor:proposal.role==='referee'?'#6eb3ec':'#97a5b8',label,true);
  }
  if(simple)for(const proposal of plain.candidates){const selected=simpleUI?.selected(),highlight=selected?.frame===frame&&!selected.ownerId&&selected.proposal.trackId===proposal.trackId&&JSON.stringify(selected.proposal.box)===JSON.stringify(proposal.box);drawBox(proposal.box,highlight?'#d1d5db':'#9ca3af','编号未匹配',true,18);}
  for(const item of session.entities){if(!hasAssociation(item)||(simple&&item.role!=='player'))continue;const point=trajectories[item.id]?.[frame];if(!point||point.x===null||(simple&&!automaticAnnotationPointVisible(clip,frame,point)))continue;const displayed=presentationPoint(point,stableTrajectories[item.id]?.[frame],{stable:$('stableDisplay').checked,editing:Boolean(drag)});const rendered=drag?.entityId===item.id?{...point,...drag.edit}:displayed;const style=simple?simplePlayerStyle(item,teamPolicy):teamOverlayStyle(item,point,teamPolicy),stroke=style.color;drawPlayer(rendered,style);
    if(item.id===active&&rawEditing()){if(rendered.box){const b=rendered.box;for(const [x,y] of [[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]]){ctx.fillStyle='#fff';ctx.strokeStyle=stroke;ctx.fillRect(x-7,y-7,14,14);ctx.strokeRect(x-7,y-7,14,14);}}ctx.beginPath();ctx.moveTo(rendered.x-18,rendered.y);ctx.lineTo(rendered.x+18,rendered.y);ctx.moveTo(rendered.x,rendered.y-18);ctx.lineTo(rendered.x,rendered.y+18);ctx.strokeStyle=stroke;ctx.stroke();}}
  if(!simple&&previewTrackId!==null){const box=clip.frames[frame].tracks.find(box=>Number(box[4])===previewTrackId);if(box)drawBox(box,teamPolicy.candidateColor,`候选 T${previewTrackId}`,true);}
  if(!simple&&previewBox?.frame===frame)drawBox(previewBox.box,teamPolicy.candidateColor,'未编号候选',true);
  if(!simple&&pathStroke?.length){ctx.beginPath();pathStroke.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle='#d99516';ctx.lineWidth=5;ctx.setLineDash([10,5]);ctx.stroke();ctx.setLineDash([]);}
  $('time').textContent=`${clip.frames[frame].time.toFixed(2)} s`;$('frameLabel').textContent=`第 ${frame+1} / ${clip.frames.length} 帧`;$('scrubber').value=frame;$('play').textContent=video.paused?'播放':'暂停';
  const item=entity(),point=trajectories[active]?.[frame];
  const feet=feetForPoint(clip,frame,point),footText=side=>feet?.[side]?`${side==='left'?'左脚':'右脚'} (${feet[side].x.toFixed(1)}, ${feet[side].y.toFixed(1)}) px · ${Math.round(feet[side].score*100)}%`:`${side==='left'?'左脚':'右脚'}无候选`;
  $('feetCandidateStatus').textContent=feet?`${active} / T${point.trackId}：${footText('left')}；${footText('right')}。来源 ${feet.source}。`:point?.trackId==null?'先把当前球员关联到一个临时 T 编号。':'当前帧 / 模型版本没有匹配的脚部候选；可直接人工补脚下点。';
  $('adoptLeftFoot').disabled=!feet?.left;$('adoptRightFoot').disabled=!feet?.right;
  if(!simple&&feet&&$('showFeetCandidates').checked)for(const side of ['left','right'])if(feet[side]){const p=feet[side];ctx.beginPath();ctx.arc(p.x,p.y,9,0,2*Math.PI);ctx.strokeStyle=side==='left'?'#ffda70':'#cf9dff';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.font='bold 17px sans-serif';ctx.fillText(side==='left'?'左脚?':'右脚?',p.x+12,p.y);}
  const visibleCount=candidates.filter(p=>p.trackId!=null).length;
  $('trackingContinuity').textContent=`当前 ${visibleCount} 个临时 T 编号${hasAssociation(item)?` · ${active} ${point?.trackId!=null?`关联 T${point.trackId}`:'当前无临时编号'} · 连续原图位置 ${pTail.length} 帧`:''}。尾迹为最近 1.2 秒的原图位置，受镜头移动影响；缺失、估计、身份确认、人工补点与切镜处断开。`;
  const basketballs=objects.filter(o=>o.kind==='basketball').length,hoops=objects.filter(o=>o.kind==='hoop').length;
  $('objectStatus').textContent=objects.length?`当前帧：篮球 ${basketballs} 个候选 · 篮筐 ${hoops} 个候选。框中心是图像标记，不能作为球场地面点。`:'当前帧没有篮球 / 篮筐候选；只显示当前版本提供的独立对象检测。';
  footageUI?.render();sceneUI?.render();
  const descriptions={manual:'这一帧的位置由你确认。',tracked:'这一帧来自已绑定临时编号的模型位置，仍可点选修正。',interpolated:'这一帧由前后位置估计；不是模型直接检出的结果。',missing:'这一帧尚未关联到位置；可以找回新编号、补点，或标记离开画面。',out_of_view:'这一帧已由你标记为离开画面，不计算位置。',conflict:'这一帧存在身份冲突，需要你重新点选确认。'};
  if(point?.source==='manual')descriptions.manual=point.footMethod==='bbox_bottom_center'?'这一帧已人工选人；位置仍取框底边中心，尚未确认地面脚点。':point.footMethod==='pose_candidate_human_adopted'?'这一帧由你采用脚部模型候选，来源已保留，接地尚未验证。':'这一帧使用人工点选的原图参考位置，仍需核对地面接触与标定。';
  if(point?.identitySource==='reassigned')descriptions.missing=`原关联在这一段已由人工确认归到 ${entityLabel(point.claimedBy)}；请重新关联当前球员。`;
  else if(point?.visibility==='occluded_waiting')descriptions.missing='遮挡 / 断轨待续接：身份关联保留，当前没有可靠位置，不生成框。';
  if(point?.identitySource==='model_suggestion')descriptions.tracked='当前是模型建议的位置与身份，尚未人工确认；检查后可锁定当前球员。';
  descriptions.manual_path='手绘路径的拟补位置，时间沿路径均匀分配；逐帧核对后点击脚点或保存坐标确认。';
  $('pointStatus').textContent=hasAssociation(item)?`${entityLabel(active)} · ${descriptions[point?.source]||''}`:`${entityLabel(active)} · 位置未知。点击候选人物后人工确认。`;
  $('cut').disabled=sourceCuts.includes(frame);
  $('cut').textContent=sourceCuts.includes(frame)?'来源拼接点（固定）':session.cuts.includes(frame)?'移除此处切镜标记':'此处标记切镜';
  drawTimeline();workspace?.draw();if(!simple)workspace?.drawImageOverlay(ctx);
  simpleUI?.render();
  playerIdentityUI?.render();
  identityUI.render({entity:entity(),teamPolicy,entities:session.entities.map(e=>({id:e.id,name:e.name,role:e.role,teamGroup:e.teamGroup,teamGroupSource:e.teamGroupSource,modelTeamGroup:e.modelTeamGroup,selected:isHumanIdentitySelected(e),display:playerDisplayState(e,trajectories[e.id]?.[frame])})),point:trajectories[active]?.[frame],display:playerDisplayState(entity(),point),frame,mode,proposals:candidates,previewTrackId,
    observedIds:[...new Set((trajectories[active]||[]).filter(p=>p.trackId!=null&&['manual','tracked'].includes(p.source)).map(p=>p.trackId))],
    identityRanges:entity().identityKeyframes.map(item=>({...item,...identityInterval(session,entity(),item.frame,clip.frames.length),time:clip.frames[item.frame].time}))});
}
function drawTimeline(){const target=$('timeline'),context=target.getContext('2d');target.width=Math.round(target.clientWidth*devicePixelRatio);target.height=36*devicePixelRatio;const points=trajectories[active]||[];const shades={manual:'#2563eb',tracked:'#0b9c79',interpolated:'#d99516',missing:'#db737c',conflict:'#ad3156',out_of_view:'#8c98a8'};context.clearRect(0,0,target.width,target.height);if(hasAssociation(entity())){points.forEach((point,index)=>{context.fillStyle=point.identitySource==='model_suggestion'&&point.x!=null?'#c88821':shades[point.source];context.fillRect(index/points.length*target.width,8*devicePixelRatio,target.width/points.length+1,20*devicePixelRatio);});}for(const cut of session.cuts){context.fillStyle='#122034';context.fillRect(cut/clip.frames.length*target.width,0,2*devicePixelRatio,target.height);}context.fillStyle='#122034';context.fillRect(frame/clip.frames.length*target.width,0,3*devicePixelRatio,target.height);}
function refresh(){
  session.cuts=mergeSourceCuts(session.cuts,sourceCuts,clip.frames.length);
  trajectories=buildTrajectories(session,clip.frames,sourceCuts);
  playerTrailCuts=Object.fromEntries(session.entities.map(item=>[item.id,reviewTrailCuts([item],session.cuts,clip.frames.length)]));
  temporaryTrailCuts=new Map(catalog.map(item=>[item.id,reviewTrailCuts(session.entities,session.cuts,clip.frames.length,item.id)]));
  stableTrajectories=Object.fromEntries(Object.entries(trajectories).map(([id,points])=>[id,stabilizePoints(points,session.cuts,clip.width,clip.height,teamPolicy)]));
  $('stableDisplay').checked=Boolean(session.presentationStable);
  const bound=session.entities.filter(hasAssociation),human=session.entities.filter(isHumanIdentitySelected);
  const proposed=session.entities.filter(e=>e.role==='player'&&e.modelBindings?.length&&!isHumanIdentitySelected(e)).length;
  $('summary').textContent=`人工确认 ${human.filter(item=>item.role==='player').length} / 10${proposed?` · 建议待确认 ${proposed}`:''}${qa?' · 测试模式':''}`;
  $('maxGap').value=String(session.maxGapSeconds);$('undo').disabled=!history.length;$('export').disabled=!bound.length;
  const points=trajectories[active],counts={};points.forEach(point=>counts[point.source]=(counts[point.source]||0)+1);
  $('coverage').textContent=hasAssociation(entity())?`人工操作 ${counts.manual||0} 帧 · 手绘待核对 ${counts.manual_path||0} · 模型 ${counts.tracked||0} · 估计 ${counts.interpolated||0} · 待处理 ${(counts.missing||0)+(counts.conflict||0)} · 出画 ${counts.out_of_view||0}`:'先在右侧选择球员 1–10，再点画面中的候选人物';
  $('anchorList').replaceChildren();for(const anchor of [...entity().anchors].sort((a,b)=>a.frame-b.frame)){const row=document.createElement('div');row.className='anchor';const jump=document.createElement('button');jump.textContent=`位置 · 第 ${anchor.frame+1} 帧 · ${clip.frames[anchor.frame].time.toFixed(2)} s`;jump.addEventListener('click',()=>seek(anchor.frame));const remove=document.createElement('button');remove.textContent='删除位置';remove.addEventListener('click',()=>change(()=>entity().anchors=entity().anchors.filter(item=>item.frame!==anchor.frame)));row.append(jump,remove);$('anchorList').append(row);}
  const playerCount=human.filter(e=>e.role==='player').length;
  $('identityProgress').textContent=`人工确认 ${playerCount} / 10 名球员${session.identitySelection?' · 十人确认完成':''}${proposed?` · 模型建议待确认 ${proposed} 名`:''}。遮挡与出画时保留球员槽位，位置未知留空。`;
  $('identityDone').disabled=playerCount!==10;
  $('suggestionLoadStatus').textContent=session.modelSuggestionLoad?`已载入 ${session.modelSuggestionLoad.playerCount} 个槽位的候选关联，身份仍需人工确认；可用顶部“撤销”恢复。`:'';
  renderBindings();workspace?.refresh();$('cuts').textContent=session.cuts.length?`切镜：${session.cuts.map(index=>`第 ${index+1} 帧${sourceCuts.includes(index)?'（固定拼接点）':''}`).join('、')}`:'当前没有切镜标记。';draw();
}
function associateProposal(hit){
  if(!hit)return false;
  video.pause();let interval;
  try{change(()=>{interval=confirmIdentity(session,active,frame,hit,clip.frames);});}catch(error){toast(error.message);return false;}
  const released=session.entities.filter(item=>item.id!==active&&trajectories[item.id].some(point=>point.claimedBy===active&&point.frame>=interval.start&&point.frame<=interval.end)).map(item=>item.id);
  previewTrackId=null;previewBox=null;draw();toast(isSimpleView()?(hit.trackId==null?`编号 ${Number(active.slice(1))} 已标在当前帧；后续尚未检出，可撤销。`:`编号 ${Number(active.slice(1))} 已纠正，可撤销。`):hit.trackId==null?`${active} 已确认当前帧未编号候选；从此处停止旧 ID 延续。`:`${active} 从第 ${interval.start+1} 帧起关联 T${hit.trackId}，到第 ${interval.end+1} 帧；此前绑定保留。${released.length?` ${released.join('、')} 的重叠错误关联已留空待处理。`:''}`);return true;
}
function commitImageEdit(edit){try{const anchor=editImageAnchor(trajectories[active]?.[frame],frame,edit,clip.width,clip.height);change(()=>{entity().anchors=entity().anchors.filter(a=>a.frame!==frame);entity().anchors.push(anchor);});toast(`${active} 当前帧位置已保存，可撤销。`);}catch(error){toast(error.message);}}
function imagePosition(event){const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)/r.width*clip.width,y:(event.clientY-r.top)/r.height*clip.height};}
function editable(){return ['identity','repair'].some(step=>$(`tab-${step}`).getAttribute('aria-selected')==='true');}
function rawEditing(){return !isSimpleView()&&editable()&&!$('stableDisplay').checked;}
function prepareGeometryEdit(){video.pause();session.presentationStable=false;$('stableDisplay').checked=false;saveDraft();draw();}
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
canvas.addEventListener('pointerdown',e=>{if(isSimpleView()||e.button!==0||sceneUI?.isPicking())return;const pos=imagePosition(e);if(mode==='path'&&editable()){video.pause();pathStroke=[pos];canvas.setPointerCapture(e.pointerId);e.preventDefault();return;}const kind=handleAt(pos.x,pos.y);if(!kind)return;video.pause();drag={entityId:active,frame,kind,origin:pos,point:structuredClone(trajectories[active][frame]),edit:{},moved:false};canvas.setPointerCapture(e.pointerId);e.preventDefault();});
canvas.addEventListener('pointermove',e=>{const pos=imagePosition(e);if(pathStroke){pos.x=Math.max(0,Math.min(clip.width,pos.x));pos.y=Math.max(0,Math.min(clip.height,pos.y));if(Math.hypot(pos.x-pathStroke.at(-1).x,pos.y-pathStroke.at(-1).y)>2)pathStroke.push(pos);draw();return;}if(!drag){const hit=handleAt(pos.x,pos.y);canvas.style.cursor=hit==='foot'||hit==='box'?'move':hit?'nwse-resize':'crosshair';return;}if(Math.hypot(pos.x-drag.origin.x,pos.y-drag.origin.y)>3)drag.moved=true;drag.edit=dragImageEdit(drag.point,drag.kind,drag.origin,pos,clip.width,clip.height);draw();});
canvas.addEventListener('pointerup',e=>{if(pathStroke){const stroke=pathStroke;pathStroke=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);suppressClick=true;setTimeout(()=>suppressClick=false,0);try{const anchors=manualPathAnchors(stroke,Number($('pathStart').value)-1,Number($('pathEnd').value)-1,clip.frames,trajectories[active],session.cuts);change(()=>entity().anchors.push(...anchors));toast(`已拟补 ${anchors.length} 帧，手绘路径仍需逐帧核对。`);}catch(error){toast(error.message);}setMode('point');return;}if(!drag)return;const current=drag;drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(current.moved){suppressClick=true;setTimeout(()=>suppressClick=false,0);commitImageEdit(current.edit);}else draw();});
canvas.addEventListener('pointercancel',()=>{drag=null;pathStroke=null;draw();});
canvas.addEventListener('click',event=>{if(suppressClick){suppressClick=false;return;}video.pause();const {x,y}=imagePosition(event);if(isSimpleView()){simpleUI?.handleImageClick(x,y);return;}if(sceneUI?.handleImageClick(x,y))return;if(workspace?.handleImageClick(x,y))return;
  if(!editable()||mode==='path')return;
  if(mode==='select'){const hits=proposals().filter(({box:[x1,y1,x2,y2]})=>x>=x1&&x<=x2&&y>=y1&&y<=y2).sort((a,b)=>(a.box[2]-a.box[0])*(a.box[3]-a.box[1])-(b.box[2]-b.box[0])*(b.box[3]-b.box[1]));if(!hits.length){toast('这里没有候选框；点击“补脚下点”也可以手动开始。');return;}associateProposal(hits[0]);}
  else {prepareGeometryEdit();const point=trajectories[active]?.[frame];change(()=>{entity().anchors=entity().anchors.filter(a=>a.frame!==frame);entity().anchors.push({frame,x,y,trackId:point?.trackId??null,box:point?.box||null,footMethod:'human_image_anchor',identityConfirmed:false,detectorBox:point?.detectorBox||point?.box||null});});toast(`${active} 当前帧脚下点已保存。`);}
});
function setMode(value,{edit=true}={}){if(edit&&(value==='point'||value==='path'))simpleUI?.setAdvanced(true);mode=value;if(value!=='path')pathStroke=null;if(edit&&(value==='point'||value==='path'))prepareGeometryEdit();else draw();}
for(const id of ['pathStart','pathEnd'])$(id).max=clip.frames.length;
$('pathStart').value=1;$('pathEnd').value=clip.frames.length;
$('pathUseGap').onclick=()=>{const gaps=gapRanges(trajectories[active]),gap=gaps.find(g=>g.start<=frame&&g.end>=frame)||gaps.find(g=>g.start>frame);if(!gap){toast('当前没有可补的缺口。');return;}$('pathStart').value=gap.start+1;$('pathEnd').value=gap.end+1;seek(gap.start);};
$('drawPath').onclick=()=>{if(!hasAssociation(entity())){toast('先对应当前球员，再补他的缺口。');return;}video.pause();setMode('path');toast('在原视频按住并画出路径；只拟补缺失帧，时间分配待核对。');};
$('cancelPath').onclick=()=>setMode('point');
$('identityDone').onclick=()=>{const players=session.entities.filter(e=>e.role==='player'&&isHumanIdentitySelected(e));if(players.length!==10){toast(`已人工确认 ${players.length}/10 名；请逐个确认十名场上球员。`);return;}if(players.some(e=>trajectories[e.id].some(p=>p.source==='conflict'))){toast('还有重复关联的临时编号，请先解决身份冲突。');return;}change(()=>session.identitySelection={playerIds:players.map(e=>e.id),confirmedAt:new Date().toISOString(),method:'human_player_roster'});workspace.switchStep('repair',true);};
$('play').addEventListener('click',()=>{if(video.paused)video.play().catch(()=>toast('点击画面或播放按钮后重试。'));else video.pause();});
$('previous').addEventListener('click',()=>seek(frame-1));$('next').addEventListener('click',()=>seek(frame+1));$('scrubber').addEventListener('input',event=>seek(Number(event.target.value)));
$('timeline').addEventListener('click',event=>{const rect=event.currentTarget.getBoundingClientRect();seek(Math.floor((event.clientX-rect.left)/rect.width*clip.frames.length));});
for(const event of ['timeupdate','seeked','play','pause'])video.addEventListener(event,()=>{if(!video.requestVideoFrameCallback||video.paused)updateFrame();});
if(video.requestVideoFrameCallback){const presented=(_,metadata)=>{updateFrame(metadata.mediaTime);video.requestVideoFrameCallback(presented);};video.requestVideoFrameCallback(presented);}
else{const tick=()=>{if(!video.paused)updateFrame();requestAnimationFrame(tick);};requestAnimationFrame(tick);}
$('stableDisplay').addEventListener('change',event=>change(()=>session.presentationStable=event.target.checked));
for(const id of ['showCandidates','showTrackTrails','showObjects','showFeetCandidates'])$(id).addEventListener('change',draw);
$('maxGap').addEventListener('change',event=>change(()=>session.maxGapSeconds=Number(event.target.value)));
for(const [id,side] of [['adoptLeftFoot','left'],['adoptRightFoot','right']])$(id).onclick=()=>{const point=trajectories[active]?.[frame],candidate=feetForPoint(clip,frame,point);try{const anchor=footCandidateAnchor(point,frame,candidate,side,clip.width,clip.height);prepareGeometryEdit();change(()=>{entity().anchors=entity().anchors.filter(a=>a.frame!==frame);entity().anchors.push(anchor);});toast('已采用当前帧脚部候选；来源保留，接地仍需人工核对，可撤销。');}catch(error){toast(error.message);}};
$('undo').addEventListener('click',()=>{if(history.length){session=JSON.parse(history.pop());if(!session.entities.some(item=>item.id===active))active='P1';saveDraft();refresh();}});
$('save').addEventListener('click',()=>{saveDraft();toast('草稿已保存在当前浏览器，可继续修改。');});
$('cut').addEventListener('click',()=>{if(sourceCuts.includes(frame)){toast('这是保留区间之间的来源拼接点，不能移除。');return;}change(()=>session.cuts=toggleReviewCut(session.cuts,sourceCuts,frame,clip.frames.length));});
function jumpGap(direction){if(!hasAssociation(entity())){toast('请先关联当前球员或载入待确认建议。');return;}const gaps=workspace?.gaps()||gapRanges(trajectories[active]);const match=direction>0?gaps.find(gap=>gap.start>frame):[...gaps].reverse().find(gap=>gap.end<frame);if(match)seek(direction>0?match.start:match.end);else toast('这个方向没有更多缺失区间。');}
$('previousGap').addEventListener('click',()=>jumpGap(-1));$('nextGap').addEventListener('click',()=>jumpGap(1));
$('addReferee').addEventListener('click',()=>{const count=session.entities.filter(item=>item.role==='referee').length;if(count>=3){toast('当前已提供 3 个裁判编号。');return;}change(()=>{active=`R${count+1}`;session.entities.push({id:active,name:`裁判 ${count+1}`,role:'referee',anchors:[]});});});
$('export').addEventListener('click',()=>{if(qa){toast('测试模式不执行正式确认或导出。');return;}const output=exportPlayerIdentities(exportReview(session,clip,new Date().toISOString()),session);const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='reviewed-player-tracks.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);saveDraft();toast('已导出所选目标。估计与缺失状态均已保留。');});
document.addEventListener('keydown',event=>{if(['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName))return;if(event.code==='Space'){event.preventDefault();$('play').click();}if(event.key==='ArrowLeft')seek(frame-1);if(event.key==='ArrowRight')seek(frame+1);});
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
    const row=document.createElement('div');row.className='anchor';
    const jump=document.createElement('button');jump.textContent=`${binding.kind==='out_of_view'?'离开画面':`临时 ${binding.trackId}`} · ${binding.start+1}–${binding.end+1} 帧`;
    jump.addEventListener('click',()=>seek(binding.start));
    const remove=document.createElement('button');remove.textContent='删除';remove.setAttribute('aria-label',`删除纠正区间 ${index+1}`);
    remove.addEventListener('click',()=>change(()=>{entity().bindings.splice(index,1);session.identitySelection=null;}));
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
  try{const copy=structuredClone(session);confirmBinding(copy,active,binding,clip.frames);change(()=>session=copy);previewTrackId=null;$('linkSuggestions').replaceChildren();draw();toast(`${active} 已关联临时 ${binding.trackId} 的第 ${binding.start+1}–${binding.end+1} 帧；保留后续确认边界。`);}catch(error){toast(error.message);}
});
$('markOut').addEventListener('click',()=>{
  if(!hasAssociation(entity())){toast('请先关联这个球员或载入待确认建议。');return;}
  change(()=>confirmBinding(session,active,{kind:'out_of_view',start:frame,end:clip.frames.length-1},clip.frames));
  toast(`${active} 从第 ${frame+1} 帧起标为离开画面。重新入画时可用新的关联区间覆盖。`);
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
simpleUI=mountSimpleAnnotationUI({getState:simpleState,select:id=>{active=id;refresh();},
  associate:(id,proposal)=>{active=id;return associateProposal(proposal);},redraw:draw,toast,
  setTeamGroup:group=>{try{const copy=structuredClone(session);setTeamGroup(copy,active,group);change(()=>session=copy);toast('分队已保存，可撤销。');return true;}catch(error){toast(error.message);return false;}},
  onViewChange:advanced=>{canvas.hidden=advanced&&document.body.dataset.step==='footage';$('workbenchTitle').textContent=advanced?'球场数据工作台':'篮球球员标注';if(!advanced){mode='select';drag=null;pathStroke=null;previewTrackId=null;previewBox=null;if(!/^P(?:[1-9]|10)$/.test(active))active='P1';}draw();}});
playerIdentityUI=mountPlayerIdentityUI({getState:()=>({session,active,frame,clip,point:annotationPoint(trajectories[active]?.[frame])}),commit:copy=>change(()=>session=copy),pause:()=>video.pause(),toast});
if(clip.supportsCourtCalibration===false){$('tab-calibration').disabled=true;$('repairCourt').disabled=true;}
window.addEventListener('resize',drawTimeline);setLinkTrack(catalog[0]?.id);previewTrackId=null;saveDraft();refresh();workspace.switchStep(session.liveSelection?'identity':'footage');canvas.hidden=false;draw();
