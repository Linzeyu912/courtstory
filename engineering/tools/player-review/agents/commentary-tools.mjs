import {Type} from 'typebox';

const json=value=>({type:'text',text:JSON.stringify(value)});
const text=Type.String({minLength:1,maxLength:1800});
const integer=Type.Integer({minimum:0});
const frameList=Type.Array(integer,{minItems:1,maxItems:24});
const regionFrameList=Type.Array(integer,{minItems:1,maxItems:12});
const copy=value=>structuredClone(value);

export function validateCommentaryPlan(plan,{duration,readFrames,frameTimes,requireDetail=true}={}){
  const errors=[];
  const fail=message=>errors.push(message);
  if(!plan||typeof plan!=='object')return ['plan 必须是对象'];
  if(typeof plan.summary!=='string'||!plan.summary.trim())fail('summary 不能为空');
  if(!Array.isArray(plan.events)||!Array.isArray(plan.cues)||!Array.isArray(plan.uncertainties))return ['events、cues、uncertainties 必须是数组'];
  if(!plan.events.length)fail('至少需要一个关键事件');
  if(plan.cues.length<3||plan.cues.length>6)fail('讲解条数应为 3–6 条');
  const eventIds=new Set();
  for(const event of plan.events){
    if(!event?.eventId||eventIds.has(event.eventId))fail('eventId 必须非空且唯一'); else eventIds.add(event.eventId);
    if(!finiteRange(event.startTime,event.endTime,duration))fail(`事件 ${event.eventId??'?'} 时间无效或超出视频范围`);
    if(typeof event.description!=='string'||!event.description.trim())fail(`事件 ${event.eventId??'?'} 缺少描述`);
    if(!Array.isArray(event.participants)||!Array.isArray(event.evidenceFrames)||!Array.isArray(event.uncertainties))fail(`事件 ${event.eventId??'?'} 字段格式无效`);
    else if(!event.evidenceFrames.length||event.evidenceFrames.some(frame=>!readFrames.has(frame)))fail(`事件 ${event.eventId??'?'} 必须引用已读取图片中的证据帧`);
  }
  const cueIds=new Set();
  for(const cue of plan.cues){
    if(!cue?.cueId||cueIds.has(cue.cueId))fail('cueId 必须非空且唯一'); else cueIds.add(cue.cueId);
    if(!eventIds.has(cue.eventId))fail(`讲解 ${cue.cueId??'?'} 引用了不存在的事件`);
    if(!finiteRange(cue.suggestedStartTime,cue.suggestedEndTime,duration))fail(`讲解 ${cue.cueId??'?'} 时间无效或超出视频范围`);
    if(typeof cue.text!=='string'||!cue.text.trim()||cue.text.length>120||!/[\u3400-\u9fff]/u.test(cue.text))fail(`讲解 ${cue.cueId??'?'} 必须有简洁自然的中文文本`);
    if(!['during_play','pause'].includes(cue.delivery))fail(`讲解 ${cue.cueId??'?'} delivery 无效`);
    if(cue.delivery==='during_play'&&Number.isFinite(cue.suggestedStartTime)&&Number.isFinite(cue.suggestedEndTime)){
      const han=(cue.text.match(/\p{Script=Han}/gu)??[]).length;
      const allowed=Math.floor(Math.max(0,cue.suggestedEndTime-cue.suggestedStartTime)*4+1e-9);
      if(han>allowed)fail(`讲解 ${cue.cueId??'?'} 超出普通语速约每秒 4 个汉字的时间；请压缩或改为 pause`);
    }
    if(typeof cue.focus!=='string'||!cue.focus.trim())fail(`讲解 ${cue.cueId??'?'} 缺少 focus`);
    if(!Array.isArray(cue.evidenceFrames)||!cue.evidenceFrames.length||cue.evidenceFrames.some(frame=>!readFrames.has(frame)))fail(`讲解 ${cue.cueId??'?'} 必须引用已读取图片中的证据帧`);
  }
  if(requireDetail&&(!readFrames.detailRead||!plan.events.some(e=>e.evidenceFrames.some(f=>readFrames.detailFrames.has(f)))))
    fail('完成前需读取至少一个细化视频窗口或局部图，并用其帧支持关键事件');
  return errors;
}
function finiteRange(start,end,duration){return Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>=start&&Number.isFinite(duration)&&end<=duration;}

