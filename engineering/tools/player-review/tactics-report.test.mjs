import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {buildPhaseRoutes,updateRouteControlPoints} from './tactics-presentation.mjs';

test('offline freeze report explicitly describes its scope when presentation edits are persisted',async()=>{
  const f=await makePresentationDemo();const d={schemaVersion:1,title:'report',notes:'safe notes',...f};
  const model=await buildPhaseRoutes(d,'setup'),route=model.routes[0];
  const edited=updateRouteControlPoints(d,route,route.controlPoints);
  const jpeg=Buffer.from([255,216,255,217]);
  const frames=f.playDefinition.phases.map(p=>({frame:p.freezeFrame,time:p.freezeFrame*.1,sourceFrame:p.freezeFrame,sourceTime:p.freezeFrame*.1,
    videoSha256:f.review.videoSha256,width:f.review.width,height:f.review.height,dataUrl:`data:image/jpeg;base64,${jpeg.toString('base64')}`,sha256:createHash('sha256').update(jpeg).digest('hex')}));
  const cli=new URL('../tactical-overlay/workbench-cli.mjs',import.meta.url);
  const result=spawnSync(process.execPath,[cli.pathname.replace(/^\/([A-Z]:)/,'$1')],{input:JSON.stringify({operation:'export',document:edited,frames}),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const html=JSON.parse(result.stdout).html;
  assert.match(html,/导出范围/);assert.match(html,/不包含.*人工展示修正/);assert.match(html,/JSON/);
  assert.match(html,/safe notes/);
});
