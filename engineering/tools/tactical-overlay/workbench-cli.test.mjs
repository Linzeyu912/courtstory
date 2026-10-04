import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {documentDigest} from '../player-review/tactics-agent.mjs';

// Force UTF-8 code points across reads without depending on OS pipe chunk sizes.
function runFragmented(input){
  const code=`import {readFileSync} from 'node:fs';import {Readable} from 'node:stream';
    const bytes=readFileSync(0),chunks=Array.from(bytes,byte=>Buffer.from([byte]));
    Object.defineProperty(process,'stdin',{value:Readable.from(chunks)});
    await import(${JSON.stringify(new URL('./workbench-cli.mjs',import.meta.url).href)});`;
  return spawnSync(process.execPath,['--input-type=module','-e',code],{input,encoding:'utf8',timeout:10000});
}

test('CLI digest preserves Chinese and emoji split across streamed UTF-8 byte boundaries',async()=>{
  const document={title:'中文战术 ⛹️',notes:'先冻结，再传球。',production:{mediaBinding:{version:1,phaseDigest:'参考阶段'}}};
  const result=runFragmented(JSON.stringify({operation:'agent-digest',document}));
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).digest,await documentDigest(document));
});

test('CLI keeps rejecting malformed JSON after streamed text decoding',()=>{
  const result=runFragmented('{"operation":"agent-digest","document":{"title":"中文"}');
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/JSON/);
});
