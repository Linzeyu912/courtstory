// Presentation only: existing hosts and event handlers remain attached.
export function mountPlayerSingleView(doc=globalThis.document) {
  const panel=doc.getElementById('panel-identity');
  if(!panel||doc.getElementById('playerViewTabs'))return;
  const roster=doc.getElementById('identityRoster');
  doc.getElementById('videoInfo').prepend(roster);
  const tabs=doc.createElement('nav');tabs.id='playerViewTabs';tabs.setAttribute('aria-label','球员编辑工具');
  const views=[['link','关联人物'],['continuation','认回同人'],['names','姓名识别'],['more','更多']];
  function select(view){
    panel.dataset.view=view;
    tabs.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===view)));
    const target={continuation:'identityReferenceTools',names:'playerNamePanel'}[view];
    for(const id of ['identityReferenceTools','playerNamePanel']){
      const details=doc.getElementById(id);if(details&&id!==target)details.open=false;
    }
    if(target&&doc.getElementById(target))doc.getElementById(target).open=true;
    doc.getElementById('identityMain').scrollTop=0;
  }
  for(const [view,label] of views){const button=doc.createElement('button');button.type='button';button.dataset.view=view;button.textContent=label;button.onclick=()=>select(view);tabs.append(button);}
  panel.prepend(tabs);
  // Initial review stays in sight independently of the active editor.
  panel.append(doc.getElementById('identityInitialReview'));
  const main=doc.getElementById('identityMain');
  main.append(doc.querySelector('.model-suggestion-load'),doc.getElementById('identityCoverageTools'));
  main.append(doc.getElementById('sceneObjectPanel'),doc.querySelector('.foot-candidates'));
  const progress=doc.getElementById('identityProgress');
  const continuation=panel.querySelector('.identity-continue');
  main.append(progress,continuation);
  panel.addEventListener('toggle',event=>{
    if(!event.target.open)return;
    const view={identityReferenceTools:'continuation',identityRangeTools:'more',playerNamePanel:'names',sceneObjectPanel:'more'}[event.target.id];
    if(view&&panel.dataset.view!==view)select(view);
  },true);
  doc.getElementById('openIdentityProfile').addEventListener('click',()=>select('names'));
  doc.getElementById('openIdentityContinuation').addEventListener('click',()=>select('continuation'));
  // A shortcut can open an already-open details; capture its intent as well.
  panel.addEventListener('click',event=>{
    const label=event.target.closest?.('button')?.textContent;
    if(label==='Agent 查找同一球员')select('continuation');
    if(label==='更多范围 / 位置工具')select('more');
    if(label==='直接人工修改')select('link');
  });
  select('link');
}
