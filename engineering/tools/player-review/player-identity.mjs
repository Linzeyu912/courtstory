const RATING_GROUPS=[
  ['投篮',[['three_point_shot','三分'],['mid_range_shot','中投'],['close_shot','近投']]],
  ['突破',[['layup','上篮'],['driving_dunk','突破扣篮'],['ball_handle','控球'],['speed_with_ball','持球速度']]],
  ['防守',[['perimeter_defense','外线防守'],['interior_defense','内线防守'],['block','盖帽'],['help_defense_iq','协防意识'],['defensive_consistency','防守稳定性']]]
];
const RATING_FIELDS=['overall',...RATING_GROUPS.flatMap(([,fields])=>fields.map(([key])=>key))];
const RATING_STATUS={complete:'能力记录完整',partial:'能力记录部分缺失',missing_record:'该季能力记录缺失',not_in_rating_scope:'该季不在能力表筛选范围'};
const clone=value=>structuredClone(value);
const confirmed=entity=>entity?.playerProfile?.status==='confirmed';
const sameQuery=(left,right)=>left&&right&&['season','team','jersey'].every(key=>left[key]===right[key]);

function validateCandidate(candidate,query){
  const reference=candidate?.rating;
  if(!candidate||typeof candidate.player_id!=='string'||!candidate.player_id||typeof candidate.name!=='string'||!candidate.name||
    candidate.season!==query.season||candidate.team_abbreviation!==query.team||candidate.jersey_number!==query.jersey||
    !Array.isArray(candidate.season_roster)||!reference||reference.season!==query.season||!Object.hasOwn(RATING_STATUS,reference.status)||
    !reference.ratings||!RATING_FIELDS.every(key=>Object.hasOwn(reference.ratings,key)&&
      (reference.ratings[key]===null||Number.isFinite(reference.ratings[key]))))throw new Error('返回的球员或能力数据与所选赛季、球队、号码不一致，请重新查找。');
}

// Player profiles describe who a displayed number means. They deliberately do
// not confirm a model observation, change team colours, or create T bindings.
export function confirmPlayerProfile(session,id,candidate,query,evidence,confirmedAt){
  const entity=session.entities.find(item=>item.id===id&&item.role==='player');
  if(!entity||!/^P(?:[1-9]|10)$/.test(id))throw new Error('请先选择编号 1–10。');
  validateCandidate(candidate,query);
  const others=session.entities.filter(item=>item.id!==id&&confirmed(item));
  if(others.some(item=>item.playerProfile.season!==query.season))throw new Error('其他编号已确认不同赛季；请先清除旧身份，再确认新视频赛季。');
  const duplicate=others.find(item=>item.playerProfile.player_id===candidate.player_id&&item.playerProfile.season===query.season);
  if(duplicate)throw new Error(`此球员已经确认到编号 ${duplicate.id.slice(1)}，请先清除原身份。`);
  const profile={schemaVersion:1,status:'confirmed',method:'human_exact_roster_candidate',
    player_id:candidate.player_id,player_id_namespace:'normalized_name_key',name:candidate.name,season:candidate.season,
    team_abbreviation:candidate.team_abbreviation,jersey_number:candidate.jersey_number,season_roster:clone(candidate.season_roster),
    confirmedAt,evidence:clone(evidence)};
  const reference=clone(candidate.rating);
  entity.playerProfile=profile;entity.ratingReference=reference;
  session.gameContext={...(session.gameContext||{}),season:query.season,seasonSource:'human_identity_confirmation'};
  return profile;
}

export function clearPlayerProfile(session,id){
  const entity=session.entities.find(item=>item.id===id&&item.role==='player');
  if(!entity||(!entity.playerProfile&&!entity.ratingReference))return false;
  delete entity.playerProfile;delete entity.ratingReference;return true;
}

export function exportPlayerIdentities(review,session){
  return {...review,gameContext:clone(session.gameContext||null),playerIdentities:Array.from({length:10},(_,index)=>{
    const id=`P${index+1}`,entity=session.entities.find(item=>item.id===id);
    return {id,playerProfile:clone(entity?.playerProfile||null),ratingReference:clone(entity?.ratingReference||null)};
  })};
}

