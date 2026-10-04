import {canonicalJSON} from '../tactical-overlay/binding.mjs';
import {validateDocument,reindexPhases} from './tactics-document.mjs';
import {createAnnotation} from './tactics-annotations.mjs';
import {calibrationAt} from './court.mjs';

const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const string={type:'string',maxLength:2000},frame={type:'integer',minimum:0},frames={type:'array',items:frame,minItems:1,maxItems:40};
const person={type:['string','null'],maxLength:100},point=object({x:{type:'number'},y:{type:'number'}});
export const AGENT_SCHEMA=object({summary:string,issues:{type:'array',items:string,maxItems:30},phases:{type:'array',minItems:1,maxItems:12,items:object({
  title:{type:'string',minLength:1,maxLength:100},startFrame:frame,endFrameExclusive:frame,freezeFrame:frame,reason:string,evidenceFrames:frames,
  actions:{type:'array',maxItems:40,items:object({kind:{type:'string',enum:['move','cut','roll','pop','hold','space','screen']},entityId:{type:'string',maxLength:100},startFrame:frame,endFrameExclusive:frame,beneficiaryId:person,defenderId:person,note:string,evidenceFrames:frames})},
  annotations:{type:'array',maxItems:40,items:object({type:{type:'string',enum:['route','screen','spotlight']},entityId:person,space:{type:'string',enum:['video','court']},anchorFrame:frame,startFrame:frame,endFrameExclusive:frame,
    points:{type:'array',minItems:1,maxItems:6,items:point},angle:{type:'number',minimum:-360,maximum:360},size:{type:'number',minimum:.5,maximum:3},color:{type:'string',pattern:'^#[a-fA-F0-9]{6}$'},explanation:string,evidenceFrames:frames})}
})}});

export async function documentDigest(document){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJSON(document)));
  return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
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
export async function adoptAgentCandidate(document,candidate,{jobId,scope,phaseId}){
  if(typeof jobId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(jobId)||!['phase','play'].includes(scope))throw new Error('Agent 任务绑定无效。');
  if(document.agentRuns?.some(run=>run.jobId===jobId))return structuredClone(document);
  await validateDocument(document);schemaCheck(candidate,AGENT_SCHEMA);canonicalJSON(candidate);
  let d=structuredClone(document);const p=d.playDefinition,target=p.phases.find(s=>s.phaseId===phaseId),ids=new Set(p.participants.map(e=>e.id));
  if(!target)throw new Error('分析阶段已不存在。');
  const empty=!(d.annotations?.items.length||p.actions.length||p.relations.length||p.phases.length>1||d.presentation?.routes.length);
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
  for(const [index,s] of candidate.phases.entries()){
    const phase=scope==='play'?p.phases[index]:target;
    for(const a of s.annotations){
      checkRange(a);if(a.startFrame<s.startFrame||a.endFrameExclusive>s.endFrameExclusive||a.anchorFrame<a.startFrame||a.anchorFrame>=a.endFrameExclusive)throw new Error('图形时间或参考帧无效。');
      if(a.entityId!==null&&!ids.has(a.entityId))throw new Error('Agent 引用了未知球员。');
      evidence(a.evidenceFrames,s.startFrame,s.endFrameExclusive);
      if(a.type==='route'&&a.points.length<2||a.type!=='route'&&a.points.length!==1)throw new Error('图形控制点数量不正确。');
      if(a.space==='court'&&!calibrationAt(d.review.court?.calibration,a.anchorFrame,d.review.sourceFrameMapping,d.review.settings?.cuts??[]))throw new Error('Agent 地面图形没有有效参考标定。');
      d=createAnnotation(d,{id:`${jobId}-annotation-${annotationCount++}`,type:a.type,entityId:a.entityId,phaseId:phase.phaseId,frame:a.anchorFrame,startFrame:a.startFrame,endFrameExclusive:a.endFrameExclusive,space:a.space,points:a.points,
        ...(a.type==='spotlight'&&a.entityId?{anchorMode:'player_foot'}:{}),style:{angle:a.angle,size:a.size,color:a.color},origin:{kind:'agent',jobId,sourceFrames:a.evidenceFrames,note:a.explanation}});
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
  await validateDocument(d);return d;
}
