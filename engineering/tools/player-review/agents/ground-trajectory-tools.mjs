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
const pick=(value,keys)=>value==null?null:Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
// Full diagnostics remain in the backend journal. Repeating camera-fit internals
// for every observation overwhelmed the live model context on real video.
const observation=value=>pick(value,['frame','time','x','y','source','imageSource','imagePoint','rawImagePoint',
  'footMethod','groundContactConfirmed','calibrationFrames','referenceCalibration','calibrationSupport',
  'sensitivity','outsideCourt','locked','reviewRequired']);
const calibrationMap=value=>pick(value,['toImage','toCourt','side','method','supportFrames','referenceOnly',
  'reviewRequired','fitRmsePixels','controlCount','checkResiduals','supportHulls']);
const calibrationKey=value=>({...pick(value,['frame','side','source','status','reviewRequired','cameraSupportFrame']),
  points:(value.points??[]).map(p=>pick(p,['id','image','source','role','enabled'])),
  quality:pick(value.quality,['method','referenceFrame','cameraSupportFrame','independentAccuracyValidated'])});

export function summarizeTrajectoryIssues(issues) {
  if(issues.length<=64)return issues;
  const groups=new Map(),other=[];
  for(const issue of issues){
    if(!Number.isSafeInteger(issue.frame)||!issue.entityId||!issue.reason){other.push(issue);continue;}
    const key=JSON.stringify([issue.entityId,issue.reason]);
    if(!groups.has(key))groups.set(key,{entityId:issue.entityId,reason:issue.reason,frames:[]});
    groups.get(key).frames.push(issue.frame);
  }
  return {total:issues.length,ranges:[...groups.values()].map(({entityId,reason,frames})=>{
    const ranges=[];
    for(const frame of [...new Set(frames)].sort((a,b)=>a-b)){
      if(ranges.length&&ranges.at(-1)[1]===frame)ranges.at(-1)[1]=frame+1;
      else ranges.push([frame,frame+1]);
    }
    return {entityId,reason,count:frames.length,ranges};
  }),other};
}

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
      try{return await execute(args,signal,id);}
      catch(error){audit(name,{error:String(error.message??error).slice(0,600)});throw error;}
    }});
  const context=()=>{
    const fm=start.preparation.frameMapping;const count=Math.min(start.entityIds.length>2?6:12,start.range.endFrameExclusive-start.range.startFrame);
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
    const keyCount=start.entityIds.length>2?16:32;
    const sampledKeys=calibrationKeys.length<=keyCount?calibrationKeys:Array.from({length:keyCount},(_,i)=>calibrationKeys[Math.round(i*(calibrationKeys.length-1)/(keyCount-1))]);
    const availableProjections=id=>{
      const raw=start.preparation.rawByPlayer[id]??[],ranges=[];let count=0;
      for(let frame=start.range.startFrame;frame<start.range.endFrameExclusive;frame++){
        const point=raw[frame];
        if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))continue;
        count++;
        if(ranges.length&&ranges.at(-1).endFrameExclusive===frame)ranges.at(-1).endFrameExclusive=frame+1;
        else ranges.push({startFrame:frame,endFrameExclusive:frame+1});
      }
      return {count,ranges:ranges.map(({startFrame,endFrameExclusive})=>({startFrame,endFrameExclusive,
        suggestedEvidenceFrames:[...new Set([startFrame,Math.floor((startFrame+endFrameExclusive-1)/2),endFrameExclusive-1])]}))};
    };
    return {jobId:start.jobId,entityIds:start.entityIds,range:start.range,courtTemplate:COURT,
      coordinatePolicy:'水平地面位置，米制；原点 left_baseline_far_sideline。空中脚点不是地面真值；起跳可有水平移动。',
      goal:start.goal,revision:state.revision,dirty:state.dirty,feedbackRevision:state.feedbackRevision,
      suggestedFrames,frameMapping:start.entityIds.length>2?sampledFrames.map(frame=>fm[frame]):fm.slice(start.range.startFrame,start.range.endFrameExclusive),
      frameMappingPolicy:start.entityIds.length>2?'Exact source timestamps at sampled/anchor frames; inspect_frames returns exact timing for any other requested frame. Full mapping stays in the backend.':'complete',
      calibration:{maxKeyframeGapSeconds:start.session?.courtCalibration?.maxKeyframeGapSeconds??1.2,
        keyframes:sampledKeys.map(calibrationKey),maps:sampledFrames.map(frame=>({frame,time:fm[frame].time,map:calibrationMap(start.preparation.maps?.[frame])}))},
      players:Object.fromEntries(start.entityIds.map(id=>{
        const rawPoints=start.preparation.rawByPlayer[id]??[];
        const available=availableProjections(id);
        const entity=start.session?.entities?.find(item=>item.id===id);
        return [id,{
        identity:{name:entity?.name??null,team:entity?.team??null,jersey:entity?.jersey??null,role:entity?.role??null},
        availableProjectionRanges:available.ranges,availableProjectionCount:available.count,
        availableProjectionMeaning:'仅表示当前范围内已有 rawByPlayer 的有限 x/y 投影，不代表人物可见、脚点接地或位置真值。suggestedEvidenceFrames 仅供核查，不会自动读取图像。',
        observed:sampledFrames.map(frame=>observation(rawPoints[frame])),
        current:start.entityIds.length>2?sampledFrames.flatMap(frame=>{
          const raw=observation(rawPoints[frame]);
          const current=observation(start.preparation.preparedByPlayer[id]?.[frame]);
          return JSON.stringify(raw)===JSON.stringify(current)?[]:[current];
        }):sampledFrames.map(frame=>observation(start.preparation.preparedByPlayer[id]?.[frame])),
        currentPolicy:start.entityIds.length>2?'Only changed current observations are listed; otherwise current equals observed.':'explicit',
        manualLocks:rawPoints.filter(p=>p.locked&&p.frame>=start.range.startFrame&&p.frame<start.range.endFrameExclusive).map(observation),
        rangeBoundaryLocks:[start.range.startFrame,start.range.endFrameExclusive-1].map(frame=>observation(start.preparation.preparedByPlayer[id]?.[frame])).filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)),
        boundaryPolicy:'Keep rangeBoundaryLocks at their current coordinates; choose interior frames for corrections.',
        breaks:(start.preparation.breaksByPlayer[id]??[]).filter(p=>p.frame>=start.range.startFrame&&p.frame<start.range.endFrameExclusive),
      }];
      })),anchors:state.anchors,unknownRanges:state.unknownRanges,evidenceFrames:[...state.seenFrames],
      candidateSummary:state.candidate?{revision:state.candidate.revision,issues:summarizeTrajectoryIssues(state.candidate.issues??[]),completion:state.candidate.completion}:null};
  };
  const tools=[
    tool('get_context','读取当前来源、真实时间、地面坐标、人工硬约束和候选 revision。',Type.Object({}),async()=>({content:[json(context())],details:{revision:state.revision}})),
    tool('inspect_frames','主动读取真实视频帧。sheet 时间拼图最多 12 帧；full 最多 8 帧；player/feet 局部图的帧数 × 人数最多 8。裁图附原图坐标元数据。',
      Type.Object({frames,mode:Type.Union(['full','player','feet','sheet'].map(v=>Type.Literal(v))),entityIds:Type.Optional(Type.Array(Type.String(),{minItems:1,maxItems:10}))}),
      async(args,signal)=>{
        args.frames.forEach(checkFrame);(args.entityIds??start.entityIds).forEach(checkEntity);
        const imageCount=args.mode==='sheet'?Math.ceil(args.frames.length/6):args.frames.length*(args.mode==='full'?1:(args.entityIds??start.entityIds).length);
        if(imageCount>budget.maxImagesPerReply)throw new Error(`本次会返回 ${imageCount} 张图，最多 ${budget.maxImagesPerReply} 张；请分批读取或使用 sheet。`);
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
    tool('set_ground_anchors','新增或更新地面锚点。imagePoint 带 assetId 时，x/y 是返回的那张图片上的像素位置（含标题），程序自动处理裁剪、标题、缩放和米制映射，优先用此方式；不带 assetId 才是原始视频像素。不要自行换算。imagePoint 与米制 x/y 二选一。replace=true 替换整个锚点集；remove 删除锚点。保留人工硬约束。',
      Type.Object({revision:integer,anchors:Type.Array(Type.Object({entityId:Type.String(),frame:integer,x:Type.Optional(Type.Number()),y:Type.Optional(Type.Number()),
        imagePoint:Type.Optional(Type.Object({x:Type.Number(),y:Type.Number(),assetId:Type.Optional(Type.String())})),
        evidenceFrames:frames,basis:text,uncertainty:Type.Optional(Type.String({minLength:1,maxLength:1800})),turn:Type.Optional(Type.Boolean())}),{maxItems:64}),
        remove:Type.Optional(Type.Array(Type.Object({entityId:Type.String(),frame:integer}),{maxItems:64})),replace:Type.Optional(Type.Boolean())}),async(args)=>{
        checkRevision(args.revision);
        if(!args.anchors.length&&!args.remove?.length&&!args.replace)throw new Error('没有锚点修改。');
        for(const a of args.remove??[]){checkEntity(a.entityId);checkFrame(a.frame);}
        const converted=args.anchors.map(original=>{
          const a=copy(original);checkEntity(a.entityId);checkFrame(a.frame);checkEvidence(a.evidenceFrames);
          if(a.imagePoint!==undefined){
            if(a.x!==undefined||a.y!==undefined)throw new Error('imagePoint 与米制 x/y 只能选一种。');
            if(!state.seenFrames.has(a.frame))throw new Error('像素锚点所在帧必须先通过图片工具读取。');
            let {x:u,y:v}=a.imagePoint;
            if(a.imagePoint.assetId!==undefined){
              const asset=state.assets.find(item=>item.id===a.imagePoint.assetId||item.assetId===a.imagePoint.assetId);
              const meta=asset?.frame===a.frame?asset:asset?.tiles?.find(tile=>tile.frame===a.frame);
              if(!meta?.crop||!Number.isFinite(meta.scale)||meta.scale<=0)throw new Error('assetId 必须是该帧已返回的原图或裁图，不能使用轨迹回投图。');
              const tx=meta.tileOrigin?.[0]??0,ty=meta.tileOrigin?.[1]??0;
              const px=u-tx,py=v-ty-(meta.labelHeight??0);
              if(!Number.isFinite(px)||!Number.isFinite(py)||px<0||py<0||
                 px>(meta.crop[2]-meta.crop[0])*meta.scale||py>(meta.crop[3]-meta.crop[1])*meta.scale)
                throw new Error('像素点必须位于该帧图片内容内，不能落在标题或其他拼图格。');
              u=meta.crop[0]+px/meta.scale;v=meta.crop[1]+py/meta.scale;
            }
            const h=start.preparation.maps?.[a.frame]?.toCourt;
            if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||v<0||u>start.clip.width||v>start.clip.height)
              throw new Error('imagePoint 必须使用原始视频范围内的像素坐标。');
            const d=h?.[6]*u+h?.[7]*v+h?.[8];
            if(!h||h.length!==9||!Number.isFinite(d)||Math.abs(d)<1e-8)throw new Error('该帧没有可用球场映射，保留未知。');
            a.x=(h[0]*u+h[1]*v+h[2])/d;a.y=(h[3]*u+h[4]*v+h[5])/d;
            a.basis=`${a.basis} [source imagePoint ${u},${v}; frame ${a.frame} calibration${a.imagePoint.assetId?`; asset ${a.imagePoint.assetId}`:''}]`;
            delete a.imagePoint;
          }
          return a;
        });
        for(const a of converted){
          if(!Number.isFinite(a.x)||!Number.isFinite(a.y)||Math.abs(a.x)>COURT.length*10||Math.abs(a.y)>COURT.width*10)throw new Error('地面坐标必须为合理范围的有限米制数值。');
          const p=start.preparation.rawByPlayer[a.entityId]?.[a.frame];
          if(p?.locked&&(p.x!==a.x||p.y!==a.y))throw new Error('不能更改人工硬约束。');
          if(!Number.isFinite(p?.x)||!Number.isFinite(p?.y))throw new Error('原始定位缺失或排除的帧不能直接填为模型点；保留断段或未知。');
        }
        const anchors=new Map((args.replace?[]:state.anchors).map(a=>[`${a.entityId}:${a.frame}`,a]));
        (args.remove??[]).forEach(a=>anchors.delete(`${a.entityId}:${a.frame}`));
        converted.forEach(a=>anchors.set(`${a.entityId}:${a.frame}`,a));
        const proposed=[...anchors.values()].sort((a,b)=>a.entityId.localeCompare(b.entityId)||a.frame-b.frame);
        validateMutation(proposed,state.unknownRanges);
        state.anchors=proposed;
        state.revision++;state.dirty=true;audit('set_ground_anchors',{anchors:converted,remove:args.remove??[],replace:args.replace===true});
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
        result.content.unshift(json({diff,issues:summarizeTrajectoryIssues(issues)}));audit('fit_and_render',{candidateRevision:state.candidate.revision,issues});return result;
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
