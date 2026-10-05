// Synthetic test evidence only; never used as a real-video fallback.
import {makePresentationDemo} from '../tactical-overlay/fixtures/presentation-demo.mjs';
import {blankSession,exportReview} from './trajectory.mjs';
import {buildCourtPreparation} from './court-preparation.mjs';
import {createTacticsDocument} from './tactics-document.mjs';
export async function makeV2Fixture(){
  const {review}=await makePresentationDemo();
  const clip={video_sha256:'a'.repeat(64),tracking_fingerprint:review.trackingFingerprint,tracking_revision:review.trackingRevision,width:review.width,height:review.height,mediaEndTime:6.1,
    frames:review.sourceFrameMapping.map(f=>({...f,tracks:review.entities.map((e,i)=>{const p=e.trajectory[f.frame];return [p.x-8,p.y-35,p.x+8,p.y,i+1,.95,0];})}))};
  const session=blankSession(clip.video_sha256);session.courtCalibration=review.court.calibration;session.maxGapSeconds=0;
  for(const [i,e] of review.entities.entries())session.entities[i].bindings=[{kind:'track',trackId:i+1,start:0,end:60}];
  session.courtPreparation=buildCourtPreparation({session,clip});
  return {session,clip,document:await createTacticsDocument(exportReview(session,clip,null,{allowEmpty:true}))};
}
