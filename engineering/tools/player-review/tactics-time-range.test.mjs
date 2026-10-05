import test from 'node:test';
import assert from 'node:assert/strict';
import {rangeFromSeconds,rangeToSeconds,sourceProgress,frameRangeToInclusive} from './tactics-time-range.mjs';
const mapping=times=>times.map((time,frame)=>({frame,time,sourceFrame:frame+100,sourceTime:time+10}));
test('3–5 seconds selects by PTS for 59.94, 25 and irregular frames',()=>{
  for(const m of [mapping(Array.from({length:360},(_,i)=>i*1001/60000)),mapping(Array.from({length:150},(_,i)=>i/25)),mapping([0,.2,2.99,3,3.13,4,4.99,5,5.4])]){
    const r=rangeFromSeconds(m,{startSeconds:3,endSeconds:5,durationSeconds:6});
    assert.deepEqual(m.slice(r.startFrame,r.endFrameExclusive),m.filter(p=>p.time>=3&&p.time<5));
    assert.deepEqual(frameRangeToInclusive(m,r),{start:r.startFrame,end:r.endFrameExclusive-1});
  }
});
test('non-uniform progress and decoded end sentinel use source time',()=>{
  const m=mapping([0,3,3.1,4,4.8,5]);const r=rangeFromSeconds(m,{startSeconds:3,endSeconds:5,durationSeconds:5.7});
  assert.equal(sourceProgress(m,r,3,5.7),.5);
  assert.equal(rangeToSeconds(m,{startFrame:5,endFrameExclusive:6},5.7).endSeconds,5.7);
  assert.equal(rangeToSeconds(m,r,5.7).endSeconds,5);
});
test('invalid mapping, unavailable end, inverted, empty and out-of-bounds ranges fail',()=>{
  const m=mapping([0,1,3,5]);
  for(const [s,e,d] of [[3,3,6],[5,3,6],[-1,2,6],[0,7,6],[1.1,2,6],[0,3,null]])assert.throws(()=>rangeFromSeconds(m,{startSeconds:s,endSeconds:e,durationSeconds:d}));
  assert.throws(()=>rangeFromSeconds(mapping([0,1,1]),{startSeconds:0,endSeconds:2,durationSeconds:3}));
});
