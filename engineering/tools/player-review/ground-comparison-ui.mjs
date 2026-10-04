import {selectGroundComparison} from './ground-position.mjs';

export function mountGroundComparison(api){
  const host=document.getElementById('groundComparisonPanel');if(!host)return {render(){}};
  const title=document.createElement('strong');title.textContent='人物框与脚部位置对照';
  const text=document.createElement('p');text.className='small muted';text.textContent='2D 位置与视频人物尾迹共用脚下点。人工位置优先；默认采用可靠双踝中点，缺失时用人物框底边中点。所选对比候选缺失时回到原位置并标记。原始数据保留。';
  const select=document.createElement('select');select.setAttribute('aria-label','2D 地面位置来源');
  const baseline=document.createElement('option');baseline.value='';baseline.textContent='人工位置 / 双踝中点 / YOLOv8n 框底中点';select.append(baseline);
  const status=document.createElement('p');status.className='small muted';
  const load=document.createElement('button');load.textContent='载入已完成的模型对比';
  host.append(title,text,select,load,status);let data=[];
  function render(){const model=api.state().session.groundComparison?.model||'';
    if(model&&![...select.options].some(o=>o.value===model)){const o=document.createElement('option');o.value=model;o.textContent=model+'（已保存）';select.append(o);}
    select.value=model;
  }
  load.onclick=async()=>{load.disabled=true;status.textContent='正在读取独立对比结果…';try{
    const response=await fetch(`/api/ground-comparison?${new URLSearchParams({sample:api.sample,variant:api.variant})}`),result=await response.json();
    if(!response.ok)throw new Error(result.error||'没有可用的对比结果。');
    data=result.models||[];select.replaceChildren(baseline);
    for(const model of data){const o=document.createElement('option');o.value=model.model;o.textContent=`${model.model} · ${model.usable}/${model.observations} 个双脚候选`;select.append(o);}
    status.textContent=data.length?'请选择一个模型查看 2D 位置差异；候选数量不代表准确率。':'当前视频 / 跟踪版本尚无匹配的模型对比结果。';render();
  }catch(error){status.textContent=error.message;}finally{load.disabled=false;}};
  select.onchange=()=>{try{const selected=select.value?data.find(m=>m.model===select.value):null;if(select.value&&!selected)throw new Error('请先载入该模型的对比结果。');
    api.change(()=>selectGroundComparison(api.state().session,api.clip,selected));status.textContent=selected?`已选 ${selected.model}。原始数据保留；模型只提供位置候选。`:'已恢复现有位置来源。';
  }catch(error){status.textContent=error.message;render();}};render();return {render};
}
