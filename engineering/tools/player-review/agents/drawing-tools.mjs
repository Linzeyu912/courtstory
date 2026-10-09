import {Type} from 'typebox';
import {AGENT_SCHEMA_VIDEO} from '../tactics-agent.mjs';

const json=value=>({type:'text',text:JSON.stringify(value)});
const frames=Type.Array(Type.Integer({minimum:0}),{minItems:1,maxItems:12});
const nodeId=Type.String({minLength:1,maxLength:100});
const candidateSchema=structuredClone(AGENT_SCHEMA_VIDEO);
candidateSchema.properties.phases.maxItems=1;
const annotation=candidateSchema.properties.phases.items.properties.annotations.items;
annotation.properties.assetId={type:'string',minLength:1,maxLength:100};annotation.required.push('assetId');

export function validateNodeCandidate(candidate,node,seen,assets,participants=[]){
  if(!candidate||candidate.schemaVersion!==4||candidate.phases?.length!==1)throw new Error('每节点需要一个原生 V4 几何候选。');
  const phase=candidate.phases[0],window=node.evidenceWindow;
  if(phase.freezeFrame!==node.anchorAssetFrame||!seen.has(node.anchorAssetFrame))throw new Error('节点锚点必须本轮实际读取。');
  if(phase.startFrame!==window.startFrame||phase.endFrameExclusive!==window.endFrame+1)throw new Error('候选必须绑定当前节点窗口。');
  for(const item of [phase,...(phase.annotations??[]),...(phase.actions??[]),...(phase.participants??[])]){
    if(!Array.isArray(item.evidenceFrames)||!item.evidenceFrames.length||item.evidenceFrames.some(f=>!seen.has(f)))throw new Error('候选引用本轮未实际发送的图像。');
    if(item.startFrame!==undefined&&(item.startFrame<window.startFrame||item.endFrameExclusive>window.endFrame+1))throw new Error('图形超出节点窗口。');
  }
  for(const a of phase.annotations??[]){
    if(a.anchorFrame!==node.anchorAssetFrame||!assets.some(asset=>asset.assetId===a.assetId&&asset.frame===a.anchorFrame))throw new Error('坐标资产和节点锚帧不匹配。');
    if(a.type==='route'&&new Set(a.evidenceFrames).size<2)throw new Error('路线需要至少两帧真实观察。');
  }
  const focus=phase.annotations.map((a,index)=>({a,index})).filter(({a})=>a.type==='spotlight');
  if(node.kind==='shot_release'){
    const shooterRef=node.shotFeedback?.shooterRef,shooter=participants.find(p=>p.participantId===shooterRef);
    if(!shooter)throw new Error('出手节点缺少保存的出手者引用。');
    if(focus.length!==1)throw new Error('确定出手节点必须有且仅有出手者 spotlight。');
    const {a,index}=focus[0],owners=(phase.participants??[]).filter(p=>p.annotationIndexes?.includes(index));
    if(owners.length!==1||owners[0].entityId!==a.entityId||
        (shooter.entityId!==null&&shooter.entityId!==undefined?owners[0].entityId!==shooter.entityId:owners[0].entityId!==null||owners[0].subjectId!==shooterRef))
      throw new Error('出手例外只允许保存的出手者 spotlight，匿名人物需匹配 subjectId。');
  }else for(const {index} of focus){
    const owners=(phase.participants??[]).filter(p=>p.annotationIndexes?.includes(index));
    if(owners.length!==1||owners[0].role!=='ball_handler')throw new Error('普通节点重点圈只允许当前持球人。');
  }
  return true;
}

