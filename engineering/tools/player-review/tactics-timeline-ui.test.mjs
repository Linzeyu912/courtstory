import test from 'node:test';
import assert from 'node:assert/strict';
import {rangeFromSeconds,rangeToSeconds} from './tactics-time-range.mjs';
test('timeline boundaries round-trip aligned PTS and preserve the original source mapping',()=>{
  const m=[0,.1,3,3.3,4,4.999,5,5.9].map((time,frame)=>({frame,time,sourceTime:time+30,sourceFrame:frame+700})),before=structuredClone(m);
  const r=rangeFromSeconds(m,{startSeconds:3,endSeconds:5,durationSeconds:6.2});assert.deepEqual(rangeToSeconds(m,r,6.2),{startSeconds:3,endSeconds:5});assert.deepEqual(m,before);
});
