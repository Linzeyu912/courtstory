import test from 'node:test';
import assert from 'node:assert/strict';
import {compactRatingContext,createCommentaryTools,normalizeCommentaryOptions,validateCommentaryPlan} from './commentary-tools.mjs';

test('non-shot uncertain status is redundant; confirmed shots and conflicting confirmed status remain explicit',()=>{
  const candidate={events:[{kind:'other',shotStatus:'uncertain'},{kind:'shot',shotStatus:'confirmed'},{kind:'other',shotStatus:'confirmed'}]};
  const normalized=normalizeCommentaryOptions(candidate);
  assert.equal('shotStatus' in normalized.events[0],false);
  assert.equal(candidate.events[0].shotStatus,'uncertain');
  assert.equal(normalized.events[1].shotStatus,'confirmed');
  assert.equal(normalized.events[2].shotStatus,'confirmed');
});

test('rating source compaction is lossless and leaves the locked snapshot intact',()=>{
  const source={url:'https://example.test/ratings',game:'NBA 2K26',snapshot_date:null};
  const original={records:[{ratingRef:'r1',ratings:{layup:85,block:null},field_provenance:{layup:source,block:null}},
    {ratingRef:'r2',ratings:{layup:87},field_provenance:{layup:source}}]};
  const before=structuredClone(original),compact=compactRatingContext(original);
  assert.deepEqual(original,before);
  assert.equal(Object.keys(compact.provenanceSources).length,1);
  const restored=compact.records.map(({fieldProvenanceRefs,...record})=>({...record,field_provenance:
    Object.fromEntries(Object.entries(fieldProvenanceRefs).map(([field,ref])=>[field,ref===null?null:compact.provenanceSources[ref]]))}));
  assert.deepEqual(restored,original.records);
});

const plan=()=>({summary:'一次快速转换进攻。',events:[{eventId:'e1',kind:'other',startTime:1,endTime:4,description:'持球方推进并完成进攻。',participants:['未知球员'],evidenceFrames:[10,20],uncertainties:[]}],
  cues:[1,2,3].map((n)=>({cueId:`c${n}`,eventId:'e1',suggestedStartTime:1,suggestedEndTime:4,text:`转换推进后完成第${n}次进攻。`,focus:'推进路线',delivery:'during_play',evidenceFrames:[10,20]})),uncertainties:[]});
const start={context:{videoRef:'clip',width:1280,height:720,duration:8,observations:'verified',frames:[{frame:10,time:1,sourceTime:11},{frame:20,time:3,sourceTime:13}]},
  overview:{content:[{type:'text',text:'overview'},{type:'image',data:'aGVsbG8=',mimeType:'image/png'}],details:{frames:[{frame:10,time:1,sourceTime:11}],assets:[]}}};

test('save treats null optional shot fields as omitted but rejects a real shot status on another event',async()=>{
  const runtime=createCommentaryTools(start,{budget:{maxToolCalls:3,toolCalls:0}});
  runtime.state.seenFrames.add(20);
  const save=runtime.tools.find(t=>t.name==='save_commentary_plan'),candidate=plan();
  candidate.events[0].shotStatus=null;
  await save.execute('null-option',{plan:candidate,finish:false});
  assert.equal('shotStatus' in runtime.state.plan.events[0],false);
  candidate.events[0].shotStatus='confirmed';
  await assert.rejects(save.execute('invalid-status',{plan:candidate,finish:false}),/shotStatus requires shot event kind/);
});

test('repeating overview tiles is not finer evidence; full size reread is',async()=>{
  const runtime=createCommentaryTools({...start,context:{...start.context,observations:'unknown'}},{budget:{maxToolCalls:5,toolCalls:0},rpc:async()=>({content:[{type:'image',data:'aGVsbG8=',mimeType:'image/png'}],details:{frames:[{frame:10,time:1,sourceTime:11}],assets:[]}})});
  const reader=runtime.tools.find(t=>t.name==='read_video_window');
  await reader.execute('repeat',{startTime:0,endTime:2,mode:'sheet'});
  assert.equal(runtime.state.seenFrames.detailRead,false);
  await reader.execute('full',{startTime:0,endTime:2,mode:'full'});
  assert.equal(runtime.state.seenFrames.detailRead,true);
  const context=await runtime.tools.find(t=>t.name==='get_video_context').execute('context',{});
  assert.equal(JSON.parse(context.content[0].text).context.observationAvailability.available,false);
});

test('validates duration, image-backed evidence, and detail evidence before completion',()=>{
  const frames=new Set([10,20]);frames.detailRead=true;frames.detailFrames=new Set([20]);
  assert.deepEqual(validateCommentaryPlan(plan(),{duration:8,readFrames:frames}),[]);
  const tooLate=plan();tooLate.cues[0].suggestedEndTime=9;
  assert.ok(validateCommentaryPlan(tooLate,{duration:8,readFrames:frames}).some(error=>error.includes('超出视频范围')));
  const unseen=plan();unseen.events[0].evidenceFrames=[99];
  assert.ok(validateCommentaryPlan(unseen,{duration:8,readFrames:frames}).some(error=>error.includes('已读取图片')));
  const rushed=plan();rushed.cues[0].text='持球人迅速推进到前场随后分球并完成一次干净利落的篮下终结';rushed.cues[0].suggestedStartTime=1;rushed.cues[0].suggestedEndTime=3;
  assert.ok(validateCommentaryPlan(rushed,{duration:8,readFrames:frames}).some(error=>error.includes('每秒 4 个汉字')));
  rushed.cues[0].delivery='pause';
  assert.deepEqual(validateCommentaryPlan(rushed,{duration:8,readFrames:frames}),[]);
  const mixed=plan();mixed.cues[0].text='Oh my god unbelievable incredible 进球';mixed.cues[0].suggestedEndTime=2;
  assert.ok(validateCommentaryPlan(mixed,{duration:8,readFrames:frames}).some(error=>error.includes('含英文')));
  const overviewOnly=new Set([10]);
  assert.ok(validateCommentaryPlan(plan(),{duration:8,readFrames:overviewOnly}).some(error=>error.includes('细化视频窗口')));
});

