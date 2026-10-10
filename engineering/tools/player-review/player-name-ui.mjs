import {applyPlayerNameIdentities,nameIdentityAt} from './player-name-identity.mjs';

const clone=value=>structuredClone(value);

function savedNameSummary({session,clip,trajectories}){
  let hasNames=false;
  const rows=(session.entities||[]).filter(entity=>entity.role==='player').map(entity=>{
    const names=new Set(),visible=new Set(),named=new Set();
    for(const point of trajectories?.[entity.id]||[]){
      if(!Number.isFinite(point.x)||!Number.isFinite(point.y))continue;
      visible.add(point.frame);
      const identity=nameIdentityAt(session,entity,point,clip);if(!identity)continue;
      hasNames=true;named.add(point.frame);
      names.add(`${identity.name}（${identity.identityVerified===true?'人工姓名':'机器候选，待人工审核'}）`);
    }
    return `${entity.id} · ${[...names].join(' / ')||'姓名未知'} · 已保存姓名 ${named.size}/${visible.size} 观察帧 · 位置关联按当前区间记录`;
  });
  return {rows,hasNames};
}

/** Mount an independent control/results panel. The visibility switch is presentation-only. */
export function mountPlayerNameUI({api,client,root,onVisibilityChange=()=>{}}){
  const doc=root?.ownerDocument||globalThis.document;
  if(!api||!client||!root||!doc)throw new Error('姓名面板需要 api、client 和容器。');
  let visible=true;
  root.replaceChildren();
  const panel=doc.createElement('section');panel.className='player-name-panel';
  const title=doc.createElement('h3');title.textContent='球员姓名识别';
  const description=doc.createElement('p');description.textContent='根据号码、比赛名单与同人续接证据识别姓名；姓名和当前位置关联分别记录，缺少证据的区间保留未知。';
  const context=doc.createElement('div');context.className='player-name-context';
  const seasonLabel=doc.createElement('label');seasonLabel.textContent='赛季';
  const season=doc.createElement('input');season.type='text';season.placeholder='2025-26';season.maxLength=7;season.autocomplete='off';seasonLabel.append(season);
  const gameLabel=doc.createElement('label');gameLabel.textContent='比赛编号（可选）';
  const gameId=doc.createElement('input');gameId.type='text';gameId.placeholder='0022500701';gameId.maxLength=10;gameId.autocomplete='off';gameLabel.append(gameId);
  const redLabel=doc.createElement('label');redLabel.textContent='红队 A 实际球队';
  const red=doc.createElement('input');red.type='text';red.placeholder='例如 BOS';red.maxLength=3;red.autocomplete='off';redLabel.append(red);
  const blueLabel=doc.createElement('label');blueLabel.textContent='蓝队 B 实际球队';
  const blue=doc.createElement('input');blue.type='text';blue.placeholder='例如 NYK';blue.maxLength=3;blue.autocomplete='off';blueLabel.append(blue);
  const savedContext=()=>{
    const state=api.getState(),groups=state.session.teamIdentities||{},sampleContext=state.nameContext||{};
    return state.session.identityContext??{season:state.session.gameContext?.season||sampleContext.season||'',gameId:state.session.gameContext?.gameId||sampleContext.gameId||'',
      teamMap:{A:groups.red?.team||sampleContext.teamMap?.A||'',B:groups.blue?.team||sampleContext.teamMap?.B||''}};
  };
  let savedContextStamp;
  const seedContext=()=>{
    const saved=savedContext();savedContextStamp=JSON.stringify(saved);
    season.value=saved.season||'';gameId.value=saved.gameId||'';
    red.value=saved.teamMap?.A||'';blue.value=saved.teamMap?.B||'';
  };
  const contextReady=()=>/^\d{4}-\d{2}$/.test(season.value.trim())&&/^[A-Z]{3}$/.test(red.value.trim().toUpperCase())&&
    /^[A-Z]{3}$/.test(blue.value.trim().toUpperCase())&&red.value.trim().toUpperCase()!==blue.value.trim().toUpperCase();
  const requestContext=()=>({season:season.value.trim(),teamMap:{A:red.value.trim().toUpperCase(),B:blue.value.trim().toUpperCase()},
    ...(gameId.value.trim()?{gameId:gameId.value.trim()}:{})});
  const initialIdentityContext=()=>{
    const raw=requestContext(),known={},teams=Object.fromEntries(Object.entries(raw.teamMap).filter(([,team])=>/^[A-Z]{3}$/.test(team)));
    if(/^\d{4}-\d{2}$/.test(raw.season))known.season=raw.season;
    if(Object.keys(teams).length)known.teamMap=teams;
    if(/^\d{10}$/.test(raw.gameId??''))known.gameId=raw.gameId;
    return Object.keys(known).length?known:undefined;
  };
  context.append(seasonLabel,gameLabel,redLabel,blueLabel);seedContext();
  const actions=doc.createElement('div');actions.className='player-name-actions';
  const start=doc.createElement('button');start.type='button';start.textContent='识别全员姓名';
  const retry=doc.createElement('button');retry.type='button';retry.textContent='重试';retry.hidden=true;
  const cancel=doc.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.hidden=true;
  const apply=doc.createElement('button');apply.type='button';apply.textContent='加入候选结果';apply.hidden=true;
  actions.append(start,retry,cancel,apply);
  const visibilityLabel=doc.createElement('label'),visibility=doc.createElement('input');
  visibility.type='checkbox';visibility.checked=true;visibilityLabel.append(visibility,doc.createTextNode('显示姓名候选结果'));
  const status=doc.createElement('p');status.setAttribute('role','status');
  const provider=doc.createElement('p');provider.className='small muted';provider.setAttribute('aria-label','姓名识别服务');
  const list=doc.createElement('ul');list.className='player-name-results';
  let summaryCandidate=null,summaryClip=null,summarySession=null,summaryTrajectories=null,summaryRows=[];
  let savedClip=null,savedSession=null,savedTrajectories=null,savedNames={rows:[],hasNames:false};
  panel.append(title,description,context,actions,visibilityLabel,status,list,provider);root.append(panel);
  function render(){
    if(JSON.stringify(savedContext())!==savedContextStamp)seedContext();
    const state=client.state(),job=state.job;
    const current=api.getState(),review=current.session.initialIdentityReview;
    const hasSavedReview=review?.algoVersion==='video-identity-review-v2'&&!!review.videoHash&&
      review.videoHash===current.clip.video_sha256&&review.trackingFingerprint===current.clip.tracking_fingerprint&&review.trackingRevision===current.clip.tracking_revision;
    if(savedClip!==current.clip||savedSession!==current.session||savedTrajectories!==current.trajectories){
      savedClip=current.clip;savedSession=current.session;savedTrajectories=current.trajectories;savedNames=savedNameSummary(current);
    }
    start.textContent=hasSavedReview?'高级：单独补查姓名':'识别全员姓名';
    const unavailable=state.providerStatus===null||state.providerStatus?.available===false;
    start.disabled=state.busy||!contextReady()||unavailable;cancel.hidden=!state.busy;retry.hidden=state.busy||!job||!['failed','cancelled','review_required'].includes(job.status);
    retry.disabled=!contextReady()||unavailable;
    provider.textContent=state.providerStatus?.available?`姓名识别：${state.providerStatus.provider} · ${state.providerStatus.model}`:
      state.providerStatus?.message||'正在读取姓名识别服务配置…';
    apply.hidden=!job?.candidate||job.status!=='ready';apply.disabled=!state.canApply;
    status.textContent=state.error?state.error:state.stale?'草稿、视频或跟踪上下文已变化；请重新识别，旧结果未应用。':
      (job?.message||(job?.status==='ready'?'结果待核对，可按区间加入姓名候选。':
      state.busy?'正在识别球员姓名…':job?.status==='failed'?'识别失败，可重试。':
      !job&&hasSavedReview?`视频初检草稿已保存${review.completionStatus==='partial'?'（部分区间待检查）':''}；姓名候选待人工审核，未知可手工补充。`:
      !job&&savedNames.hasNames?'已显示当前草稿的有效姓名记录；机器候选仍需人工审核。':'尚未开始姓名识别。'));
    list.replaceChildren();list.hidden=!visible;
    if(!visible)return;
    const candidates=job?.candidate?.candidates||[];
    if(summaryCandidate!==job?.candidate||summaryClip!==current.clip||summarySession!==current.session||summaryTrajectories!==current.trajectories){
      summaryCandidate=job?.candidate;summaryClip=current.clip;summarySession=current.session;summaryTrajectories=current.trajectories;
      const adopted=Boolean(job?.jobId&&job?.sourceKey)&&(current.session.entities||[]).some(entity=>entity.machinePlayerProfile?.jobId===job?.jobId&&
        entity.machinePlayerProfile?.sourceKey===job?.sourceKey||(entity.machineNameIdentities||[]).some(item=>
          item.jobId===job?.jobId&&item.sourceKey===job?.sourceKey));
      summaryRows=!job?.candidate?[]:(current.session.entities||[]).filter(entity=>entity.role==='player').map(entity=>{
        const own=candidates.filter(item=>item.entityId===entity.id),visible=new Set(),named=new Set();
        const names=[...new Set(own.filter(item=>item.status==='candidate').map(item=>
          typeof item.nameCandidate==='string'?item.nameCandidate:item.nameCandidate?.name).filter(Boolean))];
        if(adopted&&Array.isArray(current.trajectories?.[entity.id])){
          names.splice(0);
          for(const point of current.trajectories[entity.id]){
            if(point.x==null||point.y==null)continue;
            visible.add(point.frame);const identity=nameIdentityAt(current.session,entity,point,current.clip);
            if(identity){named.add(point.frame);if(!names.includes(identity.name))names.push(identity.name);}
          }
        }else for(const item of own){
          if(!Number.isInteger(item.start)||!Number.isInteger(item.end))continue;
          for(let frame=Math.max(0,item.start);frame<=Math.min(item.end,current.clip.frames.length-1);frame++){
            if(!(current.clip.frames[frame].tracks||[]).some(row=>Number(row[4])===Number(item.trackId)))continue;
            visible.add(frame);
            if(adopted?nameIdentityAt(current.session,entity,{frame,trackId:item.trackId},current.clip):item.status==='candidate')named.add(frame);
          }
        }
        const reference=job?.candidate?.playerProfiles?.find(item=>item.entityId===entity.id&&item.status==='reference_candidate');
        const referenceName=typeof reference?.nameCandidate==='string'?reference.nameCandidate:reference?.nameCandidate?.name;
        if(!names.length&&referenceName)names.push(referenceName);
        return `${entity.id} · ${names.join(' / ')||'姓名未知'} · 可定位姓名候选 ${named.size}/${visible.size} 观察帧`+
          `${names.length>1?' · 区间归属需复核':''} · 位置关联按当前区间记录`;
      });
    }
    for(const text of job?.candidate?summaryRows:hasSavedReview||savedNames.hasNames?savedNames.rows:[]){
      const row=doc.createElement('li');row.className='player-name-person-summary';row.textContent=text;list.append(row);
    }
    for(const issue of job?.candidate?.issues||[]){
      if(issue?.kind!=='identity_conflict')continue;
      const row=doc.createElement('li');row.className='player-name-conflict';
      const segments=(issue.segments||[]).map(segment=>`T${segment.trackId??'?'}${segment.jersey!=null?` #${segment.jersey}`:''} · ${Number.isInteger(segment.start)?segment.start:'?'}–${Number.isInteger(segment.end)?segment.end:'?'}帧`).join('；');
      row.textContent=`${issue.entityId||'球员'} · 区间身份待核对${segments?`：${segments}`:''}。${issue.reason||'不同片段存在不同身份，清晰证据按有限区间保留。'}`;
      list.append(row);
    }
    if(!candidates.length&&job?.status==='ready'){const row=doc.createElement('li');row.textContent='没有可确认姓名的区间；未知和待补充证据状态已保留。';list.append(row);}
  }
  for(const input of [season,gameId,red,blue])input.oninput=()=>{if(input===red||input===blue)input.value=input.value.toUpperCase();api.onContextChange?.(requestContext());render();};
  start.onclick=async()=>{try{await client.start(requestContext());}catch{}render();};
  retry.onclick=async()=>{try{await client.retry(requestContext());}catch{}render();};
  cancel.onclick=()=>{void client.cancel().finally(render);};
  visibility.onchange=()=>{visible=visibility.checked;onVisibilityChange(visible);render();};
  apply.onclick=()=>{
    const current=api.getState(),job=client.state().job;
    try{
      if(client.state().stale)throw new Error('草稿或视频上下文已变化，请重新识别。');
      const result=applyPlayerNameIdentities(clone(current.session),job,current.clip);
      api.commit(result.session);client.applied();
      const conflicts=result.report.identityConflictEntities?.length?`；${result.report.identityConflictEntities.join('、')}的区间关联需复核，已保留清晰段证据`:'';
      const released=result.report.associationReleasedSegments?`；${result.report.associationReleasedSegments} 个错关联区间已释放`:'';
      api.toast?.(`已加入 ${result.report.applied} 条有限姓名记录；${result.report.skipped} 条姓名提案未采用${released}${conflicts}。`);
    }catch(error){status.textContent=error.message;api.toast?.(error.message);}
    render();
  };
  client.setRequestContextProvider?.(requestContext);
  const unsubscribe=client.subscribe?.(render);
  render();void client.init().then(render);
  return {render,requestContext,initialIdentityContext,
    dispose(){unsubscribe?.();client.dispose();root.replaceChildren();}};
}
