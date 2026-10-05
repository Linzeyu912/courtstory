import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from './tactics-playback.mjs';

const phases=[{phaseId:'a',startFrame:0,endFrameExclusive:20,freezeFrame:5},{phaseId:'b',startFrame:20,endFrameExclusive:40,freezeFrame:24},{phaseId:'c',startFrame:40,endFrameExclusive:60,freezeFrame:44}];
function setup(){assert.equal(typeof module.createPhasePlayback,'function');const p=module.createPhasePlayback();p.configure(phases,'a');p.select('a');p.presented(5);return p;}
test('source location crosses pauses freely, stops at its interval and replay restores cue behavior',()=>{
  const p=setup();p.playSource(5);assert.deepEqual(p.presented(30),[{type:'phase',phaseId:'b'}]);
  p.replay();p.presented(24);assert.deepEqual(p.presented(45),[{type:'pause'},{type:'phase',phaseId:'c'},{type:'seek',frame:44}]);
  p.presented(44);p.playSource(44,50);assert.deepEqual(p.presented(58),[{type:'pause'},{type:'seek',frame:49}]);p.presented(49);assert.equal(p.state().status,'ended');
});
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

test('static annotation cues pause on the exact frame after a skipped presentation and continue forward once',()=>{
  const p=module.createPhasePlayback(),list=[{phaseId:'a',startFrame:0,endFrameExclusive:50,freezeFrame:0}];
  const cues=[{phaseId:'a',frame:12},{phaseId:'a',frame:12},{phaseId:'a',frame:25}];
  p.configure(list,'a',cues);p.select('a');p.presented(0);p.continue(0);
  assert.deepEqual(p.presented(20),[{type:'pause'},{type:'seek',frame:12}]);
  p.configure(list,'a',cues);assert.deepEqual(p.presented(20),[]);
  p.presented(12);assert.equal(p.state().status,'paused');
  assert.deepEqual(p.continue(12),[{type:'play'}]);assert.deepEqual(p.presented(12),[]);
  assert.deepEqual(p.presented(30),[{type:'pause'},{type:'seek',frame:25}]);p.presented(25);
  p.continue(25);assert.deepEqual(p.presented(49),[{type:'pause'},{type:'seek',frame:49}]);p.presented(49);
  assert.equal(p.state().status,'ended');
});

test('selection and replay start at the earliest cue and phase entry cues precede later freezes',()=>{
  const p=module.createPhasePlayback(),cues=[{phaseId:'a',frame:2},{phaseId:'b',frame:21},{phaseId:'b',frame:27}];
  p.configure(phases,'a',cues);assert.deepEqual(p.select('a'),[{type:'pause'},{type:'seek',frame:2}]);p.presented(2);p.continue(2);
  assert.deepEqual(p.presented(19),[{type:'pause'},{type:'seek',frame:5}]);p.presented(5);p.continue(5);
  assert.deepEqual(p.presented(35),[{type:'pause'},{type:'phase',phaseId:'b'},{type:'seek',frame:21}]);
  p.configure(phases,'b',cues);p.presented(21);p.continue(21);
  assert.deepEqual(p.presented(29),[{type:'pause'},{type:'seek',frame:24}]);p.presented(24);p.continue(24);
  assert.deepEqual(p.presented(29),[{type:'pause'},{type:'seek',frame:27}]);p.presented(27);
  assert.deepEqual(p.replay(),[{type:'pause'},{type:'seek',frame:21}]);
  assert.deepEqual(p.presented(21),[{type:'play'}]);
  assert.deepEqual(p.presented(30),[{type:'pause'},{type:'seek',frame:24}]);
});

test('backward seeks re-arm earlier cues, pause cancels replay, and leaving disarms cue stops',()=>{
  const p=module.createPhasePlayback();p.configure(phases,'a',[{phaseId:'a',frame:10},{phaseId:'a',frame:15}]);
  p.select('a');p.presented(5);p.continue(5);p.presented(18);p.presented(10);p.continue(10);
  assert.deepEqual(p.externalSeek(6),[{type:'pause'}]);p.presented(6);p.continue(6);
  assert.deepEqual(p.presented(18),[{type:'pause'},{type:'seek',frame:10}]);p.presented(10);
  p.replay();p.pause();assert.deepEqual(p.presented(5),[]);assert.equal(p.state().status,'paused');
  p.continue(5);p.leave();assert.deepEqual(p.presented(18),[]);assert.equal(p.state().status,'inactive');
});

test('invalid cues cannot create foreign or out-of-range seeks, and last-frame cues end once',()=>{
  const p=module.createPhasePlayback();p.configure([phases[0]],'a',[
    {phaseId:'missing',frame:1},{phaseId:'a',frame:-1},{phaseId:'a',frame:20},{phaseId:'a',frame:6.5},
    {phaseId:'a',frame:19},{phaseId:'a',frame:5}]);
  assert.deepEqual(p.select('a'),[{type:'pause'},{type:'seek',frame:5}]);p.presented(5);p.continue(5);
  assert.deepEqual(p.presented(22),[{type:'pause'},{type:'seek',frame:19}]);p.presented(19);
  assert.equal(p.state().status,'ended');assert.deepEqual(p.presented(19),[]);
});

test('a single long phase visits the real 676, 1082 and 1217 evidence frames even when playback jumps over them',()=>{
  const p=module.createPhasePlayback(),list=[{phaseId:'phase-1',startFrame:0,endFrameExclusive:1489,freezeFrame:0}];
  p.configure(list,'phase-1',[0,0,676,1082,1217].map(frame=>({phaseId:'phase-1',frame})));
  p.select('phase-1');p.presented(0);p.continue(0);
  for(const [presented,expected] of [[800,676],[1200,1082],[1300,1217],[1488,1488]]){
    assert.deepEqual(p.presented(presented),[{type:'pause'},{type:'seek',frame:expected}]);
    if(presented!==expected)assert.deepEqual(p.presented(presented),[]);
    p.presented(expected);assert.equal(p.state().status,expected===1488?'ended':'paused');
    if(expected!==1488){assert.deepEqual(p.continue(expected),[{type:'play'}]);assert.deepEqual(p.presented(expected),[]);}
  }
});
