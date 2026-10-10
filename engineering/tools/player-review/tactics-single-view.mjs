// Reparent existing controls only: all editor state, IDs and API handlers stay owned
// by their original modules. Small screens retain the normal document flow.
export function mountTacticsSingleView(root, api) {
  if (!root.ownerDocument) return null;
  root.classList.add('tactics-single-view');
  const q = selector => root.querySelector(selector);
  const visual = q('#studioVisualPanel'), layout = q('.tactics-layout');
  const side = document.createElement('div'); side.className = 'tactics-single-side';
  const properties = q('.tactics-controls');
  layout.append(side); side.append(properties);
  const dock = document.createElement('div'); dock.id = 'tacticsAgentDock';
  side.append(dock); dock.append(q('#tacticsAgentPanel'));
  const agent = q('#tacticsAgentPanel'), inputs = q('.tactics-agent-inputs');
  const settings = document.createElement('details'); settings.className = 'single-view-popover';
  const summary = document.createElement('summary'); summary.textContent = '模型与分析范围'; settings.append(summary);
  for (const id of ['tacticsAgentBackend','tacticsDrawingModel','tacticsAgentScope']) settings.append(q('#'+id).closest('label'));
  inputs.prepend(settings);
  const info = agent.querySelector(':scope > p');
  if (info) settings.append(info);
  const review = document.createElement('details'); review.className = 'single-view-popover tactics-candidate-review';
  const reviewTitle = document.createElement('summary'); reviewTitle.textContent = '核对候选与生成进度'; review.append(reviewTitle);
  for (const id of ['tacticsAgentStages','tacticsAgentPending','tacticsAgentAuditIssues','tacticsAgentRetained','tacticsAgentPreview']) review.append(q('#'+id));
  agent.append(review);
  const secondary = q('.tactics-secondary');
  properties.append(q('.tactics-coordinate-settings'), secondary);
  const production = q('.tactics-production-panel');
  production.classList.add('single-view-production');
  properties.append(production);
  const close = document.createElement('button'); close.type='button'; close.textContent='返回画布'; close.className='single-view-production-close';
  close.onclick=()=>{production.open=false;}; production.append(close);
  production.addEventListener('toggle',()=>{if(production.open)api.pause();});
  properties.prepend(q('#tacticsSelectionActions'));
  for (const details of properties.querySelectorAll('.tactics-secondary>details,.tactics-coordinate-settings,.tactics-person-settings,#tacticsRhythm,#tacticsTangentSettings,#tacticsAuthoredFields,#tacticsArchive')) details.classList.add('single-view-popover');
  const propertyTabs=document.createElement('nav');propertyTabs.className='single-view-property-tabs';
  const listPanel=document.createElement('section');listPanel.className='single-view-object-list';
  for(const node of [q('.tactics-object-heading'),q('#tacticsObjectList'),q('#tacticsObjectEmpty'),q('#tacticsArchive')])listPanel.append(node);
  const settingsPanel=document.createElement('section');settingsPanel.append(q('.tactics-coordinate-settings'),secondary,production);
  const propertyPanel=document.createElement('section');propertyPanel.className='single-view-properties';
  propertyPanel.append(...properties.children);properties.append(propertyTabs,propertyPanel,listPanel,settingsPanel);
  const panels=[propertyPanel,listPanel,settingsPanel];
  ['图形属性','标注列表','更多设置'].forEach((label,index)=>{const button=document.createElement('button');button.type='button';button.textContent=label;propertyTabs.append(button);button.onclick=()=>{panels.forEach((panel,i)=>{panel.hidden=i!==index;propertyTabs.children[i].setAttribute('aria-pressed',String(i===index));});};});
  for(const details of settingsPanel.querySelectorAll('details'))details.addEventListener('toggle',()=>{if(details.open)propertyTabs.children[2].click();});
  propertyTabs.firstElementChild.click();
  q('#tacticsObjectList').addEventListener('click',()=>propertyTabs.firstElementChild.click());
  paginateSingleView(q('#tacticsObjectList'),5);
  const toolbar=q('.tactics-author-tools');
  toolbar.append(q('#tacticsDrawingRange'),q('#tacticsFinishDrawing'),q('#tacticsCancelDrawing'));
  q('.tactics-transport').append(q('.tactics-seek'));
  const toolHint=q('#tacticsToolHint');new MutationObserver(()=>{toolbar.title=toolHint.textContent;}).observe(toolHint,{childList:true,characterData:true,subtree:true});
  const transport=q('.tactics-transport .tactics-buttons');
  for (const [id,text,delta] of [['tacticsPreviousFrame','上一帧',-1],['tacticsNextFrame','下一帧',1]]) {
    const button=document.createElement('button');button.id=id;button.textContent=text;button.type='button';
    button.onclick=()=>{api.pause();api.step(delta);};transport.append(button);
  }
  visual.classList.add('tactics-single-visual');
  return { dock };
}

