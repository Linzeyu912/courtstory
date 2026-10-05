import test from 'node:test';
import assert from 'node:assert/strict';
import { frameAtTime, imagePoint, pathSegments } from './trajectory-replay-model.mjs';

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
