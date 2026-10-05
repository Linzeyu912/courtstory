// Commands are returned after state changes, so synchronous player callbacks cannot re-arm a stop.
export function createPhasePlayback(){
  let phases=[],phaseId=null,status='inactive',targetFrame=null,resume=false,terminal=false,pauseFrames=new Map(),armedStop=null,sourceMode=false,sourceEnd=null;
  const current=()=>phases.find(p=>p.phaseId===phaseId);
  const next=()=>phases[phases.findIndex(p=>p.phaseId===phaseId)+1];
  const entry=p=>pauseFrames.get(p.phaseId)[0];
  function followingStop(frame){
    const p=current(),following=next(),inside=pauseFrames.get(phaseId).find(f=>f>frame);
    if(inside!==undefined)return {phaseId,frame:inside,terminal:!following&&inside===p.endFrameExclusive-1};
    return following?{phaseId:following.phaseId,frame:entry(following),terminal:false}:{phaseId,frame:p.endFrameExclusive-1,terminal:true};
  }
  function locate(frame,play=false,end=false){
    status='seeking';targetFrame=frame;resume=play;terminal=end;armedStop=play?followingStop(frame):null;
    return [{type:'pause'},{type:'seek',frame}];
  }
  return {
    state:()=>({phaseId,status,targetFrame}),
    configure(list,id,cues=[]){
      phases=list.map(p=>({...p}));phaseId=phases.some(p=>p.phaseId===id)?id:phases[0]?.phaseId;
      pauseFrames=new Map(phases.map(p=>[p.phaseId,[...new Set([p.freezeFrame,...cues.filter(c=>c?.phaseId===p.phaseId&&Number.isSafeInteger(c.frame)&&c.frame>=p.startFrame&&c.frame<p.endFrameExclusive).map(c=>c.frame)])].sort((a,b)=>a-b)]));
    },
    select(id){sourceMode=false;if(!phases.some(p=>p.phaseId===id))return [];phaseId=id;return locate(entry(current()));},
    playSource(frame,endFrameExclusive=phases.at(-1)?.endFrameExclusive){
      if(!current()||status==='seeking')return [];sourceMode=true;sourceEnd=endFrameExclusive;armedStop=null;status='playing';return [{type:'play'}];
    },
    continue(frame){
      sourceMode=false;
      if(!current()||status==='inactive'||status==='seeking')return [];
      const start=entry(current()),limit=next()?entry(next()):current().endFrameExclusive-1;
      if(frame<start||frame>=limit)return locate(start,true);
      // Arm before play: the next presented frame may already have skipped the cue.
      armedStop=followingStop(frame);status='playing';return [{type:'play'}];
    },
    replay(){sourceMode=false;return current()?locate(entry(current()),true):[];},
    pause(){sourceMode=false;if(status==='inactive')return [];resume=false;terminal=false;armedStop=null;status=targetFrame===null?'paused':'seeking';return [{type:'pause'}];},
    externalSeek(frame){if(status==='inactive')return [];const selected=phases.find(p=>frame>=p.startFrame&&frame<p.endFrameExclusive)||phases[frame<phases[0]?.startFrame?0:phases.length-1];const changed=selected&&selected.phaseId!==phaseId;if(selected)phaseId=selected.phaseId;status='seeking';targetFrame=frame;resume=false;terminal=false;armedStop=null;return [{type:'pause'},...(changed?[{type:'phase',phaseId}]:[])];},
    presented(frame){
      if(status==='seeking'){
        if(frame!==targetFrame)return [];targetFrame=null;status=resume?'playing':terminal?'ended':'paused';const play=resume;resume=false;terminal=false;return play?[{type:'play'}]:[];
      }
      if(sourceMode&&status==='playing'){
        if(frame>=sourceEnd-1){sourceMode=false;return locate(sourceEnd-1,false,true);}
        const p=phases.find(p=>frame>=p.startFrame&&frame<p.endFrameExclusive);if(p&&p.phaseId!==phaseId){phaseId=p.phaseId;return [{type:'phase',phaseId}];}return [];
      }
      if(status!=='playing'||!armedStop||frame<armedStop.frame)return [];
      const stop=armedStop,changed=stop.phaseId!==phaseId;phaseId=stop.phaseId;
      const commands=locate(stop.frame,false,stop.terminal);
      return changed?[commands[0],{type:'phase',phaseId},commands[1]]:commands;
    },
    leave(){sourceMode=false;if(status==='inactive')return [];status='inactive';targetFrame=null;resume=false;terminal=false;armedStop=null;return [{type:'pause'}];}
  };
}
