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
