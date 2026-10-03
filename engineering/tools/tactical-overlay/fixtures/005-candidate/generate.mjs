import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {blankSession,exportReview} from '../../../player-review/trajectory.mjs';
import {acceptCourtCandidates} from '../../../player-review/calibration-guide.mjs';
import {createSourceBinding} from '../../binding.mjs';
import {makePresentationDemo} from '../presentation-demo.mjs';

export const repositoryRoot=fileURLToPath(new URL('../../../../../',import.meta.url));
const annotationURL=new URL('../../../../../data/tactics/005-candidate/annotation.json',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const parse=bytes=>JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));

/** Read-only adapter. These local IDs never enter a browser session or a formal draft. */
export async function makeCandidateFixture({repoRoot=repositoryRoot}={}) {
  const annotationBytes=await readFile(annotationURL),annotation=parse(annotationBytes);
  const entries=await Promise.all(Object.entries(annotation.sourceFiles).map(async([kind,file])=>{
    const bytes=await readFile(path.resolve(repoRoot,file)),actual=sha(bytes);
    const approved=annotation.sourceHashes[file];
    // Git may check text out with CRLF. Accept only an exact LF/CRLF equivalent
    // of the locked bytes; bind the actual local bytes in the generated review.
    const lf=kind==='video'?bytes:Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
    if(actual!==approved&&(kind==='video'||(sha(lf)!==approved&&sha(Buffer.from(lf.toString('utf8').replace(/\n/g,'\r\n')))!==approved)))throw new Error(`005 source hash mismatch: ${file}`);
    return [kind,{file,sha256:actual,approvedSha256:approved,lineEndingOnly:actual!==approved,data:kind==='video'?null:parse(bytes)}];
  }));
  const sources=Object.fromEntries(entries),frames=sources.tracks.data,court=sources.court.data,feet=sources.feet.data;
  if(frames.length!==143||frames.some((f,i)=>f.frame!==i||!Number.isFinite(f.time)))throw new Error('005 frame mapping mismatch');
  if(court.videoHash!==sources.video.sha256||feet.videoHash!==sources.video.sha256||
    court.trackingFingerprint!==sources.tracks.sha256||feet.trackingFingerprint!==sources.tracks.sha256)throw new Error('005 candidate source binding mismatch');
  const session=blankSession(sources.video.sha256);
  session.entities=annotation.participants.map(p=>({id:p.id,name:p.displayName,role:'player',anchors:[],
    identityKeyframes:[],bindings:[],modelBindings:p.bindings.map(b=>({kind:'track',trackId:b.trackId,
      start:b.startFrame,end:b.endFrameExclusive-1,method:'assistant_visual_inspection',
      identityConfirmed:false,reviewRequired:true,source:'upstream_supplied'})),
    observationNote:p.note,reviewStatus:'needs_review'}));
  const sourceCalibrationCounts={needs_review:0,invalid:0};
  for(const key of court.keyframes)sourceCalibrationCounts[key.status]=(sourceCalibrationCounts[key.status]??0)+1;
  const adopted=acceptCourtCandidates(session,{...court,keyframes:court.keyframes.map(key=>({...structuredClone(key),originalStatus:key.status}))},143,sources.video.sha256);
  if(adopted.accepted!==139||adopted.invalid!==4)throw new Error('005 calibration profile changed');
  const clip={video_sha256:sources.video.sha256,source_video_sha256:sources.video.sha256,
    tracking_fingerprint:sources.tracks.sha256,tracking_revision:'005-ebard-locked-candidate-v1',width:1920,height:1080,frames,sourceCuts:[]};
  // exportReview can contain optional undefined fields. The explicit JSON boundary is part of the public input contract.
  const review=JSON.parse(JSON.stringify(exportReview(session,clip,null)));
  review.synthetic=false;
  review.court.referenceId='005-ebard-f0-candidate-reference';
  review.court.calibration.referenceAdoption={scope:'isolated_tactical_preview',source:'upstream_supplied',
    method:'acceptCourtCandidates',humanConfirmed:false,reviewRequired:true,originalStatusesPreserved:true};
  for(const entity of review.entities)for(const point of entity.trajectory)if(point.source==='tracked')point.groundContactConfirmed=false;
  review.candidateProvenance={annotationSha256:sha(annotationBytes),observationRecord:annotation.observationRecord,
    sources:entries.map(([kind,value])=>({kind,path:value.file,sha256:value.sha256})),
    method:'assistant_visual_inspection',sampledFrames:annotation.reviewEvidence.reviewedFrames,
    allFramesManuallyVerified:false,metricAccuracyValidated:false,footPosition:'bbox_bottom_center_unverified_proxy'};
  const proof=(domain,{entityId=null,actionId=null,relationId=null,startFrame=0,endFrameExclusive=143,sourceFrames=annotation.reviewEvidence.reviewedFrames}={})=>({
    domain,entityId,actionId,relationId,startFrame,endFrameExclusive,sourceFrames,
    reviewer:annotation.reviewEvidence.reviewer,method:'assistant_visual_inspection',conclusion:'needs_review'});
  const actions=annotation.actions.map(a=>({...a,source:'upstream_supplied'}));
  const relations=annotation.relations.map(r=>({id:r.relationId,actionId:r.actionId,screenerId:r.screenerId,
    beneficiaryId:r.beneficiaryId,defenderId:r.defenderIds[0]??null,startFrame:r.startFrame,endFrameExclusive:r.endFrameExclusive,
    position:null,orientation:null,source:'upstream_supplied',reviewStatus:'needs_review',
    imagePositionCandidate:r.imagePositionCandidate,evidenceFrames:r.evidenceFrames,note:r.note}));
  const playDefinition={schemaVersion:1,synthetic:false,playId:annotation.playId,revision:1,
    ...annotation.playRange,sourceBinding:await createSourceBinding(review),
    participants:annotation.participants.map(p=>({id:p.id,name:p.displayName,role:p.role})),
    phases:annotation.phases.map((p,order)=>({...p,order})),actions,relations,
    reviewEvidence:[proof('calibration'),...annotation.participants.flatMap(p=>['identity','position','continuity'].map(domain=>proof(domain,{entityId:p.id}))),
      ...actions.map(a=>proof('tactic',{actionId:a.actionId,startFrame:a.startFrame,endFrameExclusive:a.endFrameExclusive,sourceFrames:a.evidenceFrames})),
      ...relations.map(r=>proof('tactic',{actionId:r.actionId,relationId:r.id,startFrame:r.startFrame,endFrameExclusive:r.endFrameExclusive,sourceFrames:r.evidenceFrames}))]};
  const audit={sourceHashes:Object.fromEntries(entries.map(([,v])=>[v.file,v.sha256])),annotationSha256:sha(annotationBytes),
    sourceCalibrationCounts,invalidCalibrationFrames:court.keyframes.filter(k=>k.status==='invalid').map(k=>k.frame),
    isolatedReferenceAdoption:adopted,sampledFrames:annotation.reviewEvidence.reviewedFrames,
    fullResolutionFramesViewed:annotation.reviewEvidence.fullResolutionFramesViewed,
    bindingIntervals:annotation.participants.flatMap(p=>p.bindings.map(b=>({entityId:p.id,...b}))),
    unresolvedRanges:annotation.participants.map(p=>({entityId:p.id,ranges:p.unresolvedRanges})),
    allFramesManuallyVerified:false,metricAccuracyValidated:false,identityAccuracyValidated:false,
    groundPointAccuracyValidated:false,tacticalGroundTruthValidated:false};
  return {review,playDefinition,audit};
}

async function saveJSON(file,value) {
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=`${file}.${randomUUID()}.tmp`;
  await writeFile(temporary,`${JSON.stringify(value,null,2)}\n`,{encoding:'utf8',flag:'wx'});
  await rename(temporary,file);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  if(process.argv.length!==2)throw new Error('This fixture generator takes no arguments; inputs and output roots are fixed to the repository.');
  const actual=await makeCandidateFixture(),synthetic=await makePresentationDemo();
  const base=path.join(repositoryRoot,'artifacts/tactical-overlay-preview');
  for(const [name,fixture] of [['real-input',actual],['synthetic-input',synthetic]]) {
    await saveJSON(path.join(base,name,'review.json'),fixture.review);
    await saveJSON(path.join(base,name,'play.json'),fixture.playDefinition);
    if(fixture.audit)await saveJSON(path.join(base,name,'audit.json'),fixture.audit);
  }
  console.log(JSON.stringify({outputRoot:base,real:{frames:143,participants:6,actions:14,phases:3,quality:'needs_review'},synthetic:{phases:synthetic.playDefinition.phases.length}}));
}
