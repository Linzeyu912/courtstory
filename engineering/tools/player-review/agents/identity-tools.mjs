import {Type} from 'typebox';
import {createCommentaryTools} from './commentary-tools.mjs';

const text=Type.String({minLength:1,maxLength:1000});
const frame=Type.Integer({minimum:0});
const frames=Type.Array(frame,{minItems:1,maxItems:128});
const confidence=Type.Number({minimum:0,maximum:1});
export function createIdentityTools(start,dependencies){
  const {rpc,emit,budget}=dependencies;
  // The read tools and actual returned-image ledger are precisely Part 3's.
  const runtime=createCommentaryTools(start,dependencies),{state}=runtime;
  const tools=runtime.tools.filter(tool=>tool.name!=='save_commentary_plan');
  const original=tools[0].execute;
  tools[0]={...tools[0],execute:async(...args)=>{
    const result=await original(...args);
    result.content.push({type:'text',text:JSON.stringify({identityContext:start.context.identityContext??{},
      identitySlots:start.context.identitySlots??[],slotBasis:start.context.identitySlotBasis??{},
      frameMapping:(start.context.identityMapping??[]).filter(f=>state.seenFrames.has(f.assetFrame)),
      previousCandidate:start.context.previousCandidate??null,
      rule:'所有工具及方案帧号均为当前视频 assetFrame；sourceFrame 仅为登记的原片映射。已有检查点由宿主保留，请优先补未覆盖或不确定的区间。'})});
    return result;
  }};
  tools.push({name:'save_identity_review',label:'save_identity_review',description:'保存 P 与真实检测框的有限身份区间。首尾/所有证据必须已看图；号码证据需原帧或局部图。宿主验证切镜、缺测、风险、槽位和唯一名单。不得提交姓名或坐标。',
    executionMode:'sequential',parameters:Type.Object({plan:Type.Object({summary:text,
      subjects:Type.Array(Type.Object({subjectId:text,entityId:Type.Union([Type.String(),Type.Null()]),
        role:Type.Union(['player','referee','other','uncertain'].map(x=>Type.Literal(x))),team:Type.String({maxLength:40}),
        teamSide:Type.Union(['A','B','unknown'].map(x=>Type.Literal(x))),jersey:Type.String({pattern:'^[0-9]{0,3}$'}),confidence,reason:text}),{maxItems:40}),
      segments:Type.Array(Type.Object({id:text,subjectId:text,trackId:Type.Integer({minimum:1}),startFrame:frame,endFrame:frame,
        evidenceFrames:frames,jerseyEvidenceFrames:Type.Array(frame,{maxItems:128}),confidence,reason:text}),{maxItems:300}),
      issues:Type.Array(Type.Object({kind:Type.Union(['identity_uncertain','team_uncertain','role_uncertain','missing_player'].map(x=>Type.Literal(x))),reason:text}),{maxItems:80})}),finish:Type.Optional(Type.Boolean())}),
    execute:async(id,args,signal)=>{
      if(signal?.aborted)throw new Error('任务已取消。');
      if(state.finished)throw new Error('身份方案已结束。');
      if(++budget.toolCalls>budget.maxToolCalls)throw new Error('已达到工具调用预算。');
      // The host independently rejects each unsafe range and retains only its
      // validated subset. Do not let one unread range discard other read ranges.
      const proposed=args.plan?.segments??[];
      if(proposed.length&&!proposed.some(segment=>Array.isArray(segment.evidenceFrames)&&
          segment.evidenceFrames.includes(segment.startFrame)&&segment.evidenceFrames.includes(segment.endFrame)&&
          segment.evidenceFrames.every(f=>state.seenFrames.has(f))&&
          (segment.jerseyEvidenceFrames??[]).every(f=>state.detailFrames.has(f))))
        throw new Error('身份区间或号码引用了未实际读取的图像。');
      if(args.finish===true&&!state.detailFrames.size)throw new Error('完成前需读取原帧或局部细节。');
      const result=await rpc('save_identity_review',args,signal);
      if(signal?.aborted)throw new Error('任务已取消。');
      if(result?.saved!==true||!result.candidate)throw new Error('宿主未通过身份来源校验。');
      state.plan=structuredClone(result.candidate);state.finished=args.finish===true;
      emit?.({type:'progress',status:'checkpoint',safePlan:state.plan});
      return {content:[{type:'text',text:JSON.stringify({saved:true,finish:state.finished,
        summary:state.plan.summary,segmentCount:state.plan.segments?.length,issues:state.plan.issues})}],
        ...(state.finished?{terminate:true}:{})};
    }});
  return {tools,state};
}
