import test from 'node:test';
import assert from 'node:assert/strict';
import {manualPathAnchors} from './manual-path.mjs';
import {blankSession,buildTrajectories,exportReview} from './trajectory.mjs';
import {editImageAnchor} from './image-edit.mjs';
const frames=[0,.1,.4,.5].map((time,frame)=>({frame,time,tracks:[],source_frame:frame+20,source_time:time+3}));
const missing=frames.map(()=>({source:'missing'}));
test('drawn path uses actual timestamps and marks its timing assumption',()=>{
  const anchors=manualPathAnchors([{x:0,y:0},{x:50,y:0},{x:50,y:50}],0,3,frames,missing);
  assert.equal(anchors[1].x,20);assert.equal(anchors[2].x,50);assert.equal(anchors[2].y,30);
  assert.equal(anchors[2].source,'manual_path');assert.equal(anchors[2].reviewRequired,true);
});
test('drawn path preserves observed, conflicting and out-of-view frames',()=>{
  const points=missing.map((p,i)=>i===1?{source:'tracked'}:i===2?{source:'conflict'}:i===3?{source:'out_of_view'}:p);
  assert.deepEqual(manualPathAnchors([{x:10,y:10},{x:20,y:20}],0,3,frames,points).map(a=>a.frame),[0]);
  assert.throws(()=>manualPathAnchors([{x:10,y:10},{x:20,y:20}],0,3,frames,frames.map(()=>({source:'tracked'}))));
});
test('drawn paths cannot bridge removed footage or invalid time spans',()=>{
  assert.throws(()=>manualPathAnchors([{x:10,y:10},{x:20,y:20}],0,3,frames,missing,[2]));
  assert.throws(()=>manualPathAnchors([{x:10,y:10}],0,3,frames,missing));
  assert.throws(()=>manualPathAnchors([{x:10,y:10},{x:20,y:20}],2,1,frames,missing));
});
test('export keeps source mapping and unverified paths; confirming one frame does not confirm the rest',()=>{
  const session=blankSession('cut');session.entities[0].anchors=manualPathAnchors([{x:10,y:10},{x:30,y:30}],0,3,frames,missing);
  session.liveSelection={method:'manual_retained_frame_ranges'};
  const clip={video_sha256:'cut',source_video_sha256:'root',width:100,height:100,frames};
  let output=exportReview(session,clip,'now');assert.equal(output.sourceVideoSha256,'root');assert.equal(output.sourceFrameMapping[1].sourceFrame,21);
  assert.deepEqual(output.entities[0].unverifiedPathFrames,[0,1,2,3]);assert.equal(output.allFramesManuallyVerified,false);
  const anchor=editImageAnchor(buildTrajectories(session,frames).P1[1],1,{x:13,y:13},100,100);
  session.entities[0].anchors=session.entities[0].anchors.filter(a=>a.frame!==1).concat(anchor);
  output=exportReview(session,clip,'now');assert.equal(output.entities[0].trajectory[1].source,'manual');assert.deepEqual(output.entities[0].unverifiedPathFrames,[0,2,3]);
});
