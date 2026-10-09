import { openDialog, closeDialog } from './assets/ui-motion.mjs';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('annotationCanvas');
const storageKey = 'courtstory:broadcast-preview:v1';
const svgNS = 'http://www.w3.org/2000/svg';
const sampleDuration = 4.766667;
const initialObjects = () => [
  { id: 'focus', type: 'circle', name: '关键球员', x: 978, y: 710, rx: 61, ry: 22, color: '#ffffff', width: 7, start: 0, end: sampleDuration },
  { id: 'route', type: 'arrow', name: '移动路线', x: 1110, y: 773, x2: 1290, y2: 600, color: '#bfe4ff', width: 7, start: 0, end: sampleDuration },
  { id: 'space', type: 'arrow', name: '进攻方向', x: 916, y: 668, x2: 1060, y2: 533, color: '#ffffff', width: 7, start: 0, end: sampleDuration },
];
let objects = initialObjects();
let selected = null;
let tool = 'select';
let source = 'sample';
let duration = sampleDuration;
let sourceObjectUrl = null;
let pointerState = null;
let annotationsVisible = true;
let undoStack = [];
let redoStack = [];
let toastTimer;
let idCounter = Date.now();
let lastRenderTime = -1;
let initialized = false;
let customName = '';

function toast(message) {
  $('toast').querySelector('span').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2500);
}

function validObjects(value) {
  return Array.isArray(value) && value.length <= 100 && value.every((o) => o && ['circle', 'arrow', 'text'].includes(o.type)
    && typeof o.id === 'string' && typeof o.name === 'string' && /^#[\da-f]{6}$/i.test(o.color)
    && ['x','y','width','start','end'].every(k => Number.isFinite(o[k]))
    && (o.type !== 'arrow' || ['x2','y2'].every(k => Number.isFinite(o[k])))
    && (o.type !== 'circle' || ['rx','ry'].every(k => Number.isFinite(o[k]))));
}

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (saved && validObjects(saved.objects)) { objects = saved.objects; $('saveState').lastChild.textContent = '已恢复预览草稿'; }
  const appearance = localStorage.getItem(`${storageKey}:theme`);
  if (appearance === 'dark') { document.body.dataset.theme = 'dark'; $('themeToggle').setAttribute('aria-label', '切换浅色外观'); }
} catch { /* A corrupt or unavailable preview cache must never prevent opening. */ }

