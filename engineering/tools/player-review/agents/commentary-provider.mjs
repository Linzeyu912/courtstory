import {streamSimple} from '@earendil-works/pi-ai/api/openai-completions';
import {createQwenProvider,redactError as redactQwenError} from './qwen-provider.mjs';

export function redactError(error,env=process.env){
  let value=String(error?.message??error??'未知错误');
  if(env.OPENROUTER_API_KEY)value=value.split(env.OPENROUTER_API_KEY).join('[redacted]');
  return redactQwenError(value,env);
}

export function createCommentaryProvider(env=process.env){
  if(env.COMMENTARY_PROVIDER!=='openrouter')return {...createQwenProvider(env),apiKey:env.QWEN_KEY,thinkingLevel:'off'};
  const apiKey=env.OPENROUTER_API_KEY?.trim();
  if(!apiKey)throw new Error('缺少 OPENROUTER_API_KEY，无法运行 OpenRouter 解说。');
  const id=env.OPENROUTER_MODEL||'openai/gpt-6-astra';
  const model={id,name:id,provider:'openrouter',api:'openai-completions',baseUrl:'https://openrouter.ai/api/v1',
    input:['text','image'],reasoning:true,contextWindow:1050000,maxTokens:8192,
    // Astra catalog snapshot checked 2026-10-07. Usage estimates are not a billed invoice.
    cost:{input:10,output:50,cacheRead:1,cacheWrite:12.5},
    compat:{supportsStore:false,supportsDeveloperRole:true,supportsReasoningEffort:true,
      supportsUsageInStreaming:true,maxTokensField:'max_tokens',supportsStrictMode:false,thinkingFormat:'openrouter'}};
  return {model,apiKey,thinkingLevel:'medium',streamFn:(selected,context,options)=>streamSimple(selected,context,{
    ...options,apiKey,maxRetries:0,timeoutMs:120000,maxTokens:8192,
  })};
}
