export function findCombination(catalog,detector,tracker){
  return catalog?.combinations.find(item=>item.detector===detector&&item.tracker===tracker)||null;
}
export function modelResult(catalog,variant){
  return [...(catalog?.combinations||[]),...(catalog?.legacy||[])].find(item=>item.id===variant)||null;
}
export function modelResultLabel(catalog,variant,fallback='历史结果'){
  return modelResult(catalog,variant)?.label||fallback.replace(/THY\s*[·]?\s*/g,'').replace(/\s*·\s*推荐/g,'');
}
export function mountModelSelection({catalog,prefix,variant,onChange=()=>{}}){
  if(!catalog)return null;
  const $=suffix=>document.getElementById(prefix+suffix);
  function read(){return findCombination(catalog,$('Detector').value,$('Tracker').value);}
  function refresh(){
    for(const [name,items] of [['Detector',catalog.detectors],['Tracker',catalog.trackers]]){
      const selected=items.find(item=>item.id===$(name).value);
      $(name+'Recommended').hidden=!selected?.recommended;
      $(name).title=selected?.description||'';
    }
    onChange(read());
  }
  for(const [name,items] of [['Detector',catalog.detectors],['Tracker',catalog.trackers]]){
    $(name).replaceChildren(...items.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.label;return option;}));
    $(name).onchange=refresh;
  }
  function select(id){
    const result=modelResult(catalog,id)||modelResult(catalog,catalog.defaultVariant);
    $('Detector').value=result.detector;$('Tracker').value=result.tracker;refresh();
  }
  select(variant);return {read,select};
}
