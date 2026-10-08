import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommentaryTools,validateCommentaryPlan} from './commentary-tools.mjs';

const plan=()=>({summary:'一次快速转换进攻。',events:[{eventId:'e1',startTime:1,endTime:4,description:'持球方推进并完成进攻。',participants:['未知球员'],evidenceFrames:[10,20],uncertainties:[]}],
  cues:[1,2,3].map((n)=>({cueId:`c${n}`,eventId:'e1',suggestedStartTime:1,suggestedEndTime:4,text:`转换推进后完成第${n}次进攻。`,focus:'推进路线',delivery:'during_play',evidenceFrames:[10,20]})),uncertainties:[]});
const start={context:{videoRef:'clip',width:1280,height:720,duration:8,observations:'verified',frames:[{frame:10,time:1,sourceTime:11},{frame:20,time:3,sourceTime:13}]},
  overview:{content:[{type:'text',text:'overview'},{type:'image',data:'aGVsbG8=',mimeType:'image/png'}],details:{frames:[{frame:10,time:1,sourceTime:11}],assets:[]}}};

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
