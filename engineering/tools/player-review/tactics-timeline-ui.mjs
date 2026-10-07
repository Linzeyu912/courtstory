import {rangeFromSeconds,rangeToSeconds} from './tactics-time-range.mjs';
import {setAnnotationRange} from './tactics-court-editor.mjs';
import {setManualAnnotationRange} from './tactics-manual-editor.mjs';
import {upsertTacticKeyframe,removeTacticKeyframe,MIN_EXPLANATION_HOLD_SECONDS} from './tactics-keyframes.mjs';

export function mountTacticsTimeline({host,propertiesHost,getDocument,getSelected,getFrame,commit,commitRange,seek,play,status,select=()=>{},name=a=>a.name??({screen:'挡拆',spotlight:'重点圈',position:'位置标记'}[a.type]??(a.meaning==='later_observed_action'?'后续观察跑位':(a.style.pattern??'solid')==='solid'?'跑位':'传球'))}){
  const root=document.createElement('section');root.className='tactics-source-timeline';
  root.innerHTML=`<div class="tactics-range-bar"><strong>新标注区间 · 原片时间</strong><label>开始（秒）<input data-start type="number" step=".001" placeholder="先选开始"></label><input data-start-handle type="range" step=".001" aria-label="新建区间起点"><label>结束（秒）<input data-end type="number" step=".001" placeholder="再选结束"></label><input data-end-handle type="range" step=".001" aria-label="新建区间终点"><button data-use-start>当前画面设为起点</button><button data-use-end>当前画面设为终点</button><button data-seek-start>定位选区起点</button><button data-play>原片播放这段</button></div><p data-range-label role="status"></p>
    <div data-object hidden class="tactics-object-time"><strong data-object-title>动作时间</strong><label>开始（秒）<input data-object-start type="number" step=".001"></label><button data-object-use-start>起点设为当前画面</button><label>结束（秒）<input data-object-end type="number" step=".001"></label><button data-object-use-end>终点设为当前画面</button><button data-apply>应用时间</button><label class="tactics-check"><input data-detach-cue type="checkbox">解除冲突的暂停关联</label><p data-object-error role="status"></p><details data-legacy-range><summary>高级区间（旧稿兼容）</summary><select data-object-scope><option value="linked">动作与显示一起调整</option><option value="visibility">仅显示</option><option value="action">仅动作</option></select><label><input data-move-cue type="checkbox">将越界的旧讲解点移到新区间起点</label></details></div>
    <div class="tactics-keyframe-heading"><strong>讲解暂停点</strong><button data-add>在这里暂停讲解</button><button data-previous>前一暂停点</button><button data-next>后一暂停点</button><button data-leave-cue>结束本次讲解编辑</button></div><p data-cue-context class="small muted"></p>
    <div class="tactics-time-axis" data-axis><div data-cue-markers></div><div class="tactics-playhead" data-head></div></div><div data-rows class="tactics-time-rows"></div>
    <section data-cue-editor hidden><div class="tactics-cue-properties"><strong data-cue-title></strong><label>暂停位置（秒）<input data-cue-time type="number" step=".001"></label><button data-cue-use>设为当前画面</button><label>额外停留（秒）<input data-cue-hold type="number" min=".9" max="30" step=".1"></label><label><input data-cue-freeze type="checkbox">暂停讲解</label><button data-cue-delete>删除暂停点</button></div><p data-cue-error role="status"></p><details open><summary>本次展示（也可在这个画面直接新画）</summary><div data-cue-objects class="tactics-cue-object-choices"></div></details></section>`;
  host.append(root);const $=k=>root.querySelector(`[data-${k}]`);
  const objectPanel=$('object');if(propertiesHost)propertiesHost.prepend(objectPanel);
  const O=k=>objectPanel.querySelector(`[data-${k}]`);
  let newRange=null,identity=null,activeCueId=null,drag=null,pendingRange=Promise.resolve();
  const duration=()=>getDocument().review.mediaEndTime;
  const seconds=range=>{const d=getDocument();return rangeToSeconds(d.review.sourceFrameMapping,range,d.review.mediaEndTime);};
  const activeCue=()=>getDocument()?.tacticKeyframes?.items.find(k=>k.id===activeCueId)??null;
  const report=(text,area='range-label')=>{$(area).textContent=text;status(text);};
  const safe=(fn,area='range-label')=>async()=>{try{await fn();render();}catch(e){report(e.message,area);}};
  const objectSafe=fn=>async()=>{try{await fn();render();}catch(e){O('object-error').textContent=e.message;status(e.message);}};
  function fromInputs(prefix=''){
    const input=k=>prefix?O('object-'+k):$(k),d=getDocument();
    if(input('start').value===''||input('end').value==='')throw new Error('请先填写新标注的开始和结束时间。');
    return rangeFromSeconds(d.review.sourceFrameMapping,{startSeconds:Number(input('start').value),endSeconds:Number(input('end').value),durationSeconds:d.review.mediaEndTime});
  }
  function setNew(range){newRange=range;const t=seconds(range);for(const k of ['start','end']){if(document.activeElement!==$(k))$(k).value=t[k+'Seconds'].toFixed(3);$(k+'-handle').value=t[k+'Seconds'];}}
  for(const k of ['start','end']){
    $(k).onchange=safe(async()=>{const range=fromInputs();setNew(range);pendingRange=pendingRange.catch(()=>{}).then(()=>commitRange(range));await pendingRange;report(`新标注区间已按原片 PTS 吸附：${seconds(range).startSeconds.toFixed(3)}—${seconds(range).endSeconds.toFixed(3)} 秒；已有对象不变。`);});
    $(k+'-handle').onchange=()=>{$(k).value=$(k+'-handle').value;void $(k).onchange();};
    $('use-'+k).onclick=safe(()=>{$(k).value=getDocument().review.sourceFrameMapping[getFrame()].time;return $(k).onchange();});
    O('object-use-'+k).onclick=()=>{O('object-'+k).value=getDocument().review.sourceFrameMapping[getFrame()].time;};
  }
  O('object-scope').onchange=()=>render();
  async function changeObject(id,range){
    const d=getDocument(),a=d.annotations.items.find(a=>a.id===id),manual=a.timingMode==='manual'||a.authoredPath;
    const next=manual?setManualAnnotationRange(d,id,range,{detachCue:O('detach-cue').checked,scope:O('object-scope').value}):setAnnotationRange(d,id,range,{moveCue:O('move-cue').checked,scope:O('object-scope').value});
    await commit(next);status('时间已按源 PTS 吸附；中间校正点按原区间时间比例重定位，可一次撤销。');
  }
  O('apply').onclick=objectSafe(()=>{const a=getSelected();if(a)return changeObject(a.id,fromInputs('object-'));});
  $('seek-start').onclick=safe(()=>seek(fromInputs().startFrame));$('play').onclick=safe(()=>play(fromInputs()));
  $('add').onclick=safe(async()=>{
    const frame=getFrame(),d=getDocument(),existing=d.tacticKeyframes?.items.find(k=>k.kind==='explanation'&&k.frame===frame);
    if(existing){activeCueId=existing.id;return;}
    const id=`cue-${crypto.randomUUID()}`;await commit(upsertTacticKeyframe(d,{id,kind:'explanation',frame,annotationIds:[]}));activeCueId=id;
  });
  $('leave-cue').onclick=()=>{activeCueId=null;render();status('已结束讲解点编辑；接下来新画的对象按自身时间独立显示。');};
  for(const [k,direction] of [['previous',-1],['next',1]])$(k).onclick=safe(()=>{const keys=getDocument().tacticKeyframes?.items??[],frame=getFrame(),cue=direction<0?[...keys].reverse().find(k=>k.frame<frame):keys.find(k=>k.frame>frame);if(cue){activeCueId=cue.id;seek(cue.frame);}});
  async function modifyCue(patch){const k=activeCue();if(!k)return;const next=upsertTacticKeyframe(getDocument(),{...k,...patch});await commit(next);activeCueId=next.tacticKeyframes.items.find(c=>c.id===k.id||c.frame===(patch.frame??k.frame)).id;}
  const frameAtTime=value=>{
    const d=getDocument(),time=Number(value),m=d.review.sourceFrameMapping;
    if(value===''||!Number.isFinite(time)||time<m[0].time||time>m.at(-1).time)throw new Error(`暂停点需要位于 ${m[0].time.toFixed(3)}—${m.at(-1).time.toFixed(3)} 秒之间（最后一个画面）。`);
    return m.findIndex(p=>p.time>=time-1e-9);
  };
  $('cue-time').onchange=safe(()=>modifyCue({frame:frameAtTime($('cue-time').value)}),'cue-error');$('cue-use').onclick=safe(()=>modifyCue({frame:getFrame()}),'cue-error');
  $('cue-hold').onchange=safe(()=>modifyCue({holdSeconds:Number($('cue-hold').value)}),'cue-error');$('cue-freeze').onchange=safe(()=>modifyCue({freeze:$('cue-freeze').checked}),'cue-error');
  $('cue-delete').onclick=safe(async()=>{const k=activeCue();if(k){await commit(removeTacticKeyframe(getDocument(),k.id));activeCueId=null;status('已删除暂停点，标注保留且恢复自身区间；可以撤销。');}});
  function startDrag(event,type,id,edge){
    const d=getDocument(),element=event.target.closest('[data-time-track]')??$('axis'),box=element.getBoundingClientRect();if(box.width<=0)return;event.preventDefault();
    const a=d.annotations?.items.find(a=>a.id===id),cue=d.tacticKeyframes?.items.find(k=>k.id===id);
    drag={pointerId:event.pointerId,type,id,edge,box,x:event.clientX,document:d,range:a?seconds(a.actionRange??a):null,time:cue?d.review.sourceFrameMapping[cue.frame].time:null};root.setPointerCapture(event.pointerId);
  }
  root.addEventListener('pointerdown',event=>{
    const cue=event.target.closest('[data-cue-marker]'),bar=event.target.closest('[data-timebar]');
    if(cue){activeCueId=cue.dataset.cueMarker;startDrag(event,'cue',activeCueId);}
    else if(bar)startDrag(event,'object',bar.dataset.timebar,event.target.closest('[data-time-edge]')?.dataset.timeEdge??'move');
    else if(event.target.closest('[data-axis]')){const box=$('axis').getBoundingClientRect(),time=Math.max(0,Math.min(duration()-1e-9,(event.clientX-box.left)/box.width*duration()));seek(frameAtTime(Math.min(time,getDocument().review.sourceFrameMapping.at(-1).time)));render();}
  });
  root.addEventListener('pointermove',event=>{
    if(!drag||drag.pointerId!==event.pointerId)return;const delta=(event.clientX-drag.x)/drag.box.width*duration();
    if(drag.type==='cue'){drag.nextTime=Math.max(0,Math.min(getDocument().review.sourceFrameMapping.at(-1).time,drag.time+delta));const marker=root.querySelector(`[data-cue-marker="${drag.id}"]`);if(marker)marker.style.left=drag.nextTime/duration()*100+'%';}
    else{const old=drag.range,span=old.endSeconds-old.startSeconds;
      const start=drag.edge==='end'?old.startSeconds:drag.edge==='move'?Math.max(0,Math.min(duration()-span,old.startSeconds+delta)):Math.max(0,Math.min(old.endSeconds-1e-6,old.startSeconds+delta));
      const end=drag.edge==='start'?old.endSeconds:drag.edge==='move'?start+span:Math.max(old.startSeconds+1e-6,Math.min(duration(),old.endSeconds+delta));
      drag.nextRange={startSeconds:start,endSeconds:end};const bar=root.querySelector(`[data-timebar="${drag.id}"]`);if(bar){bar.style.left=start/duration()*100+'%';bar.style.width=(end-start)/duration()*100+'%';}
    }
  });
  root.addEventListener('pointerup',async event=>{
    if(!drag||drag.pointerId!==event.pointerId)return;const captured=drag;drag=null;if(root.hasPointerCapture(event.pointerId))root.releasePointerCapture(event.pointerId);
    try{if(captured.document!==getDocument())throw new Error('拖动时文档已改变，请重试；未覆盖新修改。');
      if(captured.type==='cue'){if(captured.nextTime!==undefined){activeCueId=captured.id;await modifyCue({frame:frameAtTime(captured.nextTime)});}const k=activeCue();if(k)seek(k.frame);}
      else if(captured.nextRange){const range=rangeFromSeconds(getDocument().review.sourceFrameMapping,{...captured.nextRange,durationSeconds:duration()});await changeObject(captured.id,range);}else select(captured.id);
    }catch(e){status(e.message);if(captured.type==='cue')$('cue-error').textContent=e.message;else O('object-error').textContent=e.message;}render();
  });
  root.addEventListener('pointercancel',()=>{drag=null;render();});
  function render(){
    const d=getDocument();root.hidden=d?.schemaVersion!==2;if(root.hidden)return;
    if(identity!==d.review.videoSha256){identity=d.review.videoSha256;activeCueId=null;newRange=null;}
    if(d.newDrawingRange)setNew(d.newDrawingRange);else {newRange=null;for(const k of ['start','end'])if(document.activeElement!==$(k))$(k).value='';}
    for(const k of ['start-handle','end-handle']){$(k).min=d.review.sourceFrameMapping[0].time;$(k).max=duration();}
    $('range-label').textContent=newRange?`新标注 ${seconds(newRange).startSeconds.toFixed(3)}—${seconds(newRange).endSeconds.toFixed(3)} 秒（原片 PTS）；每个对象独立，可连续绘制。`:'先设置新标注的开始和结束时间，再选工具绘制；暂停点可先添加。';
    const a=getSelected();objectPanel.hidden=!a;if(a){if(a.timingMode==='manual')O('object-scope').value='linked';O('object-title').textContent=a.type==='route'?'动作时间 · 原片':'显示时间 · 原片';const t=seconds(O('object-scope').value==='action'?(a.actionRange??a):a);for(const k of ['start','end'])if(document.activeElement!==O('object-'+k))O('object-'+k).value=t[k+'Seconds'].toFixed(3);O('legacy-range').hidden=a.timingMode==='manual';}
    $('cue-markers').replaceChildren(...(d.tacticKeyframes?.items??[]).map((k,i)=>{
      const button=document.createElement('button');button.dataset.cueMarker=k.id;button.className='tactics-cue-marker';button.style.left=d.review.sourceFrameMapping[k.frame].time/duration()*100+'%';button.textContent=`◆ ${i+1}`;button.title=`暂停点 ${i+1} · ${d.review.sourceFrameMapping[k.frame].time.toFixed(3)} 秒 · 拖动移动`;button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(k.id===activeCueId));button.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){activeCueId=k.id;seek(k.frame);render();}};return button;
    }));
    $('rows').replaceChildren(...(d.annotations?.items??[]).map(a=>{
      const row=document.createElement('div');row.className='tactics-object-time-row';const label=document.createElement('button');label.textContent=name(a);label.dataset.timeSelect=a.id;label.setAttribute('aria-pressed',String(a.id===getSelected()?.id));label.onclick=()=>{select(a.id);if(getFrame()<a.startFrame||getFrame()>=a.endFrameExclusive||a.authoredPath&&getFrame()!==a.anchorFrame)seek(a.anchorFrame);render();};
      const track=document.createElement('div');track.className='tactics-time-track';track.dataset.timeTrack='';const bar=document.createElement('div'),t=seconds(a.actionRange??a);bar.className='tactics-timebar';bar.dataset.timebar=a.id;bar.style.left=t.startSeconds/duration()*100+'%';bar.style.width=(t.endSeconds-t.startSeconds)/duration()*100+'%';bar.title=`${name(a)} ${t.startSeconds.toFixed(3)}—${t.endSeconds.toFixed(3)} 秒 · 拖中间移动，两端改时间`;
      for(const edge of ['start','end']){const handle=document.createElement('button');handle.dataset.timeEdge=edge;handle.className='tactics-time-edge';handle.setAttribute('aria-label',`${name(a)} ${edge==='start'?'起点':'终点'}`);handle.textContent='│';bar.append(handle);}const text=document.createElement('span');text.textContent=`${t.startSeconds.toFixed(2)}—${t.endSeconds.toFixed(2)}`;bar.append(text);track.append(bar);row.append(label,track);return row;
    }));
    const cue=activeCue();$('cue-editor').hidden=!cue;$('leave-cue').hidden=!cue;$('cue-context').textContent=cue?`正在编辑暂停点 · ${d.review.sourceFrameMapping[cue.frame].time.toFixed(3)} 秒；${getFrame()===cue.frame?'此画面新画的标注自动关联这里':'点击暂停标记回到该画面，或结束编辑后独立绘制'}。`:'点击暂停标记修改位置、时长和本次展示；每个对象可关联一个首次讲解点。';
    if(cue){
      $('cue-title').textContent=`讲解暂停点 ${d.tacticKeyframes.items.indexOf(cue)+1}`;$('cue-time').value=d.review.sourceFrameMapping[cue.frame].time.toFixed(3);$('cue-hold').value=cue.holdSeconds;$('cue-hold').min=cue.kind==='explanation'?MIN_EXPLANATION_HOLD_SECONDS:0;$('cue-freeze').checked=cue.freeze;
      $('cue-objects').replaceChildren(...(d.annotations?.items??[]).map(a=>{
        const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=cue.annotationIds.includes(a.id);const other=d.tacticKeyframes.items.find(k=>k.id!==cue.id&&k.kind==='explanation'&&k.annotationIds.includes(a.id)),late=cue.kind==='explanation'&&(cue.frame>(a.actionRange??a).startFrame||cue.frame<a.phaseSnapshot.startFrame);
        check.disabled=!check.checked&&(!!other||late);label.title=other?'已关联另一个首次讲解点，请在对象属性解除':late?'暂停点晚于动作起点或不在同阶段':'';check.onchange=safe(()=>modifyCue({annotationIds:check.checked?[...cue.annotationIds,a.id]:cue.annotationIds.filter(id=>id!==a.id)}),'cue-error');label.append(check,`${name(a)}${other?'（已有首次讲解）':late?'（时间不兼容）':''}`);return label;
      }));
    }updateFrame();
  }
  function updateFrame(){const d=getDocument();if(!d||root.hidden)return;$('head').style.left=d.review.sourceFrameMapping[getFrame()].time/duration()*100+'%';$('head').setAttribute('aria-label',`原片播放头 ${d.review.sourceFrameMapping[getFrame()].time.toFixed(3)} 秒`);}
  function associateNew(next,id){const k=activeCue();if(!k||getFrame()!==k.frame)return next;return upsertTacticKeyframe(next,{...k,annotationIds:[...k.annotationIds,id]});}
  return {render,updateFrame,range:()=>newRange??getDocument().newDrawingRange??null,associateNew,selectedCue:activeCue,focusRange:()=>{$('start').focus();report('请先设置新标注的起止时间；原片时间不会包含额外暂停。');}};
}
