import readline from 'node:readline';
import {Agent} from '@earendil-works/pi-agent-core';
import {createQwenProvider,redactError} from './qwen-provider.mjs';
import {createTrajectoryTools} from './ground-trajectory-tools.mjs';
import {promptWithReconnect} from './ground-trajectory-reconnect.mjs';

const SYSTEM=`你是篮球视频地面轨迹修正 Agent。你的任务是在现有身份和球场标定基础上修正水平地面位置，生成正确而连续的 2D 轨迹。
先 get_context、读取覆盖全段的真实视频拼图和初始轨迹图。先核对 availableProjectionRanges 中已有投影的短段，不能因均匀 suggestedFrames 未采样到就把整段泛化为未知；这些范围只是现有投影，不代表接地真值。使用 NBA 米制模板坐标，遵守真实 frame/time/sourceTime/PTS，不使用 frame/fps 假设。
先按当前目标身份的队色、号码并结合相邻帧确认鞋属于目标。冻结检测框明显覆盖他人或身份冲突时，将目标标为遮挡/未知并说明，不能转而跟踪框内另一人；始终只修正本任务目标。可依据相邻帧证据推断遮挡期间的水平运动，但无证据不得虚构位置。
可反复 inspect_frames、查看球员或脚部 crop、提出锚点、fit_and_render，再实际读取修改后的图片，按新证据继续修改。不要只调用一次并给文字结论。
空中脚点不是地面观测，起跳期间仍可能有水平运动，不自动冻结起跳段。辨别镜头漂移、真实跑动、急停、折返，不能为了顺滑消除真实转向。
保留人工硬约束，不修改身份、跟踪、标定或原始视频。每个锚点必须给已读证据帧、定位依据和不确定性。证据不足时显式标记未知；不要虚构位置或动作识别事件。
可见地面接触点优先用 imagePoint 的 assetId 和该张返回图片上的像素 x/y 提交（包含标题区域的图像坐标）。程序自动扣标题、还原裁剪缩放并映射到米制，不要自行加 crop 原点或猜米数。双脚落地时取脚底接触点中间；单脚支撑时用支撑点；腾空时结合前后帧估计水平投影，无法判断再标未知。不要把检测缺失直接等同于人已出画。
裁图带每 50 像素的坐标线，顶部数值为 x、左侧数值为 y，均是返回图片坐标。沿坐标线定位可见鞋底接触地板的位置，不要选影子、倒影、裁图底边或检测框底边。若原有点已经合理，保留它，不必为修正而移动。
拟合器保留原始缺测断段，不会用曲线填补缺失标定。完成总结应按工具实际结果报告，不得声称已填补断段，也不要给未经独立测量的米制误差保证。通常先用 4–6 个清楚锚点生成首版，再补读有问题的帧，给绘图复核留足轮数。
工具会返回当前 revision；修改后用最新 revision 继续。只有拟合并在后续请求实际看到最新绘图后，才可 finish_candidate。达到预算时优先保留可审阅的 partial 结果。
不要将更平滑等同于更正确，不把模型位置估计描述成人工审核真值。finish summary 简洁陈述做了什么和剩余问题，不输出思考链。`;

const emit=message=>process.stdout.write(`${JSON.stringify(message)}\n`);
const pending=new Map();let nextRpc=0,agent=null,runStarted=false,closed=false;
let wakeReconnect=null;
const rejectPending=message=>{for(const p of pending.values())p.reject(new Error(message));pending.clear();};
const waitReconnect=ms=>{
  if(closed)return Promise.resolve();
  return new Promise(resolve=>{
    const timer=setTimeout(finish,ms);
    function finish(){clearTimeout(timer);if(wakeReconnect===finish)wakeReconnect=null;resolve();}
    wakeReconnect=finish;
  });
};
const rpc=(method,params,signal,timeoutMs=90000)=>new Promise((resolve,reject)=>{
  if(closed||signal?.aborted)return reject(new Error('任务已取消。'));
  const id=String(++nextRpc);const abort=()=>{pending.delete(id);clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new Error('任务已取消。'));};
  const timer=setTimeout(()=>{pending.delete(id);signal?.removeEventListener('abort',abort);reject(new Error('视觉工具或模型许可响应超时。'));},timeoutMs);
  pending.set(id,{resolve:result=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(result);},
    reject:error=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(error);}});
  signal?.addEventListener('abort',abort,{once:true});emit({type:'rpc',id,method,params});
});
const bounded=(value,fallback,min,max)=>Number.isSafeInteger(value)?Math.max(min,Math.min(max,value)):fallback;

