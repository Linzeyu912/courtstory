import {buildBasketballTrajectory} from './scene-objects.mjs';
import {calibrationAt,project} from './court.mjs';
import {groundObservation} from './ground-position.mjs';

export function buildBallCourtTrajectory(session,frames,imagePlayers,courtPlayers,dimensions={}){
  const balls=buildBasketballTrajectory(session,frames,session.cuts,dimensions),cuts=new Set(session.cuts||[]);
  const manual=new Map((session.ballStateEdits||[]).map(r=>[r.frame,r]));
  const ground=new Map((session.ballGroundAnchors||[]).map(r=>[r.frame,r]));
  let run=null,lastLikely=null;
  return balls.map((ball,frame)=>{
    if(cuts.has(frame)){run=null;lastLikely=null;}
    const base={frame,time:frames[frame].time,imagePoint:ball.x==null?null:[ball.x,ball.y],x:null,y:null,
      displayX:null,displayY:null,positionKind:'unknown',state:'unknown',owner:null,reviewRequired:true,metricPositionAvailable:false};
    const anchor=ground.get(frame);
    if(anchor){const map=calibrationAt(session.courtCalibration,frame,frames,session.cuts),p=map&&project(map.toCourt,...anchor.image);
      if(p)return {...base,...p,displayX:p.x,displayY:p.y,positionKind:'human_ground_projection',state:'ground_projection_marked',
        metricPositionAvailable:true,groundImagePoint:anchor.image,metricAccuracyValidated:false};}
    let owner=null,reason=null,state='unknown';
    const edit=manual.get(frame);
    if(edit){run=null;lastLikely=null;if(edit.state==='controlled'){owner=edit.entityId;state='human_controlled';reason='human_frame_label';}
      else return {...base,state:edit.state,reason:'human_frame_label'};
    }else if(ball.x!=null){
      const candidates=[];
      for(const entity of session.entities.filter(e=>e.role==='player')){
        const p=imagePlayers[entity.id]?.[frame];if(!p?.box||p.x==null||p.reviewExcluded||['conflict','out_of_view','interpolated','manual_path'].includes(p.source))continue;
        const [x1,y1,x2,y2]=p.box,h=y2-y1,w=x2-x1;if(h<=0||w<=0)continue;
        const wrists=groundObservation(session,p,frame)?.wrists||[];
        const wristDistance=wrists.length?Math.min(...wrists.filter(k=>k.score>=.3).map(k=>Math.hypot(ball.x-k.x,ball.y-k.y)))/h:Infinity;
        const inside=ball.x>=x1-w*.2&&ball.x<=x2+w*.2&&ball.y>=y1+h*.2&&ball.y<=y1+h*.8;
        if(wristDistance>.23&&!inside)continue;
        const cost=Number.isFinite(wristDistance)?wristDistance:Math.hypot((ball.x-(x1+x2)/2)/h,(ball.y-(y1+h*.5))/h)+.2;
        candidates.push({id:entity.id,cost,withWrist:wristDistance<=.23,relative:[(ball.x-x1)/h,(ball.y-y1)/h]});
      }
      candidates.sort((a,b)=>a.cost-b.cost);const best=candidates[0],ambiguous=candidates.length>1&&candidates[1].cost-best.cost<.12;
      if(best&&!ambiguous){
        const continuous=run?.id===best.id&&run.frame===frame-1&&frames[frame].time-run.time<.12&&Math.hypot(best.relative[0]-run.relative[0],best.relative[1]-run.relative[1])<.22;
        if(!continuous)lastLikely=null;
        run={...best,frame,time:frames[frame].time,count:continuous?run.count+1:1,start:continuous?run.start:frames[frame].time};
        if(run.count>=(best.withWrist?3:6)&&frames[frame].time-run.start>=(best.withWrist ? .06 : .15)){
          owner=best.id;state='likely_controlled';reason=best.withWrist?'wrist_proximity_temporal_consistency':'body_proximity_temporal_consistency';lastLikely={owner,time:base.time,frame};
        }else return {...base,state:'possession_candidate',candidateOwner:best.id,reason:'insufficient_temporal_evidence'};
      }else{run=null;lastLikely=null;return {...base,state:ambiguous?'ambiguous':'free_or_unknown'};}
    }else{
      run=null;
      if(lastLikely&&base.time-lastLikely.time<=.2){owner=lastLikely.owner;state='occlusion_prediction';reason='short_missing_after_likely_control';}
    }
    if(owner){const person=imagePlayers[owner]?.[frame],p=courtPlayers[owner]?.[frame];
      if(!person||person.reviewExcluded||['conflict','out_of_view','missing'].includes(person.source))return {...base,reason:'owner_position_unavailable'};
      return {...base,owner,state,reason,positionKind:'possession_proxy',displayX:p?.x??null,displayY:p?.y??null,
        metricPositionAvailable:false,proxyExplanation:'球员地面站位仅表示持球关联，不能计算篮球距离或速度。'};
    }
    return base;
  });
}

