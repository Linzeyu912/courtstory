import readline from 'node:readline';
import {Agent} from '@earendil-works/pi-agent-core';
import {createCommentaryProvider,redactError} from './commentary-provider.mjs';
import {createDrawingTools} from './drawing-tools.mjs';

const emit=value=>process.stdout.write(`${JSON.stringify(value)}\n`);
let active=null,closed=false,started=false,nextId=0;
const pending=new Map();
const rejectPending=reason=>{for(const p of pending.values())p.reject(new Error(reason));pending.clear();};
const rpc=(method,params,signal)=>new Promise((resolve,reject)=>{
  if(closed||signal?.aborted)return reject(new Error('已取消。'));
  const id=String(++nextId),timer=setTimeout(()=>{pending.delete(id);reject(new Error('绘图取证超时。'));},90000);
  pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
  emit({type:'rpc',id,method,params});
});
const text=value=>({type:'text',text:String(value)});

export async function runDrawing(start){
  const provider=createCommentaryProvider(process.env,start.modelConfig);
  const audit=start.mode==='audit',config=start.config??{};
  const budget={maxToolCalls:Math.min(40,config.maxToolCalls??24),toolCalls:0,imagesReturned:0};
  const runtime=createDrawingTools(start,{rpc,budget,emit});
  let requests=0,error=null;
  const maxRequests=Math.min(12,config.maxRequests??8);
  const system=audit
    ?'你是独立篮球图形视觉审核 Agent，只有本轮附上的原视频图像是视觉证据。逐个检查候选图形坐标、路线前后帧、持球重点圈、人物绑定和原解说节点是否支持。不能改写解说或候选，不能调用绘图工具。看不清或不支持就拒绝该项并写原因；保存所有图形及动作的审核。'
    :'你是独立篮球战术绘图 Agent。读取已保存解说节点，在该节点窗口内主动读取真实画面进行几何定位，不重新建立全片解说，也没有解说写入工具。按节点focus和participantRefs表达动作。画面与原描述冲突返回needs_upstream_review；缺证据返回partial/unavailable，不虚构路线。先看原尺寸无标题图，需要时裁图。每个图形assetId引用实际发送的同锚帧图像，其points是该图片像素，宿主逆变换为原视频。路线必须至少两张实际画面，实线current_action说明当前完整动作，虚线later_observed_action只表示随后真实发生动作，不预测。重点圈spotlight只画锚帧当前持球人，其余静态人用position、掩护screen。有身份歧义entityId=null，保留局部subjectId；不得凭外貌添加人名。只输出已保存节点的几何：每节点一个V4 phase，phase范围等于evidenceWindow闭区间转半开，freezeFrame等于anchorAssetFrame，production=null、space=video、authoredPath=null。阶段内所有有位置证据的人都分类annotated/uncertain/not_involved，每个图形关联独立参与者。通过save_node_drawing保存，禁止输出思考过程。';
  active=new Agent({initialState:{systemPrompt:system,model:provider.model,thinkingLevel:provider.thinkingLevel,tools:runtime.tools},
    streamFn:provider.streamFn,toolExecution:'sequential',getApiKey:()=>provider.apiKey,
    prepareRequest:async({context})=>{
      if(closed||++requests>maxRequests)throw new Error('绘图请求预算用尽。');
      emit({type:'progress',status:audit?'auditing':'drawing',round:requests});return {context};
    },
    finishTurn:async({message})=>{
      if(runtime.state.finished||requests>=maxRequests||budget.toolCalls>=budget.maxToolCalls||['error','aborted'].includes(message.stopReason))return {action:'end'};
      if(!message.content.some(c=>c.type==='toolCall'))active.steer({role:'user',content:[text(audit?'请逐项保存独立审核。':'请查看局部图片并保存当前节点的绘图或明确缺口。')],timestamp:Date.now()});
      return {action:'continue'};
    }});
  active.subscribe(event=>{if(event.type==='message_end'&&event.message.role==='assistant'&&event.message.stopReason==='error')error=redactError(event.message.errorMessage);});
  const timer=setTimeout(()=>{closed=true;active.abort();rejectPending('绘图时间预算用尽。');},Math.min(480,config.timeoutSeconds??240)*1000);
  const data={node:start.node??start.nodes?.[0],planRef:start.planRef,participants:start.participants,event:start.event,cues:start.cues,
    ...(audit?{candidate:start.candidate,evidence:start.evidence?.details}:{auditFeedback:start.auditFeedback??null})};
  try{await active.prompt({role:'user',content:[text(JSON.stringify(data)),...(audit?(start.evidence?.content??[]).filter(c=>['text','image'].includes(c.type)):[])],timestamp:Date.now()});}
  catch(exc){error=redactError(exc);}finally{clearTimeout(timer);}
  const result={status:runtime.state.finished?'completed':'failed',nodeStatus:runtime.state.nodeStatus,reason:runtime.state.reason,
    candidate:runtime.state.candidate,audit:runtime.state.audit,extensionRequest:runtime.state.extensionRequest??null,
    evidence:{frames:[...runtime.state.seen],assets:runtime.state.assets},usage:{requests,toolCalls:budget.toolCalls,imagesReturned:budget.imagesReturned},modelConfig:start.modelConfig,
    ...(error?{error}:{})};emit({type:'result',result});return result;
}
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
lines.on('line',line=>{
  let message;try{message=JSON.parse(line);}catch{return;}
  if(message.type==='rpc_result'){const waiting=pending.get(String(message.id));if(!waiting)return;pending.delete(String(message.id));
    if(message.error)waiting.reject(new Error(message.error));else waiting.resolve(message.result);return;}
  if(message.type==='cancel'){closed=true;active?.abort();rejectPending('任务已取消。');return;}
  if(message.type!=='start'||started)return;started=true;
  runDrawing(message).catch(error=>emit({type:'result',result:{status:'failed',error:redactError(error)}}))
    .finally(()=>{closed=true;rejectPending('已结束。');lines.close();process.stdin.pause();});
});
lines.on('close',()=>{closed=true;active?.abort();rejectPending('输入关闭。');});
process.on('SIGTERM',()=>{closed=true;active?.abort();rejectPending('任务已取消。');});
