import {canonicalJSON} from '../tactical-overlay/binding.mjs';
import {validateDocument,reindexPhases} from './tactics-document.mjs';
import {createAnnotation,annotationPresentation,ANNOTATION_REASONS} from './tactics-annotations.mjs';
import {calibrationAt} from './court.mjs';
import {updateProductionCamera,updateProductionCue,DEFAULT_RIBBON} from './tactics-production.mjs';

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
  await validateDocument(document);schemaCheck(candidate,Object.hasOwn(candidate,'schemaVersion')?AGENT_SCHEMA:AGENT_SCHEMA_V1);canonicalJSON(candidate);
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
        ...(a.type==='spotlight'&&a.entityId?{anchorMode:'player_foot'}:{}),...(path?{authoredPath:path}:{}),style:{angle:a.angle,size:a.size,color:a.color},origin:{kind:'agent',jobId,sourceFrames:a.evidenceFrames,note:a.explanation}});
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
  await validateDocument(d);
  const presentation=annotationPresentation(d,{annotationIds:Array.from({length:annotationCount},(_,i)=>`${jobId}-annotation-${i}`)});
  const invisible=presentation.items.findIndex(item=>!item.visible);
  if(invisible!==-1){
    const item=presentation.items[invisible],reason=item.reason==='completed'?'路线控制点未形成可见图形':ANNOTATION_REASONS[item.reason]??item.reason;
    throw new Error(`Agent 第 ${invisible+1} 个图形在参考帧 ${item.frame+1} 无法展示：${reason}（${item.reason}）。请调整参考帧或图形。`);
  }
  return d;
}
