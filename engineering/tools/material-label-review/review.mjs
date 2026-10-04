import {emptyReview,confirmRemaining,setVerdict,completionProblem,issueCount,reviewed,nextPending,reviewQueue,appliedReview} from './review-model.mjs';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>structuredClone(value);
const state={allClips:[],sample:null,applied:null,originalReview:null,clips:[],summaries:{},index:0,clip:null,review:null,dirty:false,version:0,saving:null,timer:null,busy:false,span:null,loop:false};
const verdictText={correct:'正确',incorrect:'不正确',unsure:'不确定'};
const localKey=cid=>'basketball-label-review-draft:'+cid;
let toastTimer;
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4800);}
function fmt(seconds){const n=Math.max(0,Number(seconds)||0);return `${String(Math.floor(n/60)).padStart(2,'0')}:${(n%60).toFixed(2).padStart(5,'0')}`;}
function spanText(s){return `${Number(s.start).toFixed(2)}–${Number(s.end).toFixed(2)}秒`;}
async function api(url,body){
  let response;
  try{response=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});}
  catch{throw new Error('服务暂时无法连接；修改仍保留在本机草稿，请重新启动服务后重试。');}
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'保存失败，请重试。');
  return data;
}
function saveStatus(kind,label,detail){$('save-dot').className='save-dot '+kind;$('save-label').textContent=label;$('save-detail').textContent=detail;$('retry').hidden=kind!=='error';}
function rememberDraft(){
  try{localStorage.setItem(localKey(state.clip.clip_id),JSON.stringify(state.review));}
  catch{toast('浏览器草稿备份不可用，正在直接保存到文件。');}
}
function changed(){
  state.applied=null;$('applied-notice').hidden=true;
  state.review.status='draft';state.dirty=true;state.version++;
  rememberDraft();saveStatus('saving','等待落盘','修改将在片刻后保存到文件');updateControls();
  clearTimeout(state.timer);state.timer=setTimeout(()=>persist().catch(()=>{}),450);
}
async function persist(){
  clearTimeout(state.timer);
  if(state.saving){await state.saving;return persist();}
  if(!state.dirty)return;
  const clip=state.clip,version=state.version,body=clone(state.review);
  body.expected_revision=body.revision;
  saveStatus('saving','正在落盘','请稍候…');
  state.saving=(async()=>{
    const {review}=await api('/api/review/'+encodeURIComponent(clip.clip_id),body);
    state.review.revision=review.revision;
    state.review.updated_at=review.updated_at;
    state.summaries[clip.clip_id]={status:review.status,revision:review.revision,updated_at:review.updated_at,
      retention:review.retention,label_fingerprint:review.label_fingerprint,issues:issueCount(review),stale:false};
    if(version===state.version){state.dirty=false;try{localStorage.removeItem(localKey(clip.clip_id));}catch{}}
    else rememberDraft();
    saveStatus('saved','已保存到文件',`本段 ${review.status==='completed'?'已审完':'草稿'} · ${new Date(review.updated_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`);
    $('recovery-notice').hidden=true;renderList();updateProgress();updateControls();
  })();
  try{await state.saving;}
  catch(error){saveStatus('error','尚未落盘',error.message);toast(error.message);throw error;}
  finally{state.saving=null;}
  if(state.dirty)return persist();
}
function updateProgress(){
  const done=state.clips.filter(c=>reviewed(state.summaries[c.clip_id])).length;
  const flagged=state.clips.filter(c=>{const s=state.summaries[c.clip_id];return s&&(s.issues>0||(!s.applied&&['discard','unsure'].includes(s.retention?.decision)));}).length;
  $('progress').max=state.clips.length;$('progress').value=done;
  $('progress-label').textContent=`${$('queue-mode').value==='sample'&&state.sample?'抽检':'全部'}${state.clips.length}段，已审${done}，剩${state.clips.length-done}${flagged?` · ${flagged} 段待处理`:''}`;
  if($('queue-mode').value==='sample'&&state.sample?.result?.status==='completed'){
    const r=state.sample.result;
    $('progress-label').textContent=`40段人工抽检完成：保留${r.retained_count}、已删除${r.discarded_count}。当前显示保留素材${state.clips.length}段${flagged?` · ${flagged} 段有新意见`:''}`;
  }
}
function renderList(){
  const query=$('search').value.trim().toLowerCase(),filter=$('review-filter').value,batch=$('batch-filter').value;
  const items=state.clips.map((clip,index)=>({clip,index})).filter(({clip})=>{
    const s=state.summaries[clip.clip_id];
    if(batch!=='all'&&clip.dataset_id!==batch)return false;
    if(query&&!`${clip.clip_id} ${clip.matchup} ${clip.filename} ${clip.fields.map(f=>f.display).join(' ')}`.toLowerCase().includes(query))return false;
    if(filter==='pending'&&reviewed(s))return false;
    if(filter==='completed'&&!reviewed(s))return false;
    if(filter==='issues'&&!(s&&(s.issues>0||(!s.applied&&['discard','unsure'].includes(s.retention?.decision))||s.stale)))return false;
    if(filter==='excluded'&&clip.machine_selection.recommended)return false;
    return true;
  });
  $('list-count').textContent=`显示 ${items.length} / ${state.clips.length} 段`;
  $('clip-list').innerHTML=items.length?items.map(({clip,index})=>{
    const s=state.summaries[clip.clip_id],flag=s&&(s.issues>0||(!s.applied&&['discard','unsure'].includes(s.retention?.decision)));
    const status=s?.applied&&reviewed(s)?'人工审核 · 意见已处理':s?.stale?'标签已变，需重审':reviewed(s)?(flag?'人工审核 · 待处理':'人工审核'):s?'草稿 · 未审完':'AI标注';
    return `<button class="clip-row ${index===state.index?'active':''}" data-index="${index}" aria-current="${index===state.index?'true':'false'}" title="${esc(clip.clip_id)}"><span class="num">${esc(clip.number)}</span><span class="row-copy"><strong>${esc(clip.matchup)}</strong><small>${esc(clip.dataset_name)} · ${status}</small></span><span class="review-dot ${flag?'issues':reviewed(s)?'completed':''}"></span></button>`;
  }).join(''):'<p class="empty-list">没有符合条件的视频。</p>';
}
function updateControls(){
  const loading=!state.review;
  for(const control of document.querySelectorAll('.field-controls button,.field-feedback textarea,.field-feedback select,#all-correct,#retention-options button,#retention-reason,#general-notes'))control.disabled=loading||state.busy;
  for(const id of ['frame-prev','frame-next','back-two','forward-two','loop','whole','speed','export'])$(id).disabled=loading;
  if(loading){for(const id of ['previous','browse-next','complete','quick-complete'])$(id).disabled=true;return;}
  const total=state.clip.fields.length,done=Object.values(state.review.evaluations).filter(v=>v.verdict!=='pending').length;
  const issues=issueCount(state.review);
  $('field-progress').textContent=`已核对 ${done} / ${total}`;
  $('all-correct').textContent=issues?'一键：其余标签正确':'一键：全部标签正确';
  $('quick-complete').hidden=issues>0||['discard','unsure'].includes(state.review.retention.decision);
  for(const button of $('retention-options').querySelectorAll('button'))button.classList.toggle('selected',button.dataset.decision===state.review.retention.decision);
  $('previous').disabled=state.index===0||state.busy;
  $('browse-next').disabled=state.index===state.clips.length-1||state.busy;
  $('complete').disabled=state.busy;$('quick-complete').disabled=state.busy;
}
function fieldMarkup(field,index){
  const evaluation=state.review.evaluations[field.key];
  const old=state.originalReview?.evaluations[field.key];
  const resolved=state.applied?.resolved_keys?.includes(field.key);
  const oldNote=resolved?`<p class="notice">已修正 · 原评价：${esc(verdictText[old?.verdict]??old?.verdict)}${old?.comment?'；'+esc(old.comment):''}</p>`:'';
  const aiUpdated=state.applied?.post_review_ai_modified_fields?.includes(field.key)?'<p class="notice">这项在你审核后由 AI 交叉复核更新，尚未再次人工确认；原人工评价保留用于追溯。</p>':'';
  return `<article class="field-row" data-key="${esc(field.key)}" data-verdict="${evaluation.verdict}"><div class="field-head"><h3>${esc(field.title)}</h3><span class="field-number">${String(index+1).padStart(2,'0')}</span></div><div class="field-display">${esc(field.display)}</div>${oldNote}${aiUpdated}${field.detail?`<p class="field-detail">${esc(field.detail)}</p>`:''}${field.definition?`<p class="definition">${esc(field.definition)}</p>`:''}${field.intervals.length?`<div class="intervals">${field.intervals.map(s=>`<button data-start="${s.start}" data-end="${s.end}" title="播放这段时间">▶ ${spanText(s)}</button>`).join('')}</div>`:''}<div class="field-controls">${Object.entries(verdictText).map(([v,text])=>`<button data-verdict="${v}" class="${evaluation.verdict===v?'selected':''}" aria-pressed="${evaluation.verdict===v}">${v==='correct'?'✓':v==='incorrect'?'×':'?'} ${text}</button>`).join('')}</div><div class="field-feedback" ${['incorrect','unsure'].includes(evaluation.verdict)?'':'hidden'}><select aria-label="${esc(field.title)}问题类型">${[['label','标签判断不对'],['timing','时间区间不对'],['description','描述或理由不对'],['missing','缺少标签／情况'],['other','其他问题']].map(([v,text])=>`<option value="${v}" ${evaluation.issue_type===v?'selected':''}>${text}</option>`).join('')}</select><textarea rows="2" aria-label="${esc(field.title)}修改意见" placeholder="正确标签或时间是什么？也可只说明哪里不对。">${esc(evaluation.comment)}</textarea></div></article>`;
}
function renderFields(){
  let group='';
  $('fields').innerHTML=state.clip.fields.map((f,i)=>{
    const heading=f.group!==group?`<h3 class="field-group">${esc(f.group)}</h3>`:'';group=f.group;
    return heading+fieldMarkup(f,i);
  }).join('');
  $('fields').scrollTop=0;
}
function syncField(row){
  const e=state.review.evaluations[row.dataset.key];row.dataset.verdict=e.verdict;
  for(const b of row.querySelectorAll('.field-controls button')){b.classList.toggle('selected',b.dataset.verdict===e.verdict);b.setAttribute('aria-pressed',String(b.dataset.verdict===e.verdict));}
  row.querySelector('.field-feedback').hidden=!['incorrect','unsure'].includes(e.verdict);
}
async function loadClip(index){
  const clip=state.clips[index];
  const {review:previous,applied}=await api('/api/review/'+encodeURIComponent(clip.clip_id));
  state.index=index;state.clip=clip;state.dirty=false;state.version=0;state.span=null;state.loop=false;
  const stale=previous&&previous.label_fingerprint!==clip.label_fingerprint&&!applied;
  state.applied=applied;state.originalReview=previous;
  state.review=applied?appliedReview(clip,previous,applied):previous&&!stale?previous:emptyReview(clip,previous?.revision??0);
  $('applied-notice').hidden=!applied;
  $('stale-notice').hidden=!stale;
  $('recovery-notice').hidden=true;
  try{
    const backup=JSON.parse(localStorage.getItem(localKey(clip.clip_id))||'null');
    if(backup&&backup.label_fingerprint===clip.label_fingerprint&&backup.revision===state.review.revision){
      state.applied=null;$('applied-notice').hidden=true;state.review=backup;state.dirty=true;state.version++;$('recovery-notice').hidden=false;
    }
  }catch{}
  $('clip-position').textContent=`第 ${index+1} / ${state.clips.length} 段 · ${clip.dataset_name}`;
  $('clip-title').textContent=`${clip.number} · ${clip.matchup}`;
  $('clip-context').textContent=`${clip.video_spec.duration_seconds.toFixed(2)} 秒 · ${clip.video_spec.width} × ${clip.video_spec.height} · ${clip.human_reviewed?'已人工审核 · 推拉另有AI复核':clip.machine_selection.status==='excluded'?'机器建议排除，仍需你审核':!clip.machine_selection.recommended?'重复备选，仍需你审核':'AI标注 · 未人工审核'}`;
  const video=$('video');video.pause();video.poster=clip.has_poster?'/poster/'+clip.clip_id:'';
  video.src='/video/'+clip.clip_id;video.playbackRate=Number($('speed').value);video.load();
  $('video-error').hidden=true;$('play-time').textContent='00:00.00';
  $('active-span').textContent='点击右侧时间段，可定位查看';$('loop').setAttribute('aria-pressed','false');$('loop').textContent='循环区间：关';
  $('machine-badge').textContent=clip.machine_selection.status==='excluded'?'机器建议排除':!clip.machine_selection.recommended?'机器列为重复备选':clip.machine_selection.status==='challenge'?'机器建议保留困难场景':'机器建议保留';
  $('machine-badge').classList.toggle('excluded',!clip.machine_selection.recommended);
  $('machine-reason').textContent=clip.machine_selection.reason;
  $('retention-reason').value=state.review.retention.reason;$('general-notes').value=state.review.comments;
  $('filename').textContent='原文件：'+clip.filename;$('timing-note').textContent='标签时间说明：'+clip.timestamp_note;
  $('source-link').hidden=!(clip.source_url&&/^https?:\/\//.test(clip.source_url));
  if(!$('source-link').hidden)$('source-link').href=clip.source_url;
  renderFields();renderList();updateControls();updateProgress();
  $('library').classList.remove('open');document.querySelector('.viewer').scrollTop=0;
  if(state.dirty)saveStatus('error','草稿尚未落盘','点击重试保存，把恢复的草稿写入文件');
  else if(previous&&!stale)saveStatus('saved','已从文件恢复',previous.status==='completed'?'本段已审完，可继续修改':'上次草稿已恢复');
  else saveStatus('','本段尚未审核','你的评价会自动保存到文件');
  try{await api('/api/session',{clip_id:clip.clip_id});}catch(error){toast('当前视频位置未保存：'+error.message);}
}
async function navigate(index){
  if(state.busy||index<0||index>=state.clips.length)return;
  state.busy=true;updateControls();
  try{await persist();await loadClip(index);}catch(error){toast(error.message);}
  finally{state.busy=false;updateControls();}
}
async function finish(quick=false){
  if(state.applied&&!state.dirty&&reviewed(state.summaries[state.clip.clip_id])){
    const index=nextPending(state.clips,state.summaries,state.index);
    if(index===null)toast(`全部 ${state.clips.length} 段已审核，评价已落盘。`);else await navigate(index);return;
  }
  if(state.busy)return;
  if(quick){
    if(issueCount(state.review))return;
    state.review=confirmRemaining(state.review);state.review.retention.decision='keep';
    for(const row of $('fields').querySelectorAll('.field-row'))syncField(row);
  }
  const problem=completionProblem(state.review);
  if(problem){toast(problem);updateControls();return;}
  state.review.status='completed';state.dirty=true;state.version++;rememberDraft();
  state.busy=true;updateControls();
  try{
    await persist();
    const index=nextPending(state.clips,state.summaries,state.index);
    if(index===null)toast(`全部 ${state.clips.length} 段已审核，评价已落盘。可以导出审核备份。`);
    else await loadClip(index);
  }catch(error){toast(error.message);}
  finally{state.busy=false;updateControls();}
}
function seek(seconds){
  const video=$('video');video.currentTime=Math.max(0,Math.min(seconds,Number.isFinite(video.duration)?video.duration:state.clip.video_spec.duration_seconds));
}
async function playSpan(start,end){
  state.span={start,end};$('active-span').textContent='当前区间：'+spanText(state.span);seek(start);
  try{await $('video').play();}catch{toast('区间已定位，点击视频播放即可。');}
}
$('fields').addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b||state.busy)return;
  if(b.dataset.start!==undefined){playSpan(Number(b.dataset.start),Number(b.dataset.end));return;}
  if(b.dataset.verdict){const row=b.closest('.field-row');state.review=setVerdict(state.review,row.dataset.key,b.dataset.verdict,Number($('video').currentTime.toFixed(3)));syncField(row);changed();}
});
$('fields').addEventListener('input',event=>{
  const row=event.target.closest('.field-row');if(!row)return;
  const evaluation=state.review.evaluations[row.dataset.key];
  if(event.target.tagName==='TEXTAREA')evaluation.comment=event.target.value;
  if(event.target.tagName==='SELECT')evaluation.issue_type=event.target.value;
  changed();
});
$('all-correct').addEventListener('click',()=>{
  if(state.busy)return;state.review=confirmRemaining(state.review);
  for(const row of $('fields').querySelectorAll('.field-row'))syncField(row);
  changed();toast(issueCount(state.review)?'其余未评价标签已确认正确，标错与不确定项保留。':'全部标签已确认正确；请再选择视频去留。');
});
$('retention-options').addEventListener('click',event=>{const b=event.target.closest('[data-decision]');if(!b||state.busy)return;state.review.retention.decision=b.dataset.decision;changed();});
$('retention-reason').addEventListener('input',()=>{state.review.retention.reason=$('retention-reason').value;changed();});
$('general-notes').addEventListener('input',()=>{state.review.comments=$('general-notes').value;changed();});
$('clip-list').addEventListener('click',event=>{const b=event.target.closest('[data-index]');if(b)navigate(Number(b.dataset.index));});
for(const id of ['search','review-filter','batch-filter'])$(id).addEventListener('input',renderList);
$('queue-mode').addEventListener('change',async()=>{
  const cid=state.clip?.clip_id;state.busy=true;updateControls();
  try{await persist();state.clips=reviewQueue(state.allClips,state.sample,$('queue-mode').value);$('total-count').textContent=state.clips.length;
    const index=state.clips.findIndex(c=>c.clip_id===cid);await loadClip(index>=0?index:0);
  }catch(error){toast(error.message);$('queue-mode').value=state.clips.length===state.allClips.length?'all':'sample';}
  finally{state.busy=false;updateControls();}
});
$('previous').addEventListener('click',()=>navigate(state.index-1));$('browse-next').addEventListener('click',()=>navigate(state.index+1));
$('complete').addEventListener('click',()=>finish());$('quick-complete').addEventListener('click',()=>finish(true));
$('retry').addEventListener('click',()=>persist().catch(()=>{}));
$('frame-prev').addEventListener('click',()=>{$('video').pause();seek($('video').currentTime-1/state.clip.video_spec.fps);});
$('frame-next').addEventListener('click',()=>{$('video').pause();seek($('video').currentTime+1/state.clip.video_spec.fps);});
$('back-two').addEventListener('click',()=>seek($('video').currentTime-2));$('forward-two').addEventListener('click',()=>seek($('video').currentTime+2));
$('speed').addEventListener('change',()=>$('video').playbackRate=Number($('speed').value));
$('loop').addEventListener('click',()=>{state.loop=!state.loop;$('loop').setAttribute('aria-pressed',String(state.loop));$('loop').textContent='循环区间：'+(state.loop?'开':'关');if(state.loop&&!state.span)toast('循环已开启，先点击右侧一个时间段。');});
$('whole').addEventListener('click',()=>{state.span=null;$('active-span').textContent='完整视频';});
$('video').addEventListener('timeupdate',()=>{
  const v=$('video');$('play-time').textContent=fmt(v.currentTime);
  if(state.span&&v.currentTime>=state.span.end&&!v.paused){if(state.loop)seek(state.span.start);else v.pause();}
});
$('video').addEventListener('error',()=>$('video-error').hidden=false);
$('video').addEventListener('loadedmetadata',()=>{$('video-error').hidden=true;$('video').playbackRate=Number($('speed').value);});
$('menu-toggle').addEventListener('click',()=>$('library').classList.toggle('open'));
$('menu-close').addEventListener('click',()=>$('library').classList.remove('open'));
$('export').addEventListener('click',async()=>{
  try{await persist();const data=await api('/api/export',{});
    toast('审核备份已保存到文件：'+data.path);
  }catch(error){toast(error.message);}
});
window.addEventListener('beforeunload',event=>{if(state.dirty){rememberDraft();event.preventDefault();event.returnValue='';}});
window.addEventListener('keydown',event=>{
  if(['INPUT','TEXTAREA','SELECT','BUTTON','VIDEO'].includes(document.activeElement?.tagName)||state.busy)return;
  if(event.key==='ArrowRight'){event.preventDefault();navigate(state.index+1);}
  if(event.key==='ArrowLeft'){event.preventDefault();navigate(state.index-1);}
  if(event.key===' '){event.preventDefault();const v=$('video');v.paused?v.play().catch(()=>{}):v.pause();}
});
updateControls();
try{
  const catalog=await api('/api/catalog');state.allClips=catalog.clips;state.sample=catalog.sample;state.clips=reviewQueue(state.allClips,state.sample);state.summaries=catalog.reviews;
  $('queue-mode').options[1].textContent=`全部${state.allClips.length}段`;
  if(!state.sample){$('queue-mode').value='all';$('queue-mode').options[0].disabled=true;}
  if(!state.clips.length)throw new Error('没有找到已标注的视频。');
  $('total-count').textContent=state.clips.length;
  const batches=new Map(state.allClips.map(c=>[c.dataset_id,c.dataset_name]));
  $('batch-filter').innerHTML='<option value="all">所有批次</option>'+[...batches].map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');
  $('output-path').textContent='落盘目录：'+catalog.output_path+'/records/（每段一个JSON）';
  const last=state.clips.findIndex(c=>c.clip_id===catalog.last_clip_id);
  await loadClip(last>=0?last:0);
}catch(error){$('load-error').hidden=false;$('load-error').querySelector('p').textContent=error.message;}