function snapshot() { return JSON.stringify(objects); }
function checkpoint() { undoStack.push(snapshot()); if (undoStack.length > 60) undoStack.shift(); redoStack = []; }
function persist() {
  updateHistory();
  if (source !== 'sample') { $('saveState').lastChild.textContent = '本次会话草稿'; return; }
  try {
    localStorage.setItem(storageKey, JSON.stringify({ objects }));
    $('saveState').lastChild.textContent = '已存于此浏览器';
  } catch { $('saveState').lastChild.textContent = '尚未保存'; }
}
function updateHistory() { $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length; }
function history(direction) {
  const from = direction === 'undo' ? undoStack : redoStack;
  const to = direction === 'undo' ? redoStack : undoStack;
  if (!from.length) return;
  to.push(snapshot()); objects = JSON.parse(from.pop()); selected = null; render(); persist();
  toast(direction === 'undo' ? '已撤销上一步' : '已重做');
}
function icon(name) {
  const svg = document.createElementNS(svgNS, 'svg');
  const use = document.createElementNS(svgNS, 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}
function element(name, attrs = {}) {
  const node = document.createElementNS(svgNS, name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v))); return node;
}
function shape(o, isSelected = false) {
  const group = element('g', { 'data-id': o.id, class: `annotation-shape${isSelected ? ' selected' : ''}`, fill: 'none', stroke: o.color, 'stroke-width': o.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  if (o.type === 'circle') {
    group.append(element('ellipse', { cx: o.x, cy: o.y, rx: o.rx, ry: o.ry, filter: 'url(#annotationShadow)' }));
    group.append(element('ellipse', { cx: o.x, cy: o.y, rx: o.rx, ry: o.ry, stroke: 'transparent', 'stroke-width': 34 }));
    if (isSelected) group.append(element('rect', { x: o.x-o.rx-15, y:o.y-o.ry-15, width:o.rx*2+30,height:o.ry*2+30,rx:8,class:'selection-outline' }));
  } else if (o.type === 'arrow') {
    const dx = o.x2 - o.x, dy = o.y2 - o.y;
    const controlX = o.x + dx * .64 - dy * .13;
    const controlY = o.y + dy * .64 + dx * .13;
    const path = `M ${o.x} ${o.y} Q ${controlX} ${controlY} ${o.x2} ${o.y2}`;
    const angle = Math.atan2(o.y2-controlY,o.x2-controlX), size = 23 + o.width;
    const aX = o.x2-size*Math.cos(angle-.48), aY=o.y2-size*Math.sin(angle-.48);
    const bX = o.x2-size*Math.cos(angle+.48), bY=o.y2-size*Math.sin(angle+.48);
    group.append(element('path', {d:path,filter:'url(#annotationShadow)'}));
    group.append(element('path', {d:`M ${aX} ${aY} L ${o.x2} ${o.y2} L ${bX} ${bY}`,filter:'url(#annotationShadow)'}));
    group.append(element('path', {d:path,stroke:'transparent','stroke-width':38}));
    if(isSelected) [ [o.x,o.y],[o.x2,o.y2] ].forEach(([x,y])=>group.append(element('circle',{cx:x,cy:y,r:9,fill:'#fff',stroke:'#456ee8','stroke-width':3})));
  } else {
    const text = element('text', {x:o.x,y:o.y,fill:o.color,stroke:'none','font-size':35+o.width,'font-family':'Segoe UI, Microsoft YaHei, sans-serif','font-weight':600,filter:'url(#annotationShadow)'});
    text.textContent = o.name; group.append(text);
    if(isSelected) group.append(element('line',{x1:o.x,y1:o.y+12,x2:Math.min(1900,o.x+o.name.length*35),y2:o.y+12,stroke:'#fff','stroke-width':2,'stroke-dasharray':'6 6'}));
  }
  return group;
}
function drawAnnotations() {
  const layer = $('annotationLayer'); layer.replaceChildren();
  const time = video.currentTime;
  objects.forEach(o => { if(time >= o.start && time <= o.end) layer.append(shape(o, selected === o.id)); });
  layer.style.display = annotationsVisible ? '' : 'none';
}
function setPanel(panel) {
  const isAssistant = panel === 'assistant';
  $('assistantPanel').hidden = !isAssistant; $('propertiesPanel').hidden = isAssistant;
  for(const [id,active] of [['assistantTab',isAssistant],['propertiesTab',!isAssistant]]) {
    $(id).classList.toggle('active',active); $(id).setAttribute('aria-selected',String(active)); $(id).tabIndex=active?0:-1;
  }
}
function selectObject(id, reveal = true) {
  selected = id;
  if(reveal) setPanel('properties');
  render();
}
function renderList() {
  $('objectList').replaceChildren(); $('annotationClips').replaceChildren();
  objects.forEach((o,index)=>{
    const row = document.createElement('button'); row.className=`object-row${selected===o.id?' selected':''}`;
    row.setAttribute('aria-pressed',String(selected===o.id)); row.append(icon(o.type==='circle'?'circle':o.type==='text'?'text':'arrow'));
    const label=document.createElement('span');label.textContent=o.name;row.append(label);
    const num=document.createElement('small');num.textContent=String(index+1).padStart(2,'0');row.append(num);
    row.addEventListener('click',()=>{video.pause();video.currentTime=Math.min(duration,Math.max(o.start,video.currentTime>o.end?o.start:video.currentTime));selectObject(o.id);});
    $('objectList').append(row);
    if(index<5){const clip=document.createElement('button');clip.textContent=o.name;clip.title=o.name;clip.classList.toggle('selected',selected===o.id);clip.addEventListener('click',()=>{video.pause();video.currentTime=o.start;selectObject(o.id);});$('annotationClips').append(clip);}
  });
  $('objectCount').textContent=objects.length; $('listCount').textContent=objects.length;
}
function renderProperties() {
  const o=objects.find(o=>o.id===selected);
  $('propertyEditor').hidden=!o; $('emptyProperties').hidden=!!o;
  if(!o)return;
  $('objectName').value=o.name; $('strokeWidth').value=o.width; $('widthValue').value=o.width;
  $('startTime').value=Number(o.start.toFixed(2)); $('endTime').value=Number(o.end.toFixed(2));
  $('startTime').max=duration; $('endTime').max=duration;
  document.querySelectorAll('[data-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===o.color)));
}
function render() { drawAnnotations();renderList();renderProperties();updateHistory(); }
function setTool(value) {
  tool=value;canvas.dataset.tool=tool;
  document.querySelectorAll('[data-tool]').forEach(b=>{if(b.tagName==='BUTTON'){b.classList.toggle('selected',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));}});
  $('toolHelp').textContent={select:'选中标注，拖动到合适的位置。',arrow:'在画面上拖动，画出一条路线。',circle:'在画面上拖动，圈出关键球员。',text:'点击画面，为这一刻加一句讲解。'}[value];
}
function commitObject(o) {
  if(objects.length>=100){toast('预览最多保留 100 个标注');return;}
  checkpoint();objects.push(o);selected=o.id;setPanel('properties');setTool('select');render();persist();
}
function newObject(type,extra) {
  return {id:`preview-${++idCounter}`,type,name:type==='circle'?'重点球员':type==='arrow'?'移动路线':'关键时刻',color:type==='arrow'?'#bfe4ff':'#ffffff',width:7,start:Math.min(video.currentTime,Math.max(0,duration-.1)),end:duration,...extra};
}
function addSuggestion(type) {
  const o=type==='focus'?newObject('circle',{x:965,y:710,rx:70,ry:26}):type==='route'?newObject('arrow',{x:750,y:765,x2:1000,y2:580}):newObject('text',{x:170,y:185,name:'留意这一刻的配合'});
  commitObject(o);toast('已加入示例标注，可直接调整');
}
function updateObject(update) {
  const o=objects.find(o=>o.id===selected);if(!o)return;
  checkpoint(); Object.assign(o,update);render();persist();
}
function formatTime(time) { const t=Number.isFinite(time)?Math.max(0,time):0;return `${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(2).padStart(5,'0')}`; }
function updateTime() {
  $('currentTime').value=formatTime(video.currentTime);
  $('scrubber').value=video.currentTime;
  $('playhead').style.left=`${Math.min(100,Math.max(0,video.currentTime/duration*100))}%`;
  if(Math.abs(lastRenderTime-video.currentTime)>.025){drawAnnotations();lastRenderTime=video.currentTime;}
}
function syncPlayback() { $('play').setAttribute('aria-label',video.paused?'播放':'暂停');$('play').querySelector('use').setAttribute('href',video.paused?'#i-play':'#i-pause'); }
function frameLoop(){if(!video.paused){updateTime();requestAnimationFrame(frameLoop);}}
async function togglePlayback(){if(video.paused){if(video.currentTime>=duration-.01)video.currentTime=0;try{await video.play();}catch{toast('视频暂时无法播放，请重新打开素材');}}else video.pause();}
function seek(delta){video.pause();video.currentTime=Math.min(duration,Math.max(0,video.currentTime+delta));updateTime();}
function fitVideo(){const box=$('stageViewport');const ratio=video.videoWidth&&video.videoHeight?video.videoWidth/video.videoHeight:16/9;const width=Math.min(box.clientWidth,box.clientHeight*ratio);$('mediaFrame').style.width=`${width}px`;$('mediaFrame').style.height=`${width/ratio}px`;}
function updateMetadata(){
  duration=Number.isFinite(video.duration)&&video.duration>0?video.duration:sampleDuration;
  $('duration').textContent=formatTime(duration);$('scrubber').max=duration;
  $('timeRuler').replaceChildren();for(let i=0;i<=6;i++){const span=document.createElement('span');span.textContent=`${(duration*i/6).toFixed(1)}s`;$('timeRuler').append(span);}
  const width=video.videoWidth||1920,height=video.videoHeight||1080;
  $('mediaInfo').textContent=`${width} × ${height} · 本地素材`;
  fitVideo();
  if(!initialized){initialized=true;video.currentTime=Math.min(1.3,duration);}
  render();updateTime();
}
function point(event){const rect=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1920,(event.clientX-rect.left)/rect.width*1920)),y:Math.max(0,Math.min(1080,(event.clientY-rect.top)/rect.height*1080))};}
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  const p=point(event);video.pause();
  const hit=event.target.closest('[data-id]');
  if(tool==='select'){
    if(!hit){selected=null;render();return;}
    const o=objects.find(o=>o.id===hit.dataset.id);if(!o)return;
    selectObject(o.id);pointerState={mode:'move',start:p,original:{...o},before:snapshot(),moved:false};
  }else if(tool==='text'){
    const text=$('prompt').value.trim()||'关键时刻';commitObject(newObject('text',{x:Math.min(p.x,1500),y:Math.max(80,p.y),name:text.slice(0,40)}));toast('文字已加入，可在属性中修改');return;
  }else{pointerState={mode:'draw',start:p,type:tool};}
  canvas.setPointerCapture(event.pointerId);event.preventDefault();
});
canvas.addEventListener('pointermove',event=>{
  if(!pointerState)return;const p=point(event),s=pointerState;
  if(s.mode==='move'){
    const o=objects.find(o=>o.id===selected);if(!o)return;
    let dx=p.x-s.start.x,dy=p.y-s.start.y;
    if(Math.abs(dx)+Math.abs(dy)>3)s.moved=true;
    if(o.type==='arrow'){dx=Math.max(-Math.min(s.original.x,s.original.x2),Math.min(1920-Math.max(s.original.x,s.original.x2),dx));dy=Math.max(-Math.min(s.original.y,s.original.y2),Math.min(1080-Math.max(s.original.y,s.original.y2),dy));o.x2=s.original.x2+dx;o.y2=s.original.y2+dy;}
    o.x=Math.max(0,Math.min(1920,s.original.x+dx));o.y=Math.max(0,Math.min(1080,s.original.y+dy));drawAnnotations();
  }else{
    const o=newObject(s.type,s.type==='arrow'?{x:s.start.x,y:s.start.y,x2:p.x,y2:p.y}:{x:(s.start.x+p.x)/2,y:(s.start.y+p.y)/2,rx:Math.abs(p.x-s.start.x)/2,ry:Math.abs(p.y-s.start.y)/2});
    $('drawingLayer').replaceChildren(shape(o));s.object=o;
  }
});
function finishPointer(event,cancel=false){
  if(!pointerState)return;const s=pointerState;pointerState=null;$('drawingLayer').replaceChildren();
  if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  if(s.mode==='move'){
    if(cancel){objects=JSON.parse(s.before);render();return;}
    if(s.moved){undoStack.push(s.before);redoStack=[];render();persist();}
  }else if(!cancel&&s.object){const o=s.object;const size=o.type==='arrow'?Math.hypot(o.x2-o.x,o.y2-o.y):Math.max(o.rx,o.ry);if(size>12)commitObject(o);}
}
canvas.addEventListener('pointerup',e=>finishPointer(e));canvas.addEventListener('pointercancel',e=>finishPointer(e,true));

