import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrawingTools} from './drawing-tools.mjs';
const node={nodeId:'n1',anchorAssetFrame:2,evidenceWindow:{startFrame:1,endFrame:4}};
const start={node,nodes:[node]};
const budget=()=>({maxToolCalls:20,toolCalls:0});
test('drawing has no commentary write tool; audit has no drawing tool',()=>{
  const {tools}=createDrawingTools(start,{budget:budget()});
  assert(!tools.some(t=>t.name==='save_commentary_plan'));
  assert.deepEqual(createDrawingTools({...start,mode:'audit'},{budget:budget()}).tools.map(t=>t.name),['save_drawing_audit']);
});
test('node tools reject outside frames before RPC and track only actual assets',async()=>{
  let calls=0;
  const {tools,state}=createDrawingTools(start,{budget:budget(),rpc:async()=>{calls++;return {content:[{type:'image',data:'real-pixels',mimeType:'image/jpeg'}],details:{frames:[{frame:1},{frame:2}],assets:[{assetId:'one',frame:1}]}};}});
  const tool=tools.find(t=>t.name==='read_node_frames');
  await assert.rejects(tool.execute('x',{nodeId:'n1',frames:[0,2]}),/窗口/);assert.equal(calls,0);
  await tool.execute('y',{nodeId:'n1',frames:[1,2]});assert.deepEqual([...state.seen],[1]);
});
test('saving unseen anchor is rejected; upstream conflict preserves separate status',async()=>{
  const {tools,state}=createDrawingTools(start,{budget:budget()});const tool=tools.find(t=>t.name==='save_node_drawing');
  await assert.rejects(tool.execute('x',{nodeId:'n1',status:'ready',reason:'',candidate:{schemaVersion:4,phases:[{freezeFrame:2}]}}),/实际读取/);
  await tool.execute('y',{nodeId:'n1',status:'needs_upstream_review',reason:'传球描述与原图不符',candidate:null});
  assert.equal(state.nodeStatus,'needs_upstream_review');assert.equal(state.candidate,null);
});
test('audit must cover every annotation and cannot approve rejected item',async()=>{
  const {tools,state}=createDrawingTools({...start,mode:'audit',candidate:{phases:[{annotations:[{}],actions:[]}]}},{budget:budget()});
  await assert.rejects(tools[0].execute('x',{nodeId:'n1',approved:true,reason:'',annotations:[],actions:[]}),/逐项/);
  await assert.rejects(tools[0].execute('y',{nodeId:'n1',approved:true,reason:'',annotations:[{index:0,approved:false,reason:'图像模糊'}],actions:[]}),/不一致/);
  await tools[0].execute('z',{nodeId:'n1',approved:false,reason:'待核对',annotations:[{index:0,approved:false,reason:'图像模糊'}],actions:[]});
  assert.equal(state.audit.approved,false);
});
test('redrawing can read prior rejection feedback while audit context has only its review tool',async()=>{
  const auditFeedback={audit:{reason:'坐标需下移'},previousCandidate:{schemaVersion:4}};
  const {tools}=createDrawingTools({...start,auditFeedback},{budget:budget()});
  const result=await tools.find(t=>t.name==='read_commentary_node').execute('x',{});
  assert.deepEqual(JSON.parse(result.content[0].text).auditFeedback,auditFeedback);
  assert.deepEqual(createDrawingTools({...start,mode:'audit'},{budget:budget()}).tools.map(t=>t.name),['save_drawing_audit']);
});
