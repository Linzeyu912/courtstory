export function mountFootageUI(api){
  const $=id=>document.getElementById(id),last=api.clip.frames.length-1;
  for(const id of ['liveStart','liveEnd'])$(id).max=last+1;
  $('liveStart').value=1;$('liveEnd').value=last+1;
  const edit=callback=>api.change(()=>{const s=api.session();callback(s);s.liveSelection=null;});
  $('liveSetStart').onclick=()=>{$('liveStart').value=api.frame()+1;};
  $('liveSetEnd').onclick=()=>{$('liveEnd').value=api.frame()+1;};
  $('liveKeep').onclick=()=>{
    const start=Number($('liveStart').value)-1,end=Number($('liveEnd').value)-1;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>last||start>end){api.toast('请先确认有效的起止帧。');return;}
    edit(s=>{s.liveRanges||=[];s.liveRanges.push({start,end});s.liveRanges.sort((a,b)=>a.start-b.start);
      s.liveRanges=s.liveRanges.reduce((all,r)=>{const tail=all.at(-1);if(tail&&r.start<=tail.end+1)tail.end=Math.max(tail.end,r.end);else all.push({...r});return all;},[]);});
  };
  $('liveWhole').onclick=()=>edit(s=>s.liveRanges=[{start:0,end:last}]);
  $('liveApply').onclick=async()=>{
    const ranges=api.session().liveRanges||[];
    if(!ranges.length){api.toast('先保留至少一个直播区间。');return;}
    if(ranges.length===1&&ranges[0].start===0&&ranges[0].end===last){
      api.change(()=>api.session().liveSelection={ranges:structuredClone(ranges),confirmedAt:new Date().toISOString(),method:'manual_whole_clip',parentVideoSha256:api.clip.video_sha256});
      api.next();return;
    }
    $('liveApply').disabled=true;$('liveApply').textContent='正在生成剪辑和对应候选…';
    try{
      const response=await fetch('/api/trim',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sample:api.sample,variant:api.variant,qa:api.qa,ranges})});
      if(!response.ok){const message=await response.json().catch(()=>null);throw new Error(message?.error||'剪辑生成失败，原视频仍可使用。');}
      const result=await response.json(),params=new URLSearchParams(location.search);
      params.set('sample',result.sample);params.delete('variant');location.assign(`/?${params}`);
    }catch(error){api.toast(error.message);$('liveApply').disabled=false;$('liveApply').textContent='应用剪辑，进入球员标定';}
  };
  $('liveTimeline').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();api.seek(Math.min(last,Math.floor((e.clientX-r.left)/r.width*(last+1))));};
  return {render(){
    const s=api.session(),ranges=s.liveRanges||[];
    $('liveRangeList').replaceChildren();$('liveTimeline').replaceChildren();
    for(const [index,r] of ranges.entries()){
      const item=document.createElement('div');item.className='anchor';
      const jump=document.createElement('button');jump.textContent=`${api.clip.frames[r.start].time.toFixed(2)}–${api.clip.frames[r.end].time.toFixed(2)} s · 第 ${r.start+1}–${r.end+1} 帧`;jump.onclick=()=>api.seek(r.start);
      const end=document.createElement('button');end.textContent='看终点';end.onclick=()=>api.seek(r.end);
      const remove=document.createElement('button');remove.textContent='移除';remove.setAttribute('aria-label',`移除直播区间 ${index+1}`);remove.onclick=()=>edit(state=>state.liveRanges.splice(index,1));item.append(jump,end,remove);$('liveRangeList').append(item);
      const block=document.createElement('span');block.style.left=`${r.start/(last+1)*100}%`;block.style.width=`${(r.end-r.start+1)/(last+1)*100}%`;$('liveTimeline').append(block);
    }
    const cursor=document.createElement('i');cursor.style.left=`${api.frame()/(last+1)*100}%`;$('liveTimeline').append(cursor);
    $('liveStatus').textContent=s.liveSelection?'已人工确认直播区间；下一步对应场上十名球员。':ranges.length?`已选 ${ranges.length} 个区间，仍需查看起止并应用剪辑。`:'还未选择直播区间；当前整段正常时，可保留整段。';
  }};
}