export async function runGroundTrajectory(start){
  if(!start?.preparation?.frameMapping||!Array.isArray(start.entityIds)||!start.entityIds.length||
     !Number.isSafeInteger(start.range?.startFrame)||!Number.isSafeInteger(start.range?.endFrameExclusive)||
     start.range.startFrame<0||start.range.endFrameExclusive<=start.range.startFrame||
     start.range.endFrameExclusive>start.preparation.frameMapping.length)throw new Error('任务上下文或时间范围无效。');
  const provider=createQwenProvider();start.config={...start.config,model:provider.model.id};
  const config=start.config;
  const budget={maxRequests:bounded(config.maxRequests,12,1,24),maxUniqueFrames:bounded(config.maxUniqueFrames,64,1,128),
    maxImagesPerReply:bounded(config.maxImagesPerReply,8,1,8),maxToolCalls:bounded(config.maxToolCalls,96,1,192),
    toolCalls:0,imagesReturned:0};
  let requests=0,budgetReason=null,lengthFailures=0,modelSlotHeld=false,lastRequestError=null,pendingReconnectAttempt=null;const started=Date.now();
  const taskTimeoutMs=bounded(config.timeoutSeconds,300,10,600)*1000;
  const releaseModelSlot=async()=>{
    if(!modelSlotHeld)return;
    modelSlotHeld=false;
    await rpc('release_model_slot',{},undefined,taskTimeoutMs);
  };
  const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,requests:0,costEstimate:null};
  const runtime=createTrajectoryTools(start,{rpc,emit,budget,requestNumber:()=>requests});
  const {state}=runtime;
  agent=new Agent({
    initialState:{systemPrompt:SYSTEM,model:provider.model,tools:runtime.tools,thinkingLevel:'off'},
    streamFn:provider.streamFn,toolExecution:'sequential',getApiKey:()=>process.env.QWEN_KEY,
    transformContext:async messages=>{
      // Keep canonical anchors in every request and the latest two image replies. Old
      // images remain available by frame/asset ID instead of growing visual context forever.
      const imageIndices=messages.flatMap((m,i)=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image')?[i]:[]);
      const retained=new Set(imageIndices.slice(-2));
      const feedbackIndex=imageIndices.findLast(i=>messages[i].role==='toolResult'&&
        ['fit_and_render','inspect_trajectory'].includes(messages[i].toolName)&&
        messages[i].details?.revision===state.feedbackRevision);
      if(feedbackIndex!==undefined){
        retained.add(feedbackIndex);
        state.feedbackReadRevision=state.feedbackRevision;state.feedbackReadRequest=requests;
      }
      return messages.map((m,i)=>imageIndices.includes(i)&&!retained.has(i)?{
        ...m,content:m.content.map(c=>c.type==='image'?{type:'text',text:'[旧图已移出本次正文，可按原帧/asset ID 再读取]'}:c),
      }:m);
    },
    prepareRequest:async({context})=>{
      if(state.finished)return undefined;
      if(requests>=budget.maxRequests||budget.toolCalls>=budget.maxToolCalls){
        budgetReason=requests>=budget.maxRequests?'model_request_budget':'tool_call_budget';throw new Error('已达到任务调用预算。');
      }
      await rpc('acquire_model_slot',{},undefined,taskTimeoutMs);
      modelSlotHeld=true;
      requests++;usage.requests=requests;
      emit({type:'progress',status:'observing',message:`Qwen 第 ${requests} 轮读取视觉证据`,round:requests,usage:{...usage}});
      return {context:{...context,messages:[...context.messages,{role:'user',content:[{type:'text',text:
        `当前任务状态（不覆盖图片证据）：${JSON.stringify({revision:state.revision,dirty:state.dirty,
          anchors:state.anchors,unknownRanges:state.unknownRanges,feedbackRevision:state.feedbackRevision,
          evidenceFrames:[...state.seenFrames],remainingRequests:budget.maxRequests-requests})}`}],timestamp:Date.now()}]}};
    },
    finishTurn:async({message})=>{
      await releaseModelSlot();
      if(state.finished)return {action:'end'};
      if(message.stopReason==='error'||message.stopReason==='aborted')return undefined;
      lengthFailures=message.stopReason==='length'?lengthFailures+1:0;
      if(lengthFailures>=2){budgetReason='response_length_limit';return {action:'end'};}
      if(requests>=budget.maxRequests||budget.toolCalls>=budget.maxToolCalls){budgetReason='call_budget';return {action:'end'};}
      if(!message.content.some(c=>c.type==='toolCall'))agent.steer({role:'user',content:[{type:'text',text:
        '尚未通过 finish_candidate 结束。请使用视觉/拟合工具继续，读取最新图后完成候选；无法判断则明确未知或 partial。'}],timestamp:Date.now()});
      return {action:'continue'};
    },
  });
  agent.subscribe(event=>{
    if(event.type==='message_end'&&event.message.role==='assistant'){
      const u=event.message.usage??{};
      for(const k of ['input','output','cacheRead','cacheWrite','totalTokens'])if(Number.isFinite(u[k]))usage[k]+=u[k];
      const responseEvent={sequence:state.audit.length+1,tool:'model_response',revision:state.revision,request:requests,
        stopReason:event.message.stopReason,usage:{input:u.input,output:u.output,cacheRead:u.cacheRead,totalTokens:u.totalTokens},
        toolCalls:event.message.content.filter(c=>c.type==='toolCall').map(c=>c.name),
        ...(event.message.stopReason==='error'&&event.message.errorMessage
          ?{error:redactError(event.message.errorMessage)}:{})};
      state.audit.push(responseEvent);
      emit({type:'progress',status:'observing',message:`Qwen 第 ${requests} 轮响应完成`,usage:{...usage},event:responseEvent});
      if(event.message.stopReason==='error')emit({type:'progress',status:'observing',message:'模型请求失败，保留已有候选',error:redactError(event.message.errorMessage)});
      if(event.message.stopReason==='error')lastRequestError=event.message.errorMessage||agent.state.errorMessage||'Connection error.';
      else if(event.message.stopReason!=='aborted'){
        lastRequestError=null;agent.state.errorMessage=undefined;
        if(pendingReconnectAttempt!==null){
          const resumedEvent={sequence:state.audit.length+1,tool:'request_reconnect_resumed',revision:state.revision,
            attempt:pendingReconnectAttempt,request:requests};
          state.audit.push(resumedEvent);pendingReconnectAttempt=null;
          emit({type:'progress',status:'observing',message:'模型请求已恢复，沿现有候选继续',event:resumedEvent});
        }
        emit({type:'progress',status:'observing',message:'模型请求成功',clearLastError:true});
      }
    }
  });
  const timer=setTimeout(()=>{budgetReason='time_budget';wakeReconnect?.();agent.abort();rejectPending('已达到任务时限。');},taskTimeoutMs);
  try{
    emit({type:'progress',status:'observing',message:'准备视频帧、当前标定和原始轨迹'});
    const initialPrompt=`开始修正。目标球员 ${start.entityIds.join(', ')}，范围 [${start.range.startFrame}, ${start.range.endFrameExclusive})。
用户目标：${String(start.goal??'修正地面定位并保留真实运动').slice(0,1800)}。请先 get_context 再主动读取图片。`;
    const recovery=await promptWithReconnect(agent,initialPrompt,{
      getLastError:()=>lastRequestError,
      clearLastError:()=>{lastRequestError=null;agent.state.errorMessage=undefined;},
      shouldStop:()=>closed||budgetReason==='time_budget'||requests>=budget.maxRequests||budget.toolCalls>=budget.maxToolCalls,
      onReconnect:async({attempt,error,delayMs})=>{
        await releaseModelSlot();
        pendingReconnectAttempt=attempt;
        const waitingEvent={sequence:state.audit.length+1,tool:'request_reconnect_wait',revision:state.revision,
          attempt,delayMs,request:requests};
        state.audit.push(waitingEvent);
        emit({type:'progress',status:'reconnecting',message:`网络请求中断，保留当前候选并在 ${delayMs}ms 后续接（${attempt}/2）。`,
          reconnectAttempt:attempt,checkpointRevision:state.revision,
          progress:{reconnectAttempt:attempt,checkpointRevision:state.revision,delayMs},
          event:waitingEvent,error:redactError(error)});
      },
      sleep:waitReconnect,
      makeRecoveryPrompt:({attempt})=>`网络请求暂时中断，这是第 ${attempt} 次恢复。请根据现有对话、工具结果和 revision ${state.revision} 的状态继续，不要重放已成功完成的工具调用。`,
      maxReconnects:2,
    });
    if(recovery.error)budgetReason??=redactError(recovery.error);
  }catch(error){
    if(!state.latestRenderedCandidate)throw error;
    budgetReason??=redactError(error);
  }finally{
    clearTimeout(timer);
    try{await releaseModelSlot();}catch{}
  }
  const candidate=state.finished?state.candidate:state.latestRenderedCandidate;
  if(!candidate)throw new Error(redactError(agent.state.errorMessage||budgetReason||'模型未生成可绘制候选。'));
  if(!state.finished)candidate.completion='partial';
  const result={type:'result',candidate,completion:candidate.completion,usage:{...usage,
    toolCalls:budget.toolCalls,imagesReturned:budget.imagesReturned,uniqueFrames:state.seenFrames.size,elapsedMs:Date.now()-started},
    summary:state.finished?state.summary:'任务未完整结束；保留最近一次成功绘制的候选供人工检查。',
    evidence:{frames:[...state.seenFrames],assets:state.assets},budgetReason,audit:state.audit};
  emit(result);return result;
}

const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
lines.on('line',line=>{
  let message;try{message=JSON.parse(line);}catch{emit({type:'error',message:'无法解析 JSONL 协议。'});return;}
  if(message.type==='rpc_result'){
    const waiting=pending.get(String(message.id));if(!waiting)return;pending.delete(String(message.id));
    if(message.error)waiting.reject(new Error(typeof message.error==='string'?message.error:message.error.message??'视觉工具失败。'));
    else waiting.resolve(message.result);return;
  }
  if(message.type==='cancel'){closed=true;wakeReconnect?.();agent?.abort();rejectPending('任务已取消。');return;}
  if(message.type!=='start'||runStarted)return;runStarted=true;
  runGroundTrajectory(message).catch(error=>{emit({type:'error',message:redactError(error)});process.exitCode=1;})
    .finally(()=>{rejectPending('任务已结束。');lines.close();process.stdin.pause();});
});
lines.on('close',()=>{if(runStarted){closed=true;wakeReconnect?.();if(pending.size){agent?.abort();rejectPending('后台协议连接已关闭。');}}});
process.on('SIGTERM',()=>{closed=true;wakeReconnect?.();agent?.abort();rejectPending('任务已取消。');});
