// Read-only audit of the real browser functions. Candidates are accepted only
// into an isolated in-memory preview, never into a person's saved draft.
import fs from 'node:fs';
import path from 'node:path';
import {blankSession,buildTrajectories,exportReview} from '../tools/player-review/trajectory.mjs';
import {initializeAutomaticAnnotations,automaticAnnotationPointVisible} from '../tools/player-review/automatic-annotations.mjs';
import {acceptCourtCandidates} from '../tools/player-review/calibration-guide.mjs';
import {calibrationAt,project,COURT} from '../tools/player-review/court.mjs';
import {courtMarkings} from '../tools/player-review/court-geometry.mjs';
import {selectGroundComparison} from '../tools/player-review/ground-position.mjs';

const [configPath,outputDir]=process.argv.slice(2);
if(!configPath||!outputDir)throw Error('Usage: node audit_workbench_pipeline.mjs CONFIG.json OUTPUT_DIR');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const write=(p,data)=>fs.writeFileSync(p,JSON.stringify(data));
const config=read(configPath);fs.mkdirSync(outputDir,{recursive:true});
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const inside=p=>finite(p)&&p.x>=0&&p.x<=COURT.length&&p.y>=0&&p.y<=COURT.width;
const ratio=(n,d)=>({count:n,total:d,percent:d?100*n/d:null});
const counts=items=>items.reduce((out,key)=>(out[key]=(out[key]||0)+1,out),{});
function gaps(valid,frames){
  const result=[];let start=null;
  for(let i=0;i<=valid.length;i++){
    if(i<valid.length&&!valid[i]){start??=i;continue;}
    if(start!=null){result.push({start,end:i-1,frames:i-start,seconds:frames[i-1].time-frames[start].time});start=null;}
  }
  return result.sort((a,b)=>b.frames-a.frames);
}
function distribution(values){
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length)return {count:0,median:null,p95:null,max:null};
  return {count:sorted.length,median:sorted[Math.floor((sorted.length-1)*.5)],p95:sorted[Math.floor((sorted.length-1)*.95)],max:sorted.at(-1)};
}
const output={schemaVersion:1,generatedAt:new Date().toISOString(),groundTruthAvailable:false,
  notes:['Detection availability is not visible-object recall or identity accuracy.',
    'In-memory machine calibration preview; no saved draft is changed.',
    'Offline full-court results are reported separately from the browser mapping.',
    'Frame coverage with one point does not measure coverage of all people.'],cases:[]};
