import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentityAgentClient} from './identity-agent-client.mjs';

function setup(){
  let state={session:{version:1,entities:[]},revision:4,entityId:'P1'};
  const calls=[],queue=[];
  const client=createIdentityAgentClient({context:{sample:'clip',variant:'stable',qa:true},snapshot:()=>state,
    fetch:async(url,options)=>{calls.push({url,request:options?.body&&JSON.parse(options.body)});return {ok:true,json:async()=>queue.shift()};},
    schedule:()=>0,cancelSchedule:()=>{},onChange:()=>{}});
  return {client,calls,queue,get state(){return state;},set state(value){state=value;}};
}
const segment={id:'a',trackId:62,start:800,end:900,evidenceFrames:[800,850,900],confidence:0.8,reason:'球衣相符'};
const ready={jobId:'j',status:'ready',purpose:'continuation',entityId:'P1',candidate:{team:'紫队',jersey:'10',segments:[segment]}};

test('all backend processing phases keep polling and prevent duplicate starts',async()=>{
  for(const phase of ['queued','preparing','analyzing','running','validating']){
    const f=setup();f.queue.push({...ready,status:phase});await f.client.start({purpose:'continuation'});
    assert.equal(f.client.state().busy,true);await assert.rejects(()=>f.client.start({purpose:'reference'}),/进行/);
  }
});

test('adopt requires explicit checked candidates and sends original session revision',async()=>{
  const f=setup();f.queue.push(ready);await f.client.start({purpose:'continuation',reference:{frame:380,trackId:2},range:{start:0,end:999}});
  await assert.rejects(()=>f.client.adopt(),/选择/);
  f.client.toggle('a');f.queue.push(ready);
  const result=await f.client.adopt();assert.equal(result.candidate.segments[0].trackId,62);
  assert.equal(f.calls.at(-1).request.clientRevision,4);assert.deepEqual(f.calls.at(-1).request.selectedIds,['a']);
});
test('editing during a job prevents adoption without even sending a request',async()=>{
  const f=setup();f.queue.push(ready);await f.client.start({purpose:'continuation'});f.client.toggle('a');
  f.state={...f.state,revision:5};assert.equal(f.client.state().stale,true);
  await assert.rejects(()=>f.client.adopt(),/草稿/);assert.equal(f.calls.length,1);
});
test('same revision but different session cannot overwrite draft; entity changes also invalidate',async()=>{
  const f=setup();f.queue.push(ready);await f.client.start({purpose:'continuation'});f.client.toggle('a');
  f.state.session.entities.push({id:'P1'});await assert.rejects(()=>f.client.adopt(),/草稿/);
  f.state={session:{version:1,entities:[]},revision:4,entityId:'P2'};assert.equal(f.client.state().stale,true);
});
test('bounds can only narrow server candidate and returned evidence is retained',async()=>{
  const f=setup();f.queue.push(ready);await f.client.start({purpose:'continuation'});f.client.toggle('a');
  assert.throws(()=>f.client.edit('a',{start:799,end:900}),/范围/);
  assert.throws(()=>f.client.edit('a',{start:850.5,end:890}),/范围/);
  f.client.edit('a',{start:840,end:870});f.queue.push(ready);
  const result=await f.client.adopt();assert.equal(result.candidate.segments[0].start,840);
  assert.deepEqual(result.candidate.segments[0].evidenceFrames,[850]);
  f.client.applied();assert.equal(f.client.state().job.candidate.segments[0].start,840);
  assert.equal(f.client.state().job.candidate.segments[0].end,870);assert.deepEqual(f.client.state().selectedIds,['a']);
});
test('cancel invalidates a delayed create response and cancels it on server',async()=>{
  let resolve;const f=setup();const client=createIdentityAgentClient({context:{},snapshot:()=>f.state,onChange:()=>{},schedule:()=>0,cancelSchedule:()=>{},fetch:async(url)=>url.endsWith('/jobs')?await new Promise(r=>resolve=r):{ok:true,json:async()=>({status:'cancelled'})}});
  const pending=client.start({purpose:'reference'});await client.cancel();
  resolve({ok:true,json:async()=>ready});await pending;assert.equal(client.state().job,null);assert.equal(client.state().busy,false);
});

test('late failure from old cancellation cannot pollute a newer active job',async()=>{
  let rejectCancel,number=0;const f=setup();
  const client=createIdentityAgentClient({context:{},snapshot:()=>f.state,onChange:()=>{},schedule:()=>0,cancelSchedule:()=>{},fetch:async(url)=>{
    if(url.endsWith('/cancel'))return await new Promise((_,reject)=>rejectCancel=reject);
    return {ok:true,json:async()=>({...ready,jobId:`job-${++number}`})};
  }});
  await client.start({purpose:'continuation'});const cancelling=client.cancel();await client.start({purpose:'reference'});
  rejectCancel(new Error('old cancellation failed'));await cancelling;
  assert.equal(client.state().job.jobId,'job-2');assert.equal(client.state().error,'');
});

