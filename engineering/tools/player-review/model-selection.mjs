export function findCombination(catalog,detector,tracker){
  return catalog?.combinations.find(item=>item.detector===detector&&item.tracker===tracker)||null;
}
export function modelResult(catalog,variant){
  return [...(catalog?.combinations||[]),...(catalog?.legacy||[])].find(item=>item.id===variant)||null;
}
export function modelResultLabel(catalog,variant,fallback='历史结果'){
  return modelResult(catalog,variant)?.label||fallback.replace(/THY\s*[·]?\s*/g,'').replace(/\s*·\s*推荐/g,'');
}

// Keep the native value as the existing processing contract; render option badges
// in an accessible listbox because native option styling differs across browsers.
function mountChoiceList(select,items,onChange){
  const host=select.parentElement;
  const trigger=document.createElement('button');
  trigger.type='button';trigger.className='model-choice-trigger';
  trigger.setAttribute('role','combobox');
  trigger.setAttribute('aria-label',select.getAttribute('aria-label'));
  trigger.setAttribute('aria-haspopup','listbox');
  trigger.setAttribute('aria-expanded','false');
  const list=document.createElement('div');
  list.id=select.id+'Options';list.className='model-choice-list';list.hidden=true;
  list.setAttribute('role','listbox');list.setAttribute('aria-label',select.getAttribute('aria-label')+'选项');
  trigger.setAttribute('aria-controls',list.id);
  let active=0;
  const options=items.map((item,index)=>{
    const option=document.createElement('div');
    option.id=list.id+'-'+index;option.className='model-choice-option';
    option.setAttribute('role','option');option.title=item.description||'';
    const label=document.createElement('span');label.textContent=item.label;option.append(label);
    if(item.recommended){
      const badge=document.createElement('span');badge.className='recommended-mark';badge.textContent='推荐';option.append(badge);
    }
    option.addEventListener('click',()=>choose(index));
    list.append(option);return option;
  });
  host.append(trigger,list);select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  function highlight(index){
    active=index;options.forEach((option,i)=>option.classList.toggle('active',i===index));
    trigger.setAttribute('aria-activedescendant',options[index].id);
  }
  function close(){
    list.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');
  }
  function open(){
    list.hidden=false;trigger.setAttribute('aria-expanded','true');
    highlight(Math.max(0,items.findIndex(item=>item.id===select.value)));
  }
  function choose(index){
    select.value=items[index].id;close();onChange();trigger.focus();
  }
  trigger.addEventListener('click',()=>list.hidden?open():close());
  trigger.addEventListener('keydown',event=>{
    if(event.key==='Tab'){close();return;}
    if(event.key==='Escape'){if(!list.hidden){event.preventDefault();event.stopPropagation();close();}return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();
      if(list.hidden){open();if(event.key==='Home')highlight(0);if(event.key==='End')highlight(items.length-1);}
      else highlight(event.key==='Home'?0:event.key==='End'?items.length-1:(active+(event.key==='ArrowUp'?-1:1)+items.length)%items.length);
    }else if(event.key==='Enter'||event.key===' '){
      event.preventDefault();if(list.hidden)open();else choose(active);
    }
  });
  document.addEventListener('pointerdown',event=>{if(!host.contains(event.target))close();});
  document.addEventListener('focusin',event=>{if(!host.contains(event.target))close();});
  return {refresh(){
    const selected=items.find(item=>item.id===select.value);
    trigger.textContent=selected?.label||'';trigger.title=selected?.description||'';
    options.forEach((option,index)=>option.setAttribute('aria-selected',String(items[index].id===select.value)));
    close();
  }};
}
export function mountModelSelection({catalog,prefix,variant,onChange=()=>{}}){
  if(!catalog)return null;
  const $=suffix=>document.getElementById(prefix+suffix);
  const lists=[];
  function read(){return findCombination(catalog,$('Detector').value,$('Tracker').value);}
  function refresh(){
    for(const [name,items] of [['Detector',catalog.detectors],['Tracker',catalog.trackers]]){
      const selected=items.find(item=>item.id===$(name).value);
      $(name).title=selected?.description||'';
    }
    lists.forEach(list=>list.refresh());
    onChange(read());
  }
  for(const [name,items] of [['Detector',catalog.detectors],['Tracker',catalog.trackers]]){
    $(name).replaceChildren(...items.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.label;return option;}));
    $(name).onchange=refresh;
    lists.push(mountChoiceList($(name),items,refresh));
  }
  function select(id){
    const result=modelResult(catalog,id)||modelResult(catalog,catalog.defaultVariant);
    $('Detector').value=result.detector;$('Tracker').value=result.tracker;refresh();
  }
  select(variant);return {read,select};
}