export function createCommentaryTools(start,{rpc,emit,budget,requestNumber=()=>0}){
  const duration=Number(start.context?.duration);
  const frameTimes=new Map();
  const addFrame=value=>{
    const frame=typeof value==='number'?value:value?.frame;
    const relativeTime=typeof value==='object'?value.time:undefined;
    const sourceTime=typeof value==='object'?(value.sourceTime??value.time):undefined;
    if(Number.isSafeInteger(frame))frameTimes.set(frame,{time:relativeTime,sourceTime});
  };
  (start.context?.frames??[]).forEach(addFrame);
  (start.overview?.details?.frames??[]).forEach(addFrame);
  (start.overview?.details?.assets??[]).forEach(asset=>{addFrame(asset);(asset.tiles??[]).forEach(addFrame);});
  const seenFrames=new Set((start.overview?.details?.frames??[]).map(f=>typeof f==='number'?f:f.frame).filter(Number.isSafeInteger));
  const overviewFrames=new Set(seenFrames);
  const detailFrames=new Set();
  seenFrames.detailRead=false;seenFrames.detailFrames=detailFrames;
  const state={seenFrames,detailFrames,frameTimes,assets:copy(start.overview?.details?.assets??[]),plan:null,finished:false,audit:[]};
  const record=(tool,details={})=>{
    const item={sequence:state.audit.length+1,tool,request:requestNumber(),...details};state.audit.push(item);
    emit?.({type:'progress',status:'observing',message:`${tool} 完成`,event:item});
  };
  const call=(name,schema,description,execute)=>({name,label:name,description,parameters:schema,executionMode:'sequential',execute:async(id,args,signal)=>{
    if(signal?.aborted)throw new Error('任务已取消。');
    if(state.finished)throw new Error('讲解方案已结束。');
    if(++budget.toolCalls>budget.maxToolCalls)throw new Error('已达到工具调用预算。');
    return execute(args,signal);
  }});
  const images=(result,largerView=false)=>{
    if(!result||!Array.isArray(result.content))throw new Error('视频工具返回格式无效。');
    const actual=result.content.filter(c=>c.type==='image');
    if(!actual.length||actual.some(c=>!['image/png','image/jpeg','image/webp'].includes(c.mimeType)||typeof c.data!=='string'||!c.data))
      throw new Error('视频工具必须返回实际 PNG、JPEG 或 WebP 图片数据。');
    const frames=result.frames??result.details?.frames??[];
    for(const entry of frames){const frame=typeof entry==='number'?entry:entry.frame;if(Number.isSafeInteger(frame)){seenFrames.add(frame);if(largerView||!overviewFrames.has(frame))detailFrames.add(frame);}addFrame(entry);}
    seenFrames.detailRead=detailFrames.size>0;
    const assets=result.assets??result.details?.assets??[];state.assets.push(...assets);
    budget.imagesReturned=(budget.imagesReturned??0)+actual.length;
    return {content:result.content,details:{frames,assets}};
  };
  const tools=[
    call('get_video_context',Type.Object({}),'读取视频来源、范围、原始帧时间映射和已读概览帧。',async()=>({content:[json({context:{videoRef:start.context.videoRef,width:start.context.width,height:start.context.height,duration,
      overviewFrames:[...(start.overview?.details?.frames??[])].map(f=>typeof f==='number'?{frame:f,...frameTimes.get(f)}:f),
      observationAvailability:{available:!['unknown','mismatch',null,undefined].includes(start.context.observations),sourceState:start.context.observations??'unknown'},
      timelineFrames:start.context.frames?.length??0},overview:{details:start.overview?.details,summary:(start.overview?.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')},assets:state.assets,
      readFrames:[...seenFrames],plan:state.plan})]})),
    call('read_video_window',Type.Object({startTime:Type.Number({minimum:0}),endTime:Type.Number({minimum:0}),fps:Type.Optional(Type.Number({minimum:0.1,maximum:30})),mode:Type.Union([Type.Literal('sheet'),Type.Literal('full')]),frames:Type.Optional(frameList)}),'片内相对秒（0开始），默认2fps。sheet每页6格、每次最多128帧；full每次最多12张单帧大图。采样数=floor((endTime-startTime)*fps)+1，例如full 15–16秒@8fps=9帧。过长窗口请缩短或降低fps，也可用frames精确指定。',async(args,signal)=>{
      if(args.endTime<args.startTime||args.endTime>duration)throw new Error('视频窗口时间范围无效。');
      const result=images(await rpc('read_video_window',args,signal),args.mode==='full');record('read_video_window',{startTime:args.startTime,endTime:args.endTime,frames:result.details.frames});return result;
    }),
    call('inspect_region',Type.Object({frames:regionFrameList,box:Type.Optional(Type.Array(Type.Number(),{minItems:4,maxItems:4})),entityId:Type.Optional(Type.String({minLength:1,maxLength:100})),trackId:Type.Optional(integer)}),'读取人物、候选 trackId 或区域的原始视频局部图；box 为原视频像素 [x1,y1,x2,y2]，每次最多12帧。',async(args,signal)=>{
      const result=images(await rpc('inspect_region',args,signal),true);record('inspect_region',{frames:result.details.frames});return result;
    }),
    call('get_observations',Type.Object({startTime:Type.Number({minimum:0}),endTime:Type.Number({minimum:0}),entityIds:Type.Optional(Type.Array(Type.String(),{maxItems:30})),trackIds:Type.Optional(Type.Array(integer,{maxItems:30}))}),'按片内相对秒查询观测；不指定ID可发现候选轨迹，trackIds可查局部。trackId不是姓名或稳定人物身份，仅作图像辅助线索。',async(args,signal)=>{
      if(args.endTime<args.startTime||args.endTime>duration)throw new Error('观察时间范围无效。');
      const result=await rpc('get_observations',args,signal);record('get_observations',{startTime:args.startTime,endTime:args.endTime});
      return {content:[json(result)]};
    }),
    call('save_commentary_plan',Type.Object({plan:Type.Object({summary:text,events:Type.Array(Type.Object({eventId:text,startTime:Type.Number(),endTime:Type.Number(),description:text,participants:Type.Array(Type.String()),evidenceFrames:frameList,uncertainties:Type.Array(Type.String())})),cues:Type.Array(Type.Object({cueId:text,eventId:text,suggestedStartTime:Type.Number(),suggestedEndTime:Type.Number(),text,focus:text,delivery:Type.Union([Type.Literal('during_play'),Type.Literal('pause')]),evidenceFrames:frameList})),uncertainties:Type.Array(Type.String())}),finish:Type.Optional(Type.Boolean())}),'保存并校验片内相对秒数时间戳及可追溯原始帧证据的中文讲解草案。',async(args)=>{
      const plan=copy(args.plan);const errors=validateCommentaryPlan(plan,{duration,readFrames:seenFrames,frameTimes,requireDetail:args.finish===true});
      if(errors.length)throw new Error(`方案校验失败：${errors.join('；')}`);
      for(const item of [...plan.events,...plan.cues]){
        item.evidenceTimes=[...new Set(item.evidenceFrames)].map(frame=>({frame,...frameTimes.get(frame)}));
        if(item.evidenceTimes.some(point=>!Number.isFinite(point.time)||!Number.isFinite(point.sourceTime)))throw new Error('证据帧缺少片内时间或原视频时间映射。');
      }
      state.plan=plan;state.finished=args.finish===true;record('save_commentary_plan',{finish:state.finished,eventCount:plan.events.length,cueCount:plan.cues.length});
      emit?.({type:'progress',status:'checkpoint',message:'讲解方案已安全保存',safePlan:copy(plan)});
      return {content:[json({saved:true,finish:state.finished,plan})],details:{finish:state.finished},...(state.finished?{terminate:true}:{})};
    }),
  ];
  return {tools,state};
}
