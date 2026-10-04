import test from 'node:test';
import assert from 'node:assert/strict';
import {createTacticsRenderClient} from './tactics-production-ui.mjs';

const context={sample:'clip',variant:'team-stable',qa:true,kind:'workspace'};
const ready=(body,id='render-1')=>({id,status:'succeeded',documentDigest:body.documentDigest,videoUrl:`/api/tactics-render/jobs/${id}/video`,totalFrames:90,fps:30,width:1280,height:720,duration:3});
test('preview and export reuse one immutable unsaved render snapshot and edits mark its result stale',async()=>{
  let snapshot={...context,document:{title:'first'},expectedVersion:4,revision:1};const calls=[];
  const client=createTacticsRenderClient({snapshot:()=>snapshot,request:async(path,body)=>{calls.push({path,body});return ready(body);}});
  await client.start();await client.start();assert.equal(calls.length,1);
  assert.equal(calls[0].body.expectedVersion,4);assert.deepEqual(calls[0].body.options,{fps:30});assert.equal(client.state().stale,false);
  snapshot.document.title='edited';snapshot.revision++;await client.sync();assert.equal(client.state().stale,true);
  assert.equal(calls[0].body.document.title,'first','request owns its frozen snapshot');
  await client.start();assert.equal(calls.length,2);assert.equal(client.state().stale,false);client.dispose();
});
test('cancelling a render uses its captured context and ignores a late success after cancellation',async()=>{
  let snapshot={...context,document:{title:'first'},expectedVersion:0,revision:1},finishPoll;const calls=[];
  const client=createTacticsRenderClient({snapshot:()=>snapshot,schedule:()=>0,request:async(path,body)=>{
    calls.push({path,body});if(path.endsWith('/cancel'))return {id:'render-1',status:'cancelled'};
    if(body)return {id:'render-1',status:'running',documentDigest:body.documentDigest,progress:{completed:1,total:90}};
    return new Promise(resolve=>finishPoll=resolve);
  }});
  await client.start();const polling=client.poll();snapshot={...snapshot,sample:'another',revision:2};await client.sync();
  await client.cancel();finishPoll({id:'render-1',status:'succeeded'});await polling;
  assert.equal(client.state().job.status,'cancelled');assert.equal(calls.at(-1).body.sample,'clip');client.dispose();
});
test('failed render preserves the draft and can retry; no stale successful URL is invented',async()=>{
  const document={title:'draft'},snapshot={...context,document,expectedVersion:2,revision:1};let count=0;
  const client=createTacticsRenderClient({snapshot:()=>snapshot,request:async()=>{count++;throw new Error('版本已变化，请重新读取');}});
  await client.start();assert.match(client.state().error,/版本已变化/);assert.equal(client.state().job,null);assert.deepEqual(document,{title:'draft'});
  await client.start();assert.equal(count,2);client.dispose();
});
