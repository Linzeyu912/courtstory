import test from 'node:test';
import assert from 'node:assert/strict';
let module;
try { module=await import('./identity-tools.mjs'); } catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }

const fixture=()=>({context:{duration:1,videoRef:'a'.repeat(64),frames:[0,1,2].map(frame=>({frame,time:frame/3,sourceTime:frame/3,pts:frame,timeBase:'1/3'})),identitySlots:['P1'],identityContext:{teamMap:{A:'HOU'}}},
  overview:{content:[{type:'image',mimeType:'image/jpeg',data:'AAAA'}],details:{frames:[{frame:0,time:0,sourceTime:0}],returnedFrames:[0],assets:[]}}});
const plan=()=>({summary:'图像身份候选',subjects:[{subjectId:'p',entityId:'P1',role:'player',team:'红色',teamSide:'A',jersey:'0',confidence:.9,reason:'红衣'}],
  segments:[{id:'s',subjectId:'p',trackId:2,startFrame:0,endFrame:2,evidenceFrames:[0,2],jerseyEvidenceFrames:[2],confidence:.9,reason:'实际图像'}],issues:[]});
function runtime(rpc=async()=>({saved:true,candidate:{segments:[]}})){
  assert.ok(module,'video identity tools must exist');
  const events=[];const result=module.createIdentityTools(fixture(),{rpc,emit:e=>events.push(e),budget:{maxToolCalls:10,toolCalls:0}});
  return {...result,events,call:(name,args,signal)=>result.tools.find(t=>t.name===name).execute('1',args,signal)};
}

test('identity uses all four shared read tools and replaces commentary writes',()=>{
  const r=runtime();assert.deepEqual(r.tools.map(t=>t.name),['get_video_context','read_video_window','inspect_region','get_observations','save_identity_review']);
});
test('unread endpoint cannot be saved even if the host would accept',async()=>{
  let called=0;const r=runtime(async()=>{called++;return {saved:true};});
  await assert.rejects(r.call('save_identity_review',{plan:plan(),finish:false}),/读取/);assert.equal(called,0);
});
test('observation records alone never count as viewed image evidence',async()=>{
  const r=runtime(async()=>({status:'available',frames:[{frame:2}]}));
  await r.call('get_observations',{startTime:0,endTime:1});
  await assert.rejects(r.call('save_identity_review',{plan:plan()}),/读取/);
});
test('detail read enters shared ledger then host checkpoint is preserved',async()=>{
  const r=runtime(async(method,args)=>method==='read_video_window'?{content:[{type:'image',mimeType:'image/jpeg',data:'AAAA'}],
    details:{frames:[{frame:2,time:2/3,sourceTime:2/3}],returnedFrames:[2],assets:[]}}:{saved:true,candidate:{summary:'host-validated',segments:[{id:'host'}]}});
  await r.call('read_video_window',{startTime:0,endTime:1,frames:[2],mode:'full'});
  await r.call('save_identity_review',{plan:plan(),finish:true});
  assert.equal(r.state.finished,true);assert.equal(r.state.plan.summary,'host-validated');
  assert.equal(r.events.at(-1).status,'checkpoint');
});
test('cancelled save never reaches host or creates checkpoint',async()=>{
  let called=0;const r=runtime(async()=>{called++;});const abort=new AbortController();abort.abort();
  await assert.rejects(r.call('save_identity_review',{plan:plan()},abort.signal),/取消/);
  assert.equal(called,0);assert.equal(r.state.plan,null);
});

test('mixed read and unread ranges reach strict host filtering without granting unread evidence',async()=>{
  const proposal=plan();
  proposal.segments.unshift({...proposal.segments[0],id:'seen',startFrame:0,endFrame:0,evidenceFrames:[0],jerseyEvidenceFrames:[]});
  let received;
  const r=runtime(async(method,args)=>{
    received=args.plan;
    return {saved:true,candidate:{segments:[{id:'seen'}],issues:[{segmentId:'s'}],completionStatus:'partial'}};
  });
  await r.call('save_identity_review',{plan:proposal});
  assert.equal(received.segments.length,2);
  assert.deepEqual(r.state.plan.segments,[{id:'seen'}]);
  assert.equal(r.state.seenFrames.has(2),false);
  assert.equal(r.state.plan.completionStatus,'partial');
});
