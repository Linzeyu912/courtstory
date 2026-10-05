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
  const endpoint=new URL(env.QWEN_BASE_URL||DEFAULT_QWEN_BASE_URL);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||
     !endpoint.hostname.endsWith('.aliyuncs.com'))throw new Error('QWEN_BASE_URL 必须使用阿里云官方 HTTPS 兼容端点。');
  const model={id:env.QWEN_MODEL||'qwen3.8-max',name:env.QWEN_MODEL||'qwen3.8-max',provider:'qwen',
    api:'openai-completions',baseUrl:endpoint.href.replace(/\/$/,''),input:['text','image'],
    reasoning:false,contextWindow:131072,maxTokens:8192,
    // The SDK requires rates. These are placeholders, never presented as a cost estimate.
    cost:{input:0,output:0,cacheRead:0,cacheWrite:0},
    compat:{supportsStore:false,supportsDeveloperRole:false,supportsReasoningEffort:false,
      supportsUsageInStreaming:true,maxTokensField:'max_tokens',supportsStrictMode:false}};
  return {model,streamFn:(selected,context,options)=>streamSimple(selected,context,{
    ...options,apiKey,maxRetries:0,timeoutMs:90000,maxTokens:8192,
  })};
}
