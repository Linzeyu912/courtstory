import readline from 'node:readline';
import {Agent} from '@earendil-works/pi-agent-core';
import {createCommentaryProvider,redactError} from './commentary-provider.mjs';
import {createDrawingTools} from './drawing-tools.mjs';
import {promptWithReconnect} from './ground-trajectory-reconnect.mjs';

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
    ?'你是独立篮球图形视觉审核 Agent，只有本轮附上的原视频图像是视觉证据。逐个检查候选图形坐标、路线前后帧、持球重点圈、人物绑定和原解说节点是否支持。shot_release节点允许已保存shotFeedback.shooterRef指定的出手者在球已离手的release锚帧拥有spotlight，必须看清该主体，不允许把例外给其他人；普通节点仍只圈当前持球人。机会和压迫评价来自已保存解说，不由本阶段重新评价或改写；只审核几何、主体与节点的一致性。不能改写解说或候选，不能调用绘图工具。看不清或不支持就拒绝该项并写原因；保存所有图形及动作的审核。'
    :'你是独立篮球战术绘图 Agent。读取已保存解说节点，在节点窗口内主动读真实画面定位，不重新分析全片或写解说。按focus和participantRefs表达动作。冲突返回needs_upstream_review，缺证据返回partial/unavailable，不编路线。图片assetId绑定同锚帧，points用返回图片像素，宿主逆变换。路线须两帧：实线current_action是当前完整动作，虚线later_observed_action是随后真实动作，不预测。普通节点spotlight只给锚帧当前持球人；shot_release节点必须给shotFeedback.shooterRef指定的出手者恰好一个spotlight，球已离手合法，例外不得给其他人；匿名出手者subjectId必须等于shooterRef且entityId=null，有绑定则须匹配保存entityId。机会/压迫评价来自保存解说，只读，禁止生成或修改评价。其他静态人用position，掩护screen。有身份歧义保留局部subjectId，不猜名字。每节点一个原生V4 phase，范围是evidenceWindow闭区间转半开，freezeFrame=anchorAssetFrame，production=null、space=video、authoredPath=null。所有有位置证据的人均分类annotated/uncertain/not_involved，每图关联独立主体。用save_node_drawing保存，确定出手缺指定spotlight不能ready，禁止输出思考过程。';
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
  active.subscribe(event=>{
    if(event.type==='tool_execution_end'&&event.isError)emit({type:'progress',status:'tool_error',event:{tool:event.toolName,
      error:redactError((JSON.stringify(event.result?.content??event.result)??'工具调用失败').slice(0,3000))}});
    if(event.type==='message_end'&&event.message.role==='assistant'){
      if(event.message.stopReason==='error')error=redactError(event.message.errorMessage);
      else if(event.message.stopReason!=='aborted')error=null;
      emit({type:'progress',status:audit?'auditing':'drawing',event:{tool:'model_response',request:requests,
        stopReason:event.message.stopReason,toolCalls:event.message.content.filter(c=>c.type==='toolCall').map(c=>c.name),
        ...(error?{error}:{}),usage:event.message.usage}});
    }
  });
  const timer=setTimeout(()=>{closed=true;active.abort();rejectPending('绘图时间预算用尽。');},Math.min(480,config.timeoutSeconds??240)*1000);
  const data={node:start.node??start.nodes?.[0],planRef:start.planRef,participants:start.participants,event:start.event,cues:start.cues,
    drawingConstraint:'shot_release必须为shotFeedback.shooterRef所指主体生成恰好一个spotlight，球已离手合法。匿名出手者的participant.subjectId必须等于shooterRef，entityId=null；有可靠绑定时entityId须匹配保存的人物引用。其他节点仍只给当前持球人重点圈。shotFeedback机会/压迫评价是只读保存解说，禁止生成或改写评价。缺合格spotlight不能标ready；缺图像返回unavailable或needs_upstream_review。',
    ...(audit?{candidate:start.candidate,evidence:start.evidence?.details}:{auditFeedback:start.auditFeedback??null})};
  try{await promptWithReconnect(active,{role:'user',content:[text(JSON.stringify(data)),...(audit?(start.evidence?.content??[]).filter(c=>['text','image'].includes(c.type)):[])],timestamp:Date.now()},{
    getLastError:()=>error,clearLastError:()=>{error=null;active.state.errorMessage=undefined;},
    shouldStop:()=>closed||runtime.state.finished||requests>=maxRequests||budget.toolCalls>=budget.maxToolCalls,
    maxReconnects:1,onReconnect:async({attempt,error:reason})=>emit({type:'progress',status:'reconnecting',event:{tool:'request_reconnect',attempt,error:redactError(reason)}}),
  });}
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
