import {validateFrameRange} from './tactics-time-range.mjs';
export const MIN_EXPLANATION_HOLD_SECONDS=.9;
export function explanationTiming(holdSeconds,fps=30){
  const total=Math.round(holdSeconds*fps),settleFrames=Math.min(Math.round(fps/6),total),drawFrames=Math.min(Math.round(.7*fps),total-settleFrames);
  return {settleFrames,drawFrames,holdFrames:total-settleFrames-drawFrames};
}
export function validateTacticKeyframes(document){
  const value=document.tacticKeyframes;if(value===undefined)return;
  if(value?.schemaVersion!==1||!Array.isArray(value.items)||value.items.length>256)throw new Error('战术关键帧格式无效。');
  const ids=new Set();for(const k of value.items){
    if(!k||Object.keys(k).some(key=>!['id','frame','annotationIds','freeze','holdSeconds','kind'].includes(key))||k.kind!==undefined&&k.kind!=='explanation'||typeof k.id!=='string'||!k.id||ids.has(k.id)||!Number.isSafeInteger(k.frame)||k.frame<0||k.frame>=document.review.sourceFrameMapping.length||typeof k.freeze!=='boolean'||!Number.isFinite(k.holdSeconds)||k.holdSeconds<0||k.holdSeconds>30||!Array.isArray(k.annotationIds)||!k.annotationIds.length&&k.kind!=='explanation'||new Set(k.annotationIds).size!==k.annotationIds.length)throw new Error('战术关键帧内容无效。');
    if(k.kind==='explanation'&&k.holdSeconds<MIN_EXPLANATION_HOLD_SECONDS)throw new Error('讲解暂停额外停留至少 0.9 秒，以完成停稳和绘制。');
    ids.add(k.id);
    for(const id of k.annotationIds){const a=document.annotations?.items.find(a=>a.id===id);if(!a)throw new Error('讲解暂停点引用无效。');
      if(k.kind==='explanation'){
        if(k.frame>(a.actionRange??a).startFrame||k.frame<a.phaseSnapshot.startFrame)throw new Error('讲解暂停点需要早于或等于关联对象的动作起点，并位于同一阶段。');
        if(value.items.some(other=>other!==k&&other.kind==='explanation'&&other.annotationIds.includes(id)))throw new Error('每个标注只关联一个首次讲解暂停点；请先解除原关联。');
      }else if(k.frame<a.startFrame||k.frame>=a.endFrameExclusive)throw new Error('关键帧引用或范围无效。');
    }
  }
}
export function upsertTacticKeyframe(document,keyframe){
  const next=structuredClone(document);next.tacticKeyframes??={schemaVersion:1,items:[]};
  const k={id:keyframe.id??`cue-${crypto.randomUUID()}`,freeze:true,holdSeconds:2.5,...keyframe};
  const same=k.kind==='explanation'?next.tacticKeyframes.items.find(p=>p.id!==k.id&&p.kind==='explanation'&&p.frame===k.frame):null;
  next.tacticKeyframes.items=next.tacticKeyframes.items.filter(p=>p.id!==k.id&&p!==same);
  next.tacticKeyframes.items.push(same?{...k,id:same.id,annotationIds:[...new Set([...same.annotationIds,...k.annotationIds])],holdSeconds:Math.max(same.holdSeconds,k.holdSeconds)}:k);next.tacticKeyframes.items.sort((a,b)=>a.frame-b.frame);
  validateTacticKeyframes(next);return next;
}
export function removeTacticKeyframe(document,id){const next=structuredClone(document);if(next.tacticKeyframes)next.tacticKeyframes.items=next.tacticKeyframes.items.filter(k=>k.id!==id);return next;}
export function compileTacticKeyframes(document){
  validateTacticKeyframes(document);const byFrame=new Map();
  for(const k of document.tacticKeyframes?.items??[]){
    if(!k.freeze)continue;
    const existing=byFrame.get(k.frame)??{frame:k.frame,phaseId:document.playDefinition.phases.find(p=>k.frame>=p.startFrame&&k.frame<p.endFrameExclusive).phaseId,annotationIds:[],holdSeconds:0};
    if(k.kind==='explanation')existing.kind='explanation';
    existing.holdSeconds=Math.max(existing.holdSeconds,k.holdSeconds);existing.annotationIds=[...new Set([...existing.annotationIds,...k.annotationIds])];byFrame.set(k.frame,existing);
  }
  return [...byFrame.values()].sort((a,b)=>a.frame-b.frame);
}
