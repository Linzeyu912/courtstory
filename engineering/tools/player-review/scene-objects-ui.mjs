import {OBJECT_NAMES,sceneObjectsAt,updateSceneObject} from './scene-objects.mjs';

export function mountSceneObjects(api){
  const $=id=>document.getElementById(id);let selected=null,lastFrame=-1,picking=null;
  const current=()=>{const s=api.state();return {...s,objects:sceneObjectsAt(s.session,api.clip.frames[s.frame],s.frame,{includeExcluded:true})};};
  function select(id){selected=id;picking=null;api.state().video.pause();api.redraw();}
  function commit(edit){const s=current(),object=s.objects.find(o=>o.id===selected);if(!object)return;try{api.change(()=>updateSceneObject(s.session,s.frame,object,edit,api.clip.width,api.clip.height));api.toast('当前帧对象已修改，可撤销。');}catch(error){api.toast(error.message);}}
  $('objectSavePoint').onclick=()=>commit({point:[Number($('objectX').value),Number($('objectY').value)]});
  $('objectSaveBox').onclick=()=>commit({box:['objectX1','objectY1','objectX2','objectY2'].map(id=>Number($(id).value))});
  $('objectExclude').onclick=()=>commit({action:'exclude'});
  $('objectRestore').onclick=()=>{const s=current();api.change(()=>s.session.sceneObjectEdits=(s.session.sceneObjectEdits||[]).filter(e=>e.frame!==s.frame||e.id!==selected));};
  $('objectPickPoint').onclick=()=>{picking={frame:api.state().frame,id:selected};api.state().video.pause();$('objectPickHelp').textContent='在原视频点击这个对象的图像位置；只修改当前帧。';};
  for(const kind of ['basketball','hoop'])$(`add-${kind}`).onclick=()=>{const s=current();picking={frame:s.frame,kind};s.video.pause();$('objectPickHelp').textContent=`请在原视频点击${OBJECT_NAMES[kind]}中心，补一个当前帧标记。`;};
  $('objectCancelPick').onclick=()=>{picking=null;$('objectPickHelp').textContent='已取消点选。';};
  function render(){
    const s=current();if(lastFrame!==s.frame){selected=null;picking=null;lastFrame=s.frame;}
    $('sceneObjectList').replaceChildren();
    for(const kind of ['basketball','hoop']){
      const group=document.createElement('div'),heading=document.createElement('h3');heading.textContent=`${OBJECT_NAMES[kind]} · 当前帧 ${s.objects.filter(o=>o.kind===kind&&!o.excluded).length}`;group.append(heading);
      for(const object of s.objects.filter(o=>o.kind===kind)){
        const button=document.createElement('button');button.className='scene-object'+(object.id===selected?' selected':'');button.setAttribute('aria-pressed',String(object.id===selected));
        button.textContent=`${OBJECT_NAMES[kind]} ${object.id.startsWith('manual:')?'人工补点':`候选 ${Number(object.id.split(':')[1])+1}`} · ${object.excluded?'已排除':object.source==='human'?'人工修正':`${Math.round((object.score||0)*100)}%`} · (${object.point.map(v=>v.toFixed(0)).join(', ')}) px`;
        button.onclick=()=>select(object.id);group.append(button);
      }
      if(!s.objects.some(o=>o.kind===kind)){const text=document.createElement('p');text.className='small muted';text.textContent='当前帧未检出，可人工补点。';group.append(text);}$('sceneObjectList').append(group);
    }
    const object=s.objects.find(o=>o.id===selected);$('sceneObjectEditor').hidden=!object;
    if(object){$('objectSelection').textContent=`${OBJECT_NAMES[object.kind]} · 第 ${s.frame+1} 帧 · ${object.excluded?'已排除':object.source==='human'?'人工修正':'模型候选'}`;
      for(const [i,id] of ['objectX','objectY'].entries())if(document.activeElement!==$(id))$(id).value=object.point[i].toFixed(1);
      for(const [i,id] of ['objectX1','objectY1','objectX2','objectY2'].entries())if(document.activeElement!==$(id))$(id).value=object.box?.[i]?.toFixed(1)||'';
      $('objectExclude').disabled=object.excluded;$('objectRestore').disabled=!(s.session.sceneObjectEdits||[]).some(e=>e.frame===s.frame&&e.id===selected);
    }
    $('objectPickHelp').textContent=picking?`等待在原图点选${OBJECT_NAMES[picking.kind||object?.kind]||'对象'}，只影响当前帧。`:'选择列表中的对象可高亮、修正坐标或排除误检。';
  }
  return {render,selected:()=>selected,isPicking:()=>Boolean(picking),objects:()=>sceneObjectsAt(api.state().session,api.clip.frames[api.state().frame],api.state().frame),
    handleImageClick(x,y){if(!picking)return false;const s=current();if(s.frame!==picking.frame){picking=null;return true;}const object=picking.id?s.objects.find(o=>o.id===picking.id):{id:`manual:${Date.now()}`,kind:picking.kind,box:null,point:[x,y]};if(!object){picking=null;return true;}selected=object.id;picking=null;api.change(()=>updateSceneObject(s.session,s.frame,object,{point:[x,y]},api.clip.width,api.clip.height));api.toast('对象图像点已保存，可撤销；它不是地面点。');return true;}};
}
