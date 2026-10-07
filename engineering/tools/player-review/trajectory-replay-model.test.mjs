import test from 'node:test';
import assert from 'node:assert/strict';
import { availableCounts, frameAtTime, hasDenoiseComparison, imagePoint, pathSegments, pointSource, replayPlayers, playerFrames, selectReplayPlayers } from './trajectory-replay-model.mjs';

test('seek uses source timestamps rather than an assumed constant FPS', () => {
  const frames = [{ time: 13 }, { time: 13.017 }, { time: 13.061 }, { time: 13.078 }];
  assert.equal(frameAtTime(frames, 13.05), 1);
  assert.equal(frameAtTime(frames, 13.061), 2);
  assert.equal(frameAtTime(frames, 0), 0);
  assert.equal(frameAtTime(frames, 100), 3);
});
test('both original and candidate trails retain gaps, including the start of a sliding window', () => {
  const frames = [0, 1, 2, 3, 4].map(i => ({ frame: i, time: i, qwen: i === 2 ? null : [i, i] }));
  assert.deepEqual(pathSegments(frames, 'qwen', 4), [[[0, 0], [1, 1]], [[3, 3], [4, 4]]]);
  assert.deepEqual(pathSegments(frames, 'qwen', 4, 1), [[[1, 1]], [[3, 3], [4, 4]]]);
  assert.deepEqual(pathSegments(frames, 'qwen', 2), [[[0, 0], [1, 1]]]);
});
test('historical ground points use the current camera transform, with no projection when unavailable', () => {
  assert.deepEqual(imagePoint([2, 0, 20, 0, 3, 30, 0, 0, 1], [5, 10]), [30, 60]);
  assert.equal(imagePoint(null, [5, 10]), null);
  assert.equal(imagePoint([1, 0, 0, 0, 1, 0, 0, 0, 0], [5, 10]), null);
  assert.equal(imagePoint([1, 0, 0, 0, 1, 0, 0, 0, 1], null), null);
});

test('multi-player trails remain isolated and retain a missing observation for one player', () => {
  const data = { players: [{id:'P1',team:'white'},{id:'P6',team:'dark_blue'}], frames: [
    {frame:0,time:0,toImage:[1],players:{P1:{qwen:[1,2]},P6:{qwen:[6,7]}}},
    {frame:1,time:.017,toImage:[2],players:{P6:{qwen:[7,8]}}},
    {frame:2,time:.05,toImage:[3],players:{P1:{qwen:[2,3]},P6:{qwen:[8,9]}}},
  ]};
  assert.equal(replayPlayers(data).length, 2);
  assert.deepEqual(pathSegments(playerFrames(data,'P1'),'qwen',2), [[[1,2]],[[2,3]]]);
  assert.deepEqual(pathSegments(playerFrames(data,'P6'),'qwen',2), [[[6,7],[7,8],[8,9]]]);
  assert.deepEqual(playerFrames(data,'P1')[1].toImage, [2]);
  const legacy={entityId:'P1',player:'Target',frames:[{frame:0,time:0,qwen:[1,2]}]};
  assert.equal(playerFrames(legacy,'P1'),legacy.frames);
});

test('a binding change or cut retains positions without drawing a false connecting run',()=>{
  const frames=[
    {frame:0,time:0,qwen:[1,2]},
    {frame:1,time:.017,qwen:[15,2],breakBefore:true},
    {frame:2,time:.034,qwen:[15.1,2]},
    {frame:3,time:.051,qwen:[5,4],cut:true},
  ];
  assert.deepEqual(pathSegments(frames,'qwen',3),[[[1,2]],[[15,2],[15.1,2]],[[5,4]]]);
});

test('player scope can overlay everyone or isolate one player', () => {
  const players = [{ id: 'P1' }, { id: 'P2' }];
  assert.deepEqual(selectReplayPlayers(players), players);
  assert.deepEqual(selectReplayPlayers(players, 'P2'), [players[1]]);
  assert.deepEqual(selectReplayPlayers(players, 'missing'), []);
});

test('schema 2 exposes pre-denoise candidates, final positions, state and missing gaps', () => {
  const data = { players: [{ id: 'P1' }, { id: 'P2' }], frames: [
    { frame: 0, time: 0, players: { P1: { refined: [4, 5], qwen: [4, 5], qwenState: 'model', processedState: 'model-corrected', denoiseDisplacement: .4 }, P2: { refined: [7, 8], qwen: [7.1, 8], processedState: 'smoothed' } } },
    { frame: 1, time: .1, players: { P1: { refined: [5, 6], qwen: null, qwenState: 'unknown', processedState: 'missing' } } },
  ] };
  assert.equal(hasDenoiseComparison(data), true);
  assert.deepEqual(availableCounts(data, 'refined'), { count: 3, total: 4 });
  assert.deepEqual(availableCounts(data, 'qwen'), { count: 2, total: 4 });
  const p1 = playerFrames(data, 'P1');
  assert.deepEqual(pathSegments(p1, 'refined', 1), [[[4, 5], [5, 6]]]);
  assert.deepEqual(pathSegments(p1, 'qwen', 1), [[[4, 5]]]);
  assert.equal(pointSource(p1[0]), 'model-corrected');
  assert.equal(pointSource(p1[1]), 'missing');
});

test('legacy single-player schema keeps its existing data and does not enable denoise comparison', () => {
  const legacy = { entityId: 'P1', player: 'Target', counts: { raw: 2, qwen: 1, total: 2 }, frames: [
    { frame: 0, time: 0, raw: [1, 2], qwen: [1.1, 2] }, { frame: 1, time: .1, raw: [2, 3], qwen: null },
  ] };
  assert.equal(hasDenoiseComparison(legacy), false);
  assert.deepEqual(availableCounts(legacy, 'qwen'), { count: 1, total: 2 });
  assert.equal(playerFrames(legacy, 'P1'), legacy.frames);
  assert.equal(pointSource(legacy.frames[1]), '无最终位置');
});