export function mountBallCourt(api){
  const host=document.getElementById('ballCourtPanel');if(!host)return {render(){},cancelPick(){},handleImageClick(){return false;}};
  const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text||'';return e;};
  const title=el('strong','篮球持球与 2D 对应'),status=el('p'),hint=el('p','持球关联显示在球员附近；空中球高度未知时保留图像轨迹，2D 位置留空。');hint.className='small muted';
  const select=el('select');select.setAttribute('aria-label','当前帧篮球状态');
  for(const [value,label] of [['unknown','未知'],['free_flight','传球 / 投篮飞行'],...Array.from({length:10},(_,i)=>[`P${i+1}`,`P${i+1} 控球`])]){const o=el('option',label);o.value=value;select.append(o);}
  const save=el('button','保存本帧持球判断'),pick=el('button','标注球正下方地面点'),clear=el('button','清除本帧篮球判断');
  host.append(title,hint,status,select,save,pick,clear);let pending=null,selectionKey=null;
  save.onclick=()=>{const s=api.state();api.change(()=>{s.session.ballStateEdits=(s.session.ballStateEdits||[]).filter(e=>e.frame!==s.frame);
    s.session.ballStateEdits.push({frame:s.frame,state:select.value.startsWith('P')?'controlled':select.value,entityId:select.value.startsWith('P')?select.value:null,source:'human'});});};
  pick.onclick=()=>{const s=api.state();s.video.pause();pending=s.frame;status.textContent='在原视频点击篮球正下方的地面位置（不是空中球心）；位置不确定时可再次点击本按钮取消。';pick.textContent='取消地面点标注';pick.onclick=()=>{pending=null;pick.textContent='标注球正下方地面点';pick.onclick=startPick;api.redraw();};};
  const startPick=pick.onclick;
  clear.onclick=()=>{const s=api.state();pending=null;pick.textContent='标注球正下方地面点';pick.onclick=startPick;api.change(()=>{s.session.ballStateEdits=(s.session.ballStateEdits||[]).filter(e=>e.frame!==s.frame);s.session.ballGroundAnchors=(s.session.ballGroundAnchors||[]).filter(e=>e.frame!==s.frame);});};
  function render(point){const s=api.state();
    const edit=(s.session.ballStateEdits||[]).find(e=>e.frame===s.frame),key=JSON.stringify([s.frame,edit?.state,edit?.entityId]);
    if(key!==selectionKey){select.value=edit?.state==='controlled'?edit.entityId:edit?.state||'unknown';selectionKey=key;}
    if(pending!==null&&pending!==s.frame){pending=null;pick.textContent='标注球正下方地面点';pick.onclick=startPick;}
    if(pending!==null)return;
    const labels={unknown:'位置未知',human_controlled:'人工指定持球',likely_controlled:'可能持球（待核对）',occlusion_prediction:'短时遮挡推测',possession_candidate:'持球证据积累中',ambiguous:'多人接近，无法确定',free_or_unknown:'脱手或状态未知',free_flight:'空中运动',ground_projection_marked:'人工地面投影'};
    status.textContent=`当前：${labels[point?.state]||'未知'}${point?.owner?' · '+point.owner:''}${point?.positionKind==='possession_proxy'?'；圆环为持球关联，不是篮球实测位置。':''}`;
  }
  return {render,cancelPick(){pending=null;pick.textContent='标注球正下方地面点';pick.onclick=startPick;},handleImageClick(x,y){if(pending===null)return false;const s=api.state();if(pending!==s.frame){pending=null;return true;}
    if(x<0||y<0||x>api.clip.width||y>api.clip.height)return true;
    pending=null;pick.textContent='标注球正下方地面点';pick.onclick=startPick;api.change(()=>{s.session.ballGroundAnchors=(s.session.ballGroundAnchors||[]).filter(e=>e.frame!==s.frame);s.session.ballGroundAnchors.push({frame:s.frame,image:[x,y],source:'human_ground_projection'});});return true;}};
}
