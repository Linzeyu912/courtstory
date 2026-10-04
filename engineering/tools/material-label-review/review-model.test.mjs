import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyReview,confirmRemaining,setVerdict,completionProblem,issueCount,nextPending,reviewQueue,appliedReview} from './review-model.mjs';
const clip={clip_id:'a',label_fingerprint:'labels-v1',video_sha256:'video-v1',fields:[{key:'zoom'},{key:'blur'},{key:'source'}]};

test('sample navigation uses only its forty clips and counts applied completed reviews',()=>{
  const all=Array.from({length:175},(_,i)=>({clip_id:String(i)}));
  const sample={clip_ids:all.slice(20,60).map(c=>c.clip_id)};
  const queue=reviewQueue(all,sample);
  assert.equal(queue.length,40);assert.equal(reviewQueue(all,sample,'all').length,175);
  const summaries=Object.fromEntries(queue.slice(0,11).map(c=>[c.clip_id,{status:'completed',stale:false,applied:{}}]));
  assert.equal(nextPending(queue,summaries,0),11);
  assert.equal(queue[nextPending(queue,summaries,39)].clip_id,'31');
});

test('applied display projects resolved items without changing the original human review',()=>{
  let old=setVerdict(emptyReview(clip),'zoom','incorrect',2);
  old.evaluations.zoom.comment='没有推拉';old.status='completed';old.revision=3;
  const current=appliedReview({...clip,label_fingerprint:'labels-v2'},old,{resolved_keys:['zoom']});
  assert.equal(current.evaluations.zoom.verdict,'correct');
  assert.equal(current.label_fingerprint,'labels-v2');assert.equal(current.revision,3);
  assert.equal(old.evaluations.zoom.verdict,'incorrect');assert.equal(old.evaluations.zoom.comment,'没有推拉');
});

test('one-click confirmation preserves existing corrections and uncertainty',()=>{
  let review=emptyReview(clip);
  review=setVerdict(review,'zoom','incorrect',2.5);
  review.evaluations.zoom.comment='横向移动，不是推拉';
  review=setVerdict(review,'blur','unsure',3);
  const confirmed=confirmRemaining(review);
  assert.equal(confirmed.evaluations.zoom.verdict,'incorrect');
  assert.equal(confirmed.evaluations.zoom.comment,'横向移动，不是推拉');
  assert.equal(confirmed.evaluations.blur.verdict,'unsure');
  assert.equal(confirmed.evaluations.source.verdict,'correct');
  assert.equal(issueCount(confirmed),2);
  assert.equal(review.evaluations.source.verdict,'pending');
});

test('a segment is complete only after labels and retention have been reviewed',()=>{
  let review=emptyReview(clip);
  assert.match(completionProblem(review),/3 项/);
  review=confirmRemaining(review);
  assert.match(completionProblem(review),/保留、丢弃/);
  review.retention.decision='discard';
  review=setVerdict(review,'zoom','incorrect',1);
  assert.equal(completionProblem(review),null);
});

test('next pending includes stale reviews and wraps without skipping unreviewed clips',()=>{
  const clips=[{clip_id:'a'},{clip_id:'b'},{clip_id:'c'}];
  const summaries={a:{status:'completed'},b:{status:'completed'},c:{status:'completed',stale:true}};
  assert.equal(nextPending(clips,summaries,0),2);
  assert.equal(nextPending(clips,{a:{status:'draft'},b:{status:'completed'},c:{status:'completed'}},2),0);
  assert.equal(nextPending(clips,{a:{status:'completed'},b:{status:'completed'},c:{status:'completed'}},2),null);
});
