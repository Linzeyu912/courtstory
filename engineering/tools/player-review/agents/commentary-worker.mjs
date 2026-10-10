import readline from 'node:readline';
import {Agent} from '@earendil-works/pi-agent-core';
import {createCommentaryProvider,redactError} from './commentary-provider.mjs';
import {createCommentaryTools} from './commentary-tools.mjs';
import {promptWithReconnect} from './ground-trajectory-reconnect.mjs';

const SYSTEM=`你是篮球比赛视频的赛后中文讲解策划 Agent。先用 get_video_context 查看视频长度、尺寸和全片概览；拼图用于全局定位。然后读取适合判断关键回合的原视频细节，再用有图像证据的观察整理关键事件和简洁自然的中文讲解；覆盖每个明确出手，不能为了条数或故事重点漏掉投篮，不要为每位球员逐条解说。若关键持球人、传球交互或球筐附近的小目标在拼图中看不清，可读 full 帧或 inspect_region；需要时可对短窗口逐次提高到 8–12fps。不要对模糊缩略图反复低密采样后猜测结果，也不要求每段都高帧率或裁图，按画面需要选择。

只描述画面实际支持的内容：球员移动、传球、投篮、攻防转换、站位和节奏。把观察到的事实与战术解释分清；没有清晰证据时写明不确定，不猜球员姓名、号码、比分或结果，不从文件名推断内容。可用 get_observations 帮助理解已有记录，但必须优先核实视频图像。讲解是赛后战术讲解，可解释回合而无需假装实时播报。

提交前逐条核对事件描述、summary、讲解文本和 focus 的因果是否一致，尤其要分清投篮是否命中、谁拿到篮板、是否随后由底线发球；不得把相邻片段的事件拼成一个未经支持的结果。判断两分或三分需结合出手位置和得分前后记分牌（可能延迟更新），不清楚就只说投篮。区分进攻时限与节末计时。素材可能从回合中途开始，不能默认是完整回合。挡拆、协防等战术机制只有在看清关键球员互动时才使用；不确定就写可见动作，不强行套术语。during_play 讲解按普通自然语速约每秒 4 个汉字，按讲解时间窗估算后删短；容不下就改为 pause，避免一口气念过长句子。

所有计划时间使用片内相对秒数（视频从 0 秒开始），不能按帧率推算时间，也不能超出片内时长；工具和证据同时保留原始 sourceTime，但它不用于计划区间。events 描述关键片段，cues 将事件写成短中文播报，标注 during_play 或 pause。事件和每条讲解都必须引用已经通过图像实际读取的帧号。只在证据足够、方案经过校验时 finish=true；预算将尽时保存可审阅的草稿。不要输出思考过程。

每个事件必须显式 kind='shot' 或 'other'；投篮事件必须给 shotStatus='confirmed' 或 'uncertain'。逐次核实离手时刻，人物定位和动作不足时保持 uncertain，不能假装 confirmed。每个 confirmed 投篮恰好对应一个 kind='shot_release' 节点，anchorAssetFrame 就是实际看过的出手帧，不另存 releaseFrame。投手必须引用有效 participantId；身份未知但画面人物能定位，可使用匿名局部人物，shooterRef 不能为 null。该节点至少有一条 delivery='pause' 的短句，以在出手帧冻结反馈。其他 during_play 节点不要求冻结。

对每次 confirmed 出手读取之前约一秒至出手帧的真实图像，优先短窗口 8–12fps，并核实起点、关键中间动作和出手，遇切镜不能跨镜解释防守。shotFeedback={shooterRef,defenderRefs,opportunity:{grade:'good|fair|poor|unknown',reason},pressure:{grade:'low|medium|high|unknown',reason},evidenceFrames,ratingsRefs}。opportunity 衡量机会，pressure 衡量防守压力，分别解释，两者可同时 good 和 high。只引用实际返回且不晚于出手的评价证据帧；事件确认本身可以另用出手后证据。证据不完整仍建立出手冻结节点，但两项评价写 unknown 并明确缺失理由；不要声明自己计算的 defenseWindow 覆盖。

读取 get_video_context.ratingContext，按 participantId 找投手和防守者同赛季的已知 2K 能力，作为背景结合画面解释机会与压力；选择其 ratingRef 到 ratingsRefs，不能把游戏能力当作实际防守证据，不能只用评分确定等级，也不能编造评分/姓名/赛季。能力缺值为 null 且保留逐字段出处；缺评级不妨碍证据充分时给视觉评价。宿主将补齐本次参与人物的能力引用和实际 defenseWindow，解说 Agent 不画圈或路线，实际圈选与绘图交独立绘图 Agent。`;
const emit=message=>process.stdout.write(`${JSON.stringify(message)}\n`);
let agent=null,closed=false,started=false,nextRpc=0,requestCount=0;
const pending=new Map();
const rejectPending=reason=>{for(const p of pending.values())p.reject(new Error(reason));pending.clear();};
const rpc=(method,params,signal,timeoutMs=90000)=>new Promise((resolve,reject)=>{
  if(closed||signal?.aborted)return reject(new Error('任务已取消。'));
  const id=String(++nextRpc);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('视频工具响应超时。'));},timeoutMs);
  pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
  signal?.addEventListener('abort',()=>{pending.delete(id);clearTimeout(timer);reject(new Error('任务已取消。'));},{once:true});
  emit({type:'rpc',id,method,params});
});
const limit=(value,fallback,min,max)=>Number.isSafeInteger(value)?Math.max(min,Math.min(max,value)):fallback;
const text=value=>({type:'text',text:String(value)});