test('cancelled create rejection is silent and never reports an old error on the new task',async()=>{
  let rejectCreate,first=true;const f=setup();
  const client=createIdentityAgentClient({context:{},snapshot:()=>f.state,onChange:()=>{},schedule:()=>0,cancelSchedule:()=>{},fetch:async()=>{
    if(first){first=false;return await new Promise((_,reject)=>rejectCreate=reject);}
    return {ok:true,json:async()=>({...ready,jobId:'new'})};
  }});
  const old=client.start({purpose:'reference'});await client.cancel();await client.start({purpose:'reference'});
  rejectCreate(new Error('old create failed'));assert.equal(await old,null);
  assert.equal(client.state().job.jobId,'new');assert.equal(client.state().error,'');
});

const initialReady={jobId:'initial-job',purpose:'initial_review',status:'ready',sourceKey:'same-source',algoVersion:'initial-identity-review-v1',
  base:{sessionDigest:'original-digest',clientRevision:4},matchesCurrentInput:true,
  candidate:{schemaVersion:1,summary:'抽样初检',subjects:[],segments:[],issues:[],slotBasis:{}}};
async function initialSetup(job=initialReady){
  const f=setup();f.queue.push({available:true});await f.client.init();f.queue.push(structuredClone(job));
  await f.client.startInitialReview();return f;
}

test('initial review starts once without a selected player or reference and changing P alone does not stale it',async()=>{
  const f=await initialSetup();await f.client.startInitialReview();
  assert.equal(f.calls.length,2);const input=f.calls[1].request;
  assert.equal(input.purpose,'initial_review');assert.equal(input.entityId,undefined);assert.equal(input.reference,undefined);
  f.state={...f.state,entityId:'P10'};assert.equal(f.client.state().initialReview.stale,false);
  f.queue.push(initialReady);await f.client.adoptInitialReview();
  assert.equal(f.calls.at(-1).request.clientRevision,4);
  assert.deepEqual(f.calls.at(-1).request.session,{version:1,entities:[]});
  assert.equal(f.client.state().initialReview.busy,true,'pure local application is still pending');
  await assert.rejects(()=>f.client.adoptInitialReview(),/可自动采用/);
});

test('initial adoption protects any session or revision change while single-player jobs stay independent',async()=>{
  for(const field of ['session','revision']){
    const f=await initialSetup();
    if(field==='session')f.state.session.note='manual note';else f.state={...f.state,revision:5};
    assert.equal(f.client.state().initialReview.stale,true);await assert.rejects(()=>f.client.adoptInitialReview(),/草稿已修改/);
    assert.equal(f.calls.length,2);
  }
  const f=await initialSetup();f.queue.push(ready);await f.client.start({purpose:'continuation'});
  assert.equal(f.client.state().job.jobId,'j');assert.equal(f.client.state().initialReview.job.jobId,'initial-job');
  assert.equal(f.client.state().initialReview.stale,false);
});

test('source-cached response from a different draft is read-only until explicit cache reuse',async()=>{
  const f=await initialSetup({...initialReady,matchesCurrentInput:false});
  assert.equal(f.client.state().initialReview.stale,true);await assert.rejects(()=>f.client.adoptInitialReview(),/草稿/);
  const cached={...initialReady,jobId:'rebased',generationJobId:'initial-job'};
  f.queue.push(cached);await f.client.retryInitialReview();
  assert.equal(f.calls.at(-1).request.reuseCached,true);assert.equal(f.calls.at(-1).request.forceRetry,undefined);
  assert.equal(f.client.state().initialReview.stale,false);
  f.queue.push(cached);await f.client.adoptInitialReview();
  assert.equal(f.calls.at(-1).request.session.note,undefined);
});

test('refresh uses persisted job revision only when the full session still matches',async()=>{
  const f=await initialSetup({...initialReady,base:{...initialReady.base,clientRevision:91}});
  f.queue.push({...initialReady,base:{...initialReady.base,clientRevision:91}});await f.client.adoptInitialReview();
  assert.equal(f.calls.at(-1).request.clientRevision,91);
  assert.equal(f.calls.at(-1).request.session.version,1);
});