test('tool reads images, preserves both clocks, checkpoints plans, and rejects cancellation or exhausted budget',async()=>{
  const budget={maxToolCalls:4,toolCalls:0,imagesReturned:0};let rpcCalls=0;const progress=[];
  const {tools,state}=createCommentaryTools(start,{budget,emit:event=>progress.push(event),rpc:async(method,params)=>{
    rpcCalls++;assert.equal(method,'read_video_window');assert.equal(params.startTime,2);
    return {content:[{type:'image',data:'aGVsbG8=',mimeType:'image/png'}],frames:[{frame:20,time:3,sourceTime:13}],assets:[{id:'asset-20',frame:20}]};
  }});
  const reader=tools.find(tool=>tool.name==='read_video_window');
  await reader.execute('call',{startTime:2,endTime:4,mode:'sheet'});
  assert.equal(state.seenFrames.has(20),true);assert.equal(state.detailFrames.has(20),true);assert.equal(budget.imagesReturned,1);
  const context=await tools.find(tool=>tool.name==='get_video_context').execute('context',{});
  assert.match(context.content[0].text,/"available":true,"sourceState":"verified"/);
  assert.equal(tools.find(tool=>tool.name==='inspect_region').parameters.properties.frames.maxItems,12);
  budget.maxToolCalls=budget.toolCalls;
  await assert.rejects(reader.execute('over-budget',{startTime:2,endTime:4,mode:'sheet'}),/预算/);
  budget.maxToolCalls=4;
  const saver=tools.find(tool=>tool.name==='save_commentary_plan');
  const result=await saver.execute('save',{plan:plan(),finish:true});
  assert.equal(result.details.finish,true);
  assert.deepEqual(state.plan.events[0].evidenceTimes,[{frame:10,time:1,sourceTime:11},{frame:20,time:3,sourceTime:13}]);
  assert.deepEqual(progress.find(event=>event.status==='checkpoint').safePlan,state.plan);
  assert.equal(rpcCalls,1);
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(reader.execute('aborted',{startTime:2,endTime:4,mode:'sheet'},aborted.signal),/取消/);
});

test('handoff nodes require actually seen event frames and respect name intervals',()=>{
  const frames=new Set([10,20]);frames.detailRead=true;frames.detailFrames=new Set([20]);
  const p=plan();p.participants=[{participantId:'P1-f10',entityId:'P1',nameRecordRef:'name-1',validRange:{startFrame:10,endFrame:10},displayName:'Alice'}];
  p.nodes=[{nodeId:'n1',eventId:'e1',cueIds:['c1','c2','c3'],anchorAssetFrame:20,evidenceWindow:{startFrame:10,endFrame:20},participantRefs:['P1-f10'],focus:'传球',uncertainties:[]}];
  assert.ok(validateCommentaryPlan(p,{duration:8,readFrames:frames,frameTimes:new Map([[10,{time:1}],[20,{time:3}]]),requireContract:true}).some(e=>e.includes('区间')));
  p.nodes[0].participantRefs=[];
  assert.deepEqual(validateCommentaryPlan(p,{duration:8,readFrames:frames,frameTimes:new Map([[10,{time:1}],[20,{time:3}]]),requireContract:true}),[]);
  p.nodes[0].anchorAssetFrame=99;
  assert.ok(validateCommentaryPlan(p,{duration:8,readFrames:frames,requireContract:true}).some(e=>e.includes('证据')));
});

test('new handoff covers every cue once, and during_play keeps its delivery',()=>{
  const p=plan(),readFrames=new Set([10,20]);readFrames.detailRead=true;readFrames.detailFrames=new Set([20]);
  const options={duration:8,readFrames,requireContract:true};p.participants=[];
  p.nodes=[{nodeId:'n1',eventId:'e1',cueIds:['c1','c2','c3'],anchorAssetFrame:20,evidenceWindow:{startFrame:10,endFrame:20},participantRefs:[],focus:'推进',uncertainties:[]}];
  assert.deepEqual(validateCommentaryPlan(p,options),[]);assert.equal(p.cues[0].delivery,'during_play');
  p.nodes[0].cueIds=['c1','c2'];
  assert.ok(validateCommentaryPlan(p,options).some(e=>e.includes('恰好一个节点')));
  p.nodes.push({...p.nodes[0],nodeId:'n2',cueIds:['c1','c3']});
  assert.ok(validateCommentaryPlan(p,options).some(e=>e.includes('恰好一个节点')));
  p.nodes[0].cueIds=['c1','c1','c2'];p.nodes[1].cueIds=['c3'];
  assert.ok(validateCommentaryPlan(p,options).some(e=>e.includes('恰好一个节点')));
});

test('missing region frames cannot become seen evidence',async()=>{
  const runtime=createCommentaryTools(start,{budget:{maxToolCalls:5,toolCalls:0},rpc:async()=>({content:[{type:'image',data:'aGVsbG8=',mimeType:'image/png'}],details:{frames:[{frame:10,time:1,sourceTime:11},{frame:20,time:3,sourceTime:13}],returnedFrames:[10],unavailableFrames:[20],assets:[]}})});
  await runtime.tools.find(t=>t.name==='inspect_region').execute('region',{frames:[10,20]});
  assert.equal(runtime.state.seenFrames.has(20),false);
});
