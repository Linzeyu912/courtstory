import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from './tactics-playback.mjs';

const phases=[{phaseId:'a',startFrame:0,endFrameExclusive:20,freezeFrame:5},{phaseId:'b',startFrame:20,endFrameExclusive:40,freezeFrame:24},{phaseId:'c',startFrame:40,endFrameExclusive:60,freezeFrame:44}];
function setup(){assert.equal(typeof module.createPhasePlayback,'function');const p=module.createPhasePlayback();p.configure(phases,'a');p.select('a');p.presented(5);return p;}
test('jumped presented frames pause and seek the next freeze once, then require another continue',()=>{
  const p=setup();assert.deepEqual(p.continue(5),[{type:'play'}]);
  assert.deepEqual(p.presented(31),[{type:'pause'},{type:'phase',phaseId:'b'},{type:'seek',frame:24}]);
  assert.equal(p.state().status,'seeking');assert.deepEqual(p.presented(31),[]);
  assert.deepEqual(p.presented(24),[]);assert.equal(p.state().status,'paused');
  assert.deepEqual(p.presented(24),[]);assert.deepEqual(p.continue(24),[{type:'play'}]);
});
test('last phase stops at its last frame and replay seeks before playing',()=>{
  const p=setup();p.select('c');p.presented(44);p.continue(44);
  assert.deepEqual(p.presented(59),[{type:'pause'},{type:'seek',frame:59}]);p.presented(59);
  assert.equal(p.state().status,'ended');assert.deepEqual(p.presented(59),[]);
  assert.deepEqual(p.replay(),[{type:'pause'},{type:'seek',frame:44}]);
  assert.deepEqual(p.presented(59),[]);assert.deepEqual(p.presented(44),[{type:'play'}]);
});
test('pause, backward external seek, same-frame seek and exit cancel auto resume and freeze guards',()=>{
  const p=setup();p.continue(5);p.pause();assert.deepEqual(p.presented(32),[]);
  p.replay();assert.deepEqual(p.externalSeek(3),[{type:'pause'}]);p.presented(3);assert.equal(p.state().status,'paused');
  assert.deepEqual(p.externalSeek(46),[{type:'pause'},{type:'phase',phaseId:'c'}]);p.presented(46);
  p.replay();p.leave();assert.deepEqual(p.presented(44),[]);assert.equal(p.state().status,'inactive');assert.deepEqual(p.leave(),[],'later non-tactics navigation must not pause the ordinary player again');
});
