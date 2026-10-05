import {Type} from 'typebox';
import {previewGroundTrajectory} from '../ground-trajectory.mjs';
import {COURT} from '../court.mjs';

const integer=Type.Integer({minimum:0});
const frames=Type.Array(integer,{minItems:1,maxItems:12});
const renderFrames=Type.Array(integer,{minItems:1,maxItems:7});
const text=Type.String({minLength:1,maxLength:1800});
const rangeFields={startFrame:integer,endFrameExclusive:Type.Integer({minimum:1})};
const json=value=>({type:'text',text:JSON.stringify(value)});
const copy=value=>structuredClone(value);

export function createTrajectoryTools(start,{rpc,emit,budget,requestNumber}){
  const state={revision:0,anchors:[],unknownRanges:[],candidate:null,dirty:true,finished:false,
    feedbackRevision:null,feedbackRequest:null,feedbackReadRevision:null,feedbackReadRequest:null,
    seenFrames:new Set(),assets:[],audit:[],summary:'',
    latestRenderedCandidate:null};
  const checkRevision=revision=>{if(revision!==state.revision)throw new Error(`候选已更新，当前 revision=${state.revision}；请先读取上下文。`);};
  const checkFrame=frame=>{
    if(!Number.isSafeInteger(frame)||frame<start.range.startFrame||frame>=start.range.endFrameExclusive)
      throw new Error('帧不在本次修正范围。');
  };
  const checkEntity=id=>{if(!start.entityIds.includes(id))throw new Error('球员不在本次修正范围。');};
  const checkEvidence=list=>{
    if(!list?.length)throw new Error('必须提供已经读取的支持帧。');
    for(const f of list){checkFrame(f);if(!state.seenFrames.has(f))throw new Error(`帧 ${f} 尚未通过图片工具读取。`);}
  };
  const candidateInput=(anchors=state.anchors,unknownRanges=state.unknownRanges,revision=state.revision)=>({
    schemaVersion:1,jobId:start.jobId,model:start.config.model,revision,
    entityIds:start.entityIds,range:start.range,anchors:copy(anchors),unknownRanges:copy(unknownRanges),
    evidenceFrames:[...state.seenFrames],completion:'partial',fit:{method:'shape_preserving_hermite_v1'},
  });
  const validateMutation=(anchors,unknownRanges)=>previewGroundTrajectory(start.preparation,
    candidateInput(anchors,unknownRanges,state.revision+1));
  const audit=(tool,details)=>{
    const item={sequence:state.audit.length+1,tool,revision:state.revision,request:requestNumber(),...details};
    state.audit.push(item);emit({type:'progress',status:'refining',message:`${tool} · 候选 ${state.revision}`,event:item});
  };
  const imageResult=(result,{readFrames=false}={})=>{
    if(!result||!Array.isArray(result.content))throw new Error('图片工具返回了无效协议。');
    const images=result.content.filter(c=>c.type==='image');
    if(!images.length||images.length>budget.maxImagesPerReply)throw new Error('图片工具必须返回实际图片，且不能超过单次预算。');
    for(const c of images)if(!['image/png','image/jpeg','image/webp'].includes(c.mimeType)||typeof c.data!=='string'||!c.data.length)
      throw new Error('图片工具没有返回有效的 PNG/JPEG/WebP 数据。');
    if(readFrames){
      const actual=(result.frames??[]).map(f=>typeof f==='number'?f:f.frame);
      for(const f of actual)checkFrame(f);
      if(new Set([...state.seenFrames,...actual]).size>budget.maxUniqueFrames)throw new Error('已达到独立源帧预算。');
      actual.forEach(f=>state.seenFrames.add(f));
    }
    const assets=(result.assets??[]).map(a=>typeof a==='string'?{id:a}:{...a,id:a.id??a.assetId});
    state.assets.push(...assets);budget.imagesReturned+=images.length;
    return {content:[...result.content,json({revision:state.revision,assets,sourceFrames:result.frames??[]})],
      details:{revision:state.revision,assets,frames:result.frames??[]}};
  };
  const render=async(candidate,selectedFrames,signal)=>{
    emit({type:'progress',status:'rendering',message:`绘制候选 ${candidate.revision} 的 2D 对照与地面反投影`});
    const result=imageResult(await rpc('render_trajectory',{candidate,frames:selectedFrames??[]},signal));
    state.feedbackRevision=candidate.revision;state.feedbackRequest=requestNumber();
    state.latestRenderedCandidate=copy(candidate);
    emit({type:'candidate',candidate:copy(state.candidate)});
    audit('render_trajectory',{candidateRevision:candidate.revision,images:result.content.filter(c=>c.type==='image').length});
    return result;
  };
  const tool=(name,description,parameters,execute)=>({name,label:name,description,parameters,executionMode:'sequential',
    execute:async(id,args,signal)=>{
      if(state.finished)throw new Error('候选已经结束。');
      if(++budget.toolCalls>budget.maxToolCalls)throw new Error('已达到工具调用预算。');
      if(signal?.aborted)throw new Error('任务已取消。');
      return execute(args,signal,id);
    }});
  const context=()=>{
    const fm=start.preparation.frameMapping;const count=Math.min(12,start.range.endFrameExclusive-start.range.startFrame);
    const window=fm.slice(start.range.startFrame,start.range.endFrameExclusive);
    const suggestedFrames=[...new Set(Array.from({length:count},(_,i)=>{
      const target=window[0].time+(window.at(-1).time-window[0].time)*i/Math.max(1,count-1);
      return window.reduce((best,point)=>Math.abs(point.time-target)<Math.abs(best.time-target)?point:best).frame;
    }))];
    const sampledFrames=[...new Set([...suggestedFrames,...state.anchors.map(a=>a.frame)])].sort((a,b)=>a-b);
    const keys=[...(start.session?.courtCalibration?.keyframes??[])].sort((a,b)=>a.frame-b.frame);
    const relevantKeys=keys.filter(k=>k.frame>=start.range.startFrame&&k.frame<start.range.endFrameExclusive);
    const before=keys.filter(k=>k.frame<start.range.startFrame).at(-1),after=keys.find(k=>k.frame>=start.range.endFrameExclusive);
    const calibrationKeys=[...(before?[before]:[]),...relevantKeys,...(after?[after]:[])];
    const sampledKeys=calibrationKeys.length<=32?calibrationKeys:Array.from({length:32},(_,i)=>calibrationKeys[Math.round(i*(calibrationKeys.length-1)/31)]);
    return {jobId:start.jobId,entityIds:start.entityIds,range:start.range,courtTemplate:COURT,
      coordinatePolicy:'水平地面位置，米制；原点 left_baseline_far_sideline。空中脚点不是地面真值；起跳可有水平移动。',
      goal:start.goal,revision:state.revision,dirty:state.dirty,feedbackRevision:state.feedbackRevision,
      suggestedFrames,frameMapping:fm.slice(start.range.startFrame,start.range.endFrameExclusive),
      calibration:{maxKeyframeGapSeconds:start.session?.courtCalibration?.maxKeyframeGapSeconds??1.2,
        keyframes:sampledKeys,maps:sampledFrames.map(frame=>({frame,time:fm[frame].time,map:start.preparation.maps?.[frame]??null}))},
      players:Object.fromEntries(start.entityIds.map(id=>[id,{
        observed:sampledFrames.map(frame=>start.preparation.rawByPlayer[id]?.[frame]),
        current:sampledFrames.map(frame=>start.preparation.preparedByPlayer[id]?.[frame]),
        manualLocks:(start.preparation.rawByPlayer[id]??[]).filter(p=>p.locked&&p.frame>=start.range.startFrame&&p.frame<start.range.endFrameExclusive),
        breaks:(start.preparation.breaksByPlayer[id]??[]).filter(p=>p.frame>=start.range.startFrame&&p.frame<start.range.endFrameExclusive),
      }])),anchors:state.anchors,unknownRanges:state.unknownRanges,evidenceFrames:[...state.seenFrames],
      candidateSummary:state.candidate?{revision:state.candidate.revision,issues:state.candidate.issues??[],completion:state.candidate.completion}:null};
  };
  const tools=[
    tool('get_context','读取当前来源、真实时间、地面坐标、人工硬约束和候选 revision。',Type.Object({}),async()=>({content:[json(context())],details:{revision:state.revision}})),
    tool('inspect_frames','主动读取真实视频帧。全景保留球场；sheet 为时间拼图；player/feet 为保留裁剪元数据的局部图。',
      Type.Object({frames,mode:Type.Union(['full','player','feet','sheet'].map(v=>Type.Literal(v))),entityIds:Type.Optional(Type.Array(Type.String(),{minItems:1,maxItems:10}))}),
      async(args,signal)=>{
        args.frames.forEach(checkFrame);(args.entityIds??start.entityIds).forEach(checkEntity);
        if(new Set([...state.seenFrames,...args.frames]).size>budget.maxUniqueFrames)throw new Error('请求将超过独立源帧预算。');
        emit({type:'progress',status:'observing',message:`读取源帧 ${args.frames.join(', ')}（${args.mode}）`});
        const result=imageResult(await rpc('inspect_frames',{...args,entityIds:args.entityIds??start.entityIds},signal),{readFrames:true});
        audit('inspect_frames',{frames:args.frames,mode:args.mode});return result;
      }),
    tool('inspect_trajectory','读取原始与当前候选 2D 对照及反投影图；这不是自动质量判定。',
      Type.Object({revision:integer,frames:Type.Optional(renderFrames)}),async(args,signal)=>{
        checkRevision(args.revision);args.frames?.forEach(checkFrame);
        if(state.dirty&&state.candidate)throw new Error('锚点有未拟合修改，请先 fit_and_render。');
        if(state.candidate)return render(state.candidate,args.frames,signal);
        const result=imageResult(await rpc('render_trajectory',{candidate:null,frames:args.frames??[]},signal));
        audit('inspect_trajectory',{baseline:true});return result;
      }),
    tool('set_ground_anchors','新增或更新水平地面位置锚点。replace=true 替换整个模型锚点集，可用空数组清空；remove 可删除此前模型锚点。失败不会修改状态。只提供已读图片的证据帧，不能重绑身份或改人工硬约束。',
      Type.Object({revision:integer,anchors:Type.Array(Type.Object({entityId:Type.String(),frame:integer,x:Type.Number(),y:Type.Number(),
        evidenceFrames:frames,basis:text,uncertainty:Type.Optional(Type.String({minLength:1,maxLength:1800})),turn:Type.Optional(Type.Boolean())}),{maxItems:64}),
        remove:Type.Optional(Type.Array(Type.Object({entityId:Type.String(),frame:integer}),{maxItems:64})),replace:Type.Optional(Type.Boolean())}),async(args)=>{
        checkRevision(args.revision);
        if(!args.anchors.length&&!args.remove?.length&&!args.replace)throw new Error('没有锚点修改。');
        for(const a of args.remove??[]){checkEntity(a.entityId);checkFrame(a.frame);}
        for(const a of args.anchors){checkEntity(a.entityId);checkFrame(a.frame);checkEvidence(a.evidenceFrames);
          if(!Number.isFinite(a.x)||!Number.isFinite(a.y)||Math.abs(a.x)>COURT.length*10||Math.abs(a.y)>COURT.width*10)throw new Error('地面坐标必须为合理范围的有限米制数值。');
          const p=start.preparation.rawByPlayer[a.entityId]?.[a.frame];
          if(p?.locked&&(p.x!==a.x||p.y!==a.y))throw new Error('不能更改人工硬约束。');
          if(!Number.isFinite(p?.x)||!Number.isFinite(p?.y))throw new Error('原始定位缺失或排除的帧不能直接填为模型点；保留断段或未知。');
        }
        const anchors=new Map((args.replace?[]:state.anchors).map(a=>[`${a.entityId}:${a.frame}`,a]));
        (args.remove??[]).forEach(a=>anchors.delete(`${a.entityId}:${a.frame}`));
        args.anchors.forEach(a=>anchors.set(`${a.entityId}:${a.frame}`,copy(a)));
        const proposed=[...anchors.values()].sort((a,b)=>a.entityId.localeCompare(b.entityId)||a.frame-b.frame);
        validateMutation(proposed,state.unknownRanges);
        state.anchors=proposed;
        state.revision++;state.dirty=true;audit('set_ground_anchors',{anchors:args.anchors,remove:args.remove??[],replace:args.replace===true});
        return {content:[json({revision:state.revision,anchors:state.anchors,needsFit:true})],details:{revision:state.revision}};
      }),
    tool('set_unknown_ranges','替换当前无法可靠定位的区间，范围为半开区间；证据不足时保留未知。传空数组可清除。',
      Type.Object({revision:integer,unknownRanges:Type.Array(Type.Object({entityId:Type.String(),...rangeFields,reason:text,evidenceFrames:frames}),{maxItems:64})}),async(args)=>{
        checkRevision(args.revision);for(const r of args.unknownRanges){checkEntity(r.entityId);checkFrame(r.startFrame);checkFrame(r.endFrameExclusive-1);checkEvidence(r.evidenceFrames);
          if(r.endFrameExclusive<=r.startFrame)throw new Error('未知范围为空或倒置。');}
        validateMutation(state.anchors,args.unknownRanges);
        state.unknownRanges=copy(args.unknownRanges);state.revision++;state.dirty=true;audit('set_unknown_ranges',{ranges:state.unknownRanges});
        return {content:[json({revision:state.revision,unknownRanges:state.unknownRanges,needsFit:true})],details:{revision:state.revision}};
      }),
    tool('fit_and_render','使用真实时间和人工约束生成保形分段曲线，返回当前版本真实图片。读取图片后可继续修改。',
      Type.Object({revision:integer,frames:Type.Optional(renderFrames)}),async(args,signal)=>{
        checkRevision(args.revision);args.frames?.forEach(checkFrame);
        if(!state.anchors.length&&!state.unknownRanges.length)throw new Error('请先提供修正锚点或未知区间。');
        const {candidate,diff,issues}=previewGroundTrajectory(start.preparation,candidateInput());
        state.candidate={...candidate,completion:'partial'};state.dirty=false;
        const result=await render(state.candidate,args.frames,signal);
        result.content.unshift(json({diff,issues}));audit('fit_and_render',{candidateRevision:state.candidate.revision,issues});return result;
      }),
    tool('finish_candidate','完成当前候选。必须在修改后拟合并在后续模型请求中实际读取最新绘图，保留未解决区间。',
      Type.Object({revision:integer,summary:text,completion:Type.Union([Type.Literal('complete'),Type.Literal('partial')])}),async(args)=>{
        checkRevision(args.revision);
        if(!state.candidate||state.dirty||state.feedbackRevision!==state.candidate.revision||
          state.feedbackReadRevision!==state.candidate.revision||state.feedbackReadRequest<=state.feedbackRequest)
          throw new Error('请先拟合并读取最新候选绘图；旧图或同一批工具调用不能结束新候选。');
        state.candidate.completion=args.completion;state.summary=args.summary;state.finished=true;
        state.latestRenderedCandidate=copy(state.candidate);audit('finish_candidate',{completion:args.completion,summary:args.summary});
        emit({type:'candidate',candidate:copy(state.candidate)});
        return {content:[json({finished:true,revision:state.revision,completion:args.completion})],details:{revision:state.revision},terminate:true};
      }),
  ];
  return {tools,state,context};
}