export async function runCommentary(start){
  if(!start?.context||!Number.isFinite(start.context.duration)||start.context.duration<=0||!Array.isArray(start.context.frames)||!start.overview||!Array.isArray(start.overview.content))
    throw new Error('讲解任务缺少有效的视频上下文或概览图片。');
  const provider=createCommentaryProvider(process.env,start.modelConfig??null);const config=start.config??{};
  const budget={maxRequests:limit(config.maxRequests,12,1,24),maxToolCalls:limit(config.maxToolCalls,30,1,60),toolCalls:0,imagesReturned:0};
  const timeoutMs=limit(config.timeoutSeconds,480,10,600)*1000,startedAt=Date.now();
  const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,requests:0};
  const runtime=createCommentaryTools(start,{rpc,emit,budget,requestNumber:()=>requestCount});
  agent=new Agent({
    initialState:{systemPrompt:SYSTEM+`\n解说只输出文字、结构化人物引用和关键节点，不输出坐标/路线/绘图。先读取 get_video_context 的姓名快照；只有快照中 displayName 非空的有效区间可以称名。复制 participantId/nameRecordRef；人工优先与已采用机器姓名保留来源，候选/冲突/未知匿名。不可按同一P编号跨换人或切镜称名，不读出?或~，不自动翻译姓名。每个节点含 nodeId/eventId/cueIds/anchorAssetFrame/evidenceWindow={startFrame,endFrame}/participantRefs/focus/uncertainties；anchorAssetFrame 必须是实际看过的该事件帧，窗口属于事件，不能猜区间中点。每条cue必须且只能归属恰好一个node，不能漏句或在同一/不同节点重复cueId；多个cue可共享同一节点。during_play句子仍有实际帧锚点，但保持播放中讲解，不强制冻结。计划participants为结构化数组；具名cue保存participantRefs和nameRecordRefs，引用证据不得越过姓名区间。`,model:provider.model,tools:runtime.tools,thinkingLevel:provider.thinkingLevel},
    streamFn:provider.streamFn,toolExecution:'sequential',getApiKey:()=>provider.apiKey,
    transformContext:async messages=>{
      const detailed=messages.flatMap((m,i)=>m.role==='toolResult'&&Array.isArray(m.content)&&m.content.some(c=>c.type==='image')?[i]:[]);
      const retain=new Set(detailed.slice(-2));
      return messages.map((m,i)=>{
        if(m.role==='user'&&m.content?.some(c=>c.type==='image')&&m.content.some(c=>c.type==='text'&&c.text.includes('全片概览')))return m;
        if(detailed.includes(i)&&!retain.has(i))return {...m,content:m.content.map(c=>c.type==='image'?text('[旧视频图像已折叠；按时间窗口或证据帧重新读取]'):c)};
        return m;
      });
    },
    prepareRequest:async({context})=>{
      if(requestCount>=budget.maxRequests)throw new Error('已达到模型请求预算。');
      requestCount++;usage.requests=requestCount;
      emit({type:'progress',status:'observing',message:`${provider.model.name} 第 ${requestCount} 轮整理视频证据`,round:requestCount});
      const notebook=runtime.state.plan?{...runtime.state.plan,ratingContext:undefined,
        participants:runtime.state.plan.participants?.map(({nameRecord,...p})=>p)}:null;
      const remainingSeconds=Math.max(0,Math.floor((timeoutMs-(Date.now()-startedAt))/1000));
      const budgetNote=`当前是第 ${requestCount}/${budget.maxRequests} 次模型请求，工具已用 ${budget.toolCalls}/${budget.maxToolCalls}，剩余约 ${remainingSeconds} 秒。`+
        (requestCount>=budget.maxRequests-4||remainingSeconds<180?'现在先用已有证据调用 save_commentary_plan 保存；证据已充分则 finish=true，否则保存草稿后只补缺口。保留至少两分钟输出结构化计划并修正，不要继续重复取证。':'已有足够证据时及时保存方案；不必耗尽预算。')+
        'ratingContext.records 通过 profileRef 指向 profiles 的能力值和来源；没有记录即缺评分。participants 仅加入节点确实使用的人物，不复制整份快照。';
      return {context:{...context,messages:[...context.messages,{role:'user',content:[text(`${budgetNote}\n当前讲解笔记（保留先前事件，不代表新增视觉证据）：${JSON.stringify(notebook)}`)],timestamp:Date.now()}]}};
    },
    finishTurn:async({message})=>{
      if(runtime.state.finished)return {action:'end'};
      if(message.stopReason==='error'||message.stopReason==='aborted')return {action:'end'};
      if(requestCount>=budget.maxRequests||budget.toolCalls>=budget.maxToolCalls)return {action:'end'};
      if(!message.content.some(c=>c.type==='toolCall'))agent.steer({role:'user',content:[text(runtime.state.plan
        ?'请检查当前保存的方案并继续，满足证据条件后用 save_commentary_plan finish=true。'
        :'请继续调用视频工具查看证据，并保存讲解方案。')],timestamp:Date.now()});
      return {action:'continue'};
    },
  });
  agent.subscribe(event=>{
    if(event.type==='tool_execution_end'&&event.isError)emit({type:'progress',status:'tool_error',event:{tool:event.toolName,error:redactError((JSON.stringify(event.result?.content??event.result)??'工具调用失败').slice(0,3000))}});
    if(event.type!=='message_end'||event.message.role!=='assistant')return;
    const u=event.message.usage??{};for(const key of ['input','output','cacheRead','cacheWrite','totalTokens'])if(Number.isFinite(u[key]))usage[key]+=u[key];
    if(event.message.stopReason==='error')runtime.state.error=redactError(event.message.errorMessage||agent.state.errorMessage||'模型请求失败');
    else if(event.message.stopReason!=='aborted')runtime.state.error=null;
    emit({type:'progress',status:'observing',message:`${provider.model.name} 第 ${requestCount} 轮响应完成`,usage:{...usage},event:{tool:'model_response',request:requestCount,
      stopReason:event.message.stopReason,toolCalls:event.message.content.filter(c=>c.type==='toolCall').map(c=>c.name),usage:{input:u.input,output:u.output,totalTokens:u.totalTokens},
      ...(event.message.stopReason==='error'?{error:redactError(event.message.errorMessage)}:{})}});
  });
  const timer=setTimeout(()=>{closed=true;agent?.abort();rejectPending('任务超过时间预算。');},timeoutMs);
  const initial=[text(`【全片概览】视频 ${start.context.width}×${start.context.height}，时长 ${start.context.duration} 秒。用户目标：${String(start.goal??'为关键篮球回合撰写简洁中文讲解').slice(0,1200)}。以下概览图像属于真实视频证据。`),
    ...start.overview.content.filter(c=>c.type==='image'||c.type==='text').map(c=>c.type==='image'?{type:'image',data:c.data,mimeType:c.mimeType}:text(c.text))];
  try{
    const recovery=await promptWithReconnect(agent,{role:'user',content:initial,timestamp:Date.now()},{
      getLastError:()=>runtime.state.error,clearLastError:()=>{runtime.state.error=null;agent.state.errorMessage=undefined;},
      shouldStop:()=>closed||Date.now()-startedAt>=timeoutMs||requestCount>=budget.maxRequests||budget.toolCalls>=budget.maxToolCalls,
      onReconnect:async({attempt,error,delayMs})=>emit({type:'progress',status:'reconnecting',message:`模型连接暂时失败，${delayMs}ms 后继续（${attempt}/2）`,
        event:{tool:'request_reconnect_wait',attempt,delayMs,error:redactError(error),request:requestCount}}),
      maxReconnects:2,
    });
    if(recovery.error)runtime.state.error=redactError(recovery.error);
  }catch(error){
    runtime.state.error=redactError(error);
  }finally{clearTimeout(timer);}
  const plan=runtime.state.plan;
  const result={status:runtime.state.finished?'completed':plan?'partial':'failed',plan,producerConfigSnapshot:provider.configSnapshot??null,usage:{...usage,toolCalls:budget.toolCalls,imagesReturned:budget.imagesReturned,
    uniqueFrames:runtime.state.seenFrames.size,elapsedMs:Date.now()-startedAt},evidence:{frames:[...runtime.state.seenFrames],detailFrames:[...runtime.state.detailFrames],assets:runtime.state.assets},
    ...(runtime.state.error?{error:runtime.state.error}:!plan?{error:'模型没有保存可审阅的讲解方案。'}:{})};
  emit({type:'result',result});return result;
}

const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
lines.on('line',line=>{
  let message;try{message=JSON.parse(line);}catch{emit({type:'error',message:'无法解析 JSONL 协议。'});return;}
  if(message.type==='rpc_result'){
    const waiting=pending.get(String(message.id));if(!waiting)return;pending.delete(String(message.id));
    if(message.error)waiting.reject(new Error(typeof message.error==='string'?message.error:message.error.message??'视频工具失败。'));
    else waiting.resolve(message.result);return;
  }
  if(message.type==='cancel'){closed=true;agent?.abort();rejectPending('任务已取消。');return;}
  if(message.type!=='start'||started)return;started=true;
  runCommentary(message).catch(error=>emit({type:'result',result:{status:'failed',plan:null,usage:{requests:0,toolCalls:0,uniqueFrames:0},evidence:{frames:[],assets:[]},error:redactError(error)}}))
    .finally(()=>{closed=true;rejectPending('任务已结束。');lines.close();process.stdin.pause();});
});
lines.on('close',()=>{if(started){closed=true;agent?.abort();rejectPending('协议输入已关闭。');}});
process.on('SIGTERM',()=>{closed=true;agent?.abort();rejectPending('任务已取消。');});
