import {rangeFromSeconds,rangeToSeconds} from './tactics-time-range.mjs';
import {setAnnotationRange} from './tactics-court-editor.mjs';
import {upsertTacticKeyframe,removeTacticKeyframe} from './tactics-keyframes.mjs';
export function mountTacticsTimeline({host,getDocument,getSelected,getFrame,commit,commitRange,seek,play,status,thumbnail}){
  const root=document.createElement('section');root.className='tactics-source-timeline';
  root.innerHTML=`<div class="tactics-range-bar"><strong>新建图形作用时间段</strong><label>开始（秒）<input data-start type="number" step=".001"></label><input data-start-handle type="range" step=".001" aria-label="新建区间起点"><label>结束（秒）<input data-end type="number" step=".001"></label><input data-end-handle type="range" step=".001" aria-label="新建区间终点"><button data-use-start>当前画面设为起点</button><button data-use-end>当前画面设为终点</button><button data-seek-start>定位选区起点</button><button data-play>播放这段</button></div><p data-range-label role="status"></p><div data-object hidden><strong>选中图形时间条</strong><label>调整内容<select data-object-scope><option value="linked">显示与动作一起调整</option><option value="visibility">仅显示区间</option><option value="action">仅动作进度区间</option></select></label><label>开始（秒）<input data-object-start type="number" step=".001"></label><input data-object-start-handle type="range" step=".001" aria-label="图形时间条起点"><label>结束（秒）<input data-object-end type="number" step=".001"></label><input data-object-end-handle type="range" step=".001" aria-label="图形时间条终点"><label><input data-move-cue type="checkbox">将越界讲解点移到新区间起点</label><button data-apply>应用图形范围</button></div><div class="tactics-keyframe-heading"><strong>讲解关键帧</strong><button data-add>＋ 讲解关键帧</button><button data-previous>前一关键帧</button><button data-next>后一关键帧</button></div><div data-keyframes class="tactics-keyframe-cards"></div>`;
  host.prepend(root);const $=k=>root.querySelector(`[data-${k}]`);let newRange=null,documentIdentity=null,pendingRange=Promise.resolve(),rangeUpdates=0;const thumbnails=new Map();
  const seconds=range=>{const d=getDocument();return rangeToSeconds(d.review.sourceFrameMapping,range,d.review.mediaEndTime);};
  const fromInputs=(prefix='')=>{const d=getDocument();if($(prefix+'start').value===''||$(prefix+'end').value==='')throw new Error('填写开始与结束时间。');return rangeFromSeconds(d.review.sourceFrameMapping,{startSeconds:Number($(prefix+'start').value),endSeconds:Number($(prefix+'end').value),durationSeconds:d.review.mediaEndTime});};
  const safe=fn=>async()=>{try{await fn();render();}catch(e){status(e.message);}};
  function setNew(range){newRange=range;const {startSeconds,endSeconds}=seconds(range);$('start').value=startSeconds.toFixed(3);$('end').value=endSeconds.toFixed(3);$('start-handle').value=startSeconds;$('end-handle').value=endSeconds;}
  for(const key of ['start','end']){
    $(key).onchange=safe(async()=>{const range=fromInputs();setNew(range);rangeUpdates++;pendingRange=pendingRange.catch(()=>{}).then(async()=>{try{if(commitRange)await commitRange(range);else{const d=structuredClone(getDocument());d.newDrawingRange=range;await commit(d);}}finally{rangeUpdates--;}});await pendingRange;});
    $(key+'-handle').onchange=()=>{$(key).value=$(key+'-handle').value;void $(key).onchange();};
    $('object-'+key+'-handle').onchange=()=>{$('object-'+key).value=$('object-'+key+'-handle').value;void $('apply').onclick();};
  }
  $('use-start').onclick=safe(()=>{$('start').value=getDocument().review.sourceFrameMapping[getFrame()].time;return $('start').onchange();});
  $('use-end').onclick=safe(()=>{$('end').value=getDocument().review.sourceFrameMapping[getFrame()].time;return $('end').onchange();});
  $('object-scope').onchange=()=>render();
  $('apply').onclick=safe(()=>{const a=getSelected();if(!a)return;return commit(setAnnotationRange(getDocument(),a.id,fromInputs('object-'),{moveCue:$('move-cue').checked,scope:$('object-scope').value}));});
  $('seek-start').onclick=safe(()=>seek(fromInputs().startFrame));
  $('play').onclick=safe(()=>{newRange=fromInputs();play(newRange);});
  $('add').onclick=safe(()=>{const a=getSelected();if(!a)throw new Error('先选择要讲解的图形。');return commit(upsertTacticKeyframe(getDocument(),{frame:getFrame(),annotationIds:[a.id]}));});
  for(const [key,direction] of [['previous',-1],['next',1]])$(key).onclick=safe(()=>{const keys=getDocument().tacticKeyframes?.items??[],frame=getFrame(),k=direction<0?[...keys].reverse().find(k=>k.frame<frame):keys.find(k=>k.frame>frame);if(k)seek(k.frame);});
  function render(){
    const d=getDocument();root.hidden=d?.schemaVersion!==2;if(root.hidden)return;
    if(!newRange||documentIdentity!==d.review.videoSha256||(!rangeUpdates&&JSON.stringify(newRange)!==JSON.stringify(d.newDrawingRange??{startFrame:d.playDefinition.startFrame,endFrameExclusive:d.playDefinition.endFrameExclusive}))){documentIdentity=d.review.videoSha256;setNew(d.newDrawingRange??{startFrame:d.playDefinition.startFrame,endFrameExclusive:d.playDefinition.endFrameExclusive});}
    for(const key of ['start-handle','end-handle','object-start-handle','object-end-handle']){const input=$(key);input.min=d.review.sourceFrameMapping[0].time;input.max=d.review.mediaEndTime;}
    const {startSeconds,endSeconds}=seconds(newRange);$('range-label').textContent=`接下来新建图形作用于 ${startSeconds.toFixed(2)}–${endSeconds.toFixed(2)} 秒。修改此处不改变已有图形。`;
    const a=getSelected();$('object').hidden=!a;if(a){const t=seconds($('object-scope').value==='action'?(a.actionRange??a):a);for(const key of ['start','end']){$('object-'+key).value=t[key+'Seconds'].toFixed(3);$('object-'+key+'-handle').value=t[key+'Seconds'];}}
    $('keyframes').replaceChildren(...(d.tacticKeyframes?.items??[]).map(k=>{
      const card=document.createElement('article'),title=document.createElement('button');title.textContent=`◆ ${d.review.sourceFrameMapping[k.frame].time.toFixed(3)} 秒 · ${k.annotationIds.length} 个图形`;title.onclick=()=>seek(k.frame);card.append(title);
      if(thumbnail){const image=document.createElement('img'),identity=d.review.videoSha256,key=identity+':'+k.frame;image.alt=`${d.review.sourceFrameMapping[k.frame].time.toFixed(3)} 秒源视频`;image.width=128;image.hidden=true;card.prepend(image);if(!thumbnails.has(key))thumbnails.set(key,Promise.resolve().then(()=>thumbnail(k.frame)).catch(()=>null));void thumbnails.get(key).then(url=>{if(url&&getDocument()?.review.videoSha256===identity&&card.isConnected){image.src=url;image.hidden=false;}});}
      const modify=patch=>commit(upsertTacticKeyframe(getDocument(),{...k,...patch}));
      const time=document.createElement('input');time.type='number';time.step='.001';time.value=d.review.sourceFrameMapping[k.frame].time;time.setAttribute('aria-label','讲解关键帧时间（秒）');time.onchange=safe(()=>{const frame=d.review.sourceFrameMapping.findIndex(p=>p.time>=Number(time.value));return modify({frame});});card.append(time);
      const drag=document.createElement('input');drag.type='range';drag.min=0;drag.max=d.review.sourceFrameMapping.length-1;drag.step=1;drag.value=k.frame;drag.setAttribute('aria-label','拖动讲解关键帧');drag.onchange=safe(()=>modify({frame:Number(drag.value)}));card.append(drag);
      const label=document.createElement('label'),freeze=document.createElement('input');freeze.type='checkbox';freeze.checked=k.freeze;freeze.onchange=safe(()=>modify({freeze:freeze.checked}));label.append(freeze,'暂停讲解');card.append(label);
      const hold=document.createElement('input');hold.type='number';hold.min=0;hold.max=30;hold.step='.1';hold.value=k.holdSeconds;hold.setAttribute('aria-label','讲解停留秒数');hold.onchange=safe(()=>modify({holdSeconds:Number(hold.value)}));card.append(hold);
      const remove=document.createElement('button');remove.textContent='删除讲解点';remove.onclick=safe(()=>commit(removeTacticKeyframe(getDocument(),k.id)));card.append(remove);return card;
    }));
  }
  return {render,range:()=>newRange??getDocument().newDrawingRange??{startFrame:getDocument().playDefinition.startFrame,endFrameExclusive:getDocument().playDefinition.endFrameExclusive}};
}
