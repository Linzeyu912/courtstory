import {preparationDigest,validateCourtPreparation} from './court-preparation.mjs';
import {validateFrameRange} from './tactics-time-range.mjs';
const presets={off:{seconds:0,weight:0},light:{seconds:.09,weight:.35},standard:{seconds:.16,weight:.55}};
const median=a=>{const b=a.toSorted((x,y)=>x-y);return b[Math.floor(b.length/2)];};
export function previewCourtSmoothing(preparation,{entityIds,range,preset='light'}){
  validateCourtPreparation(preparation);validateFrameRange(preparation.frameMapping,range);
  if(!presets[preset]||!Array.isArray(entityIds)||!entityIds.length||new Set(entityIds).size!==entityIds.length||entityIds.some(id=>!preparation.rawByPlayer[id]))throw new Error('平滑球员或强度无效。');
  const candidate={version:1,algorithm:'conservative-time-median-v1',baseDigest:preparationDigest(preparation),entityIds:[...entityIds],range:{...range},preset,parameters:presets[preset],pointsByPlayer:{}},diff={changed:0,maxDisplacement:0},issues=[];
  for(const id of entityIds){
    const points=preparation.rawByPlayer[id],next=structuredClone(points),breaks=new Set(preparation.breaksByPlayer[id].map(b=>b.frame));
    for(let i=range.startFrame;i<range.endFrameExclusive;i++){
      const p=points[i];if(!Number.isFinite(p.x)){issues.push({entityId:id,frame:i,reason:p.source});continue;}
      if(preset==='off'||p.locked||i===range.startFrame||i===range.endFrameExclusive-1||breaks.has(i))continue;
      let left=i,right=i;
      while(left>range.startFrame&&!breaks.has(left)&&points[left-1].x!==null&&!points[left-1].locked&&p.time-points[left-1].time<=presets[preset].seconds)left--;
      while(right+1<range.endFrameExclusive&&!breaks.has(right+1)&&points[right+1].x!==null&&!points[right+1].locked&&points[right+1].time-p.time<=presets[preset].seconds)right++;
      if(left===i||right===i)continue;
      const before=points[i-1],after=points[i+1],a={x:p.x-before.x,y:p.y-before.y},b={x:after.x-p.x,y:after.y-p.y};
      // Keep turns/stops when displacement is larger than the noise scale.
      if((a.x*b.x+a.y*b.y<=0&&Math.max(Math.hypot(a.x,a.y),Math.hypot(b.x,b.y))>.25)||Math.hypot(a.x,a.y)<.015||Math.hypot(b.x,b.y)<.015)continue;
      const window=points.slice(left,right+1),x=p.x*(1-presets[preset].weight)+median(window.map(q=>q.x))*presets[preset].weight,y=p.y*(1-presets[preset].weight)+median(window.map(q=>q.y))*presets[preset].weight,delta=Math.hypot(x-p.x,y-p.y);
      if(delta>.25)continue;
      next[i]={...p,x,y,preparedSmoothed:delta>0};if(delta>0){diff.changed++;diff.maxDisplacement=Math.max(diff.maxDisplacement,delta);}
    }
    candidate.pointsByPlayer[id]=next;
  }
  return {candidate,diff,issues};
}
export function adoptCourtSmoothing(preparation,candidate){
  if(candidate?.baseDigest!==preparationDigest(preparation))throw new Error('平滑预览来源已变化，请重新预览。');
  const expected=previewCourtSmoothing(preparation,candidate).candidate;
  if(preparationDigest(candidate)!==preparationDigest(expected))throw new Error('平滑候选与算法结果不一致。');
  const next=structuredClone(preparation);
  for(const id of candidate.entityIds)for(let f=candidate.range.startFrame;f<candidate.range.endFrameExclusive;f++)next.preparedByPlayer[id][f]=structuredClone(candidate.pointsByPlayer[id][f]);
  next.revision++;next.smoothingPatches.push({algorithm:candidate.algorithm,entityIds:candidate.entityIds,range:candidate.range,preset:candidate.preset,parameters:candidate.parameters});
  return next;
}
export function replayCourtSmoothing(preparation,patches){let p=preparation;for(const patch of patches)p=adoptCourtSmoothing(p,previewCourtSmoothing(p,patch).candidate);return p;}
