import {canonicalJSON} from '../tactical-overlay/binding.mjs';
import {createTacticsDocument,validateDocument,reindexPhases} from './tactics-document.mjs';
import {createAnnotation,annotationPresentation,ANNOTATION_REASONS} from './tactics-annotations.mjs';
import {calibrationAt} from './court.mjs';
import {updateProductionCamera,updateProductionCue,DEFAULT_RIBBON} from './tactics-production.mjs';
import {createCourtAnnotation} from './tactics-court-editor.mjs';
import {upsertTacticKeyframe,MIN_EXPLANATION_HOLD_SECONDS} from './tactics-keyframes.mjs';
import {preparationDigest} from './court-preparation.mjs';
import {validateFrameRange} from './tactics-time-range.mjs';

const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const string={type:'string',maxLength:2000},frame={type:'integer',minimum:0},frames={type:'array',items:frame,minItems:1,maxItems:40};
const person={type:['string','null'],maxLength:100},point=object({x:{type:'number'},y:{type:'number'}});
export const AGENT_SCHEMA_V1=object({summary:string,issues:{type:'array',items:string,maxItems:30},phases:{type:'array',minItems:1,maxItems:12,items:object({
  title:{type:'string',minLength:1,maxLength:100},startFrame:frame,endFrameExclusive:frame,freezeFrame:frame,reason:string,evidenceFrames:frames,
  actions:{type:'array',maxItems:40,items:object({kind:{type:'string',enum:['move','cut','roll','pop','hold','space','screen']},entityId:{type:'string',maxLength:100},startFrame:frame,endFrameExclusive:frame,beneficiaryId:person,defenderId:person,note:string,evidenceFrames:frames})},
  annotations:{type:'array',maxItems:40,items:object({type:{type:'string',enum:['route','screen','spotlight']},entityId:person,space:{type:'string',enum:['video','court']},anchorFrame:frame,startFrame:frame,endFrameExclusive:frame,
    points:{type:'array',minItems:1,maxItems:6,items:point},angle:{type:'number',minimum:-360,maximum:360},size:{type:'number',minimum:.5,maximum:3},color:{type:'string',pattern:'^#[a-fA-F0-9]{6}$'},explanation:string,evidenceFrames:frames})}
})}});
const nullable=s=>({...s,type:[s.type,'null']}),number={type:'number'},quad={type:'array',minItems:4,maxItems:4,items:{type:'array',minItems:2,maxItems:2,items:number}};
const ribbon=object(Object.fromEntries(Object.entries(DEFAULT_RIBBON).map(([k,v])=>[k,typeof v==='string'?{type:'string',pattern:'^#[a-fA-F0-9]{6}$'}:{type:'number',minimum:k==='edgePixels'?0:.000001,maximum:k==='opacity'?1:k==='edgePixels'?12:5}])));
const authoredPath=object({version:{type:'integer',enum:[1]},curve:{type:'string',enum:['cubic_bezier']},cameraId:{type:'string',minLength:1,maxLength:100},progressFrames:{type:'array',minItems:2,maxItems:80,items:object({frame,t:{type:'number',minimum:0,maximum:1}})},ribbon});
const phaseV2=structuredClone(AGENT_SCHEMA_V1.properties.phases.items);phaseV2.properties.annotations.items.properties.authoredPath=nullable(authoredPath);phaseV2.properties.annotations.items.required.push('authoredPath');
export const AGENT_SCHEMA=object({schemaVersion:{type:'integer',enum:[2]},summary:string,issues:AGENT_SCHEMA_V1.properties.issues,phases:{...AGENT_SCHEMA_V1.properties.phases,items:phaseV2},production:nullable(object({
  cameras:{type:'array',maxItems:40,items:object({id:{type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9_-]+$'},phaseIndex:{type:'integer',minimum:0,maximum:11},approximate:{type:'boolean',enum:[true]},groundQuad:quad,keyframes:{type:'array',minItems:1,maxItems:120,items:object({frame,quad,evidenceFrames:frames})}})},
  timeline:object({timebaseFps:{type:'number',minimum:1,maximum:120},cues:{type:'array',maxItems:256,items:object({phaseIndex:{type:'integer',minimum:0,maximum:11},frame,settleFrames:{...frame,maximum:3600},drawFrames:{...frame,maximum:3600},holdFrames:{...frame,maximum:3600},easing:{type:'string',enum:['smoothstep']}})},endHoldFrames:{...frame,maximum:3600}})
}))});

// The workbench's first draft stays in the supplied video frames. Camera fitting
// and 2D preparation remain separate, optional editing operations.
const videoPhase=structuredClone(phaseV2);
videoPhase.properties.annotations.items.properties.type.enum.push('position');
videoPhase.properties.annotations.items.properties.meaning={type:'string',enum:['current_action','later_observed_action','screen','focus','position']};
videoPhase.properties.annotations.items.properties.pattern={type:'string',enum:['solid','dashed']};
videoPhase.properties.annotations.items.required.push('meaning','pattern');
videoPhase.properties.annotations.items.properties.space={type:'string',enum:['video']};
videoPhase.properties.annotations.items.properties.authoredPath={type:'null'};
videoPhase.properties.participants={type:'array',maxItems:40,items:object({
  subjectId:{type:'string',minLength:1,maxLength:100},entityId:person,label:{type:'string',minLength:1,maxLength:100},
  role:{type:'string',enum:['ball_handler','screener','receiver','off_ball','defender','other']},
  disposition:{type:'string',enum:['annotated','uncertain','not_involved']},
  annotationIndexes:{type:'array',maxItems:40,items:{type:'integer',minimum:0,maximum:39}},evidenceFrames:frames,reason:string
})};
videoPhase.required.push('participants');
export const AGENT_SCHEMA_VIDEO=object({schemaVersion:{type:'integer',enum:[4]},summary:string,issues:{...AGENT_SCHEMA_V1.properties.issues,maxItems:60},
  phases:{...AGENT_SCHEMA_V1.properties.phases,items:videoPhase},production:{type:'null'}});

// Older saved V4 candidates used spotlight for every static person. Repair only
// the new candidate; never rewrite an existing human annotation or invent paths.
export function normalizeVideoCandidate(candidate,{diagnostics=[]}={}){
  const next=structuredClone(candidate);
  if(next?.schemaVersion!==4)return next;
  const report=text=>{
    const issue=text.slice(0,string.maxLength);
    if(!diagnostics.includes(issue))diagnostics.push(issue);
    // Preserve every original model issue. Overflow diagnostics belong to the
    // document's run report, not extra fields in the strict model schema.
    if(Array.isArray(next.issues)&&next.issues.length<AGENT_SCHEMA_VIDEO.properties.issues.maxItems&&!next.issues.includes(issue))next.issues.push(issue);
  };
  for(const phase of next.phases??[]){
    const converted=[];
    for(const a of phase.annotations??[]){
      a.pattern??='solid';a.meaning??=a.type==='route'?'current_action':a.type==='screen'?'screen':a.type==='position'?'position':'focus';
      const owners=(phase.participants??[]).filter(p=>p.annotationIndexes?.includes(phase.annotations.indexOf(a)));
      if(a.type==='spotlight'&&owners.length===1&&owners[0].role!=='ball_handler'){
        a.type='position';a.meaning='position';a.pattern='solid';
        converted.push(owners[0].label);
      }
    }
    if(converted.length){
      const issue=`${phase.title}：${converted.slice(0,5).join('、')}${converted.length>5?`等 ${converted.length} 人`:''} 不是当前持球人，重点圈已改为位置标记；有实际移动时请补充路线。`;
      report(issue);
    }
    if(phase.annotations?.length&&!phase.annotations.some(a=>a.type==='route')){
      const issue=`${phase.title}：尚无有前后画面依据的路线，仅保留位置或掩护标记；请核对移动参与者并补充路线。`;
      report(issue);
    }
  }
  return next;
}
export function videoCandidateCoverage(document,candidate){
  candidate=normalizeVideoCandidate(candidate);
  schemaCheck(candidate,AGENT_SCHEMA_VIDEO);
  const ids=new Set(document.playDefinition.participants.map(p=>p.id));
  return candidate.phases.map((phase,index)=>{
    const subjects=new Set(),entities=new Set(),drawings=new Set(),highlightFrames=new Set();
    for(const person of phase.participants){
      if(subjects.has(person.subjectId)||person.entityId!==null&&(!ids.has(person.entityId)||entities.has(person.entityId)))throw new Error('参与者重复或引用未知球员。');
      subjects.add(person.subjectId);if(person.entityId!==null)entities.add(person.entityId);
      if(person.evidenceFrames.some(f=>f<phase.startFrame||f>=phase.endFrameExclusive))throw new Error('参与者依据帧不在对应阶段。');
      if(person.disposition!=='annotated'){
        if(!person.reason.trim()||person.annotationIndexes.length)throw new Error('未标注参与者需要说明证据不足或未参与的原因，不能记为已覆盖。');
        continue;
      }
      if(!person.annotationIndexes.length)throw new Error('已覆盖参与者必须有独立的可编辑图形。');
      for(const i of person.annotationIndexes){
        const a=phase.annotations[i];
        if(!a||drawings.has(i)||a.entityId!==person.entityId)throw new Error('参与者图形引用无效；不能用同一个图形充当多人的标注。');
        if(a.type==='spotlight'){
          if(person.role!=='ball_handler'||!person.evidenceFrames.includes(a.anchorFrame))throw new Error('重点圈仅用于该参考帧有持球证据的当前持球人；请改为位置标记或补充持球依据。');
          if(highlightFrames.has(a.anchorFrame))throw new Error('同一暂停帧只能圈出一个当前持球人；请按球权转移拆分参考帧。');
          highlightFrames.add(a.anchorFrame);
        }
        const expected=a.type==='route'?a.meaning==='later_observed_action'?'dashed':'solid':'solid';
        if(a.pattern!==expected||a.type==='route'&&!['current_action','later_observed_action'].includes(a.meaning)||
          a.type!=='route'&&a.meaning!==({screen:'screen',spotlight:'focus',position:'position'}[a.type]))throw new Error('路线语义不一致：实线为当前动作，虚线为随后真实观察动作；其他图形使用对应语义。');
        if(a.type==='route'&&new Set(a.evidenceFrames).size<2)throw new Error('路线缺少前后画面依据；请补充观察帧，或保留位置标记并注明路线待人工补充。');
        drawings.add(i);
      }
      if(person.entityId!==null&&!person.evidenceFrames.some(frame=>document.review.entities.find(e=>e.id===person.entityId)?.trajectory.some(p=>p.frame===frame&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&!p.reviewExcluded)))throw new Error('关联参与者缺少同帧位置证据，请保留不确定原因。');
    }
    if(drawings.size!==phase.annotations.length)throw new Error('每个图形必须说明对应的参与者，不能静默漏人。');
    for(const action of phase.actions)for(const id of [action.entityId,action.beneficiaryId,action.defenderId].filter(Boolean)){
      if(!entities.has(id))throw new Error('动作或掩护关系中的参与者未列入覆盖清单。');
    }
    for(const action of phase.actions.filter(a=>['move','cut','roll','pop'].includes(a.kind))){
      const person=phase.participants.find(p=>p.entityId===action.entityId);
      if(person?.disposition==='annotated'&&!person.annotationIndexes.some(i=>phase.annotations[i].type==='route'))throw new Error(`${person.label} 已说明真实移动却只画位置或重点圈；请根据观察证据补路线，无法确定时标为待核对。`);
    }
    // No trajectory means no inferred identity. Observed slots must nevertheless
    // be accounted for, including an explicit uncertain/not-involved reason.
    const observed=document.review.entities.filter(e=>e.trajectory.some(p=>p.frame>=phase.startFrame&&p.frame<phase.endFrameExclusive&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&!p.reviewExcluded)).map(e=>e.id);
    const pending=observed.filter(id=>!entities.has(id));
    if(phase.annotations.length&&pending.length)throw new Error(`仍有有位置证据的球员未说明是否参与：${pending.join('、')}。请补标或明确不确定原因。`);
    return {phaseIndex:index,annotated:phase.participants.filter(p=>p.disposition==='annotated').length,
      uncertain:phase.participants.filter(p=>p.disposition==='uncertain').length,notInvolved:phase.participants.filter(p=>p.disposition==='not_involved').length,
      participants:structuredClone(phase.participants)};
  });
}

function hasTacticsContent(d){
  const p=d.playDefinition;
  return Boolean(d.annotations?.items.length||p.actions.length||p.relations.length||p.phases.length>1||d.presentation?.routes.length||d.production||d.tacticKeyframes?.items.length);
}
function videoReferenceTiming(document,jobId){
  if(document.schemaVersion!==2)return document;
  const next=structuredClone(document),byFrame=new Map();
  for(const a of next.annotations?.items??[]){
    if(a.origin?.jobId!==jobId)continue;
    // V4 supplies pixel geometry at an observed reference frame, not a tracked
    // path. Seconds-based documents need explicit holds for those frames.
    const range={startFrame:a.startFrame,endFrameExclusive:a.endFrameExclusive};
    Object.assign(a,{timingMode:'manual',actionRange:range,cueFrame:a.anchorFrame,displayMode:'full',curve:'polyline',
      progressFrames:[{frame:range.startFrame,t:0},{frame:range.endFrameExclusive,t:1}],
      meaning:a.meaning??(a.type==='route'?'current_action':a.type==='screen'?'screen':a.type==='position'?'position':'focus')});
    const group=byFrame.get(a.anchorFrame)??[];group.push(a);byFrame.set(a.anchorFrame,group);
  }
  if(!byFrame.size)return next;
  const old=next.tacticKeyframes?.items??[],timeline=next.production?.timeline;
  const additions=[...byFrame].sort(([a],[b])=>a-b).map(([frame,items])=>{
    const oldCues=old.filter(k=>k.frame===frame&&k.freeze),existing=[...oldCues.map(k=>k.holdSeconds),
      ...(timeline?.cues??[]).filter(k=>k.frame===frame).map(k=>(k.settleFrames+k.drawFrames+k.holdFrames)/timeline.timebaseFps)];
    const duration=Math.max(0,...existing),holdSeconds=duration>0?Math.min(30,duration):2.5;
    // Keep human cue records and their effective duration unchanged, including
    // shorter legacy holds. Do not merge into or rewrite an existing cue item.
    return {id:`${jobId}-cue-${frame}`,frame,annotationIds:items.map(a=>a.id),freeze:true,holdSeconds,
      ...(holdSeconds>=MIN_EXPLANATION_HOLD_SECONDS&&items.every(a=>a.actionRange.startFrame===frame)&&
        (!duration||oldCues.some(k=>k.kind==='explanation'))?{kind:'explanation'}:{})};
  });
  next.tacticKeyframes={schemaVersion:1,items:[...old,...additions]};
  return next;
}
async function appendVideoCandidate(document,generated,candidate,coverage,jobId){
  let next=structuredClone(document);
  const pendingAnnotations=[],pendingActions=[],added=new Set();
  for(const a of generated.annotations?.items??[]){
    const phase=next.playDefinition.phases.find(p=>p.startFrame<=a.anchorFrame&&a.anchorFrame<p.endFrameExclusive);
    if(!phase||a.origin.sourceFrames.some(f=>f<phase.startFrame||f>=phase.endFrameExclusive)){
      pendingAnnotations.push({annotationId:a.id,phaseId:phase?.phaseId??null,anchorFrame:a.anchorFrame,
        reason:'图形依据跨越现有人工阶段；保留完整候选，需人工确认后分别标注。',annotation:structuredClone(a)});
      continue;
    }
    next=createAnnotation(next,{...a,phaseId:phase.phaseId,frame:a.anchorFrame,
      startFrame:Math.max(a.startFrame,phase.startFrame),endFrameExclusive:Math.min(a.endFrameExclusive,phase.endFrameExclusive),followEntity:false});
    added.add(a.id);
  }
  const proposedActions=candidate.phases.flatMap(p=>p.actions);
  for(const [index,a] of generated.playDefinition.actions.entries()){
    const phase=next.playDefinition.phases.find(p=>p.startFrame<=a.startFrame&&a.endFrameExclusive<=p.endFrameExclusive);
    if(!phase||proposedActions[index].evidenceFrames.some(f=>f<phase.startFrame||f>=phase.endFrameExclusive)){
      pendingActions.push({actionId:a.actionId,reason:'动作跨越现有人工阶段；未改写原动作，需人工确认范围。',action:structuredClone(a),
        candidateAction:structuredClone(proposedActions[index]),relations:structuredClone(generated.playDefinition.relations.filter(r=>r.actionId===a.actionId))});
      continue;
    }
    next.playDefinition.actions.push(structuredClone(a));phase.actionIds.push(a.actionId);
    for(const relation of generated.playDefinition.relations.filter(r=>r.actionId===a.actionId)){
      next.playDefinition.relations.push(structuredClone(relation));phase.relationIds.push(relation.id);
    }
  }
  let offset=0;
  const appendedCoverage=coverage.map((report,index)=>{
    const ids=candidate.phases[index].annotations.map((_,i)=>`${jobId}-annotation-${offset+i}`);offset+=ids.length;
    const people=report.participants.filter(p=>p.disposition==='annotated');
    return {...report,generated:report.annotated,
      annotated:people.filter(p=>p.annotationIndexes.every(i=>added.has(ids[i]))).length,
      pending:people.filter(p=>p.annotationIndexes.some(i=>!added.has(ids[i]))).length,
      appendedAnnotations:ids.filter(id=>added.has(id)).length};
  });
  if(added.size||generated.playDefinition.actions.length>pendingActions.length)next.playDefinition.revision++;
  next.agentRuns=[...(next.agentRuns??[]),{jobId,summary:candidate.summary,
    issues:[...candidate.issues,...pendingAnnotations.map(a=>`${a.annotationId}：${a.reason}`),...pendingActions.map(a=>`${a.actionId}：${a.reason}`)],
    coverage:appendedCoverage,pendingAnnotations,pendingActions}];
  next=videoReferenceTiming(next,jobId);
  await validateDocument(next);
  const report=annotationPresentation(next,{annotationIds:[...added]});
  if(report.items.some(item=>!item.visible))throw new Error('追加图形在现有阶段的参考帧不可见；请核对来源和时间。');
  return next;
}

export async function documentDigest(document){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJSON(document)));
  return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
const rangeSchema=object({startFrame:frame,endFrameExclusive:frame});
export const AGENT_SCHEMA_V3=object({schemaVersion:{type:'integer',enum:[3]},summary:string,issues:AGENT_SCHEMA_V1.properties.issues,range:rangeSchema,preparationDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},
  annotations:{type:'array',minItems:1,maxItems:40,items:object({id:{type:'string',minLength:1,maxLength:100},phaseId:{type:'string',minLength:1,maxLength:100},type:{type:'string',enum:['route','screen','spotlight']},entityId:person,
    startFrame:frame,endFrameExclusive:frame,cueFrame:frame,points:{type:'array',minItems:1,maxItems:4,items:point},curve:{type:'string',enum:['polyline','cubic_bezier']},
    style:object({angle:{type:'number',minimum:-360,maximum:360},size:{type:'number',minimum:.5,maximum:3},color:{type:'string',pattern:'^#[a-fA-F0-9]{6}$'},pattern:{type:'string',enum:['solid','dashed','dots']}}),
    meaning:{type:'string',enum:['current_action','later_observed_action','pass','screen','focus']},progressFrames:{type:'array',minItems:2,maxItems:80,items:object({frame,t:{type:'number',minimum:0,maximum:1}})},evidenceFrames:frames,explanation:string})},
  keyframes:{type:'array',maxItems:40,items:object({frame,annotationIds:{type:'array',minItems:1,maxItems:40,items:{type:'string',minLength:1,maxLength:100}},freeze:{type:'boolean'},holdSeconds:{type:'number',minimum:0,maximum:30}})}
});
async function adoptV3(document,candidate,{jobId,scope,range,selectedIds}){
  await validateDocument(document);schemaCheck(candidate,AGENT_SCHEMA_V3);canonicalJSON(candidate);
  if(document.schemaVersion!==2||scope!=='range'||!document.review.courtPreparation)throw new Error('V3 需要准备后的 2D 版本与明确选区。');
  validateFrameRange(document.review.sourceFrameMapping,range);
  if(canonicalJSON(candidate.range)!==canonicalJSON(range)||candidate.preparationDigest!==preparationDigest(document.review.courtPreparation))throw new Error('Agent 选区或准备版本不匹配。');
  const existing=new Set(document.playDefinition.participants.map(p=>p.id)),ids=new Set(),byId=new Map();
  let d=structuredClone(document);
  for(const a of candidate.annotations){
    if(ids.has(a.id)||a.entityId!==null&&!existing.has(a.entityId))throw new Error('Agent 球员或对象引用无效。');ids.add(a.id);
    if(a.startFrame<range.startFrame||a.endFrameExclusive>range.endFrameExclusive||a.startFrame>=a.endFrameExclusive||a.evidenceFrames.some(f=>f<a.startFrame||f>=a.endFrameExclusive))throw new Error('Agent 时间或证据超出所选区间。');
    const phase=d.playDefinition.phases.find(p=>p.phaseId===a.phaseId);
    if(!phase||a.startFrame<phase.startFrame||a.endFrameExclusive>phase.endFrameExclusive)throw new Error('Agent 必须按已有阶段分段。');
    if(a.entityId&&a.evidenceFrames.every(f=>!Number.isFinite(d.review.courtPreparation.preparedByPlayer[a.entityId]?.[f]?.x)))throw new Error('关联球员缺少 2D 运动证据。');
    const id=`${jobId}-${a.id}`;
    d=createCourtAnnotation(d,{...a,id,range:{startFrame:a.startFrame,endFrameExclusive:a.endFrameExclusive},pattern:a.style.pattern,style:a.type==='route'?a.style:{angle:a.style.angle,size:a.style.size,color:a.style.color}});
    const item=d.annotations.items.find(x=>x.id===id);item.curve=a.curve;item.anchorFrame=a.cueFrame;item.cueFrame=a.cueFrame;item.progressFrames=structuredClone(a.progressFrames);item.origin={kind:'agent',jobId,sourceFrames:a.evidenceFrames,note:a.explanation};
    byId.set(a.id,id);
  }
  for(const [index,k] of candidate.keyframes.entries()){
    if(k.annotationIds.some(id=>!byId.has(id)))throw new Error('Agent 讲解点引用未知图形。');
    d=upsertTacticKeyframe(d,{...k,id:`${jobId}-cue-${index}`,annotationIds:k.annotationIds.map(id=>byId.get(id))});
  }
  await validateDocument(d);
  if(selectedIds!==undefined){
    if(!Array.isArray(selectedIds)||!selectedIds.length||new Set(selectedIds).size!==selectedIds.length||selectedIds.some(id=>!ids.has(id)))throw new Error('所选候选图形无效。');
    const selected=new Set(selectedIds.map(id=>byId.get(id)));
    d.annotations.items=d.annotations.items.filter(a=>!a.origin||a.origin.jobId!==jobId||selected.has(a.id));
    if(d.tacticKeyframes){for(const k of d.tacticKeyframes.items)k.annotationIds=k.annotationIds.filter(id=>d.annotations.items.some(a=>a.id===id));d.tacticKeyframes.items=d.tacticKeyframes.items.filter(k=>k.annotationIds.length);}
  }
  d.agentRuns=[...(d.agentRuns??[]),{jobId,summary:candidate.summary,issues:candidate.issues}];return d;
}
function schemaCheck(value,schema,path='方案'){
  const types=Array.isArray(schema.type)?schema.type:[schema.type],type=value===null?'null':Array.isArray(value)?'array':typeof value;
  if(!types.includes(type)&&!(types.includes('integer')&&Number.isSafeInteger(value)))throw new Error(`${path} 格式不正确。`);
  if(type==='object'){
    if(schema.required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!Object.hasOwn(schema.properties,k)))throw new Error(`${path} 包含缺失或不允许的字段。`);
    for(const [k,s] of Object.entries(schema.properties))schemaCheck(value[k],s,`${path}.${k}`);
  }else if(type==='array'){
    if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))throw new Error(`${path} 数量超出范围。`);
    value.forEach((v,i)=>schemaCheck(v,schema.items,`${path}[${i}]`));
  }else if(type==='number'&&(!Number.isFinite(value)||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))throw new Error(`${path} 数值超出范围。`);
  else if(type==='string'&&(value.length<(schema.minLength??0)||value.length>(schema.maxLength??Infinity)||schema.pattern&&!new RegExp(schema.pattern).test(value)))throw new Error(`${path} 文本不正确。`);
  if(schema.enum&&!schema.enum.includes(value))throw new Error(`${path} 值不受支持。`);
}
export async function adoptAgentCandidate(document,candidate,{jobId,scope,phaseId,range:selectedRange,selectedIds,directVideo=false}){
  if(typeof jobId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(jobId)||!['phase','play','range'].includes(scope))throw new Error('Agent 任务绑定无效。');
  if(document.agentRuns?.some(run=>run.jobId===jobId))return structuredClone(document);
  if(candidate?.schemaVersion===4){
    const diagnostics=[];candidate=normalizeVideoCandidate(candidate,{diagnostics});
    const coverage=videoCandidateCoverage(document,candidate),legacy=structuredClone(candidate);legacy.schemaVersion=2;
    for(const phase of legacy.phases)delete phase.participants;
    if(scope==='play'&&hasTacticsContent(document)){
      await validateDocument(document);
      const phase=document.playDefinition.phases.find(p=>p.phaseId===phaseId);
      if(!phase)throw new Error('分析阶段已不存在。');
      // Validate every proposed object on an isolated canvas before deciding
      // whether it can safely append to the user's unchanged phase structure.
      const scratch=await createTacticsDocument(document.review),play=scratch.playDefinition;
      play.startFrame=document.playDefinition.startFrame;play.endFrameExclusive=document.playDefinition.endFrameExclusive;
      play.participants=structuredClone(document.playDefinition.participants);
      play.phases=[{...structuredClone(phase),order:0,startFrame:play.startFrame,endFrameExclusive:play.endFrameExclusive,actionIds:[],relationIds:[]}];
      const generated=await adoptAgentCandidate(scratch,legacy,{jobId,scope:'play',phaseId,directVideo:true});
      const next=await appendVideoCandidate(document,generated,candidate,coverage,jobId);
      next.agentRuns.at(-1).issues=[...new Set([...next.agentRuns.at(-1).issues,...diagnostics])];
      return next;
    }
    const next=await adoptAgentCandidate(document,legacy,{jobId,scope,phaseId,range:selectedRange,selectedIds,directVideo:true});
    next.agentRuns.at(-1).coverage=coverage;
    next.agentRuns.at(-1).issues=[...new Set([...next.agentRuns.at(-1).issues,...diagnostics])];
    return next;
  }
  if(candidate?.schemaVersion===3)return adoptV3(document,candidate,{jobId,scope,range:selectedRange,selectedIds});
  if(scope==='range')throw new Error('选区生成需要 V3 候选。');
  const legacySchema=structuredClone(Object.hasOwn(candidate,'schemaVersion')?AGENT_SCHEMA:AGENT_SCHEMA_V1);
  if(directVideo){const annotations=legacySchema.properties.phases.items.properties.annotations.items;
    legacySchema.properties.issues=AGENT_SCHEMA_VIDEO.properties.issues;
    annotations.properties.type.enum.push('position');
    annotations.properties.meaning=videoPhase.properties.annotations.items.properties.meaning;
    annotations.properties.pattern=videoPhase.properties.annotations.items.properties.pattern;
    annotations.required.push('meaning','pattern');}
  await validateDocument(document);schemaCheck(candidate,legacySchema);canonicalJSON(candidate);
  let d=structuredClone(document);const p=d.playDefinition,target=p.phases.find(s=>s.phaseId===phaseId),ids=new Set(p.participants.map(e=>e.id));
  if(!target)throw new Error('分析阶段已不存在。');
  const empty=!(d.annotations?.items.length||p.actions.length||p.relations.length||p.phases.length>1||d.presentation?.routes.length||d.production);
  if(scope==='play'&&!empty)throw new Error('已有人工内容时仅可补充当前阶段。');
  const range=scope==='play'?p:target,checkRange=a=>{
    if(a.startFrame<range.startFrame||a.endFrameExclusive>range.endFrameExclusive||a.startFrame>=a.endFrameExclusive)throw new Error('Agent 时间超出所选区间。');
  };
  const evidence=(list,start,end)=>{if(list.some(f=>f<start||f>=end))throw new Error('Agent 依据帧不在对应区间内。');};
  if(scope==='phase'&&candidate.phases.length!==1)throw new Error('补充当前阶段不能改变阶段结构。');
  if(scope==='phase'&&candidate.phases[0].freezeFrame!==target.freezeFrame)throw new Error('补充当前阶段需使用原暂停帧；请先修改阶段暂停位置再生成。');
  let end=range.startFrame,annotationCount=0;
  for(const s of candidate.phases){
    checkRange(s);if(s.startFrame!==end||s.freezeFrame<s.startFrame||s.freezeFrame>=s.endFrameExclusive)throw new Error('Agent 阶段需连续覆盖所选区间。');end=s.endFrameExclusive;
    evidence(s.evidenceFrames,s.startFrame,s.endFrameExclusive);
  }
  if(end!==range.endFrameExclusive)throw new Error('Agent 阶段未覆盖所选区间。');
  if(scope==='play')p.phases=candidate.phases.map((s,i)=>({phaseId:`${jobId}-phase-${i}`,order:i,title:s.title,startFrame:s.startFrame,endFrameExclusive:s.endFrameExclusive,freezeFrame:s.freezeFrame,participantIds:[...ids],actionIds:[],relationIds:[]}));
  const cameraIds=new Map();
  if(candidate.production){
    const input=candidate.production;
    if(scope==='phase'&&d.production&&(input.timeline.timebaseFps!==d.production.timeline.timebaseFps||input.timeline.endHoldFrames!==d.production.timeline.endHoldFrames))throw new Error('补充方案不能覆盖已有人工成片时长设置。');
    for(const camera of input.cameras){
      const phase=scope==='play'?d.playDefinition.phases[camera.phaseIndex]:camera.phaseIndex===0?target:null;
      if(!phase||cameraIds.has(camera.id))throw new Error('Agent 示意相机阶段或编号不正确。');
      const id=`${jobId}-camera-${camera.id}`;cameraIds.set(camera.id,id);
      d=updateProductionCamera(d,id,{phaseId:phase.phaseId,approximate:camera.approximate,groundQuad:camera.groundQuad,keyframes:camera.keyframes});
      d.production.cameras.find(c=>c.id===id).origin={kind:'agent',jobId,sourceFrames:[...new Set(camera.keyframes.flatMap(k=>k.evidenceFrames))].slice(0,40),note:'Agent 近似展示相机，不构成人工球场标定。'};
    }
    for(const cue of input.timeline.cues){
      const phase=scope==='play'?d.playDefinition.phases[cue.phaseIndex]:cue.phaseIndex===0?target:null;
      if(!phase)throw new Error('Agent 冻结编排阶段不正确。');
      if(d.production?.timeline.cues.some(c=>c.phaseId===phase.phaseId&&c.frame===cue.frame))throw new Error('补充方案不能覆盖已有人工冻结编排。');
      const {phaseIndex,easing,...values}=cue;d=updateProductionCue(d,{...values,phaseId:phase.phaseId});
    }
    if(!d.production)d.production={schemaVersion:1,sourceBinding:structuredClone(d.playDefinition.sourceBinding),cameras:[],timeline:{timebaseFps:30,cues:[],endHoldFrames:0}};
    d.production.timeline.timebaseFps=input.timeline.timebaseFps;d.production.timeline.endHoldFrames=input.timeline.endHoldFrames;
  }
  for(const [index,s] of candidate.phases.entries()){
    const phase=scope==='play'?p.phases[index]:target;
    for(const a of s.annotations){
      checkRange(a);if(a.startFrame<s.startFrame||a.endFrameExclusive>s.endFrameExclusive||a.anchorFrame<a.startFrame||a.anchorFrame>=a.endFrameExclusive)throw new Error('图形时间或参考帧无效。');
      if(a.entityId!==null&&!ids.has(a.entityId))throw new Error('Agent 引用了未知球员。');
      evidence(a.evidenceFrames,s.startFrame,s.endFrameExclusive);
      if(a.type==='route'&&a.points.length<2||a.type!=='route'&&a.points.length!==1)throw new Error('图形控制点数量不正确。');
      if(a.space==='court'&&!calibrationAt(d.review.court?.calibration,a.anchorFrame,d.review.sourceFrameMapping,d.review.settings?.cuts??[]))throw new Error('Agent 地面图形没有有效参考标定。');
      let path;
      if(a.authoredPath){const id=cameraIds.get(a.authoredPath.cameraId),camera=d.production?.cameras.find(c=>c.id===id);if(!camera)throw new Error('Agent 路线没有对应的示意相机。');
        if(camera.phaseId!==phase.phaseId||camera.keyframes[0].frame>a.startFrame||camera.keyframes.at(-1).frame<a.endFrameExclusive-1)throw new Error('Agent 示意相机必须覆盖路线完整显示区间。');
        path={...structuredClone(a.authoredPath),cameraId:id,cameraDigest:camera.digest};}
      d=createAnnotation(d,{id:`${jobId}-annotation-${annotationCount++}`,type:a.type,entityId:a.entityId,phaseId:phase.phaseId,frame:a.anchorFrame,startFrame:a.startFrame,endFrameExclusive:a.endFrameExclusive,space:a.space,points:a.points,
        ...(directVideo?{followEntity:false,meaning:a.meaning,curve:'polyline'}:a.type==='spotlight'&&a.entityId?{anchorMode:'player_foot'}:{}),...(path?{authoredPath:path}:{}),style:{angle:a.angle,size:a.size,color:a.color,...(a.type==='route'&&a.pattern?{pattern:a.pattern}:{})},origin:{kind:'agent',jobId,sourceFrames:a.evidenceFrames,note:a.explanation}});
    }
    for(const [i,a] of s.actions.entries()){
      checkRange(a);evidence(a.evidenceFrames,s.startFrame,s.endFrameExclusive);
      if(!ids.has(a.entityId)||[a.beneficiaryId,a.defenderId].some(id=>id!==null&&!ids.has(id)))throw new Error('动作包含未知球员。');
      const actionId=`${jobId}-action-${index}-${i}`,play=d.playDefinition;
      play.actions.push({actionId,actorId:a.entityId,participantIds:[a.entityId],kind:a.kind,startFrame:a.startFrame,endFrameExclusive:a.endFrameExclusive,source:'upstream_supplied',reviewStatus:'needs_review',note:a.note});
      if(a.kind==='screen'&&a.beneficiaryId){
        const people=[a.entityId,a.beneficiaryId,...(a.defenderId?[a.defenderId]:[])];if(new Set(people).size!==people.length)throw new Error('掩护关系球员不能重复。');
        play.relations.push({id:`${actionId}-screen`,actionId,screenerId:a.entityId,beneficiaryId:a.beneficiaryId,defenderId:a.defenderId,startFrame:a.startFrame,endFrameExclusive:a.endFrameExclusive,position:null,orientation:null,source:'upstream_supplied',reviewStatus:'needs_review'});
      }
    }
  }
  if(!annotationCount)throw new Error('Agent 未生成可用图形，请缩小范围或人工标注。');
  reindexPhases(d.playDefinition);d.playDefinition.revision++;
  d.agentRuns=[...(d.agentRuns??[]),{jobId,summary:candidate.summary,issues:structuredClone(candidate.issues)}];
  if(directVideo)d=videoReferenceTiming(d,jobId);
  await validateDocument(d);
  const presentation=annotationPresentation(d,{annotationIds:Array.from({length:annotationCount},(_,i)=>`${jobId}-annotation-${i}`)});
  const invisible=presentation.items.findIndex(item=>!item.visible);
  if(invisible!==-1){
    const item=presentation.items[invisible],reason=item.reason==='completed'?'路线控制点未形成可见图形':ANNOTATION_REASONS[item.reason]??item.reason;
    throw new Error(`Agent 第 ${invisible+1} 个图形在参考帧 ${item.frame+1} 无法展示：${reason}（${item.reason}）。请调整参考帧或图形。`);
  }
  return d;
}