for(const spec of config.cases){
  const clip=read(spec.payload),snapshot=JSON.stringify(clip),frames=clip.frames,n=frames.length;
  const session=blankSession(clip.video_sha256);session.cuts=[...(clip.sourceCuts||[])];
  session.liveSelection=structuredClone(clip.liveSelection||null);
  const initialization=initializeAutomaticAnnotations(session,clip);
  const accepted=clip.courtCandidates?acceptCourtCandidates(session,clip.courtCandidates,n,clip.video_sha256):null;
  const maps=frames.map((_,i)=>calibrationAt(session.courtCalibration,i,frames,session.cuts));
  const review=exportReview(session,clip,null,{allowEmpty:true});
  const image=buildTrajectories(session,frames,clip.sourceCuts||[]);
  const people=frames.map(row=>row.tracks.filter(t=>t[6]===2));
  const visible=frames.map((_,i)=>Object.entries(image).filter(([id,p])=>automaticAnnotationPointVisible(clip,i,p[i])));
  const allCourt=review.entities.flatMap(e=>e.courtTrajectory);
  const mapped=frames.map((_,i)=>review.entities.filter(e=>automaticAnnotationPointVisible(clip,i,image[e.id][i])&&finite(e.courtTrajectory[i])));
  const inBounds=mapped.map((entities,i)=>entities.filter(e=>inside(e.courtTrajectory[i])));
  const selectedBall=review.sceneObjects.basketballTrajectory;
  const ballObserved=frames.map(f=>(f.objects||[]).some(o=>o.kind==='basketball'));
  const rawTrackIds=new Set(people.flatMap(rows=>rows.map(t=>t[4])));
  const outside=allCourt.filter(p=>finite(p)&&p.outsideCourt);
  const mappingRoundtrip=[];
  for(let i=0;i<n;i++)for(const t of people[i]){
    const x=(t[0]+t[2])/2,y=t[3],q=maps[i]&&project(maps[i].toCourt,x,y),r=q&&project(maps[i].toImage,q.x,q.y);
    if(r)mappingRoundtrip.push(Math.hypot(r.x-x,r.y-y));
  }
  const entry={id:spec.id,sample:spec.sample,video:spec.video,frames:n,durationSeconds:frames.at(-1).time,
    videoSha256:clip.video_sha256,trackingRawFingerprint:clip.tracking_raw_fingerprint,initialization,
    ball:{observations:ratio(ballObserved.filter(Boolean).length,n),selected:ratio(selectedBall.filter(finite).length,n),
      longestMissing:gaps(ballObserved,frames).slice(0,5),selectionSources:counts(selectedBall.map(p=>p.source)),
      observationSource:review.sceneObjects.observationSource,
      courtStates:counts(review.ballCourtTrajectory.map(p=>p.state)),
      metricPositions:review.ballCourtTrajectory.filter(p=>p.metricPositionAvailable).length,
      displayProxies:review.ballCourtTrajectory.filter(p=>p.positionKind==='possession_proxy').length},
    person:{rawObservations:people.reduce((sum,a)=>sum+a.length,0),distinctTrackIds:rawTrackIds.size,
      rawPerFrame:distribution(people.map(a=>a.length)),framesWithRaw:people.filter(a=>a.length).length,
      automaticallyBoundVisibleObservations:visible.reduce((sum,a)=>sum+a.length,0),
      automaticFramesWithAny:ratio(visible.filter(a=>a.length).length,n),visiblePerFrame:distribution(visible.map(a=>a.length)),
      perPlayer:review.entities.map(e=>({id:e.id,sources:counts(e.trajectory.map(p=>p.source)),
        visible:visible.filter(a=>a.some(([id])=>id===e.id)).length,
        longestInvisible:gaps(frames.map((_,i)=>automaticAnnotationPointVisible(clip,i,image[e.id][i])),frames).slice(0,3)}))},
    court:{accepted,usableMatrices:ratio(maps.filter(Boolean).length,n),longestMissing:gaps(maps.map(Boolean),frames).slice(0,5),
      roundtripNumericalErrorPixels:distribution(mappingRoundtrip),metricAccuracyValidated:false},
    mapping:{framesWithAnyMappedPlayer:ratio(mapped.filter(a=>a.length).length,n),
      framesWithAnyInBoundsPlayer:ratio(inBounds.filter(a=>a.length).length,n),
      visibleObservationsMapped:ratio(mapped.reduce((sum,a)=>sum+a.length,0),visible.reduce((sum,a)=>sum+a.length,0)),
      outsideCourtObservations:outside.length,allCourtSources:counts(allCourt.map(p=>p.source)),
      frameOutcomeCounts:counts(frames.map((_,i)=>!people[i].length?'no_raw_person':!visible[i].length?'no_visible_bound_identity':!maps[i]?'no_matrix':!inBounds[i].length?'all_bound_points_outside_court':'in_bounds_marker')),
      longestNoInBoundsPlayer:gaps(inBounds.map(a=>a.length>0),frames).slice(0,5)},pose:[]};
  for(const filename of spec.pose||[]){
    const data=read(filename),copy=structuredClone(session);
    try{
      selectGroundComparison(copy,clip,data);
      const compared=exportReview(copy,clip,null,{allowEmpty:true}),points=compared.entities.flatMap(e=>e.courtTrajectory);
      const proposals=points.filter(p=>p.footMethod==='pose_ground_proposal');
      entry.pose.push({model:data.model,compatible:true,sampledFrames:data.frames.length,
        candidateObservations:data.frames.reduce((sum,r)=>sum+r.people.filter(p=>p.anchor).length,0),
        used:proposals.length,fallback:points.filter(p=>p.groundCandidateMissing).length,
        rawToFootPixelDistance:distribution(proposals.map(p=>Math.hypot(p.imagePoint[0]-p.rawImagePoint[0],p.imagePoint[1]-p.rawImagePoint[1]))),
        groundContactConfirmed:false,accuracyValidated:false});
    }catch(error){entry.pose.push({model:data.model,compatible:false,error:error.message});}
  }
  let offline=null;
  if(spec.offlineCalibration){
    offline=read(spec.offlineCalibration);
    if(offline.videoHash!==clip.video_sha256||offline.frames.length!==n)throw Error('Offline calibration mismatch');
    const counts=offline.frames.map((f,i)=>people[i].filter(t=>inside(project(f.imageToCourt,(t[0]+t[2])/2,t[3]))).length);
    const bound=offline.frames.map((f,i)=>visible[i].filter(([id,points])=>inside(project(f.imageToCourt,points[i].x,points[i].y))).length);
    entry.offlineCourt={source:spec.offlineCalibration,usableMatrices:ratio(offline.frames.filter(f=>f.imageToCourt).length,n),
      rawFramesWithAnyInBounds:ratio(counts.filter(Boolean).length,n),metricAccuracyValidated:false,
      boundFramesWithAnyInBounds:ratio(bound.filter(Boolean).length,n),
      integratedIntoWorkbench:false,physicalEndIdentityVerified:offline.physicalEndIdentityVerified};
  }
  const rendered=frames.map((row,i)=>({frame:i,time:row.time,tracks:people[i],ball:selectedBall[i],
    nativeImageToCourt:maps[i]?.toCourt||null,nativeCourtToImage:maps[i]?.toImage||null,
    offlineImageToCourt:offline?.frames[i]?.imageToCourt||null,offlineCourtToImage:offline?.frames[i]?.courtToImage||null,
    players:review.entities.map(e=>({id:e.id,image:image[e.id][i],court:e.courtTrajectory[i],visible:automaticAnnotationPointVisible(clip,i,image[e.id][i])}))}));
  write(path.join(outputDir,spec.id+'-frames.json'),{video:spec.video,width:clip.width,height:clip.height,markings:courtMarkings(),frames:rendered});
  if(JSON.stringify(clip)!==snapshot)throw Error('Source payload mutated');
  entry.rawPreserved=true;output.cases.push(entry);
  console.log(JSON.stringify({id:entry.id,ball:entry.ball.observations,player:entry.person.automaticFramesWithAny,court:entry.court.usableMatrices,mapping:entry.mapping.framesWithAnyInBoundsPlayer}));
}
write(path.join(outputDir,'summary.json'),output);