document.querySelectorAll('button[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
document.querySelectorAll('[data-suggestion]').forEach(b=>b.addEventListener('click',()=>addSuggestion(b.dataset.suggestion)));
$('assistantTab').addEventListener('click',()=>setPanel('assistant'));$('propertiesTab').addEventListener('click',()=>setPanel('properties'));
document.querySelector('.inspector-tabs').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const assistant=$('assistantTab').getAttribute('aria-selected')==='true';setPanel(assistant?'properties':'assistant');$(assistant?'propertiesTab':'assistantTab').focus();}});
$('undo').addEventListener('click',()=>history('undo'));$('redo').addEventListener('click',()=>history('redo'));
$('objectName').addEventListener('change',e=>updateObject({name:e.target.value.trim()||'未命名标注'}));
$('strokeWidth').addEventListener('input',e=>{$('widthValue').value=e.target.value;});
$('strokeWidth').addEventListener('change',e=>updateObject({width:Number(e.target.value)}));
document.querySelectorAll('[data-color]').forEach(b=>b.addEventListener('click',()=>updateObject({color:b.dataset.color})));
function setRange(){const start=Number($('startTime').value),end=Number($('endTime').value);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration+.01||end<=start){toast('请设置有效区间：结束时间需晚于开始时间');renderProperties();return;}updateObject({start,end:Math.min(end,duration)});}
$('startTime').addEventListener('change',setRange);$('endTime').addEventListener('change',setRange);
function deleteSelected(){if(!selected)return;checkpoint();objects=objects.filter(o=>o.id!==selected);selected=null;render();persist();toast('标注已删除，可撤销');}
$('deleteObject').addEventListener('click',deleteSelected);
$('addNote').addEventListener('click',()=>{const name=$('prompt').value.trim();if(!name){$('prompt').focus();toast('先写下一句你的观察');return;}commitObject(newObject('text',{x:160,y:180,name:name.slice(0,40)}));$('prompt').value='';toast('你的文字已加入画面');});
$('addAnnotation').addEventListener('click',()=>{setTool('arrow');toast('在视频上拖动，画出路线');});
$('play').addEventListener('click',togglePlayback);$('backFrame').addEventListener('click',()=>seek(-1/30));$('nextFrame').addEventListener('click',()=>seek(1/30));
$('scrubber').addEventListener('input',e=>{video.pause();video.currentTime=Number(e.target.value);updateTime();});
$('speed').addEventListener('click',()=>{const speeds=[1,.5,.25,1.5];video.playbackRate=speeds[(speeds.indexOf(video.playbackRate)+1)%speeds.length];$('speed').textContent=`${video.playbackRate}×`;});
video.addEventListener('loadedmetadata',updateMetadata);video.addEventListener('timeupdate',updateTime);video.addEventListener('seeked',updateTime);
video.addEventListener('play',()=>{syncPlayback();frameLoop();});video.addEventListener('pause',syncPlayback);video.addEventListener('ended',syncPlayback);
video.addEventListener('error',()=>{toast('示例视频未载入，可点「打开视频」选择本地素材');});
$('toggleAnnotations').addEventListener('click',()=>{annotationsVisible=!annotationsVisible;$('toggleAnnotations').setAttribute('aria-pressed',String(annotationsVisible));$('toggleAnnotations').setAttribute('aria-label',annotationsVisible?'隐藏标注':'显示标注');drawAnnotations();});
$('focusToggle').addEventListener('click',()=>{const on=document.body.classList.toggle('focus-mode');$('focusToggle').setAttribute('aria-pressed',String(on));$('focusToggle').setAttribute('aria-label',on?'退出专注模式':'进入专注模式');fitVideo();});
$('themeToggle').addEventListener('click',()=>{const dark=document.body.dataset.theme!=='dark';document.body.dataset.theme=dark?'dark':'light';$('themeToggle').setAttribute('aria-label',dark?'切换浅色外观':'切换深色外观');try{localStorage.setItem(`${storageKey}:theme`,dark?'dark':'light');}catch{}});

