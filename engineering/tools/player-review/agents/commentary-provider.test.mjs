import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommentaryProvider,redactError} from './commentary-provider.mjs';

test('OpenRouter selects Astra image tools and supported reasoning without reusing Qwen credentials',()=>{
  const env={COMMENTARY_PROVIDER:'openrouter',OPENROUTER_API_KEY:'private-test-token',QWEN_KEY:'different-key'};
  const provider=createCommentaryProvider(env);
  assert.equal(provider.model.id,'openai/gpt-6-astra');
  assert.equal(provider.model.baseUrl,'https://openrouter.ai/api/v1');
  assert.equal(provider.apiKey,env.OPENROUTER_API_KEY);
  assert.equal(provider.thinkingLevel,'medium');
  assert.ok(provider.model.input.includes('image'));
  assert.equal(provider.model.compat.thinkingFormat,'openrouter');
  assert.ok(!redactError(`failed ${env.OPENROUTER_API_KEY}`,env).includes(env.OPENROUTER_API_KEY));
  assert.throws(()=>createCommentaryProvider({COMMENTARY_PROVIDER:'openrouter',QWEN_KEY:'different-key'}),/OPENROUTER_API_KEY/);
  assert.equal(createCommentaryProvider({COMMENTARY_PROVIDER:'token-plan',QWEN_KEY:'different-key'}).model.provider,'qwen');
});

test('unknown model cannot reuse Astra metadata and explicit trusted config is locked',()=>{
  const env={COMMENTARY_PROVIDER:'openrouter',OPENROUTER_API_KEY:'test-key',OPENROUTER_MODEL:'other/model'};
  assert.throws(()=>createCommentaryProvider(env),/capabilities|能力/i);
  const config={provider:'openrouter',model:'other/model',reasoning:'off',modelCapabilities:{input:['text','image'],reasoning:false,contextWindow:32000,maxTokens:4000,cost:null}};
  const provider=createCommentaryProvider(env,config);
  assert.equal(provider.model.contextWindow,32000);assert.equal(provider.model.reasoning,false);
  assert.equal(provider.thinkingLevel,'off');assert.equal(provider.configSnapshot.modelCapabilities.cost,null);
  env.OPENROUTER_MODEL='openai/gpt-6-astra';
  assert.equal(provider.model.id,'other/model');
});
