import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {transformSync} from 'esbuild';

const module={exports:{}},path=new URL('./identity-agent-ui.jsx',import.meta.url);
if(existsSync(path))vm.runInNewContext(transformSync(readFileSync(path,'utf8'),{loader:'jsx',format:'cjs'}).code,{module,exports:module.exports,require:createRequire(import.meta.url)});
const children=node=>[node,...[node?.props?.children].flat(Infinity).filter(n=>n&&typeof n==='object').flatMap(children)];
const text=node=>[node?.props?.children].flat(Infinity).map(n=>typeof n==='object'?text(n):n??'').join('');
function fixture(patch={}){
  const calls=[],api=new Proxy({},{get:(_,name)=>(...args)=>calls.push([name,...args])});
  const state={entity:{id:'P1',role:'player',name:'球员 1',identityReference:{frame:1,trackId:2,team:'紫衣',jersey:'10'}},
    frame:2,frameTimes:[0,.1,.2,.3,.4],range:{start:0,end:4},reviewBusy:false,canUndo:true,referenceFrameReady:true,referenceCandidate:{trackId:2},proposals:[{trackId:2},{trackId:62}],
    identityAgent:{status:{available:true},busy:false,stale:false,selectedIds:['candidate-1'],job:{jobId:'job1',entityId:'P1',status:'ready',purpose:'continuation',
      candidate:{segments:[{id:'candidate-1',trackId:62,start:1,end:3,originalStart:0,originalEnd:4,confidence:.84,reason:'紫衣 10 号可见',evidenceFrames:[1,3]}]},previewFrames:[]}},...patch};
  assert.equal(typeof module.exports.IdentityAgentControls,'function');
  const all=children(module.exports.IdentityAgentControls({state,api,form:{team:'紫衣',jersey:'10'},onFormChange:(...args)=>calls.push(['form',...args]),onUseRecognition:()=>calls.push(['suggestion']),onSeekTime:()=>{},onRangeEdit:(...args)=>calls.push(['range',...args])}));
  return {state,calls,all,button:label=>all.find(n=>n.type==='button'&&text(n)===label),named:label=>all.find(n=>n.props?.['aria-label']===label)};
}

test('identity controls send the chosen T and confirmed text separately from bounded adoption',()=>{
  const f=fixture();f.named('身份参考人物').props.onChange({target:{value:'62'}});
  f.button('Agent 识别号码').props.onClick();f.button('保存参考身份').props.onClick();f.button('Agent 查找其他片段').props.onClick();
  f.button('采用所选片段（1）').props.onClick();f.button('撤销上次修改').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[['identityReferenceCandidate',62],['recognizeIdentity',{trackId:2,team:'紫衣',jersey:'10'}],['saveIdentityReference',{trackId:2,team:'紫衣',jersey:'10'}],['findIdentity'],['adoptIdentityCandidates'],['undo']]);
});

test('candidate review exposes boundaries, highlights the candidate T and narrows without claiming model certainty',async()=>{
  const f=fixture();f.named('采用候选 T62 第 2–4 帧').props.onChange();await f.button('看起点').props.onClick();await f.button('看终点').props.onClick();
  f.named('candidate-1 采用起帧').props.onBlur({target:{value:'3'}});
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[['toggleIdentityCandidate','candidate-1'],['seek',1],['identityReferenceCandidate',62],['seek',3],['identityReferenceCandidate',62],['range','candidate-1','start','3']]);
  assert(f.all.some(n=>text(n).includes('模型估计 84%')));assert(f.all.some(n=>text(n).includes('抽样证据不能保证区间内每一帧都正确')));
});

test('stale results and missing provider cannot be adopted or launched while cancellation stays available',()=>{
  const base=fixture().state;
  const f=fixture({identityAgent:{...base.identityAgent,stale:true,status:{available:false,message:'未配置识别服务'}}});
  assert.equal(f.button('Agent 识别号码').props.disabled,true);assert.equal(f.button('Agent 查找其他片段').props.disabled,true);
  assert.equal(f.button('采用所选片段（1）').props.disabled,true);f.button('清除本次结果 / 重置任务').props.onClick();assert.equal(f.calls[0][0],'cancelIdentityJob');
});

