import {buildCourtPreparation,preparationDependencies,courtPreparationStatus,preparationDigest} from './court-preparation.mjs';
import {previewCourtSmoothing,adoptCourtSmoothing} from './court-smoothing.mjs';
import {rangeFromSeconds} from './tactics-time-range.mjs';
import {mountGroundTrajectoryAgentUI} from './ground-trajectory-agent-ui.mjs';
import {entityLabel,hasAssociation} from './trajectory.mjs';

const finitePoint=point=>Number.isFinite(point?.x)&&Number.isFinite(point?.y);
const dependencyLabels={tracking:'跟踪结果',identities:'球员或人工位置',calibration:'球场标定',cuts:'镜头区间',mapping:'视频时间',ground:'接地点',parameters:'处理设置'};

// Only the selected player/interval is reviewed. Unused slots and out-of-view
// frames must not become a ten-player completion gate.
export function courtPreparationGuidance({session,clip,active,range,imagePoints=[],courtPoints=[],maps=[]}){
  const entity=session.entities.find(item=>item.id===active);
  const image=imagePoints.slice(range.startFrame,range.endFrameExclusive),points=courtPoints.slice(range.startFrame,range.endFrameExclusive);
  const mapped=points.filter(finitePoint).length,outOfView=image.filter(point=>point.source==='out_of_view').length;
  const conflict=image.find(point=>point.source==='conflict'),uncalibrated=points.find(point=>point.source==='uncalibrated');
  const missing=image.find(point=>!finitePoint(point)&&!['out_of_view','conflict'].includes(point.source));
  const association=Boolean(entity&&hasAssociation(entity)),mappingCount=maps.slice(range.startFrame,range.endFrameExclusive).filter(Boolean).length;
  let action='compare',frame=range.startFrame,message='对照原视频检查球员位置。准备结果与原始点均保留，缺口不会自动补齐。';
  if(!session.liveSelection){action='footage';message='先选择要处理的直播区间，才能核对人物与球场。直接在视频上画圈、画固定箭头仍可跳过此步。';}
  else if(!association){action='identity';message='这个球员还没有关联人物。先去原视频选择对应人物；也可跳过 2D，直接制作视频标注。';}
  else if(conflict){action='identity';frame=conflict.frame;message='同一帧出现人物归属冲突。先核对原视频中的球员，再更新预览。';}
  else if(outOfView===image.length&&image.length&&!mapped){message='所选区间的球员都在镜头外，无需补点。换一个可见区间，或跳过 2D。';}
  else if(clip.supportsCourtCalibration!==false&&(uncalibrated||(!mappingCount&&!mapped))){
    action='calibration';frame=uncalibrated?.frame??range.startFrame;message='这段视频还不能映射到球场。先核对场地线与标定；已有人工球场点会单独保留。';
  }else if(!mapped&&clip.supportsCourtCalibration===false){action='image';message='这个素材暂不支持球场映射。可以在原视频补位置，或直接进入战术制作画圈、画固定箭头。';}
  else if(missing){action='image';frame=missing.frame;message=`${mapped?'已有部分球场位置，仍有':'当前区间有'}位置缺口。先查看原视频：人在画面内可人工补点，镜头外无需补点。`;}
  return {association,mapped,mappingCount,outOfView,total:range.endFrameExclusive-range.startFrame,action,frame,message,
    identityText:association?'已有球员关联，仍可人工核对':'尚未关联人物',
    mappingText:clip.supportsCourtCalibration===false?'此素材暂不支持球场映射':mappingCount?`${mappingCount} 帧有映射，精度待核对`:'尚无可用球场映射',
    positionText:mapped?`${mapped} / ${range.endFrameExclusive-range.startFrame} 帧有球场位置`:outOfView===image.length&&image.length?'该区间均为镜头外':'尚无可用球场位置'};
}

// Keep navigation separate from data mutation and respect the footage guard.
export function openPreparationSource(action,{frame},api){
  if(Number.isInteger(frame))api.seek(frame);
  const target=action==='footage'?'footage':action==='identity'?'identity':action==='calibration'?'calibration':'repair';
  api.openStep(target);
  if(api.step()!==target){api.closeData?.();return false;}
  api.pause();
  if(action==='footage')api.closeData?.();
  else if(action==='image')api.repairImage();
  else if(action==='court')api.repairCourt();
  else if(action==='compare'){api.viewOnly();api.openData();}
  return true;
}

