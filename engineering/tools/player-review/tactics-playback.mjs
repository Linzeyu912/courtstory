// Commands are returned after state changes, so synchronous player callbacks cannot re-arm a stop.
export function createPhasePlayback(){
  let phases=[],phaseId=null,status='inactive',targetFrame=null,resume=false,terminal=false;
  const current=()=>phases.find(p=>p.phaseId===phaseId);
  const next=()=>phases[phases.findIndex(p=>p.phaseId===phaseId)+1];
  function locate(frame,play=false,end=false){status='seeking';targetFrame=frame;resume=play;terminal=end;return [{type:'pause'},{type:'seek',frame}];}
  return {
    state:()=>({phaseId,status,targetFrame}),
    configure(list,id){phases=list.map(p=>({...p}));phaseId=phases.some(p=>p.phaseId===id)?id:phases[0]?.phaseId;},
    select(id){if(!phases.some(p=>p.phaseId===id))return [];phaseId=id;return locate(current().freezeFrame);},
    continue(frame){if(!current()||status==='inactive'||status==='seeking')return [];const stop=next()?.freezeFrame??current().endFrameExclusive-1;if(frame<current().freezeFrame||frame>=stop)return locate(current().freezeFrame,true);status='playing';return [{type:'play'}];},
    replay(){return current()?locate(current().freezeFrame,true):[];},
    pause(){if(status==='inactive')return [];resume=false;terminal=false;status=targetFrame===null?'paused':'seeking';return [{type:'pause'}];},
    externalSeek(frame){if(status==='inactive')return [];const selected=phases.find(p=>frame>=p.startFrame&&frame<p.endFrameExclusive)||phases[frame<phases[0]?.startFrame?0:phases.length-1];const changed=selected&&selected.phaseId!==phaseId;if(selected)phaseId=selected.phaseId;status='seeking';targetFrame=frame;resume=false;terminal=false;return [{type:'pause'},...(changed?[{type:'phase',phaseId}]:[])];},
    presented(frame){
      if(status==='seeking'){
        if(frame!==targetFrame)return [];targetFrame=null;status=resume?'playing':terminal?'ended':'paused';const play=resume;resume=false;terminal=false;return play?[{type:'play'}]:[];
      }
      if(status!=='playing')return [];
      const following=next(),stop=following?.freezeFrame??current().endFrameExclusive-1;
      if(frame<stop)return [];
      if(following){phaseId=following.phaseId;const commands=locate(stop);return [commands[0],{type:'phase',phaseId},commands[1]];}
      return locate(stop,false,true);
    },
    leave(){if(status==='inactive')return [];status='inactive';targetFrame=null;resume=false;terminal=false;return [{type:'pause'}];}
  };
}
