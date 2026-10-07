import test from 'node:test';
import assert from 'node:assert/strict';
import {promptWithReconnect} from './ground-trajectory-reconnect.mjs';

test('transient failure resumes the same agent after filtering only the failed assistant turn',async()=>{
  let error=null,calls=0;const prompts=[],reconnects=[];
  const successfulCall={role:'assistant',stopReason:'toolUse',content:[{type:'toolCall',name:'inspect_frames',id:'done'}]};
  const successfulResult={role:'toolResult',toolName:'inspect_frames',content:[{type:'text',text:'frames read'}]};
  const failedCall={role:'assistant',stopReason:'error',content:[{type:'toolCall',name:'set_ground_anchors',id:'partial'}]};
  const agent={state:{messages:[successfulCall,successfulResult,failedCall],anchors:[{frame:12,x:3,y:4}],revision:2,
      seenFrames:new Set([10,12]),assets:[{id:'feet-12'}],latestRenderedCandidate:{revision:2}},
    async prompt(prompt){
      prompts.push(prompt);calls++;
      if(calls===1){this.state.messages.push(failedCall);error='TypeError: fetch failed UND_ERR_SOCKET';}
      else {assert.equal(this.state.anchors[0].frame,12);assert.equal(this.state.latestRenderedCandidate.revision,2);error=null;
        this.state.messages.push({role:'assistant',stopReason:'endTurn',content:[{type:'text',text:'resumed'}]});}
    }};
  const result=await promptWithReconnect(agent,'BEGIN TASK',{getLastError:()=>error,clearLastError:()=>{error=null;},
    onReconnect:async info=>reconnects.push(info),sleep:async()=>{},
    makeRecoveryPrompt:()=> 'RESUME CHECKPOINT'});
  assert.equal(result.retries,1);assert.equal(calls,2);
  assert.equal(prompts[0],'BEGIN TASK');assert.equal(prompts[1],'RESUME CHECKPOINT');
  assert.equal(reconnects[0].delayMs,1000);
  assert.equal(agent.state.revision,2);assert.deepEqual([...agent.state.seenFrames],[10,12]);
  assert.equal(agent.state.assets[0].id,'feet-12');
  assert.equal(agent.state.messages.filter(message=>message===successfulCall).length,1);
  assert.equal(agent.state.messages.filter(message=>message===successfulResult).length,1);
  assert.equal(agent.state.messages.some(message=>message.role==='assistant'&&message.stopReason==='error'),false);
});

test('authentication and exhausted-credit errors stop without another prompt',async()=>{
  for(const failure of ['401 Unauthorized','429 insufficient_quota: credit exhausted','402 creditsExhausted','InsufficientQuota']){
    let error=null,calls=0;
    const agent={state:{messages:[]},async prompt(){calls++;error=failure;}};
    const result=await promptWithReconnect(agent,'BEGIN',{getLastError:()=>error,clearLastError:()=>{error=null;},sleep:async()=>{throw new Error('must not back off');}});
    assert.equal(calls,1);assert.equal(result.retries,0);assert.equal(result.error,failure);
  }
});

test('provider quota throttling codes are transient and reconnectable',async()=>{
  for(const failure of ['Throttling.RateQuota','Throttling.AllocationQuota','Throttling.BurstRate']){
    let error=null,calls=0;
    const agent={state:{messages:[]},async prompt(){calls++;error=calls===1?failure:null;}};
    const result=await promptWithReconnect(agent,'BEGIN',{getLastError:()=>error,clearLastError:()=>{error=null;},sleep:async()=>{}});
    assert.equal(calls,2,failure);assert.equal(result.retries,1,failure);
  }
});

test('cancellation during reconnect status prevents the retry',async()=>{
  let error=null,cancelled=false,calls=0;
  const agent={state:{messages:[]},async prompt(){calls++;error='UND_ERR_CONNECT_TIMEOUT';}};
  const result=await promptWithReconnect(agent,'BEGIN',{getLastError:()=>error,clearLastError:()=>{error=null;},
    shouldStop:()=>cancelled,onReconnect:async()=>{cancelled=true;},sleep:async()=>{throw new Error('cancelled backoff must not sleep');}});
  assert.equal(calls,1);assert.equal(result.stopped,true);assert.equal(result.retries,1);
});
