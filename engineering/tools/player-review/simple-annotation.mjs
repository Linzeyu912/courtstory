import {effectiveTeamGroup} from './team-overlay.mjs';

export function simplePlayerStyle(entity,policy){
  const group=effectiveTeamGroup(entity);
  return {color:group?policy.teams[group].color:'#9ca3af',label:String(Number(entity.id.slice(1))),dashed:false};
}

const inside=(box,x,y)=>box&&x>=box[0]&&x<=box[2]&&y>=box[1]&&y<=box[3];
const smallest=(items,x,y)=>items.filter(item=>inside(item.box||item.point?.box,x,y))
  .sort((a,b)=>{const aa=a.box||a.point.box,bb=b.box||b.point.box;return (aa[2]-aa[0])*(aa[3]-aa[1])-(bb[2]-bb[0])*(bb[3]-bb[1]);})[0];

export function mountSimpleAnnotationUI(api){
  const $=id=>document.getElementById(id);
  let advanced=false,correcting=false,target=null,lastFrame=null,signature='';
  const status=point=>point?.annotationNeedsReview||point?.source==='conflict'?'需要核对':point?.x==null?'当前未检出':point.identitySource==='model_suggestion'?'需要核对':'';
  function setAdvanced(value){
    if(Boolean(value)===advanced)return;
    advanced=Boolean(value);correcting=false;target=null;signature='';
    document.body.dataset.reviewView=advanced?'advanced':'simple';
    $('advancedTools').setAttribute('aria-pressed',String(advanced));
    $('advancedTools').textContent=advanced?'返回标注':'高级工具';
    api.onViewChange(advanced);render();
  }
  function selectId(id){
    const current=api.getState();
    if(correcting&&target&&target.frame===current.frame){
      if(api.associate(id,{...target.proposal,preservePosition:target.ownerId===id})!==false){correcting=false;target=null;}
    }else api.select(id);
    api.redraw();
  }
  function render(){
    const state=api.getState();
    if(lastFrame!==null&&lastFrame!==state.frame){target=null;correcting=false;}
    lastFrame=state.frame;
    const players=state.entities.filter(entity=>entity.role==='player'&&/^P(?:[1-9]|10)$/.test(entity.id))
      .sort((a,b)=>Number(a.id.slice(1))-Number(b.id.slice(1)));
    const next=JSON.stringify(players.map(entity=>[entity.id,effectiveTeamGroup(entity),status(state.points[entity.id]),entity.id===state.active]));
    if(next!==signature){signature=next;$('simpleIds').replaceChildren();
      for(const entity of players){const button=document.createElement('button'),style=simplePlayerStyle(entity,state.teamPolicy);
        button.type='button';button.dataset.playerId=entity.id;button.className=`simple-id ${entity.id===state.active?'selected':''} ${state.points[entity.id]?.x==null?'absent':''}`;
        button.textContent=style.label;button.setAttribute('style',`--team-color: ${style.color}`);
        button.setAttribute('aria-pressed',String(entity.id===state.active));button.setAttribute('aria-label',`选择编号 ${style.label}${status(state.points[entity.id])?`，${status(state.points[entity.id])}`:''}`);
        button.onclick=()=>selectId(entity.id);$('simpleIds').append(button);
      }
    }
    const selected=players.find(entity=>entity.id===state.active),point=state.points[state.active];
    $('simpleSelection').textContent=`编号 ${selected?Number(selected.id.slice(1)):'—'}${status(point)?` · ${status(point)}`:''}`;
    $('simpleCorrection').setAttribute('aria-pressed',String(correcting));$('simpleCorrection').textContent=correcting?'取消纠正':'纠正编号';
    $('simpleHint').textContent=target&&!target.ownerId?(correcting?'点击正确编号，续接这个球员。':'编号未匹配：先点“纠正编号”，再选正确编号。'):
      correcting?(target?'点击正确编号；保存后可撤销。':'先点击需要纠正的球员，再选择正确编号。'):'自动编号，可纠正。点击框或编号查看球员。';
    $('simpleTeamControls').hidden=!correcting;$('simpleTeam').value=effectiveTeamGroup(selected||{})||'';
  }
  $('advancedTools').onclick=()=>setAdvanced(!advanced);
  $('advancedTools').setAttribute('aria-pressed','false');document.body.dataset.reviewView='simple';
  $('simpleCorrection').onclick=()=>{correcting=!correcting;render();api.redraw();};
  $('simpleTeam').onchange=event=>{
    if(api.setTeamGroup(event.target.value||null)===true){correcting=false;target=null;}
    render();api.redraw();
  };
  return {render,setAdvanced,isAdvanced:()=>advanced,selected:()=>target,
    handleImageClick(x,y){
      if(advanced)return false;
      const state=api.getState(),player=smallest(state.annotations,x,y);
      if(player){target={frame:state.frame,ownerId:player.id,proposal:{box:player.raw.detectorBox||player.raw.box,trackId:player.raw.trackId??null}};api.select(player.id);}
      else{const proposal=smallest(state.candidates,x,y);target=proposal?{frame:state.frame,ownerId:null,proposal:{...proposal}}:null;if(!proposal)api.toast('这里没有检出的球员。');}
      api.redraw();return true;
    }};
}
