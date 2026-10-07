// Isolated experiment adapter: import the shipped document/geometry/renderer unchanged.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const moduleAt=name=>import(pathToFileURL(path.join(root,'engineering/tools/player-review',name)));
const {blankSession,exportReview}=await moduleAt('trajectory.mjs');
const {createTacticsDocument,validateDocument}=await moduleAt('tactics-document.mjs');
const {createManualAnnotation}=await moduleAt('tactics-manual-editor.mjs');
const {createCourtAnnotation}=await moduleAt('tactics-court-editor.mjs');
const {upsertTacticKeyframe}=await moduleAt('tactics-keyframes.mjs');
const {calibrationAt,project,COURT}=await moduleAt('court.mjs');
const {acceptCourtCandidates}=await moduleAt('calibration-guide.mjs');
const {compileProduction,renderProductionSvg,sampleProduction}=await moduleAt('tactics-production.mjs');
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const clip=JSON.parse(fs.readFileSync(request.clipPath,'utf8'));
const proposal=JSON.parse(fs.readFileSync(request.proposalPath,'utf8'));
if(!['A','B'].includes(request.mode))throw new Error('Mode must be A or B.');
if(proposal.outcome!=='candidate'||!proposal.route||!proposal.pause)throw new Error('No valid model tactic; no fabricated annotation will be made.');
const range=request.range,route=proposal.route;
const evidence=new Set(request.evidenceFrames);
if(!Number.isInteger(route.startFrame)||!Number.isInteger(route.endFrameExclusive)||route.startFrame<range.startFrame||route.endFrameExclusive>range.endFrameExclusive||route.startFrame>=route.endFrameExclusive||route.referenceFrame!==route.startFrame||proposal.pause.frame!==route.referenceFrame)throw new Error('Model range/reference/pause is inconsistent.');
if(!Array.isArray(route.points)||route.points.length!==4||route.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>clip.width||p.y<0||p.y>clip.height))throw new Error('Model video control points must be four bounded finite points.');
if(!evidence.has(route.referenceFrame)||!proposal.evidenceFrames.length||proposal.evidenceFrames.some(f=>!evidence.has(f)))throw new Error('Model evidence must come from actually supplied frames.');
if(!Number.isFinite(proposal.pause.holdSeconds)||proposal.pause.holdSeconds<.9||proposal.pause.holdSeconds>5)throw new Error('Pause is outside the experiment budget.');
const session=blankSession(clip.video_sha256);session.cuts=clip.sourceCuts??[];
let points=route.points,calibrationMeta=null;
if(request.mode==='B'){
  if(!request.calibrationPath)throw new Error('B blocked: no real calibration input.');
  const raw=JSON.parse(fs.readFileSync(request.calibrationPath,'utf8'));
  const hash=raw.videoSha256??raw.videoHash??raw.video_sha256;
  if(hash!==clip.video_sha256)throw new Error('B calibration video provenance does not match.');
  const calibration=structuredClone(raw.calibration??raw.courtCalibration??raw);
  let adoption=null;
  if(request.candidatePreview===true){
    adoption=acceptCourtCandidates(session,calibration,clip.frames.length,clip.video_sha256);
  }else session.courtCalibration=calibration;
  if(!Array.isArray(session.courtCalibration.keyframes)||!session.courtCalibration.keyframes.length)throw new Error('B has no actual calibration keyframes.');
  if(request.candidatePreview===true&&session.courtCalibration.keyframes.some(k=>k.projectionReviewedAt||k.reviewRequired!==true))throw new Error('Candidate preview must not create human review or remove reviewRequired.');
  fs.mkdirSync(request.outputDir,{recursive:true});
  fs.writeFileSync(path.join(request.outputDir,'derived-calibration.json'),JSON.stringify(session.courtCalibration,null,2));
  const map=calibrationAt(session.courtCalibration,route.referenceFrame,clip.frames,session.cuts);
  if(!map)throw new Error('B reference mapping rejected by the existing calibrationAt.');
  points=route.points.map(p=>project(map.toCourt,p.x,p.y));
  if(points.some(p=>!p||p.x<0||p.x>COURT.length||p.y<0||p.y>COURT.width))throw new Error('B route converts outside the NBA court; no clamping/fake H is allowed.');
  const missing=[];
  for(let f=route.startFrame;f<route.endFrameExclusive;f++)if(!calibrationAt(session.courtCalibration,f,clip.frames,session.cuts))missing.push(f);
  if(missing.length)throw new Error('B mapping gap: '+JSON.stringify(missing));
  calibrationMeta={referenceFrame:route.referenceFrame,referenceSupport:map.supportFrames,method:map.method,quality:raw.validation??raw.quality??null,
    status:request.candidatePreview===true?'candidate_preview':'supplied_calibration',adoption,
    rawCalibrationSha256:createHash('sha256').update(fs.readFileSync(request.calibrationPath)).digest('hex'),
    derivedCalibrationDigest:createHash('sha256').update(JSON.stringify(session.courtCalibration)).digest('hex'),
    rawNeedsReviewFrames:calibration.keyframes.filter(k=>k.status==='needs_review').length,
    reviewRequired:true,humanReview:false,metricAccuracyValidated:false};
}
const review=exportReview(session,clip,null,{allowEmpty:true});
let document=await createTacticsDocument(review);
document.title=`Isolated direct-video/court comparison ${request.mode}`;
document.notes=proposal.summary+'\n'+proposal.explanation+'\n'+proposal.pause.explanation+'\nNo human identity or metric-position accuracy is certified.';
Object.assign(document.playDefinition,{startFrame:range.startFrame,endFrameExclusive:range.endFrameExclusive});
Object.assign(document.playDefinition.phases[0],{startFrame:range.startFrame,endFrameExclusive:range.endFrameExclusive,freezeFrame:proposal.pause.frame,title:proposal.summary});
const input={id:'agent-route',type:'route',phaseId:'phase-1',entityId:null,frame:route.referenceFrame,
  range:{startFrame:route.startFrame,endFrameExclusive:route.endFrameExclusive},points,pattern:'solid',followEntity:false,
  name:'Agent generated observed short movement',style:{color:'#19c1eb',size:1.25},
  origin:{kind:'agent',jobId:request.modelJobId,sourceFrames:proposal.evidenceFrames,note:proposal.explanation}};
document=request.mode==='A'?createManualAnnotation(document,{...input,space:'video'}):createCourtAnnotation(document,input);
document=upsertTacticKeyframe(document,{id:'agent-explanation',kind:'explanation',frame:proposal.pause.frame,annotationIds:['agent-route'],freeze:true,holdSeconds:proposal.pause.holdSeconds});
await validateDocument(document);
const plan=compileProduction(document,{fps:30});
fs.mkdirSync(request.outputDir,{recursive:true});
fs.writeFileSync(path.join(request.outputDir,'document.json'),JSON.stringify(document,null,2));
fs.writeFileSync(path.join(request.outputDir,'plan.json'),JSON.stringify(plan,null,2));
const state=plan.frames.find(f=>f.state==='hold')??plan.frames[0];
fs.writeFileSync(path.join(request.outputDir,'pause-overlay.svg'),renderProductionSvg(document,state));
process.stdout.write(JSON.stringify({mode:request.mode,document,calibrationMeta,sourceRange:range,routeRange:input.range,sourceFrames:range.endFrameExclusive-range.startFrame,outputFrames:plan.totalFrames,duration:plan.duration??plan.totalFrames/plan.fps,
  coordinatePolicy:request.mode==='A'?'video fixed pixels; source-time progress; not continuous ground projection':'same model points converted at reference frame; current calibrationAt projects court points'}));