export function mountCourtPreparationUI({host,clip,sample,variant,state,change,redraw,next,seek,undo,openSource=()=>{},points=()=>({}),maps=()=>[]},
  {document:doc=globalThis.document,search=globalThis.location?.search??'',fetch:requestFetch=globalThis.fetch,mountGroundAgent=mountGroundTrajectoryAgentUI}={}){
  const purpose=doc.createElement('section');purpose.className='preparation-purpose';
  purpose.innerHTML=`<div><span class="preparation-optional">可选步骤</span><h2>把视频里的球员位置放到球场上</h2><p>贴地标注、球场路线需要这一步。暂停视频画圈、固定箭头可直接去战术制作。</p></div><div class="preparation-purpose-actions"><button data-skip>直接去战术制作 →</button><button data-source>对照原视频</button></div>`;
  const section=doc.createElement('section');section.className='court-preparation-panel';section.setAttribute('aria-label','2D 准备步骤');
  section.innerHTML=`<div class="preparation-selection"><strong data-selection></strong><span>先检查一小段，再按需处理其余区间</span></div>
    <div class="range-fields"><label>开始（秒）<input data-start type="number" min="0" step=".001"></label><label>结束（秒）<input data-end type="number" min="0" step=".001"></label></div><button data-current-range class="preparation-text-button">使用当前时间起的 3 秒</button>
    <nav class="preparation-steps" aria-label="准备步骤"><button data-step-source>1 核对来源</button><button data-step-preview>2 预览轨迹</button><button data-step-use>3 采用</button></nav>
    <section data-panel-source><h3>先确定缺的是哪一项</h3><div class="preparation-checks"><div><span>球员身份</span><p data-identity-state></p><button data-identity>核对人物</button></div><div><span>球场映射</span><p data-mapping-state></p><button data-calibration>核对场地线</button></div><div><span>球员位置</span><p data-position-state></p><button data-image>去原视频补点</button></div></div><p data-guidance class="preparation-guidance"></p><button data-resolve></button><button data-build class="primary wide">生成球场预览</button><p data-build-help class="small muted">根据已有身份、标定和人工补点生成。没有依据的位置继续留空。</p></section>
    <section data-panel-preview hidden><h3>对照视频，检查这一段</h3><p data-preview-summary></p><div class="tactics-buttons"><button data-compare-video>原视频与球场同屏</button><button data-seek-start>定位到区间起点</button></div><p class="small muted">位置有误时，回到原视频核对；球员不在镜头内，无需补点。</p><div class="tactics-buttons"><button data-repair-image>在原视频补点</button><button data-repair-court>在球场补当前帧</button></div>
      <details class="preparation-advanced"><summary>轨迹抖动时：预览平滑</summary><p class="small muted">仅调整所选球员和区间。原始点、人工锁定点与缺口保留。</p><label>调整幅度 <select data-preset><option value="off">不调整</option><option value="light" selected>轻度</option><option value="standard">标准</option></select></label><div class="tactics-buttons"><button data-preview>预览平滑效果</button><button data-adopt disabled>采用这段平滑</button><button data-discard disabled>取消预览</button></div><label class="preparation-check"><input data-compare type="checkbox">叠加原始轨迹作对照</label><p data-smoothing-status class="small"></p></details>
      <details class="preparation-advanced" data-agent-details><summary>AI 复核地面位置（可选）</summary><p class="small muted">适用于已经有球场位置、仍需复核的片段。没有可用模型时，可继续人工补点。</p><div data-agent-host></div></details><button data-ready class="primary wide">核对完成，继续采用 →</button></section>
    <section data-panel-use hidden><h3>保存给战术制作使用</h3><p data-use-summary></p><button data-save class="primary wide">保存准备结果</button><button data-next class="wide">进入战术制作 →</button><p class="small muted">保存只更新 2D 来源。已有战术草稿保留；来源变化后仍需重新核对相关图形。</p></section>
    <p data-status class="preparation-status" role="status" aria-live="polite"></p>`;
  host.prepend(purpose,section);const $=key=>section.querySelector(`[data-${key}]`),qa=new URLSearchParams(search).has('qa');
  let version=0,preview=null,message='',savedDigest=null,sourceCurrent=false,step='source',busy=false,lastActive=null;
  const source=()=>({sample,variant,qa}),current=()=>state().session.courtPreparation;
  const frameMapping=clip.frames.map(record=>({frame:record.frame,time:record.time,sourceFrame:record.source_frame??record.frame,sourceTime:record.source_time??record.time}));
  function useCurrentRange(){const start=clip.frames[state().frame??0]?.time??clip.frames[0].time;$('start').value=start;$('end').value=Math.min(clip.mediaEndTime,start+3);preview=null;}
  useCurrentRange();$('start').max=clip.mediaEndTime;$('end').max=clip.mediaEndTime;
  async function request(url,body){const r=await requestFetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined),v=await r.json();if(!r.ok)throw new Error(v.error||'保存服务暂不可用，请稍后重试。');return v;}
  const safe=fn=>async()=>{if(busy)return;try{await fn();}catch(e){message=e.message;}render();redraw();};
  function selectedRange(requireCurrent=true){if(requireCurrent&&!courtPreparationStatus(current(),preparationDependencies(state().session,clip)).current)throw new Error('来源尚未更新。请在「核对来源」生成球场预览。');return rangeFromSeconds(frameMapping,{startSeconds:Number($('start').value),endSeconds:Number($('end').value),durationSeconds:clip.mediaEndTime});}
  function guidance(){const s=state();return courtPreparationGuidance({session:s.session,clip,active:s.active,range:selectedRange(false),imagePoints:s.trajectories?.[s.active]??[],courtPoints:points()[s.active]??current()?.preparedByPlayer[s.active]??[],maps:maps()});}
  function navigate(action,frame){openSource(state().session.liveSelection?action:'footage',{frame:Number.isInteger(frame)?frame:state().frame,entityId:state().active});}
  const groundAgent=mountGroundAgent({host:$('agent-host'),clip,source:source(),state,change,redraw,seek,undo,range:selectedRange});
  purpose.querySelector('[data-skip]').onclick=safe(()=>next());purpose.querySelector('[data-source]').onclick=safe(()=>navigate('compare'));
  for(const name of ['source','preview','use'])$(`step-${name}`).onclick=safe(()=>{step=name;});
  $('current-range').onclick=safe(useCurrentRange);
  $('identity').onclick=safe(()=>navigate('identity'));$('calibration').onclick=safe(()=>navigate('calibration'));
  $('image').onclick=safe(()=>navigate('image',guidance().frame));$('resolve').onclick=safe(()=>{const item=guidance();navigate(item.action,item.frame);});
  $('build').onclick=safe(()=>{if(!state().session.liveSelection){navigate('footage');return;}selectedRange(false);const preparation=buildCourtPreparation({session:state().session,clip});change(()=>state().session.courtPreparation=preparation);preview=null;step='preview';message='预览已生成。请对照原视频检查；缺口和待核对状态均保留。';});
  $('compare-video').onclick=safe(()=>navigate('compare'));$('seek-start').onclick=safe(()=>seek(selectedRange(false).startFrame));
  $('repair-image').onclick=safe(()=>navigate('image',guidance().frame));$('repair-court').onclick=safe(()=>navigate('court'));
  $('ready').onclick=safe(()=>{selectedRange();step='use';});
  $('preview').onclick=safe(()=>{
    const p=current(),range=selectedRange();if(!p.preparedByPlayer[state().active]?.slice(range.startFrame,range.endFrameExclusive).some(finitePoint))throw new Error('所选球员在这段没有可调整的位置。请先核对人物、场地线，或在原视频补点。');
    preview=previewCourtSmoothing(p,{entityIds:[state().active],range,preset:$('preset').value});$('compare').checked=true;message='平滑正在球场预览，尚未采用。';
  });
  $('adopt').onclick=safe(()=>{if(!preview)throw new Error('请先预览平滑效果。');selectedRange();const p=adoptCourtSmoothing(current(),preview.candidate);change(()=>state().session.courtPreparation=p);preview=null;message='平滑已采用到本地准备，可用全局撤销恢复。下一步保存给战术制作使用。';});
  $('discard').onclick=safe(()=>{preview=null;message='已取消平滑预览，准备结果未改变。';});
  $('save').onclick=safe(async()=>{
    selectedRange();const snapshot=structuredClone(state().session),p=snapshot.courtPreparation;if(!Object.values(p.preparedByPlayer).some(values=>values.some(finitePoint)))throw new Error('准备中还没有可用球场位置。请先补齐来源，或直接进入视频战术制作。');
    busy=true;render();try{const v=await request('/api/court-preparation/save',{...source(),preparation:p,session:snapshot,expectedVersion:version});version=v.version;savedDigest=preparationDigest(p);message=preparationDigest(current())===savedDigest?`已保存准备结果 ${version}，可以进入战术制作。`:'已保存刚才的准备快照；当前结果又有变化，请再次保存。';}finally{busy=false;}
  });
  $('next').onclick=safe(()=>next());$('compare').onchange=()=>redraw();
  for(const key of ['start','end','preset'])$(key).onchange=()=>{preview=null;message='';render();redraw();};
  function render(){
    const s=state(),p=current(),status=courtPreparationStatus(p,preparationDependencies(s.session,clip));sourceCurrent=status.current;
    if(preview&&(!status.current||preview.candidate.baseDigest!==preparationDigest(p??null)||lastActive!==s.active))preview=null;lastActive=s.active;
    let item=null,rangeError='';try{item=guidance();}catch(error){rangeError=error.message;}
    $('selection').textContent=`${entityLabel(s.active)} · 当前处理对象`;
    for(const name of ['source','preview','use']){$(`panel-${name}`).hidden=step!==name;$(`step-${name}`).setAttribute('aria-current',step===name?'step':'false');}
    $('identity-state').textContent=item?.identityText??'先设置有效时间区间';$('mapping-state').textContent=item?.mappingText??'—';$('position-state').textContent=item?.positionText??'—';
    $('calibration').disabled=clip.supportsCourtCalibration===false;$('repair-court').disabled=clip.supportsCourtCalibration===false;
    $('guidance').textContent=rangeError||item?.message||'';$('resolve').disabled=!item;
    $('resolve').textContent=({footage:'先选择直播区间',identity:'去核对球员',calibration:'去核对球场映射',image:'定位问题帧并人工处理',compare:'对照原视频'})[item?.action]??'先设置有效区间';
    $('build').disabled=!s.session.liveSelection||Boolean(rangeError)||busy;$('build').textContent=p?'更新球场预览':'生成球场预览';
    $('build-help').textContent=p?'更新会按当前来源重算映射和轨迹调整。原图补点、球场补点与已有战术草稿保留，可撤销。':'根据已有身份、标定和人工补点生成。没有依据的位置继续留空。';
    $('preview-summary').textContent=rangeError||(status.current?`${item?.positionText??'准备已生成'}。${item?.message??''}`:'请先在「核对来源」生成或更新预览。');
    $('preview').disabled=!status.current||!item?.mapped||Boolean(rangeError);$('adopt').disabled=!preview||busy;$('discard').disabled=!preview;$('ready').disabled=!status.current||Boolean(rangeError);
    $('smoothing-status').textContent=preview?`预览调整 ${preview.diff.changed} 个点；${preview.issues.filter(issue=>issue.reason!=='out_of_view').length} 个位置缺口保留。最大调整 ${preview.diff.maxDisplacement.toFixed(3)} 米，尚未采用。`:'平滑只减小抖动，不能修复错人、错误标定或缺失位置。';
    const hasPositions=Boolean(p&&Object.values(p.preparedByPlayer).some(values=>values.some(finitePoint))),saved=Boolean(p&&savedDigest===preparationDigest(p));
    $('save').disabled=!status.current||!hasPositions||busy;$('save').textContent=busy?'正在保存…':saved?'再次保存准备结果':'保存准备结果';
    $('use-summary').textContent=!status.current?'来源尚未准备或已变化，请返回「核对来源」更新。':!hasPositions?'准备中还没有可用球场位置。先人工修补来源，或跳过本步直接制作视频标注。':saved?`准备结果 ${version} 已保存。可用于球场路线；贴回视频时仍需核对位置。`:'当前结果已保留在本地草稿中。保存后，战术制作可以读取这份准备结果。';
    const statusText=!p?'尚未生成球场预览':status.current?`准备修订 ${p.revision} · 来源未变化${saved?' · 已保存':' · 本地草稿'}`:`来源变化：${status.reasons.map(reason=>dependencyLabels[reason]??'来源').join('、')}。请更新预览。`;
    $('status').textContent=[statusText,message].filter(Boolean).join('。');groundAgent.render();
  }
  void request('/api/court-preparation?'+new URLSearchParams({...source(),qa:qa?'1':'0'})).then(v=>{
    version=v.version;
    if(v.preparation&&courtPreparationStatus(v.preparation,preparationDependencies(state().session,clip)).current&&!current()){
      change(()=>state().session.courtPreparation=v.preparation);savedDigest=preparationDigest(v.preparation);message='已恢复服务保存的准备结果。';
    }else if(v.preparation&&current()&&preparationDigest(v.preparation)===preparationDigest(current()))savedDigest=preparationDigest(v.preparation);
    else if(v.preparation&&!current())message='已保存结果来自旧来源，请按当前人物和标定重新生成。';
    render();
  }).catch(e=>{message=`暂时无法读取服务保存的版本：${e.message}。可继续本地预览与人工修补。`;render();});
  render();
  return {render,display:()=>sourceCurrent?{...current()?.preparedByPlayer,...preview?.candidate.pointsByPlayer,...groundAgent.display()}:null,previewEntityIds:()=>groundAgent.previewEntityIds(),compare:()=>$('compare').checked||groundAgent.compare(),raw:()=>sourceCurrent?current()?.rawByPlayer:null};
}
