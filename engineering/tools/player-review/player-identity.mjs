import {mountSimpleIdentityRecognition,selectedIdentityObservation} from './identity-ocr.mjs';
import {entityTeamSide} from './identity-timeline.mjs';
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
const teamCode=value=>typeof value==='string'&&/^[A-Z]{3}$/.test(value.trim().toUpperCase())?value.trim().toUpperCase():'';
const unassignedSelection=s=>s.selectedPlayerId===null&&Number.isInteger(s.selectedTrackId);

// A visual reference's clothing description is separate from the real team
// confirmed for this roster slot or its colour group in the current video.
export function confirmedPlayerTeam(session,item){
  const profile=confirmed(item)?teamCode(item.playerProfile.team_abbreviation):'';
  if(profile)return profile;
  const group=session.teamIdentities?.[entityTeamSide(item||{})];
  return ['scoreboard_ocr_human_adopted','scoreboard_vision_human_adopted'].includes(group?.method)&&group.evidence?.videoSha256===session.videoHash?teamCode(group.team):'';
}
export function playerRosterTeam(session,item){return confirmedPlayerTeam(session,item)||teamCode(item?.team);}

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
  let ocrUI=null,teamsCatalog=[],readingEpoch=0,pendingReading=null,formRevision=0,readingSelection='';
  const value=rating=>rating==null?'未知':String(rating);
  const state=()=>api.getState();
  const formStamp=()=>JSON.stringify([formRevision,state().session.gameContext?.matchup]);
  function manualFormEdit(){formRevision++;readingEpoch++;pendingReading=null;}
  const entity=()=>state().session.entities.find(item=>item.id===state().active);
  const preferredTeam=()=>playerRosterTeam(state().session,entity());
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
    const unassigned=unassignedSelection(current);
    $('profileSummary').textContent=known&&!unassigned?`${profile.name} · 球队与球衣号码`:
      api.legacyRecognition===false?'人工填写 / 修正球员身份':'本场球队与球员姓名';
    $('profileSelected').textContent=api.legacyRecognition===false&&!known?`选中球员 ${number} · 可人工填写球队与号码，再从赛季名单确认姓名。`:unassigned?'已选中画面中的人。可以先识别号码，再关联到球员。':known?`球员 ${number}：${profile.name} · ${profile.team_abbreviation} · 球衣 #${profile.jersey_number}`:`选中球员 ${number} · 识别球队与球衣号码后，按所选赛季匹配姓名。`;
    $('profileClear').disabled=unassigned||(!item?.playerProfile&&!item?.ratingReference);
    const point=current.point;
    $('profileObservation').textContent=point?.x==null?'当前没有可靠位置。资料跟随此编号，画面中的对应关系仍需核对。':'资料跟随此编号，当前框仍需核对。';
    const signature=JSON.stringify([current.active,profile,reference,unassigned]);if(signature===cardSignature)return;cardSignature=signature;
    const target=$('profileRatingCard');target.replaceChildren();target.hidden=!known||unassigned;
    if(!known||unassigned)return;
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
  async function loadTeams(season,preferredTeam='',applyGuard=()=>true){
    const token=++teamEpoch,id=state().active,previousTeam=$('profileTeam').value;$('profileTeam').replaceChildren(option('','选择实际球队'));$('profileTeam').value='';$('profileTeam').disabled=true;$('profileLookup').disabled=true;
    if(!season)return;
    try{const data=await json(`/api/player-identity/options?season=${encodeURIComponent(season)}`);
      if(token!==teamEpoch||id!==state().active||season!==$('profileSeason').value)return;
      if(!Array.isArray(data.teams)||data.teams.some(team=>typeof team.abbreviation!=='string'||typeof team.name!=='string'))throw new Error('球队资料返回不完整，请重试。');
      teamsCatalog=data.teams;ocrUI?.render();
      const requestedTeam=applyGuard()?preferredTeam:($('profileTeam').value||previousTeam);
      $('profileTeam').replaceChildren(option('','选择实际球队'),...data.teams.map(team=>option(team.abbreviation,`${team.abbreviation} · ${team.name_zh||team.name}`)));
      $('profileTeam').value=data.teams.some(team=>team.abbreviation===requestedTeam)?requestedTeam:'';$('profileTeam').disabled=false;$('profileRetry').hidden=true;$('profileLookup').disabled=!ready();
    }catch(error){if(token!==teamEpoch||id!==state().active||season!==$('profileSeason').value)return;$('profileLookupStatus').textContent=error.message;$('profileRetry').hidden=false;}
  }
  function seedForm(){
    clearCandidates();teamEpoch++;const s=state(),unassigned=unassignedSelection(s),item=unassigned?null:entity(),profile=item?.playerProfile;
    $('profileSeason').value=profile?.season||state().session.gameContext?.season||'';
    $('profileJersey').value=profile?.jersey_number||(typeof item?.jersey==='string'?item.jersey:'');
    $('profileLookupStatus').textContent='填写视频赛季、球队和号码，再查找候选。';
    void loadTeams($('profileSeason').value,unassigned?'':preferredTeam());
  }
  async function loadCatalog(){
    const token=++catalogEpoch;$('profileSeason').disabled=true;
    try{const data=await json('/api/player-identity/options');if(token!==catalogEpoch)return;
      if(!Array.isArray(data.seasons)||data.seasons.some(season=>typeof season!=='string'))throw new Error('赛季资料返回不完整，请重试。');
      catalog=data;teamsCatalog=data.teams||[];$('profileSeason').replaceChildren(option('','选择视频赛季'),...catalog.seasons.map(season=>option(season,season)));$('profileSeason').disabled=false;$('profileRetry').hidden=true;seedForm();ocrUI?.render();
      if(!teamsCatalog.length&&catalog.seasons.length){const first=await json(`/api/player-identity/options?season=${encodeURIComponent(catalog.seasons[0])}`);if(token===catalogEpoch){teamsCatalog=first.teams||[];ocrUI?.render();}}
    }catch(error){if(token!==catalogEpoch)return;$('profileLookupStatus').textContent=error.message;$('profileRetry').hidden=false;}
  }
  function render(){
    const current=state(),item=entity();
    const selected=JSON.stringify([current.sample,current.variant,current.clip.video_sha256,current.clip.tracking_fingerprint,current.active,current.frame,current.selectedTrackId,current.selectedPlayerId]);
    if(selected!==readingSelection){readingSelection=selected;readingEpoch++;pendingReading=null;}
    const signature=JSON.stringify([current.active,current.selectedTrackId,current.selectedPlayerId,item?.playerProfile,item?.ratingReference,item?.jersey,item?.team,playerRosterTeam(current.session,item),current.session.gameContext?.season]);
    if(signature!==stateSignature){stateSignature=signature;seedForm();}
    $('profileLookup').disabled=!ready();card();ocrUI?.render();
  }
  $('profileSeason').onchange=()=>{const season=$('profileSeason').value,team=$('profileTeam').value,jersey=$('profileJersey').value,copy=clone(state().session);
    if(copy.entities.some(e=>confirmed(e)&&e.playerProfile.season!==season)){$('profileLookupStatus').textContent='已有其他赛季的确认身份；请先清除旧身份再更改赛季。';clearCandidates();void loadTeams(season,preferredTeam());return;}
    if(copy.gameContext?.season!==season){copy.gameContext={...copy.gameContext,season,seasonSource:'human_selection'};api.commit(copy);}
    $('profileJersey').value=jersey;invalidate();void loadTeams(season,team||preferredTeam()).then(()=>{if(pendingReading)void fillReading(...pendingReading);});};
  $('profileTeam').onchange=()=>{manualFormEdit();invalidate();};$('profileJersey').oninput=()=>{manualFormEdit();invalidate();};
  $('profileCandidate').onchange=()=>{manualFormEdit();$('profileConfirm').disabled=!candidate();};
  $('profileRetry').onclick=()=>{if(catalog)void loadTeams($('profileSeason').value,preferredTeam());else void loadCatalog();};
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
      $('profileCandidate').value='';$('profileCandidate').disabled=!data.candidates.length;$('profileConfirm').disabled=true;
      $('profileLookupStatus').textContent=data.status==='no_match'?'当前资料没有匹配项，请核对赛季、球队和号码。':data.status==='multiple_candidates'?`找到 ${data.candidates.length} 条整季名单候选，请核对并选择姓名。`:'找到候选，请核对姓名后选择，再确认。';
    }catch(error){if(token!==lookupEpoch||id!==state().active||!sameQuery(requested,query()))return;$('profileLookupStatus').textContent=error.message;}
    finally{if(token===lookupEpoch&&id===state().active)$('profileLookup').disabled=!ready();}
  };
  $('profileConfirm').onclick=()=>{
    if(unassignedSelection(state())){$('profileLookupStatus').textContent='先把画面中的人关联到球员，再确认姓名。';return;}
    const selected=candidate();if(!selected)return;
    try{const current=state(),copy=clone(current.session),record=current.clip.frames[current.frame],point=current.point;
      confirmPlayerProfile(copy,current.active,selected,lookup.query,{videoSha256:current.clip.video_sha256,
        trackingFingerprint:current.clip.tracking_fingerprint||null,variant:current.clip.tracking_revision||current.clip.variant||'original',
        frame:current.frame,sourceFrame:record.source_frame??record.frame,sourcePTS:record.source_time??record.time,
        trackId:point?.trackId??null,visibility:point?.x==null?'position_unknown':'observed_needs_review'},new Date().toISOString());
      manualFormEdit();api.commit(copy);$('profileLookupStatus').textContent=`编号 ${current.active.slice(1)} 的身份资料已确认，可撤销。`;api.toast('身份与 2K 能力已保存，可撤销。');
    }catch(error){$('profileLookupStatus').textContent=error.message;api.toast(error.message);}
  };
  $('profileClear').onclick=()=>{const current=state();if(unassignedSelection(current))return;const copy=clone(current.session);if(!clearPlayerProfile(copy,current.active))return;manualFormEdit();api.commit(copy);$('profileLookupStatus').textContent='身份资料已清除，原编号与手工记录保留，可撤销。';api.toast('身份资料已清除，可撤销。');};
  $('profileSeason').replaceChildren(option('','选择视频赛季'));clearCandidates();render();void loadCatalog();
  async function fillReading(reading,context){
    if(context.formRevision!==formStamp()){pendingReading=null;$('profileLookupStatus').textContent='已保留你刚修改的球队、号码或姓名；上方识别建议仅供参考。';return;}
    const current=state(),observation=selectedIdentityObservation(current);
    if(context.data.videoSha256!==current.clip.video_sha256||context.data.trackingFingerprint!==current.clip.tracking_fingerprint||observation?.trackId!==context.observation.trackId||observation?.frame!==context.observation.frame)return;
    pendingReading=[reading,context];const token=++readingEpoch,id=current.active;
    const stillCurrent=()=>{const latest=state(),point=selectedIdentityObservation(latest);return token===readingEpoch&&id===latest.active&&context.formRevision===formStamp()&&context.data.videoSha256===latest.clip.video_sha256&&context.data.trackingFingerprint===latest.clip.tracking_fingerprint&&point?.trackId===context.observation.trackId&&point?.frame===context.observation.frame;};
    if(!context.playerId||context.playerId!==id){$('profileLookupStatus').textContent='识别建议已保留；请先关联到球员，再确认姓名。';return;}
    if(confirmed(entity())){$('profileLookupStatus').textContent='已有人工确认的姓名，识别建议未覆盖；如需修改请先清除身份。';return;}
    if(reading.jersey)$('profileJersey').value=reading.jersey;
    if(!$('profileSeason').value){$('profileLookupStatus').textContent='请先选择视频赛季，随后自动匹配球员姓名。';return;}
    await loadTeams($('profileSeason').value,reading.team||preferredTeam(),stillCurrent);
    if(!stillCurrent())return;
    if(reading.jersey)$('profileJersey').value=reading.jersey;
    invalidate();if(ready()){await $('profileLookup').onclick();if(!stillCurrent())return;if(lookup?.candidates.length===1){$('profileCandidate').value=lookup.candidates[0].player_id;$('profileConfirm').disabled=false;$('profileLookupStatus').textContent='已匹配姓名，核对后点“确认身份”。';}}
  }
  if(api.legacyRecognition!==false)ocrUI=mountSimpleIdentityRecognition({...api,getTeams:()=>teamsCatalog,getFormRevision:formStamp,onReading:fillReading,onTeam:()=>{ocrUI?.render();}});
  else $('identityOcr').hidden=true;
  return {render,recognizeSelected:()=>ocrUI?.recognizeSelected()};
}
