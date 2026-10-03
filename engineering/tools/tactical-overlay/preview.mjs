import {renderOverlaySvg} from './render-svg.mjs';
import {createHash} from 'node:crypto';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeJSON=value=>JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);

/** Builds one offline document; every selectable item contains its own complete bound scene. */
export function buildPreviewHtml({title='战术轨迹 · 静态核对',scenes}={}) {
  if(!Array.isArray(scenes)||!scenes.length)throw new TypeError('at least one scene required');
  const phaseIds=new Set();
  const bundled=scenes.map(scene=>{
    const m=scene.manifest,b=scene.background??null;
    if(!m||m.schemaVersion!==1||m.status==='refused')throw new Error('refused or missing manifest cannot become a preview scene');
    if(phaseIds.has(m.phaseId))throw new Error('duplicate phase scene');phaseIds.add(m.phaseId);
    if(!['video','court'].includes(scene.mode))throw new Error('scene mode required');
    if(scene.mode==='video'){
      if(!m.videoOverlay?.available||!b)throw new Error('video background/geometry unavailable');
      if(b.frame!==m.freezeFrame||b.time!==m.time||b.videoSha256!==m.sourceBinding?.videoSha256)throw new Error('background frame/time/video binding mismatch');
      if(b.sourceFrame!==m.sourceFrame||b.sourceTime!==m.sourceTime)throw new Error('background source frame/time mismatch');
      if(!/^[a-f0-9]{64}$/i.test(b.sha256??'')||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(b.dataUrl??''))throw new Error('verified JPEG background required');
      const bytes=Buffer.from(b.dataUrl.split(',')[1],'base64');
      if(createHash('sha256').update(bytes).digest('hex')!==b.sha256.toLowerCase())throw new Error('background JPEG sha256 hash mismatch');
      if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new Error('background is not JPEG bytes');
      if(!b.sourceBinding||Object.keys(m.sourceBinding).some(key=>b.sourceBinding[key]!==m.sourceBinding[key]))throw new Error('background source binding mismatch');
    }else if(b!==null)throw new Error('court scene cannot carry a misleading video background');
    // Re-render from the manifest, never accept a caller's unrelated pre-rendered SVG.
    const svg=renderOverlaySvg(m,{mode:scene.mode,viewport:{width:1280,height:720}});
    return {title:scene.title??m.phaseId,mode:scene.mode,manifest:m,background:b,svg};
  });
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#07141e;color:#e8f0f5;font-family:system-ui,"Microsoft YaHei",sans-serif}main{max-width:1560px;margin:auto;padding:26px}h1{font-size:26px;margin:0 0 8px}p{line-height:1.6;margin:8px 0}.intro{color:#b1c4d1;font-size:14px}.buttons{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 18px}.buttons button{background:#142c3d;color:#dcebf4;border:1px solid #33566d;border-radius:8px;padding:12px 18px;font:inherit;font-weight:650;cursor:pointer}.buttons button[aria-pressed="true"]{background:#2b8198;border-color:#72dbee;color:#fff}.buttons button:focus-visible{outline:3px solid #ffd45a;outline-offset:3px}.heading{display:flex;align-items:baseline;justify-content:space-between;gap:20px;margin:10px 0}.heading h2{font-size:21px;margin:0}.time{color:#b1c4d1;font-variant-numeric:tabular-nums;font-size:14px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:18px;align-items:start}.layout>section{min-width:0}.stage{position:relative;width:100%;background:#10202a;border:1px solid #34556a;border-radius:10px;overflow:auto}.scene-canvas{position:relative;flex:none}.stage img,.overlay{position:absolute;inset:0;width:100%;height:100%}.stage img{object-fit:contain}.overlay{pointer-events:none}.overlay svg{display:block;width:100%;height:100%}.panel{background:#102536;border:1px solid #2d485a;border-radius:10px;padding:16px}.panel h3{font-size:16px;margin:0 0 14px}.participants{list-style:none;padding:0;margin:0;display:grid;gap:10px}.participants li{font-size:13px;border-left:4px solid #5ecbdc;padding-left:10px;line-height:1.6;white-space:pre-line}.legend{display:flex;flex-wrap:wrap;gap:20px;color:#c4d5de;font-size:13px;margin:16px 0}.legend span{display:inline-flex;gap:8px;align-items:center}.sample{display:inline-block;width:35px;border-top:4px solid #59dfff}.sample.pending{border-top-style:dashed}.sample.completed{opacity:.3}.quality{border-left:4px solid #f6c26a;background:#2b2920;padding:12px 16px;margin-top:14px;color:#ffe4ab;line-height:1.65;white-space:pre-line}.issues{font-size:14px;line-height:1.8;padding-left:24px;overflow-wrap:anywhere}.issues li{margin:5px 0}details{margin-top:20px;border-top:1px solid #294656;padding-top:15px}summary{cursor:pointer;color:#b1c4d1}pre{font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:#9fbacb}noscript{display:block;color:#ffe4ab;padding:20px}@media(max-width:1150px){.layout{grid-template-columns:minmax(0,1fr)}.participants{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:700px){main{padding:14px}.heading{display:block}.participants{grid-template-columns:repeat(2,minmax(0,1fr))}.buttons button{padding:10px}.heading h2{font-size:18px}}
</style></head><body><main><h1>${escape(title)}</h1><p class="intro">冻结帧静态核对：按阶段切换完整场景。实线表示完整当前动作，虚线表示真实后续观测，淡化表示已完成动作。质量提醒单独列出。</p>
<nav id="stage-buttons" class="buttons" aria-label="阶段选择"></nav><div class="heading"><h2 id="stage-title"></h2><span id="stage-time" class="time"></span></div>
<div class="layout"><section><div id="stage" class="stage" aria-label="战术冻结帧"></div><p id="stage-notice" class="intro" role="status"></p><div class="legend"><span><i class="sample"></i>当前动作（完整范围）</span><span><i class="sample pending"></i>真实后续路线</span><span><i class="sample completed"></i>已完成</span><span>圆点：冻结帧位置 · 横杠：有朝向证据的掩护</span></div></section><aside class="panel"><h3>全部参与者与角色</h3><ul id="participants" class="participants"></ul></aside></div>
<div id="quality-note" class="quality" role="status"></div><section><h3>关系、质量与观测缺口</h3><ul id="issue-list" class="issues"></ul></section>
<details><summary>来源、逐点证据与 manifest</summary><pre id="source-details"></pre></details><noscript>请启用 JavaScript 查看内嵌静态场景；本报告不会联网加载视频。</noscript></main>
<script id="scene-data" type="application/json">${safeJSON(bundled)}</script>
<script>
const renderOverlaySvg = ${renderOverlaySvg.toString()};
const scenes=JSON.parse(document.getElementById('scene-data').textContent);
const stage=document.getElementById('stage'),buttons=document.getElementById('stage-buttons');
const labels={hold:'原地保持',space:'拉开空间',screen:'掩护',move:'移动',cut:'切入',roll:'顺下',pop:'外弹',offense:'进攻',defender:'防守',active:'进行中',pending:'后续',completed:'已完成',visible:'当前帧可见',missing:'当前位置缺失',offscreen:'画面外',ready:'可绘制',warning:'待人工复核',unavailable:'不可用',partial:'部分可用',ok:'来源与规则校验通过',reviewed:'已复核',needs_review:'待人工复核',invalid:'无效',not_applicable:'不适用'};
const domains={identity:'身份',position:'接地/位置',calibration:'标定',tactic:'战术关系'};
let selected=0;
function listItem(text){const item=document.createElement('li');item.textContent=text;return item;}
function redraw(){
  const scene=scenes[selected],width=stage.clientWidth,notice=document.getElementById('stage-notice');
  if(width<=0)return;
  let svg=null,canvasWidth=width,error=null;
  // Layout capacity never leaves a stale SVG scaled to a different CSS width. Retry on a larger
  // explicitly scrollable canvas; 1280 is already validated when the document is built.
  for(const candidate of [width,...[640,960,1280].filter(value=>value>width)]){
    try{svg=renderOverlaySvg(scene.manifest,{mode:scene.mode,viewport:{width:candidate,height:candidate*9/16}});canvasWidth=candidate;break;}
    catch(cause){error=cause;if(!(cause instanceof RangeError))break;}
  }
  if(svg===null){stage.replaceChildren();notice.textContent='当前场景无法绘制：'+(error?.message??'未知错误');return;}
  const canvas=document.createElement('div');canvas.setAttribute('class','scene-canvas');
  canvas.style.width=canvasWidth+'px';canvas.style.height=(canvasWidth*9/16)+'px';
  const overlay=document.createElement('div');overlay.setAttribute('class','overlay');
  overlay.innerHTML=svg;
  if(scene.mode==='video'){
    const image=document.createElement('img');image.src=scene.background.dataUrl;image.alt='已绑定 JPEG · 冻结帧 '+scene.background.frame;
    canvas.replaceChildren(image,overlay);
  }else canvas.replaceChildren(overlay);
  stage.replaceChildren(canvas);stage.setAttribute('tabindex',canvasWidth>width?'0':'-1');
  notice.textContent=canvasWidth>width?'当前窗口较窄，画布已展开；请横向滚动查看全部标记。':'';
}
function showScene(index){
  selected=index;const scene=scenes[index],m=scene.manifest;
  // Clear the entire previous scene before publishing the new manifest/background pair.
  stage.replaceChildren();redraw();
  buttons.children&&Array.from(buttons.children).forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  document.getElementById('stage-title').textContent=scene.title;
  document.getElementById('stage-time').textContent='冻结帧 '+m.freezeFrame+' · '+m.time.toFixed(3)+' 秒 · 来源帧 '+m.sourceFrame+' / '+m.sourceTime.toFixed(3)+' 秒';
  const roster=document.getElementById('participants');roster.replaceChildren();
  const palette=['#59dfff','#ffd45a','#ff8ec7','#9feb78','#c7a4ff','#ff9b60','#f5f5f5','#77e0c5'];
  m.roster.forEach((p,i)=>{
    const states=(p.actionStates??[]).map(a=>(labels[a.kind]??a.kind)+'：'+(labels[a.temporalStatus]??a.temporalStatus));
    const relations=(p.relationStates??[]).map(r=>{
      const role=r.role==='screener'?'掩护者 → '+r.beneficiaryId:r.role==='beneficiary'?'受掩护者 ← '+r.screenerId:'相关防守者 · '+r.screenerId+' → '+r.beneficiaryId;
      return role+'（'+(labels[r.temporalStatus]??r.temporalStatus)+'）';
    });
    const quality=Object.entries(p.quality??{}).filter(([,q])=>!['reviewed','not_applicable'].includes(q.state)).map(([d,q])=>(domains[d]??d)+' '+(labels[q.state]??q.state));
    const item=listItem(p.id+' '+(p.name??'')+'\\n'+(p.roles??[]).map(r=>labels[r]??r).join('、')+' · '+(labels[p.positionState]??p.positionState)+(states.length?'\\n'+states.join('；'):'')+(relations.length?'\\n'+relations.join('；'):'')+(quality.length?'\\n'+quality.join('；'):''));
    item.style.borderLeftColor=palette[i%palette.length];roster.append(item);
  });
  const issues=m.issues??[],quality=document.getElementById('quality-note');
  const kind=m.synthetic?'合成规则演示（人工构造观测，用于验证规则）':scene.mode==='video'?'真实候选 · 精确冻结 JPEG':'真实候选 · 仅 2D（未提供精确冻结图或视频投影不可用）';
  quality.textContent=kind+'\\n整体：'+(labels[m.status]??m.status)+' · '+issues.length+' 项质量提醒/观测缺口。'+(issues.length?'身份、接地、标定与战术关系仍以各自证据为准。':'规则校验通过不等于真实战术和身份验收。');
  const list=document.getElementById('issue-list');list.replaceChildren();
  for(const r of m.relations??[]){
    const orientation=r.bar?'朝向已提供，横杠为显示约定':!r.orientation?'缺少朝向：仅列出参与关系，未绘制掩护横杠':'方向/位置或质量不可用，未绘制掩护横杠';
    const quality=Object.entries(r.quality??{}).map(([d,q])=>(domains[d]??d)+' '+(labels[q.state]??q.state)).join('；');
    list.append(listItem('掩护关系 '+(r.relationId??r.id)+'：'+r.screenerId+' 掩护 → '+r.beneficiaryId+' 受益'+(r.defenderId?' · 直接相关防守者 '+r.defenderId:'')+'；'+orientation+'；'+quality));
  }
  for(const issue of issues){const ids=[issue.entityId,issue.actionId,issue.relationId].filter(Boolean).join(' / '),range=issue.range?' ['+issue.range.startFrame+','+issue.range.endFrameExclusive+')':'';
    list.append(listItem((ids?ids+' · ':'')+issue.code+range+(issue.details?' · '+JSON.stringify(issue.details):'')));
  }
  if(!issues.length&&!m.relations?.length)list.append(listItem('本阶段没有引擎报告的质量缺口；真实素材仍需人工核对。'));
  document.getElementById('source-details').textContent=JSON.stringify({mode:scene.mode,background:scene.background?{...scene.background,dataUrl:'[内嵌 JPEG 字节]'}:null,manifest:m},null,2);
}
scenes.forEach((scene,index)=>{const button=document.createElement('button');button.type='button';button.textContent=(index+1)+' · '+scene.title;button.addEventListener('click',()=>showScene(index));buttons.append(button);});
showScene(0);new ResizeObserver(()=>redraw()).observe(stage);
</script></body></html>`;
}
