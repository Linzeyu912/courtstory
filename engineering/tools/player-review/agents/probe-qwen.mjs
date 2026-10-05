import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeContext} from '@earendil-works/pi-ai';
import {createQwenProvider,redactError} from './qwen-provider.mjs';

// Explicit live probe: no request occurs on import. The frame must be authorized input.
export async function probeQwen(framePath, outputPath){
  const provider=createQwenProvider();
  const image={type:'image',mimeType:'image/jpeg',data:(await fs.readFile(framePath)).toString('base64')};
  const report={model:provider.model.id,baseUrl:provider.model.baseUrl,frame:path.basename(framePath),stages:[]};
  const user=content=>({role:'user',content,timestamp:Date.now()});
  const call=async(name,context)=>{
    const begun=Date.now();
    const message=await provider.streamFn(provider.model,normalizeContext(context),{temperature:0}).result();
    report.stages.push({name,elapsedMs:Date.now()-begun,stopReason:message.stopReason,
      usage:message.usage?{input:message.usage.input,output:message.usage.output,totalTokens:message.usage.totalTokens}:null,
      content:message.content.filter(c=>c.type!=='thinking'),error:message.errorMessage?redactError(message.errorMessage):null});
    await fs.mkdir(path.dirname(outputPath),{recursive:true});
    await fs.writeFile(outputPath,JSON.stringify(report,null,2));
    console.log(JSON.stringify({stage:name,stopReason:message.stopReason,elapsedMs:Date.now()-begun,error:report.stages.at(-1).error}));
    if(['error','aborted'].includes(message.stopReason))throw new Error(message.errorMessage||message.stopReason);
    return message;
  };
  await call('text',{messages:[user('只回复 QWEN_OK。')]});
  await call('image',{messages:[user([{type:'text',text:'只根据图片，简短描述球场、两队球衣颜色、可见篮筐在哪侧；不确定就说不确定。'},image])]});
  const tools=[{name:'read_video_frame',description:'读取官方训练视频的一张真实帧，返回图片。',parameters:{type:'object',properties:{},required:[]}}];
  const messages=[user('请先调用 read_video_frame 读取图片，再根据实际返回的图片，报告记分牌两队简称、比分、画面中篮筐所在侧。不要在调用前回答。')];
  const invocation=await call('function_call',{messages,tools});messages.push(invocation);
  const tool=invocation.content.find(c=>c.type==='toolCall'&&c.name==='read_video_frame');
  if(!tool)throw new Error('模型没有调用读图工具。');
  messages.push({role:'toolResult',toolCallId:tool.id,toolName:tool.name,content:[{type:'text',text:'实际视频帧如下。'},image],isError:false,timestamp:Date.now()});
  await call('tool_image_followup',{messages,tools});
  report.completed=true;await fs.writeFile(outputPath,JSON.stringify(report,null,2));
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [frame,output]=process.argv.slice(2);
  if(!frame||!output)throw new Error('Usage: node probe-qwen.mjs frame.jpg report.json');
  probeQwen(frame,output).catch(error=>{console.error(redactError(error));process.exitCode=1;});
}