test('applied state follows the saved generation marker and undo does not report an absent application',async()=>{
  const f=await initialSetup();f.queue.push(initialReady);await f.client.adoptInitialReview();
  f.state.session.initialIdentityReview={sourceKey:'same-source',jobId:'initial-job',generationJobId:'initial-job'};
  f.client.initialApplied({changedModelBindings:2});assert.equal(f.client.state().initialReview.applied,true);
  delete f.state.session.initialIdentityReview;f.state={...f.state,revision:6};
  assert.equal(f.client.state().initialReview.applied,false);assert.equal(f.client.state().initialReview.busy,false);
  assert.equal(f.client.state().initialReview.stale,true);
  await assert.rejects(()=>f.client.adoptInitialReview(),/草稿已修改/);
  assert.equal(f.calls.length,3,'undo never starts another request');
});

test('a failed local apply releases the latch and explicitly reuses the candidate without running a new model job',async()=>{
  const f=await initialSetup();f.queue.push(initialReady);await f.client.adoptInitialReview();
  f.client.reportInitialError('local validation rejected');
  assert.equal(f.client.state().initialReview.busy,false);assert.equal(f.client.state().initialReview.job.status,'review_required');
  assert.equal(f.client.state().initialReview.job.candidate.summary,'抽样初检');
  f.queue.push({...initialReady,jobId:'cached'});await f.client.retryInitialReview();
  assert.equal(f.calls.at(-1).request.reuseCached,true);assert.equal(f.calls.at(-1).request.forceRetry,undefined);
});

test('failed or unavailable initial starts never automatically loop and only explicit retry starts again',async()=>{
  const f=await initialSetup({...initialReady,status:'failed',candidate:undefined,failure:{code:'timeout'}});
  await f.client.startInitialReview();assert.equal(f.calls.length,2);
  f.queue.push({...initialReady,status:'queued'});await f.client.retryInitialReview();
  assert.equal(f.calls.at(-1).request.forceRetry,true);assert.equal(f.client.state().initialReview.busy,true);
  const unavailable=setup();unavailable.queue.push({available:false,message:'provider unavailable'});await unavailable.client.init();
  await assert.rejects(()=>unavailable.client.startInitialReview(),/unavailable/);
  await unavailable.client.startInitialReview();assert.equal(unavailable.calls.length,1);
  assert.equal(unavailable.client.state().initialReview.busy,false);
});

test('page disposal during a pending source-deduplicated create never cancels the shared server job',async()=>{
  let resolve;const calls=[],f=setup();
  const client=createIdentityAgentClient({context:{},snapshot:()=>f.state,schedule:()=>0,cancelSchedule:()=>{},fetch:async(url)=>{
    calls.push(url);if(url.endsWith('/status'))return {ok:true,json:async()=>({available:true})};
    if(url.endsWith('/jobs'))return new Promise(r=>resolve=r);
    return {ok:true,json:async()=>({status:'cancelled'})};
  }});
  await client.init();const pending=client.startInitialReview();client.dispose();
  resolve({ok:true,json:async()=>({...initialReady,status:'analyzing'})});assert.equal(await pending,null);
  assert.equal(calls.filter(url=>url.endsWith('/cancel')).length,0);
});

test('explicit initial cancellation cancels a late create and never resurrects the candidate',async()=>{
  let resolve;const calls=[],f=setup();
  const client=createIdentityAgentClient({context:{},snapshot:()=>f.state,schedule:()=>0,cancelSchedule:()=>{},fetch:async(url)=>{
    calls.push(url);if(url.endsWith('/status'))return {ok:true,json:async()=>({available:true})};
    if(url.endsWith('/jobs'))return new Promise(r=>resolve=r);
    return {ok:true,json:async()=>({status:'cancelled'})};
  }});
  await client.init();const pending=client.startInitialReview();await client.cancelInitialReview();
  resolve({ok:true,json:async()=>initialReady});assert.equal(await pending,null);
  assert.equal(calls.filter(url=>url.endsWith('/cancel')).length,1);
  assert.equal(client.state().initialReview.job.status,'cancelled');assert.equal(client.state().initialReview.busy,false);
  await client.startInitialReview();assert.equal(calls.filter(url=>url.endsWith('/jobs')).length,1);
});

test('a new cache request error cannot expose an old ready candidate for automatic adoption',async()=>{
  let creates=0;const f=setup();
  const client=createIdentityAgentClient({context:{},snapshot:()=>f.state,schedule:()=>0,cancelSchedule:()=>{},fetch:async(url)=>{
    if(url.endsWith('/status'))return {ok:true,json:async()=>({available:true})};
    if(++creates===1)return {ok:true,json:async()=>initialReady};
    throw new Error('connection failed');
  }});
  await client.init();await client.startInitialReview();await assert.rejects(()=>client.retryInitialReview(),/connection failed/);
  assert.equal(client.state().initialReview.job.status,'review_required');
  assert.equal(client.state().initialReview.job.candidate.summary,'抽样初检');
  await assert.rejects(()=>client.adoptInitialReview(),/可自动采用/);
});
