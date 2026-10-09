import {streamSimple} from '@earendil-works/pi-ai/api/openai-completions';
import {createQwenProvider,redactError as redactQwenError} from './qwen-provider.mjs';

export function redactError(error,env=process.env){
  let value=String(error?.message??error??'未知错误');
  if(env.OPENROUTER_API_KEY)value=value.split(env.OPENROUTER_API_KEY).join('[redacted]');
  return redactQwenError(value,env);
}

const DEFAULT='openai/gpt-6-astra';
const ASTRA={input:['text','image'],reasoning:true,contextWindow:1050000,maxTokens:8192,
  cost:{input:10,output:50,cacheRead:1,cacheWrite:12.5}};

export function resolveCommentaryConfig(config={}){
  const provider=config.provider??'openrouter',id=config.model??DEFAULT;
  if(provider!=='openrouter'||typeof id!=='string'||!/^[A-Za-z0-9._:/-]{1,160}$/.test(id))throw new Error('无效模型配置。');
  const caps=config.modelCapabilities??(id===DEFAULT?ASTRA:null);
  if(!caps||!caps.input?.includes('image')||typeof caps.reasoning!=='boolean'||
    !Number.isSafeInteger(caps.contextWindow)||caps.contextWindow<=0||!Number.isSafeInteger(caps.maxTokens)||caps.maxTokens<=0)
    throw new Error('模型覆盖缺少可信 modelCapabilities 能力配置，不能套用 Astra 能力。');
  const reasoning=config.reasoning??(caps.reasoning?'medium':'off');
  if(!['off','minimal','low','medium','high','xhigh'].includes(reasoning)||!caps.reasoning&&reasoning!=='off')throw new Error('模型不支持配置的推理级别。');
  return structuredClone({provider,model:id,reasoning,modelCapabilities:{input:caps.input,reasoning:caps.reasoning,
    contextWindow:caps.contextWindow,maxTokens:caps.maxTokens,cost:caps.cost??null,compat:caps.compat??null},
    capabilitiesRef:config.capabilitiesRef??(id===DEFAULT?'astra-catalog-2026-10-07':null)});
}

export function createCommentaryProvider(env=process.env,config=null){
  if(!config&&env.COMMENTARY_MODEL_CONFIG)config=JSON.parse(env.COMMENTARY_MODEL_CONFIG);
  if(!config&&env.COMMENTARY_PROVIDER!=='openrouter')return {...createQwenProvider(env),apiKey:env.QWEN_KEY,thinkingLevel:'off'};
  const apiKey=env.OPENROUTER_API_KEY?.trim();
  if(!apiKey)throw new Error('缺少 OPENROUTER_API_KEY，无法运行 OpenRouter 解说。');
  const snapshot=resolveCommentaryConfig(config??{model:env.OPENROUTER_MODEL||DEFAULT});
  const id=snapshot.model,caps=snapshot.modelCapabilities;
  const model={id,name:id,provider:'openrouter',api:'openai-completions',baseUrl:'https://openrouter.ai/api/v1',
    input:caps.input,reasoning:caps.reasoning,contextWindow:caps.contextWindow,maxTokens:caps.maxTokens,
    // NaN serializes to null in usage reports, explicitly preserving unknown prices.
    cost:Object.fromEntries(['input','output','cacheRead','cacheWrite'].map(k=>[k,caps.cost?.[k]??NaN])),
    compat:{supportsStore:false,supportsDeveloperRole:true,supportsReasoningEffort:caps.reasoning,
      supportsUsageInStreaming:true,maxTokensField:'max_tokens',supportsStrictMode:false,thinkingFormat:'openrouter',...caps.compat}};
  return {model,apiKey,configSnapshot:snapshot,thinkingLevel:snapshot.reasoning,streamFn:(selected,context,options)=>streamSimple(selected,context,{
    ...options,apiKey,maxRetries:0,timeoutMs:120000,maxTokens:caps.maxTokens,
  })};
}
