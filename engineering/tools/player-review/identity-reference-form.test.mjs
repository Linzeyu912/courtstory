import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {transformSync} from 'esbuild';

function mountedPanel(initial){
  const require=createRequire(import.meta.url),react=require('react'),cells=[];
  let cursor=0,effects=[],state=initial;
  const hooks={...react,
    useState(seed){const index=cursor++;if(!cells[index])cells[index]={value:typeof seed==='function'?seed():seed};return [cells[index].value,value=>{cells[index].value=typeof value==='function'?value(cells[index].value):value;}];},
    useRef(value){const index=cursor++;return cells[index]??(cells[index]={current:value});},
    useEffect(effect,deps){const index=cursor++,previous=cells[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous[i]))){cells[index]=deps;effects.push(effect);}}
  };
  const module={exports:{}};
  vm.runInNewContext(transformSync(readFileSync(new URL('./identity-agent-ui.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs'}).code,
    {module,exports:module.exports,require:name=>name==='react'?hooks:require(name)});
  const render=()=>{cursor=0;return module.exports.IdentityAgentPanel({state,api:{}});};
  const update=next=>{state=next;render();const pending=effects;effects=[];for(const effect of pending)effect();return render();};
  return {update,current:()=>update(state)};
}
const values=element=>JSON.parse(JSON.stringify(element.props.form));

test('adopted team and jersey evidence reaches a mounted reference form without overwriting edited fields',()=>{
  let state={entity:{id:'P1',role:'player',team:'白色球衣',jersey:''},identityAgent:{}};
  const panel=mountedPanel(state);assert.deepEqual(values(panel.current()),{team:'白色球衣',jersey:''});
  panel.current().props.onFormChange('team','我核对的白色球衣');
  state={...state,entity:{...state.entity,team:'IND',jersey:'0'}};
  assert.deepEqual(values(panel.update(state)),{team:'我核对的白色球衣',jersey:'0'});
  panel.current().props.onFormChange('jersey','00');
  state={...state,entity:{...state.entity,jersey:'3'}};
  assert.deepEqual(values(panel.update(state)),{team:'我核对的白色球衣',jersey:'00'});
});

test('OCR form sync does not mutate a saved reference and saving a replacement resets edit protection',()=>{
  const reference={team:'白色球衣',jersey:'0',frame:8,trackId:2};
  let state={entity:{id:'P1',role:'player',team:'白色球衣',jersey:'0',identityReference:reference},identityAgent:{}};
  const panel=mountedPanel(state);panel.current().props.onFormChange('jersey','00');
  state={...state,entity:{...state.entity,team:'IND',jersey:'3'}};
  assert.deepEqual(values(panel.update(state)),{team:'IND',jersey:'00'});
  assert.deepEqual(reference,{team:'白色球衣',jersey:'0',frame:8,trackId:2});
  state={...state,entity:{...state.entity,identityReference:{...reference,team:'IND',jersey:'00'}}};
  assert.deepEqual(values(panel.update(state)),{team:'IND',jersey:'00'});
  state={...state,entity:{...state.entity,jersey:'10'}};
  assert.equal(values(panel.update(state)).jersey,'10');
  state={...state,entity:{id:'P2',role:'player',team:'黄色球衣',jersey:'7'}};
  assert.deepEqual(values(panel.update(state)),{team:'黄色球衣',jersey:'7'});
});
