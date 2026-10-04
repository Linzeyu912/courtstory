// Export exactly the browser's mapping, without accepting candidates in a draft.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {calibrationAt} from '../tools/player-review/court.mjs';
import {courtMarkings} from '../tools/player-review/court-geometry.mjs';
import {acceptCourtCandidates} from '../tools/player-review/calibration-guide.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {values,positionals}=parseArgs({options:{'candidate-root':{type:'string'}},allowPositionals:true});
const output=positionals[0];if(!output||positionals.length!==1)throw Error('Provide a separate output JSON path and optional --candidate-root');
const library=JSON.parse(fs.readFileSync(path.join(root,'data/videos/tactics/acceptance/review-library.json'))),result={markings:courtMarkings(),samples:{}};
for(const id of ['004','005','006']){
 const sample=library.samples.find(s=>s.id===id),frames=JSON.parse(fs.readFileSync(path.join(root,sample.trackingVariants.find(v=>v.id==='ebard').tracks)));
 const source=values['candidate-root']?path.join(values['candidate-root'],id+'.json'):
   id==='005'?'artifacts/court-occlusion-20261004/refined-005.json':sample.courtCandidates;
 const calibration=JSON.parse(fs.readFileSync(path.join(root,source))),preview={courtCalibration:null};
 // A private in-memory preview, never written to the review session or source file.
 acceptCourtCandidates(preview,calibration,frames.length,calibration.videoHash);
 result.samples[id]={source,reviewStatus:'machine_preview_not_human_confirmed',videoHash:calibration.videoHash,frames:frames.map((r,i)=>{
   const map=calibrationAt(preview.courtCalibration,i,frames,[]);
   return {frame:i,time:r.time,imageToCourt:map?.toCourt||null,courtToImage:map?.toImage||null,side:map?.side||null,
     supportFrames:map?.supportFrames||[],fitRmsePixels:map?.fitRmsePixels??null,excludedControlIds:map?.excludedControlIds||[],
     independentChecks:map?.checkResiduals||[],metricAccuracyValidated:false};
 })};
}
fs.writeFileSync(output,JSON.stringify(result));
console.log(JSON.stringify(Object.fromEntries(Object.entries(result.samples).map(([k,v])=>[k,{frames:v.frames.length,valid:v.frames.filter(f=>f.imageToCourt).length}]))));
