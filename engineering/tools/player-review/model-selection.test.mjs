import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {findCombination,modelResult,modelResultLabel} from './model-selection.mjs';
const catalog=JSON.parse(readFileSync(new URL('../../configs/tracking/workbench-models.json',import.meta.url)));
test('every offered detector/tracker pair resolves to a distinct persisted result',()=>{
  const ids=[];
  for(const detector of catalog.detectors)for(const tracker of catalog.trackers){
    const selected=findCombination(catalog,detector.id,tracker.id);assert.ok(selected);ids.push(selected.id);
    assert.doesNotMatch(modelResultLabel(catalog,selected.id),/THY|推荐/);
  }
  assert.equal(new Set(ids).size,4);
  assert.equal(findCombination(catalog,'ebard','botsort-reid').id,'team-stable');
  assert.equal(findCombination(catalog,'not-a-model','bytetrack'),null);
});
test('historical results retain their identity rather than becoming a new combination',()=>{
  assert.equal(modelResult(catalog,'ebard').id,'ebard');
  assert.notEqual(findCombination(catalog,'ebard','bytetrack').id,'ebard');
  assert.match(modelResultLabel(catalog,'baseline'),/历史结果/);
  assert.equal(modelResultLabel(catalog,'original','THY · 自定义旧版本'),'自定义旧版本');
});
