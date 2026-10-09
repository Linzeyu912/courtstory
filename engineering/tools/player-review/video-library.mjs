// Local inbox UI. Model work happens on the server and survives closing this dialog.
import {mountModelSelection} from './model-selection.mjs';
export function mountVideoLibrary({beforeNavigate, sample, variant, localVideo=false, presets=[],modelChoices=null,clip=null}) {
  const $=id=>document.getElementById(id), dialog=$('videoLibraryDialog');
  let catalog=null, timer=null, refreshQueue=Promise.resolve(), syncingPreset=false, uploading=false, openWhenReady=null, requestedPreset=null;
  const status=message=>{$('videoLibraryStatus').textContent=message;};
  const preset=()=>$('importMode')?.value==='manual'?'manual':$('importPreset').value||'team-stable';
  const availability=id=>catalog?.runtime?.variants?.[id]||{available:catalog?.runtimeAvailable!==false,reason:catalog?.runtime?.reason||'本机推理环境未配置。'};
  const readyVariants=()=>[...$('trackingVersion').options].map(item=>item.value);
  const mainPicker=mountModelSelection({catalog:modelChoices,prefix:'model',variant,onChange:choice=>{
    if(!choice)return;
    const current=choice.id===variant,ready=readyVariants().includes(choice.id);
    const runtime=availability(choice.id);
    $('applyModel').disabled=current||(!ready&&!runtime.available);$('applyModel').textContent=current?'当前组合':ready?'应用组合':'识别并应用';
    $('modelChoiceStatus').textContent=current?'':ready?'已有结果，可直接切换。':!runtime.available?runtime.reason:'此组合需重新识别，当前结果和草稿会保留。';
  }});
  const importPicker=mountModelSelection({catalog:modelChoices,prefix:'import',variant:modelChoices?.defaultVariant,onChange:choice=>{
    if(!choice)return;$('importPreset').value=choice.id;
    $('importPresetDescription').textContent=choice.description;if(catalog&&!syncingPreset)render();
  }});
  const go=async(id,model,players=false)=>{
    await beforeNavigate();const params=new URLSearchParams(location.search);
    params.set('sample',id);params.set('variant',model);params.delete('area');params.delete('candidate');if(model==='manual')params.set('area','tactics');
    if(players)params.set('step','players');location.assign(`/?${params}`);
  };
  async function request(url,options){
    const response=await fetch(url,options);
    const data=await response.json().catch(()=>({error:'服务暂不可用，请检查本地服务后重试。'}));
    if(!response.ok)throw new Error(data.error||'请求失败，请重试。');
    return data;
  }
  function modelAvailability(){
    for(const option of $('importPreset').options){const item=availability(option.value);option.disabled=!item.available;option.title=item.available?'':item.reason;}
    for(const prefix of ['import','model']){
      const select=$(prefix+'Detector');if(!select)continue;
      for(const option of select.options){
        const item=catalog.runtime?.detectors?.[option.value];if(!item)continue;
        const existing=prefix==='model'&&modelChoices?.combinations.some(choice=>choice.detector===option.value&&readyVariants().includes(choice.id));
        option.disabled=!item.available&&!existing;option.title=item.available?'':item.reason;
      }
    }
    if(mainPicker){
      const choice=mainPicker.read();if(choice){
        const current=choice.id===variant,ready=readyVariants().includes(choice.id),runtime=availability(choice.id);
        $('applyModel').disabled=current||(!ready&&!runtime.available);
        if(!current&&!ready&&!runtime.available)$('modelChoiceStatus').textContent=runtime.reason;
      }
    }
  }
  async function changeCollection(entry,action,button){
    button.disabled=true;
    try{
      await request(`/api/video-library/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:entry.collectionId||entry.id})});
      await refresh();status(action==='archive'?'已归档，可在“已归档”中恢复；视频和标注均保留。':'已恢复到活动视频，原识别结果和标注均保留。');
    }catch(error){status(error.message);button.disabled=false;}
  }
  function render(){
    const list=$('localVideoList');list.replaceChildren();
    $('videoFolderPath').textContent=catalog.folder;
    if(!$('importPreset').options.length){
      for(const item of catalog.presets){const option=document.createElement('option');option.value=item.id;option.textContent=item.label;$('importPreset').append(option);}
    }
    if(requestedPreset){
      $('importPreset').value=requestedPreset;const wanted=requestedPreset;requestedPreset=null;
      syncingPreset=true;try{if(wanted!=='manual')importPicker?.select(wanted);}finally{syncingPreset=false;}
    }
    $('importPresetDescription').textContent=catalog.presets.find(item=>item.id===preset())?.description||'';
    modelAvailability();
    const archived=$('videoLibraryScope')?.value==='archived',entries=archived?(catalog.archivedEntries||[]):catalog.entries;
    if(!entries.length){const empty=document.createElement('p');empty.className='library-empty';empty.textContent=archived?'没有已归档的视频。':'还没有活动视频。点击“导入并识别球员”，或从“已归档”恢复。';list.append(empty);}
    const search=($('videoLibrarySearch').value||'').trim().toLowerCase(),origin=$('videoLibraryOrigin').value||'all';
    const visible=entries.filter(e=>(origin==='all'||(e.origin||'local')===origin)&&`${e.filename} ${e.relativePath||''}`.toLowerCase().includes(search));
    if(entries.length&&!visible.length){const empty=document.createElement('p');empty.className='library-empty';empty.textContent='没有符合条件的视频。调整关键词或来源筛选后再试。';list.append(empty);}
    $('videoLibraryCount').textContent=`${archived?'已归档':'活动视频'} ${visible.length} / ${entries.length} 段 · 已归档 ${(catalog.archivedEntries||[]).length} 段`;
    for(const entry of visible){
      const row=document.createElement('article');row.className='local-video-row';
      const info=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('p');
      title.textContent=entry.filename;title.title=entry.relativePath;
      detail.className='small muted';detail.textContent=`${entry.origin==='shared'?'共享素材':entry.origin==='review'?'工作台片段':'本地导入'} · ${(entry.bytes/1024/1024).toFixed(1)} MB · ${entry.message}${entry.copies>1?` · ${entry.copies} 份相同文件已合并`:''}`;
      info.append(title,detail);row.append(info);
      if(archived){const restore=document.createElement('button');restore.textContent='恢复';restore.onclick=()=>changeCollection(entry,'restore',restore);row.append(restore);list.append(row);continue;}
      const button=document.createElement('button'),busy=['running','queued'].includes(entry.status),
        failed=entry.status==='error'&&(!entry.jobVariant||entry.jobVariant===preset()),ready=entry.variants.includes(preset())&&!failed,runtime=availability(preset());
      button.textContent=busy?(entry.status==='queued'?'排队中…':entry.jobVariant==='manual'?'读取视频中…':'识别中…'):ready?'打开':preset()==='manual'?'打开并人工制作':failed?'重试识别':'识别并打开';
      button.disabled=busy||entry.available===false||(!ready&&!runtime.available);button.title=!ready&&!runtime.available?runtime.reason:'';
      if(entry.available===false)button.textContent='待下载 LFS';
      button.onclick=async()=>{
        if(ready){await go(entry.sampleId,preset(),true);return;}
        const selected=preset();button.disabled=true;
        try{
          const choice=modelChoices?.combinations.find(item=>item.id===selected);
          const result=await request('/api/video-library/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:entry.id,variant:selected,...(choice?{detector:choice.detector,tracker:choice.tracker}:{})})});
          if(result.status==='ready'){await go(result.sampleId||entry.id,selected,true);return;}
          openWhenReady=result.variant===selected?{id:entry.id,variant:selected}:null;
          status(openWhenReady?'已开始识别，完成后会进入球员检查。':'此视频正在识别另一个方案，完成后可再选择。');await refresh();
        }catch(error){status(error.message);button.disabled=false;}
      };
      const archive=document.createElement('button');archive.textContent='归档';archive.disabled=busy;archive.title=busy?'请等待识别结束后归档。':'视频、检测结果和标注均保留，可随时恢复。';archive.onclick=()=>changeCollection(entry,'archive',archive);
      row.append(button,archive);list.append(row);
    }
    if(!catalog.runtimeAvailable&&preset()!=='manual')status(catalog.runtime?.reason||'本机推理环境未配置，请按模型部署说明配置后识别。');
  }
  function refresh(){refreshQueue=refreshQueue.then(refreshNow,refreshNow);return refreshQueue;}
  async function refreshNow(){
    clearTimeout(timer);
    try{
      catalog=await request('/api/video-library');render();
      if(openWhenReady&&dialog.open){
        const entry=catalog.entries.find(item=>item.id===openWhenReady.id);
        if(entry?.status==='ready'&&entry.variants.includes(openWhenReady.variant)){
          const target=openWhenReady;openWhenReady=null;await go(entry.sampleId||target.id,target.variant,true);return;
        }
        if(entry?.status==='error'){status(entry.message);openWhenReady=null;}
      }
    }catch(error){status(error.message);}
    finally{if(dialog.open&&(openWhenReady||catalog?.entries.some(entry=>['running','queued'].includes(entry.status))))timer=setTimeout(refresh,2500);}
  }
  function show(model){if(typeof model==='string'){requestedPreset=model;if($('importMode'))$('importMode').value=model==='manual'?'manual':'analysis';}dialog.showModal();refresh();}
  if(mainPicker)$('applyModel').onclick=async()=>{
    const choice=mainPicker.read();if(!choice)return;
    if(readyVariants().includes(choice.id)){await go(sample,choice.id);return;}
    dialog.showModal();requestedPreset=choice.id;await refresh();
    const entry=catalog?.entries.find(item=>item.sha256===(clip?.importSourceSha256||clip?.video_sha256));
    $('videoLibrarySearch').value=entry?.filename||'';render();
    if(entry?.available===false){status('当前视频尚未完整下载。');return;}
    try{
      const result=await request('/api/video-library/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(entry?{id:entry.id}:{sample}),variant:choice.id,detector:choice.detector,tracker:choice.tracker})});
      if(result.status==='ready'){await go(result.sampleId,choice.id);return;}
      openWhenReady=result.variant===choice.id?{id:result.sampleId,variant:choice.id}:null;
      status(openWhenReady?'正在处理所选组合，完成后自动打开。':'此视频正在处理另一个组合，请等待结束。');await refresh();
    }catch(error){status(error.message);}
  };
  function upload(file){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();xhr.open('POST','/api/video-library/import');
      xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('X-Video-Mode',preset());xhr.setRequestHeader('X-Video-Filename',encodeURIComponent(file.name));
      xhr.upload.onprogress=event=>status(`正在导入 ${file.name}${event.lengthComputable?` · ${Math.round(event.loaded/event.total*100)}%`:''}`);
      xhr.onload=()=>{let result;try{result=JSON.parse(xhr.responseText);}catch{reject(new Error('导入失败，请检查本地服务后重试。'));return;}xhr.status<300?resolve(result):reject(new Error(result.error||'导入失败'));};
      xhr.onerror=()=>reject(new Error('连接中断，请重新导入。'));xhr.send(file);
    });
  }
  $('openVideoLibrary').onclick=show;
  if($('startManualImport'))$('startManualImport').onclick=()=>{show('manual');$('importVideos').click();};
  if($('importMode'))$('importMode').onchange=()=>{if(catalog)render();};
  if($('startVideoImport'))$('startVideoImport').onclick=()=>{show('team-stable');$('importVideos').click();};
  if(localVideo&&!modelChoices)for(const item of presets){
    if([...$('trackingVersion').options].some(option=>option.value===item.id))continue;
    const option=document.createElement('option');option.value=`prepare:${item.id}`;option.textContent=`${item.label} · 需处理`;$('trackingVersion').append(option);
  }
  $('trackingVersion').addEventListener('change',event=>{
    const selected=event.target.value;
    if(selected.startsWith('prepare:')){event.target.value=variant;show(selected.slice(8));return;}
    go(sample,selected);
  });
  $('closeVideoLibrary').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{clearTimeout(timer);openWhenReady=null;});
  $('refreshVideoLibrary').onclick=()=>{status('正在刷新文件夹…');refresh().then(()=>{if(catalog?.runtimeAvailable&&!uploading)status('文件夹已刷新。');});};
  $('copyVideoFolder').onclick=async()=>{try{await navigator.clipboard.writeText(catalog.folder);status('文件夹路径已复制。');}catch{status('请选中上方路径进行复制。');}};
  $('importPreset').onchange=()=>render();
  $('videoLibrarySearch').oninput=()=>{if(catalog)render();};
  $('videoLibraryOrigin').onchange=()=>{if(catalog)render();};
  if($('videoLibraryScope'))$('videoLibraryScope').onchange=()=>{if(catalog)render();};
  $('importVideos').onchange=async event=>{
    const files=[...event.target.files];if(!files.length||uploading)return;
    uploading=true;event.target.disabled=true;let count=0,duplicates=0,started=0;const errors=[];
    if($('videoLibraryScope'))$('videoLibraryScope').value='active';$('videoLibrarySearch').value='';
    const selectedMode=preset();requestedPreset=selectedMode;
    for(const file of files){
      try{
        if(file.size>(catalog?.maxUploadBytes||2*1024**3))throw new Error('超过 2 GB，请直接放入文件夹');
        const result=await upload(file);count++;if(result.duplicate)duplicates++;
        // Current server imports and starts atomically. Older servers can use the existing process route.
        const job=result.job||await request('/api/video-library/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:result.id,variant:selectedMode})});
        if(job.status==='error')errors.push(`${file.name}：${job.message}`);
        else if(['queued','running','ready'].includes(job.status)){
          started++;openWhenReady={id:result.id,variant:job.variant||selectedMode};
        }
      }catch(error){errors.push(`${file.name}：${error.message}`);}
    }
    uploading=false;event.target.disabled=false;event.target.value='';await refresh();
    status(`已导入 ${count} 个视频${duplicates?`（${duplicates} 个已有相同内容）`:''}；${started} 个${selectedMode==='manual'?'正在读取视频，完成后进入人工标注':'已开始识别，完成后进入球员检查'}。${errors.join('；')}`);
  };
  $('useRecommended').onclick=()=>{
    const ready=[...$('trackingVersion').options].find(option=>option.value==='team-stable');
    if(ready){go(sample,'team-stable');return;}
    show('team-stable');status('为这个本地视频选择 THY 完整方案，处理后即可使用。');
  };
  $('useRecommended').disabled=variant==='team-stable';
  $('useRecommended').textContent=variant==='team-stable'?'已用默认组合':'恢复默认组合';
  // Populate model availability before the user opens advanced model controls.
  if(modelChoices)refresh();
}