export function compactTacticsTimeline(root, timeline) {
  if (!root?.ownerDocument || root.dataset.compact) return;
  root.dataset.compact='true';
  const advanced=document.createElement('details');advanced.className='single-view-popover tactics-timeline-settings';
  const summary=document.createElement('summary');summary.textContent='区间与暂停点设置';advanced.append(summary);
  for (const selector of ['.tactics-range-bar','[data-range-label]','.tactics-keyframe-heading','[data-cue-context]','[data-cue-editor]']) {
    const node=root.querySelector(selector);if(node)advanced.append(node);
  }
  root.prepend(advanced);
  if(timeline?.focusRange){const focus=timeline.focusRange;timeline.focusRange=()=>{advanced.open=true;focus();};}
  paginateSingleView(root.querySelector('[data-rows]'),3);
  const cueEditor=root.querySelector('[data-cue-editor]');
  new MutationObserver(()=>{if(!cueEditor.hidden)advanced.open=true;}).observe(cueEditor,{attributes:true,attributeFilter:['hidden']});
}
export function mountCommentarySingleView({root,body,columns,mediaColumn,sourceBox,sourceVideo,resultBox,resultVideo,actions,modelLine,intro,workflow,status,progress,summaryLabel,candidateBox,cueList,clip,pause,seek}) {
  if (!root.ownerDocument) return null;
  root.classList.add('commentary-single-view');
  root.append(body);root.querySelector('.commentary-details').hidden=true;
  const side=document.createElement('aside');side.className='commentary-single-side';
  const editor=document.createElement('section');editor.className='commentary-single-editor';
  const dock=document.createElement('section');dock.className='commentary-single-agent';
  const title=document.createElement('strong');title.textContent='AGENT · 解说与配音';dock.append(title);
  columns.append(side);side.append(editor,dock);editor.append(cueList);
  const more=document.createElement('details');more.className='single-view-popover';
  const heading=document.createElement('summary');heading.textContent='梗概、服务与流程';more.append(heading,intro,modelLine,summaryLabel,workflow);
  dock.append(more,actions,status,progress,candidateBox);
  const nav=document.createElement('nav');nav.className='commentary-cue-pagination';nav.setAttribute('aria-label','逐句核对');
  const previous=document.createElement('button'),next=document.createElement('button'),counter=document.createElement('span');
  previous.textContent='上一句';next.textContent='下一句';nav.append(previous,counter,next);editor.prepend(nav);
  let index=0;
  const show=()=>{const cards=[...cueList.children];index=Math.max(0,Math.min(index,cards.length-1));cards.forEach((card,i)=>{card.hidden=i!==index;});counter.textContent=cards.length?`${index+1} / ${cards.length}`:'尚无解说';previous.disabled=index===0;next.disabled=index>=cards.length-1;};
  previous.onclick=()=>{index--;show();};next.onclick=()=>{index++;show();};
  new MutationObserver(show).observe(cueList,{childList:true});show();
  const mediaTabs=document.createElement('div');mediaTabs.className='commentary-media-tabs';
  const sourceButton=document.createElement('button'),outputButton=document.createElement('button');sourceButton.textContent='原片对照';outputButton.textContent='成片预览';outputButton.disabled=true;
  mediaTabs.append(sourceButton,outputButton);mediaColumn.prepend(mediaTabs);
  const select=output=>{sourceVideo.pause();resultVideo.pause();sourceBox.hidden=output;resultBox.hidden=!output;sourceButton.setAttribute('aria-pressed',String(!output));outputButton.setAttribute('aria-pressed',String(output));};
  sourceButton.onclick=()=>select(false);outputButton.onclick=()=>select(true);
  const resultObserver=new MutationObserver(()=>{const ready=!!resultVideo.getAttribute('src');outputButton.disabled=!ready;if(!ready){sourceBox.hidden=false;return;}if(!resultBox.hidden)sourceBox.hidden=true;});
  resultObserver.observe(resultBox,{attributes:true,attributeFilter:['hidden']});resultObserver.observe(resultVideo,{attributes:true,attributeFilter:['src']});
  const transport=document.createElement('div');transport.className='commentary-source-transport';sourceBox.append(transport);
  const frameLabel=document.createElement('output'),scrub=document.createElement('input');scrub.type='range';scrub.min=0;scrub.max=Math.max(0,(clip?.frames?.length??1)-1);scrub.step=1;scrub.value=0;scrub.setAttribute('aria-label','解说原片逐帧定位');
  const frames=clip?.frames??[];
  const frameAt=()=>frames.reduce((best,frame,i)=>Math.abs(frame.time-sourceVideo.currentTime)<Math.abs(frames[best].time-sourceVideo.currentTime)?i:best,0);
  const locate=frame=>{if(!frames.length)return;pause();sourceVideo.pause();const i=Math.max(0,Math.min(frames.length-1,frame));sourceVideo.currentTime=frames[i].time;seek(i);update();};
  const update=()=>{const frame=frames.length?frameAt():0;scrub.value=frame;frameLabel.textContent=`${Number(sourceVideo.currentTime||0).toFixed(2)} 秒 · ${frame+1} / ${frames.length||'—'} 帧`;};
  for(const [label,delta] of [['上一帧',-1],['下一帧',1]]){const button=document.createElement('button');button.textContent=label;button.disabled=!frames.length;button.onclick=()=>locate(frameAt()+delta);transport.append(button);}
  transport.append(frameLabel,scrub);scrub.disabled=!frames.length;scrub.oninput=()=>locate(Number(scrub.value));sourceVideo.addEventListener('timeupdate',update);update();
  return {selectSource:()=>select(false)};
}
export function paginateSingleView(container, pageSize=3) {
  if (!container?.ownerDocument || container.dataset.paged) return;
  container.dataset.paged='true';
  const nav=document.createElement('nav');nav.className='single-view-pagination';
  nav.setAttribute('aria-label','切换列表页');
  const previous=document.createElement('button'),counter=document.createElement('span'),next=document.createElement('button');
  previous.type=next.type='button';previous.textContent='上一页';next.textContent='下一页';nav.append(previous,counter,next);container.after(nav);
  let page=0;
  const update=(followSelection=false)=>{
    const rows=[...container.children],count=Math.max(1,Math.ceil(rows.length/pageSize));
    if(followSelection){const selected=rows.findIndex(row=>row.getAttribute('aria-pressed')==='true'||row.querySelector('[aria-pressed="true"]'));if(selected>=0)page=Math.floor(selected/pageSize);}
    page=Math.max(0,Math.min(page,count-1));rows.forEach((row,index)=>{row.hidden=index<page*pageSize||index>=(page+1)*pageSize;});
    counter.textContent=`${page+1} / ${count}`;previous.disabled=page===0;next.disabled=page===count-1;nav.hidden=rows.length<=pageSize;
  };
  previous.onclick=()=>{page--;update();};next.onclick=()=>{page++;update();};
  new MutationObserver(()=>update(true)).observe(container,{childList:true});update(true);
}