export function createDrawingTools(start,{rpc,budget,emit}={}){
  const state={candidate:null,nodeStatus:null,reason:'',finished:false,seen:new Set(),assets:[],audit:null,error:null};
  const nodes=new Map((start.nodes??[]).map(n=>[n.nodeId,n]));
  const node=nodes.get(start.node?.nodeId)??start.nodes?.[0];
  if(!node)throw new Error('绘图需要已保存解说节点。');
  const call=(name,parameters,description,execute)=>({name,label:name,parameters,description,executionMode:'sequential',execute:async(id,args,signal)=>{
    if(signal?.aborted)throw new Error('任务已取消。');
    if(state.finished)throw new Error('本阶段已保存。');
    if(++budget.toolCalls>budget.maxToolCalls)throw new Error('绘图工具预算用尽。');
    return execute(args,signal);
  }});
  if(start.mode==='audit'){
    const count=start.candidate?.phases?.[0]?.annotations?.length??0,actionCount=start.candidate?.phases?.[0]?.actions?.length??0;
    const parameters=Type.Object({nodeId,approved:Type.Boolean(),reason:Type.String({maxLength:1800}),
      annotations:Type.Array(Type.Object({index:Type.Integer({minimum:0}),approved:Type.Boolean(),reason:Type.String({maxLength:600})}),{maxItems:40}),
      actions:Type.Array(Type.Object({index:Type.Integer({minimum:0}),approved:Type.Boolean(),reason:Type.String({maxLength:600})}),{maxItems:40})});
    return {state,tools:[call('save_drawing_audit',parameters,'独立核对每个图形和动作的原图几何、人物绑定与叙述依据；疑点拒绝，不能改稿或绘图。',async args=>{
      if(args.nodeId!==node.nodeId||args.annotations.length!==count||new Set(args.annotations.map(a=>a.index)).size!==count||args.annotations.some(a=>a.index>=count)||
          args.actions.length!==actionCount||new Set(args.actions.map(a=>a.index)).size!==actionCount||args.actions.some(a=>a.index>=actionCount))throw new Error('审核必须逐项覆盖所有图形和动作。');
      if(args.approved!==([...args.annotations,...args.actions].every(a=>a.approved)))throw new Error('审核总状态与逐项结论不一致。');
      state.audit=structuredClone(args);state.finished=true;return {content:[json({saved:true})],terminate:true};
    })]};
  }
  const bounded=async(method,args,signal)=>{
    const selected=nodes.get(args.nodeId);if(selected?.nodeId!==node.nodeId)throw new Error('本轮只处理当前节点。');
    if(args.frames.some(f=>f<node.evidenceWindow.startFrame||f>node.evidenceWindow.endFrame))throw new Error('取证超出节点窗口。');
    const result=await rpc(method,args,signal);
    if(method==='get_node_positions')return {content:[json(result)]};
    const images=(result.content??[]).filter(c=>c.type==='image'),assets=result.details?.assets??[];
    if(images.length!==assets.length||images.some(c=>!c.data||!['image/jpeg','image/png','image/webp'].includes(c.mimeType)))throw new Error('图像与资产不匹配。');
    for(const asset of assets){if(asset.frame<node.evidenceWindow.startFrame||asset.frame>node.evidenceWindow.endFrame)throw new Error('返回资产超出窗口。');state.seen.add(asset.frame);state.assets.push(structuredClone(asset));}
    budget.imagesReturned=(budget.imagesReturned??0)+images.length;
    return result;
  };
  const tools=[
    call('read_commentary_node',Type.Object({}),'只读已保存的当前解说节点、人物引用、事件、句子和上轮审核纠错意见，不重新讲解全片。',async()=>({content:[json({node,participants:start.participants??[],event:start.event,cues:start.cues,planRef:start.planRef,auditFeedback:start.auditFeedback??null})]})),
    call('read_node_frames',Type.Object({nodeId,frames}),'读取节点窗口内原尺寸无标题单帧，坐标属返回图片assetId。',async(args,signal)=>bounded('read_node_frames',args,signal)),
    call('inspect_node_region',Type.Object({nodeId,frames,box:Type.Optional(Type.Array(Type.Number(),{minItems:4,maxItems:4})),entityId:Type.Optional(Type.String()),trackId:Type.Optional(Type.Integer({minimum:0}))}),'局部裁图；使用返回transform逆映射。缺失框不视为看过该帧。',async(args,signal)=>bounded('inspect_node_region',args,signal)),
    call('get_node_positions',Type.Object({nodeId,frames}),'查询节点内已有位置，不作为新增视觉证据或姓名证明。',async(args,signal)=>bounded('get_node_positions',args,signal)),
    call('request_window_extension',Type.Object({nodeId,startFrame:Type.Integer({minimum:0}),endFrame:Type.Integer({minimum:0}),reason:Type.String({minLength:1,maxLength:600})}),'明确记录窗口不足及所需范围，交给编排器处理；本轮不会自动扩大成全片。',async args=>{
      if(args.nodeId!==node.nodeId)throw new Error('未知节点。');state.extensionRequest=structuredClone(args);return {content:[json({status:'requires_orchestrator',request:args})]};
    }),
    call('save_node_drawing',Type.Object({nodeId,status:Type.Union(['ready','partial','unavailable','needs_upstream_review'].map(Type.Literal)),reason:Type.String({maxLength:1800}),candidate:Type.Union([candidateSchema,Type.Null()])}),
      '保存局部原生几何候选。冲突返回needs_upstream_review，缺少证据保留缺口。图形仅说明已保存节点重点；每个annotation填写实际图像assetId。',async args=>{
        if(args.nodeId!==node.nodeId)throw new Error('未知节点。');
        if(['ready','partial'].includes(args.status)){validateNodeCandidate(args.candidate,node,state.seen,state.assets,start.participants??[]);}
        else if(args.candidate!==null||!args.reason.trim())throw new Error('不可用节点需要明确原因且无候选。');
        state.candidate=structuredClone(args.candidate);state.nodeStatus=args.status;state.reason=args.reason;state.finished=true;
        emit?.({type:'progress',status:'checkpoint',nodeId:node.nodeId,nodeStatus:args.status});
        return {content:[json({saved:true,status:args.status})],terminate:true};
      }),
  ];
  return {tools,state};
}
