import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerNameClient} from './player-name-client.mjs';

const response=(value,ok=true)=>({ok,json:async()=>value});

test('start uses the current snapshot and a context switch marks the response stale',async()=>{
  let current={session:{id:1},revision:1,entityId:'P1',clip:{video_sha256:'v',tracking_fingerprint:'f',tracking_revision:'r'}};
  let posted,requestContext={season:'2025-26',teamMap:{A:'BOS',B:'NYK'},gameId:'0022500701'};
  const client=createPlayerNameClient({context:{sample:'s',variant:'original',qa:false},snapshot:()=>current,
    requestContext:()=>requestContext,
    fetch:async(url,options)=>{posted={url,options};return response({purpose:'player_names',jobId:'j',sourceKey:'k',status:'ready',base:{videoHash:'v',trackingFingerprint:'f',trackingRevision:'r'},candidate:{verified:false,reviewRequired:true,candidates:[]}});}});
  await client.start({gameId:'0022500701'});assert.equal(posted.options.method,'POST');
  assert.equal(JSON.parse(posted.options.body).session.id,1);assert.equal(JSON.parse(posted.options.body).gameId,'0022500701');
  assert.equal(client.state().canApply,true);
  current={...current,entityId:'P2'};assert.equal(client.state().stale,false,'selecting another player does not stale a whole-session task');
  requestContext={...requestContext,gameId:'0022500702'};assert.equal(client.state().stale,true);assert.equal(client.state().canApply,false);
  requestContext={season:'2025-26',teamMap:{A:'BOS',B:'NYK'},gameId:'0022500701'};current={...current,session:{id:2},revision:2};
  assert.equal(client.state().stale,true);
  client.dispose();
});

test('cancel invalidates a late start response and cancels its remote job',async()=>{
  let resolveStart,remoteCancelled=false;
  const client=createPlayerNameClient({context:{sample:'s'},snapshot:()=>({session:{},revision:0,entityId:'P1',clip:{video_sha256:'v',tracking_fingerprint:'f',tracking_revision:'r'}}),
    fetch:(url,options)=>{
      if(url.includes('/cancel')){remoteCancelled=true;return Promise.resolve(response({ok:true}));}
      return new Promise(resolve=>{resolveStart=()=>resolve(response({purpose:'player_names',jobId:'late',sourceKey:'k',status:'queued',base:{videoHash:'v',trackingFingerprint:'f',trackingRevision:'r'}}));});
    }});
  const started=client.start();await client.cancel();resolveStart();await started;
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(client.state().job.status,'cancelled');assert.equal(remoteCancelled,true);client.dispose();
});

test('failed starts expose a retryable error',async()=>{
  let calls=0;
  const client=createPlayerNameClient({snapshot:()=>({session:{},revision:0,entityId:'P1',clip:{video_sha256:'v',tracking_fingerprint:'f',tracking_revision:'r'}}),
    fetch:async()=>{calls++;return response({error:'temporary failure'},false);}});
  await assert.rejects(client.start(),/temporary failure/);assert.equal(client.state().error,'temporary failure');
  client.dispose();
});
