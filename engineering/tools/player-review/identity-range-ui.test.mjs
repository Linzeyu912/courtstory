import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {transformSync} from 'esbuild';

// Compile only this JSX component in memory; do not rebuild the app bundle.
const module={exports:{}},code=transformSync(readFileSync(new URL('./identity-range-ui.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs'}).code;
vm.runInNewContext(code,{module,exports:module.exports,require:createRequire(import.meta.url)});
const {IdentityRangeEditor}=module.exports;
const children=node=>[node,...(Array.isArray(node?.props?.children)?node.props.children:[node?.props?.children]).flat(Infinity).filter(n=>n&&typeof n==='object').flatMap(children)];
const label=node=>[node?.props?.children].flat(Infinity).map(n=>typeof n==='object'?label(n):n??'').join('');
function fixture(patch={}){
  const calls=[],api=new Proxy({},{get:(_,name)=>(...args)=>calls.push([name,...args])});
  const state={entity:{id:'P1'},frameTimes:[0,.1,.2,.3,.4],frame:2,reviewBusy:false,canUndo:true,trackCatalog:[{id:7,start:0,end:4}],range:{start:1,end:3,kind:'identity',geometryMode:'box',trackId:null,keyframes:[],preserveManual:true,capture:null,error:'',preview:null,...patch}};
  const all=children(IdentityRangeEditor({state,api}));
  return {calls,state,api,all,button:text=>all.find(n=>n.type==='button'&&label(n)===text),named:text=>all.find(n=>n.props?.['aria-label']===text)};
}
test('range time, sliders, current endpoints and candidate capture call the explicit interval controls',()=>{
  const f=fixture();f.named('修正起点秒').props.onBlur({target:{value:'0.2'}});f.named('修正终点滑块').props.onChange({target:{value:'4'}});
  f.button('当前画面设为起点').props.onClick();f.named('区间正确人物').props.onChange({target:{value:'7'}});f.button('在画面选择正确人物').props.onClick();
  assert.deepEqual(f.calls,[['setRangeTime','start',.2],['setRange','end',4],['setRange','start',2],['setRange','trackId',7],['captureRange','identity']]);
  assert.equal(f.button('应用这段修改').props.disabled,true);
});
test('geometry keyframes, protected manual positions, preview and one-step undo remain discoverable',()=>{
  const f=fixture({kind:'geometry',keyframes:[{frame:1,dx:4,dy:0}],preview:{changed:2,missing:1,preservedManual:1}});
  assert.equal(f.button('在当前帧调整关键帧 2').props.disabled,false);f.button('在当前帧调整关键帧 2').props.onClick();f.button('看中间').props.onClick();
  f.button('预览这段修改').props.onClick();f.button('应用这段修改').props.onClick();f.button('撤销上次修改').props.onClick();
  assert.deepEqual(f.calls,[['captureRange',1],['seek',2],['previewRange'],['applyRange'],['undo']]);
  assert(f.all.some(n=>n.type==='p'&&label(n).includes('尚未应用，不自动通过逐帧审核')));
  const waiting=fixture({kind:'geometry'});assert.equal(waiting.button('在当前帧调整关键帧 2').props.disabled,true);
});