test('recognition suggestions require returning to the original frame and T before populating the reference form',()=>{
  const base=fixture().state,job={jobId:'recognition',entityId:'P1',status:'ready',purpose:'reference',requestReference:{frame:1,trackId:2},candidate:{team:'紫衣',jersey:'10'},previewFrames:[]};
  const moved=fixture({identityAgent:{...base.identityAgent,job}});
  assert.equal(moved.button('填入识别建议').props.disabled,true);assert(moved.button('回到识别参考帧'));
  const returned=fixture({frame:1,identityAgent:{...base.identityAgent,job}});
  assert.equal(returned.button('填入识别建议').props.disabled,false);returned.button('填入识别建议').props.onClick();assert.deepEqual(returned.calls,[['suggestion']]);
});

test('candidate endpoint editing returns both zero-based endpoints and rejects outside or reversed input',()=>{
  const edit=module.exports.editedIdentityCandidateRange;assert.equal(typeof edit,'function');
  const segment={start:1,end:3,originalStart:0,originalEnd:4};
  assert.deepEqual(JSON.parse(JSON.stringify(edit(segment,'start','3'))),{start:2,end:3});
  for(const [key,value] of [['start','5'],['end','6'],['start',''],['end','2.5']])assert.throws(()=>edit(segment,key,value));
});

test('reference recognition and saving wait for the decoded target frame while a saved-reference continuation stays available',()=>{
  for(const referenceFrameReady of [false,undefined]){
    const f=fixture({referenceFrameReady});
    assert.equal(f.button('Agent 识别号码').props.disabled,true);
    assert.equal(f.button('保存参考身份').props.disabled,true);
    assert.equal(f.button('Agent 查找其他片段').props.disabled,false);
    assert(f.all.some(n=>n.props?.role==='status'&&text(n).includes('画面正在定位，请等待清晰画面加载后再保存参考。')));
  }
});

function initialFixture(patch={}){
  const calls=[],api=new Proxy({},{get:(_,name)=>(...args)=>calls.push([name,...args])});
  const state={frameTimes:[0,.1,.2,.3,.4],identityAgent:{status:{available:true}},initialReview:{busy:false},initialReviewView:{job:{status:'ready'},ready:true,applied:true,roles:{},issues:[]},...patch};
  const all=children(module.exports.InitialIdentityReviewControls({state,api}));
  return {calls,all,button:label=>all.find(node=>node.type==='button'&&text(node)===label)};
}

test('global initial review needs no selected player or reference and leaves manual correction available during inference',()=>{
  const f=initialFixture({initialReview:{busy:true},initialReviewView:{job:{status:'analyzing'},busy:true,issues:[],roles:{}}});
  f.button('停止初检').props.onClick();f.button('直接人工修改').props.onClick();
  assert.deepEqual(f.calls,[['cancelInitialReview'],['focusIdentityManual']]);
  assert(f.all.some(node=>node.type==='h3'&&text(node)==='Agent 整段抽样初检'));
  assert(f.all.some(node=>node.type==='p'&&text(node).includes('未看到的人仍留待核对')));
  assert.equal(f.all.filter(node=>node.type==='input').length,0);
});

test('all initial issues remain inspectable even without subject counts; only three appear outside disclosure',()=>{
  const issues=Array.from({length:5},(_,index)=>({id:String(index),label:'短暂人物未抽样',reason:'未看清',start:0,end:4}));
  const f=initialFixture({initialReviewView:{job:{status:'ready'},ready:true,applied:true,issues,roles:{}}});
  const issueButtons=f.all.filter(node=>node.props?.className==='identity-initial-issue');
  assert.equal(issueButtons.length,5);issueButtons[4].props.onClick();assert.deepEqual(f.calls,[['reviewIdentityIssue',issues[4]]]);
  const detail=f.all.find(node=>node.type==='details'&&text(node).startsWith('查看其余'));assert.equal(detail.props.open,undefined);assert.equal(children(detail).filter(node=>node.props?.className==='identity-initial-issue').length,2);
  assert(f.all.some(node=>node.type==='strong'&&text(node).includes('初检提示 5 处')));
});

