// The image-reading ledger and locked host snapshot are the only evidence inputs.
export function prepareShotFeedback(plan,{readFrames,frameTimes,sourceCuts=[],ratingContext={}}={}){
  const events=new Map(plan.events.map(e=>[e.eventId,e])),nodes=(plan.nodes??[]).filter(n=>n.kind==='shot_release');
  for(const event of events.values()){
    if(event.shotStatus!==undefined&&event.kind!=='shot')throw new Error('shotStatus requires shot event kind');
    if(event.kind!=='shot')continue;
    if(!['confirmed','uncertain'].includes(event.shotStatus))throw new Error('shot requires confirmed or uncertain shotStatus');
    const count=nodes.filter(n=>n.eventId===event.eventId).length;
    if(event.shotStatus==='confirmed'&&count!==1)throw new Error('every confirmed shot requires exactly one shot_release node');
    if(event.shotStatus==='uncertain'&&count)throw new Error('uncertain shot cannot masquerade as confirmed release');
  }
  if(!nodes.length){if((plan.nodes??[]).some(n=>'shotFeedback' in n))throw new Error('shotFeedback requires shot_release kind');return;}
  const people=new Map((plan.participants??[]).map(p=>[p.participantId,p])),cues=new Map(plan.cues.map(c=>[c.cueId,c]));
  const ratingRecords=new Map((ratingContext.records??[]).map(r=>[r.ratingRef,r]));
  const actualTime=frame=>{
    const row=frameTimes?.get(frame),ratio=row?.timeBase?.split('/').map(Number);
    if(!Number.isSafeInteger(row?.pts)||!ratio||ratio.length!==2||!Number.isFinite(ratio[0])||!Number.isFinite(ratio[1])||ratio[1]===0)throw new Error('shot release requires actual decoded PTS/timeBase');
    const t=row.pts*ratio[0]/ratio[1];if(!Number.isFinite(t))throw new Error('invalid decoded PTS');return t;
  };
  for(const node of nodes){
    const event=events.get(node.eventId),a=node.anchorAssetFrame,s=node.shotFeedback;
    if(event?.kind!=='shot'||event.shotStatus!=='confirmed')throw new Error('shot_release requires confirmed shot event');
    if(!Number.isSafeInteger(a)||!readFrames.has(a))throw new Error('shot release anchor must be actually returned');
    if(!(node.cueIds??[]).some(id=>cues.get(id)?.delivery==='pause'))throw new Error('shot release requires a pause cue');
    if(!s||typeof s!=='object'||Object.keys(s).some(k=>!['shooterRef','defenderRefs','opportunity','pressure','evidenceFrames','defenseWindow','ratingsRefs'].includes(k)))throw new Error('shotFeedback permits references, not invented rating values');
    if(typeof s.shooterRef!=='string'||!s.shooterRef||!Array.isArray(s.defenderRefs)||s.defenderRefs.some(p=>typeof p!=='string')||new Set(s.defenderRefs).size!==s.defenderRefs.length||s.defenderRefs.includes(s.shooterRef))throw new Error('shot requires shooterRef and unique defenderRefs');
    const participantRefs=[s.shooterRef,...s.defenderRefs];
    for(const pid of participantRefs){const p=people.get(pid);if(!(node.participantRefs??[]).includes(pid)||!p||a<p.validRange?.startFrame||a>p.validRange?.endFrame)throw new Error('shot participant outside release identity interval');}
    for(const [key,grades] of [['opportunity',['good','fair','poor','unknown']],['pressure',['low','medium','high','unknown']]]){
      const value=s[key];if(!value||Object.keys(value).sort().join(',')!=='grade,reason'||!grades.includes(value.grade)||typeof value.reason!=='string'||!value.reason.trim())throw new Error(`shot ${key} requires independent grade and reason`);
    }
    if(!Array.isArray(s.ratingsRefs)||s.ratingsRefs.some(r=>typeof r!=='string'||!ratingRecords.has(r)||!participantRefs.includes(ratingRecords.get(r).participantId)))throw new Error('shot rating refs must select its participants from host context');
    s.ratingsRefs=[...new Set([...s.ratingsRefs,...[...ratingRecords].filter(([,r])=>participantRefs.includes(r.participantId)).map(([r])=>r)])].sort();
    if(!Array.isArray(s.evidenceFrames)||s.evidenceFrames.some(f=>!Number.isSafeInteger(f)||!readFrames.has(f)||!frameTimes?.has(f)))throw new Error('shot evidence must be actually returned frames');
    if(s.evidenceFrames.some(f=>f>a))throw new Error('shot evidence cannot be after release');
    const release=actualTime(a),target=release-1,prior=[...frameTimes.keys()].filter(f=>f<=a).sort((a,b)=>a-b);
    const targetStart=prior.reduce((best,f)=>Math.abs(actualTime(f)-target)<Math.abs(actualTime(best)-target)?f:best,prior[0]);
    const start=Math.max(targetStart,node.evidenceWindow?.startFrame??0,0,...sourceCuts.filter(c=>c<=a));
    if(s.evidenceFrames.some(f=>f<start))throw new Error('shot evidence outside pre-release window');
    const duration=release-actualTime(start),times=[...new Set(s.evidenceFrames.map(actualTime))].sort((a,b)=>a-b);
    const complete=duration>=.9&&times.length>=5&&times[0]<=target+.15&&s.evidenceFrames.includes(a)&&times.slice(1).every((t,i)=>t-times[i]<=.25+1e-8);
    const coverage=complete?'complete':times.length?'partial':'unavailable';
    const reason=complete?'已返回接近完整前一秒及出手帧，采样间隔不超过 0.25 秒。':'前一秒证据不完整：片段起点、切镜或缺失关键采样，评价保持 unknown。';
    s.defenseWindow={startFrame:start,endFrame:a,requestedSeconds:1,actualDurationSeconds:duration,coverage,reason};
    if(!complete)for(const key of ['opportunity','pressure'])s[key]={grade:'unknown',reason};
  }
}
