import {buildCourtPreparation,preparationDependencies,courtPreparationStatus,preparationDigest} from './court-preparation.mjs';
import {previewCourtSmoothing,adoptCourtSmoothing} from './court-smoothing.mjs';
import {rangeFromSeconds} from './tactics-time-range.mjs';
export function mountCourtPreparationUI({host,clip,sample,variant,state,change,redraw,next}){
  const section=document.createElement('section');section.className='court-preparation-panel';
  section.innerHTML=`<h3>2D 轨迹准备</h3><p>先核对球场映射，再预览并采用平滑。原始点始终保留。</p><div class="range-fields"><label>开始（秒）<input data-start type="number" step=".001"></label><label>结束（秒）<input data-end type="number" step=".001"></label></div><label>平滑强度 <select data-preset><option value="off">关闭</option><option value="light" selected>轻度</option><option value="standard">标准</option></select></label><div class="tactics-buttons"><button data-build>建立 / 更新 2D 准备</button><button data-preview>预览所选球员平滑</button><button data-adopt disabled>采用这段平滑</button><button data-save>保存准备版本</button><button data-next>进入战术制作</button></div><label><input data-compare type="checkbox">原始 / 平滑叠加对比</label><p data-status role="status"></p>`;
  host.prepend(section);const $=key=>section.querySelector(`[data-${key}]`),qa=new URLSearchParams(location.search).has('qa');
  $('start').value=clip.frames[0].time;$('end').value=clip.mediaEndTime??'';
  let version=0,preview=null,message='',savedDigest=null,sourceCurrent=false;
  const source=()=>({sample,variant,qa});
  async function request(url,body){const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined),v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
  const safe=fn=>async()=>{try{await fn();}catch(e){message=e.message;}render();redraw();};
  const current=()=>state().session.courtPreparation;
  $('build').onclick=safe(()=>{const preparation=buildCourtPreparation({session:state().session,clip});change(()=>state().session.courtPreparation=preparation);preview=null;message='准备结果已更新，原有战术仍保留，请重新核对依赖此版本的对象。';});
  $('preview').onclick=safe(()=>{
    const p=current();if(!courtPreparationStatus(p,preparationDependencies(state().session,clip)).current)throw new Error('先更新 2D 准备结果。');
    preview=previewCourtSmoothing(p,{entityIds:[state().active],range:rangeFromSeconds(p.frameMapping,{startSeconds:Number($('start').value),endSeconds:Number($('end').value),durationSeconds:p.mediaEndTime}),preset:$('preset').value});
    message=`预览修改 ${preview.diff.changed} 个点，最大位移 ${preview.diff.maxDisplacement.toFixed(3)} m；${preview.issues.length} 个缺口未补点。尚未采用。`;
  });
  $('adopt').onclick=safe(()=>{if(!preview)throw new Error('先预览。');const p=adoptCourtSmoothing(current(),preview.candidate);change(()=>state().session.courtPreparation=p);preview=null;message='平滑已采用，可用全局撤销恢复；战术将读取此版本。';});
  $('save').onclick=safe(async()=>{
    const snapshot=structuredClone(state().session),p=snapshot.courtPreparation;if(!p)throw new Error('先建立 2D 准备。');
    const v=await request('/api/court-preparation/save',{...source(),preparation:p,session:snapshot,expectedVersion:version});version=v.version;savedDigest=preparationDigest(p);message=`已保存 2D 版本 ${version}。`;
  });
  $('next').onclick=safe(()=>next());$('compare').onchange=()=>redraw();
  for(const key of ['start','end','preset'])$(key).onchange=()=>{preview=null;render();redraw();};
  function render(){
    const p=current(),status=courtPreparationStatus(p,preparationDependencies(state().session,clip));
    sourceCurrent=status.current;
    if(preview&&preview.candidate.baseDigest!==preparationDigest(p??null))preview=null;
    $('adopt').disabled=!preview;$('save').disabled=!status.current;
    const gaps=p?Object.values(p.rawByPlayer).flat().filter(q=>q.x===null&&q.source!=='out_of_view').length:0;
    $('status').textContent=`${p?`准备修订 ${p.revision} · ${status.current?'来源有效':'来源变化：'+status.reasons.join('、')} · ${gaps} 个无位置帧`:'尚未建立准备版本'}。${message}`;
  }
  void request('/api/court-preparation?'+new URLSearchParams({...source(),qa:qa?'1':'0'})).then(v=>{
    version=v.version;
    if(v.preparation&&courtPreparationStatus(v.preparation,preparationDependencies(state().session,clip)).current&&!current()){
      change(()=>state().session.courtPreparation=v.preparation);savedDigest=preparationDigest(v.preparation);message='已恢复服务保存的 2D 准备。';
    }else if(v.preparation&&!current())message='服务中有旧来源的准备结果，请按当前身份与标定重新建立。';
    render();
  }).catch(e=>{message=e.message;render();});
  return {render,display:()=>sourceCurrent?(preview?.candidate.pointsByPlayer??current()?.preparedByPlayer):null,compare:()=>$('compare').checked,raw:()=>sourceCurrent?current()?.rawByPlayer:null};
}