test('stale initial result can be rebased explicitly but cannot be adopted; failed service still offers manual work',()=>{
  const stale=initialFixture({initialReviewView:{job:{status:'ready'},ready:true,stale:true,applied:false,issues:[]}});
  assert.equal(stale.button('补入可用机器建议').props.disabled,true);stale.button('更新初检到当前草稿').props.onClick();
  assert.deepEqual(stale.calls,[['retryInitialReview']]);
  const unavailable=initialFixture({identityAgent:{status:{available:false,message:'未配置服务'}},initialReviewView:{job:{status:'failed'},issues:[]}});
  assert.equal(unavailable.button('重试自动初检').props.disabled,true);assert.equal(unavailable.button('直接人工修改').props.disabled,undefined);
});

test('initial video provider and partial completion remain distinct from legacy availability and complete coverage',()=>{
  const f=initialFixture({identityAgent:{status:{available:false,initialReview:{available:true}}},initialReviewView:{job:{status:'ready'},ready:true,issues:[],completionStatus:'partial'}});
  assert.notEqual(f.button('继续检查未完成区间').props.disabled,true);
  assert(f.all.some(node=>node.type==='p'&&text(node).includes('部分')));
  assert(!f.all.some(node=>node.props?.role==='status'&&text(node)==='初检已完成'));
});

function quickFixture(patch={}){
  const calls=[],api=new Proxy({},{get:(_,name)=>(...args)=>calls.push([name,...args])});
  const state={entity:{id:'P1'},entities:[{id:'P1',role:'player',name:'球员 1'},{id:'P2',role:'player',name:'球员 2'}],frame:2,frameTimes:[0,.1,.2,.3,.4],canUndo:true,reviewBusy:false,quickIdentity:{trackId:2,ownerId:'P1',targetId:'P1',action:'replace',range:{start:1,end:3},preview:{changed:3,affectedPlayers:{P2:2}}},...patch};
  const all=children(module.exports.IdentityQuickControls({state,api}));
  return {calls,all,button:label=>all.find(node=>node.type==='button'&&text(node)===label),named:label=>all.find(node=>node.props?.['aria-label']===label)};
}

test('quick controls expose the exact continuous interval and apply once only after explicit target selection',()=>{
  const f=quickFixture();f.named('快速修改对应球员').props.onChange({target:{value:'P2'}});f.named('快速修改起点秒').props.onBlur({target:{value:'0.2'}});f.button('将 T2 关联到球员 1').props.onClick();f.button('撤销上次修改').props.onClick();
  assert.deepEqual(f.calls,[['setIdentityQuickTarget','P2'],['setIdentityQuickRange','start',.2],['applyIdentityQuickEdit'],['undo']]);
  assert(f.all.some(node=>node.type==='strong'&&text(node).includes('0.10 秒 – 0.30 秒')));
  assert(f.all.some(node=>node.props?.role==='status'&&text(node).includes('球员 2 有 2 帧重叠归属会释放')));
});

test('quick range can be selected using the video and visible endpoint or preset buttons without entering seconds',()=>{
  const f=quickFixture({referenceFrameReady:true});
  const labels=['当前帧设为起点','当前帧设为终点','跳到起点','跳到终点','当前连续段','从当前帧往后','整个 T 编号'];
  const hidden=new Set(f.all.filter(node=>node.type==='details').flatMap(children));
  for(const label of labels){const button=f.button(label);assert(button,`${label} is available`);assert(!hidden.has(button),`${label} is not hidden in details`);button.props.onClick();}
  assert.deepEqual(f.calls,[['setIdentityQuickEndpoint','start'],['setIdentityQuickEndpoint','end'],['seek',1],['seek',3],['setIdentityQuickPreset','continuous'],['setIdentityQuickPreset','forward'],['setIdentityQuickPreset','all']]);
  assert(hidden.has(f.named('快速修改起点秒')));assert(hidden.has(f.named('快速修改终点秒')));
  const loading=quickFixture({referenceFrameReady:false});assert.equal(loading.button('当前帧设为起点').props.disabled,true);
});

test('whole-T preview explains that the explicit human choice replaces old assignments',()=>{
  const f=quickFixture({quickIdentity:{trackId:2,targetId:'P1',action:'replace',scope:'track_occurrences',preset:'all',range:{start:0,end:4},preview:{observationCount:4,changed:4,conflicts:0,segments:2,affectedPlayers:{}}}});
  assert(f.all.some(node=>node.props?.role==='status'&&text(node).includes('可关联 4 帧')));
  assert(f.all.some(node=>text(node).includes('以这次人工选择为准，替换旧关联')));
  assert(f.all.some(node=>text(node).includes('点击关联才保存，仍可逐帧核对')));
  assert.equal(f.calls.length,0);f.button('将 T2 关联到球员 1').props.onClick();assert.deepEqual(f.calls,[['applyIdentityQuickEdit']]);
});