export function mountPlayerIdentityUI(api){
  const doc=document,$=id=>doc.getElementById(id);
  let stateSignature='',cardSignature='',catalog=null,lookup=null,lookupEpoch=0,teamEpoch=0,catalogEpoch=0;
  const value=rating=>rating==null?'未知':String(rating);
  const state=()=>api.getState();
  const entity=()=>state().session.entities.find(item=>item.id===state().active);
  const query=()=>({season:$('profileSeason').value,team:$('profileTeam').value,jersey:$('profileJersey').value.trim()});
  const ready=()=>Boolean(query().season&&query().team&&/^[0-9]{1,2}$/.test(query().jersey)&&!$('profileTeam').disabled);
  function option(value,label){const node=doc.createElement('option');node.value=value;node.textContent=label;return node;}
  function clearCandidates(){lookup=null;lookupEpoch++;$('profileCandidate').replaceChildren(option('','请先查找并核对姓名'));$('profileCandidate').value='';$('profileCandidate').disabled=true;$('profileConfirm').disabled=true;}
  function invalidate(){clearCandidates();$('profileLookup').disabled=!ready();$('profileLookupStatus').textContent='填写视频赛季、球队和号码，再查找候选。';}
  function candidate(){return lookup&&lookup.id===state().active&&sameQuery(lookup.query,query())?lookup.candidates.find(item=>item.player_id===$('profileCandidate').value):null;}
  function sourceLink(target,url,label){
    if(typeof url!=='string')return;
    try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname)return;}catch{return;}
    const link=doc.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=label;target.append(link);
  }
  function card(){
    const current=state(),item=entity(),profile=item?.playerProfile,reference=item?.ratingReference;
    const known=confirmed(item),number=/^P(?:[1-9]|10)$/.test(current.active)?current.active.slice(1):'—';
    $('profileSummary').textContent=known?`编号 ${number} · ${profile.name} · ${reference?.game||'2K能力'}`:`编号 ${number} · 身份确认与 2K 能力`;
    $('profileSelected').textContent=known?`已确认编号 ${number}：${profile.name} · ${profile.team_abbreviation} #${profile.jersey_number}`:`正在确认编号 ${number}。红 / 蓝表示攻防角色，请填写实际 NBA 球队。`;
    $('profileClear').disabled=!item?.playerProfile&&!item?.ratingReference;
    const point=current.point;
    $('profileObservation').textContent=point?.x==null?'当前没有可靠位置。资料跟随此编号，画面中的对应关系仍需核对。':'资料跟随此编号，当前框仍需核对。';
    const signature=JSON.stringify([current.active,profile,reference]);if(signature===cardSignature)return;cardSignature=signature;
    const target=$('profileRatingCard');target.replaceChildren();target.hidden=!known;
    if(!known)return;
    const header=doc.createElement('p');header.className='profile-rating-header';
    header.textContent=`${profile.season} · ${reference?.game||'游戏版本未知'} · 总评 ${value(reference?.ratings?.overall)} · ${RATING_STATUS[reference?.status]||'能力状态未知'}`;target.append(header);
    const groups=doc.createElement('div');groups.className='profile-rating-groups';
    for(const [title,fields] of RATING_GROUPS){const group=doc.createElement('section'),heading=doc.createElement('h3');heading.textContent=title;group.append(heading);
      for(const [key,label] of fields){const row=doc.createElement('div'),name=doc.createElement('span'),score=doc.createElement('strong');name.textContent=label;score.textContent=value(reference?.ratings?.[key]);row.append(name,score);group.append(row);}groups.append(group);
    }target.append(groups);
    const sources=doc.createElement('details'),summary=doc.createElement('summary');summary.textContent='查看名单与能力来源';sources.append(summary);
    const scope=doc.createElement('p');scope.textContent='已收录球员的整季球队名单，含离队球员，不证明当场阵容；能力表限各季16支季后赛球队的筛选范围。';sources.append(scope);
    for(const roster of profile.season_roster||[]){const row=doc.createElement('p');row.textContent=`名单：${roster.team_abbreviation||profile.team_abbreviation} #${(roster.jersey_numbers||[profile.jersey_number]).join(' / ')}${roster.phase?` · ${roster.phase}`:''} `;sourceLink(row,roster.url,'名单来源');sources.append(row);}
    for(const [key,label] of [['overall','总评'],...RATING_GROUPS.flatMap(([,fields])=>fields)]){
      const evidence=reference?.field_provenance?.[key];if(!evidence)continue;
      const row=doc.createElement('p');row.textContent=`${label} ${value(reference.ratings[key])} · ${evidence.game||reference.game} · 来源快照日期 ${evidence.snapshot_date||'未知'} · 日期口径 ${evidence.date_basis||'未知'} `;sourceLink(row,evidence.url,'能力来源');sources.append(row);
    }
    const note=doc.createElement('p');note.textContent='来源快照日期不等于游戏补丁日或比赛当日。能力值是游戏原始评分；未知保留空值。';sources.append(note);target.append(sources);
  }
  async function json(url){const response=await fetch(url);if(!response.ok){let message='本地资料查询失败，请稍后重试。';try{const error=await response.json();if(typeof error.error==='string')message=error.error;}catch{}throw new Error(message);}return response.json();}
  async function loadTeams(season,preferredTeam=''){
    const token=++teamEpoch,id=state().active;$('profileTeam').replaceChildren(option('','选择实际球队'));$('profileTeam').value='';$('profileTeam').disabled=true;$('profileLookup').disabled=true;
    if(!season)return;
    try{const data=await json(`/api/player-identity/options?season=${encodeURIComponent(season)}`);
      if(token!==teamEpoch||id!==state().active||season!==$('profileSeason').value)return;
      if(!Array.isArray(data.teams)||data.teams.some(team=>typeof team.abbreviation!=='string'||typeof team.name!=='string'))throw new Error('球队资料返回不完整，请重试。');
      $('profileTeam').replaceChildren(option('','选择实际球队'),...data.teams.map(team=>option(team.abbreviation,`${team.abbreviation} · ${team.name_zh||team.name}`)));
      $('profileTeam').value=data.teams.some(team=>team.abbreviation===preferredTeam)?preferredTeam:'';$('profileTeam').disabled=false;$('profileRetry').hidden=true;$('profileLookup').disabled=!ready();
    }catch(error){if(token!==teamEpoch||id!==state().active||season!==$('profileSeason').value)return;$('profileLookupStatus').textContent=error.message;$('profileRetry').hidden=false;}
  }
  function seedForm(){
    clearCandidates();teamEpoch++;const item=entity(),profile=item?.playerProfile;
    $('profileSeason').value=profile?.season||state().session.gameContext?.season||'';
    $('profileJersey').value=profile?.jersey_number||(typeof item?.jersey==='string'?item.jersey:'');
    $('profileLookupStatus').textContent='填写视频赛季、球队和号码，再查找候选。';
    const preferred=profile?.team_abbreviation||(typeof item?.team==='string'?item.team.trim().toUpperCase():'');
    void loadTeams($('profileSeason').value,preferred);
  }
  async function loadCatalog(){
    const token=++catalogEpoch;$('profileSeason').disabled=true;
    try{const data=await json('/api/player-identity/options');if(token!==catalogEpoch)return;
      if(!Array.isArray(data.seasons)||data.seasons.some(season=>typeof season!=='string'))throw new Error('赛季资料返回不完整，请重试。');
      catalog=data;$('profileSeason').replaceChildren(option('','选择视频赛季'),...catalog.seasons.map(season=>option(season,season)));$('profileSeason').disabled=false;$('profileRetry').hidden=true;seedForm();
    }catch(error){if(token!==catalogEpoch)return;$('profileLookupStatus').textContent=error.message;$('profileRetry').hidden=false;}
  }
  function render(){
    const current=state(),item=entity();const signature=JSON.stringify([current.active,item?.playerProfile,item?.ratingReference,current.session.gameContext?.season]);
    if(signature!==stateSignature){stateSignature=signature;seedForm();}
    $('profileLookup').disabled=!ready();card();
  }
  $('profileSeason').onchange=()=>{invalidate();void loadTeams($('profileSeason').value);};
  $('profileTeam').onchange=invalidate;$('profileJersey').oninput=invalidate;
  $('profileCandidate').onchange=()=>{$('profileConfirm').disabled=!candidate();};
  $('profileRetry').onclick=()=>{if(catalog)void loadTeams($('profileSeason').value,entity()?.playerProfile?.team_abbreviation||'');else void loadCatalog();};
  $('profileLookup').onclick=async()=>{
    if(!ready())return;api.pause?.();clearCandidates();const token=lookupEpoch,id=state().active,requested=query();
    $('profileLookup').disabled=true;$('profileLookupStatus').textContent='正在查找整季名单候选…';
    try{const data=await json(`/api/player-identity/lookup?${new URLSearchParams(requested)}`);
      if(token!==lookupEpoch||id!==state().active||!sameQuery(requested,query()))return;
      if(!sameQuery(data.query,requested)||!Array.isArray(data.candidates)||!['no_match','unique_candidate','multiple_candidates'].includes(data.status)||
        (data.status==='no_match'&&data.candidates.length!==0)||(data.status==='unique_candidate'&&data.candidates.length!==1)||
        (data.status==='multiple_candidates'&&data.candidates.length<2)||new Set(data.candidates.map(item=>item.player_id)).size!==data.candidates.length)throw new Error('返回的候选数据不一致，请重新查找。');
      for(const item of data.candidates)validateCandidate(item,requested);
      lookup={id,query:requested,candidates:data.candidates};$('profileCandidate').replaceChildren(option('','核对画面后选择球员姓名'),...data.candidates.map(item=>option(item.player_id,`${item.name} · ${item.team_abbreviation} #${item.jersey_number}`)));
      $('profileCandidate').value='';$('profileCandidate').disabled=!data.candidates.length;
      $('profileLookupStatus').textContent=data.status==='no_match'?'当前资料没有匹配项，请核对赛季、球队和号码。':data.status==='multiple_candidates'?`找到 ${data.candidates.length} 条整季名单候选，请核对并选择姓名。`:'找到候选，请核对姓名后选择，再确认。';
    }catch(error){if(token!==lookupEpoch||id!==state().active||!sameQuery(requested,query()))return;$('profileLookupStatus').textContent=error.message;}
    finally{if(token===lookupEpoch&&id===state().active)$('profileLookup').disabled=!ready();}
  };
  $('profileConfirm').onclick=()=>{
    const selected=candidate();if(!selected)return;
    try{const current=state(),copy=clone(current.session),record=current.clip.frames[current.frame],point=current.point;
      confirmPlayerProfile(copy,current.active,selected,lookup.query,{videoSha256:current.clip.video_sha256,
        trackingFingerprint:current.clip.tracking_fingerprint||null,variant:current.clip.tracking_revision||current.clip.variant||'original',
        frame:current.frame,sourceFrame:record.source_frame??record.frame,sourcePTS:record.source_time??record.time,
        trackId:point?.trackId??null,visibility:point?.x==null?'position_unknown':'observed_needs_review'},new Date().toISOString());
      api.commit(copy);$('profileLookupStatus').textContent=`编号 ${current.active.slice(1)} 的身份资料已确认，可撤销。`;api.toast('身份与 2K 能力已保存，可撤销。');
    }catch(error){$('profileLookupStatus').textContent=error.message;api.toast(error.message);}
  };
  $('profileClear').onclick=()=>{const current=state(),copy=clone(current.session);if(!clearPlayerProfile(copy,current.active))return;api.commit(copy);$('profileLookupStatus').textContent='身份资料已清除，原编号与手工记录保留，可撤销。';api.toast('身份资料已清除，可撤销。');};
  $('profileSeason').replaceChildren(option('','选择视频赛季'));clearCandidates();render();void loadCatalog();
  return {render};
}
