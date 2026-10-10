import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJSON} from './api-request.mjs';
test('read recovers a disconnect and an incomplete JSON response',async()=>{
  let calls=0;
  const result=await requestJSON('/api/state',undefined,{delay:async()=>{},fetcher:async()=>{
    calls++;if(calls===1)throw new TypeError('Failed to fetch');
    if(calls===2)return {ok:true,json:async()=>{throw new SyntaxError('truncated');}};
    return {ok:true,json:async()=>({status:'completed'})};
  }});
  assert.equal(calls,3);assert.equal(result.status,'completed');
});
test('a disconnected job submission is never blindly repeated',async()=>{
  let calls=0;
  await assert.rejects(requestJSON('/api/jobs',{method:'POST'},{fetcher:async()=>{calls++;throw new TypeError('Failed to fetch');}}),/网络连接中断/);
  assert.equal(calls,1);
});
test('expired login is reported before parsing HTML',async()=>{
  await assert.rejects(requestJSON('/api/state',undefined,{fetcher:async()=>({status:401,json(){throw new Error('must not parse');}})}),/登录已失效/);
});
