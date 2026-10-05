import {projectAnnotations} from './tactics-annotations.mjs';
import {calibrationAt} from './court.mjs';
export function projectCourtAnnotations(document,{frame,view='court',...options}){
  if(!['court','video'].includes(view))throw new Error('预览类型无效。');
  const scene=projectAnnotations(document,{frame,phaseId:document.playDefinition.phases.find(p=>frame>=p.startFrame&&frame<p.endFrameExclusive)?.phaseId,...options});
  return {...scene,view,items:scene.items.map(item=>({...item,geometry:item[view]}))};
}
export function courtProjectionGaps(document){
  const gaps=[];
  for(const a of document.annotations?.items??[]){
    if(a.space!=='court')continue;let run=null;
    const early=(document.tacticKeyframes?.items??[]).filter(k=>k.kind==='explanation'&&k.annotationIds.includes(a.id)).map(k=>k.frame);
    for(let frame=Math.min(a.startFrame,...early);frame<a.endFrameExclusive;frame++){
      const mapping=calibrationAt(document.review.court?.calibration,frame,document.review.sourceFrameMapping,document.review.settings?.cuts??[]);
      if(!mapping){if(run)run.endFrameExclusive=frame+1;else{run={annotationId:a.id,startFrame:frame,endFrameExclusive:frame+1,reason:'calibration_unavailable'};gaps.push(run);}}else run=null;
    }
  }
  return gaps;
}
