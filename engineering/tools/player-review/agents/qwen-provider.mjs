import {streamSimple} from '@earendil-works/pi-ai/api/openai-completions';

export const DEFAULT_QWEN_BASE_URL='https://dashscope.aliyuncs.com/compatible-mode/v1';

export function redactError(error,env=process.env){
  let text=String(error?.message??error??'未知错误');
  if(env.QWEN_KEY)text=text.split(env.QWEN_KEY).join('[redacted]');
  return text.replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/sk-[\w-]+/g,'[redacted]')
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,'[image]').slice(0,1200);
}

export function createQwenProvider(env=process.env){
  const apiKey=env.QWEN_KEY?.trim();
  if(!apiKey)throw new Error('请在工作台服务进程配置 QWEN_KEY。');
  const requestTimeout=Math.max(1000,Math.min(300000,Number(env.QWEN_REQUEST_TIMEOUT_MS)||90000));
  const retries=Math.max(0,Math.min(3,Number(env.QWEN_REQUEST_RETRIES)||0));
  const waitSeconds=Math.max(0,Math.min(120,Number(env.QWEN_BURST_WAIT_SECONDS)||0));
  const endpoint=new URL(env.QWEN_BASE_URL||DEFAULT_QWEN_BASE_URL);
  // Workspace migration diagnostics omit URLs, headers, bodies, and secret values.
  const debugNetwork=env.QWEN_DEBUG_NETWORK==='1'||(!env.QWEN_DEBUG_NETWORK&&endpoint.hostname.endsWith('.maas.aliyuncs.com'));
  const diagnosticFetch=debugNetwork?async(...args)=>{
    const started=Date.now();
    const bodyBytes=typeof args[1]?.body==='string'?Buffer.byteLength(args[1].body):null;
    try{
      const response=await globalThis.fetch(...args);
      process.stderr.write(JSON.stringify({type:'qwen_request_headers',status:response.status,elapsedMs:Date.now()-started,bodyBytes})+'\n');
      return response;
    }catch(error){
      const causes=[];let current=error;
      for(let i=0;current&&i<4;i++,current=current.cause)causes.push({name:current.name,code:current.code});
      process.stderr.write(JSON.stringify({type:'qwen_connection_error',elapsedMs:Date.now()-started,bodyBytes,causes})+'\n');
      throw error;
    }
  }:undefined;
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||
     !endpoint.hostname.endsWith('.aliyuncs.com'))throw new Error('QWEN_BASE_URL 必须使用阿里云官方 HTTPS 兼容端点。');
  const model={id:env.QWEN_MODEL||'qwen3.8-max',name:env.QWEN_MODEL||'qwen3.8-max',provider:'qwen',
    api:'openai-completions',baseUrl:endpoint.href.replace(/\/$/,''),input:['text','image'],
    reasoning:true,contextWindow:131072,maxTokens:8192,
    // The SDK requires rates. These are placeholders, never presented as a cost estimate.
    cost:{input:0,output:0,cacheRead:0,cacheWrite:0},
    compat:{supportsStore:false,supportsDeveloperRole:false,supportsReasoningEffort:false,
      supportsUsageInStreaming:true,maxTokensField:'max_tokens',supportsStrictMode:false,thinkingFormat:'qwen'}};
  return {model,streamFn:(selected,context,options)=>streamSimple(selected,context,{
    ...options,apiKey,maxRetries:retries,timeoutMs:requestTimeout,maxTokens:8192,
    ...(waitSeconds?{headers:{...options?.headers,'X-DashScope-Wait-Timeout':String(waitSeconds)}}:{}),
    ...(diagnosticFetch?{fetch:diagnosticFetch}:{}),
  })};
}
