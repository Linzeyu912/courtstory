import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalJSON,createSourceBinding} from './binding.mjs';

test('canonical JSON preserves arrays and sorts keys by UTF-16 even for integer keys',()=>{
  assert.equal(canonicalJSON({b:1,a:[2,1],'2':'two','10':'ten'}),'{"10":"ten","2":"two","a":[2,1],"b":1}');
  assert.equal(canonicalJSON({'é':'e','a':'<>&"',z:-0}),'{"a":"<>&\\\"","z":0,"é":"e"}');
});
test('canonical JSON refuses non-JSON values instead of silently discarding them',()=>{
  const circular={};circular.self=circular;
  for(const value of [undefined,NaN,Infinity,1n,Symbol('s'),()=>{},[,,],{x:undefined},new Date(),circular,Object.assign({}, {[Symbol('s')]:1})])assert.throws(()=>canonicalJSON(value));
});
test('canonical JSON refuses accessors even when their key is length',()=>{
  let invoked=false;const value={};Object.defineProperty(value,'length',{enumerable:true,get(){invoked=true;return 1;}});
  assert.throws(()=>canonicalJSON(value));assert.equal(invoked,false);
});
test('binding hashes exact canonical UTF-8 and every actual review field',async()=>{
  const review={schemaVersion:2,videoSha256:'v',sourceVideoSha256:'root',trackingFingerprint:'track',trackingRevision:'r',sourceFrameMapping:[{frame:0,time:0,sourceFrame:3,sourceTime:0.3}],confirmedAt:'now',entities:[]};
  const binding=await createSourceBinding(review);
  assert.equal(binding?.digestVersion,'canonical-json-v1');
  assert.equal(binding.reviewDigest,createHash('sha256').update(canonicalJSON(review),'utf8').digest('hex'));
  assert.equal(binding.frameMappingDigest,createHash('sha256').update('[{"frame":0,"sourceFrame":3,"sourceTime":0.3,"time":0}]').digest('hex'));
  assert.deepEqual(Object.keys(binding).sort(),['digestVersion','frameMappingDigest','reviewDigest','sourceVideoSha256','trackingFingerprint','trackingRevision','videoSha256']);
  for(const mutate of [r=>r.confirmedAt='later',r=>r.entities.push({id:'P1'}),r=>r.sourceFrameMapping[0].sourceFrame=4,r=>r.court={calibration:{version:2}}]){
    const changed=structuredClone(review);mutate(changed);assert.notEqual((await createSourceBinding(changed)).reviewDigest,binding.reviewDigest);
  }
});
