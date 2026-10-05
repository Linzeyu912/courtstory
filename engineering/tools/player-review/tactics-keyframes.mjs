import {validateFrameRange} from './tactics-time-range.mjs';
export function validateTacticKeyframes(document){
  const value=document.tacticKeyframes;if(value===undefined)return;
  if(value?.schemaVersion!==1||!Array.isArray(value.items)||value.items.length>256)throw new Error('战术关键帧格式无效。');
  const ids=new Set();for(const k of value.items){
    if(!k||Object.keys(k).some(key=>!['id','frame','annotationIds','freeze','holdSeconds'].includes(key))||typeof k.id!=='string'||!k.id||ids.has(k.id)||!Number.isSafeInteger(k.frame)||k.frame<0||k.frame>=document.review.sourceFrameMapping.length||typeof k.freeze!=='boolean'||!Number.isFinite(k.holdSeconds)||k.holdSeconds<0||k.holdSeconds>30||!Array.isArray(k.annotationIds)||!k.annotationIds.length||new Set(k.annotationIds).size!==k.annotationIds.length)throw new Error('战术关键帧内容无效。');
    ids.add(k.id);
    for(const id of k.annotationIds){const a=document.annotations?.items.find(a=>a.id===id);if(!a||k.frame<a.startFrame||k.frame>=a.endFrameExclusive)throw new Error('关键帧引用或范围无效。');}
  }
}
export function upsertTacticKeyframe(document,keyframe){
  const next=structuredClone(document);next.tacticKeyframes??={schemaVersion:1,items:[]};
  const k={id:keyframe.id??`cue-${crypto.randomUUID()}`,freeze:true,holdSeconds:2.5,...keyframe};
  next.tacticKeyframes.items=next.tacticKeyframes.items.filter(p=>p.id!==k.id);next.tacticKeyframes.items.push(k);next.tacticKeyframes.items.sort((a,b)=>a.frame-b.frame);
  validateTacticKeyframes(next);return next;
}
export function removeTacticKeyframe(document,id){const next=structuredClone(document);if(next.tacticKeyframes)next.tacticKeyframes.items=next.tacticKeyframes.items.filter(k=>k.id!==id);return next;}
export function compileTacticKeyframes(document){
  validateTacticKeyframes(document);const byFrame=new Map();
  for(const k of document.tacticKeyframes?.items??[]){
    if(!k.freeze)continue;
    const existing=byFrame.get(k.frame)??{frame:k.frame,phaseId:document.playDefinition.phases.find(p=>k.frame>=p.startFrame&&k.frame<p.endFrameExclusive).phaseId,annotationIds:[],holdSeconds:0};
    existing.holdSeconds=Math.max(existing.holdSeconds,k.holdSeconds);existing.annotationIds=[...new Set([...existing.annotationIds,...k.annotationIds])];byFrame.set(k.frame,existing);
  }
  return [...byFrame.values()].sort((a,b)=>a.frame-b.frame);
}
