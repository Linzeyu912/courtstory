import test from 'node:test';
import assert from 'node:assert/strict';
import {editImageAnchor,dragImageEdit} from './image-edit.mjs';
import {blankSession,buildTrajectories,exportReview} from './trajectory.mjs';
const point={x:30,y:80,trackId:7,box:[20,20,40,80],footMethod:'bbox_bottom_center'};
test('a foot edit keeps identity, original box and other frames in exported data',()=>{
  const session=blankSession('clip');const records=[0,1,2].map(frame=>({frame,time:frame/30,tracks:[[20,20,40,80,7,.9,0]]}));
  session.entities[0].anchors=[{frame:0,...point}];
  const anchor=editImageAnchor(point,1,{x:35,y:78},100,100);session.entities[0].anchors.push(anchor);
  const out=exportReview(session,{video_sha256:'clip',width:100,height:100,frames:records},'now');
  assert.equal(out.entities[0].trajectory[1].footMethod,'human_image_anchor');
  assert.equal(out.entities[0].trajectory[1].trackId,7);assert.equal(out.entities[0].trajectory[2].x,30);
  assert.deepEqual(out.entities[0].trajectory[1].detectorBox,point.box);assert.deepEqual(point.box,[20,20,40,80]);
  assert.equal(editImageAnchor(point,1,{x:35,y:78,box:point.box},100,100).boxMethod,'detector');
});
test('box translation clamps at image edges and keeps foot displacement consistent',()=>{
  const edit=dragImageEdit(point,'box',{x:20,y:20},{x:-40,y:80},100,100);
  assert.deepEqual(edit,{box:[0,40,20,100],x:10,y:100});
  assert.equal(editImageAnchor(point,0,edit,100,100).boxMethod,'human_image_box');
});
test('resizing preserves an independently confirmed foot and rejects invalid input',()=>{
  const manual={...point,footMethod:'human_image_anchor'};
  const edit=dragImageEdit(manual,'corner2',{x:40,y:80},{x:50,y:90},100,100);
  assert.deepEqual(edit,{box:[20,20,50,90]});
  assert.equal(editImageAnchor(manual,1,edit,100,100).y,80);
  assert.throws(()=>editImageAnchor(point,1,{box:[50,20,30,80]},100,100));
  assert.throws(()=>editImageAnchor(point,1,{x:NaN},100,100));
});
