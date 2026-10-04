import {createSourceBinding} from '../tactical-overlay/binding.mjs';
import {validateInputs} from '../tactical-overlay/validation.mjs';
import {validatePresentation} from './tactics-presentation.mjs';
import {validateAnnotations,updateAnnotation} from './tactics-annotations.mjs';
import {validateProduction,preserveProductionMediaBinding} from './tactics-production.mjs';

export const ACTION_KINDS={move:'跑位',cut:'切入',roll:'顺下',pop:'外弹',hold:'持位',space:'拉开',screen:'掩护'};
export const clone=value=>JSON.parse(JSON.stringify(value));
export async function createTacticsDocument(review){
  review=clone(review);
  const count=review.sourceFrameMapping.length;
  const participants=review.entities.map(e=>({id:e.id,name:e.name||e.id,role:e.role||'player'}));
  return {schemaVersion:1,title:'当前视频 · 战术审核',notes:'',review,
    playDefinition:{schemaVersion:1,synthetic:review.synthetic===true,playId:'manual-play',revision:1,
      sourceBinding:await createSourceBinding(review),startFrame:0,endFrameExclusive:count,participants,
      phases:[{phaseId:'phase-1',order:0,title:'阶段 1',startFrame:0,endFrameExclusive:count,freezeFrame:0,
        participantIds:participants.map(p=>p.id),actionIds:[],relationIds:[]}],actions:[],relations:[],reviewEvidence:[]}};
}
export async function validateDocument(document){
  if(document?.schemaVersion!==1||typeof document.title!=='string'||typeof document.notes!=='string')throw new Error('战术文件格式不正确。');
  const presentationIssues=validatePresentation(document.presentation);
  if(presentationIssues.length)throw new Error(`展示修正无效：${presentationIssues.map(i=>i.details.field).join('、')}`);
  const annotationIssues=validateAnnotations(document.annotations,document);
  if(annotationIssues.length)throw new Error(`画布标注无效：${annotationIssues.map(i=>i.details.field).join('、')}`);
  const productionIssues=validateProduction(document);
  if(productionIssues.length)throw new Error(`视频编排无效：${productionIssues.map(i=>i.details.field).join('、')}`);
  if(document.archivedTactics){
    const a=document.archivedTactics;
    if(a.schemaVersion!==1||!['annotations','participants','actions','relations'].every(k=>Array.isArray(a[k]))||
      validateAnnotations({schemaVersion:1,items:a.annotations},document).length)throw new Error('归档图形记录无效。');
  }
  const {review,playDefinition:play}=document;
  const issues=validateInputs({review,playDefinition:play,phaseId:play?.phases?.[0]?.phaseId,freezeFrame:play?.phases?.[0]?.freezeFrame});
  const errors=issues.filter(i=>i.severity==='fatal');
  if(errors.length)throw new Error(`战术定义无效：${errors.map(i=>i.details?.field||i.code).join('、')}`);
  const binding=await createSourceBinding(review);
  if(Object.keys(binding).some(key=>binding[key]!==play.sourceBinding[key]))throw new Error('轨迹快照已变化，请更新战术绑定后重新核对。');
  return document;
}
export function reindexPhases(play){
  play.phases.sort((a,b)=>a.startFrame-b.startFrame).forEach((phase,order)=>{
    phase.order=order;
    phase.actionIds=play.actions.filter(a=>a.startFrame<phase.endFrameExclusive&&a.endFrameExclusive>phase.startFrame).map(a=>a.actionId);
    phase.relationIds=play.relations.filter(r=>r.startFrame<phase.endFrameExclusive&&r.endFrameExclusive>phase.startFrame).map(r=>r.id);
    phase.participantIds=play.participants.map(p=>p.id);
  });
}
export function splitPhase(document,phaseId,frame){
  const d=clone(document),p=d.playDefinition,s=p.phases.find(s=>s.phaseId===phaseId);
  if(p.phases.length>=40)throw new Error('一份审核最多 40 个阶段，请按回合分别处理。');
  if(!s||!Number.isInteger(frame)||frame<=s.startFrame||frame>=s.endFrameExclusive)throw new Error('分段帧需要在当前阶段起点之后、终点以内。');
  const next={...clone(s),phaseId:`phase-${crypto.randomUUID()}`,title:`阶段 ${p.phases.length+1}`,startFrame:frame,freezeFrame:frame};
  s.endFrameExclusive=frame;s.freezeFrame=Math.min(s.freezeFrame,frame-1);p.phases.push(next);p.revision++;reindexPhases(p);return d;
}
export function removePhase(document,phaseId){
  const d=clone(document),p=d.playDefinition,index=p.phases.findIndex(s=>s.phaseId===phaseId);
  if(p.phases.length===1||index<0)throw new Error('至少保留一个阶段。');
  const s=p.phases[index],other=p.phases[index?index-1:1];
  other.startFrame=Math.min(other.startFrame,s.startFrame);other.endFrameExclusive=Math.max(other.endFrameExclusive,s.endFrameExclusive);
  p.phases.splice(index,1);p.revision++;reindexPhases(p);return d;
}
export function upsertAction(document,input){
  const d=clone(document),p=d.playDefinition;
  if(!p.participants.some(e=>e.id===input.actorId)||!ACTION_KINDS[input.kind]||!Number.isInteger(input.startFrame)||!Number.isInteger(input.endFrameExclusive)||input.startFrame< p.startFrame||input.endFrameExclusive>p.endFrameExclusive||input.startFrame>=input.endFrameExclusive)throw new Error('检查球员、动作类型和起止帧；结束帧不能早于起始帧。');
  const id=input.actionId||`action-${crypto.randomUUID()}`,old=p.actions.findIndex(a=>a.actionId===id);
  const a={actionId:id,actorId:input.actorId,participantIds:[input.actorId],kind:input.kind,
    startFrame:input.startFrame,endFrameExclusive:input.endFrameExclusive,source:'human_video_review',reviewStatus:'needs_review',note:input.note||''};
  if(old>=0)p.actions[old]=a;else p.actions.push(a);
  const removedRelations=p.relations.filter(r=>r.actionId===id).map(r=>r.id);
  p.relations=p.relations.filter(r=>r.actionId!==id);
  p.reviewEvidence=p.reviewEvidence.filter(e=>e.actionId!==id&&!removedRelations.includes(e.relationId));
  if(input.kind==='screen'&&input.beneficiaryId){
    const ids=[input.actorId,input.beneficiaryId,input.defenderId].filter(Boolean);
    if(new Set(ids).size!==ids.length||ids.some(id=>!p.participants.some(e=>e.id===id)))throw new Error('掩护者、受掩护者和防守者需要是不同的参与者。');
    a.participantIds=ids;
    p.relations.push({id:`relation-${id}`,actionId:id,screenerId:input.actorId,beneficiaryId:input.beneficiaryId,defenderId:input.defenderId||null,
      startFrame:a.startFrame,endFrameExclusive:a.endFrameExclusive,position:null,orientation:null,source:'human_video_review',reviewStatus:'needs_review'});
  }
  p.revision++;reindexPhases(p);return d;
}
export function removeAction(document,id){
  const d=clone(document),p=d.playDefinition,relations=p.relations.filter(r=>r.actionId===id).map(r=>r.id);
  p.actions=p.actions.filter(a=>a.actionId!==id);p.relations=p.relations.filter(r=>r.actionId!==id);
  p.reviewEvidence=p.reviewEvidence.filter(e=>e.actionId!==id&&!relations.includes(e.relationId));p.revision++;reindexPhases(p);return d;
}
export function reviewAction(document,id,reviewer,reviewed){
  if(reviewed&&!reviewer.trim())throw new Error('填写审核人，再记录本动作的人工审核。');
  const d=clone(document),p=d.playDefinition,a=p.actions.find(a=>a.actionId===id);
  if(!a)throw new Error('未找到动作。');
  a.reviewStatus=reviewed?'reviewed':'needs_review';
  p.reviewEvidence=p.reviewEvidence.filter(e=>!(e.domain==='tactic'&&e.actionId===id));
  if(reviewed)p.reviewEvidence.push({domain:'tactic',entityId:null,actionId:id,relationId:null,
    startFrame:a.startFrame,endFrameExclusive:a.endFrameExclusive,sourceFrames:[a.startFrame,a.endFrameExclusive-1],reviewer:reviewer.trim(),method:'human_video_review',conclusion:'reviewed'});
  p.revision++;return d;
}
export async function refreshSnapshot(document,review){
  const d=await preserveProductionMediaBinding(document),p=d.playDefinition;
  if(d.review.videoSha256!==review.videoSha256||d.review.width!==review.width||d.review.height!==review.height||d.review.trackingFingerprint!==review.trackingFingerprint||JSON.stringify(d.review.sourceFrameMapping)!==JSON.stringify(review.sourceFrameMapping))throw new Error('视频、尺寸或模型版本不同，请在对应视频下新建战术草稿。');
  const ids=new Set(review.entities.map(e=>e.id)),removed=p.participants.filter(person=>!ids.has(person.id));
  if(removed.length){
    const archive=d.archivedTactics??={schemaVersion:1,participants:[],annotations:[],actions:[],relations:[]};
    for(const person of removed)if(!archive.participants.some(e=>e.id===person.id))archive.participants.push({...clone(person),entity:clone(d.review.entities.find(e=>e.id===person.id)??null)});
    const lostActions=p.actions.filter(a=>!ids.has(a.actorId)||a.participantIds.some(id=>!ids.has(id))),lostIds=new Set(lostActions.map(a=>a.actionId));
    archive.actions.push(...lostActions);p.actions=p.actions.filter(a=>!lostIds.has(a.actionId));
    const lostRelations=p.relations.filter(r=>lostIds.has(r.actionId)||[r.screenerId,r.beneficiaryId,r.defenderId].some(id=>id&&!ids.has(id)));
    archive.relations.push(...lostRelations);p.relations=p.relations.filter(r=>!lostRelations.includes(r));
    if(d.annotations){archive.annotations.push(...d.annotations.items.filter(a=>a.entityId&&!ids.has(a.entityId)));d.annotations.items=d.annotations.items.filter(a=>!a.entityId||ids.has(a.entityId));}
  }
  p.participants=review.entities.map(e=>({id:e.id,name:e.name||e.id,role:e.role||'player'}));reindexPhases(p);
  d.review=clone(review);p.sourceBinding=await createSourceBinding(d.review);p.reviewEvidence=[];
  for(const a of d.annotations?.items??[])if(a.anchorMode==='player_foot'&&ids.has(a.entityId))a.sourceBinding={videoSha256:review.videoSha256,trackingFingerprint:review.trackingFingerprint,reviewDigest:p.sourceBinding.reviewDigest};
  for(const a of [...p.actions,...p.relations])a.reviewStatus='needs_review';p.revision++;return d;
}

export function restoreArchivedAnnotation(document,id,{entityId=null,phaseId,frame}){
  const d=clone(document),annotation=d.archivedTactics?.annotations.find(a=>a.id===id);
  if(!annotation)throw new Error('未找到待恢复图形。');
  d.annotations??={schemaVersion:1,items:[]};
  if(d.annotations.items.some(a=>a.id===id))throw new Error('当前画布已有同名图形。');
  d.annotations.items.push(clone(annotation));
  const result=updateAnnotation(d,id,{entityId,phaseId,frame,...(annotation.anchorMode==='player_foot'&&entityId?{anchorMode:'player_foot',space:'video'}:{})});
  result.archivedTactics.annotations=result.archivedTactics.annotations.filter(a=>a.id!==id);return result;
}