test('clearing advanced time input reports an invalid range rather than keeping the old preview silently',()=>{
  const f=quickFixture();f.named('快速修改起点秒').props.onBlur({target:{value:''}});
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'setIdentityQuickRange');assert(Number.isNaN(f.calls[0][2]));
});

test('missing-person flow asks for two clicks with a suggested endpoint and no required frame inputs or T',()=>{
  const f=quickFixture({quickIdentity:{trackId:null,targetId:'P1',action:'missing',range:{start:2,end:4},missingKeys:[{frame:2,x:1,y:2}]}});
  assert(f.all.some(node=>text(node).includes('起点已记录')));
  assert.equal(f.all.filter(node=>node.type==='input').length,0);
  f.button('跳到建议终点').props.onClick();assert.deepEqual(f.calls,[['seekMissingEndpoint']]);
  f.button('取消修改').props.onClick();assert.deepEqual(f.calls,[['seekMissingEndpoint'],['cancelIdentityQuickEdit']]);
});

test('missing range preview clearly labels estimates and requires explicit batch adoption',()=>{
  const f=quickFixture({referenceFrameReady:true,quickIdentity:{trackId:null,targetId:'P1',action:'missing',range:{start:0,end:4},missingKeys:[{frame:0,x:1,y:2},{frame:4,x:8,y:9}],preview:{changed:5,estimated:3,keyframes:2}}});
  assert(f.all.some(node=>text(node).includes('3 帧为估计位置')));
  const apply=f.button('应用这段补位（5 帧）');assert(apply);assert.equal(apply.props.disabled,false);
  apply.props.onClick();assert.deepEqual(f.calls,[['applyIdentityQuickEdit']]);
  assert(f.button('查看中间画面 / 补一个点'));
});
test('isolated single-frame gap has an explicit usable fallback after clicking its foot point',()=>{
  const quickIdentity={trackId:null,targetId:'P1',action:'missing',range:{start:2,end:2},missingKeys:[{frame:2,x:1,y:2}]};
  const f=quickFixture({referenceFrameReady:true,quickIdentity});
  const apply=f.button('仅补当前帧');assert(apply);assert.equal(apply.props.disabled,false);apply.props.onClick();
  assert.deepEqual(f.calls,[['applyMissingSingleFrame']]);
  assert.equal(quickFixture({referenceFrameReady:false,quickIdentity}).button('仅补当前帧').props.disabled,true);
  assert.equal(quickFixture({frame:3,referenceFrameReady:true,quickIdentity}).button('仅补当前帧').props.disabled,true);
  assert.equal(quickFixture({referenceFrameReady:true,quickIdentity:{...quickIdentity,range:{start:2,end:4}}}).button('仅补当前帧'),undefined);
});

test('selected unknown person exposes target and named primary action without opening a mode',()=>{
  const f=quickFixture({entity:{id:'P10'},entities:[{id:'P10',role:'player',name:'球员 10'}],quickIdentity:{trackId:60,ownerId:null,targetId:'P10',action:null,range:{start:2,end:2}}});
  const choose=f.named('快速修改对应球员'),apply=f.button('将 T60 关联到球员 10');
  assert(choose,'target selector is visible before entering any mode');assert(apply,'explicit apply names both source and target');
  assert.equal(apply.props.disabled,false);apply.props.onClick();
  assert.deepEqual(f.calls,[['applyIdentityQuickEdit']]);
  assert(f.all.indexOf(apply)<f.all.findIndex(node=>node.type==='details'),'primary action precedes optional range controls');
});

test('agent continuation offers one-click adoption and keeps frame editing in closed advanced disclosure',()=>{
  const f=fixture();const adopt=f.button('采用这条建议');assert(adopt);adopt.props.onClick();
  assert.deepEqual(f.calls,[['adoptIdentityCandidate','candidate-1']]);
  const details=f.all.find(node=>node.type==='details'&&text(node).includes('调整采用范围'));
  assert(details);assert.equal(details.props.open,undefined);
  assert(children(details).some(node=>node.props?.['aria-label']==='candidate-1 采用起帧'));
});
