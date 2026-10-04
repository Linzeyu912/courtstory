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
  assert.equal(f.button('采用所选片段（1）').props.disabled,true);f.button('清除候选 / 重置任务').props.onClick();assert.equal(f.calls[0][0],'cancelIdentityJob');
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
