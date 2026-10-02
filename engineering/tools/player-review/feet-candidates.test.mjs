import test from 'node:test';
import assert from 'node:assert/strict';
import {feetForPoint,footCandidateAnchor} from './feet-candidates.mjs';
import {blankSession,exportReview} from './trajectory.mjs';
import {confirmIdentity} from './identity-timeline.mjs';
const point={frame:0,x:20,y:90,box:[10,10,30,90],trackId:7,source:'tracked',footMethod:'bbox_bottom_center'};
const clip={video_sha256:'v',tracking_fingerprint:'f',width:100,height:100,frames:[{frame:0,time:0,tracks:[[10,10,30,90,7,.9,2]]}],feetCandidates:{source:'rtmpose_s_halpe26',videoHash:'v',trackingFingerprint:'f',frames:[{frame:0,feet:[{trackId:7,left:{x:15,y:88,score:.8},right:null}]}]}};
test('feet candidates require matching video, detector fingerprint, frame, and temporary identity',()=>{
 assert.ok(feetForPoint(clip,0,point));assert.equal(feetForPoint(clip,0,{...point,trackId:8}),null);assert.equal(feetForPoint({...clip,tracking_fingerprint:'other'},0,point),null);assert.equal(feetForPoint(clip,1,point),null);
});
test('adopting one foot keeps manual intent and model provenance without confirming contact',()=>{
 const candidate=feetForPoint(clip,0,point),anchor=footCandidateAnchor(point,0,candidate,'left',100,100);assert.equal(anchor.x,15);assert.equal(anchor.groundContactConfirmed,false);assert.equal(anchor.footCandidate.source,'rtmpose_s_halpe26');assert.equal(point.x,20);assert.throws(()=>footCandidateAnchor(point,0,candidate,'right',100,100));
 const session=blankSession('v');confirmIdentity(session,'P1',0,{box:point.box,trackId:7},clip.frames);session.entities[0].anchors=[anchor];const output=exportReview(session,clip,'now');assert.equal(output.entities[0].trajectory[0].groundContactConfirmed,false);assert.equal(output.entities[0].trajectory[0].footCandidate.contactState,'unknown');
});
