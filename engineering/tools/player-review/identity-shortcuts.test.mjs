import test from 'node:test';
import assert from 'node:assert/strict';
import {mountIdentityShortcuts} from './workbench-shell.mjs';

test('identity shortcuts open the core tools before revealing and focusing the matching panel',()=>{
  const calls=[],profile={open:false,scrollIntoView:()=>calls.push('profile-scroll')},summary={focus:()=>calls.push('profile-focus')};
  const reference={focus:()=>calls.push('reference-focus')},agent={scrollIntoView:()=>calls.push('agent-scroll'),querySelector:()=>reference};
  const legacy={open:false},nodes={openIdentityProfile:{},openIdentityContinuation:{},playerNamePanel:profile,playerNameSummary:summary,playerProfilePanel:legacy};
  const body={dataset:{step:'repair',tools:'collapsed'}};
  const doc={body,getElementById:id=>nodes[id],querySelector:()=>agent};
  mountIdentityShortcuts({document:doc,schedule:fn=>fn(),openIdentity:()=>{calls.push('identity');body.dataset.step='identity';body.dataset.tools='expanded';}});
  nodes.openIdentityProfile.onclick();assert.equal(profile.open,true);assert.equal(body.dataset.tools,'expanded');
  assert.equal(legacy.open,false,'the primary shortcut does not open legacy single-player OCR');
  assert.deepEqual(calls,['identity','profile-scroll','profile-focus']);
  calls.length=0;nodes.openIdentityContinuation.onclick();assert.deepEqual(calls,['identity','agent-scroll','reference-focus']);
});

test('identity shortcuts respect a source-selection guard instead of exposing an inactive identity panel',()=>{
  const profile={open:false},nodes={openIdentityProfile:{},openIdentityContinuation:{},playerNamePanel:profile};
  const doc={body:{dataset:{step:'footage'}},getElementById:id=>nodes[id]};let scheduled=0;
  mountIdentityShortcuts({document:doc,schedule:()=>scheduled++,openIdentity:()=>{}});
  nodes.openIdentityProfile.onclick();assert.equal(profile.open,false);assert.equal(scheduled,0);
});