function showDialog(id,trigger){video.pause();openDialog($(id),trigger);}
for(const id of ['openLibrary','importButton'])$(id).addEventListener('click',e=>showDialog('libraryDialog',e.currentTarget));
$('helpButton').addEventListener('click',e=>showDialog('helpDialog',e.currentTarget));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeDialog($(b.dataset.close))));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog(d);}}));
$('chooseFile').addEventListener('click',()=>$('fileInput').click());
$('fileInput').addEventListener('change',()=>{if($('fileInput').files[0])openFile($('fileInput').files[0]);$('fileInput').value='';});
for(const eventName of ['dragenter','dragover'])$('chooseFile').addEventListener(eventName,e=>{e.preventDefault();$('chooseFile').classList.add('dragover');});
for(const eventName of ['dragleave','drop'])$('chooseFile').addEventListener(eventName,e=>{e.preventDefault();$('chooseFile').classList.remove('dragover');});
$('chooseFile').addEventListener('drop',e=>{if(e.dataTransfer.files[0])openFile(e.dataTransfer.files[0]);});
function setSource(src,name,isSample){
  if(isSample && source==='sample'){closeDialog($('libraryDialog'));return;}
  video.pause();source=isSample?'sample':'upload';customName=isSample?'':name;
  video.src=src;video.poster=isSample?'assets/poster.jpg':'';initialized=false;selected=null;
  objects=isSample?initialObjects():[];undoStack=[];redoStack=[];
  if(isSample){try{const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(saved&&validObjects(saved.objects))objects=saved.objects;}catch{}}
  $('projectName').textContent=name;$('clipBadge').textContent=isSample?'005':'本地';
  document.querySelector('.source-label').textContent = isSample ? 'SOURCE / 005' : 'SOURCE / LOCAL';
  document.querySelector('.source-detail').textContent = isSample ? 'SAS × MIA · 本地素材' : '本地素材 · 当前会话';
  document.querySelector('.demo-badge').hidden=!isSample;
  $('frameImages').hidden=!isSample;video.load();render();setPanel('assistant');
  $('saveState').lastChild.textContent=isSample?'示例草稿':'本次会话草稿';closeDialog($('libraryDialog'));
}
function openFile(file){
  if(!file.type.startsWith('video/')&&!/\.(mp4|mov|webm|mkv|avi)$/i.test(file.name)){toast('请选择视频文件');return;}
  if(sourceObjectUrl)URL.revokeObjectURL(sourceObjectUrl);sourceObjectUrl=URL.createObjectURL(file);
  setSource(sourceObjectUrl,file.name,false);toast('视频已在本地打开，没有上传');
}
$('loadSample').addEventListener('click',()=>{if(sourceObjectUrl){URL.revokeObjectURL(sourceObjectUrl);sourceObjectUrl=null;}setSource('demo.mp4','马刺 · 进攻回合',true);toast('示例已打开');});
function renderPreview(){
  const overlay=$('previewOverlay');overlay.replaceChildren();
  const defs=canvas.querySelector('defs').cloneNode(true);defs.querySelector('filter').id='previewShadow';overlay.append(defs);
  objects.filter(o=>$('previewVideo').currentTime>=o.start&&$('previewVideo').currentTime<=o.end).forEach(o=>{
    const group=shape(o);group.querySelectorAll('[filter]').forEach(n=>n.setAttribute('filter','url(#previewShadow)'));overlay.append(group);
  });
}
function openPreview(trigger=$('previewButton')){
  video.pause();$('previewVideo').src=video.currentSrc||video.src;$('previewVideo').poster=video.poster;
  const ratio=(video.videoWidth||1920)/(video.videoHeight||1080);document.querySelector('.preview-media').style.aspectRatio=ratio;
  openDialog($('previewDialog'),trigger);renderPreview();
}
$('previewButton').addEventListener('click',e=>openPreview(e.currentTarget));$('previewVideo').addEventListener('timeupdate',renderPreview);$('previewVideo').addEventListener('loadedmetadata',()=>{$('previewVideo').currentTime=Math.min(video.currentTime,$('previewVideo').duration);renderPreview();});$('previewDialog').addEventListener('close',()=>$('previewVideo').pause());
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{
  const view=b.dataset.view;
  if(view==='film'){openPreview(b);return;}
  if(view==='players'){toast('球员页面将在视觉方向确认后接续设计');return;}
  if(view==='court'){toast('球场映射页面将在视觉方向确认后接续设计');return;}
  setPanel('assistant');
}));
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||document.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();history(e.shiftKey?'redo':'undo');return;}
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.code==='Space'){if(e.target.closest('button,a,[role=tab]'))return;e.preventDefault();togglePlayback();}
  else if(e.key==='ArrowLeft'){e.preventDefault();seek(-1/30);}
  else if(e.key==='ArrowRight'){e.preventDefault();seek(1/30);}
  else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelected();}
  else if(e.key==='Escape'){selected=null;setTool('select');render();}
  else if({v:'select',a:'arrow',o:'circle',t:'text'}[e.key.toLowerCase()])setTool({v:'select',a:'arrow',o:'circle',t:'text'}[e.key.toLowerCase()]);
});
for(let i=1;i<=8;i++){const img=document.createElement('img');img.src=`assets/frame-${String(i).padStart(2,'0')}.jpg`;img.alt='';$('frameImages').append(img);}
new ResizeObserver(fitVideo).observe($('stageViewport'));
render();updateHistory();
if(video.readyState>=1)updateMetadata();
