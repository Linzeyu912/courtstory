import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPresentationSVG} from './tactics-presentation.mjs';

test('one endpoint ring marks only the last remaining segment of each player without joining gaps',()=>{
  const geometry=x=>({curve:[{x,y:2},{x:x+1,y:3}],chevrons:[[{x,y:2},{x:x+.5,y:2.5},{x,y:3}]],ring:[{x:x+10,y:20},{x:x+11,y:21}]});
  const route=(routeId,entityId,end,x)=>({routeId,entityId,selected:entityId==='P2',manual:false,remaining:{endFrameExclusive:end},video:geometry(x),court:geometry(x)});
  const scene={width:1920,height:1080,routes:[route('early','P2',50,1),route('other','P1',80,3),route('late','P2',84,5)]},before=structuredClone(scene);
  const svg=renderPresentationSVG(scene,{width:1000,height:562.5});
  assert.ok(!svg.includes('11.0000,20.0000 12.0000,21.0000'),'intermediate segment has no endpoint ring');
  assert.ok(svg.includes('15.0000,20.0000 16.0000,21.0000'),'last segment retains endpoint ring');
  assert.ok(svg.includes('13.0000,20.0000 14.0000,21.0000'),'other player retains its own final endpoint');
  assert.match(svg,/data-route-id="early"/);assert.match(svg,/data-route-id="late"/);
  assert.match(svg,/stroke="#183544" stroke-width="6"/);assert.match(svg,/stroke-width="10"/);
  assert.doesNotMatch(svg,/<text\b|<foreignObject\b/);assert.deepEqual(scene,before);
});
